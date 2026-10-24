/**
 * The core's single entry point: createCore(ports, options).handle(request).
 *
 * Port of the request handling in extension/native/host.mjs at commit 48c569e, without Chrome
 * origin checks, stdio framing, or Keychain access (those belong to the hosts):
 *   - every request is copied through JSON, size-checked, and validated with the strict protocol
 *     schemas before anything else happens; invalid or duplicate requests clear prepared consent
 *     and get a constant-shape INVALID_REQUEST error;
 *   - status, cancel, revokeReal, and endSession always answer; long operations answer BUSY while
 *     another one runs;
 *   - executeReal checks the consent receipt before it asks the host for a credential, and the
 *     credential is requested at most once, only for that confirmed operation;
 *   - clearing consent aborts running real-data operations;
 *   - every response and event is validated against the protocol schemas and size bounds before it
 *     leaves the core, and a response or event that contains the credential is replaced by an
 *     error.
 * Operations owned by later tasks (screenLocal: A1b, provider execution: A4, credential flow
 * details: A6b) answer NOT_IMPLEMENTED until their pipelines are wired in. Pipelines never replace
 * the consent checks in this file.
 *
 * Task A2 wires two built-in pipelines (see the "A2 built-ins" block in createCore): searchTrials is
 * the live ClinicalTrials.gov search (src/ctgov), and the prepareReal builder is record-set pinning
 * (src/pinning). Both are wired only in 'live' mode, the mode that declares the transport port
 * reaches the real network; mocked and test cores stay NOT_IMPLEMENTED unless the host passes
 * pipelines. Hosts may still pass their own pipelines (tests do), but prepareReal always runs
 * verifyPinnedPreview on the built preview, so no builder can bypass the session record-set pin
 * (docs/apps/record-set-pinning.md).
 */
import { base64UrlEncode, utf8ByteLength } from './bytes.ts';
import type { PinnedConsent } from './consent/store.ts';
import { CoreError, errorCodeOf, isCoreError, type ErrorCode } from './errors.ts';
import { isJsonObject, jsonEqual, type JsonValue } from './json.ts';
import { assertPorts, type CancelSignal, type CorePorts } from './ports.ts';
import {
  CONSENT_POLICY_VERSION,
  CONTRACT_VERSION,
  CredentialRequestSchema,
  CredentialResponseSchema,
  DELIVERY_POLICY,
  EventSchema,
  ExecuteRealResultSchema,
  MAX_MESSAGE_BYTES,
  MODES,
  ModelPacketSchema,
  OK_RESPONSE_SCHEMAS,
  OPERATIONS,
  PreviewSchema,
  REQUEST_OPS,
  REQUEST_ID_PATTERN,
  RUNTIMES,
  operationsForPacket,
  parseRequest,
  responseBudget,
  type CoreEvent,
  type CoreRequest,
  type CoreResponse,
  type CredentialRequest,
  type ErrorResponse,
  type ExecuteRealResult,
  type Mode,
  type ModelPacket,
  type Operation,
  type OperationResult,
  type Preview,
  type RequestOp,
  type RequestPayload,
  type Runtime,
  type TraceEvent,
} from './protocol.ts';
import { createSession, type Session } from './session.ts';
import { createSearchTrialsPipeline } from './ctgov/search.ts';
import { buildPinnedPreview, verifyPinnedPreview } from './pinning/preview.ts';

/** Host side of credential.request. The desktop helper forwards it over stdio; the mobile app reads the platform credential store. */
export interface CredentialBroker {
  request(message: CredentialRequest, signal: CancelSignal): Promise<unknown>;
}

export interface HandlerContext {
  readonly requestId: string;
  readonly ports: CorePorts;
  readonly session: Session;
  readonly mode: Mode;
  readonly signal: CancelSignal;
}

export type TraceInput = Omit<TraceEvent, 'seq' | 'operation' | 'mode' | 'elapsedMs'>;

export interface ExecuteContext extends HandlerContext {
  /** The consented, deep-frozen payloads. Send exactly these bodies. */
  readonly pinned: PinnedConsent;
  readonly packet: ModelPacket;
  /** Emits one validated trace event; throws INTERNAL_ERROR for an invalid event. */
  emitTrace(input: TraceInput): void;
  /** Asks the host for the user's OpenAI key. Allowed once per confirmed operation. */
  requestCredential(): Promise<string>;
}

export interface PreparedBuild {
  /** Must satisfy PreviewSchema, and its packet must equal the requested packet. */
  readonly preview: Preview;
  readonly context?: JsonValue;
}

export interface Pipelines {
  searchTrials(ctx: HandlerContext, payload: RequestPayload<'searchTrials'>): Promise<OperationResult<'searchTrials'>>;
  screenLocal(ctx: HandlerContext, payload: RequestPayload<'screenLocal'>): Promise<OperationResult<'screenLocal'>>;
  buildPreview(ctx: HandlerContext, packet: ModelPacket): Promise<PreparedBuild>;
  executeReal(ctx: ExecuteContext): Promise<ExecuteRealResult>;
}

export interface CoreOptions {
  /** 'live' only when the transport port reaches the real network; tests and fakes use 'mocked'. */
  readonly mode: Mode;
  readonly runtime: Runtime;
  readonly credentials?: CredentialBroker;
  /**
   * Implementations for operations owned by later tasks. Omitted pipelines answer NOT_IMPLEMENTED.
   * Request validation, BUSY handling, consent preparation and receipt checks, credential gating,
   * and output validation stay in the dispatcher and cannot be replaced.
   */
  readonly pipelines?: Partial<Pipelines>;
  /** Consent lifetime override for tests (at most PREPARED_TTL_MS). */
  readonly consentTtlMs?: number;
}

export interface HandleOptions {
  /** Receives trace events for this request before its response resolves. */
  readonly onEvent?: (event: CoreEvent) => void;
}

export interface Core {
  readonly contractVersion: string;
  handle(request: unknown, options?: HandleOptions): Promise<CoreResponse>;
}

const CREDENTIAL_ID_BYTES = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function replyIdOf(raw: unknown): string {
  const id = isRecord(raw) ? raw.id : undefined;
  return typeof id === 'string' && REQUEST_ID_PATTERN.test(id) ? id : 'invalid';
}

function opOf(raw: unknown): RequestOp | undefined {
  const op = isRecord(raw) ? raw.op : undefined;
  return typeof op === 'string' && (REQUEST_OPS as readonly string[]).includes(op) ? (op as RequestOp) : undefined;
}

function errorResponse(id: string, op: RequestOp | undefined, code: ErrorCode): ErrorResponse {
  return { v: CONTRACT_VERSION, type: 'response', id, ...(op !== undefined ? { op } : {}), ok: false, error: { code } };
}

function containsSecret(value: unknown, secrets: ReadonlySet<string>): boolean {
  if (!secrets.size) return false;
  const text = JSON.stringify(value);
  for (const secret of secrets) if (text.includes(secret)) return true;
  return false;
}

export function createCore(portsInput: CorePorts, options: CoreOptions): Core {
  const ports = assertPorts(portsInput);
  if (!(MODES as readonly string[]).includes(options?.mode) || !(RUNTIMES as readonly string[]).includes(options?.runtime)) {
    throw new TypeError('Treatable core requires a mode and a runtime.');
  }
  // A2 built-ins, live mode only: the live ClinicalTrials.gov search and the record-set pinned
  // preview builder. In 'mocked' and 'test' modes nothing is wired, so a host with a fake transport
  // can never start a live search by mistake.
  const builtins: Partial<Pipelines> =
    options.mode === 'live'
      ? {
          searchTrials: createSearchTrialsPipeline(ports),
          buildPreview: async (ctx, packet) => buildPinnedPreview(ctx.session, packet),
        }
      : {};
  const pipelines: Partial<Pipelines> = { ...builtins, ...(options.pipelines ?? {}) };
  const sessionOptions = options.consentTtlMs !== undefined ? { ttlMs: options.consentTtlMs } : {};
  let session = createSession(ports, sessionOptions);

  function okResponse<Op extends RequestOp>(
    s: Session,
    id: string,
    op: Op,
    result: unknown,
    secrets?: ReadonlySet<string>,
  ): CoreResponse {
    const parsed = OK_RESPONSE_SCHEMAS[op].safeParse({ v: CONTRACT_VERSION, type: 'response', id, op, ok: true, result });
    let code: ErrorCode | undefined;
    if (!parsed.success) code = 'INTERNAL_ERROR';
    else if (utf8ByteLength(JSON.stringify(parsed.data)) > responseBudget(op)) code = 'OUTPUT_TOO_LARGE';
    else if (secrets && containsSecret(parsed.data, secrets)) code = 'INTERNAL_ERROR';
    if (code !== undefined || !parsed.success) {
      // Fail closed: nothing unvalidated leaves the core, and no preparation survives a failed reply.
      s.consent.clear();
      return errorResponse(id, op, code ?? 'INTERNAL_ERROR');
    }
    return parsed.data as CoreResponse;
  }

  function status(): OperationResult<'status'> {
    const snapshot = session.consent.snapshot();
    const state = (ready: boolean) => (ready ? 'ready' : 'not_implemented') as 'ready' | 'not_implemented';
    const operations = Object.fromEntries(OPERATIONS.map(op => [op, state(true)])) as Record<Operation, 'ready' | 'not_implemented'>;
    operations.searchTrials = state(!!pipelines.searchTrials);
    operations.screenLocal = state(!!pipelines.screenLocal);
    operations.prepareReal = state(!!pipelines.buildPreview);
    operations.executeReal = state(!!pipelines.executeReal);
    operations['credential.request'] = state(!!options.credentials);
    return {
      contractVersion: CONTRACT_VERSION,
      policyVersion: CONSENT_POLICY_VERSION,
      mode: options.mode,
      runtime: options.runtime,
      session: { prepared: snapshot.active, pending: session.pendingCount(), requests: session.requestCount() },
      operations,
    };
  }

  function context(s: Session, requestId: string, signal: CancelSignal): HandlerContext {
    return { requestId, ports, session: s, mode: options.mode, signal };
  }

  async function runPlain<Op extends 'searchTrials' | 'screenLocal'>(
    s: Session,
    id: string,
    op: Op,
    payload: RequestPayload<Op>,
  ): Promise<CoreResponse> {
    const pipeline = pipelines[op] as ((ctx: HandlerContext, p: RequestPayload<Op>) => Promise<unknown>) | undefined;
    if (!pipeline) return errorResponse(id, op, 'NOT_IMPLEMENTED');
    if (s.pendingCount()) return errorResponse(id, op, 'BUSY');
    const pending = s.begin(id, { real: false });
    try {
      const result = await pipeline(context(s, id, pending.signal), payload);
      if (pending.signal.aborted) return errorResponse(id, op, 'CANCELLED');
      return okResponse(s, id, op, result);
    } catch (error) {
      return errorResponse(id, op, pending.signal.aborted ? 'CANCELLED' : errorCodeOf(error));
    } finally {
      pending.end();
    }
  }

  async function prepareReal(s: Session, id: string, payload: RequestPayload<'prepareReal'>): Promise<CoreResponse> {
    const build = pipelines.buildPreview;
    if (!build) return errorResponse(id, 'prepareReal', 'NOT_IMPLEMENTED');
    if (s.pendingCount()) return errorResponse(id, 'prepareReal', 'BUSY');
    // Preparing again supersedes the previous preparation immediately.
    s.consent.clear();
    const generation = s.consent.generation();
    const subject = s.subjectDigest();
    const pending = s.begin(id, { real: false });
    try {
      if (subject === undefined) throw new CoreError('RECORD_NOT_IN_SESSION');
      const packet = ModelPacketSchema.parse(payload.packet);
      const built = await build(context(s, id, pending.signal), packet);
      if (pending.signal.aborted) throw new CoreError('CANCELLED');
      if (!isRecord(built) || !isJsonObject(built.preview)) throw new CoreError('INTERNAL_ERROR');
      const preview = PreviewSchema.safeParse(built.preview);
      if (!preview.success || !jsonEqual(preview.data.packet, packet) || !jsonEqual(preview.data.delivery, DELIVERY_POLICY)) {
        throw new CoreError('INTERNAL_ERROR');
      }
      // A2 record-set pinning, enforced for every builder: the preview must equal the one derived
      // from the pinned session records (membership, condition term, exact public study fields).
      verifyPinnedPreview(s, packet, built.preview);
      // Anything that cleared consent or changed the subject while building wins over this preparation.
      if (s.consent.generation() !== generation || s.subjectDigest() !== subject) throw new CoreError('CANCELLED');
      const prepared = await s.consent.prepare({
        policyReceipt: payload.policyReceipt,
        subjectDigest: subject,
        operations: operationsForPacket(packet),
        preview: built.preview,
        ...(built.context !== undefined ? { context: built.context } : {}),
      });
      if (pending.signal.aborted) throw new CoreError('CANCELLED');
      return okResponse(s, id, 'prepareReal', prepared);
    } catch (error) {
      s.consent.clear();
      return errorResponse(id, 'prepareReal', pending.signal.aborted ? 'CANCELLED' : errorCodeOf(error));
    } finally {
      pending.end();
    }
  }

  function checkExecuteResult(result: unknown, pinned: PinnedConsent, packet: ModelPacket): ExecuteRealResult {
    const parsed = ExecuteRealResultSchema.safeParse(result);
    if (!parsed.success) throw new CoreError('INVALID_API_RESPONSE');
    const value = parsed.data;
    const expectedKind = pinned.operation === 'score' ? 'scoreReal' : 'agentReal';
    if (value.kind !== expectedKind || value.consentDigest !== pinned.consentDigest || value.mode !== options.mode) {
      throw new CoreError('INVALID_API_RESPONSE');
    }
    const ids = value.kind === 'scoreReal' ? value.scores.map(s => s.nctId) : value.comparisons.map(c => c.nctId);
    const expected = (pinned.operation === 'score' ? packet.scoreNctIds : packet.agentNctIds) ?? [];
    if (!jsonEqual([...ids].sort(), [...expected].sort())) throw new CoreError('INVALID_API_RESPONSE');
    return value;
  }

  async function executeReal(
    s: Session,
    id: string,
    payload: RequestPayload<'executeReal'>,
    handleOptions: HandleOptions,
  ): Promise<CoreResponse> {
    const run = pipelines.executeReal;
    if (!run) return errorResponse(id, 'executeReal', 'NOT_IMPLEMENTED');
    if (s.pendingCount()) return errorResponse(id, 'executeReal', 'BUSY');
    let pinned: PinnedConsent;
    let packet: ModelPacket;
    try {
      // The receipt is checked before anything else: invalid, stale, expired, replayed, or revoked
      // receipts never reach a credential request or a provider.
      pinned = s.consent.take({
        policyReceipt: payload.policyReceipt,
        token: payload.token,
        digest: payload.digest,
        operation: payload.operation,
        subjectDigest: s.subjectDigest(),
      });
      packet = ModelPacketSchema.parse((pinned.preview as { packet: unknown }).packet);
    } catch (error) {
      return errorResponse(id, 'executeReal', errorCodeOf(error, 'INVALID_CONSENT_RECEIPT'));
    }
    const pending = s.begin(id, { real: true });
    const started = ports.clock.monotonic();
    const secrets = new Set<string>();
    let seq = 0;
    let credentialRequested = false;

    const emitTrace = (input: TraceInput): void => {
      const elapsed = Math.max(0, Math.min(600_000, Math.round(ports.clock.monotonic() - started)));
      const event = {
        v: CONTRACT_VERSION,
        type: 'event',
        id,
        event: 'trace',
        trace: { ...input, seq: (seq += 1), operation: pinned.operation, mode: options.mode, elapsedMs: elapsed },
      };
      const parsed = EventSchema.safeParse(event);
      if (!parsed.success || utf8ByteLength(JSON.stringify(parsed.data)) > MAX_MESSAGE_BYTES || containsSecret(parsed.data, secrets)) {
        throw new CoreError('INTERNAL_ERROR');
      }
      try {
        handleOptions.onEvent?.(parsed.data);
      } catch {
        // A failing event sink must not change the operation's outcome.
      }
    };

    const requestCredential = async (): Promise<string> => {
      if (credentialRequested) throw new CoreError('INTERNAL_ERROR');
      credentialRequested = true;
      const broker = options.credentials;
      if (!broker) throw new CoreError('KEY_MISSING');
      if (pending.signal.aborted) throw new CoreError('CANCELLED');
      const idBytes = await ports.tokens.randomBytes(CREDENTIAL_ID_BYTES);
      if (!(idBytes instanceof Uint8Array) || idBytes.length !== CREDENTIAL_ID_BYTES) throw new CoreError('INTERNAL_ERROR');
      const message = CredentialRequestSchema.parse({
        v: CONTRACT_VERSION,
        type: 'credential.request',
        id: base64UrlEncode(idBytes),
        forRequestId: id,
        provider: 'openai',
        operation: pinned.operation,
        consentDigest: pinned.consentDigest,
      });
      let raw: unknown;
      try {
        raw = await broker.request(message, pending.signal);
      } catch {
        throw new CoreError(pending.signal.aborted ? 'CANCELLED' : 'CREDENTIAL_UNAVAILABLE');
      }
      if (pending.signal.aborted) throw new CoreError('CANCELLED');
      let text: string | undefined;
      try {
        text = JSON.stringify(raw);
      } catch {
        text = undefined;
      }
      if (typeof text !== 'string' || utf8ByteLength(text) > MAX_MESSAGE_BYTES) throw new CoreError('CREDENTIAL_UNAVAILABLE');
      const parsed = CredentialResponseSchema.safeParse(JSON.parse(text));
      if (!parsed.success || parsed.data.id !== message.id) throw new CoreError('CREDENTIAL_UNAVAILABLE');
      const answer = parsed.data;
      if (!answer.ok) {
        throw new CoreError(answer.code === 'KEY_MISSING' ? 'KEY_MISSING' : answer.code === 'DECLINED' ? 'CANCELLED' : 'CREDENTIAL_UNAVAILABLE');
      }
      secrets.add(answer.apiKey);
      return answer.apiKey;
    };

    try {
      const result = await run({
        ...context(s, id, pending.signal),
        pinned,
        packet,
        emitTrace,
        requestCredential,
      });
      if (pending.signal.aborted) throw new CoreError('CANCELLED');
      return okResponse(s, id, 'executeReal', checkExecuteResult(result, pinned, packet), secrets);
    } catch (error) {
      const code: ErrorCode = pending.signal.aborted ? 'CANCELLED' : isCoreError(error) ? error.code : 'INVALID_API_RESPONSE';
      try {
        emitTrace({ stage: 'result', outcome: code === 'CANCELLED' ? 'cancelled' : 'failed', code });
      } catch {
        // The failure response below is still sent.
      }
      return errorResponse(id, 'executeReal', code);
    } finally {
      secrets.clear();
      pending.end();
    }
  }

  function endSession(): void {
    const old = session;
    session = createSession(ports, sessionOptions);
    old.wipe();
  }

  async function dispatch(raw: unknown, handleOptions: HandleOptions): Promise<CoreResponse> {
    const replyId = replyIdOf(raw);
    const s = session;
    const invalid = (code: ErrorCode = 'INVALID_REQUEST', op: RequestOp | undefined = opOf(raw)): CoreResponse => {
      s.consent.clear();
      return errorResponse(replyId, op, code);
    };
    let request: CoreRequest;
    try {
      request = parseRequest(raw);
    } catch (error) {
      return invalid(errorCodeOf(error, 'INVALID_REQUEST'));
    }
    const seen = s.markSeen(request.id);
    if (seen === 'duplicate') return invalid('INVALID_REQUEST', request.op);
    // endSession is always accepted, so a full session can still be ended.
    if (seen === 'limit' && request.op !== 'endSession') return invalid('SESSION_LIMIT', request.op);

    switch (request.op) {
      case 'status':
        return okResponse(s, request.id, 'status', status());
      case 'endSession':
        endSession();
        return okResponse(session, request.id, 'endSession', { wiped: true });
      case 'cancel': {
        // As in host.mjs: cancel clears prepared consent and aborts the named operation.
        s.consent.clear();
        return okResponse(s, request.id, 'cancel', { aborted: s.cancel(request.payload.requestId) });
      }
      case 'revokeReal':
        try {
          s.consent.revoke(request.payload.token);
        } catch {
          return errorResponse(request.id, 'revokeReal', 'INVALID_CONSENT_RECEIPT');
        }
        return okResponse(s, request.id, 'revokeReal', { cleared: true });
      case 'searchTrials':
        return runPlain(s, request.id, 'searchTrials', request.payload);
      case 'screenLocal':
        return runPlain(s, request.id, 'screenLocal', request.payload);
      case 'prepareReal':
        return prepareReal(s, request.id, request.payload);
      case 'executeReal':
        return executeReal(s, request.id, request.payload, handleOptions);
      default:
        return invalid();
    }
  }

  return {
    contractVersion: CONTRACT_VERSION,
    async handle(raw, handleOptions = {}) {
      try {
        return await dispatch(raw, handleOptions);
      } catch {
        session.consent.clear();
        return errorResponse(replyIdOf(raw), opOf(raw), 'INTERNAL_ERROR');
      }
    },
  };
}

