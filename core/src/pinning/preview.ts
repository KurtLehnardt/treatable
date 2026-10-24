/**
 * Record-set pinning for prepareReal (task A2; contract change documented for the A2r security
 * re-review in docs/apps/record-set-pinning.md).
 *
 * The reviewed extension pinned real-data previews to a fixed, hash-checked bundled catalog. The apps
 * search ClinicalTrials.gov live, so the pin is the session record set instead:
 *   1. every NCT ID in the packet must be a record in the session record set (RECORD_NOT_IN_SESSION);
 *   2. the condition term must equal, byte for byte, one entry of `conditions` or `meshTerms` on a
 *      record in the session record set, and be at most 200 UTF-8 bytes (CONDITION_TERM_NOT_IN_SESSION;
 *      the protocol schema already rejects longer terms instead of shortening them);
 *   3. every study object in the preview is toModelStudy(pinned record version), so the preview holds
 *      exactly the allowlisted public fields of the records the user saw, and nothing else;
 *   4. the R4 bounds hold: at most 10 Decisions studies and at most 2 Agents studies;
 *   5. the session subject digest equals the record-set digest, which the consent digest covers.
 * buildPinnedPreview builds the preview under these rules. verifyPinnedPreview re-derives the whole
 * preview from the pinned records and requires exact equality; the dispatcher runs it for every
 * prepareReal, whichever builder produced the preview, so no pipeline can bypass the pin.
 */
import { utf8ByteLength, utf8Encode } from '../bytes.ts';
import { CoreError } from '../errors.ts';
import { canonicalJson, jsonEqual, type JsonObject, type JsonValue } from '../json.ts';
import {
  MAX_AGENT_STUDIES,
  MAX_CONDITION_TERM_BYTES,
  MAX_SCORE_STUDIES,
  ModelPacketSchema,
  type ModelPacket,
  type ModelStudy,
  type Preview,
} from '../protocol.ts';
import { buildPreview } from '../preview.ts';
import type { Session } from '../session.ts';
import { toModelStudy } from './model-study.ts';
import { RECORD_SET_FORMAT, getRecordSet, type RecordSetState } from './record-set.ts';

export interface PinnedBuild {
  readonly preview: Preview;
  /** Pinned alongside the preview (not shown, not part of the consent digest, which covers the subject digest instead). */
  readonly context: JsonValue;
}

/** True when `term` equals one condition or MeSH term of a session record, compared as exact UTF-8 bytes. */
export function isConditionTermInRecordSet(set: RecordSetState, term: string): boolean {
  if (typeof term !== 'string' || term.length === 0 || utf8ByteLength(term) > MAX_CONDITION_TERM_BYTES) return false;
  const wanted = utf8Encode(term);
  const same = (candidate: string): boolean => {
    if (candidate.length !== term.length) return false;
    const bytes = utf8Encode(candidate);
    if (bytes.length !== wanted.length) return false;
    for (let i = 0; i < bytes.length; i += 1) if (bytes[i] !== wanted[i]) return false;
    return true;
  };
  for (const entry of set.entries.values()) {
    if (entry.record.conditions.some(same) || entry.record.meshTerms.some(same)) return true;
  }
  return false;
}

function pinnedStudies(session: Session, packetInput: unknown): { packet: ModelPacket; set: RecordSetState; studies: Map<string, ModelStudy> } {
  const parsed = ModelPacketSchema.safeParse(packetInput);
  if (!parsed.success) throw new CoreError('INVALID_REQUEST');
  const packet = parsed.data;
  const scoreIds = packet.scoreNctIds ?? [];
  const agentIds = packet.agentNctIds ?? [];
  if (scoreIds.length > MAX_SCORE_STUDIES || agentIds.length > MAX_AGENT_STUDIES || scoreIds.length + agentIds.length === 0) {
    throw new CoreError('INVALID_REQUEST');
  }
  const set = getRecordSet(session);
  const subject = session.subjectDigest();
  if (!set || subject === undefined) throw new CoreError('RECORD_NOT_IN_SESSION');
  if (subject !== set.digest) throw new CoreError('INTERNAL_ERROR');
  const studies = new Map<string, ModelStudy>();
  for (const id of [...scoreIds, ...agentIds]) {
    if (studies.has(id)) continue;
    const entry = set.entries.get(id);
    if (!entry) throw new CoreError('RECORD_NOT_IN_SESSION');
    studies.set(id, toModelStudy(entry.record));
  }
  if (!isConditionTermInRecordSet(set, packet.conditionTerm)) throw new CoreError('CONDITION_TERM_NOT_IN_SESSION');
  return { packet, set, studies };
}

function pinContext(set: RecordSetState, studies: Map<string, ModelStudy>): JsonValue {
  return {
    format: RECORD_SET_FORMAT,
    recordSetDigest: set.digest,
    records: [...studies.keys()].map(nctId => ({ nctId, recordDigest: set.entries.get(nctId)!.digest })),
  };
}

/** Builds the exact preview for `packet` from the pinned session records (the default prepareReal builder). */
export function buildPinnedPreview(session: Session, packetInput: unknown): PinnedBuild {
  const { packet, set, studies } = pinnedStudies(session, packetInput);
  const preview = buildPreview(packet, id => studies.get(id));
  return { preview, context: pinContext(set, studies) };
}

/**
 * Re-derives the preview for `packet` from the pinned session records and requires `preview` to equal
 * it exactly. Throws RECORD_NOT_IN_SESSION, CONDITION_TERM_NOT_IN_SESSION, PREVIEW_TOO_LARGE, or
 * INTERNAL_ERROR (any difference, for example changed study text or an extra field).
 */
export function verifyPinnedPreview(session: Session, packetInput: unknown, preview: unknown): void {
  const { packet, studies } = pinnedStudies(session, packetInput);
  const expected = buildPreview(packet, id => studies.get(id));
  if (!jsonEqual(preview, expected)) throw new CoreError('INTERNAL_ERROR');
}

export interface PinnedRequestBytes {
  /** One body per score study, in packet order. */
  readonly decisions: readonly Uint8Array[];
  readonly agentsCreate: Uint8Array | null;
  /** The `output` string of each tool result, in agentNctIds order. */
  readonly toolResultOutputs: readonly string[];
}

/**
 * The exact bytes to send for a pinned preview: the canonical JSON (RFC 8785 key order) of each
 * body. The consent digest is SHA-256 over the canonical JSON of an object that contains these same
 * bodies, so the digest fixes these bytes exactly; any change to a sent byte requires a change to the
 * digested content. Task A4 sends these bytes and nothing else.
 */
export function pinnedRequestBytes(preview: Preview): PinnedRequestBytes {
  return {
    decisions: preview.decisionsRequests.map(body => utf8Encode(canonicalJson(body as unknown as JsonObject))),
    agentsCreate: preview.agentsRequest ? utf8Encode(canonicalJson(preview.agentsRequest as unknown as JsonObject)) : null,
    toolResultOutputs: preview.toolResults.map(result => canonicalJson(result as unknown as JsonObject)),
  };
}
