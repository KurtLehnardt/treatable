/**
 * The offline US ZIP lookup (task A1b).
 *
 * Port of `resolveZip` in extension/src/core.ts and the bundled table
 * scaffold/data/us-zip-centroids.json at commit 48c569e. The table is public data from GeoNames
 * (CC BY 4.0; its attribution and license travel inside the JSON, which is bundled byte for byte as
 * core/data/zip-centroids.v1.json and pinned by SHA-256). It is loaded through the Loader port by
 * allowlisted resource ID and never leaves the device: it only turns a ZIP the user typed into
 * approximate coordinates for local distance information. Distance stays local and informational; it
 * is never a medical exclusion and never part of a model-bound payload.
 */
import { z } from 'zod';
import { CoreError } from './errors.ts';
import { isSafeText } from './protocol.ts';
import { loadJsonResource, type ResourceSpec } from './resources.ts';
import type { CancelSignal, Loader, Sha256 } from './ports.ts';

/** The bundled table, by allowlisted resource ID, with its pinned SHA-256. */
export const ZIP_RESOURCE: ResourceSpec = Object.freeze({
  id: 'zip-centroids.v1.json',
  maxBytes: 4 * 1024 * 1024,
  sha256: '5f81ed84559288d269af39cc3173bb1997b425e30fde235d8b28399c97ea7c6c',
});

/**
 * One postal-area centroid: a city name, a state, and approximate coordinates. The bundled table
 * has no state for APO/FPO and territorial ZIPs (of the real table's 41,488 entries, 509 ship with
 * an empty state: military and embassy posts), so the state is two letters or empty rather than
 * forcing half the table out of the bundle.
 */
const ZipEntrySchema = z
  .strictObject({
    city: z.string().min(1).max(200).refine(v => isSafeText(v)),
    state: z.string().regex(/^(?:[A-Z]{2})?$/),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  });

/**
 * The table on disk. Unknown keys are rejected, so a tampered or future table fails closed instead
 * of half-loading. The attribution fields stay available so hosts can display the license.
 */
export const ZipTableSchema = z
  .strictObject({
    source: z.string().max(400).refine(v => isSafeText(v)).optional(),
    license: z.string().max(400).refine(v => isSafeText(v)).optional(),
    attribution: z.string().max(400).refine(v => isSafeText(v)).optional(),
    downloadedAt: z.string().max(40).refine(v => isSafeText(v)).optional(),
    precision: z.string().max(400).refine(v => isSafeText(v)).optional(),
    zips: z.record(z.string().regex(/^\d{5}$/), ZipEntrySchema).refine(zips => Object.keys(zips).length <= 65_536),
  });
export type ZipTable = z.infer<typeof ZipTableSchema>;

/** Loads and validates the bundled table. Any failure is RESOURCE_INVALID; nothing else is exposed. */
export async function loadZipTable(
  ports: { readonly loader: Loader; readonly sha256: Sha256 },
  signal?: CancelSignal,
): Promise<ZipTable> {
  const parsed = ZipTableSchema.safeParse(await loadJsonResource(ports, ZIP_RESOURCE, signal));
  if (!parsed.success) throw new CoreError('RESOURCE_INVALID');
  return parsed.data;
}

export interface ResolvedZip {
  readonly zip: string;
  readonly city: string;
  readonly state: string;
  readonly lat: number;
  readonly lon: number;
}

/**
 * Turns a ZIP the user typed into approximate coordinates, exactly as extension/src/core.ts did:
 * five digits, optionally ZIP+4, leading zeros preserved; trimmed and NFC-normalized text; an
 * unknown or malformed ZIP is an input error, and the caller should offer searching without
 * location. A table entry outside its own bounds cannot exist here because loadZipTable already
 * rejected the whole table in that case.
 */
export function resolveZip(raw: string, table: ZipTable): ResolvedZip {
  const value = typeof raw === 'string' ? raw.trim().normalize('NFC') : '';
  if (!/^\d{5}(?:-\d{4})?$/.test(value)) throw new CoreError('INVALID_REQUEST');
  const zip = value.slice(0, 5);
  const entry = table.zips[zip];
  if (entry === undefined) throw new CoreError('INVALID_REQUEST');
  return { zip, city: entry.city, state: entry.state, lat: entry.lat, lon: entry.lon };
}
