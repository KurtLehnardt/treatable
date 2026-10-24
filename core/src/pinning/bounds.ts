/**
 * R4 bounds for real operations (final-plan.md amendment R4), as pure, reusable checks:
 *   - Agents operations use at most MAX_AGENT_STUDIES (2) studies, as in real-contract.mjs;
 *   - Decisions relevance scoring uses at most MAX_SCORE_STUDIES (10) studies per confirmed
 *     operation, exactly one request per study, and at most MAX_DECISIONS_CONCURRENCY (3) requests
 *     in flight at a time.
 * The packet and preview schemas in protocol.ts already reject oversized lists; these functions
 * restate the bounds at the points where work is planned and run, so a send path cannot exceed them
 * even with a hand-built plan. decisionsSendPlan yields one entry per scored study, and runBounded
 * runs a worker once per entry with at most three running at once. A retry of one Decisions request
 * happens inside its worker call, so it keeps its slot and counts toward the limit
 * (DELIVERY_POLICY: retries count toward the concurrency limit).
 *
 * Wiring these into the dispatcher-owned send capability is part of the dispatcher reconciliation
 * (A1a critic MAJOR-1); this module has no dependency on the dispatcher.
 */
import { CoreError } from '../errors.ts';
import type { CancelSignal } from '../ports.ts';
import {
  MAX_AGENT_STUDIES,
  MAX_DECISIONS_CONCURRENCY,
  MAX_SCORE_STUDIES,
  NCT_ID_PATTERN,
  type DecisionsRequestBody,
  type Preview,
} from '../protocol.ts';

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

/**
 * Runs `worker` exactly once per item with at most `limit` calls in flight (limit 1 to
 * MAX_DECISIONS_CONCURRENCY) and returns the results in item order. When a worker call rejects or
 * `signal` fires, no further call starts; the calls already running are awaited, and then the first
 * error (or CANCELLED) is thrown. Workers receive the signal and should stop promptly when it fires.
 */
export async function runBounded<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number, signal: CancelSignal) => Promise<R>,
  signal: CancelSignal,
): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_DECISIONS_CONCURRENCY) throw new CoreError('INTERNAL_ERROR');
  if (!Array.isArray(items) || items.length > MAX_SCORE_STUDIES) throw new CoreError('INTERNAL_ERROR');
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let firstError: unknown;
  const lane = async (): Promise<void> => {
    while (!failed && !signal.aborted && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await worker(items[index] as T, index, signal);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  };
  const lanes: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) lanes.push(lane());
  await Promise.all(lanes);
  if (failed) throw firstError instanceof CoreError ? firstError : new CoreError('INTERNAL_ERROR');
  if (signal.aborted) throw new CoreError('CANCELLED');
  return results;
}
