/**
 * R4 bounds for real operations (final-plan.md amendment R4), checked by the dispatcher in
 * prepareReal after the preview is built and verified (dispatcher.ts), so no pipeline can change them:
 *   - Agents operations use at most MAX_AGENT_STUDIES (2) studies, as in real-contract.mjs;
 *   - Decisions relevance scoring uses at most MAX_SCORE_STUDIES (10) studies per confirmed
 *     operation, with exactly one pinned request body per study.
 * The packet and preview schemas in protocol.ts reject oversized lists too; these checks restate the
 * bounds on the exact preview that is pinned. At most three Decisions requests in flight, with the one
 * permitted retry inside its slot, is enforced by the send capability (outbound.ts), which also
 * refuses a second send of the same body.
 */
import { CoreError } from './errors.ts';
import {
  MAX_AGENT_STUDIES,
  MAX_SCORE_STUDIES,
  NCT_ID_PATTERN,
  type DecisionsRequestBody,
  type Preview,
} from './protocol.ts';

function uniqueIds(ids: unknown, max: number): ids is readonly string[] {
  return (
    Array.isArray(ids) &&
    ids.length >= 1 &&
    ids.length <= max &&
    ids.every(id => typeof id === 'string' && NCT_ID_PATTERN.test(id)) &&
    new Set(ids).size === ids.length
  );
}

/**
 * Throws INVALID_REQUEST unless the packet asks for 1 to 10 unique score studies and/or 1 to 2
 * unique agent studies, and at least one of the two.
 */
export function assertR4Packet(packet: { readonly scoreNctIds?: readonly string[] | undefined; readonly agentNctIds?: readonly string[] | undefined }): void {
  const score = packet.scoreNctIds;
  const agent = packet.agentNctIds;
  if (score === undefined && agent === undefined) throw new CoreError('INVALID_REQUEST');
  if (score !== undefined && !uniqueIds(score, MAX_SCORE_STUDIES)) throw new CoreError('INVALID_REQUEST');
  if (agent !== undefined && !uniqueIds(agent, MAX_AGENT_STUDIES)) throw new CoreError('INVALID_REQUEST');
}

export interface DecisionsSendEntry {
  readonly index: number;
  readonly nctId: string;
  /** The pinned body, sent unchanged (including on a retry). */
  readonly body: Readonly<DecisionsRequestBody>;
}

/**
 * One Decisions request per scored study, in packet order. Throws INTERNAL_ERROR unless the preview
 * has exactly one body per score study, each naming its study once, and at most ten in total.
 */
export function decisionsSendPlan(preview: Readonly<Preview>): readonly DecisionsSendEntry[] {
  const ids = preview.packet.scoreNctIds ?? [];
  const bodies = preview.decisionsRequests;
  if (ids.length > MAX_SCORE_STUDIES || bodies.length !== ids.length || new Set(ids).size !== ids.length) throw new CoreError('INTERNAL_ERROR');
  return Object.freeze(
    bodies.map((body, index) => {
      const nctId = ids[index]!;
      if (body.questions.length !== 1 || body.questions[0].name !== nctId || body.input[0].content[1].data.study.id !== nctId) {
        throw new CoreError('INTERNAL_ERROR');
      }
      return Object.freeze({ index, nctId, body });
    }),
  );
}

/**
 * Throws INTERNAL_ERROR unless the preview's Agents part covers 1 to 2 studies with one tool result
 * each, or is absent with no tool results.
 */
export function assertAgentsBound(preview: Readonly<Preview>): void {
  const ids = preview.packet.agentNctIds ?? [];
  if (ids.length === 0) {
    if (preview.agentsRequest !== null || preview.toolResults.length !== 0) throw new CoreError('INTERNAL_ERROR');
    return;
  }
  if (ids.length > MAX_AGENT_STUDIES || preview.agentsRequest === null || preview.toolResults.length !== ids.length) {
    throw new CoreError('INTERNAL_ERROR');
  }
  const enumIds = preview.agentsRequest.agent.tools[0].parameters.properties.nctId.enum;
  if (enumIds.length !== ids.length || enumIds.some((id, i) => id !== ids[i])) throw new CoreError('INTERNAL_ERROR');
}

/** All R4 checks on a built preview: packet bounds, one Decisions body per study, Agents bound. */
export function assertR4Preview(preview: Readonly<Preview>): void {
  assertR4Packet(preview.packet);
  decisionsSendPlan(preview);
  assertAgentsBound(preview);
}
