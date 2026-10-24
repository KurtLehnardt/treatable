/**
 * The searchTrials pipeline: one live ClinicalTrials.gov search.
 *
 * It is split in two so that the search itself does not depend on where the session keeps records:
 *   - runLiveSearch is pure with respect to the session. It takes the payload, the current search
 *     cursor, and a cancellation signal, fetches at most MAX_SEARCH_PAGES_PER_REQUEST pages, and
 *     returns the validated result plus the next cursor. It writes nothing.
 *   - createSearchTrialsPipeline is the session adapter used by this branch's dispatcher: it reads the
 *     cursor from a session slot, runs the search, and commits the records to the session record set
 *     (pinning/record-set.ts) together with the new subject digest. A dispatcher-owned record index can
 *     replace this adapter and call runLiveSearch directly.
 *
 * Rules:
 * - The request carries only the search terms, the United States, and at most one state (query.ts,
 *   enforced again by the transport guard in transport-seam.ts).
 * - pageToken pagination: the first request asks for countTotal; a later searchTrials may pass only
 *   the nextPageToken this core returned for the same terms and state (the cursor), so a host cannot
 *   send arbitrary tokens, and every later page repeats the first page's parameters as the API
 *   requires. Within one searchTrials, more pages are fetched only to fill pageSize when
 *   ClinicalTrials.gov returns empty or unreadable pages, at most MAX_SEARCH_PAGES_PER_REQUEST.
 * - Every record carries sourceUrl and its own retrievedAt (the clock-port time its page arrived).
 * - Results always have source "live". There is no cache of any kind: records live only in session
 *   memory, and endSession wipes them. A future public cache must be separate, label its results
 *   "public_cache", and keep each record's original retrievedAt.
 * - The adapter commits records only after the whole search succeeded and was not cancelled; the
 *   commit changes the consent subject digest, which clears prepared consent (mutation invalidation).
 *   A failed or cancelled search leaves the record set, the cursor, and consent unchanged.
 */
import { constantTimeEqual } from '../bytes.ts';
import { CoreError } from '../errors.ts';
import { canonicalJson } from '../json.ts';
import type { CancelSignal, Clock, CorePorts } from '../ports.ts';
import {
  ISO_TIMESTAMP_PATTERN,
  MAX_SEARCH_PAGES_PER_REQUEST,
  type OperationResult,
  type RequestPayload,
  type StudyRecord,
} from '../protocol.ts';
import { defineSlot, type Session } from '../session.ts';
import { prepareRecordMerge } from '../pinning/record-set.ts';
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

export interface SearchContext {
  readonly session: Session;
  readonly signal: CancelSignal;
}

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
 * Session adapter: the built-in searchTrials pipeline over the injected ports. One client (and its
 * request pacing) per core. Records and the cursor are committed only after a complete search.
 */
export function createSearchTrialsPipeline(ports: CorePorts, limits?: Partial<CtgovLimits>): SearchTrialsPipeline {
  const client = createCtgovClient({ transport: ports.transport, clock: ports.clock, tokens: ports.tokens }, limits);
  return async (ctx, payload) => {
    const { session, signal } = ctx;
    const outcome = await runLiveSearch(client, ports.clock, payload, signal, session.get(CURSOR_SLOT));
    const commit = await prepareRecordMerge(session, ports.sha256, outcome.result.records);
    if (signal.aborted) throw new CoreError('CANCELLED');
    // Synchronous from here on: the record set, the subject digest, and the cursor change together.
    commit();
    if (outcome.cursor !== undefined) session.set(CURSOR_SLOT, outcome.cursor);
    else session.delete(CURSOR_SLOT);
    return outcome.result;
  };
}
