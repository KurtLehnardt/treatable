/**
 * The session record set: the public ClinicalTrials.gov records returned by live searches in this
 * session, in memory only, with a SHA-256 digest per record and one digest over the whole set.
 *
 * This replaces the fixed, hash-pinned bundled catalog of the reviewed extension contract
 * (PUBLIC_CATALOG_METADATA in extension/shared/public-catalog.mjs, checked by real.mjs at 48c569e).
 * The record-set digest is the session's consent subject (session.setSubjectDigest): it is part of
 * every consent digest, and executeReal requires it to be unchanged. Any search that changes the set
 * (a new record, a new version of a record, or an evicted record) therefore changes the subject,
 * which clears prepared consent at once (mutation invalidation), and an old receipt can never run
 * against different records. See docs/apps/record-set-pinning.md.
 *
 * Layers:
 *   - Pure functions (pinRecords, mergeRecordSet, recordDigest, recordSetDigest, lookupOf) build and
 *     hash record sets without touching a session. A dispatcher-owned canonical record index can
 *     use them directly, or implement RecordLookup itself.
 *   - The session adapter (RECORD_SET_SLOT, getRecordSet, getSessionRecord, prepareRecordMerge) keeps
 *     the set in a session slot for this branch's dispatcher.
 *
 * Nothing here is persisted, logged, or sent anywhere. endSession wipes the session slots.
 */
import { isHex64, utf8Encode } from '../bytes.ts';
import { CoreError } from '../errors.ts';
import { canonicalJson, deepFreeze, jsonClone, type JsonObject } from '../json.ts';
import type { Sha256 } from '../ports.ts';
import { StudyRecordSchema, type StudyRecord } from '../protocol.ts';
import { defineSlot, type Session } from '../session.ts';

/** Version tag inside every record-set digest, so a future format cannot collide with this one. */
export const RECORD_SET_FORMAT = 'treatable.record-set.v1';
/** At most this many records are kept per session; the oldest are evicted first. */
export const MAX_SESSION_RECORDS = 250;

export interface PinnedRecord {
  readonly nctId: string;
  /** Deep-frozen record exactly as returned to the host. */
  readonly record: Readonly<StudyRecord>;
  /** SHA-256 of the canonical JSON of `record`. */
  readonly digest: string;
  /** Insertion order; eviction removes the lowest first. */
  readonly seq: number;
}

export interface RecordSetState {
  readonly entries: ReadonlyMap<string, PinnedRecord>;
  /** SHA-256 over the canonical JSON of { format, records: [[nctId, recordDigest], ...] } sorted by NCT ID. */
  readonly digest: string;
  readonly nextSeq: number;
}

/**
 * Read-only view of the records a session holds: what record-set pinning needs from any record
 * store. RecordSetState provides it through lookupOf; a canonical session index can provide it
 * directly (for example get = session.recordById, values = session.records).
 */
export interface RecordLookup {
  get(nctId: string): Readonly<StudyRecord> | undefined;
  values(): Iterable<Readonly<StudyRecord>>;
}

async function sha256Hex(sha256: Sha256, text: string): Promise<string> {
  const digest = await sha256.digestHex(utf8Encode(text));
  if (!isHex64(digest)) throw new CoreError('INTERNAL_ERROR');
  return digest;
}

/** SHA-256 over the canonical (RFC 8785 ordered) JSON of one record. */
export function recordDigest(sha256: Sha256, record: Readonly<StudyRecord>): Promise<string> {
  return sha256Hex(sha256, canonicalJson(record as unknown as JsonObject));
}

/**
 * The digest the consent store pins as the subject. It depends only on the set of (NCT ID, record
 * digest) pairs, not on insertion order. Exported so tests and reviewers can recompute it.
 */
export function recordSetDigest(sha256: Sha256, entries: Iterable<{ readonly nctId: string; readonly digest: string }>): Promise<string> {
  const records = [...entries].map(e => [e.nctId, e.digest]).sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
  return sha256Hex(sha256, canonicalJson({ format: RECORD_SET_FORMAT, records }));
}

/**
 * Validates, deep-copies, freezes, and hashes records. Fails with INTERNAL_ERROR on any record that
 * is not a valid StudyRecord or on a repeated NCT ID, so nothing unvalidated can be pinned.
 */
export async function pinRecords(sha256: Sha256, records: readonly StudyRecord[]): Promise<{ record: Readonly<StudyRecord>; digest: string }[]> {
  const out: { record: Readonly<StudyRecord>; digest: string }[] = [];
  const ids = new Set<string>();
  for (const input of records) {
    const parsed = StudyRecordSchema.safeParse(input);
    if (!parsed.success || ids.has(parsed.data.nctId)) throw new CoreError('INTERNAL_ERROR');
    ids.add(parsed.data.nctId);
    const record = deepFreeze(jsonClone(parsed.data as unknown as JsonObject)) as unknown as Readonly<StudyRecord>;
    out.push({ record, digest: await recordDigest(sha256, record) });
  }
  return out;
}

/**
 * Pure merge: `base` plus `records` (a newer version replaces an older one and counts as new), with
 * the oldest records evicted beyond `cap`. Returns a new frozen state; `base` is not changed.
 */
export async function mergeRecordSet(
  sha256: Sha256,
  base: RecordSetState | undefined,
  records: readonly StudyRecord[],
  cap: number = MAX_SESSION_RECORDS,
): Promise<RecordSetState> {
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > MAX_SESSION_RECORDS) throw new CoreError('INTERNAL_ERROR');
  const pinned = await pinRecords(sha256, records);
  const entries = new Map<string, PinnedRecord>(base?.entries ?? []);
  let nextSeq = base?.nextSeq ?? 0;
  for (const { record, digest } of pinned) {
    entries.delete(record.nctId);
    entries.set(record.nctId, Object.freeze({ nctId: record.nctId, record, digest, seq: nextSeq }));
    nextSeq += 1;
  }
  if (entries.size > cap) {
    const oldest = [...entries.values()].sort((a, b) => a.seq - b.seq).slice(0, entries.size - cap);
    for (const entry of oldest) entries.delete(entry.nctId);
  }
  const digest = await recordSetDigest(sha256, entries.values());
  return Object.freeze({ entries, digest, nextSeq });
}

/** RecordLookup over a RecordSetState. */
export function lookupOf(set: RecordSetState): RecordLookup {
  return {
    get: nctId => set.entries.get(nctId)?.record,
    values: () => [...set.entries.values()].map(entry => entry.record),
  };
}

// ---------------------------------------------------------------------------------------------
// Session adapter (replaceable by a dispatcher-owned canonical record index)
// ---------------------------------------------------------------------------------------------

export const RECORD_SET_SLOT = defineSlot<RecordSetState>('pinning.recordSet');

export function getRecordSet(session: Session): RecordSetState | undefined {
  return session.get(RECORD_SET_SLOT);
}

/** One record of the session record set (for local screening and display). */
export function getSessionRecord(session: Session, nctId: string): PinnedRecord | undefined {
  return getRecordSet(session)?.entries.get(nctId);
}

/**
 * Prepares adding `records` to the session record set. Hashing goes through the (possibly
 * asynchronous) port first; the returned commit() then installs the new set and the new subject
 * digest synchronously, together, so no other request can observe one without the other. commit()
 * fails with CANCELLED if the set changed in between or the session ended. An empty list changes
 * nothing.
 */
export async function prepareRecordMerge(session: Session, sha256: Sha256, records: readonly StudyRecord[]): Promise<() => void> {
  const base = getRecordSet(session);
  if (!records.length) return () => {};
  const next = await mergeRecordSet(sha256, base, records);
  return () => {
    if (session.ended || getRecordSet(session) !== base) throw new CoreError('CANCELLED');
    session.set(RECORD_SET_SLOT, next);
    // A changed digest clears prepared consent (Session.mutate) and aborts running real-data work.
    session.setSubjectDigest(next.digest);
  };
}
