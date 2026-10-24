/**
 * Mocked dispatcher harness: fake pipelines stand in for tasks A2 (search and subject pinning) and
 * A4 (provider execution) so the consent gate in the dispatcher can be exercised end to end without
 * any network access. Nothing here is product behavior.
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
import { testPorts, type TestPorts } from './fakes.ts';
import { FICTIONAL_IDS } from './preview.ts';
import { prepareRecordMerge } from '../../src/pinning/record-set.ts';

export const receipt = { policyVersion: CONSENT_POLICY_VERSION, accepted: true } as const;
export const FAKE_KEY = 'sk-test-not-a-real-credential-0001';

export function req(op: string, payload: unknown, id: string) {
  return { v: CONTRACT_VERSION, type: 'request', id, op, payload };
}

export function fakeRecord(nctId: string, terms: readonly string[] = ['seasonal allergic rhinitis']) {
  return {
    nctId,
    title: `Fictional study ${nctId}`,
    status: 'RECRUITING',
    studyType: 'INTERVENTIONAL',
    phases: ['PHASE2'],
    conditions: ['Seasonal Allergic Rhinitis'],
    meshTerms: ['Rhinitis, Allergic, Seasonal'],
    summary: `Fictional public summary found for ${terms.join(', ')}.`,
    eligibility: { criteria: 'Inclusion Criteria:\n* Fictional', minimumAge: '18 Years', maximumAge: null, sex: 'ALL', healthyVolunteers: false },
    sponsor: null,
    locations: [{ city: 'Boise', state: 'Idaho', country: 'United States', geo: { lat: 43.6, lon: -116.2 } }],
    contacts: [{ name: 'Fictional Study Team', phone: '555-0100', email: 'team@example.invalid' }],
    lastUpdatePostDate: '2026-09-30',
    sourceUrl: `https://clinicaltrials.gov/study/${nctId}`,
    retrievedAt: '2026-10-24T08:00:00.000Z',
    truncatedFields: [],
  };
}

export interface ProviderLog {
  executions: { operation: string; preview: unknown }[];
  credentialRequests: CredentialRequest[];
}

export interface HarnessOptions {
  readonly pipelines?: Partial<Pipelines>;
  readonly credentials?: CredentialBroker | null;
  readonly execute?: (ctx: ExecuteContext, log: ProviderLog) => Promise<ExecuteRealResult>;
  readonly options?: Partial<CoreOptions>;
}

/** A well-behaved fake provider run: asks for the key once, emits a trace, returns a valid result. */
export async function defaultExecute(ctx: ExecuteContext, log: ProviderLog): Promise<ExecuteRealResult> {
  const key = await ctx.requestCredential();
  if (key !== FAKE_KEY) throw new Error('unexpected key');
  log.executions.push({ operation: ctx.pinned.operation, preview: ctx.pinned.preview });
  ctx.emitTrace({ stage: 'input', outcome: 'started', consentDigest: ctx.pinned.consentDigest, api: ctx.pinned.operation === 'score' ? 'decisions' : 'agents' });
  if (ctx.pinned.operation === 'score') {
    const ids = ctx.packet.scoreNctIds ?? [];
    for (const nctId of ids) ctx.emitTrace({ stage: 'decision', outcome: 'completed', api: 'decisions', nctId, httpStatus: 200, attempt: 1 });
    ctx.emitTrace({ stage: 'result', outcome: 'completed' });
    return { kind: 'scoreReal', mode: ctx.mode, consentDigest: ctx.pinned.consentDigest, scores: ids.map(nctId => ({ nctId, outcome: 'scored', index: 67, confidence: 0.8 })) };
  }
  const ids = ctx.packet.agentNctIds ?? [];
  ctx.emitTrace({ stage: 'task', outcome: 'started', api: 'agents', sessionId: 'sess_fictional' });
  for (const nctId of ids) ctx.emitTrace({ stage: 'tool_call', outcome: 'completed', api: 'agents', nctId, callId: `call_${nctId}` });
  ctx.emitTrace({ stage: 'result', outcome: 'completed' });
  ctx.emitTrace({ stage: 'cleanup', outcome: 'completed', cleanup: 'deleted', sessionId: 'sess_fictional' });
  return {
    kind: 'agentReal',
    mode: ctx.mode,
    consentDigest: ctx.pinned.consentDigest,
    comparisons: ids.map(nctId => ({ nctId, questionIds: ['eligibility', 'visits'] })),
    cautionIds: [...CAUTION_IDS],
    toolCalls: ids.length,
    cleanup: 'deleted',
  };
}

export function harness(opts: HarnessOptions = {}) {
  const ports: TestPorts = testPorts();
  const log: ProviderLog = { executions: [], credentialRequests: [] };
  const events: CoreEvent[] = [];
  const broker: CredentialBroker = {
    async request(message) {
      log.credentialRequests.push(message);
      return { v: CONTRACT_VERSION, type: 'credential.response', id: message.id, ok: true, apiKey: FAKE_KEY };
    },
  };
  const pipelines: Partial<Pipelines> = {
    async searchTrials(ctx, payload): Promise<OperationResult<'searchTrials'>> {
      // Mocked stand-in for the live search: fictional records go into the real session record set,
      // so prepareReal runs the real record-set pinning (built-in builder and verifyPinnedPreview).
      const ids = FICTIONAL_IDS.slice(0, payload.pageSize ?? 3);
      const records = ids.map(id => fakeRecord(id, payload.conditionTerms)) as OperationResult<'searchTrials'>['records'];
      const commit = await prepareRecordMerge(ctx.session, ctx.ports.sha256, records);
      commit();
      return {
        records,
        retrievedAt: '2026-10-24T08:00:00.000Z',
        source: 'live',
        skippedRecords: 0,
        query: { conditionTerms: payload.conditionTerms, ...(payload.state ? { state: payload.state } : {}), country: 'US' },
      };
    },
    executeReal: ctx => (opts.execute ?? defaultExecute)(ctx, log),
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
  return { ports, core, call, log, events, broker };
}

export function okResult<T = Record<string, unknown>>(response: CoreResponse): T {
  if (!response.ok) throw new Error(`expected ok, got ${response.error.code}`);
  return response.result as T;
}

export function errorCode(response: CoreResponse): string | undefined {
  return response.ok ? undefined : response.error.code;
}
