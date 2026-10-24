// Mocked: no network. Dispatcher behavior ported from extension/native/host.mjs and the dispatcher-level
// parts of extension/native/test/{core,real}.test.mjs at 48c569e.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCore } from '../src/dispatcher.ts';
import {
  CONSENT_POLICY_VERSION,
  CONTRACT_VERSION,
  MAX_REQUESTS_PER_SESSION,
  PREPARED_TTL_MS,
  ResponseSchema,
  type PreparedRealResult,
} from '../src/protocol.ts';
import { testPorts } from './support/fakes.ts';
import { FAKE_KEY, defaultExecute, errorCode, harness, okResult, receipt, req } from './support/harness.ts';
import { FICTIONAL_IDS, basePacket } from './support/preview.ts';

const packet = basePacket();
const execute = (p: PreparedRealResult, operation = 'score', extra: Record<string, unknown> = {}) => ({ token: p.token, digest: p.digest, operation, policyReceipt: receipt, ...extra });

async function prepared(h: ReturnType<typeof harness>, pk = packet): Promise<PreparedRealResult> {
  okResult(await h.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }));
  return okResult<PreparedRealResult>(await h.call('prepareReal', { packet: pk, policyReceipt: receipt }));
}

async function isPrepared(h: ReturnType<typeof harness>): Promise<boolean> {
  return okResult<Record<string, any>>(await h.call('status', {})).session.prepared;
}

test('status reports the contract, the policy version, the mode label, and which operations are wired', async () => {
  const core = createCore(testPorts(), { mode: 'mocked', runtime: 'test' });
  const response = await core.handle(req('status', {}, 's1'));
  assert.equal(ResponseSchema.safeParse(response).success, true);
  const result = okResult<Record<string, any>>(response);
  assert.equal(result.contractVersion, CONTRACT_VERSION);
  assert.equal(result.policyVersion, CONSENT_POLICY_VERSION);
  assert.equal(result.mode, 'mocked');
  assert.deepEqual(result.session, { prepared: false, pending: 0, requests: 1 });
  assert.deepEqual(result.operations, {
    status: 'ready', searchTrials: 'not_implemented', screenLocal: 'not_implemented', prepareReal: 'not_implemented',
    executeReal: 'not_implemented', revokeReal: 'ready', cancel: 'ready', endSession: 'ready', 'credential.request': 'not_implemented',
  });
  assert.ok(!JSON.stringify(response).includes('sk-'), 'status never exposes credentials');
  const wired = harness();
  const operations = okResult<Record<string, any>>(await wired.call('status', {})).operations;
  assert.equal(operations.prepareReal, 'ready', 'preparation is ready once an executor exists; the core builds the preview itself');
});

test('operations owned by later tasks answer a typed NOT_IMPLEMENTED error', async () => {
  const core = createCore(testPorts(), { mode: 'mocked', runtime: 'test' });
  const cases: [string, unknown][] = [
    ['searchTrials', { conditionTerms: ['asthma'] }],
    ['screenLocal', { nctIds: [FICTIONAL_IDS[0]], profile: { ageYears: 40 } }],
    ['prepareReal', { packet, policyReceipt: receipt }],
    ['executeReal', { token: 'A'.repeat(43), digest: 'b'.repeat(64), operation: 'score', policyReceipt: receipt }],
  ];
  for (const [op, payload] of cases) {
    const response = await core.handle(req(op, payload, `id_${op}`));
    assert.deepEqual(response, { v: CONTRACT_VERSION, type: 'response', id: `id_${op}`, op, ok: false, error: { code: 'NOT_IMPLEMENTED' } });
  }
});

test('[ported core.test.mjs#1, #9] invalid, oversized, mismatched and duplicate requests get constant-shape errors without echo', async () => {
  const core = createCore(testPorts(), { mode: 'mocked', runtime: 'test' });
  const bad: [unknown, string, string][] = [
    [{ ...req('status', {}, 'x'), id: 5 }, 'invalid', 'INVALID_REQUEST'],
    [req('generate', { prompt: 'SENSITIVE_SENTINEL' }, 'g1'), 'g1', 'INVALID_REQUEST'],
    [req('searchTrials', { conditionTerms: ['asthma'], notes: 'SENSITIVE_SENTINEL' }, 'g2'), 'g2', 'INVALID_REQUEST'],
    [req('status', { x: '🔐'.repeat(30000) }, 'g3'), 'g3', 'INVALID_REQUEST'],
    [{ ...req('status', {}, 'g4'), v: '9.0.0' }, 'g4', 'CONTRACT_MISMATCH'],
    ['SENSITIVE_SENTINEL', 'invalid', 'INVALID_REQUEST'],
    [null, 'invalid', 'INVALID_REQUEST'],
  ];
  for (const [raw, id, code] of bad) {
    const response = await core.handle(raw);
    assert.equal(response.id, id);
    assert.equal(errorCode(response), code);
    assert.ok(!JSON.stringify(response).includes('SENSITIVE_SENTINEL'));
    assert.deepEqual(Object.keys(response).sort(), [...(response as { op?: string }).op ? ['op'] : [], 'error', 'id', 'ok', 'type', 'v'].sort());
  }
  assert.equal(okResult<{ wiped: boolean }>(await core.handle(req('endSession', {}, 'dup'))).wiped, true);
  assert.equal(errorCode(await core.handle(req('status', {}, 'dup'))), undefined, 'IDs reset with a new session');
  assert.equal(errorCode(await core.handle(req('status', {}, 'dup'))), 'INVALID_REQUEST', 'duplicate ID');
});

test('a session accepts a bounded number of requests', async () => {
  const core = createCore(testPorts(), { mode: 'mocked', runtime: 'test' });
  for (let i = 0; i < MAX_REQUESTS_PER_SESSION; i += 1) assert.equal(errorCode(await core.handle(req('status', {}, `n${i}`))), undefined);
  assert.equal(errorCode(await core.handle(req('status', {}, 'over'))), 'SESSION_LIMIT');
  await core.handle(req('endSession', {}, 'end-limit'));
  assert.equal(errorCode(await core.handle(req('status', {}, 'after'))), undefined);
});

test('[ported real.test.mjs#4] stale, changed, replayed, expired, revoked and missing-policy receipts make zero provider requests and no credential request', async () => {
  const h = harness();
  assert.equal(PREPARED_TTL_MS, 5 * 60 * 1000);
  for (const change of [
    (p: PreparedRealResult) => execute(p, 'score', { token: 'x'.repeat(43) }),
    (p: PreparedRealResult) => execute(p, 'score', { digest: '0'.repeat(64) }),
    (p: PreparedRealResult) => execute(p, 'score', { policyReceipt: { accepted: true, policyVersion: 'old' } }),
    (p: PreparedRealResult) => execute(p, 'score', { policyReceipt: undefined }),
  ]) {
    const p = await prepared(h);
    assert.notEqual(errorCode(await h.call('executeReal', change(p))), undefined);
    assert.equal(await isPrepared(h), false, 'every rejected receipt clears the preparation');
    assert.equal(errorCode(await h.call('executeReal', execute(p))), 'INVALID_CONSENT_RECEIPT', 'the real receipt is gone too');
  }
  assert.equal(h.log.executions.length, 0);
  assert.equal(h.log.credentialRequests.length, 0, 'receipts are validated before any credential request');
  assert.equal(h.openai.calls.length, 0, 'no provider request');
  const p2 = await prepared(h);
  const scored = okResult<Record<string, any>>(await h.call('executeReal', execute(p2), 'exec-score'));
  assert.equal(scored.kind, 'scoreReal');
  assert.equal(scored.consentDigest, p2.digest);
  assert.equal(scored.mode, 'mocked');
  assert.equal(h.log.credentialRequests.length, 1);
  assert.equal(h.log.credentialRequests[0]!.consentDigest, p2.digest);
  assert.equal(h.log.credentialRequests[0]!.forRequestId, 'exec-score');
  assert.deepEqual(h.log.executions[0]!.preview, p2.preview, 'the runner receives exactly the previewed payloads');
  const agent = okResult<Record<string, any>>(await h.call('executeReal', execute(p2, 'agent')));
  assert.equal(agent.cleanup, 'deleted');
  assert.equal(errorCode(await h.call('executeReal', execute(p2, 'agent'))), 'INVALID_CONSENT_RECEIPT', 'replay');
  const p3 = okResult<PreparedRealResult>(await h.call('prepareReal', { packet: basePacket({ state: 'WA' }), policyReceipt: receipt }));
  okResult(await h.call('revokeReal', { token: p3.token }));
  assert.equal(errorCode(await h.call('executeReal', execute(p3))), 'INVALID_CONSENT_RECEIPT', 'revoked');
  const p4 = okResult<PreparedRealResult>(await h.call('prepareReal', { packet, policyReceipt: receipt }));
  h.ports.clock.advance(PREPARED_TTL_MS + 1);
  assert.equal(errorCode(await h.call('executeReal', execute(p4))), 'CONSENT_EXPIRED');
  assert.equal(h.log.executions.length, 2);
  assert.equal(h.log.credentialRequests.length, 2);
});

test('the clear/keep matrix through the dispatcher: a wrong token, a replayed operation, and a mismatched revoke all clear the preparation', async () => {
  const h = harness();
  const p = await prepared(h);
  assert.equal(errorCode(await h.call('executeReal', execute(p, 'score', { token: 'y'.repeat(43) }))), 'INVALID_CONSENT_RECEIPT');
  assert.equal(await isPrepared(h), false, 'wrong token clears (real.mjs kept it)');

  const q = await prepared(h, basePacket({ agentNctIds: undefined }));
  okResult(await h.call('executeReal', execute(q)));
  assert.equal(await isPrepared(h), true, 'a used preparation stays listed until it fails or expires');
  assert.equal(errorCode(await h.call('executeReal', execute(q, 'agent'))), 'INVALID_CONSENT_RECEIPT', 'unauthorized operation');
  assert.equal(await isPrepared(h), false, 'an unauthorized operation clears');

  const r = await prepared(h);
  okResult(await h.call('executeReal', execute(r)));
  assert.equal(errorCode(await h.call('executeReal', execute(r))), 'INVALID_CONSENT_RECEIPT', 'replayed operation');
  assert.equal(errorCode(await h.call('executeReal', execute(r, 'agent'))), 'INVALID_CONSENT_RECEIPT', 'the other operation went with it');

  const s = await prepared(h);
  assert.equal(errorCode(await h.call('revokeReal', { token: 'z'.repeat(43) })), 'INVALID_CONSENT_RECEIPT', 'a stale token is reported');
  assert.equal(await isPrepared(h), false, 'and the preparation is cleared anyway (host.mjs kept it)');
  assert.equal(errorCode(await h.call('executeReal', execute(s))), 'INVALID_CONSENT_RECEIPT');
  assert.equal(h.log.credentialRequests.length, 2, 'only the two valid executions asked for a credential');
});

test('mutation invalidation through the dispatcher: changed records, an invalid request, cancel, or a new preparation clears consent', async () => {
  const h = harness();
  const p = await prepared(h);
  okResult(await h.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'], pageSize: 4 }));
  assert.equal(errorCode(await h.call('executeReal', execute(p))), 'INVALID_CONSENT_RECEIPT', 'a new record changed the record-set digest');
  const q = await prepared(h);
  await h.core.handle({ garbage: true });
  assert.equal(errorCode(await h.call('executeReal', execute(q))), 'INVALID_CONSENT_RECEIPT', 'invalid request cleared it');
  const r = await prepared(h);
  okResult(await h.call('cancel', { requestId: 'nothing' }));
  assert.equal(errorCode(await h.call('executeReal', execute(r))), 'INVALID_CONSENT_RECEIPT', 'cancel cleared it');
  const s = await prepared(h);
  okResult(await h.call('prepareReal', { packet: basePacket({ ageBand: '60_74' }), policyReceipt: receipt }));
  assert.equal(await isPrepared(h), true, 'the newer preparation is active');
  assert.equal(errorCode(await h.call('executeReal', execute(s))), 'INVALID_CONSENT_RECEIPT', 'superseded');
  assert.equal(await isPrepared(h), false, 'a superseded receipt is a wrong token, so the newer preparation is cleared too');
  assert.equal(h.log.executions.length, 0);
});

function baseRecord(nctId: string) {
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
    locations: [],
    contacts: [],
    lastUpdatePostDate: '2026-09-30',
    sourceUrl: `https://clinicaltrials.gov/study/${nctId}`,
    retrievedAt: '2026-10-24T08:00:00.000Z',
    truncatedFields: [],
  };
}

test('a search that returns the same record versions keeps consent; a changed record version clears it', async () => {
  let version = 'Fictional public summary.';
  const h = harness({ records: id => ({ ...baseRecord(id), summary: version }) });
  const p = await prepared(h);
  okResult(await h.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }));
  assert.equal(await isPrepared(h), true, 'identical records: the subject digest is unchanged');
  version = 'Fictional public summary, updated upstream.';
  okResult(await h.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }));
  assert.equal(await isPrepared(h), false);
  assert.equal(errorCode(await h.call('executeReal', execute(p))), 'INVALID_CONSENT_RECEIPT');
});

test('trace events are validated, sequenced, labeled mocked, and delivered before the response', async () => {
  const h = harness();
  const p = await prepared(h);
  const before = h.events.length;
  okResult(await h.call('executeReal', execute(p)));
  const trace = h.events.slice(before).map(e => e.trace);
  assert.deepEqual(trace.map(t => t.stage), ['input', 'decision', 'decision', 'result']);
  assert.deepEqual(trace.map(t => t.seq), [1, 2, 3, 4]);
  assert.ok(trace.every(t => t.mode === 'mocked' && t.operation === 'score'));
  assert.equal(trace[0]!.consentDigest, p.digest);
  const invalidTrace = harness({
    execute: async ctx => {
      ctx.emitTrace({ stage: 'task', outcome: 'started', consentDigest: ctx.consentDigest });
      throw new Error('unreachable');
    },
  });
  const q = await prepared(invalidTrace);
  assert.equal(errorCode(await invalidTrace.call('executeReal', execute(q))), 'INTERNAL_ERROR');
});

test('the credential is requested once per confirmed operation, before the pipeline runs, and never appears in any response or event', async () => {
  const h = harness();
  const p = await prepared(h);
  okResult(await h.call('executeReal', execute(p)));
  assert.equal(h.log.credentialRequests.length, 1);
  assert.ok(!JSON.stringify(h.events).includes(FAKE_KEY));
  for (const call of h.openai.calls) assert.equal(call.headers.Authorization, `Bearer ${FAKE_KEY}`, 'the capability adds the key to each request');
  const cases: [unknown, string][] = [
    [{ ok: false, code: 'KEY_MISSING' }, 'KEY_MISSING'],
    [{ ok: false, code: 'DECLINED' }, 'CANCELLED'],
    [{ ok: false, code: 'CREDENTIAL_UNAVAILABLE' }, 'CREDENTIAL_UNAVAILABLE'],
    [{ ok: true, apiKey: 'bad key with spaces' }, 'CREDENTIAL_UNAVAILABLE'],
    [{ ok: true, apiKey: FAKE_KEY, extra: 'x' }, 'CREDENTIAL_UNAVAILABLE'],
    [{ ok: true, apiKey: FAKE_KEY, id: 'someone-else' }, 'CREDENTIAL_UNAVAILABLE'],
  ];
  for (const [answer, code] of cases) {
    const failing = harness({
      credentials: {
        async request(message) {
          return { v: CONTRACT_VERSION, type: 'credential.response', id: message.id, ...(answer as object) };
        },
      },
    });
    const r = await prepared(failing);
    assert.equal(errorCode(await failing.call('executeReal', execute(r))), code, JSON.stringify(answer));
    assert.equal(failing.log.executions.length, 0, 'without a credential the pipeline never runs');
    assert.equal(failing.openai.calls.length, 0);
  }
  const none = harness({ credentials: null });
  const s = await prepared(none);
  assert.equal(errorCode(await none.call('executeReal', execute(s))), 'KEY_MISSING');
  assert.equal(none.log.executions.length, 0);
});

test('results are checked against the pinned consent and against what was actually sent', async () => {
  const wrong: [string, (r: any) => any][] = [
    ['other study', r => ({ ...r, scores: [{ ...r.scores[0], nctId: FICTIONAL_IDS[7] }, r.scores[1]] })],
    ['missing study', r => ({ ...r, scores: [r.scores[0]] })],
    ['live label in mocked core', r => ({ ...r, mode: 'live' })],
    ['other digest', r => ({ ...r, consentDigest: 'f'.repeat(64) })],
    ['extra field', r => ({ ...r, note: 'free text' })],
    ['agent kind for score', r => ({ ...r, kind: 'agentReal' })],
  ];
  for (const [name, change] of wrong) {
    const h = harness({ execute: async (ctx, log) => change(await defaultExecute(ctx, log)) });
    const p = await prepared(h);
    assert.equal(errorCode(await h.call('executeReal', execute(p))), 'INVALID_API_RESPONSE', name);
  }
  // A score for a study whose request was never sent is refused.
  const unsent = harness({
    execute: async ctx => {
      const first = await ctx.openai.send({ kind: 'decisions', index: 0 });
      void first;
      return { kind: 'scoreReal', mode: ctx.mode, consentDigest: ctx.consentDigest, scores: (ctx.packet.scoreNctIds ?? []).map(nctId => ({ nctId, outcome: 'scored', index: 50, confidence: 0.5 })) };
    },
  });
  const p = await prepared(unsent);
  assert.equal(errorCode(await unsent.call('executeReal', execute(p))), 'INVALID_API_RESPONSE', 'second study was never sent');
  // An Agents result that claims deletion without an acknowledged DELETE is refused.
  const notDeleted = harness({ openai: { deleteStatus: 409 }, execute: async (ctx, log) => ({ ...(await defaultExecute(ctx, log)), cleanup: 'deleted' }) as never });
  const q = await prepared(notDeleted);
  assert.equal(errorCode(await notDeleted.call('executeReal', execute(q, 'agent'))), 'INVALID_API_RESPONSE', 'cleanup claimed without acknowledgement');
  const honest = harness({ openai: { deleteStatus: 409 } });
  const r = await prepared(honest);
  assert.equal(okResult<Record<string, any>>(await honest.call('executeReal', execute(r, 'agent'))).cleanup, 'failed', 'a failed deletion is reported as failed');
  const miscounted = harness({ execute: async (ctx, log) => ({ ...(await defaultExecute(ctx, log)), toolCalls: 5 }) as never });
  const s = await prepared(miscounted);
  assert.equal(errorCode(await miscounted.call('executeReal', execute(s, 'agent'))), 'INVALID_API_RESPONSE', 'tool call count must match accepted tool results');
});

test('BUSY, cancel, and consent clearing abort running work; local operations report CANCELLED', async () => {
  let release!: () => void;
  const h = harness({
    pipelines: {
      searchTrials: (ctx) =>
        new Promise((resolve, reject) => {
          release = () => reject(new Error('should not resolve'));
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    },
  });
  const running = h.call('searchTrials', { conditionTerms: ['asthma'] }, 'search1');
  await new Promise(r => setImmediate(r));
  assert.equal(okResult<Record<string, any>>(await h.call('status', {})).session.pending, 1);
  assert.equal(errorCode(await h.call('prepareReal', { packet, policyReceipt: receipt })), 'BUSY');
  assert.equal(errorCode(await h.call('screenLocal', { nctIds: [FICTIONAL_IDS[0]], profile: {} })), 'NOT_IMPLEMENTED');
  assert.deepEqual(okResult(await h.call('cancel', { requestId: 'search1' })), { aborted: true });
  assert.equal(errorCode(await running), 'CANCELLED');
  assert.deepEqual(okResult(await h.call('cancel', { requestId: 'search1' })), { aborted: false });
  void release;

  const slow = harness({
    execute: ctx =>
      new Promise((_resolve, reject) => {
        ctx.emitTrace({ stage: 'input', outcome: 'started', consentDigest: ctx.consentDigest });
        ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  });
  const p = await prepared(slow);
  const run = slow.call('executeReal', execute(p), 'exec1');
  await new Promise(r => setImmediate(r));
  okResult(await slow.call('revokeReal', {}));
  assert.equal(errorCode(await run), 'CANCELLED', 'revoking consent aborts the running real operation');
  assert.deepEqual(slow.events.at(-1)?.trace.stage, 'result');
  assert.deepEqual(slow.events.at(-1)?.trace.outcome, 'cancelled');

  const expiring = harness({ execute: ctx => new Promise((_r, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')))) });
  const q = await prepared(expiring);
  const longRun = expiring.call('executeReal', execute(q));
  await new Promise(r => setImmediate(r));
  expiring.ports.clock.advance(PREPARED_TTL_MS);
  assert.equal(errorCode(await longRun), 'CANCELLED', 'the consent window ending aborts work still running (real.mjs timer semantics)');
});

test('outputs that fail validation are replaced by an error, clear consent, and never add records', async () => {
  const h = harness({ pipelines: { searchTrials: async () => ({ records: [], retrievedAt: 'yesterday', source: 'live', skippedRecords: 0, query: { conditionTerms: ['x'], country: 'US' } }) as never } });
  assert.equal(errorCode(await h.call('searchTrials', { conditionTerms: ['x'] })), 'INTERNAL_ERROR');
  const throwing = harness({ pipelines: { searchTrials: async () => { throw new Error('SENSITIVE_SENTINEL provider text'); } } });
  const response = await throwing.call('searchTrials', { conditionTerms: ['x'] });
  assert.equal(errorCode(response), 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(response).includes('SENSITIVE_SENTINEL'));
  // A search response that fails validation never adds its (otherwise valid) records.
  const invalidTail = harness({
    pipelines: {
      searchTrials: async () => ({ records: [baseRecord(FICTIONAL_IDS[0])], retrievedAt: '2026-10-24T08:00:00Z', source: 'live', skippedRecords: 0, query: { conditionTerms: ['x'], country: 'US' }, extra: true }) as never,
    },
  });
  assert.equal(errorCode(await invalidTail.call('searchTrials', { conditionTerms: ['x'] })), 'INTERNAL_ERROR');
  assert.equal(errorCode(await invalidTail.call('prepareReal', { packet, policyReceipt: receipt })), 'RECORD_NOT_IN_SESSION', 'no record was held');
});

test('createCore rejects missing ports, unknown modes, and unknown or non-function pipelines', () => {
  assert.throws(() => createCore({} as never, { mode: 'mocked', runtime: 'test' }));
  assert.throws(() => createCore(testPorts(), { mode: 'test' as never, runtime: 'test' }));
  assert.throws(() => createCore(testPorts(), { mode: 'live', runtime: 'browser' as never }));
  assert.throws(() => createCore(testPorts(), { mode: 'mocked', runtime: 'test', pipelines: { buildPreview: async () => ({}) } as never }), 'there is no preview pipeline to replace');
  assert.throws(() => createCore(testPorts(), { mode: 'mocked', runtime: 'test', pipelines: { executeReal: 'run' } as never }));
});
