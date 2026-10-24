/**
 * Live ClinicalTrials.gov API v2 client over the injected transport port.
 *
 * Port of fetchPages (scaffold/scripts/lib/ctgov.mjs at commit 48c569e), rebuilt for the shared core:
 *   - requests are built only by query.ts and checked by assertCtgovRequest before the port is called;
 *   - requests are paced (at least minIntervalMs between request starts from one core) because the
 *     public API is rate limited; ClinicalTrials.gov does not state the limit in its OpenAPI
 *     description, and third-party reports put it near 50 requests per minute per address;
 *   - 429 and 503 honor Retry-After (seconds or an HTTP date); 429, 500, 502, 503, 504, timeouts, and
 *     network failures are retried with exponential backoff plus jitter from the token port, at most
 *     maxAttempts times, never past the search deadline, and never when Retry-After asks for more than
 *     maxRetryAfterMs; a retry resends the identical URL (it contains no more than the first request);
 *   - each attempt has a timeout from the clock port, and the response body is read with a hard byte
 *     cap, strict UTF-8 decoding, a nesting-depth check, and JSON parsing;
 *   - the page envelope is validated (studies array no longer than requested, page token pattern,
 *     total count range); individual studies are validated later by normalize.ts.
 * Errors are constant CoreError codes; response bodies and headers are never logged or echoed.
 */
import { createCancelSource } from '../cancel.ts';
import { readBounded, utf8Decode } from '../bytes.ts';
import { CoreError, isCoreError, type ErrorCode } from '../errors.ts';
import type { CancelSignal, Clock, TokenSource, Transport, TransportRequest, TransportResponse } from '../ports.ts';
import { PAGE_TOKEN_PATTERN } from '../protocol.ts';
import { buildStudiesUrl, type StudiesQuery } from './query.ts';
import { CTGOV_REQUEST_HEADERS, assertCtgovRequest } from './transport-seam.ts';

export interface CtgovLimits {
  /** Attempts per page, including the first. */
  readonly maxAttempts: number;
  /** Time allowed for one attempt, from sending the request to the end of the body. */
  readonly attemptTimeoutMs: number;
  /** Minimum time between the starts of two requests from one client. */
  readonly minIntervalMs: number;
  /** A Retry-After longer than this ends the search with RATE_LIMITED or API_ERROR instead of waiting. */
  readonly maxRetryAfterMs: number;
  readonly baseBackoffMs: number;
  readonly maxJitterMs: number;
  /** Total time one searchTrials request may take, including every page, wait, and retry. */
  readonly searchBudgetMs: number;
  readonly maxResponseBytes: number;
  readonly maxJsonDepth: number;
}

export const CTGOV_LIMITS: CtgovLimits = Object.freeze({
  maxAttempts: 3,
  attemptTimeoutMs: 20_000,
  minIntervalMs: 1_250,
  maxRetryAfterMs: 10_000,
  baseBackoffMs: 1_000,
  maxJitterMs: 500,
  searchBudgetMs: 60_000,
  maxResponseBytes: 8 * 1024 * 1024,
  maxJsonDepth: 32,
});

export interface CtgovPage {
  readonly studies: readonly unknown[];
  readonly nextPageToken?: string;
  readonly totalCount?: number;
  /** Wall-clock milliseconds when the body was completely received (becomes retrievedAt). */
  readonly receivedAtMs: number;
}

export interface CtgovClient {
  readonly limits: CtgovLimits;
  fetchPage(query: StudiesQuery, signal: CancelSignal, deadlineMonotonic: number): Promise<CtgovPage>;
}

export interface CtgovClientDeps {
  readonly transport: Transport;
  readonly clock: Clock;
  readonly tokens: TokenSource;
}

/** Tests may lower limits (for example to avoid real waits); no limit can be raised above the defaults. */
function resolveLimits(overrides: Partial<CtgovLimits> = {}): CtgovLimits {
  const out: Record<string, number> = { ...CTGOV_LIMITS };
  for (const [key, value] of Object.entries(overrides)) {
    const max = (CTGOV_LIMITS as unknown as Record<string, number>)[key];
    const min = key === 'maxAttempts' || key === 'maxJsonDepth' || key === 'maxResponseBytes' || key === 'attemptTimeoutMs' ? 1 : 0;
    if (max === undefined || typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new CoreError('INTERNAL_ERROR');
    }
    out[key] = value;
  }
  return Object.freeze(out) as unknown as CtgovLimits;
}

/** Waits `ms` through the clock port; rejects with CANCELLED as soon as `signal` fires. */
export function sleep(clock: Clock, ms: number, signal: CancelSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CoreError('CANCELLED'));
      return;
    }
    let cancelTimer: (() => void) | undefined;
    const onAbort = (): void => {
      cancelTimer?.();
      reject(new CoreError('CANCELLED'));
    };
    cancelTimer = clock.schedule(Math.max(0, ms), () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
    signal.addEventListener('abort', onAbort);
  });
}

/** Settles with `promise`, or rejects with CANCELLED when `signal` fires first. */
function raceAbort<T>(promise: Promise<T>, signal: CancelSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new CoreError('CANCELLED'));
    signal.addEventListener('abort', onAbort);
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Retry-After as milliseconds from now: delta seconds or an HTTP date. Undefined when absent or invalid. */
export function parseRetryAfter(value: string | undefined, nowMs: number): number | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (/^\d{1,7}$/.test(text)) return Number(text) * 1000;
  if (text.length > 64 || !/^[A-Za-z0-9 ,:-]+$/.test(text)) return undefined;
  const at = Date.parse(text);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, at - nowMs);
}

/** True when the JSON text never nests objects or arrays deeper than `maxDepth` (checked before JSON.parse). */
export function withinJsonDepth(text: string, maxDepth: number): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i += 1;
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) inString = true;
    else if (c === 0x7b || c === 0x5b) {
      depth += 1;
      if (depth > maxDepth) return false;
    } else if (c === 0x7d || c === 0x5d) depth -= 1;
  }
  return true;
}

function headerOf(response: TransportResponse, name: string): string | undefined {
  const headers = response.headers;
  if (typeof headers !== 'object' || headers === null) return undefined;
  const value = (headers as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

/** Releases an unread streaming body so the transport can close the connection. */
function discardBody(response: TransportResponse): void {
  const body = response.body as unknown;
  if (typeof body === 'object' && body !== null && typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    try {
      const iterator = (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
      void iterator.return?.()?.catch?.(() => {});
    } catch {
      // Nothing else to release.
    }
  }
}

function parsePage(bytes: Uint8Array, requestedSize: number, limits: CtgovLimits): Omit<CtgovPage, 'receivedAtMs'> {
  let text: string;
  try {
    text = utf8Decode(bytes);
  } catch {
    throw new CoreError('INVALID_API_RESPONSE');
  }
  if (!withinJsonDepth(text, limits.maxJsonDepth)) throw new CoreError('INVALID_API_RESPONSE');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CoreError('INVALID_API_RESPONSE');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CoreError('INVALID_API_RESPONSE');
  const envelope = value as Record<string, unknown>;
  const studies = envelope.studies;
  if (!Array.isArray(studies) || studies.length > requestedSize) throw new CoreError('INVALID_API_RESPONSE');
  const token = envelope.nextPageToken;
  if (token !== undefined && (typeof token !== 'string' || !PAGE_TOKEN_PATTERN.test(token))) throw new CoreError('INVALID_API_RESPONSE');
  const total = envelope.totalCount;
  if (total !== undefined && (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0 || total > 10_000_000)) {
    throw new CoreError('INVALID_API_RESPONSE');
  }
  return {
    studies,
    ...(token !== undefined ? { nextPageToken: token } : {}),
    ...(total !== undefined ? { totalCount: total } : {}),
  };
}

type AttemptOutcome =
  | { readonly ok: true; readonly page: CtgovPage }
  | { readonly ok: false; readonly code: ErrorCode; readonly retryable: boolean; readonly retryAfterMs?: number | undefined };

export function createCtgovClient(deps: CtgovClientDeps, overrides?: Partial<CtgovLimits>): CtgovClient {
  const limits = resolveLimits(overrides);
  const { transport, clock, tokens } = deps;
  let lastStart: number | undefined;

  function monotonic(): number {
    const value = clock.monotonic();
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new CoreError('INTERNAL_ERROR');
    return value;
  }

  async function jitterMs(): Promise<number> {
    if (limits.maxJitterMs === 0) return 0;
    const bytes = await tokens.randomBytes(2);
    if (!(bytes instanceof Uint8Array) || bytes.length !== 2) throw new CoreError('INTERNAL_ERROR');
    return ((bytes[0]! << 8) | bytes[1]!) % limits.maxJitterMs;
  }

  async function attempt(request: TransportRequest, requestedSize: number, signal: CancelSignal): Promise<AttemptOutcome> {
    const attemptSource = createCancelSource();
    let timedOut = false;
    const onAbort = (): void => attemptSource.cancel();
    signal.addEventListener('abort', onAbort);
    const cancelTimer = clock.schedule(limits.attemptTimeoutMs, () => {
      timedOut = true;
      attemptSource.cancel();
    });
    const failure = (error: unknown): AttemptOutcome => {
      if (signal.aborted) throw new CoreError('CANCELLED');
      if (isCoreError(error) && error.code === 'OUTPUT_TOO_LARGE') return { ok: false, code: 'OUTPUT_TOO_LARGE', retryable: false };
      if (isCoreError(error) && error.code === 'INVALID_API_RESPONSE' && !timedOut) return { ok: false, code: 'INVALID_API_RESPONSE', retryable: false };
      return { ok: false, code: 'NETWORK_ERROR', retryable: true };
    };
    try {
      let response: TransportResponse;
      try {
        response = await raceAbort(Promise.resolve().then(() => transport.request({ ...request, signal: attemptSource.signal })), attemptSource.signal);
      } catch (error) {
        return failure(error);
      }
      if (typeof response !== 'object' || response === null || !Number.isInteger(response.status)) {
        return { ok: false, code: 'INVALID_API_RESPONSE', retryable: false };
      }
      const status = response.status;
      if (status !== 200) {
        discardBody(response);
        const retryAfterMs = parseRetryAfter(headerOf(response, 'retry-after'), clock.now());
        if (status === 429) return { ok: false, code: 'RATE_LIMITED', retryable: true, retryAfterMs };
        if (status === 503) return { ok: false, code: 'API_ERROR', retryable: true, retryAfterMs };
        if (status === 500 || status === 502 || status === 504) return { ok: false, code: 'API_ERROR', retryable: true };
        return { ok: false, code: 'API_ERROR', retryable: false };
      }
      const contentType = headerOf(response, 'content-type');
      if (contentType === undefined || !/^application\/json\b/i.test(contentType.trim())) {
        discardBody(response);
        return { ok: false, code: 'INVALID_API_RESPONSE', retryable: false };
      }
      let bytes: Uint8Array;
      try {
        bytes = await raceAbort(readBounded(response.body, limits.maxResponseBytes, attemptSource.signal), attemptSource.signal);
      } catch (error) {
        discardBody(response);
        return failure(error);
      }
      const page = parsePage(bytes, requestedSize, limits);
      const receivedAtMs = clock.now();
      if (typeof receivedAtMs !== 'number' || !Number.isSafeInteger(receivedAtMs) || receivedAtMs < 0) throw new CoreError('INTERNAL_ERROR');
      return { ok: true, page: { ...page, receivedAtMs } };
    } catch (error) {
      if (signal.aborted) throw new CoreError('CANCELLED');
      if (isCoreError(error)) return { ok: false, code: error.code, retryable: false };
      return { ok: false, code: 'INVALID_API_RESPONSE', retryable: false };
    } finally {
      signal.removeEventListener('abort', onAbort);
      try {
        cancelTimer();
      } catch {
        // The attempt is over either way.
      }
    }
  }

  async function fetchPage(query: StudiesQuery, signal: CancelSignal, deadline: number): Promise<CtgovPage> {
    const request: TransportRequest = { method: 'GET', url: buildStudiesUrl(query), headers: { ...CTGOV_REQUEST_HEADERS } };
    assertCtgovRequest(request);
    let lastCode: ErrorCode = 'NETWORK_ERROR';
    for (let n = 1; n <= limits.maxAttempts; n += 1) {
      if (signal.aborted) throw new CoreError('CANCELLED');
      if (lastStart !== undefined) {
        const wait = lastStart + limits.minIntervalMs - monotonic();
        if (wait > 0) {
          if (monotonic() + wait > deadline) throw new CoreError(n === 1 ? 'RATE_LIMITED' : lastCode);
          await sleep(clock, wait, signal);
        }
      }
      lastStart = monotonic();
      const outcome = await attempt(request, query.pageSize, signal);
      if (outcome.ok) return outcome.page;
      lastCode = outcome.code;
      if (!outcome.retryable || n === limits.maxAttempts) break;
      if (outcome.retryAfterMs !== undefined && outcome.retryAfterMs > limits.maxRetryAfterMs) break;
      const wait = (outcome.retryAfterMs ?? limits.baseBackoffMs * 2 ** (n - 1)) + (await jitterMs());
      if (monotonic() + wait > deadline) break;
      await sleep(clock, wait, signal);
    }
    throw new CoreError(lastCode);
  }

  return { limits, fetchPage };
}
