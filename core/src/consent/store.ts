/**
 * Prepared-consent store: pinned payloads, SHA-256 digests, five-minute one-use tokens, and
 * invalidation on any mutation.
 *
 * Runtime-neutral port of PreparedRealStore (extension/native/real.mjs at commit 48c569e). The
 * reviewed semantics are kept:
 *   - prepare() pins an exact, deep-frozen preview and returns a fresh copy with an opaque random
 *     token, a SHA-256 digest over the policy version and the preview, and an expiry time;
 *   - only one preparation is active; preparing again, revoking, cancelling, any invalid request,
 *     or any mutation clears it, and clearing calls onInvalidate (the dispatcher aborts in-flight
 *     real operations there);
 *   - take() checks the policy receipt, expiry, token, digest, and operation, and lets each
 *     authorized operation run once; failures make no provider request because nothing is
 *     returned;
 *   - a timer clears the preparation when the five minutes end.
 *
 * Generalized for the apps:
 *   - the store is generic over a pinned subject digest (the dispatcher pins the digest of the
 *     session's current record set); take() requires the current subject digest to equal the pinned
 *     one, and a mismatch clears the preparation;
 *   - the preparation names the operations it authorizes (score, agent, or both);
 *   - the preparation also pins the SHA-256 of every exact byte string the dispatcher may send for
 *     it (ConsentPins, computed by outbound.ts computeRequestPins). The consent digest covers the
 *     pins, so a receipt binds the bytes allowed on the wire, not only the JSON values shown;
 *   - the digest is SHA-256 over the RFC 8785 canonical JSON of
 *     { operations, pins, policyVersion, preview, subjectDigest }, computed through the injected port;
 *   - time, tokens, and hashing come from injected ports; expiry uses the monotonic clock;
 *   - a take() without a live preparation reports CONSENT_EXPIRED only when the last preparation
 *     ended by timing out, and INVALID_CONSENT_RECEIPT otherwise (the extension always reported
 *     CONSENT_EXPIRED there).
 *
 * Clearing rules (a deliberate divergence from real.mjs and host.mjs at 48c569e, which kept the
 * preparation after a wrong token, digest, or operation in take() and after a mismatched token in
 * revoke()):
 *   - every take() that fails while a preparation is active clears it: an invalid policy receipt, a
 *     wrong token, a wrong digest, an operation that is unknown, not authorized, or already used, and
 *     a changed subject. Expiry clears it as before. Only a take() with no active preparation has
 *     nothing to clear. This makes "any invalid request clears the preparation" hold for receipts
 *     too: a guesser gets one try per preparation, and a replayed or confused receipt ends the
 *     consent instead of leaving it usable. The cost is that a host mistake such as executing the
 *     same operation twice also discards the other authorized operation; the user prepares again;
 *   - revoke() always clears. With a token that is not a string or does not match the active
 *     preparation it still reports INVALID_CONSENT_RECEIPT, so the host learns its token was stale,
 *     but the preparation is gone either way, because a revoke expresses the user's withdrawal and
 *     must fail closed.
 * Errors are CoreError codes only and never include tokens, digests, or payload content.
 */
import { base64UrlEncode, constantTimeEqual, isHex64, utf8ByteLength, utf8Encode } from '../bytes.ts';
import { CoreError } from '../errors.ts';
import { canonicalJson, deepFreeze, isJsonObject, jsonClone, type JsonObject } from '../json.ts';
import type { Clock, Sha256, TokenSource } from '../ports.ts';
import {
  CONSENT_POLICY_VERSION,
  PREPARED_TTL_MS,
  isConsentOperation,
  parsePolicyReceipt,
  type ConsentOperation,
} from './policy.ts';

export const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface ConsentDeps {
  readonly sha256: Sha256;
  readonly tokens: TokenSource;
  readonly clock: Clock;
}

export interface ConsentStoreOptions {
  /** Defaults to PREPARED_TTL_MS. Tests may shorten it; it is never longer than five minutes. */
  readonly ttlMs?: number;
  /** Upper bound for the serialized prepared reply (PREVIEW_TOO_LARGE above it). */
  readonly maxReplyBytes: number;
  /** Called on every clear, expiry, and close. */
  readonly onInvalidate?: () => void;
}

/**
 * SHA-256 hex digests of the exact byte strings the dispatcher may send for this preparation: one
 * per Decisions body in preview order, one for the Agents create body (null when the preview has
 * none), and one per tool result output string in preview order. Each byte string is the canonical
 * serialization of the corresponding preview object, so the pins add no data of their own; they
 * bind the consent to the serialization that goes on the wire. take() hands the pins to the
 * dispatcher, whose send capability serializes the frozen body again and compares its SHA-256 with
 * the pin immediately before every send.
 */
export interface ConsentPins {
  readonly decisionsRequests: readonly string[];
  readonly agentsCreate: string | null;
  readonly toolResults: readonly string[];
}

/** Internal sanity bound, far above the contract maxima (10 Decisions bodies, 2 tool results). */
const PIN_ARRAY_MAX = 16;

export function isValidConsentPins(pins: unknown): pins is ConsentPins {
  if (typeof pins !== 'object' || pins === null || Array.isArray(pins)) return false;
  const p = pins as Record<string, unknown>;
  const hexArray = (value: unknown): value is readonly string[] =>
    Array.isArray(value) && value.length <= PIN_ARRAY_MAX && value.every(isHex64);
  return hexArray(p.decisionsRequests) && hexArray(p.toolResults) && (p.agentsCreate === null || isHex64(p.agentsCreate));
}

export interface PrepareInput {
  readonly policyReceipt: unknown;
  readonly subjectDigest: string;
  readonly operations: readonly ConsentOperation[];
  readonly preview: JsonObject;
  readonly pins: ConsentPins;
}

export interface PreparedConsent {
  readonly token: string;
  readonly digest: string;
  readonly expiresAt: number;
  readonly policyVersion: typeof CONSENT_POLICY_VERSION;
  readonly subjectDigest: string;
  readonly operations: ConsentOperation[];
  readonly preview: JsonObject;
}

export interface TakeInput {
  readonly policyReceipt: unknown;
  readonly token: unknown;
  readonly digest: unknown;
  readonly operation: unknown;
  /** The subject digest of the session right now (undefined when the session has no subject). */
  readonly subjectDigest: string | undefined;
}

export interface PinnedConsent {
  readonly operation: ConsentOperation;
  readonly consentDigest: string;
  readonly subjectDigest: string;
  /** Deep-frozen; the exact objects whose serialization is sent. */
  readonly preview: Readonly<JsonObject>;
  /** Digests of the exact serialized bodies; dispatcher-use only, never shown. */
  readonly pins: ConsentPins;
}

export interface ConsentSnapshot {
  readonly active: boolean;
  readonly remaining: readonly ConsentOperation[];
}

export interface ConsentStore {
  prepare(input: PrepareInput): Promise<PreparedConsent>;
  take(input: TakeInput): PinnedConsent;
  revoke(token?: unknown): void;
  /** Invalidates any preparation (used for every mutation, cancel, and invalid request). */
  clear(): void;
  /** Clears and permanently disables the store (endSession). */
  close(): void;
  snapshot(): ConsentSnapshot;
  /** Changes whenever the store is cleared; lets callers detect a clear across an await. */
  generation(): number;
}

/** SHA-256 (via the port) over the canonical JSON of the consented content. Exported for independent recomputation. */
export async function computeConsentDigest(
  sha256: Sha256,
  content: {
    readonly policyVersion: string;
    readonly subjectDigest: string;
    readonly operations: readonly ConsentOperation[];
    readonly preview: JsonObject;
    readonly pins: ConsentPins;
  },
): Promise<string> {
  const canonical = canonicalJson({
    operations: [...content.operations],
    pins: {
      agentsCreate: content.pins.agentsCreate,
      decisionsRequests: [...content.pins.decisionsRequests],
      toolResults: [...content.pins.toolResults],
    },
    policyVersion: content.policyVersion,
    preview: content.preview,
    subjectDigest: content.subjectDigest,
  });
  const digest = await sha256.digestHex(utf8Encode(canonical));
  if (!isHex64(digest)) throw new CoreError('INTERNAL_ERROR');
  return digest;
}

interface ActivePreparation {
  readonly token: string;
  readonly digest: string;
  readonly subjectDigest: string;
  readonly operations: ReadonlySet<ConsentOperation>;
  readonly used: Set<ConsentOperation>;
  readonly expiresMonotonic: number;
  readonly preview: Readonly<JsonObject>;
  readonly pins: ConsentPins;
}

function validOperations(value: readonly unknown[]): value is readonly ConsentOperation[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 2 &&
    new Set(value).size === value.length &&
    value.every(isConsentOperation)
  );
}

export function createConsentStore(deps: ConsentDeps, options: ConsentStoreOptions): ConsentStore {
  const ttl = options.ttlMs ?? PREPARED_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > PREPARED_TTL_MS) throw new CoreError('INTERNAL_ERROR');
  if (!Number.isSafeInteger(options.maxReplyBytes) || options.maxReplyBytes <= 0) throw new CoreError('INTERNAL_ERROR');
  const onInvalidate = options.onInvalidate ?? (() => {});

  let active: ActivePreparation | undefined;
  let cancelTimer: (() => void) | undefined;
  let epoch = 0;
  let endedByExpiry = false;
  let closed = false;

  function reset(expired: boolean): void {
    const cancel = cancelTimer;
    cancelTimer = undefined;
    active = undefined;
    epoch += 1;
    endedByExpiry = expired;
    if (cancel) {
      try {
        cancel();
      } catch {
        // A failing timer port must not keep the preparation alive; it is already dropped.
      }
    }
    try {
      onInvalidate();
    } catch {
      // Invalidation hooks must not block clearing.
    }
  }

  function clear(): void {
    reset(false);
  }

  function now(kind: 'now' | 'monotonic'): number {
    const value = kind === 'now' ? deps.clock.now() : deps.clock.monotonic();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new CoreError('INTERNAL_ERROR');
    return value;
  }

  async function prepare(input: PrepareInput): Promise<PreparedConsent> {
    if (closed) throw new CoreError('CANCELLED');
    // Any preparation attempt replaces the previous one, as in the extension (prepare, then host clear on failure).
    clear();
    const myEpoch = epoch;
    try {
      parsePolicyReceipt(input.policyReceipt, 'INVALID_REQUEST');
      if (!isHex64(input.subjectDigest) || !validOperations(input.operations)) throw new CoreError('INTERNAL_ERROR');
      if (!isJsonObject(input.preview)) throw new CoreError('INTERNAL_ERROR');
      if (!isValidConsentPins(input.pins)) throw new CoreError('INTERNAL_ERROR');
      const operations = [...input.operations];
      const preview = deepFreeze(jsonClone(input.preview));
      const pins: ConsentPins = deepFreeze({
        decisionsRequests: [...input.pins.decisionsRequests],
        agentsCreate: input.pins.agentsCreate,
        toolResults: [...input.pins.toolResults],
      });
      const digest = await computeConsentDigest(deps.sha256, {
        policyVersion: CONSENT_POLICY_VERSION,
        subjectDigest: input.subjectDigest,
        operations,
        preview,
        pins,
      });
      const bytes = await deps.tokens.randomBytes(TOKEN_BYTES);
      if (!(bytes instanceof Uint8Array) || bytes.length !== TOKEN_BYTES || bytes.every(b => b === bytes[0])) {
        throw new CoreError('INTERNAL_ERROR');
      }
      const token = base64UrlEncode(bytes);
      if (!TOKEN_PATTERN.test(token)) throw new CoreError('INTERNAL_ERROR');
      const expiresAt = now('now') + ttl;
      if (!Number.isSafeInteger(expiresAt)) throw new CoreError('INTERNAL_ERROR');
      const expiresMonotonic = now('monotonic') + ttl;
      const reply: PreparedConsent = {
        token,
        digest,
        expiresAt,
        policyVersion: CONSENT_POLICY_VERSION,
        subjectDigest: input.subjectDigest,
        operations,
        preview: jsonClone(preview),
      };
      if (utf8ByteLength(JSON.stringify(reply)) > options.maxReplyBytes) throw new CoreError('PREVIEW_TOO_LARGE');
      // A clear, revoke, mutation, or close while hashing means the user changed something: do not pin.
      if (closed || epoch !== myEpoch) throw new CoreError('CANCELLED');
      active = {
        token,
        digest,
        subjectDigest: input.subjectDigest,
        operations: new Set(operations),
        used: new Set(),
        expiresMonotonic,
        preview,
        pins,
      };
      endedByExpiry = false;
      cancelTimer = deps.clock.schedule(ttl, () => {
        if (epoch === myEpoch && active?.token === token) reset(true);
      });
      return reply;
    } catch (error) {
      if (epoch === myEpoch) clear();
      throw error instanceof CoreError ? error : new CoreError('INTERNAL_ERROR');
    }
  }

  function take(input: TakeInput): PinnedConsent {
    const current = active;
    // Every failure while a preparation is active clears it (see the clearing rules in the header).
    function reject(code: 'INVALID_CONSENT_RECEIPT' | 'CONSENT_EXPIRED'): never {
      if (current !== undefined && active === current) reset(code === 'CONSENT_EXPIRED');
      throw new CoreError(code);
    }
    let receiptOk = true;
    try {
      parsePolicyReceipt(input.policyReceipt, 'INVALID_CONSENT_RECEIPT');
    } catch {
      receiptOk = false;
    }
    if (!receiptOk) reject('INVALID_CONSENT_RECEIPT');
    if (!current) throw new CoreError(endedByExpiry ? 'CONSENT_EXPIRED' : 'INVALID_CONSENT_RECEIPT');
    if (current.expiresMonotonic <= now('monotonic')) reject('CONSENT_EXPIRED');
    const tokenOk = typeof input.token === 'string' && constantTimeEqual(input.token, current.token);
    const digestOk = typeof input.digest === 'string' && constantTimeEqual(input.digest, current.digest);
    if (!tokenOk || !digestOk) reject('INVALID_CONSENT_RECEIPT');
    const operation = input.operation;
    if (!isConsentOperation(operation) || !current.operations.has(operation) || current.used.has(operation)) {
      reject('INVALID_CONSENT_RECEIPT');
    }
    if (input.subjectDigest === undefined || !constantTimeEqual(input.subjectDigest, current.subjectDigest)) {
      reject('INVALID_CONSENT_RECEIPT');
    }
    current.used.add(operation);
    return {
      operation,
      consentDigest: current.digest,
      subjectDigest: current.subjectDigest,
      preview: current.preview,
      pins: current.pins,
    };
  }

  function revoke(token?: unknown): void {
    // A revoke always clears; a token that is not a string or names another preparation is still
    // reported (see the clearing rules in the header).
    const mismatch = token !== undefined && (typeof token !== 'string' || (active !== undefined && !constantTimeEqual(token, active.token)));
    clear();
    if (mismatch) throw new CoreError('INVALID_CONSENT_RECEIPT');
  }

  return {
    prepare,
    take,
    revoke,
    clear,
    close() {
      closed = true;
      clear();
    },
    snapshot() {
      const current = active;
      if (!current) return { active: false, remaining: [] };
      return { active: true, remaining: [...current.operations].filter(op => !current.used.has(op)) };
    },
    generation: () => epoch,
  };
}
