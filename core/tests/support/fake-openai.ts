/**
 * Mocked OpenAI transport for tests: it answers the five allowlisted endpoints with fictional
 * responses shaped like the recorded contract (docs/apps/openai-contracts.md sections 2, 3, and 7)
 * and records every request it receives. No request leaves the process.
 */
import type { CancelSignal, Transport, TransportRequest, TransportResponse } from '../../src/ports.ts';

export interface RecordedCall {
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The exact body bytes as UTF-8 text, or undefined without a body. */
  readonly body: string | undefined;
}

export interface FakeReply {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export const FAKE_SESSION_ID = 'sess_fictional0001';
export const FAKE_TURN_ID = 'turn_fictional01';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sse(event: Record<string, unknown>): Uint8Array {
  return encoder.encode(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`);
}

function json(status: number, value: unknown, headers: Record<string, string> = {}): TransportResponse {
  return { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req_fictional', ...headers }, body: encoder.encode(JSON.stringify(value)) };
}

function aborted(signal: CancelSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

/** A Decisions answer for the one score question in `body`. */
export function scoreAnswer(body: string): FakeReply {
  const parsed = JSON.parse(body) as { questions: { name: string }[] };
  const name = parsed.questions[0]!.name;
  const probabilities = [
    { value: 0, label: 'Unrelated', probability: 0.05 },
    { value: 1, label: 'Unclear', probability: 0.15 },
    { value: 2, label: 'Related', probability: 0.5 },
    { value: 3, label: 'Strongly related', probability: 0.3 },
  ];
  return { status: 200, body: JSON.stringify({ model: 'gpt-6-luna', answers: [{ type: 'score', name, score: 2.05, probabilities, confidence: 0.8 }], usage: {} }) };
}

export interface FakeOpenAIOptions {
  /** Custom Decisions reply; `attempt` counts requests for the same NCT ID (1 or 2). */
  readonly decisions?: (body: string, attempt: number) => FakeReply | Promise<FakeReply>;
  /** Number of evidence calls the fake agent makes per study (default 1). */
  readonly callsPerStudy?: number;
  /** Status of the DELETE answer (default 200 with a valid acknowledgement). */
  readonly deleteStatus?: number;
}

export class FakeOpenAITransport implements Transport {
  readonly calls: RecordedCall[] = [];
  /** Decisions requests currently waiting for their reply, and the most seen at once. */
  decisionsInFlight = 0;
  maxDecisionsInFlight = 0;
  private readonly options: FakeOpenAIOptions;
  private readonly attempts = new Map<string, number>();
  private toolResultsWanted = 0;
  private readonly toolResultsSeen = new Set<string>();
  private releaseTurn: (() => void) | undefined;

  constructor(options: FakeOpenAIOptions = {}) {
    this.options = options;
  }

  request = async (request: TransportRequest): Promise<TransportResponse> => {
    const url = new URL(request.url);
    const body = request.body === undefined ? undefined : decoder.decode(request.body);
    this.calls.push({ method: request.method, url: request.url, path: url.pathname, headers: { ...request.headers }, body });
    if (request.signal?.aborted) throw new Error('aborted before sending');
    const path = url.pathname;
    if (request.method === 'POST' && path === '/v1/decisions') return this.decisions(body ?? '', request.signal);
    if (request.method === 'POST' && path === '/v1/agents/sessions') return this.createSession(body ?? '', request.signal);
    const sessionPath = `/v1/agents/sessions/${FAKE_SESSION_ID}`;
    if (request.method === 'POST' && path === `${sessionPath}/events`) {
      const event = (JSON.parse(body ?? '{}') as { events: { type: string; call_id?: string }[] }).events[0]!;
      if (event.type === 'agent.session.input.tool_result') {
        this.toolResultsSeen.add(event.call_id!);
        if (this.toolResultsSeen.size >= this.toolResultsWanted) this.releaseTurn?.();
      }
      return { status: 202, headers: {}, body: new Uint8Array(0) };
    }
    if (request.method === 'GET' && path === sessionPath) {
      return json(200, { id: FAKE_SESSION_ID, object: 'agent.session', status: 'idle', required_actions: [] });
    }
    if (request.method === 'DELETE' && path === sessionPath) {
      const status = this.options.deleteStatus ?? 200;
      return status === 200 ? json(200, { id: FAKE_SESSION_ID, object: 'agent.session.deleted', deleted: true, added_later: { nested: { deeper: { deepest: ['ignored'] } } } }) : json(status, { error: { code: 'conflict_error' } });
    }
    return json(404, { error: { type: 'not_found_error' } });
  };

  private async decisions(body: string, signal: CancelSignal | undefined): Promise<TransportResponse> {
    const name = (JSON.parse(body) as { questions: { name: string }[] }).questions[0]!.name;
    const attempt = (this.attempts.get(name) ?? 0) + 1;
    this.attempts.set(name, attempt);
    this.decisionsInFlight += 1;
    this.maxDecisionsInFlight = Math.max(this.maxDecisionsInFlight, this.decisionsInFlight);
    try {
      const reply = await Promise.race([Promise.resolve((this.options.decisions ?? scoreAnswer)(body, attempt)), aborted(signal)]);
      return { status: reply.status, headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) }, body: encoder.encode(reply.body ?? '') };
    } finally {
      this.decisionsInFlight -= 1;
    }
  }

  private createSession(body: string, signal: CancelSignal | undefined): TransportResponse {
    const input = JSON.parse((JSON.parse(body) as { input: string }).input) as { nctIds: string[] };
    const perStudy = this.options.callsPerStudy ?? 1;
    const actions = input.nctIds.flatMap((nctId, i) =>
      Array.from({ length: perStudy }, (_unused, k) => ({
        type: 'function_call',
        turn_id: FAKE_TURN_ID,
        call_id: `call_fictional_${i}_${k}`,
        name: 'get_public_trial_evidence',
        arguments: { nctId },
        added_later: 'ignored',
      })),
    );
    this.toolResultsWanted = actions.length;
    const turnReleased = new Promise<void>(resolve => (this.releaseTurn = resolve));
    const plan = { comparisons: input.nctIds.map(nctId => ({ nctId, questionIds: ['eligibility', 'visits'] })), cautionIds: ['team_confirms', 'records_change', 'no_benefit_promise'] };
    async function* events(): AsyncGenerator<Uint8Array> {
      yield sse({ type: 'agent.session.created', event_id: 'evt_1', session: { id: FAKE_SESSION_ID } });
      yield sse({ type: 'agent.session.turn.created', event_id: 'evt_2', session_id: FAKE_SESSION_ID, turn: { id: FAKE_TURN_ID, subagent_id: null } });
      yield sse({ type: 'agent.session.requires_action', event_id: 'evt_3', session: { id: FAKE_SESSION_ID, required_actions: actions } });
      await Promise.race([turnReleased, aborted(signal)]);
      yield sse({ type: 'agent.session.turn.output_text.done', event_id: 'evt_4', session_id: FAKE_SESSION_ID, turn_id: FAKE_TURN_ID, text: JSON.stringify(plan) });
      yield sse({ type: 'agent.session.turn.completed', event_id: 'evt_5', session_id: FAKE_SESSION_ID, turn_id: FAKE_TURN_ID, turn: { id: FAKE_TURN_ID, subagent_id: null } });
    }
    return { status: 201, headers: { 'content-type': 'text/event-stream' }, body: events() };
  }
}

/** Parses server-sent events from a byte stream (test helper for the mocked provider). */
export async function* sseEvents(body: Uint8Array | AsyncIterable<Uint8Array>): AsyncGenerator<Record<string, any>> {
  const stream = body instanceof Uint8Array ? [body] : body;
  const textDecoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  for await (const chunk of stream) {
    buffer += textDecoder.decode(chunk, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = block
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n');
      if (data) yield JSON.parse(data) as Record<string, any>;
    }
  }
}

export function bodyText(body: Uint8Array | AsyncIterable<Uint8Array>): string {
  if (!(body instanceof Uint8Array)) throw new Error('expected a byte body');
  return decoder.decode(body);
}
