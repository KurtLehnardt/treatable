/**
 * The session record index: the canonical, in-memory set of public ClinicalTrials.gov records that
 * searchTrials returned to the host during this session.
 *
 * Ownership. Only the dispatcher writes the index. After a searchTrials response has passed every
 * output check (schema, size, credential scan), the dispatcher merges its records here and commits
 * them together with the response, so the index holds exactly the records the host was shown.
 * Pipelines receive only the read-only RecordIndexView and cannot add, change, or remove records.
 * The non-replaceable consent checks in the dispatcher read the same index before any preparation:
 *   - every NCT ID in a model packet must be a held record (RECORD_NOT_IN_SESSION);
 *   - the condition term must equal, byte for byte, a conditions or meshTerms entry of a held
 *     record (CONDITION_TERM_NOT_IN_SESSION);
 *   - every study object in a preview must equal projectModelStudy of the held record (preview.ts).
 *
 * Merge semantics. These follow task A2's record set (feature/core-a2-fcc, src/pinning/
 * record-set.ts) so that branch can adopt this index without changing its digests:
 *   - records accumulate across searches and pages; a record returned again replaces the held
 *     version and becomes the newest;
 *   - at most MAX_SESSION_RECORDS records are held; the oldest are evicted first;
 *   - each record has a SHA-256 digest of its canonical JSON (RFC 8785 key order), and the set has
 *     a SHA-256 digest of the canonical JSON of { format: RECORD_SET_FORMAT, records: [[nctId,
 *     recordDigest], ...] } ordered by NCT ID. The set digest is the session's consent subject, so
 *     any change to the held records clears prepared consent and no receipt can run against
 *     records other than the ones it was prepared with.
 * Hashing goes through the Sha256 port, which may be asynchronous, so a merge is prepared first and
 * committed synchronously afterwards. A commit fails with CANCELLED when the index changed in
 * between, so two merges can never interleave.
 *
 * Byte-for-byte term matching. Terms are compared as JavaScript strings, that is as UTF-16 code
 * units. Both the condition term (ConditionTermSchema) and every record term (StudyRecordSchema)
 * reject lone surrogates, and for strings without lone surrogates UTF-16 equality is the same as
 * equality of the UTF-8 bytes. No normalization, case folding, or trimming is applied.
 *
 * This module makes no network request and writes nothing to storage or logs. Session.wipe() at
 * endSession clears the index.
 */
import { isHex64, utf8Encode } from './bytes.ts';
import { CoreError } from './errors.ts';
import { canonicalJson, deepFreeze, jsonClone, type JsonObject } from './json.ts';
import type { Sha256 } from './ports.ts';
import { NCT_ID_PATTERN, StudyRecordSchema, type StudyRecord } from './protocol.ts';

/** Version tag inside every record-set digest, so a future format cannot collide with this one. */
export const RECORD_SET_FORMAT = 'treatable.record-set.v1';
/** At most this many records are held per session; the oldest are evicted first. */
export const MAX_SESSION_RECORDS = 250;
/** Upper bound for the records of one merge (a searchTrials page holds at most 25). */
export const MAX_RECORDS_PER_MERGE = 100;

/** One held record. Everything reachable from it is frozen. */
export interface PinnedRecord {
  readonly nctId: string;
  /** The record exactly as returned to the host (validated, cloned, deep-frozen). */
  readonly record: Readonly<StudyRecord>;
  /** SHA-256 hex of the canonical JSON of `record`. */
  readonly digest: string;
  /** Insertion order; eviction removes the lowest first. */
  readonly seq: number;
}

/** The read-only view that pipelines and preview builders receive. */
export interface RecordIndexView {
  /** Number of held records. */
  readonly size: number;
  /** The record-set digest, or undefined while no record is held. */
  readonly digest: string | undefined;
  get(nctId: string): PinnedRecord | undefined;
  has(nctId: string): boolean;
  /** True when `term` equals, byte for byte, a conditions or meshTerms entry of a held record. */
  hasConditionTerm(term: string): boolean;
  /** Held NCT IDs in ascending order. */
  nctIds(): string[];
}

/** A merge whose hashing is done; commit() installs it synchronously. */
export interface PreparedMerge {
  /** The record-set digest after the commit (undefined when the index stays empty). */
  readonly digest: string | undefined;
  commit(): void;
}

/** The writer. Only the session (on behalf of the dispatcher) holds it. */
export interface RecordIndex extends RecordIndexView {
  /** A frozen facade without any writer; this is what pipelines receive. */
  readonly view: RecordIndexView;
  /** Validates and hashes `records`; throws INTERNAL_ERROR for invalid input and CANCELLED when the index changed meanwhile. */
  prepareMerge(sha256: Sha256, records: readonly unknown[]): Promise<PreparedMerge>;
  /** Drops every record (endSession). */
  clear(): void;
}

async function sha256Text(sha256: Sha256, text: string): Promise<string> {
  const digest = await sha256.digestHex(utf8Encode(text));
  if (!isHex64(digest)) throw new CoreError('INTERNAL_ERROR');
  return digest;
}

/** SHA-256 over the canonical JSON of one record. Exported so tests and reviewers can recompute it. */
export function recordDigest(sha256: Sha256, record: Readonly<StudyRecord>): Promise<string> {
  return sha256Text(sha256, canonicalJson(record as unknown as JsonObject));
}

/** The record-set digest (the consent subject). Exported so tests and reviewers can recompute it. */
export function recordSetDigest(sha256: Sha256, entries: Iterable<{ readonly nctId: string; readonly digest: string }>): Promise<string> {
  const records = [...entries].map(e => [e.nctId, e.digest]).sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
  return sha256Text(sha256, canonicalJson({ format: RECORD_SET_FORMAT, records }));
}

function termsOf(entries: ReadonlyMap<string, PinnedRecord>): ReadonlySet<string> {
  const terms = new Set<string>();
  for (const entry of entries.values()) {
    for (const term of entry.record.conditions) terms.add(term);
    for (const term of entry.record.meshTerms) terms.add(term);
  }
  return terms;
}

export function createRecordIndex(): RecordIndex {
  let entries: ReadonlyMap<string, PinnedRecord> = new Map();
  let terms: ReadonlySet<string> = new Set();
  let digest: string | undefined;
  let nextSeq = 0;
  // Changes on every commit and clear, so a prepared merge can detect that it is stale.
  let version = 0;

  const view: RecordIndexView = Object.freeze({
    get size() {
      return entries.size;
    },
    get digest() {
      return digest;
    },
    get: (nctId: string) => (typeof nctId === 'string' ? entries.get(nctId) : undefined),
    has: (nctId: string) => typeof nctId === 'string' && entries.has(nctId),
    hasConditionTerm: (term: string) => typeof term === 'string' && term.length > 0 && terms.has(term),
    nctIds: () => [...entries.keys()].sort(),
  });

  async function prepareMerge(sha256: Sha256, records: readonly unknown[]): Promise<PreparedMerge> {
    if (!Array.isArray(records) || records.length > MAX_RECORDS_PER_MERGE) throw new CoreError('INTERNAL_ERROR');
    const base = version;
    const pinned: { record: StudyRecord; digest: string }[] = [];
    const batch = new Set<string>();
    for (const input of records) {
      const parsed = StudyRecordSchema.safeParse(input);
      if (!parsed.success || !NCT_ID_PATTERN.test(parsed.data.nctId) || batch.has(parsed.data.nctId)) {
        throw new CoreError('INTERNAL_ERROR');
      }
      batch.add(parsed.data.nctId);
      const record = deepFreeze(jsonClone(parsed.data as unknown as JsonObject)) as unknown as StudyRecord;
      pinned.push({ record, digest: await recordDigest(sha256, record) });
    }
    if (version !== base) throw new CoreError('CANCELLED');
    if (!pinned.length) {
      return Object.freeze({
        digest,
        commit() {
          if (version !== base) throw new CoreError('CANCELLED');
        },
      });
    }
    const next = new Map<string, PinnedRecord>(entries);
    let seq = nextSeq;
    for (const { record, digest: recordHash } of pinned) {
      next.delete(record.nctId);
      next.set(record.nctId, Object.freeze({ nctId: record.nctId, record, digest: recordHash, seq }));
      seq += 1;
    }
    if (next.size > MAX_SESSION_RECORDS) {
      const oldest = [...next.values()].sort((a, b) => a.seq - b.seq).slice(0, next.size - MAX_SESSION_RECORDS);
      for (const entry of oldest) next.delete(entry.nctId);
    }
    const nextDigest = await recordSetDigest(sha256, next.values());
    const nextTerms = termsOf(next);
    if (version !== base) throw new CoreError('CANCELLED');
    return Object.freeze({
      digest: nextDigest,
      commit() {
        if (version !== base) throw new CoreError('CANCELLED');
        entries = next;
        terms = nextTerms;
        digest = nextDigest;
        nextSeq = seq;
        version += 1;
      },
    });
  }

  function clear(): void {
    entries = new Map();
    terms = new Set();
    digest = undefined;
    nextSeq = 0;
    version += 1;
  }

  return Object.freeze({
    view,
    get size() {
      return view.size;
    },
    get digest() {
      return view.digest;
    },
    get: view.get,
    has: view.has,
    hasConditionTerm: view.hasConditionTerm,
    nctIds: view.nctIds,
    prepareMerge,
    clear,
  });
}
