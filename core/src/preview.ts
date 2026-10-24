/**
 * Deterministic builders for the exact outbound preview, and the record checks that bind a preview
 * to the session record index.
 *
 * Given a validated packet and the public study objects, the builders produce the exact request
 * bodies: one Decisions body per score study, one Agents create body, and one tool result per agent
 * study. All texts are contract constants from protocol.ts, so the bodies depend only on the packet
 * and the studies.
 *
 * The studies are never supplied by a pipeline. projectModelStudy maps a held session record to the
 * model-bound study object; buildRecordPreview builds the whole preview from the session record
 * index; and verifyPreviewAgainstRecords re-derives a preview from the index and requires exact
 * equality. The dispatcher runs both before every consent preparation (dispatcher.ts, prepareReal),
 * so the condition term, the NCT IDs, and every study object are tied to records the host was shown
 * in this session, whatever any other code did.
 */
import { truncateUtf8, utf8ByteLength } from './bytes.ts';
import { CoreError } from './errors.ts';
import { canonicalJson, jsonEqual } from './json.ts';
import {
  AGENTS_INSTRUCTIONS,
  AGENTS_MODEL,
  AGENTS_TASK,
  CAUTION_IDS,
  DECISIONS_INPUT_TEXT,
  DECISIONS_MODEL,
  DELIVERY_POLICY,
  EVIDENCE_TOOL_DESCRIPTION,
  EVIDENCE_TOOL_NAME,
  MAX_MODEL_CRITERIA_BYTES,
  MAX_MODEL_STUDY_BYTES,
  MAX_MODEL_SUMMARY_BYTES,
  ModelPacketSchema,
  ModelStudySchema,
  PreviewSchema,
  QUESTION_TEMPLATES,
  SCORE_LEVELS,
  agentsOutputSchema,
  decisionsQuestionInstructions,
  profileFromPacket,
  type AgentsRequestBody,
  type DecisionsRequestBody,
  type ModelPacket,
  type ModelProfile,
  type ModelStudy,
  type Preview,
  type StudyRecord,
  type ToolResult,
} from './protocol.ts';
import type { RecordIndexView } from './records.ts';

/** The model-bound study keeps at most this many conditions (ModelStudySchema allows 50). */
export const MAX_MODEL_CONDITIONS = 50;

export function buildDecisionsBody(profile: ModelProfile, study: ModelStudy): DecisionsRequestBody {
  return {
    model: DECISIONS_MODEL,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: DECISIONS_INPUT_TEXT },
          { type: 'input_json', data: { minimizedHealthData: true, profile, study } },
        ],
      },
    ],
    questions: [
      {
        type: 'score',
        name: study.id,
        instructions: decisionsQuestionInstructions(study.id),
        levels: [
          { ...SCORE_LEVELS[0] },
          { ...SCORE_LEVELS[1] },
          { ...SCORE_LEVELS[2] },
          { ...SCORE_LEVELS[3] },
        ],
      },
    ],
    prompt_cache_options: { mode: 'explicit' },
  };
}

/** The Agents create body. Its `input` is the canonical serialization that parseAgentsInput requires. */
export function buildAgentsBody(profile: ModelProfile, nctIds: readonly string[]): AgentsRequestBody {
  return {
    environment: { type: 'none' },
    agent: {
      model: AGENTS_MODEL,
      reasoning: { effort: 'low' },
      multi_agent: { enabled: false },
      instructions: AGENTS_INSTRUCTIONS,
      tools: [
        {
          type: 'function',
          name: EVIDENCE_TOOL_NAME,
          description: EVIDENCE_TOOL_DESCRIPTION,
          parameters: {
            type: 'object',
            properties: { nctId: { type: 'string', enum: [...nctIds] } },
            required: ['nctId'],
            additionalProperties: false,
          },
        },
      ],
      text: { format: { type: 'json_schema', schema: agentsOutputSchema(nctIds) }, verbosity: 'low' },
    },
    input: canonicalJson({
      minimizedHealthData: true,
      task: AGENTS_TASK,
      profile: { ...profile },
      nctIds: [...nctIds],
      questionTemplates: { ...QUESTION_TEMPLATES },
      cautionIds: [...CAUTION_IDS],
    }),
    stream: true,
  };
}

export function buildToolResult(study: ModelStudy): ToolResult {
  return { public: true, study };
}

/**
 * Builds and validates the exact preview. `studyById` must return the public study object for every
 * NCT ID in the packet; a missing study is RECORD_NOT_IN_SESSION and an invalid one INTERNAL_ERROR.
 * Callers in the core pass projections of held records only (buildRecordPreview).
 */
export function buildPreview(packet: ModelPacket, studyById: (nctId: string) => ModelStudy | undefined): Preview {
  const profile = profileFromPacket(packet);
  const study = (id: string): ModelStudy => {
    const value = studyById(id);
    if (value === undefined) throw new CoreError('RECORD_NOT_IN_SESSION');
    if (!ModelStudySchema.safeParse(value).success || value.id !== id) throw new CoreError('INTERNAL_ERROR');
    return value;
  };
  const agentIds = packet.agentNctIds ?? [];
  const preview = {
    packet,
    delivery: { ...DELIVERY_POLICY },
    decisionsRequests: (packet.scoreNctIds ?? []).map(id => buildDecisionsBody(profile, study(id))),
    agentsRequest: agentIds.length ? buildAgentsBody(profile, agentIds) : null,
    toolResults: agentIds.map(id => buildToolResult(study(id))),
  };
  const parsed = PreviewSchema.safeParse(JSON.parse(JSON.stringify(preview)));
  if (!parsed.success) throw new CoreError('INTERNAL_ERROR');
  return parsed.data;
}

/** Largest n in [0, max] with ok(n), for a predicate that is true at 0 and monotone (true up to some n, false above). */
function largestFitting(max: number, ok: (n: number) => boolean): number {
  let low = 0;
  let high = max;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ok(mid)) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Deterministic projection of one held session record into the model-bound study object.
 *
 * It keeps the publicStudy field set of extension/native/real.mjs (fetchedAt renamed retrievedAt;
 * no contacts, locations, sponsor, investigators, or anything derived from the user's location) and
 * replaces the character slices with UTF-8 byte budgets:
 *   - conditions keep at most the first MAX_MODEL_CONDITIONS entries, unchanged;
 *   - the summary is cut to MAX_MODEL_SUMMARY_BYTES and the criteria to MAX_MODEL_CRITERIA_BYTES
 *     (truncateUtf8 never splits a code point);
 *   - when the serialized object is still above MAX_MODEL_STUDY_BYTES, the criteria and then the
 *     summary are cut further, each to the longest prefix that fits;
 *   - criteriaTruncated is true exactly when the criteria sent are shorter than the record's.
 * If the object cannot fit even with an empty summary and empty criteria (very long title or
 * conditions), the study cannot be sent and the result is PREVIEW_TOO_LARGE. Conditions are never
 * dropped silently to make room, because the model-bound object has no flag that could say so.
 *
 * The output depends only on the record, so the dispatcher can recompute it and compare exactly.
 */
export function projectModelStudy(record: Readonly<StudyRecord>): ModelStudy {
  const make = (summary: string, criteria: string): ModelStudy => ({
    id: record.nctId,
    title: record.title,
    conditions: record.conditions.slice(0, MAX_MODEL_CONDITIONS),
    status: record.status,
    summary,
    criteria,
    criteriaTruncated: criteria !== record.eligibility.criteria || record.truncatedFields.includes('criteria'),
    minimumAge: record.eligibility.minimumAge,
    maximumAge: record.eligibility.maximumAge,
    sex: record.eligibility.sex,
    sourceUrl: `https://clinicaltrials.gov/study/${record.nctId}`,
    retrievedAt: record.retrievedAt,
    lastUpdatePostDate: record.lastUpdatePostDate,
  });
  const fits = (study: ModelStudy): boolean => utf8ByteLength(JSON.stringify(study)) <= MAX_MODEL_STUDY_BYTES;
  const summary = truncateUtf8(record.summary, MAX_MODEL_SUMMARY_BYTES).text;
  const criteria = truncateUtf8(record.eligibility.criteria, MAX_MODEL_CRITERIA_BYTES).text;
  let study = make(summary, criteria);
  if (!fits(study)) {
    const n = largestFitting(utf8ByteLength(criteria), k => fits(make(summary, truncateUtf8(criteria, k).text)));
    study = make(summary, truncateUtf8(criteria, n).text);
  }
  if (!fits(study)) {
    const kept = study.criteria;
    const n = largestFitting(utf8ByteLength(summary), k => fits(make(truncateUtf8(summary, k).text, kept)));
    study = make(truncateUtf8(summary, n).text, kept);
  }
  if (!fits(study)) throw new CoreError('PREVIEW_TOO_LARGE');
  const parsed = ModelStudySchema.safeParse(study);
  if (!parsed.success) throw new CoreError('INTERNAL_ERROR');
  return parsed.data;
}

function packetIds(packet: ModelPacket): string[] {
  return [...new Set([...(packet.scoreNctIds ?? []), ...(packet.agentNctIds ?? [])])];
}

/**
 * The record rules of the payload contract, checked against the session record index:
 * every NCT ID in the packet is a held record, and the condition term equals a conditions or
 * meshTerms entry of a held record. Throws RECORD_NOT_IN_SESSION or CONDITION_TERM_NOT_IN_SESSION.
 */
export function assertPacketInRecords(packet: ModelPacket, records: RecordIndexView): void {
  for (const id of packetIds(packet)) {
    if (!records.has(id)) throw new CoreError('RECORD_NOT_IN_SESSION');
  }
  if (!records.hasConditionTerm(packet.conditionTerm)) throw new CoreError('CONDITION_TERM_NOT_IN_SESSION');
}

/** Builds the exact preview for `packet` from the held records (after assertPacketInRecords). */
export function buildRecordPreview(packetInput: unknown, records: RecordIndexView): Preview {
  const parsed = ModelPacketSchema.safeParse(packetInput);
  if (!parsed.success) throw new CoreError('INVALID_REQUEST');
  const packet = parsed.data;
  assertPacketInRecords(packet, records);
  const studies = new Map<string, ModelStudy>();
  for (const id of packetIds(packet)) studies.set(id, projectModelStudy(records.get(id)!.record));
  return buildPreview(packet, id => studies.get(id));
}

/**
 * Re-derives the preview for the packet inside `previewInput` from the held records and requires
 * exact equality: same packet, same delivery facts, and every Decisions body, the Agents body, and
 * every tool result equal to what buildRecordPreview produces, so each study object is exactly
 * projectModelStudy of its held record. Throws RECORD_NOT_IN_SESSION, CONDITION_TERM_NOT_IN_SESSION,
 * PREVIEW_TOO_LARGE, or INTERNAL_ERROR (any other difference). Returns the validated preview.
 */
export function verifyPreviewAgainstRecords(previewInput: unknown, records: RecordIndexView): Preview {
  const parsed = PreviewSchema.safeParse(previewInput);
  if (!parsed.success) throw new CoreError('INTERNAL_ERROR');
  const expected = buildRecordPreview(parsed.data.packet, records);
  if (!jsonEqual(parsed.data, expected)) throw new CoreError('INTERNAL_ERROR');
  return parsed.data;
}
