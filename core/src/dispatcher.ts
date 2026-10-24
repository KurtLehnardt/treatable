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
 *
 * What pipelines can never replace or bypass (this file, records.ts, preview.ts, outbound.ts):
 *   - The session record index. After a searchTrials response has passed every output check, the
 *     dispatcher itself merges its records into the index, and the record-set digest becomes the
 *     consent subject. Pipelines get a read-only view.
 *   - The preview. prepareReal builds the exact preview itself from the packet and the held
 *     records, before consent.prepare and without any pipeline: every NCT ID in the packet must be a
 *     held record, the condition term must equal a conditions or meshTerms entry of a held record,
 *     and every study object is projectModelStudy of its held record; verifyPreviewAgainstRecords
 *     re-derives the preview and requires exact equality. There is no preview pipeline.
 *   - What is sent. The executeReal pipeline receives no ports, no session, no slots, and no
 *     credential. It gets the frozen consented preview, a trace emitter, and the OpenAI send
 *     capability, which sends only the pinned bytes of that preview to the allowlisted endpoints
 *     under the delivery policy, injects the credential itself, and records any out-of-policy
 *     attempt; such an attempt fails the operation.
 *   - What is reported. An executeReal result must match the consent (kind, digest, mode, studies)
 *     and what the capability saw happen: a scored or declined study needs a successful Decisions
 *     response for it, an Agents result needs a successful session create and exactly as many
 *     accepted tool results as it reports, and cleanup "deleted" needs an acknowledged DELETE.
 *   - Least privilege for the other pipelines. searchTrials gets a transport that accepts only
 *     GET https://clinicaltrials.gov/api/v2/... and rejects any request to api.openai.com;
 *     screenLocal gets no transport at all, and every NCT ID it is asked to screen must be held.
 * Operations owned by later tasks (searchTrials: A2, screenLocal: A1b, provider execution: A4,
 * credential flow details: A6b) answer NOT_IMPLEMENTED until their pipelines are wired in;
 * prepareReal answers NOT_IMPLEMENTED until an executeReal pipeline exists, because a preparation
 * could not be used.
 */
import { base64UrlEncode, utf8ByteLength } from './bytes.ts';
import type { PinnedConsent } from './consent/store.ts';
import type { ConsentOperation } from './consent/policy.ts';
import { CoreError, errorCodeOf, isCoreError, type ErrorCode } from './errors.ts';
import { deepFreeze, jsonClone, jsonEqual, type JsonObject } from './json.ts';
import { computeRequestPins, createOpenAISender, type OpenAISender, type SenderHandle, type SenderRecord } from './outbound.ts';
import {
  assertPorts,
  type CancelSignal,
  type Clock,
  type CorePorts,
  type Loader,
  type Sha256,
  type TokenSource,
  type Transport,
  type TransportRequest,
} from './ports.ts';
import { buildRecordPreview, verifyPreviewAgainstRecords } from './preview.ts';
import {
  CONSENT_POLICY_VERSION,
  CONTRACT_VERSION,
  CredentialRequestSchema,
  CredentialResponseSchema,
  EventSchema,
  ExecuteRealResultSchema,
  MAX_MESSAGE_BYTES,
  MODES,
  ModelPacketSchema,
  OK_RESPONSE_SCHEMAS,
  OPERATIONS,
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
import { assertRecordsFresh, type RecordIndexView } from './records.ts';
import { assertR4Packet, assertR4Preview } from './r4.ts';
import { createSearchTrialsPipeline } from './ctgov/search.ts';
import { createSession, type Session, type SessionSlots } from './session.ts';

/** Host side of credential.request. The desktop helper forwards it over stdio; the mobile app reads the platform credential store. */
export interface CredentialBroker {
  request(message: CredentialRequest, signal: CancelSignal): Promise<unknown>;
}

/** What every searchTrials or screenLocal pipeline receives. */
export interface PipelineContext {
  readonly requestId: string;
  readonly mode: Mode;
  readonly signal: CancelSignal;
  /** Read-only view of the session record index. */
  readonly records: RecordIndexView;
  /** Typed per-session storage (for example a search cursor or a parsed resource). */
  readonly slots: SessionSlots;
}

/** Ports without the transport (screenLocal needs none). */
export interface LocalPorts {
  readonly sha256: Sha256;
  readonly tokens: TokenSource;
  readonly clock: Clock;
  readonly loader: Loader;
}

/** searchTrials: the transport here reaches only GET https://clinicaltrials.gov/api/v2/... */
export interface SearchContext extends PipelineContext {
  readonly ports: LocalPorts & { readonly transport: Transport };
}

/** screenLocal: no transport. */
export interface ScreenContext extends PipelineContext {
  readonly ports: LocalPorts;
}

export type TraceInput = Omit<TraceEvent, 'seq' | 'operation' | 'mode' | 'elapsedMs'>;

/**
 * What an executeReal pipeline receives: the confirmed operation, its frozen consented data, a
 * trace emitter, and the OpenAI send capability. It receives no ports, session, slots, records, or
 * credential.
 */
export interface ExecuteContext {
  readonly requestId: string;
  readonly mode: Mode;
  readonly signal: CancelSignal;
  readonly operation: ConsentOperation;
  readonly consentDigest: string;
  /** Deep-frozen copy of the consented packet. */
  readonly packet: Readonly<ModelPacket>;
  /** The deep-frozen consented preview (read only; the capability sends from its own pinned copy). */
  readonly preview: Readonly<Preview>;
  readonly openai: OpenAISender;
  /** Emits one validated trace event; throws INTERNAL_ERROR for an invalid event. */
  emitTrace(input: TraceInput): void;
}

export interface Pipelines {
  searchTrials(ctx: SearchContext, payload: RequestPayload<'searchTrials'>): Promise<OperationResult<'searchTrials'>>;
  screenLocal(ctx: ScreenContext, payload: RequestPayload<'screenLocal'>): Promise<OperationResult<'screenLocal'>>;
  executeReal(ctx: ExecuteContext): Promise<ExecuteRealResult>;
}

const PIPELINE_NAMES: readonly string[] = ['searchTrials', 'screenLocal', 'executeReal'];

export interface CoreOptions {
  /** 'live' only when the transport port reaches the real network; tests and fakes use 'mocked'. */
  readonly mode: Mode;
  readonly runtime: Runtime;
  readonly credentials?: CredentialBroker;
  /**
   * Implementations for operations owned by later tasks. Omitted pipelines answer NOT_IMPLEMENTED.
   * Request validation, BUSY handling, the record index, preview building, consent preparation and
   * receipt checks, credential handling, the send capability, and output validation stay in the
   * core and cannot be replaced. Unknown pipeline names are rejected.
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
/** The only URL prefix the searchTrials transport may request. */
export const CTGOV_API_PREFIX = 'https://clinicaltrials.gov/api/v2/';

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

/**
 * The searchTrials transport: GET requests to the ClinicalTrials.gov API v2 only, with no body and
 * no headers other than Accept. Every other request, including any request to api.openai.com, is
 * rejected before the port is called, and no credential header can be attached. Task A1b's transport gate may wrap the underlying port too.
 */
export function ctgovOnlyTransport(transport: Transport): Transport {
  return Object.freeze({
    request(request: TransportRequest) {
      const url: unknown = request?.url;
      const headerNames = isRecord(request?.headers) ? Object.keys(request.headers) : undefined;
      if (
        request?.method !== 'GET' ||
        typeof url !== 'string' ||
        url.length > 2048 ||
        !url.startsWith(CTGOV_API_PREFIX) ||
        /[\s#@\\]/.test(url) ||
        url.includes('..') ||
        request.body !== undefined ||
        headerNames === undefined ||
        headerNames.some(name => name.toLowerCase() !== 'accept')
      ) {
        return Promise.reject(new CoreError('INVALID_ENDPOINT'));
      }
      return transport.request(request);
    },
  });
}

export function createCore(portsInput: CorePorts, options: CoreOptions): Core {
  const ports = assertPorts(portsInput);
  if (!(MODES as readonly string[]).includes(options?.mode) || !(RUNTIMES as readonly string[]).includes(options?.runtime)) {
    throw new TypeError('Treatable core requires a mode and a runtime.');
  }
  const supplied: Record<string, unknown> = isRecord(options.pipelines) ? options.pipelines : {};
  for (const [name, value] of Object.entries(supplied)) {
    if (!PIPELINE_NAMES.includes(name) || (value !== undefined && typeof value !== 'function')) {
      throw new TypeError('Treatable core accepts only searchTrials, screenLocal, and executeReal pipelines.');
    }
  }
  // Task A2: in 'live' mode, the mode that declares the transport port reaches the real network,
  // searchTrials defaults to the live ClinicalTrials.gov search (src/ctgov). Mocked cores wire nothing,
  // so a fake transport can never start a live search. A host-supplied pipeline replaces the default.
  const builtins: Partial<Pipelines> = options.mode === 'live' ? { searchTrials: createSearchTrialsPipeline() } : {};
  const pipelines: Partial<Pipelines> = { ...builtins, ...(options.pipelines ?? {}) };
  const sessionOptions = options.consentTtlMs !== undefined ? { ttlMs: options.consentTtlMs } : {};
  let session = createSession(ports, sessionOptions);
  const localPorts: LocalPorts = Object.freeze({ sha256: ports.sha256, tokens: ports.tokens, clock: ports.clock, loader: ports.loader });
  const searchPorts = Object.freeze({ ...localPorts, transport: ctgovOnlyTransport(ports.transport) });

  /** Validates a success response; returns it, or the error code that replaces it. */
  function checkOk<Op extends RequestOp>(id: string, op: Op, result: unknown, secrets?: ReadonlySet<string>): CoreResponse | ErrorCode {
    const parsed = OK_RESPONSE_SCHEMAS[op].safeParse({ v: CONTRACT_VERSION, type: 'response', id, op, ok: true, result });
    if (!parsed.success) return 'INTERNAL_ERROR';
    if (utf8ByteLength(JSON.stringify(parsed.data)) > responseBudget(op)) return 'OUTPUT_TOO_LARGE';
    if (secrets && containsSecret(parsed.data, secrets)) return 'INTERNAL_ERROR';
    return parsed.data as CoreResponse;
  }

  function okResponse<Op extends RequestOp>(
    s: Session,
    id: string,
    op: Op,
    result: unknown,
    secrets?: ReadonlySet<string>,
  ): CoreResponse {
    const checked = checkOk(id, op, result, secrets);
    if (typeof checked === 'string') {
      // Fail closed: nothing unvalidated leaves the core, and no preparation survives a failed reply.
      s.consent.clear();
      return errorResponse(id, op, checked);
    }
    return checked;
  }

  function status(): OperationResult<'status'> {
    const snapshot = session.consent.snapshot();
    const state = (ready: boolean) => (ready ? 'ready' : 'not_implemented') as 'ready' | 'not_implemented';
    const operations = Object.fromEntries(OPERATIONS.map(op => [op, state(true)])) as Record<Operation, 'ready' | 'not_implemented'>;
    operations.searchTrials = state(!!pipelines.searchTrials);
    operations.screenLocal = state(!!pipelines.screenLocal);
    operations.prepareReal = state(!!pipelines.executeReal);
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

  function pipelineContext(s: Session, requestId: string, signal: CancelSignal): PipelineContext {
    return { requestId, mode: options.mode, signal, records: s.records.view, slots: s.slots };
  }

  async function searchTrials(s: Session, id: string, payload: RequestPayload<'searchTrials'>): Promise<CoreResponse> {
    const pipeline = pipelines.searchTrials;
    if (!pipeline) return errorResponse(id, 'searchTrials', 'NOT_IMPLEMENTED');
    if (s.pendingCount()) return errorResponse(id, 'searchTrials', 'BUSY');
    const pending = s.begin(id, { real: false });
    try {
      const ctx: SearchContext = Object.freeze({ ...pipelineContext(s, id, pending.signal), ports: searchPorts });
      const result = await pipeline(ctx, payload);
      if (pending.signal.aborted) return errorResponse(id, 'searchTrials', 'CANCELLED');
      const checked = checkOk(id, 'searchTrials', result);
      if (typeof checked === 'string') {
        s.consent.clear();
        return errorResponse(id, 'searchTrials', checked);
      }
      // The validated records become the session's records only together with this response: the
      // merge is hashed first, then committed synchronously right before the response is returned.
      const records = (checked as { result: OperationResult<'searchTrials'> }).result.records;
      const merge = await s.records.prepareMerge(ports.sha256, records);
      if (pending.signal.aborted) return errorResponse(id, 'searchTrials', 'CANCELLED');
      s.commitRecords(merge);
      return checked;
    } catch (error) {
      return errorResponse(id, 'searchTrials', pending.signal.aborted ? 'CANCELLED' : errorCodeOf(error));
    } finally {
      pending.end();
    }
  }

  async function screenLocal(s: Session, id: string, payload: RequestPayload<'screenLocal'>): Promise<CoreResponse> {
    const pipeline = pipelines.screenLocal;
    if (!pipeline) return errorResponse(id, 'screenLocal', 'NOT_IMPLEMENTED');
    if (s.pendingCount()) return errorResponse(id, 'screenLocal', 'BUSY');
    // Only records this session holds can be screened.
    if (payload.nctIds.some(nctId => !s.records.has(nctId))) return errorResponse(id, 'screenLocal', 'RECORD_NOT_IN_SESSION');
    const pending = s.begin(id, { real: false });
    try {
      const ctx: ScreenContext = Object.freeze({ ...pipelineContext(s, id, pending.signal), ports: localPorts });
      const result = await pipeline(ctx, payload);
      if (pending.signal.aborted) return errorResponse(id, 'screenLocal', 'CANCELLED');
      return okResponse(s, id, 'screenLocal', result);
    } catch (error) {
      return errorResponse(id, 'screenLocal', pending.signal.aborted ? 'CANCELLED' : errorCodeOf(error));
    } finally {
      pending.end();
    }
  }

  async function prepareReal(s: Session, id: string, payload: RequestPayload<'prepareReal'>): Promise<CoreResponse> {
    // A preparation is only useful when an executor exists.
    if (!pipelines.executeReal) return errorResponse(id, 'prepareReal', 'NOT_IMPLEMENTED');
    if (s.pendingCount()) return errorResponse(id, 'prepareReal', 'BUSY');
    // Preparing again supersedes the previous preparation immediately.
    s.consent.clear();
    const generation = s.consent.generation();
    const pending = s.begin(id, { real: false });
    try {
      const subject = s.subjectDigest();
      if (subject === undefined) throw new CoreError('RECORD_NOT_IN_SESSION');
      const packet = ModelPacketSchema.parse(payload.packet);
      // R4: at most 10 Decisions studies and at most 2 Agents studies (r4.ts).
      assertR4Packet(packet);
      // The record rules and the exact preview, owned by the core and checked before consent.prepare:
      // NCT IDs held, condition term held byte for byte, every study the projection of its record.
      const built = buildRecordPreview(packet, s.records.view);
      // Decision D3: every study was retrieved at most MAX_RECORD_AGE_AT_PREPARE_MS ago.
      assertRecordsFresh([...new Set([...(packet.scoreNctIds ?? []), ...(packet.agentNctIds ?? [])])], s.records.view, ports.clock.now());
      const preview = verifyPreviewAgainstRecords(built, s.records.view);
      if (!jsonEqual(preview.packet, packet)) throw new CoreError('INTERNAL_ERROR');
      assertR4Preview(preview);
      const pins = await computeRequestPins(ports.sha256, preview);
      if (pending.signal.aborted) throw new CoreError('CANCELLED');
      // Anything that cleared consent or changed the records meanwhile wins over this preparation.
      if (s.consent.generation() !== generation || s.subjectDigest() !== subject) throw new CoreError('CANCELLED');
      const prepared = await s.consent.prepare({
        policyReceipt: payload.policyReceipt,
        subjectDigest: subject,
        operations: operationsForPacket(packet),
        preview: preview as unknown as JsonObject,
        pins,
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

  function checkExecuteResult(result: unknown, pinned: PinnedConsent, packet: ModelPacket, sent: SenderRecord): ExecuteRealResult {
    if (sent.violation) throw new CoreError('INTERNAL_ERROR');
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
    // The result may only report what the send capability saw happen.
    if (value.kind === 'scoreReal') {
      for (const entry of value.scores) {
        if (entry.outcome !== 'failed' && !sent.decisionsAnswered.includes(expected.indexOf(entry.nctId))) {
          throw new CoreError('INVALID_API_RESPONSE');
        }
      }
    } else {
      if (!sent.agentsCreated || value.toolCalls !== sent.toolResultsAccepted) throw new CoreError('INVALID_API_RESPONSE');
      if (value.cleanup === 'deleted' && !sent.sessionDeleted) throw new CoreError('INVALID_API_RESPONSE');
    }
    return value;
  }

  async function requestCredential(
    broker: CredentialBroker | undefined,
    forRequestId: string,
    operation: ConsentOperation,
    consentDigest: string,
    signal: CancelSignal,
  ): Promise<string> {
    if (!broker) throw new CoreError('KEY_MISSING');
    if (signal.aborted) throw new CoreError('CANCELLED');
    const idBytes = await ports.tokens.randomBytes(CREDENTIAL_ID_BYTES);
    if (!(idBytes instanceof Uint8Array) || idBytes.length !== CREDENTIAL_ID_BYTES) throw new CoreError('INTERNAL_ERROR');
    const message = CredentialRequestSchema.parse({
      v: CONTRACT_VERSION,
      type: 'credential.request',
      id: base64UrlEncode(idBytes),
      forRequestId,
      provider: 'openai',
      operation,
      consentDigest,
    });
    let raw: unknown;
    try {
      raw = await broker.request(message, signal);
    } catch {
      throw new CoreError(signal.aborted ? 'CANCELLED' : 'CREDENTIAL_UNAVAILABLE');
    }
    if (signal.aborted) throw new CoreError('CANCELLED');
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
    return answer.apiKey;
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
      // receipts are rejected before any credential or provider request, and they clear the preparation.
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
    let sender: SenderHandle | undefined;

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

    try {
      // The credential is requested once, after the receipt was accepted and before the pipeline
      // runs. It goes straight into the send capability; the pipeline never receives it.
      const apiKey = await requestCredential(options.credentials, id, pinned.operation, pinned.consentDigest, pending.signal);
      secrets.add(apiKey);
      if (pending.signal.aborted) throw new CoreError('CANCELLED');
      sender = createOpenAISender({
        transport: ports.transport,
        sha256: ports.sha256,
        clock: ports.clock,
        tokens: ports.tokens,
        operation: pinned.operation,
        preview: pinned.preview as unknown as Readonly<Preview>,
        pins: pinned.pins,
        apiKey,
        signal: pending.signal,
      });
      const ctx: ExecuteContext = Object.freeze({
        requestId: id,
        mode: options.mode,
        signal: pending.signal,
        operation: pinned.operation,
        consentDigest: pinned.consentDigest,
        packet: deepFreeze(jsonClone(packet as unknown as JsonObject)) as unknown as Readonly<ModelPacket>,
        preview: pinned.preview as unknown as Readonly<Preview>,
        openai: sender.capability,
        emitTrace,
      });
      const result = await run(ctx);
      if (pending.signal.aborted) throw new CoreError('CANCELLED');
      const checked = checkExecuteResult(result, pinned, packet, sender.record());
      return okResponse(s, id, 'executeReal', checked, secrets);
    } catch (error) {
      // An out-of-policy send attempt is a defect and is reported as such, even after a cancel.
      const code: ErrorCode = sender?.record().violation
        ? 'INTERNAL_ERROR'
        : pending.signal.aborted
          ? 'CANCELLED'
          : isCoreError(error)
            ? error.code
            : 'INVALID_API_RESPONSE';
      try {
        emitTrace({ stage: 'result', outcome: code === 'CANCELLED' ? 'cancelled' : 'failed', code });
      } catch {
        // The failure response below is still sent.
      }
      return errorResponse(id, 'executeReal', code);
    } finally {
      // Cancels every request the capability still runs, refuses later sends, drops the credential.
      sender?.close();
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
        // revoke() always clears; a stale or foreign token is still reported (consent/store.ts).
        try {
          s.consent.revoke(request.payload.token);
        } catch {
          return errorResponse(request.id, 'revokeReal', 'INVALID_CONSENT_RECEIPT');
        }
        return okResponse(s, request.id, 'revokeReal', { cleared: true });
      case 'searchTrials':
        return searchTrials(s, request.id, request.payload);
      case 'screenLocal':
        return screenLocal(s, request.id, request.payload);
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
