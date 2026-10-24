/**
 * Injected ports: the only way the shared core reaches the outside world.
 *
 * The core runs unchanged in the desktop helper (Node) and in the mobile app (Hermes). It therefore
 * never touches host globals for networking, hashing, randomness, time, timers, or files. Each host
 * supplies these five ports. Node reference implementations live outside core/src (core/node/), and
 * the mobile app supplies its own. The import-graph test and the src-only typecheck keep it that way.
 *
 * Every port result is treated as untrusted input: the core validates sizes, formats, and types of
 * what a port returns and fails closed when a port misbehaves.
 */

/**
 * Minimal cancellation signal. A WHATWG AbortSignal satisfies this interface, and so does the
 * core's own CancelSource signal, so hosts can bridge either way.
 */
export interface CancelSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export type HttpMethod = 'GET' | 'POST' | 'DELETE';

/**
 * One HTTP request built by the core.
 *
 * - `url` is an absolute https URL. The core decides it; a transport must not rewrite it.
 * - `headers` are complete. The transport adds nothing except what the HTTP stack itself requires
 *   (for example Host and Content-Length).
 * - `body` is always UTF-8 bytes produced by the core, so byte caps apply to exactly what is sent.
 *   String bodies are deliberately not part of this contract.
 * - `signal` aborts the request; the transport must stop reading and reject promptly.
 */
export interface TransportRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Uint8Array;
  readonly signal?: CancelSignal;
}

/**
 * The transport's answer.
 *
 * - `status` is the HTTP status code. Non-2xx statuses are returned, not thrown, so the core can
 *   map them to fixed error codes.
 * - `headers` use lower-case names. Repeated headers are joined with ", ".
 * - `body` is either the complete body or an async iterable of chunks (for server-sent events).
 *   The core reads it with its own byte cap (readBounded) and never trusts a declared length.
 */
export interface TransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array | AsyncIterable<Uint8Array>;
}

/**
 * HTTPS transport. Implementations must validate server certificates, must not follow redirects,
 * must not add credentials or cookies of their own, and must reject (not resolve) on network
 * failure or cancellation. The core decides every request before it reaches this port: OpenAI
 * requests are built only by the send capability (outbound.ts: the five allowlisted method and
 * path pairs on https://api.openai.com, fixed headers, the per-body byte cap), and the search
 * pipeline's view of this port accepts only GET requests to the ClinicalTrials.gov API
 * (dispatcher.ts). Task A1b's transport gate re-checks the invariants around the port itself.
 */
export interface Transport {
  request(request: TransportRequest): Promise<TransportResponse>;
}

/** SHA-256 over bytes, returned as 64 lower-case hex characters. May be synchronous or async. */
export interface Sha256 {
  digestHex(bytes: Uint8Array): string | Promise<string>;
}

/**
 * Cryptographically strong random bytes from the operating system (for example
 * crypto.randomBytes in Node or the platform generator on mobile). The core derives consent
 * tokens and credential request IDs from these bytes and rejects outputs of the wrong length.
 */
export interface TokenSource {
  randomBytes(length: number): Uint8Array | Promise<Uint8Array>;
}

/**
 * Time and timers.
 *
 * - `now()` is wall-clock time in integer milliseconds since the Unix epoch. It is used only for
 *   user-visible timestamps such as expiresAt and retrievedAt.
 * - `monotonic()` is a non-decreasing millisecond counter unaffected by wall-clock changes. Expiry
 *   decisions use it, so changing the system clock cannot extend a consent window.
 * - `schedule(delayMs, callback)` runs callback once after delayMs and returns a function that
 *   cancels it. Hosts should not let these timers keep a process alive (Node: unref).
 */
export interface Clock {
  now(): number;
  monotonic(): number;
  schedule(delayMs: number, callback: () => void): () => void;
}

/**
 * Bounded loading of resources bundled with the app (for example a public ZIP-centroid table).
 * `resourceId` is a short identifier from the core's own allowlist, never a path. The loader maps
 * it to bundled bytes and must reject when the resource is larger than `maxBytes`. The core checks
 * size again and verifies a pinned SHA-256 when one is known (see resources.ts).
 */
export interface Loader {
  load(resourceId: string, maxBytes: number, signal?: CancelSignal): Promise<Uint8Array>;
}

export interface CorePorts {
  readonly transport: Transport;
  readonly sha256: Sha256;
  readonly tokens: TokenSource;
  readonly clock: Clock;
  readonly loader: Loader;
}

function hasMethod(value: unknown, name: string): boolean {
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)[name] === 'function';
}

/** Fails closed when a host forgets a port or passes the wrong shape. */
export function assertPorts(ports: unknown): CorePorts {
  const p = ports as Partial<Record<keyof CorePorts, unknown>> | null | undefined;
  const ok =
    typeof p === 'object' &&
    p !== null &&
    hasMethod(p.transport, 'request') &&
    hasMethod(p.sha256, 'digestHex') &&
    hasMethod(p.tokens, 'randomBytes') &&
    hasMethod(p.clock, 'now') &&
    hasMethod(p.clock, 'monotonic') &&
    hasMethod(p.clock, 'schedule') &&
    hasMethod(p.loader, 'load');
  if (!ok) throw new TypeError('Treatable core requires transport, sha256, tokens, clock, and loader ports.');
  return p as CorePorts;
}
