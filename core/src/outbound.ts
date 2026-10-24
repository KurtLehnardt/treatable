/**
 * The only way a real-data pipeline can reach OpenAI: a dispatcher-owned send capability.
 *
 * An executeReal pipeline (task A4) never receives the transport port, the other ports, the
 * session, or the credential. It receives an OpenAISender whose send() takes a reference to a
 * consented body, never bytes, a URL, or headers:
 *   { kind: 'decisions', index }                              POST /v1/decisions
 *   { kind: 'agentsCreate' }                                  POST /v1/agents/sessions (stream)
 *   { kind: 'toolResult', index, sessionId, turnId, callId }  POST /v1/agents/sessions/{id}/events
 *   { kind: 'agentsRetrieve', sessionId }                     GET /v1/agents/sessions/{id}
 *   { kind: 'agentsCancel', sessionId }                       POST /v1/agents/sessions/{id}/events
 *   { kind: 'agentsDelete', sessionId }                       DELETE /v1/agents/sessions/{id}
 * These are exactly the method and path pairs of docs/apps/openai-contracts.md section 10.1.
 *
 * What the capability enforces, independently of the pipeline:
 *   - Exact bytes. The bytes of every data-bearing request are the canonical serialization
 *     (canonicalJson) of the deep-frozen consented preview: a Decisions body, the Agents create
 *     body, or, for a tool result, the event envelope around the canonical serialization of the
 *     consented tool result object. At preparation the dispatcher pins the SHA-256 of each of these
 *     byte strings (computeRequestPins), and the consent digest covers the pins. Immediately before
 *     every send, the capability serializes the frozen body again, hashes it through the port, and
 *     sends only if the hash equals the pin. The envelope adds only fixed text and the turn and call
 *     IDs, which must have appeared in a provider response of this operation.
 *   - Fixed URLs and headers. URLs are built here from constants; a session ID is accepted only if
 *     it matches PROVIDER_ID_PATTERN, appeared as a JSON string in an Agents response that this
 *     operation received, and equals the first session ID used, so a pipeline cannot place its own
 *     text in a path. Authorization is added here from the credential the dispatcher obtained; the
 *     credential is held only in this closure and is dropped by close(). OpenAI-Beta: agents=v1 is
 *     sent on every Agents path and never on /v1/decisions.
 *   - Delivery policy (DELIVERY_POLICY, shown in every preview). Each Decisions body is sent through
 *     one send() call; the capability itself makes the single permitted second attempt, with the
 *     same bytes, after a temporary rate limit (429 without a quota or billing code), 500, or 503,
 *     honoring Retry-After up to MAX_RETRY_AFTER_MS, and holds one of the three Decisions
 *     concurrency slots for the whole time, wait included. The Agents create body is sent once. Each
 *     tool call (turn ID and call ID pair) may receive its consented tool result at most twice, at
 *     most MAX_AGENT_TOOL_CALLS calls per operation. Cleanup requests carry no user data and have
 *     their own small limits.
 *   - Operation scope. Decisions bodies only for a confirmed score operation, Agents requests only
 *     for a confirmed agent operation. Data-bearing sends stop when the operation is aborted
 *     (consent cleared, cancel, endSession, expiry). Cleanup requests (cancel, retrieve, delete) are
 *     still allowed after an abort, so an Agents session can be cleaned up, for at most
 *     ABORT_CLEANUP_GRACE_MS; then the capability closes itself. After close() nothing can be sent,
 *     and the credential is dropped.
 *   - Fail closed. A malformed or out-of-policy reference is refused before anything reaches the
 *     transport, and the refusal is recorded as a violation: the dispatcher then fails the whole
 *     operation even if the pipeline catches the error, and further data-bearing sends are refused.
 *
 * What it does not decide: how responses are parsed, which tool result answers which call, when to
 * cancel or delete, and how results are mapped. Those belong to the provider pipeline (task A4).
 * The pipeline still controls the order and timing of the sends it is allowed to make.
 */
import { constantTimeEqual, isHex64, readBounded, utf8Decode, utf8Encode } from './bytes.ts';
import { createCancelSource, type CancelSource } from './cancel.ts';
import type { ConsentOperation } from './consent/policy.ts';
import type { ConsentPins } from './consent/store.ts';
import { CoreError, isCoreError } from './errors.ts';
import { canonicalJson, isJsonObject, type JsonObject } from './json.ts';
import type { CancelSignal, Clock, HttpMethod, Sha256, TokenSource, Transport, TransportResponse } from './ports.ts';
import {
  API_KEY_PATTERN,
  DELIVERY_POLICY,
  MAX_AGENT_TOOL_CALLS,
  MAX_OUTBOUND_BODY_BYTES,
  PROVIDER_ID_PATTERN,
  type Preview,
} from './protocol.ts';

// ---------------------------------------------------------------------------------------------
// Endpoints and fixed limits
// ---------------------------------------------------------------------------------------------

export const OPENAI_ORIGIN = 'https://api.openai.com';
export const DECISIONS_PATH = '/v1/decisions';
export const AGENTS_SESSIONS_PATH = '/v1/agents/sessions';
/** Value of the OpenAI-Beta header on every /v1/agents/ path, never on /v1/decisions. */
export const AGENTS_BETA_HEADER_VALUE = 'agents=v1';

const SESSION_SEGMENT = '[A-Za-z0-9_-]{1,160}';
/** The exact method and path pairs the core may request (docs/apps/openai-contracts.md section 10.1). */
const ALLOWED_REQUESTS: readonly { readonly method: HttpMethod; readonly path: RegExp }[] = [
  { method: 'POST', path: /^\/v1\/decisions$/ },
  { method: 'POST', path: /^\/v1\/agents\/sessions$/ },
  { method: 'GET', path: new RegExp(`^/v1/agents/sessions/${SESSION_SEGMENT}$`) },
  { method: 'POST', path: new RegExp(`^/v1/agents/sessions/${SESSION_SEGMENT}/events$`) },
  { method: 'DELETE', path: new RegExp(`^/v1/agents/sessions/${SESSION_SEGMENT}$`) },
];

/** True only for the five allowlisted method and path pairs. */
export function isAllowedOpenAIRequest(method: string, path: string): boolean {
  return ALLOWED_REQUESTS.some(rule => rule.method === method && rule.path.test(path));
}

/** JSON response bodies (and error bodies) are read up to this many bytes. */
export const MAX_JSON_RESPONSE_BYTES = 1024 * 1024;
/** The Agents create stream is read up to this many bytes in total. */
export const MAX_STREAM_RESPONSE_BYTES = 1024 * 1024;
/** Agents response bytes kept for the provider-ID provenance check. */
export const MAX_OBSERVED_PROVIDER_BYTES = 2 * 1024 * 1024;
/** A Retry-After above this is not waited for: the Decisions request is not retried. */
export const MAX_RETRY_AFTER_MS = 8_000;
/** Retry delay when Retry-After is missing or invalid (exponential backoff with one step). */
export const BASE_RETRY_DELAY_MS = 1_000;
/** Random jitter added to every retry delay (0 to this many milliseconds). */
export const MAX_RETRY_JITTER_MS = 255;
/** Longest delay a pipeline may request through wait(). */
export const MAX_PIPELINE_WAIT_MS = 5_000;
/**
 * After the operation is aborted, cleanup requests stay possible for this long; then the capability
 * closes itself (cancelling its requests and dropping the credential) even if the pipeline never
 * returns. The extension's helper gave cleanup a 5.5 second budget and exited 6 seconds after a
 * shutdown request.
 */
export const ABORT_CLEANUP_GRACE_MS = 10_000;
/** Per-request time limits; the Agents create limit covers the whole stream. */
export const SEND_TIMEOUT_MS = Object.freeze({
  decisions: 25_000,
  agentsCreate: 90_000,
  toolResult: 15_000,
  agentsRetrieve: 5_000,
  agentsCancel: 2_000,
  agentsDelete: 3_000,
} as const);
/** Cleanup requests carry no user data; they are still bounded. */
export const AGENTS_CLEANUP_LIMITS = Object.freeze({
  agentsRetrieve: MAX_AGENT_TOOL_CALLS + 2,
  agentsCancel: 2,
  agentsDelete: 2,
} as const);
/**
 * 429 error codes that need user action (docs/apps/openai-contracts.md section 10.6); a Decisions
 * request is never retried after one of them, nor after error.type insufficient_quota.
 */
export const NON_RETRYABLE_429_CODES: readonly string[] = Object.freeze([
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'usage_limit_exceeded',
]);
/** The cancel event body (fixed; carries no user data). */
export const AGENTS_CANCEL_BODY = '{"events":[{"type":"agent.session.input.cancel"}]}';

// ---------------------------------------------------------------------------------------------
// Exact bytes and pins
// ---------------------------------------------------------------------------------------------

/** The exact text sent for Decisions body `index` of `preview`. */
export function decisionsRequestText(preview: Readonly<Preview>, index: number): string {
  const body = preview.decisionsRequests[index];
  if (body === undefined) throw new CoreError('INTERNAL_ERROR');
  return canonicalJson(body);
}

/** The exact text sent for the Agents create body, or undefined when the preview has none. */
export function agentsCreateText(preview: Readonly<Preview>): string | undefined {
  return preview.agentsRequest === null ? undefined : canonicalJson(preview.agentsRequest);
}

/** The exact `output` string of tool result `index` (the canonical serialization of the consented tool result object). */
export function toolResultOutputText(preview: Readonly<Preview>, index: number): string {
  const result = preview.toolResults[index];
  if (result === undefined) throw new CoreError('INTERNAL_ERROR');
  return canonicalJson(result);
}

/** The exact tool result event text: fixed fields, the provider's IDs, and the pinned output string. */
export function toolResultEventText(output: string, turnId: string, callId: string): string {
  return canonicalJson({
    events: [{ call_id: callId, output, success: true, turn_id: turnId, type: 'agent.session.input.tool_result' }],
  });
}

async function sha256Hex(sha256: Sha256, bytes: Uint8Array): Promise<string> {
  const digest = await sha256.digestHex(bytes);
  if (!isHex64(digest)) throw new CoreError('INTERNAL_ERROR');
  return digest;
}

/**
 * SHA-256 of every byte string a preparation may put on the wire: each Decisions body, the Agents
 * create body, and each tool result output string. The dispatcher computes these at preparation;
 * the consent store pins them and the consent digest covers them.
 */
export async function computeRequestPins(sha256: Sha256, preview: Readonly<Preview>): Promise<ConsentPins> {
  const decisionsRequests: string[] = [];
  for (let i = 0; i < preview.decisionsRequests.length; i += 1) {
    const bytes = utf8Encode(decisionsRequestText(preview, i));
    if (bytes.length > MAX_OUTBOUND_BODY_BYTES) throw new CoreError('PREVIEW_TOO_LARGE');
    decisionsRequests.push(await sha256Hex(sha256, bytes));
  }
  const createText = agentsCreateText(preview);
  let agentsCreate: string | null = null;
  if (createText !== undefined) {
    const bytes = utf8Encode(createText);
    if (bytes.length > MAX_OUTBOUND_BODY_BYTES) throw new CoreError('PREVIEW_TOO_LARGE');
    agentsCreate = await sha256Hex(sha256, bytes);
  }
  const toolResults: string[] = [];
  for (let i = 0; i < preview.toolResults.length; i += 1) {
    toolResults.push(await sha256Hex(sha256, utf8Encode(toolResultOutputText(preview, i))));
  }
  return { decisionsRequests, agentsCreate, toolResults };
}

// ---------------------------------------------------------------------------------------------
// The capability
// ---------------------------------------------------------------------------------------------

export type OpenAIRequestRef =
  | { readonly kind: 'decisions'; readonly index: number }
  | { readonly kind: 'agentsCreate' }
  | { readonly kind: 'toolResult'; readonly index: number; readonly sessionId: string; readonly turnId: string; readonly callId: string }
  | { readonly kind: 'agentsRetrieve'; readonly sessionId: string }
  | { readonly kind: 'agentsCancel'; readonly sessionId: string }
  | { readonly kind: 'agentsDelete'; readonly sessionId: string };

export interface OpenAIResponse {
  /** HTTP status. Non-2xx statuses are returned, not thrown. */
  readonly status: number;
  /** 1, or 2 when the capability retried a Decisions request. */
  readonly attempt: number;
  readonly contentType: string | undefined;
  readonly retryAfter: string | undefined;
  readonly requestId: string | undefined;
  /** A bounded byte array, or for a successful Agents create a bounded stream of chunks. */
  readonly body: Uint8Array | AsyncIterable<Uint8Array>;
}

export interface OpenAISender {
  send(ref: OpenAIRequestRef): Promise<OpenAIResponse>;
  /** Waits `ms` milliseconds (0 to MAX_PIPELINE_WAIT_MS) through the clock port. */
  wait(ms: number): Promise<void>;
}

/** What actually happened, for the dispatcher's result checks. */
export interface SenderRecord {
  /** A refused reference was attempted; the dispatcher fails the operation. */
  readonly violation: boolean;
  /** Decisions indexes whose final response had a 2xx status. */
  readonly decisionsAnswered: readonly number[];
  /** The Agents create request got a 2xx status. */
  readonly agentsCreated: boolean;
  /** Distinct tool calls whose tool result got a 2xx status. */
  readonly toolResultsAccepted: number;
  /** DELETE of the operation's session returned 2xx with a valid acknowledgement. */
  readonly sessionDeleted: boolean;
}

export interface SenderOptions {
  readonly transport: Transport;
  readonly sha256: Sha256;
  readonly clock: Clock;
  readonly tokens: TokenSource;
  readonly operation: ConsentOperation;
  /** The deep-frozen consented preview. */
  readonly preview: Readonly<Preview>;
  readonly pins: ConsentPins;
  readonly apiKey: string;
  /** Aborts when the operation is aborted (consent cleared, cancel, endSession, expiry). */
  readonly signal: CancelSignal;
}

export interface SenderHandle {
  /** The frozen capability handed to the pipeline. */
  readonly capability: OpenAISender;
  record(): SenderRecord;
  /** Ends the operation: cancels every request still running, refuses later sends, drops the credential. */
  close(): void;
}

const REF_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  decisions: ['index', 'kind'],
  agentsCreate: ['kind'],
  toolResult: ['callId', 'index', 'kind', 'sessionId', 'turnId'],
  agentsRetrieve: ['kind', 'sessionId'],
  agentsCancel: ['kind', 'sessionId'],
  agentsDelete: ['kind', 'sessionId'],
});

type RefKind = OpenAIRequestRef['kind'];

/** Refusal raised for a malformed or out-of-policy reference. */
class Refusal extends CoreError {}

function refuse(code: 'INVALID_REQUEST' | 'INVALID_ENDPOINT' | 'INTERNAL_ERROR' = 'INVALID_REQUEST'): never {
  throw new Refusal(code);
}

/** Copies a reference into plain locals; only plain data properties with exactly the expected keys pass. */
function parseRef(input: unknown): Record<string, string | number> & { kind: RefKind } {
  if (!isJsonObject(input, 2)) refuse();
  const kind = input.kind;
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(REF_KEYS, kind)) refuse();
  const expected = REF_KEYS[kind]!;
  const keys = Object.keys(input).sort();
  if (keys.length !== expected.length || keys.some((key, i) => key !== expected[i])) refuse();
  const copy: Record<string, string | number> = {};
  for (const key of keys) {
    const value = input[key];
    if (typeof value !== 'string' && typeof value !== 'number') refuse();
    copy[key] = value;
  }
  return copy as Record<string, string | number> & { kind: RefKind };
}

function indexIn(value: unknown, length: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= length) refuse();
  return value;
}

function providerId(value: unknown): string {
  if (typeof value !== 'string' || !PROVIDER_ID_PATTERN.test(value)) refuse('INVALID_ENDPOINT');
  return value;
}

function headerText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return undefined;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return undefined;
  }
  return value;
}

/** Bytes as a string of code units 0 to 255, so ASCII byte sequences can be searched exactly. */
function byteString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as unknown as number[]);
  }
  return out;
}

interface LiveRequest {
  readonly signal: CancelSignal;
  readonly source: CancelSource;
  timedOut: boolean;
  done(): void;
}

export function createOpenAISender(options: SenderOptions): SenderHandle {
  const { transport, sha256, clock, tokens, operation, preview, pins, signal: operationSignal } = options;
  let apiKey: string | undefined = options.apiKey;
  if (typeof apiKey !== 'string' || !API_KEY_PATTERN.test(apiKey)) throw new CoreError('CREDENTIAL_UNAVAILABLE');
  if (preview.decisionsRequests.length !== pins.decisionsRequests.length || preview.toolResults.length !== pins.toolResults.length) {
    throw new CoreError('INTERNAL_ERROR');
  }
  if ((preview.agentsRequest === null) !== (pins.agentsCreate === null)) throw new CoreError('INTERNAL_ERROR');

  let closed = false;
  let violation = false;
  const live = new Set<LiveRequest>();
  const waiters = new Set<() => void>();

  // Decisions bookkeeping and the concurrency limit (slots are held across a retry wait).
  const decisionsStarted = new Set<number>();
  const decisionsAnswered = new Set<number>();
  let decisionsActive = 0;
  const decisionsQueue: { grant: () => void; deny: () => void }[] = [];

  // Agents bookkeeping.
  let agentsCreateSent = false;
  let agentsCreated = false;
  let sessionId: string | undefined;
  let sessionDeleted = false;
  const toolCalls = new Map<string, { index: number; attempts: number }>();
  const toolCallsAccepted = new Set<string>();
  const cleanupCounts: Record<'agentsRetrieve' | 'agentsCancel' | 'agentsDelete', number> = {
    agentsRetrieve: 0,
    agentsCancel: 0,
    agentsDelete: 0,
  };
  let observed = '';
  let observedFull = false;

  function observe(bytes: Uint8Array): void {
    if (observedFull) return;
    if (observed.length + bytes.length > MAX_OBSERVED_PROVIDER_BYTES) {
      observedFull = true;
      return;
    }
    observed += byteString(bytes);
  }

  /** True when `id` appeared as a complete JSON string in an Agents response of this operation. */
  function wasObserved(id: string): boolean {
    return observed.includes(`"${id}"`);
  }

  function assertOpen(dataBearing: boolean): void {
    if (closed) throw new CoreError('CANCELLED');
    if (dataBearing && operationSignal.aborted) throw new CoreError('CANCELLED');
    if (dataBearing && violation) refuse('INTERNAL_ERROR');
  }

  function liveRequest(timeoutMs: number, linkToOperation: boolean): LiveRequest {
    const source = createCancelSource();
    const onAbort = (): void => source.cancel();
    let cancelTimer: (() => void) | undefined;
    const request: LiveRequest = {
      signal: source.signal,
      source,
      timedOut: false,
      done() {
        if (!live.delete(request)) return;
        try {
          cancelTimer?.();
        } catch {
          // A failing timer port cannot keep the request alive; it is already finished.
        }
        if (linkToOperation) operationSignal.removeEventListener('abort', onAbort);
      },
    };
    live.add(request);
    cancelTimer = clock.schedule(timeoutMs, () => {
      request.timedOut = true;
      source.cancel();
    });
    if (linkToOperation) operationSignal.addEventListener('abort', onAbort);
    return request;
  }

  function failure(error: unknown, request: LiveRequest, linkToOperation: boolean): CoreError {
    if (closed || (linkToOperation && operationSignal.aborted)) return new CoreError('CANCELLED');
    if (request.timedOut) return new CoreError('NETWORK_ERROR');
    if (isCoreError(error)) return error;
    return new CoreError('NETWORK_ERROR');
  }

  async function* boundedStream(
    body: Uint8Array | AsyncIterable<Uint8Array>,
    request: LiveRequest,
  ): AsyncGenerator<Uint8Array, void, undefined> {
    let finished = false;
    try {
      if (body instanceof Uint8Array) {
        if (body.length > MAX_STREAM_RESPONSE_BYTES) throw new CoreError('OUTPUT_TOO_LARGE');
        const copy = new Uint8Array(body);
        observe(copy);
        yield copy;
        finished = true;
        return;
      }
      let total = 0;
      for await (const chunk of body) {
        if (request.signal.aborted) throw failure(undefined, request, true);
        if (!(chunk instanceof Uint8Array)) throw new CoreError('INVALID_API_RESPONSE');
        total += chunk.length;
        if (total > MAX_STREAM_RESPONSE_BYTES) throw new CoreError('OUTPUT_TOO_LARGE');
        const copy = new Uint8Array(chunk);
        observe(copy);
        yield copy;
      }
      if (request.signal.aborted) throw failure(undefined, request, true);
      finished = true;
    } catch (error) {
      throw failure(error, request, true);
    } finally {
      // A pipeline that stops reading early ends the underlying request.
      if (!finished) request.source.cancel();
      request.done();
    }
  }

  async function transmit(
    method: HttpMethod,
    path: string,
    body: Uint8Array | undefined,
    timeoutMs: number,
    linkToOperation: boolean,
    stream: boolean,
  ): Promise<Omit<OpenAIResponse, 'attempt'>> {
    if (!isAllowedOpenAIRequest(method, path)) refuse('INVALID_ENDPOINT');
    if (body !== undefined && body.length > MAX_OUTBOUND_BODY_BYTES) refuse('INTERNAL_ERROR');
    const key = apiKey;
    if (closed || key === undefined) throw new CoreError('CANCELLED');
    const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (path.startsWith('/v1/agents/')) headers['OpenAI-Beta'] = AGENTS_BETA_HEADER_VALUE;
    headers.Accept = stream ? 'text/event-stream' : 'application/json';
    const request = liveRequest(timeoutMs, linkToOperation);
    let response: TransportResponse;
    try {
      if (request.signal.aborted) throw new CoreError('CANCELLED');
      response = await transport.request(
        Object.freeze({
          method,
          url: `${OPENAI_ORIGIN}${path}`,
          headers: Object.freeze(headers),
          ...(body !== undefined ? { body: new Uint8Array(body) } : {}),
          signal: request.signal,
        }),
      );
      if (
        typeof response !== 'object' ||
        response === null ||
        !Number.isSafeInteger(response.status) ||
        response.status < 100 ||
        response.status > 599 ||
        typeof response.headers !== 'object' ||
        response.headers === null
      ) {
        throw new CoreError('INVALID_API_RESPONSE');
      }
    } catch (error) {
      const mapped = failure(error, request, linkToOperation);
      request.done();
      throw mapped;
    }
    const meta = {
      status: response.status,
      contentType: headerText(response.headers['content-type'], 256),
      retryAfter: headerText(response.headers['retry-after'], 64),
      requestId: headerText(response.headers['x-request-id'], 256),
    };
    const success = response.status >= 200 && response.status < 300;
    if (stream && success) return { ...meta, body: boundedStream(response.body, request) };
    try {
      const bytes = await readBounded(response.body, MAX_JSON_RESPONSE_BYTES, request.signal);
      const copy = new Uint8Array(bytes);
      if (path.startsWith('/v1/agents/')) observe(copy);
      return { ...meta, body: copy };
    } catch (error) {
      throw failure(error, request, linkToOperation);
    } finally {
      request.done();
    }
  }

  /** Serializes a frozen consented body again and returns its bytes only if their SHA-256 equals the pin. */
  async function pinnedBytes(text: string, pin: string | null | undefined): Promise<Uint8Array> {
    const bytes = utf8Encode(text);
    if (typeof pin !== 'string' || bytes.length > MAX_OUTBOUND_BODY_BYTES) refuse('INTERNAL_ERROR');
    const digest = await sha256Hex(sha256, bytes);
    if (!constantTimeEqual(digest, pin)) refuse('INTERNAL_ERROR');
    return bytes;
  }

  function sleep(ms: number, dataBearing: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (closed || (dataBearing && operationSignal.aborted)) {
        reject(new CoreError('CANCELLED'));
        return;
      }
      let settled = false;
      let cancelTimer: (() => void) | undefined;
      const finish = (error?: CoreError): void => {
        if (settled) return;
        settled = true;
        waiters.delete(stop);
        if (dataBearing) operationSignal.removeEventListener('abort', stop);
        try {
          cancelTimer?.();
        } catch {
          // The wait is over either way.
        }
        if (error) reject(error);
        else resolve();
      };
      const stop = (): void => finish(new CoreError('CANCELLED'));
      waiters.add(stop);
      if (dataBearing) operationSignal.addEventListener('abort', stop);
      cancelTimer = clock.schedule(ms, () => finish());
    });
  }

  async function jitter(): Promise<number> {
    const bytes = await tokens.randomBytes(1);
    if (!(bytes instanceof Uint8Array) || bytes.length !== 1) throw new CoreError('INTERNAL_ERROR');
    return Math.min(bytes[0] as number, MAX_RETRY_JITTER_MS);
  }

  /** The delay before the second Decisions attempt, or undefined when the policy allows no retry. */
  async function retryDelay(response: Omit<OpenAIResponse, 'attempt'>): Promise<number | undefined> {
    if (response.status === 429) {
      try {
        // JSON.parse yields plain data, so reading two known fields needs no deeper validation;
        // extra or deeply nested provider fields are ignored.
        const parsed: unknown = JSON.parse(utf8Decode(response.body as Uint8Array));
        const error = typeof parsed === 'object' && parsed !== null ? (parsed as { error?: unknown }).error : undefined;
        if (typeof error === 'object' && error !== null) {
          const { code, type } = error as { code?: unknown; type?: unknown };
          if (typeof code === 'string' && NON_RETRYABLE_429_CODES.includes(code)) return undefined;
          if (type === 'insufficient_quota') return undefined;
        }
      } catch {
        // An unreadable 429 body is treated as a temporary rate limit.
      }
    } else if (response.status !== 500 && response.status !== 503) {
      return undefined;
    }
    const header = response.retryAfter?.trim();
    let base = BASE_RETRY_DELAY_MS;
    if (header !== undefined && /^\d{1,6}$/.test(header)) {
      base = Number(header) * 1000;
      if (base > MAX_RETRY_AFTER_MS) return undefined;
    }
    return base + (await jitter());
  }

  function acquireDecisionsSlot(): Promise<void> {
    if (decisionsActive < DELIVERY_POLICY.decisionsMaxConcurrent) {
      decisionsActive += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const entry = {
        grant: () => {
          operationSignal.removeEventListener('abort', entry.deny);
          waiters.delete(entry.deny);
          resolve();
        },
        deny: () => {
          const at = decisionsQueue.indexOf(entry);
          if (at >= 0) decisionsQueue.splice(at, 1);
          operationSignal.removeEventListener('abort', entry.deny);
          waiters.delete(entry.deny);
          reject(new CoreError('CANCELLED'));
        },
      };
      decisionsQueue.push(entry);
      waiters.add(entry.deny);
      operationSignal.addEventListener('abort', entry.deny);
    });
  }

  function releaseDecisionsSlot(): void {
    const next = decisionsQueue.shift();
    if (next) next.grant();
    else decisionsActive -= 1;
  }

  async function sendDecisions(index: number): Promise<OpenAIResponse> {
    if (operation !== 'score') refuse();
    if (decisionsStarted.has(index)) refuse();
    decisionsStarted.add(index);
    const text = decisionsRequestText(preview, index);
    const pin = pins.decisionsRequests[index];
    await acquireDecisionsSlot();
    try {
      const attempt = async (): Promise<Omit<OpenAIResponse, 'attempt'>> => {
        const bytes = await pinnedBytes(text, pin);
        assertOpen(true);
        return transmit('POST', DECISIONS_PATH, bytes, SEND_TIMEOUT_MS.decisions, true, false);
      };
      assertOpen(true);
      let response = await attempt();
      let number = 1;
      if (DELIVERY_POLICY.decisionsMaxAttemptsPerRequest >= 2) {
        const delay = await retryDelay(response);
        if (delay !== undefined) {
          await sleep(delay, true);
          assertOpen(true);
          response = await attempt();
          number = 2;
        }
      }
      if (response.status >= 200 && response.status < 300) decisionsAnswered.add(index);
      return Object.freeze({ ...response, attempt: number });
    } finally {
      releaseDecisionsSlot();
    }
  }

  async function sendAgentsCreate(): Promise<OpenAIResponse> {
    if (operation !== 'agent') refuse();
    if (agentsCreateSent) refuse();
    const text = agentsCreateText(preview);
    if (text === undefined) refuse();
    agentsCreateSent = true;
    const bytes = await pinnedBytes(text, pins.agentsCreate);
    assertOpen(true);
    const response = await transmit('POST', AGENTS_SESSIONS_PATH, bytes, SEND_TIMEOUT_MS.agentsCreate, true, true);
    if (response.status >= 200 && response.status < 300) agentsCreated = true;
    return Object.freeze({ ...response, attempt: 1 });
  }

  /** Accepts a session ID only from this operation's own Agents responses, and only one per operation. */
  function sessionPath(value: unknown): string {
    if (operation !== 'agent' || !agentsCreateSent) refuse();
    const id = providerId(value);
    if (sessionId === undefined) {
      if (!wasObserved(id)) refuse('INVALID_ENDPOINT');
      sessionId = id;
    } else if (!constantTimeEqual(id, sessionId)) {
      refuse('INVALID_ENDPOINT');
    }
    return `${AGENTS_SESSIONS_PATH}/${id}`;
  }

  async function sendToolResult(ref: Record<string, string | number>): Promise<OpenAIResponse> {
    const index = indexIn(ref.index, preview.toolResults.length);
    const path = `${sessionPath(ref.sessionId)}/events`;
    const turnId = providerId(ref.turnId);
    const callId = providerId(ref.callId);
    if (!wasObserved(turnId) || !wasObserved(callId)) refuse('INVALID_ENDPOINT');
    const key = `${turnId} ${callId}`;
    const call = toolCalls.get(key);
    if (call === undefined) {
      if (toolCalls.size >= MAX_AGENT_TOOL_CALLS) refuse();
      toolCalls.set(key, { index, attempts: 1 });
    } else {
      if (call.index !== index || call.attempts >= DELIVERY_POLICY.toolResultMaxAttempts) refuse();
      call.attempts += 1;
    }
    const output = toolResultOutputText(preview, index);
    await pinnedBytes(output, pins.toolResults[index]);
    const bytes = utf8Encode(toolResultEventText(output, turnId, callId));
    assertOpen(true);
    const response = await transmit('POST', path, bytes, SEND_TIMEOUT_MS.toolResult, true, false);
    if (response.status >= 200 && response.status < 300) toolCallsAccepted.add(key);
    return Object.freeze({ ...response, attempt: toolCalls.get(key)!.attempts });
  }

  async function sendCleanup(kind: 'agentsRetrieve' | 'agentsCancel' | 'agentsDelete', ref: Record<string, string | number>): Promise<OpenAIResponse> {
    const path = sessionPath(ref.sessionId);
    if (cleanupCounts[kind] >= AGENTS_CLEANUP_LIMITS[kind]) refuse();
    cleanupCounts[kind] += 1;
    let response: Omit<OpenAIResponse, 'attempt'>;
    if (kind === 'agentsRetrieve') {
      response = await transmit('GET', path, undefined, SEND_TIMEOUT_MS.agentsRetrieve, false, false);
    } else if (kind === 'agentsCancel') {
      response = await transmit('POST', `${path}/events`, utf8Encode(AGENTS_CANCEL_BODY), SEND_TIMEOUT_MS.agentsCancel, false, false);
    } else {
      response = await transmit('DELETE', path, undefined, SEND_TIMEOUT_MS.agentsDelete, false, false);
      if (response.status >= 200 && response.status < 300) {
        try {
          const ack: unknown = JSON.parse(utf8Decode(response.body as Uint8Array));
          // Extra provider fields, however nested, are ignored (additive changes are
          // backwards-compatible); only the three documented fields are read.
          if (typeof ack === 'object' && ack !== null && !Array.isArray(ack)) {
            const { id, object, deleted } = ack as { id?: unknown; object?: unknown; deleted?: unknown };
            if (id === sessionId && object === 'agent.session.deleted' && deleted === true) sessionDeleted = true;
          }
        } catch {
          // An unreadable acknowledgement does not confirm deletion.
        }
      }
    }
    return Object.freeze({ ...response, attempt: cleanupCounts[kind] });
  }

  async function send(input: OpenAIRequestRef): Promise<OpenAIResponse> {
    try {
      const ref = parseRef(input);
      switch (ref.kind) {
        case 'decisions':
          assertOpen(true);
          return await sendDecisions(indexIn(ref.index, preview.decisionsRequests.length));
        case 'agentsCreate':
          assertOpen(true);
          return await sendAgentsCreate();
        case 'toolResult':
          assertOpen(true);
          return await sendToolResult(ref);
        case 'agentsRetrieve':
        case 'agentsCancel':
        case 'agentsDelete':
          assertOpen(false);
          return await sendCleanup(ref.kind, ref);
        default:
          return refuse();
      }
    } catch (error) {
      if (error instanceof Refusal) {
        violation = true;
        throw new CoreError(error.code);
      }
      throw isCoreError(error) ? error : new CoreError('INTERNAL_ERROR');
    }
  }

  async function wait(ms: number): Promise<void> {
    if (typeof ms !== 'number' || !Number.isSafeInteger(ms) || ms < 0 || ms > MAX_PIPELINE_WAIT_MS) {
      violation = true;
      throw new CoreError('INVALID_REQUEST');
    }
    return sleep(ms, false);
  }

  const capability: OpenAISender = Object.freeze({ send, wait });

  let cancelGrace: (() => void) | undefined;
  function close(): void {
    if (closed) return;
    closed = true;
    apiKey = undefined;
    operationSignal.removeEventListener('abort', onOperationAbort);
    try {
      cancelGrace?.();
    } catch {
      // The capability is closed either way.
    }
    for (const request of [...live]) {
      request.source.cancel();
      request.done();
    }
    for (const stop of [...waiters]) stop();
    observed = '';
  }
  // After an abort the pipeline may still clean up its Agents session, but only for a bounded time:
  // then the capability closes and drops the credential even if the pipeline never returns.
  function onOperationAbort(): void {
    if (closed || cancelGrace !== undefined) return;
    cancelGrace = clock.schedule(ABORT_CLEANUP_GRACE_MS, close);
  }
  operationSignal.addEventListener('abort', onOperationAbort);

  return Object.freeze({
    capability,
    record(): SenderRecord {
      return Object.freeze({
        violation,
        decisionsAnswered: Object.freeze([...decisionsAnswered].sort((a, b) => a - b)),
        agentsCreated,
        toolResultsAccepted: toolCallsAccepted.size,
        sessionDeleted,
      });
    },
    close,
  });
}
