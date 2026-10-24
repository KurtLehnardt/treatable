/**
 * descriptionsStore.ts — FE-07 "Company descriptions" local store.
 *
 * Multiple NAMED company descriptions, each keeping multiple saved VERSIONS,
 * all localStorage-backed on this device only (STORAGE_KEYS.descriptions).
 * Nothing here is ever sent to a server, and "Delete my data" wipes it with
 * everything else. Consent (§5.3) governs any future reuse beyond the user's
 * own device; this store performs no such reuse.
 *
 * Framework-agnostic (no React). NOTE: this module intentionally performs no
 * logging — user-entered description text must never be written to any console
 * or transmitted anywhere (R9.0 / §5.3).
 */

import { STORAGE_KEYS } from '@/lib/mockAuth';
import { readJSON, writeJSON } from '@/lib/localStore';

export interface DescriptionVersion {
  id: string;
  text: string;
  /** ISO timestamp this version was saved. */
  createdAt: string;
}

export interface CompanyDescription {
  id: string;
  name: string;
  versions: DescriptionVersion[];
  /** The version currently marked active, if any. */
  activeVersionId?: string;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Coerce a parsed value into a well-formed CompanyDescription[]. */
function normalize(value: unknown): CompanyDescription[] {
  if (!Array.isArray(value)) return [];
  const out: CompanyDescription[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    if (typeof d.id !== 'string' || typeof d.name !== 'string') continue;
    const versions: DescriptionVersion[] = Array.isArray(d.versions)
      ? d.versions
          .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
          .filter((v) => typeof v.id === 'string' && typeof v.text === 'string')
          .map((v) => ({
            id: v.id as string,
            text: v.text as string,
            createdAt: typeof v.createdAt === 'string' ? v.createdAt : new Date(0).toISOString(),
          }))
      : [];
    out.push({
      id: d.id,
      name: d.name,
      versions,
      activeVersionId: typeof d.activeVersionId === 'string' ? d.activeVersionId : undefined,
    });
  }
  return out;
}

/** All named descriptions with their version history. */
export function getDescriptions(): CompanyDescription[] {
  return normalize(readJSON<unknown>(STORAGE_KEYS.descriptions, []));
}

function persist(list: CompanyDescription[]): CompanyDescription[] {
  writeJSON(STORAGE_KEYS.descriptions, list);
  return list;
}

/** Create a new named description (empty version history). Returns updated list. */
export function createDescription(name: string): CompanyDescription[] {
  const trimmed = name.trim();
  if (trimmed.length === 0) return getDescriptions();
  const list = getDescriptions();
  list.push({ id: newId('desc'), name: trimmed, versions: [] });
  return persist(list);
}

/** Rename a description by id. Empty names are ignored. Returns updated list. */
export function renameDescription(id: string, name: string): CompanyDescription[] {
  const trimmed = name.trim();
  if (trimmed.length === 0) return getDescriptions();
  const list = getDescriptions().map((d) => (d.id === id ? { ...d, name: trimmed } : d));
  return persist(list);
}

/** Delete a description (and all its versions) by id. Returns updated list. */
export function deleteDescription(id: string): CompanyDescription[] {
  const list = getDescriptions().filter((d) => d.id !== id);
  return persist(list);
}

/**
 * Save a new version onto a description and mark it active. Empty text is
 * ignored. No-op for an unknown descId. Returns updated list.
 */
export function saveVersion(descId: string, text: string): CompanyDescription[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return getDescriptions();
  const version: DescriptionVersion = {
    id: newId('ver'),
    text: trimmed,
    createdAt: new Date().toISOString(),
  };
  const list = getDescriptions().map((d) =>
    d.id === descId
      ? { ...d, versions: [...d.versions, version], activeVersionId: version.id }
      : d,
  );
  return persist(list);
}

/** Mark an existing version active. No-op for unknown ids. Returns updated list. */
export function setActiveVersion(descId: string, versionId: string): CompanyDescription[] {
  const list = getDescriptions().map((d) => {
    if (d.id !== descId) return d;
    if (!d.versions.some((v) => v.id === versionId)) return d;
    return { ...d, activeVersionId: versionId };
  });
  return persist(list);
}
