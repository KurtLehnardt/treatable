/**
 * Mocked dispatcher harness: a fake searchTrials pipeline stands in for task A2 and a small mocked
 * provider pipeline stands in for task A4, so the record index, the consent gate, and the send
 * capability can be exercised end to end without any network access. The provider pipeline talks
 * only to the mocked OpenAI transport (fake-openai.ts). Nothing here is product behavior.
 */
import { createCore, type CoreOptions, type CredentialBroker, type ExecuteContext, type Pipelines } from '../../src/dispatcher.ts';
import {
  CAUTION_IDS,
  CONSENT_POLICY_VERSION,
  CONTRACT_VERSION,
  type CoreEvent,
  type CoreResponse,
  type CredentialRequest,
  type ExecuteRealResult,
  type OperationResult,
} from '../../src/protocol.ts';
import type { Transport } from '../../src/ports.ts';
import { FakeOpenAITransport, bodyText, sseEvents, type FakeOpenAIOptions } from './fake-openai.ts';
import { testPorts, type TestPorts } from './fakes.ts';
import { FICTIONAL_IDS } from './preview.ts';

export const receipt = { policyVersion: CONSENT_POLICY_VERSION, accepted: true } as const;
export const FAKE_KEY = 'sk-test-not-a-real-credential-0001';

export function req(op: string, payload: unknown, id: string) {
  return { v: CONTRACT_VERSION, type: 'request', id, op, payload };
}

export function fakeRecord(nctId: string, overrides: Record<string, unknown> = {}) {
  return {
    nctId,
    title: `Fictional study ${nctId}`,
    status: 'RECRUITING',
    studyType: 'INTERVENTIONAL',
    phases: ['PHASE2'],
    conditions: ['Seasonal Allergic Rhinitis'],
    meshTerms: ['Rhinitis, Allergic, Seasonal'],
    summary: 'Fictional public summary.',
    eligibility: { criteria: 'Inclusion Criteria:\n* Fictional', minimumAge: '18 Years', maximumAge: null, sex: 'ALL', healthyVolunteers: false },
    sponsor: null,
    locations: [{ city: 'Boise', state: 'Idaho', country: 'United States', geo: { lat: 43.6, lon: -116.2 } }],
    contacts: [{ name: 'Fictional Study Team', phone: '555-0100', email: 'team@example.invalid' }],
    lastUpdatePostDate: '2026-09-30',
    sourceUrl: `https://clinicaltrials.gov/study/${nctId}`,
    retrievedAt: '2026-10-24T08:00:00.000Z',
    truncatedFields: [],
    ...overrides,
  };
}

export interface ProviderLog {
  executions: { operation: string; preview: unknown }[];
  credentialRequests: CredentialRequest[];
  /** Every ExecuteContext handed to the provider pipeline. */
  contexts: ExecuteContext[];
}

export interface HarnessOptions {
  readonly pipelines?: Partial<Pipelines>;
  readonly credentials?: CredentialBroker | null;
  readonly execute?: (ctx: ExecuteContext, log: ProviderLog) => Promise<ExecuteRealResult>;
  readonly options?: Partial<CoreOptions>;
  /** Behavior of the mocked OpenAI transport. */
  readonly openai?: FakeOpenAIOptions;
  /** Replaces the mocked OpenAI transport entirely. */
  readonly transport?: Transport;
  /** Records the fake search returns, by NCT ID (default: fakeRecord). */
  readonly records?: (nctId: string) => Record<string, unknown>;
}

/** Mocked score run through the send capability: one Decisions request per study, in parallel. */
export async function mockedScore(ctx: ExecuteContext): Promise<ExecuteRealResult> {
  const ids = ctx.packet.scoreNctIds ?? [];
  const scores = await Promise.all(
    ids.map(async (nctId, index) => {
      const response = await ctx.openai.send({ kind: 'decisions', index });
      const ok = response.status === 200;
      ctx.emitTrace({ stage: 'decision', outcome: ok ? 'completed' : 'failed', api: 'decisions', nctId, httpStatus: response.status, attempt: response.attempt, ...(ok ? {} : { code: 'API_ERROR' as const }) });
      if (!ok) return { nctId, outcome: 'failed' as const, code: 'API_ERROR' as const };
      const answer = (JSON.parse(bodyText(response.body)) as { answers: { type: string; score: number; confidence: number }[] }).answers[0]!;
      if (answer.type === 'refusal') return { nctId, outcome: 'declined' as const };
      return { nctId, outcome: 'scored' as const, index: Math.round((answer.score / 3) * 100), confidence: answer.confidence };
    }),
  );
  ctx.emitTrace({ stage: 'result', outcome: 'completed' });
  return { kind: 'scoreReal', mode: ctx.mode, consentDigest: ctx.consentDigest, scores };
}

/** Mocked Agents run through the send capability: create, answer tool calls, read the plan, clean up. */
export async function mockedAgent(ctx: ExecuteContext): Promise<ExecuteRealResult> {
  const ids = ctx.packet.agentNctIds ?? [];
  const create = await ctx.openai.send({ kind: 'agentsCreate' });
  if (create.status !== 201) throw new Error('create failed');
  let sessionId: string | undefined;
  let completed = false;
  let text = '';
  let toolCalls = 0;
  let cleanup: 'deleted' | 'failed' | 'unconfirmed' = 'unconfirmed';
  try {
    for await (const event of sseEvents(create.body)) {
      if (event.type === 'agent.session.created') {
        sessionId = event.session.id as string;
        ctx.emitTrace({ stage: 'task', outcome: 'started', api: 'agents', sessionId });
      } else if (event.type === 'agent.session.requires_action') {
        for (const action of event.session.required_actions as { turn_id: string; call_id: string; arguments: { nctId: string } }[]) {
          const index = ids.indexOf(action.arguments.nctId);
          const sent = await ctx.openai.send({ kind: 'toolResult', index, sessionId: sessionId!, turnId: action.turn_id, callId: action.call_id });
          if (sent.status !== 202) throw new Error('tool result failed');
          toolCalls += 1;
          ctx.emitTrace({ stage: 'tool_call', outcome: 'completed', api: 'agents', nctId: action.arguments.nctId, callId: action.call_id });
        }
      } else if (event.type === 'agent.session.turn.output_text.done') {
        text = event.text as string;
      } else if (event.type === 'agent.session.turn.completed') {
        completed = true;
        break;
      }
    }
  } finally {
    if (sessionId !== undefined) {
      if (!completed) await ctx.openai.send({ kind: 'agentsCancel', sessionId }).catch(() => undefined);
      const deleted = await ctx.openai.send({ kind: 'agentsDelete', sessionId }).catch(() => undefined);
      cleanup = deleted?.status === 200 ? 'deleted' : 'failed';
      ctx.emitTrace({ stage: 'cleanup', outcome: cleanup === 'deleted' ? 'completed' : 'failed', cleanup, sessionId });
    }
  }
  if (!completed) throw new Error('incomplete');
  const plan = JSON.parse(text) as { comparisons: { nctId: string; questionIds: string[] }[] };
  ctx.emitTrace({ stage: 'result', outcome: 'completed' });
  return {
    kind: 'agentReal',
    mode: ctx.mode,
    consentDigest: ctx.consentDigest,
    comparisons: plan.comparisons as never,
    cautionIds: [...CAUTION_IDS],
    toolCalls,
    cleanup,
  };
}

/** The default mocked provider run: emits the input trace and runs the operation through the capability. */
export async function defaultExecute(ctx: ExecuteContext, log: ProviderLog): Promise<ExecuteRealResult> {
  log.executions.push({ operation: ctx.operation, preview: ctx.preview });
  ctx.emitTrace({ stage: 'input', outcome: 'started', consentDigest: ctx.consentDigest, api: ctx.operation === 'score' ? 'decisions' : 'agents' });
  return ctx.operation === 'score' ? mockedScore(ctx) : mockedAgent(ctx);
}

export function harness(opts: HarnessOptions = {}) {
  const base = testPorts();
  const openai = new FakeOpenAITransport(opts.openai);
  const ports = { ...base, transport: opts.transport ?? openai } as unknown as TestPorts & { transport: FakeOpenAITransport };
  const log: ProviderLog = { executions: [], credentialRequests: [], contexts: [] };
  const events: CoreEvent[] = [];
  const recordOf = opts.records ?? ((id: string) => fakeRecord(id));
  const broker: CredentialBroker = {
    async request(message) {
      log.credentialRequests.push(message);
      return { v: CONTRACT_VERSION, type: 'credential.response', id: message.id, ok: true, apiKey: FAKE_KEY };
    },
  };
  const pipelines: Partial<Pipelines> = {
    async searchTrials(_ctx, payload): Promise<OperationResult<'searchTrials'>> {
      // Mocked stand-in for the live search: the dispatcher merges these records into the index.
      const ids = FICTIONAL_IDS.slice(0, payload.pageSize ?? 3);
      return {
        records: ids.map(recordOf) as OperationResult<'searchTrials'>['records'],
        retrievedAt: '2026-10-24T08:00:00.000Z',
        source: 'live',
        skippedRecords: 0,
        query: { conditionTerms: payload.conditionTerms, ...(payload.state ? { state: payload.state } : {}), country: 'US' },
      };
    },
    executeReal: ctx => {
      log.contexts.push(ctx);
      return (opts.execute ?? defaultExecute)(ctx, log);
    },
    ...(opts.pipelines ?? {}),
  };
  const core = createCore(ports, {
    mode: 'mocked',
    runtime: 'test',
    pipelines,
    ...(opts.credentials === null ? {} : { credentials: opts.credentials ?? broker }),
    ...(opts.options ?? {}),
  });
  let counter = 0;
  const call = (op: string, payload: unknown, id = `r${(counter += 1)}`): Promise<CoreResponse> =>
    core.handle(req(op, payload, id), { onEvent: event => events.push(event) });
  return { ports, openai, core, call, log, events, broker };
}

export function okResult<T = Record<string, unknown>>(response: CoreResponse): T {
  if (!response.ok) throw new Error(`expected ok, got ${response.error.code}`);
  return response.result as T;
}

export function errorCode(response: CoreResponse): string | undefined {
  return response.ok ? undefined : response.error.code;
}

/** Lets pending promise continuations run (mocked timing only). */
export async function flush(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise(resolve => setImmediate(resolve));
}
