/**
 * The searchTrials pipeline: one live ClinicalTrials.gov search, merged into the session record set.
 *
 * - The request carries only the search terms, the United States, and at most one state (query.ts).
 * - pageToken pagination: the first request asks for countTotal; a later searchTrials may pass only
 *   the nextPageToken this core returned for the same terms and state in this session (the cursor),
 *   so a host cannot send arbitrary tokens. Within one searchTrials, at most
 *   MAX_SEARCH_PAGES_PER_REQUEST pages are fetched, only to fill pageSize when ClinicalTrials.gov
 *   returns empty or unreadable pages.
 * - Every record carries sourceUrl and its own retrievedAt (the time its page arrived).
 * - Results always have source "live". There is no on-disk cache: records live only in the session
 *   record set in memory, and endSession wipes them.
 * - The records are committed to the session record set only after the whole search succeeded and
 *   was not cancelled; the commit changes the consent subject digest, which clears prepared consent
 *   (mutation invalidation). A failed or cancelled search leaves the record set and consent unchanged.
 */
import { constantTimeEqual } from '../bytes.ts';
import { CoreError } from '../errors.ts';
import { canonicalJson } from '../json.ts';
import type { CorePorts } from '../ports.ts';
import {
  ISO_TIMESTAMP_PATTERN,
  MAX_SEARCH_PAGES_PER_REQUEST,
  type OperationResult,
  type RequestPayload,
  type StudyRecord,
} from '../protocol.ts';
import { defineSlot, type Session } from '../session.ts';
import type { CancelSignal } from '../ports.ts';
import { prepareRecordMerge } from '../pinning/record-set.ts';
import { createCtgovClient, type CtgovClient, type CtgovLimits } from './client.ts';
import { normalizeStudy } from './normalize.ts';
import { CTGOV_OPEN_STATUSES, DEFAULT_SEARCH_PAGE_SIZE } from './query.ts';
import { US_STATE_NAMES } from './states.ts';
import { ctgovTransport } from './transport-seam.ts';

interface SearchCursor {
  /** Canonical JSON of the terms and state the token belongs to. */
  readonly key: string;
  readonly nextPageToken: string;
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

export async function searchLive(
  client: CtgovClient,
  ports: Pick<CorePorts, 'sha256' | 'clock'>,
  ctx: SearchContext,
  payload: RequestPayload<'searchTrials'>,
): Promise<OperationResult<'searchTrials'>> {
  const { session, signal } = ctx;
  const terms = [...payload.conditionTerms];
  const state = payload.state;
  const pageSize = payload.pageSize ?? DEFAULT_SEARCH_PAGE_SIZE;
  const key = canonicalJson({ state: state ?? null, terms });
  if (payload.pageToken !== undefined) {
    const cursor = session.get(CURSOR_SLOT);
    if (!cursor || cursor.key !== key || !constantTimeEqual(cursor.nextPageToken, payload.pageToken)) throw new CoreError('INVALID_REQUEST');
  }
  const deadline = ports.clock.monotonic() + client.limits.searchBudgetMs;
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
  const commit = await prepareRecordMerge(session, ports.sha256, records);
  if (signal.aborted) throw new CoreError('CANCELLED');
  // Synchronous from here on: the record set, the subject digest, and the cursor change together.
  commit();
  if (token !== undefined) session.set(CURSOR_SLOT, { key, nextPageToken: token });
  else session.delete(CURSOR_SLOT);

  return {
    records,
    ...(token !== undefined ? { nextPageToken: token } : {}),
    ...(totalCount !== undefined ? { totalCount } : {}),
    retrievedAt: retrievedAt ?? isoTimestamp(ports.clock.now()),
    source: 'live',
    skippedRecords: skipped,
    query: { conditionTerms: terms, ...(state !== undefined ? { state } : {}), country: 'US' },
  };
}

/** The built-in searchTrials pipeline over the injected ports. One client (and its request pacing) per core. */
export function createSearchTrialsPipeline(ports: CorePorts, limits?: Partial<CtgovLimits>): SearchTrialsPipeline {
  const client = createCtgovClient({ transport: ctgovTransport(ports), clock: ports.clock, tokens: ports.tokens }, limits);
  return (ctx, payload) => searchLive(client, ports, ctx, payload);
}
