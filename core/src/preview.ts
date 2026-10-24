/**
 * Deterministic builders for the exact outbound preview.
 *
 * Given a validated packet and the pinned public study objects, these functions produce the exact
 * request bodies that will be sent: one Decisions body per score study, one Agents create body, and
 * one tool result per agent study. All texts are contract constants from protocol.ts, so the bodies
 * depend only on the packet and the studies.
 *
 * projectModelStudy maps a session record (a public ClinicalTrials.gov record as shown to the user)
 * to the model-bound study object. The dispatcher uses it two ways (MAJOR-3 in
 * plan/A1a-critic-1.md): a buildPreview pipeline must produce exactly this projection of a record
 * the session holds, or prepareReal refuses, and the session's consent subject digest covers the
 * whole record set (computeRecordsDigest), so consent cannot survive a record change. The
 * dispatcher's send capability sends exactly these bodies.
 */
import { CoreError } from './errors.ts';
import { isHex64, truncateUtf8, utf8ByteLength, utf8Encode } from './bytes.ts';
import { canonicalJson } from './json.ts';
import type { Sha256 } from './ports.ts';
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
    input: JSON.stringify({
      minimizedHealthData: true,
      task: AGENTS_TASK,
      profile,
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
 * Builds and validates the exact preview. `studyById` must return the pinned public study object for
 * every NCT ID in the packet; a missing or invalid study is RECORD_NOT_IN_SESSION or INTERNAL_ERROR.
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

/**
 * Deterministic projection of one session record into the model-bound study object: the
 * publicStudy field set of extension/native/real.mjs, with fetchedAt renamed retrievedAt and the
 * character slices replaced by byte budgets (truncateUtf8). It always satisfies ModelStudySchema:
 * summary and criteria first fit their own byte budgets, then conditions are dropped from the end,
 * then the criteria and summary budgets shrink by binary search until the whole object fits
 * MAX_MODEL_STUDY_BYTES. The inputs are public study text and reach OpenAI only inside this shape.
 */
export function projectModelStudy(record: StudyRecord): ModelStudy {
  const assemble = (conditions: readonly string[], summaryBudget: number, criteriaBudget: number): ModelStudy => {
    const summary = truncateUtf8(record.summary, summaryBudget);
    const criteria = truncateUtf8(record.eligibility.criteria, criteriaBudget);
    return {
      id: record.nctId,
      title: record.title,
      conditions: [...conditions],
      status: record.status,
      summary: summary.text,
      criteria: criteria.text,
      criteriaTruncated: criteria.truncated,
      minimumAge: record.eligibility.minimumAge,
      maximumAge: record.eligibility.maximumAge,
      sex: record.eligibility.sex,
      sourceUrl: `https://clinicaltrials.gov/study/${record.nctId}`,
      retrievedAt: record.retrievedAt,
      lastUpdatePostDate: record.lastUpdatePostDate,
    };
  };
  let conditions = record.conditions.slice(0, 50);
  let summaryBudget = MAX_MODEL_SUMMARY_BYTES;
  let criteriaBudget = MAX_MODEL_CRITERIA_BYTES;
  let study = assemble(conditions, summaryBudget, criteriaBudget);
  const fits = (): boolean => utf8ByteLength(JSON.stringify(study)) <= MAX_MODEL_STUDY_BYTES;
  const shrink = (apply: (budget: number) => void, budget: number): number => {
    // Largest budget under which the projection still fits; monotone, so binary search finds it.
    let low = 0;
    let high = budget;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      apply(mid);
      if (fits()) low = mid;
      else high = mid - 1;
    }
    apply(low);
    return low;
  };
  while (!fits() && conditions.length > 0) {
    conditions = conditions.slice(0, -1);
    study = assemble(conditions, summaryBudget, criteriaBudget);
  }
  if (!fits()) {
    criteriaBudget = shrink(budget => {
      study = assemble(conditions, summaryBudget, budget);
    }, criteriaBudget);
  }
  if (!fits()) {
    summaryBudget = shrink(budget => {
      study = assemble(conditions, budget, criteriaBudget);
    }, summaryBudget);
  }
  if (!fits()) throw new CoreError('INTERNAL_ERROR');
  if (!ModelStudySchema.safeParse(study).success) throw new CoreError('INTERNAL_ERROR');
  return study;
}

/**
 * SHA-256 (via the port) over the canonical JSON of the record set ordered by NCT ID. The
 * dispatcher pins this digest as the consent subject, so a preparation is usable only while the
 * session holds exactly the records the user reviewed.
 */
export async function computeRecordsDigest(sha256: Sha256, records: readonly StudyRecord[]): Promise<string> {
  const ordered = [...records].sort((a, b) => (a.nctId < b.nctId ? -1 : a.nctId > b.nctId ? 1 : 0));
  const digest = await sha256.digestHex(utf8Encode(canonicalJson(ordered)));
  if (!isHex64(digest)) throw new CoreError('INTERNAL_ERROR');
  return digest;
}
