/**
 * The offline US ZIP lookup (task A1b).
 *
 * Port of `resolveZip` in extension/src/core.ts and the bundled table
 * scaffold/data/us-zip-centroids.json at commit 48c569e. The table is public data from GeoNames
 * (CC BY 4.0; its attribution and license travel inside the JSON, which is bundled byte for byte as
 * core/data/zip-centroids.v1.json and pinned by SHA-256). The table is read from a bundled file
 * through the Loader port by allowlisted resource ID. It is used only to turn a ZIP the user typed
 * into approximate coordinates for local distance information, and it is not part of any request.
 * Distance is informational: it is never a medical exclusion and never part of a model-bound
 * payload.
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
 * One postal-area centroid: a city name, a state, and approximate coordinates. Of the bundled
 * table's 41,488 entries, 509 have an empty state, and all of them are APO/FPO military postal
 * areas (most of their centroids lie outside the United States). The table has no ZIPs for US
 * territories such as Puerto Rico or Guam; it does have two Marshall Islands ZIPs with state code
 * MH. The schema accepts an empty state only so that the byte-identical table loads as a whole;
 * resolveZip refuses those entries, as the extension did.
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
 * Turns a ZIP the user typed into approximate coordinates, as extension/src/core.ts did: the text is
 * first checked like boundedText (no control characters, tabs, line breaks, or lone surrogates,
 * so "83702\n" is an input error rather than a trimmed match), then NFC-normalized and trimmed;
 * five digits, optionally ZIP+4, leading zeros preserved. An unknown or malformed ZIP is an input
 * error, and so is an entry without a two-letter state (the 509 APO/FPO entries; the extension
 * answered "Offline location data is unavailable" for them). In both cases the caller should offer
 * searching without location. Unlike the extension, the untrimmed text is not capped at 10
 * characters, so the scaffold's padded " 02108-1234 " still resolves. A table entry outside its own
 * bounds cannot exist here because loadZipTable already rejected the whole table in that case.
 */
export function resolveZip(raw: string, table: ZipTable): ResolvedZip {
  if (typeof raw !== 'string' || !isSafeText(raw)) throw new CoreError('INVALID_REQUEST');
  const value = raw.normalize('NFC').trim();
  if (!/^\d{5}(?:-\d{4})?$/.test(value)) throw new CoreError('INVALID_REQUEST');
  const zip = value.slice(0, 5);
  const entry = table.zips[zip];
  if (entry === undefined) throw new CoreError('INVALID_REQUEST');
  if (!/^[A-Z]{2}$/.test(entry.state)) throw new CoreError('INVALID_REQUEST');
  return { zip, city: entry.city, state: entry.state, lat: entry.lat, lon: entry.lon };
}
