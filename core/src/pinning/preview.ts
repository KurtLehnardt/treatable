/**
 * Record-set pinning for prepareReal (task A2; contract change documented for the A2r security
 * re-review in docs/apps/record-set-pinning.md).
 *
 * The reviewed extension pinned real-data previews to a fixed, hash-checked bundled catalog. The apps
 * search ClinicalTrials.gov live, so the pin is the set of records fetched in this session instead:
 *   1. the R4 bounds hold: 1 to 10 Decisions studies and 1 to 2 Agents studies (bounds.ts);
 *   2. every NCT ID in the packet must be a record the session holds (RECORD_NOT_IN_SESSION);
 *   3. the condition term must equal, byte for byte, one entry of `conditions` or `meshTerms` on a
 *      record the session holds, and be at most 200 UTF-8 bytes (CONDITION_TERM_NOT_IN_SESSION;
 *      the protocol schema already rejects longer terms instead of shortening them), so it is public
 *      ClinicalTrials.gov vocabulary and never text the user typed;
 *   4. every study object in the preview is toModelStudy(held record), so the preview holds exactly
 *      the allowlisted public fields of the records the user saw, with no other key;
 *   5. (session adapter) the session subject digest equals the record-set digest, which the consent
 *      digest covers.
 * The core functions take a RecordLookup, not a session, so a dispatcher-owned canonical record index
 * can call them directly: resolvePinnedStudies (checks 1 to 4), buildPreviewFromRecords, and
 * verifyPreviewAgainstRecords (re-derives the whole preview and requires exact equality).
 * buildPinnedPreview and verifyPinnedPreview are the session adapters this branch's dispatcher uses.
 */
import { utf8ByteLength } from '../bytes.ts';
import { CoreError } from '../errors.ts';
import { jsonEqual } from '../json.ts';
import { MAX_CONDITION_TERM_BYTES, ModelPacketSchema, type ModelPacket, type ModelStudy, type Preview, type StudyRecord } from '../protocol.ts';
import { buildPreview } from '../preview.ts';
import type { Session } from '../session.ts';
import { assertR4Packet } from './bounds.ts';
import { toModelStudy } from './model-study.ts';
import { getRecordSet, lookupOf, type RecordLookup } from './record-set.ts';

export interface PinnedBuild {
  readonly preview: Preview;
}

/**
 * True when `term` equals one condition or MeSH term of a held record. JavaScript string equality
 * compares UTF-16 code units, so equal strings have equal UTF-8 bytes; no normalization, trimming, or
 * case folding is applied, so a visually similar term (other case, other Unicode form, extra space)
 * does not match.
 */
export function isConditionTermInRecords(records: Iterable<Readonly<StudyRecord>>, term: string): boolean {
  if (typeof term !== 'string' || term.length === 0 || utf8ByteLength(term) > MAX_CONDITION_TERM_BYTES) return false;
  for (const record of records) {
    if (record.conditions.includes(term) || record.meshTerms.includes(term)) return true;
  }
  return false;
}

/**
 * Checks a packet against the held records and returns the pinned model study for every NCT ID in
 * it. Throws INVALID_REQUEST (malformed packet or R4 bounds), RECORD_NOT_IN_SESSION, or
 * CONDITION_TERM_NOT_IN_SESSION.
 */
export function resolvePinnedStudies(packetInput: unknown, lookup: RecordLookup): { packet: ModelPacket; studies: ReadonlyMap<string, ModelStudy> } {
  const parsed = ModelPacketSchema.safeParse(packetInput);
  if (!parsed.success) throw new CoreError('INVALID_REQUEST');
  const packet = parsed.data;
  assertR4Packet(packet);
  const studies = new Map<string, ModelStudy>();
  for (const id of [...(packet.scoreNctIds ?? []), ...(packet.agentNctIds ?? [])]) {
    if (studies.has(id)) continue;
    const record = lookup.get(id);
    if (record === undefined || record.nctId !== id) throw new CoreError('RECORD_NOT_IN_SESSION');
    studies.set(id, toModelStudy(record));
  }
  if (!isConditionTermInRecords(lookup.values(), packet.conditionTerm)) throw new CoreError('CONDITION_TERM_NOT_IN_SESSION');
  return { packet, studies };
}

/** Builds the exact preview for `packet` from the held records. */
export function buildPreviewFromRecords(packetInput: unknown, lookup: RecordLookup): Preview {
  const { packet, studies } = resolvePinnedStudies(packetInput, lookup);
  return buildPreview(packet, id => studies.get(id));
}

/**
 * Re-derives the preview for `packet` from the held records and requires `preview` to equal it
 * exactly. Throws what resolvePinnedStudies throws, or INTERNAL_ERROR for any difference (changed
 * study text, an extra field, another record version, a reordered list).
 */
export function verifyPreviewAgainstRecords(packetInput: unknown, preview: unknown, lookup: RecordLookup): void {
  const expected = buildPreviewFromRecords(packetInput, lookup);
  if (!jsonEqual(preview, expected)) throw new CoreError('INTERNAL_ERROR');
}

// ---------------------------------------------------------------------------------------------
// Session adapters (replaceable by a dispatcher-owned canonical record index)
// ---------------------------------------------------------------------------------------------

function sessionLookup(session: Session): RecordLookup {
  const set = getRecordSet(session);
  const subject = session.subjectDigest();
  if (!set || subject === undefined) throw new CoreError('RECORD_NOT_IN_SESSION');
  // The consent subject must be exactly this record set, or a receipt could cover other records.
  if (subject !== set.digest) throw new CoreError('INTERNAL_ERROR');
  return lookupOf(set);
}

/** Builds the exact preview for `packet` from the session record set (the default prepareReal builder). */
export function buildPinnedPreview(session: Session, packetInput: unknown): PinnedBuild {
  return { preview: buildPreviewFromRecords(packetInput, sessionLookup(session)) };
}

/** verifyPreviewAgainstRecords over the session record set; the dispatcher runs it for every builder. */
export function verifyPinnedPreview(session: Session, packetInput: unknown, preview: unknown): void {
  verifyPreviewAgainstRecords(packetInput, preview, sessionLookup(session));
}
