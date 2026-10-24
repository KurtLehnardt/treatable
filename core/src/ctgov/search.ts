/**
 * The searchTrials pipeline: one live ClinicalTrials.gov search.
 *
 * - runLiveSearch takes the payload, the current search cursor, and a cancellation signal, fetches
 *   at most MAX_SEARCH_PAGES_PER_REQUEST pages, and returns the validated result plus the next
 *   cursor. It writes no state.
 * - createSearchTrialsPipeline is the pipeline the dispatcher wires in 'live' mode. It uses the
 *   ClinicalTrials.gov-only transport the dispatcher hands it (ctx.ports.transport), wrapped again in
 *   this module's exact-URL guard (transport-seam.ts), and keeps the cursor in ctx.slots. It never
 *   writes records: the dispatcher validates the response and commits its records to the session
 *   record index (records.ts), so the index holds exactly what the host was shown.
 *
 * Rules:
 * - The request carries only the search terms, the United States, and at most one state (query.ts).
 * - pageToken pagination: a later searchTrials may pass only the nextPageToken this core returned for
 *   the same terms and state (the cursor); every later page repeats the first page's parameters.
 * - Every record carries sourceUrl and its own retrievedAt (the clock-port time its page arrived).
 * - Results always have source "live"; there is no cache.
 * - Condition and MeSH terms on records come only from the ClinicalTrials.gov response
 *   (normalize.ts), never from the search terms.
 */
import { constantTimeEqual } from '../bytes.ts';
import { CoreError } from '../errors.ts';
import { canonicalJson } from '../json.ts';
import type { CancelSignal, Clock } from '../ports.ts';
import type { SearchContext } from '../dispatcher.ts';
import {
  ISO_TIMESTAMP_PATTERN,
  MAX_SEARCH_PAGES_PER_REQUEST,
  type OperationResult,
  type RequestPayload,
  type StudyRecord,
} from '../protocol.ts';
import { defineSlot } from '../session.ts';
import { createCtgovClient, type CtgovClient, type CtgovLimits } from './client.ts';
import { normalizeStudy } from './normalize.ts';
import { CTGOV_OPEN_STATUSES, DEFAULT_SEARCH_PAGE_SIZE } from './query.ts';
import { US_STATE_NAMES } from './states.ts';

/** The page token ClinicalTrials.gov returned last, bound to the terms and state it belongs to. */
export interface SearchCursor {
  /** Canonical JSON of the terms and state the token belongs to. */
  readonly key: string;
  readonly nextPageToken: string;
}

export interface LiveSearchOutcome {
  readonly result: OperationResult<'searchTrials'>;
  /** The cursor to keep for the next page, or undefined when this was the last page. */
  readonly cursor: SearchCursor | undefined;
}

const CURSOR_SLOT = defineSlot<SearchCursor>('ctgov.cursor');

export type SearchTrialsPipeline = (ctx: SearchContext, payload: RequestPayload<'searchTrials'>) => Promise<OperationResult<'searchTrials'>>;

/** ISO 8601 UTC timestamp for a wall-clock time from the clock port. */
export function isoTimestamp(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new CoreError('INTERNAL_ERROR');
  const text = new Date(ms).toISOString();
  if (!ISO_TIMESTAMP_PATTERN.test(text)) throw new CoreError('INTERNAL_ERROR');
  return text;
}

/** The key a page token is bound to: the exact terms (in order) and the state. */
export function searchCursorKey(terms: readonly string[], state: string | undefined): string {
  return canonicalJson({ state: state ?? null, terms: [...terms] });
}

/**
 * Runs one live search. Throws INVALID_REQUEST for a page token that is not the cursor's token for
 * the same terms and state (before any network request), CANCELLED when `signal` fires, and the
 * client's typed errors otherwise. Writes no state.
 */
export async function runLiveSearch(
  client: CtgovClient,
  clock: Pick<Clock, 'now' | 'monotonic'>,
  payload: RequestPayload<'searchTrials'>,
  signal: CancelSignal,
  cursor: SearchCursor | undefined,
): Promise<LiveSearchOutcome> {
  const terms = [...payload.conditionTerms];
  const state = payload.state;
  const pageSize = payload.pageSize ?? DEFAULT_SEARCH_PAGE_SIZE;
  const key = searchCursorKey(terms, state);
  if (payload.pageToken !== undefined) {
    if (!cursor || cursor.key !== key || !constantTimeEqual(cursor.nextPageToken, payload.pageToken)) throw new CoreError('INVALID_REQUEST');
  }
  const start = clock.monotonic();
  if (typeof start !== 'number' || !Number.isFinite(start)) throw new CoreError('INTERNAL_ERROR');
  const deadline = start + client.limits.searchBudgetMs;
  const stateName = state !== undefined ? US_STATE_NAMES[state] : undefined;
  const records: StudyRecord[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let token = payload.pageToken;
  let totalCount: number | undefined;
  let retrievedAt: string | undefined;
  let pages = 0;
  do {
    const page = await client.fetchPage(
      { conditionTerms: terms, state, pageSize: pageSize - records.length, pageToken: token, countTotal: pages === 0 && payload.pageToken === undefined },
      signal,
      deadline,
    );
    pages += 1;
    if (pages === 1 && page.totalCount !== undefined) totalCount = page.totalCount;
    retrievedAt = isoTimestamp(page.receivedAtMs);
    for (const raw of page.studies) {
      const result = normalizeStudy(raw, { retrievedAt, statuses: CTGOV_OPEN_STATUSES, stateName });
      if (!result.ok || seen.has(result.record.nctId)) {
        skipped += 1;
        continue;
      }
      seen.add(result.record.nctId);
      records.push(result.record);
    }
    token = page.nextPageToken;
  } while (token !== undefined && records.length < pageSize && pages < MAX_SEARCH_PAGES_PER_REQUEST);
  if (signal.aborted) throw new CoreError('CANCELLED');

  return {
    result: {
      records,
      ...(token !== undefined ? { nextPageToken: token } : {}),
      ...(totalCount !== undefined ? { totalCount } : {}),
      retrievedAt: retrievedAt ?? isoTimestamp(clock.now()),
      source: 'live',
      skippedRecords: skipped,
      query: { conditionTerms: terms, ...(state !== undefined ? { state } : {}), country: 'US' },
    },
    cursor: token !== undefined ? { key, nextPageToken: token } : undefined,
  };
}

/**
 * The built-in searchTrials pipeline. One client (and its request pacing) per pipeline instance;
 * createCore creates one instance per core. Records are not written here (see the header).
 */
export function createSearchTrialsPipeline(limits?: Partial<CtgovLimits>): SearchTrialsPipeline {
  let client: CtgovClient | undefined;
  let clientPorts: SearchContext['ports'] | undefined;
  return async (ctx, payload) => {
    if (!client || clientPorts !== ctx.ports) {
      client = createCtgovClient({ transport: ctx.ports.transport, clock: ctx.ports.clock, tokens: ctx.ports.tokens }, limits);
      clientPorts = ctx.ports;
    }
    const outcome = await runLiveSearch(client, ctx.ports.clock, payload, ctx.signal, ctx.slots.get(CURSOR_SLOT));
    if (ctx.signal.aborted) throw new CoreError('CANCELLED');
    // The cursor moves only after a complete search; a failed or cancelled one leaves it unchanged.
    if (outcome.cursor !== undefined) ctx.slots.set(CURSOR_SLOT, outcome.cursor);
    else ctx.slots.delete(CURSOR_SLOT);
    return outcome.result;
  };
}
