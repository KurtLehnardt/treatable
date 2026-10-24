/**
 * The transport gate (task A1b): the outbound invariants a transport port cannot widen.
 *
 * Port of the outbound rules in extension/native/transport.mjs at commit 48c569e, where the same
 * checks lived inside the transport's own request() method:
 *   - the endpoint allowlist (paths): /v1/decisions and /v1/agents/sessions.../events only,
 *     with provider identifiers limited to the documented safe characters, and nothing else
 *     possible: no query strings, fragments, or other prefixes;
 *   - the one origin the core ever talks to: https://api.openai.com, exactly (no subdomains,
 *     no ports, no userinfo, no scheme other than https);
 *   - the request body cap: at most MAX_OUTBOUND_BODY_BYTES of serialized JSON, enforced by the
 *     builder and again on the bytes about to leave;
 *   - OpenAI-Beta: agents=v1 is required on every agents path and forbidden elsewhere;
 *   - Content-Type is application/json exactly when a body is sent;
 *   - Authorization may only ever be "Bearer " plus a contract-shaped key, or absent.
 * In the extension a future caller could have bypassed the transport's checks by hand-crafting its
 * own HTTP options. Here every request a pipeline makes still passes GuardValidation: the guard
 * re-validates it and rebuilds a frozen request with only the allowlisted headers and a fresh copy
 * of the capped body, and only that rebuilt request reaches the port. The guard is wired inside
 * createCore (dispatcher.ts), so no host-supplied transport and no hand-crafted caller can widen
 * the invariants: a rejected attempt never reaches the port at all.
 *
 * Everything in this file fails closed with a constant-shape CoreError: INVALID_ENDPOINT for the
 * allowlist and origin pin, INPUT_TOO_LARGE for the body cap, INVALID_REQUEST for header and shape
 * violations, KEY_MISSING for a malformed Authorization value.
 */
import { utf8Encode } from './bytes.ts';
import { CoreError } from './errors.ts';
import { API_KEY_PATTERN, MAX_OUTBOUND_BODY_BYTES } from './protocol.ts';
import type { CancelSignal, CorePorts, HttpMethod, Transport, TransportRequest } from './ports.ts';

/** The pinned origin (transport.mjs connected to hostname api.openai.com, port 443, https only). */
export const OPENAI_ORIGIN = 'https://api.openai.com';

/**
 * The allowlisted endpoint paths, ported verbatim from the guard inside transport.mjs (its
 * request() method). A matching path
 * is only ever used as a suffix of OPENAI_ORIGIN, so rule text that merely "appears somewhere" in
 * the URL cannot pass: the whole URL has to be exactly origin + allowlisted path.
 */
const PATH_RULE = String.raw`\/v1\/(?:decisions|agents\/sessions(?:\/[A-Za-z0-9_-]{1,160}(?:\/events)?)?)`;
export const ALLOWED_TRANSPORT_PATHS = new RegExp(`^${PATH_RULE}$`);
const PINNED_URL = new RegExp(`^https://api\\.openai\\.com(${PATH_RULE})$`);

const TRANSPORT_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'DELETE']);
const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const MAX_HEADER_VALUE_BYTES = 8192;
export const ACCEPT_VALUES = ['application/json', 'text/event-stream'] as const;
export type AcceptValue = (typeof ACCEPT_VALUES)[number];

function agentsPath(path: string): boolean {
  return path.startsWith('/v1/agents/');
}

/** Header values are one line of printable ASCII (so no CRLF injection can smuggle a new header). */
function headerValueOk(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_HEADER_VALUE_BYTES) return false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

// -------------------------------------------------------------------------------------------
// Building requests (the only constructor core callers should use)
// -------------------------------------------------------------------------------------------

/** Everything an outbound request may vary in; every other part is pinned by this module. */
export interface OpenAIRequestOptions {
  /** GET, POST, or DELETE. */
  readonly method: HttpMethod;
  /** An allowlisted endpoint path, for example "/v1/decisions" or "/v1/agents/sessions". */
  readonly path: string;
  /** A JSON-serializable body. Undefined means no body (and then GET must not carry one). */
  readonly body?: unknown;
  /** The user's key, when this request authenticates. */
  readonly apiKey?: string;
  /** Accept header value; streaming agents reads use "text/event-stream". */
  readonly accept?: AcceptValue;
  readonly signal?: CancelSignal;
}

/**
 * The single request constructor: tries to produce a request that would survive the guard. The
 * serialization, the byte cap, the origin pin, Content-Type, and OpenAI-Beta are decided here and
 * re-decided by the guard, so a caller that ignores this helper still cannot slip past the gate.
 */
export function toTransportRequest(options: OpenAIRequestOptions): TransportRequest {
  const method: unknown = options?.method;
  const path: unknown = options?.path;
  if (typeof method !== 'string' || !TRANSPORT_METHODS.has(method) || typeof path !== 'string' || !ALLOWED_TRANSPORT_PATHS.test(path)) {
    throw new CoreError('INVALID_ENDPOINT');
  }
  let body: Uint8Array | undefined = undefined;
  if (options.body !== undefined) {
    if (method === 'GET') throw new CoreError('INVALID_REQUEST');
    let text: string | undefined;
    try {
      text = JSON.stringify(options.body);
    } catch {
      text = undefined;
    }
    if (typeof text !== 'string') throw new CoreError('INVALID_REQUEST');
    body = utf8Encode(text);
    if (body.length > MAX_OUTBOUND_BODY_BYTES) throw new CoreError('INPUT_TOO_LARGE');
  }
  const headers: Record<string, string> = {};
  if (options?.apiKey !== undefined) {
    if (typeof options.apiKey !== 'string' || !API_KEY_PATTERN.test(options.apiKey)) throw new CoreError('KEY_MISSING');
    headers.Authorization = `Bearer ${options.apiKey}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (agentsPath(path)) headers['OpenAI-Beta'] = 'agents=v1';
  if (options?.accept !== undefined) {
    if (!ACCEPT_VALUES.includes(options.accept)) throw new CoreError('INVALID_REQUEST');
    headers.Accept = options.accept;
  }
  return Object.freeze({
    method: method as HttpMethod,
    url: `${OPENAI_ORIGIN}${path}`,
    headers: Object.freeze(headers),
    ...(body !== undefined ? { body } : {}),
    ...(options?.signal !== undefined ? { signal: options.signal } : {}),
  });
}

// -------------------------------------------------------------------------------------------
// The guard: re-validate and rebuild before the port sees anything
// -------------------------------------------------------------------------------------------

/** Everything the guard checked, in the shape it will rebuild from. */
interface CheckedRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly path: string;
  readonly body: Uint8Array | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: CancelSignal | undefined;
}

/**
 * Validates a claimed request independently of how it was built (the builder above never sees
 * this code path as an excuse). Throws INVALID_ENDPOINT, INVALID_REQUEST, INPUT_TOO_LARGE, or
 * KEY_MISSING; never throws anything that names request content.
 */
function checkTransportRequest(request: unknown): CheckedRequest {
  if (typeof request !== 'object' || request === null) throw new CoreError('INVALID_REQUEST');
  const r = request as Record<string, unknown>;
  const method: unknown = r.method;
  if (typeof method !== 'string' || !TRANSPORT_METHODS.has(method)) throw new CoreError('INVALID_ENDPOINT');
  const url: unknown = r.url;
  if (typeof url !== 'string' || url.length > 512) throw new CoreError('INVALID_ENDPOINT');
  const match = url.match(PINNED_URL);
  if (match === null) throw new CoreError('INVALID_ENDPOINT');
  const path = match[1] as string;

  let body: Uint8Array | undefined = undefined;
  if (r.body !== undefined && !(r.body instanceof Uint8Array)) throw new CoreError('INVALID_REQUEST');
  if (r.body instanceof Uint8Array) {
    if (method === 'GET') throw new CoreError('INVALID_REQUEST');
    if (r.body.length > MAX_OUTBOUND_BODY_BYTES) throw new CoreError('INPUT_TOO_LARGE');
    body = r.body;
  }

  if (r.headers === undefined || typeof r.headers !== 'object' || Array.isArray(r.headers)) {
    throw new CoreError('INVALID_REQUEST');
  }
  const raw = r.headers as Record<string, unknown>;
  const headers: Record<string, string> = {};
  let hasAuthorization = false;
  let hasContentType = false;
  let hasBeta = false;
  let hasAccept = false;
  for (const name of Object.keys(raw)) {
    const lower = name.toLowerCase();
    if (!HEADER_NAME_PATTERN.test(name)) throw new CoreError('INVALID_REQUEST');
    if (lower === 'authorization') {
      if (hasAuthorization) throw new CoreError('INVALID_REQUEST');
      hasAuthorization = true;
    } else if (lower === 'content-type') {
      if (hasContentType) throw new CoreError('INVALID_REQUEST');
      hasContentType = true;
    } else if (lower === 'openai-beta') {
      if (hasBeta) throw new CoreError('INVALID_REQUEST');
      hasBeta = true;
    } else if (lower === 'accept') {
      if (hasAccept) throw new CoreError('INVALID_REQUEST');
      hasAccept = true;
    } else {
      // No other header name ever leaves the core; unknown headers are rejected, not dropped,
      // so no caller can smuggle headers the contract never promised.
      throw new CoreError('INVALID_REQUEST');
    }
    const value = raw[name];
    if (typeof value !== 'string' || !headerValueOk(value)) throw new CoreError('INVALID_REQUEST');
    headers[lower] = value;
  }
  const contentType = headers['content-type'];
  if (body !== undefined && contentType !== 'application/json') throw new CoreError('INVALID_REQUEST');
  if (body === undefined && contentType !== undefined) throw new CoreError('INVALID_REQUEST');
  const beta = headers['openai-beta'];
  if (agentsPath(path)) {
    if (beta !== 'agents=v1') throw new CoreError('INVALID_REQUEST');
  } else if (beta !== undefined) {
    throw new CoreError('INVALID_REQUEST');
  }
  const authorization = headers.authorization;
  if (authorization !== undefined && (!authorization.startsWith('Bearer ') || !API_KEY_PATTERN.test(authorization.slice(7)))) {
    throw new CoreError('KEY_MISSING');
  }
  const accept = headers.accept;
  if (accept !== undefined && !(ACCEPT_VALUES as readonly string[]).includes(accept)) {
    throw new CoreError('INVALID_REQUEST');
  }

  let signal: CancelSignal | undefined = undefined;
  if (r.signal !== undefined) {
    const s = r.signal as Partial<CancelSignal>;
    if (
      typeof r.signal !== 'object' ||
      r.signal === null ||
      typeof s.aborted !== 'boolean' ||
      typeof s.addEventListener !== 'function' ||
      typeof s.removeEventListener !== 'function'
    ) {
      throw new CoreError('INVALID_REQUEST');
    }
    signal = r.signal as CancelSignal;
  }
  return { method: method as HttpMethod, url, path, body, headers, signal };
}

/** Rebuilds a frozen request from the checked parts; the body is copied, so later core-side edits to the source bytes cannot change what was checked. */
function rebuildChecked(checked: CheckedRequest): TransportRequest {
  const headers: Record<string, string> = {};
  if (checked.headers.authorization !== undefined) headers.Authorization = checked.headers.authorization;
  if (checked.headers['content-type'] !== undefined) headers['Content-Type'] = checked.headers['content-type'];
  if (checked.headers['openai-beta'] !== undefined) headers['OpenAI-Beta'] = checked.headers['openai-beta'];
  if (checked.headers.accept !== undefined) headers.Accept = checked.headers.accept;
  return Object.freeze({
    method: checked.method,
    url: checked.url,
    headers: Object.freeze(headers),
    ...(checked.body !== undefined ? { body: new Uint8Array(checked.body) } : {}),
    ...(checked.signal !== undefined ? { signal: checked.signal } : {}),
  });
}

/**
 * Wraps a transport port so no request reaches it unless every invariant holds. A rejected request
 * throws before the port is called, so a hostile or compromised port cannot observe the attempt,
 * let alone widen where requests go or how large they are. What the port does with a valid request,
 * and what it returns, stay its own concern (the core validates responses elsewhere).
 */
export function guardTransport(port: Transport): Transport {
  const guarded: Transport = {
    async request(request) {
      return port.request(rebuildChecked(checkTransportRequest(request)));
    },
  };
  return guarded;
}

/** Guards the transport of an already-asserted ports bundle; the other ports pass through unchanged. */
export function guardCorePorts(ports: CorePorts): CorePorts {
  return {
    transport: guardTransport(ports.transport),
    sha256: ports.sha256,
    tokens: ports.tokens,
    clock: ports.clock,
    loader: ports.loader,
  };
}
