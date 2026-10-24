/**
 * Deterministic builders for the exact outbound preview.
 *
 * Given a validated packet and the pinned public study objects, these functions produce the exact
 * request bodies that will be sent: one Decisions body per score study, one Agents create body, and
 * one tool result per agent study. All texts are contract constants from protocol.ts, so the bodies
 * depend only on the packet and the studies. Task A2 supplies the studies (mapped from the session's
 * live records, shortened by bytes with truncateUtf8), and task A4 sends exactly these bodies.
 */
import { CoreError } from './errors.ts';
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
