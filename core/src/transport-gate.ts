/**
 * The transport gate (task A1b): the outbound rules a request must match before the core hands it
 * to the injected transport port.
 *
 * Port of the outbound checks in extension/native/transport.mjs at commit 48c569e, where they lived
 * inside the transport's own request() method. That code checked the path and the method
 * independently; docs/apps/openai-contracts.md (section 8.2 item 7 and section 10.1) asks the core
 * to allow exact method-and-path pairs instead, so this module keeps one table of exact rules,
 * TRANSPORT_RULES, and a request is passed on only when it matches one of them:
 *
 *   OpenAI, origin https://api.openai.com exactly ({id} is one PROVIDER_ID_PATTERN path segment):
 *     POST   /v1/decisions                    body required; OpenAI-Beta refused
 *     POST   /v1/agents/sessions              body required; OpenAI-Beta: agents=v1 required;
 *                                             Accept may be application/json or text/event-stream
 *     GET    /v1/agents/sessions/{id}         no body;       OpenAI-Beta: agents=v1 required
 *     POST   /v1/agents/sessions/{id}/events  body required; OpenAI-Beta: agents=v1 required
 *     DELETE /v1/agents/sessions/{id}         no body;       OpenAI-Beta: agents=v1 required
 *   Every OpenAI rule requires Authorization: Bearer plus a contract-shaped key, requires
 *   Content-Type: application/json exactly when a body is sent, and allows Accept only as
 *   application/json unless the rule says otherwise. No query string is allowed.
 *
 *   ClinicalTrials.gov (task A2's live search):
 *     GET https://clinicaltrials.gov/api/v2/studies?<query>
 *   No body. The only header is Accept: application/json, and it is required; Authorization,
 *   OpenAI-Beta, and Content-Type are refused, so an OpenAI key cannot be attached to this rule. The
 *   query uses allowlisted parameter names only, each at most once, with values in well-formed
 *   percent-encoding (the encodeURIComponent alphabet with upper-case hex, valid UTF-8, no control
 *   characters once decoded), and the whole URL is at most MAX_TRANSPORT_URL_CHARS characters.
 *
 * Any other method, origin, path, port, userinfo, query, fragment, header, or body shape is refused,
 * and the body cap (MAX_OUTBOUND_BODY_BYTES) applies to the bytes about to be handed over.
 *
 * What this module does and does not do: createCore (dispatcher.ts) wraps the host's transport port
 * with guardTransport, so the core does not pass the port a request outside these rules. The guard
 * reads each field of a request exactly once, validates that snapshot, and hands the port a rebuilt,
 * frozen request with a fresh copy of the body; a refused request is never handed to the port. What
 * a port does with a request that matched (certificate validation, not following redirects, not
 * rewriting the request; see Transport in ports.ts) is the host's responsibility, and this module
 * cannot check it.
 *
 * Errors are constant-shape CoreErrors: INVALID_ENDPOINT when no rule matches the method, origin,
 * path, and query; INPUT_TOO_LARGE for the body cap; INVALID_REQUEST for header, body, and shape
 * violations (including a getter or Proxy trap that throws); KEY_MISSING for a missing or malformed
 * Authorization value on an OpenAI rule.
 */
import { utf8Encode } from './bytes.ts';
import { CoreError, isCoreError } from './errors.ts';
import { API_KEY_PATTERN, isSafeText, MAX_OUTBOUND_BODY_BYTES, PROVIDER_ID_PATTERN } from './protocol.ts';
import type {
  CancelSignal,
  Clock,
  CorePorts,
  HttpMethod,
  Loader,
  Sha256,
  TokenSource,
  Transport,
  TransportRequest,
  TransportResponse,
} from './ports.ts';

/** The pinned OpenAI origin (transport.mjs connected to hostname api.openai.com, port 443, https only). */
export const OPENAI_ORIGIN = 'https://api.openai.com';

/** The ClinicalTrials.gov origin that task A2's live search uses. */
const CTGOV_ORIGIN = 'https://clinicaltrials.gov';

/**
 * Upper bound on the whole request URL. Task A2's ordinary first-page search URL is about 930 to
 * 1,000 characters, and A2's buildStudiesUrl (feature/core-a2-fcc at 8bc91f9) refuses to build a
 * URL longer than its own CTGOV_MAX_URL_LENGTH, which is also 2,048. At reconciliation the two
 * bounds should become one constant.
 */
export const MAX_TRANSPORT_URL_CHARS = 2048;

/** The OpenAI-Beta value the Agents rules require (A0 record section 3). */
export const OPENAI_BETA_AGENTS = 'agents=v1';

export const ACCEPT_VALUES = ['application/json', 'text/event-stream'] as const;
export type AcceptValue = (typeof ACCEPT_VALUES)[number];

export type TransportRuleId =
  | 'openai.decisions.create'
  | 'openai.agents.sessions.create'
  | 'openai.agents.sessions.retrieve'
  | 'openai.agents.sessions.events.create'
  | 'openai.agents.sessions.delete'
  | 'ctgov.studies.search';

/** One allowed request shape. Every field is decided by the rule, not by the caller. */
export interface TransportRule {
  readonly id: TransportRuleId;
  readonly method: HttpMethod;
  /** Scheme and host, exactly; no port and no userinfo. */
  readonly origin: string;
  /** Path template; `{id}` stands for one segment matching PROVIDER_ID_PATTERN. */
  readonly path: string;
  /** Allowlisted query parameter names, or null when the rule allows no query string at all. */
  readonly queryParameters: readonly string[] | null;
  readonly body: 'required' | 'forbidden';
  readonly authorization: 'required' | 'forbidden';
  readonly openaiBeta: 'required' | 'forbidden';
  /** Accept values the rule allows. */
  readonly accept: readonly AcceptValue[];
  /** Whether Accept must be present. */
  readonly acceptRequired: boolean;
}

/**
 * The query parameter names task A2's live search sends, taken read-only from CTGOV_QUERY_PARAMS
 * in core/src/ctgov/query.ts on feature/core-a2-fcc (same list at commits 1d9b3b6 and 8bc91f9).
 * When the branches are reconciled, A2's isCtgovStudiesUrl and parseStudiesUrl must be reconciled
 * with this grammar (one list of names, one URL length bound, and the percent-encoding alphabet
 * below), so that the two checks describe the same requests. A2's parseStudiesUrl is the stricter
 * check (it rebuilds the URL byte for byte); this rule is the outer bound that the gate enforces
 * for every request the core hands to the port.
 */
const CTGOV_QUERY_PARAMETERS = [
  'format',
  'query.cond',
  'filter.overallStatus',
  'filter.advanced',
  'fields',
  'sort',
  'pageSize',
  'countTotal',
  'pageToken',
] as const;

const OPENAI_JSON: readonly AcceptValue[] = Object.freeze(['application/json'] as const);

function openAIRule(
  id: TransportRuleId,
  method: HttpMethod,
  path: string,
  body: TransportRule['body'],
  openaiBeta: TransportRule['openaiBeta'],
  accept: readonly AcceptValue[] = OPENAI_JSON,
): TransportRule {
  return Object.freeze({
    id,
    method,
    origin: OPENAI_ORIGIN,
    path,
    queryParameters: null,
    body,
    authorization: 'required',
    openaiBeta,
    accept: Object.freeze([...accept]),
    acceptRequired: false,
  });
}

/** Every request the core may hand to a transport port. Nothing outside this table is passed on. */
export const TRANSPORT_RULES: readonly TransportRule[] = Object.freeze([
  openAIRule('openai.decisions.create', 'POST', '/v1/decisions', 'required', 'forbidden'),
  openAIRule('openai.agents.sessions.create', 'POST', '/v1/agents/sessions', 'required', 'required', ACCEPT_VALUES),
  openAIRule('openai.agents.sessions.retrieve', 'GET', '/v1/agents/sessions/{id}', 'forbidden', 'required'),
  openAIRule('openai.agents.sessions.events.create', 'POST', '/v1/agents/sessions/{id}/events', 'required', 'required'),
  openAIRule('openai.agents.sessions.delete', 'DELETE', '/v1/agents/sessions/{id}', 'forbidden', 'required'),
  Object.freeze({
    id: 'ctgov.studies.search',
    method: 'GET',
    origin: CTGOV_ORIGIN,
    path: '/api/v2/studies',
    queryParameters: Object.freeze([...CTGOV_QUERY_PARAMETERS]),
    body: 'forbidden',
    authorization: 'forbidden',
    openaiBeta: 'forbidden',
    accept: Object.freeze(['application/json'] as const),
    acceptRequired: true,
  } satisfies TransportRule),
]);

// -------------------------------------------------------------------------------------------
// Matching a method and URL against the rule table
// -------------------------------------------------------------------------------------------

/** One path segment for a provider identifier, from the protocol's own pattern (single source). */
const ID_SEGMENT = PROVIDER_ID_PATTERN.source.replace(/^\^/, '').replace(/\$$/, '');

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

interface CompiledRule {
  readonly rule: TransportRule;
  readonly pathPattern: RegExp;
  readonly queryNames: ReadonlySet<string> | null;
}

const COMPILED_RULES: readonly CompiledRule[] = TRANSPORT_RULES.map(rule => ({
  rule,
  pathPattern: new RegExp(`^${rule.path.split('{id}').map(escapeRegExp).join(`(?:${ID_SEGMENT})`)}$`),
  queryNames: rule.queryParameters === null ? null : new Set(rule.queryParameters),
}));

const METHODS: ReadonlySet<string> = new Set(TRANSPORT_RULES.map(rule => rule.method));

/** The five OpenAI rules (the send capability's view of the gate). */
export const OPENAI_RULE_IDS: readonly TransportRuleId[] = Object.freeze(
  TRANSPORT_RULES.filter(rule => rule.origin === OPENAI_ORIGIN).map(rule => rule.id),
);
/** The ClinicalTrials.gov search rule (the searchTrials pipeline's view of the gate). */
export const CTGOV_SEARCH_RULE_IDS: readonly TransportRuleId[] = Object.freeze(['ctgov.studies.search'] as const);

/**
 * The OpenAI rule for a method and an exact path, or undefined. outbound.ts uses this so that the
 * send capability and the gate read the same table.
 */
export function findOpenAIRule(method: string, path: string): TransportRule | undefined {
  if (typeof method !== 'string' || typeof path !== 'string' || !path.startsWith('/')) return undefined;
  for (const compiled of COMPILED_RULES) {
    const { rule } = compiled;
    if (rule.origin === OPENAI_ORIGIN && rule.method === method && compiled.pathPattern.test(path)) return rule;
  }
  return undefined;
}

/** One percent-encoded query component: the encodeURIComponent alphabet, upper-case hex escapes. */
const QUERY_COMPONENT = /^(?:[A-Za-z0-9\-_.!~*'()]|%[0-9A-F]{2})+$/;

/** True when the query is name=value pairs with allowlisted names (each once) and well-formed values. */
function queryMatches(query: string, names: ReadonlySet<string>): boolean {
  if (query.length === 0) return false;
  const seen = new Set<string>();
  for (const part of query.split('&')) {
    const at = part.indexOf('=');
    if (at <= 0) return false;
    // Allowlisted names contain only letters and dots, which percent-encoding leaves as they are,
    // so a name is compared literally and an encoded spelling of a name is refused.
    const name = part.slice(0, at);
    const value = part.slice(at + 1);
    if (!names.has(name) || seen.has(name)) return false;
    seen.add(name);
    if (!QUERY_COMPONENT.test(value)) return false;
    let decoded: string;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return false;
    }
    if (!isSafeText(decoded)) return false;
  }
  return true;
}

/** Finds the one rule for this method and URL, or throws INVALID_ENDPOINT. */
function matchRule(method: unknown, url: unknown): CompiledRule {
  if (typeof method !== 'string' || !METHODS.has(method)) throw new CoreError('INVALID_ENDPOINT');
  if (typeof url !== 'string' || url.length > MAX_TRANSPORT_URL_CHARS) throw new CoreError('INVALID_ENDPOINT');
  for (const compiled of COMPILED_RULES) {
    const { rule } = compiled;
    if (rule.method !== method || !url.startsWith(`${rule.origin}/`)) continue;
    // The remainder starts with "/", so anything else after the host (a port, userinfo trick, or a
    // longer host name) cannot match a path pattern.
    const rest = url.slice(rule.origin.length);
    if (compiled.queryNames === null) {
      if (compiled.pathPattern.test(rest)) return compiled;
      continue;
    }
    const question = rest.indexOf('?');
    if (question < 0) continue;
    if (compiled.pathPattern.test(rest.slice(0, question)) && queryMatches(rest.slice(question + 1), compiled.queryNames)) {
      return compiled;
    }
  }
  throw new CoreError('INVALID_ENDPOINT');
}

// -------------------------------------------------------------------------------------------
// Snapshot helpers: each reads caller-controlled data once and returns plain values
// -------------------------------------------------------------------------------------------

const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const MAX_HEADER_VALUE_BYTES = 8192;

/** The only header names that can leave the core, by lower-case name, with their canonical spelling. */
const CANONICAL_HEADER_NAMES = Object.freeze({
  authorization: 'Authorization',
  'content-type': 'Content-Type',
  'openai-beta': 'OpenAI-Beta',
  accept: 'Accept',
} as const);
type HeaderKey = keyof typeof CANONICAL_HEADER_NAMES;
const HEADER_KEYS = Object.keys(CANONICAL_HEADER_NAMES) as HeaderKey[];

function isHeaderKey(name: string): name is HeaderKey {
  return (HEADER_KEYS as string[]).includes(name);
}

/** Header values are one line of printable ASCII (so no CRLF injection can smuggle a new header). */
function headerValueOk(value: string): boolean {
  if (value.length === 0 || value.length > MAX_HEADER_VALUE_BYTES) return false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

/**
 * Reads the header names once and each value once. Unknown names are rejected, not dropped, so no
 * caller can add headers the rules never mention; a name repeated in another letter case is
 * rejected too.
 */
function snapshotHeaders(raw: unknown): Partial<Record<HeaderKey, string>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new CoreError('INVALID_REQUEST');
  const names = Object.keys(raw);
  const headers: Partial<Record<HeaderKey, string>> = {};
  for (const name of names) {
    if (!HEADER_NAME_PATTERN.test(name)) throw new CoreError('INVALID_REQUEST');
    const key = name.toLowerCase();
    if (!isHeaderKey(key) || headers[key] !== undefined) throw new CoreError('INVALID_REQUEST');
    const value: unknown = (raw as Record<string, unknown>)[name];
    if (typeof value !== 'string' || !headerValueOk(value)) throw new CoreError('INVALID_REQUEST');
    headers[key] = value;
  }
  return headers;
}

// The intrinsic %TypedArray% accessors read internal slots, so neither a Uint8Array subclass that
// overrides `length` nor a Proxy or look-alike object can make them report something else.
const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayNameOf = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, Symbol.toStringTag)?.get;
const typedArrayLengthOf = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, 'length')?.get;

/**
 * Copies a caller's body once, after checking that it is a genuine Uint8Array within the cap. Only
 * the copy is validated and handed on, so later changes to the caller's bytes cannot change it.
 */
function copyBody(value: unknown): Uint8Array {
  if (typedArrayNameOf === undefined || typedArrayLengthOf === undefined) throw new CoreError('INTERNAL_ERROR');
  if (typedArrayNameOf.call(value) !== 'Uint8Array') throw new CoreError('INVALID_REQUEST');
  const length: unknown = typedArrayLengthOf.call(value);
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) throw new CoreError('INVALID_REQUEST');
  if (length > MAX_OUTBOUND_BODY_BYTES) throw new CoreError('INPUT_TOO_LARGE');
  const copy = new Uint8Array(length);
  // With a typed-array source, set() copies from internal slots and runs no caller code.
  copy.set(value as Uint8Array);
  return copy;
}

function checkSignal(signal: unknown): CancelSignal | undefined {
  if (signal === undefined) return undefined;
  if (typeof signal !== 'object' || signal === null) throw new CoreError('INVALID_REQUEST');
  const s = signal as Record<string, unknown>;
  if (typeof s.aborted !== 'boolean' || typeof s.addEventListener !== 'function' || typeof s.removeEventListener !== 'function') {
    throw new CoreError('INVALID_REQUEST');
  }
  return signal as CancelSignal;
}

// -------------------------------------------------------------------------------------------
// The guard: snapshot, validate against one rule, rebuild
// -------------------------------------------------------------------------------------------

/** Everything the guard checked, in the shape it will rebuild from. */
interface CheckedRequest {
  readonly rule: TransportRule;
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array | undefined;
  readonly signal: CancelSignal | undefined;
}

function checkSnapshot(request: unknown, allowed: ReadonlySet<TransportRuleId> | undefined): CheckedRequest {
  if (typeof request !== 'object' || request === null) throw new CoreError('INVALID_REQUEST');
  // Each field is read exactly once, here. Everything below validates and rebuilds from these
  // values only, so a getter or Proxy cannot show one value to the checks and another to the port.
  const { method, url, headers: rawHeaders, body: rawBody, signal: rawSignal } = request as Record<string, unknown>;

  const { rule } = matchRule(method, url);
  if (allowed !== undefined && !allowed.has(rule.id)) throw new CoreError('INVALID_ENDPOINT');

  const body = rawBody === undefined ? undefined : copyBody(rawBody);
  if (rule.body === 'required' ? body === undefined : body !== undefined) throw new CoreError('INVALID_REQUEST');

  const headers = snapshotHeaders(rawHeaders);
  const contentType = headers['content-type'];
  if (body !== undefined ? contentType !== 'application/json' : contentType !== undefined) throw new CoreError('INVALID_REQUEST');
  const beta = headers['openai-beta'];
  if (rule.openaiBeta === 'required' ? beta !== OPENAI_BETA_AGENTS : beta !== undefined) throw new CoreError('INVALID_REQUEST');
  const accept = headers.accept;
  if (accept === undefined ? rule.acceptRequired : !(rule.accept as readonly string[]).includes(accept)) {
    throw new CoreError('INVALID_REQUEST');
  }
  const authorization = headers.authorization;
  if (rule.authorization === 'forbidden') {
    if (authorization !== undefined) throw new CoreError('INVALID_REQUEST');
  } else if (authorization === undefined || !authorization.startsWith('Bearer ') || !API_KEY_PATTERN.test(authorization.slice(7))) {
    throw new CoreError('KEY_MISSING');
  }

  const signal = checkSignal(rawSignal);

  const canonical: Record<string, string> = {};
  for (const key of HEADER_KEYS) {
    const value = headers[key];
    if (value !== undefined) canonical[CANONICAL_HEADER_NAMES[key]] = value;
  }
  return { rule, method: rule.method, url: url as string, headers: canonical, body, signal };
}

/**
 * Validates a claimed request independently of how it was built. Throws INVALID_ENDPOINT,
 * INVALID_REQUEST, INPUT_TOO_LARGE, or KEY_MISSING; never throws anything that names request
 * content. A getter, Proxy trap, or detached buffer that throws becomes INVALID_REQUEST.
 */
function checkTransportRequest(request: unknown, allowed?: ReadonlySet<TransportRuleId>): CheckedRequest {
  try {
    return checkSnapshot(request, allowed);
  } catch (error) {
    if (isCoreError(error)) throw error;
    throw new CoreError('INVALID_REQUEST');
  }
}

/** Rebuilds a frozen request from the checked parts; the body is already the guard's own copy. */
function rebuildChecked(checked: CheckedRequest): TransportRequest {
  return Object.freeze({
    method: checked.method,
    url: checked.url,
    headers: Object.freeze({ ...checked.headers }),
    ...(checked.body !== undefined ? { body: checked.body } : {}),
    ...(checked.signal !== undefined ? { signal: checked.signal } : {}),
  });
}

// -------------------------------------------------------------------------------------------
// Building OpenAI requests (the only constructor core callers should use for OpenAI)
// -------------------------------------------------------------------------------------------

/** Everything an outbound OpenAI request may vary in; every other part is decided by the rule table. */
export interface OpenAIRequestOptions {
  /** GET, POST, or DELETE; together with the path it must name one OpenAI rule. */
  readonly method: HttpMethod;
  /** The endpoint path, for example "/v1/decisions" or "/v1/agents/sessions/{id}/events" with a real id. */
  readonly path: string;
  /** A JSON-serializable body. Undefined means no body; rules that require one refuse its absence. */
  readonly body?: unknown;
  /** The user's key. Every OpenAI rule requires Authorization. */
  readonly apiKey: string;
  /** Accept header value; only the create-session rule allows "text/event-stream". */
  readonly accept?: AcceptValue;
  readonly signal?: CancelSignal;
}

/**
 * The single OpenAI request constructor. It serializes the body (and applies the byte cap), sets
 * Authorization, Content-Type, and OpenAI-Beta from the matched rule, and then runs the result
 * through the same checks as the guard, so the builder and the guard cannot disagree about what a
 * rule allows. ClinicalTrials.gov requests are built by task A2's client and pass the same guard.
 */
export function toTransportRequest(options: OpenAIRequestOptions): TransportRequest {
  if (typeof options !== 'object' || options === null) throw new CoreError('INVALID_REQUEST');
  const { method, path, body, apiKey, accept, signal } = options;
  if (typeof path !== 'string' || !path.startsWith('/')) throw new CoreError('INVALID_ENDPOINT');
  const url = `${OPENAI_ORIGIN}${path}`;
  const { rule } = matchRule(method, url);
  let bytes: Uint8Array | undefined;
  if (body !== undefined) {
    if (rule.body === 'forbidden') throw new CoreError('INVALID_REQUEST');
    let text: string | undefined;
    try {
      text = JSON.stringify(body);
    } catch {
      text = undefined;
    }
    if (typeof text !== 'string') throw new CoreError('INVALID_REQUEST');
    bytes = utf8Encode(text);
    if (bytes.length > MAX_OUTBOUND_BODY_BYTES) throw new CoreError('INPUT_TOO_LARGE');
  }
  if (typeof apiKey !== 'string' || !API_KEY_PATTERN.test(apiKey)) throw new CoreError('KEY_MISSING');
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (bytes !== undefined) headers['Content-Type'] = 'application/json';
  if (rule.openaiBeta === 'required') headers['OpenAI-Beta'] = OPENAI_BETA_AGENTS;
  if (accept !== undefined) headers.Accept = accept;
  return rebuildChecked(
    checkTransportRequest({
      method,
      url,
      headers,
      ...(bytes !== undefined ? { body: bytes } : {}),
      ...(signal !== undefined ? { signal } : {}),
    }),
  );
}

// -------------------------------------------------------------------------------------------
// Wrapping ports
// -------------------------------------------------------------------------------------------

/**
 * Wraps a transport port so that a request is handed to it only when it matches a rule. A refused
 * request throws before the port is called. The port receives a rebuilt, frozen request with its
 * own copy of the body. What the port does with that request, and what it returns, are outside this
 * function (the core validates responses elsewhere). The returned object is frozen.
 */
export function guardTransport(port: Transport): Transport {
  return Object.freeze({
    async request(request: TransportRequest): Promise<TransportResponse> {
      return port.request(rebuildChecked(checkTransportRequest(request)));
    },
  });
}

/**
 * Like guardTransport, but only the named rules pass; a request that matches another rule is
 * INVALID_ENDPOINT. The dispatcher gives the send capability the OpenAI rules and the searchTrials
 * pipeline the ClinicalTrials.gov rule, each on top of the gate around the host's port.
 */
export function restrictTransport(port: Transport, ruleIds: readonly TransportRuleId[]): Transport {
  const allowed: ReadonlySet<TransportRuleId> = new Set(ruleIds);
  return Object.freeze({
    async request(request: TransportRequest): Promise<TransportResponse> {
      return port.request(rebuildChecked(checkTransportRequest(request, allowed)));
    },
  });
}

/**
 * Returns the ports bundle the core hands to pipelines and to the session: the transport wrapped by
 * guardTransport, and the other ports behind frozen facades that call the host's port at call time.
 * The bundle and every facade are frozen, so code that holds the bundle cannot replace a port or a
 * port method for later callers, and cannot reach the host's own port objects through it.
 */
export function guardCorePorts(ports: CorePorts): CorePorts {
  const { transport, sha256, tokens, clock, loader } = ports;
  const sha256Facade: Sha256 = Object.freeze({ digestHex: (bytes: Uint8Array) => sha256.digestHex(bytes) });
  const tokensFacade: TokenSource = Object.freeze({ randomBytes: (length: number) => tokens.randomBytes(length) });
  const clockFacade: Clock = Object.freeze({
    now: () => clock.now(),
    monotonic: () => clock.monotonic(),
    schedule: (delayMs: number, callback: () => void) => clock.schedule(delayMs, callback),
  });
  const loaderFacade: Loader = Object.freeze({
    load: (resourceId: string, maxBytes: number, signal?: CancelSignal) =>
      signal === undefined ? loader.load(resourceId, maxBytes) : loader.load(resourceId, maxBytes, signal),
  });
  return Object.freeze({
    transport: guardTransport(transport),
    sha256: sha256Facade,
    tokens: tokensFacade,
    clock: clockFacade,
    loader: loaderFacade,
  });
}
