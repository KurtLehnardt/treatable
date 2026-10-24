// Mocked: no network. endSession wipes all in-memory session state; proven by behavior and by garbage collection.
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { createSession, defineSlot } from '../src/session.ts';
import { CoreError } from '../src/errors.ts';
import { CONSENT_POLICY_VERSION, type PreparedRealResult } from '../src/protocol.ts';
import { testPorts } from './support/fakes.ts';
import { errorCode, harness, okResult, receipt } from './support/harness.ts';
import { basePacket, makePreview } from './support/preview.ts';
import type { JsonObject } from '../src/json.ts';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;

async function collect(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    gc();
    await new Promise(resolve => setImmediate(resolve));
  }
}

test('wipe cancels running work, clears and closes consent, drops slots, IDs and subject, and refuses writes', async () => {
  const ports = testPorts();
  const session = createSession(ports);
  const RECORDS = defineSlot<{ ids: string[] }>('records');
  session.set(RECORDS, { ids: ['NCT90000001'] });
  session.setSubjectDigest('a'.repeat(64));
  assert.equal(session.markSeen('r1'), 'ok');
  const prepared = await session.consent.prepare({ policyReceipt: receipt, subjectDigest: 'a'.repeat(64), operations: ['score'], preview: makePreview(basePacket({ agentNctIds: undefined })) as unknown as JsonObject });
  const running = session.begin('r2', { real: true });
  let aborted = false;
  running.signal.addEventListener('abort', () => (aborted = true));
  assert.equal(ports.clock.pendingTimers(), 1);

  session.wipe();

  assert.equal(aborted, true);
  assert.equal(session.ended, true);
  assert.equal(session.pendingCount(), 0);
  assert.equal(session.requestCount(), 0);
  assert.equal(session.get(RECORDS), undefined);
  assert.equal(session.subjectDigest(), undefined);
  assert.deepEqual(session.consent.snapshot(), { active: false, remaining: [] });
  assert.equal(ports.clock.pendingTimers(), 0, 'the expiry timer is cancelled, so the clock holds no reference');
  assert.throws(
    () => session.consent.take({ policyReceipt: receipt, token: prepared.token, digest: prepared.digest, operation: 'score', subjectDigest: 'a'.repeat(64) }),
    (e: unknown) => e instanceof CoreError && e.code === 'INVALID_CONSENT_RECEIPT',
  );
  assert.throws(() => session.set(RECORDS, { ids: [] }), (e: unknown) => e instanceof CoreError && e.code === 'CANCELLED');
  assert.throws(() => session.begin('r3', { real: false }), (e: unknown) => e instanceof CoreError && e.code === 'CANCELLED');
  await assert.rejects(session.consent.prepare({ policyReceipt: receipt, subjectDigest: 'a'.repeat(64), operations: ['score'], preview: {} }));
});

test('endSession: prepared receipts are invalid afterwards and make zero provider requests', async () => {
  const h = harness();
  okResult(await h.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }));
  const p = okResult<PreparedRealResult>(await h.call('prepareReal', { packet: basePacket(), policyReceipt: receipt }));
  assert.equal(okResult<Record<string, any>>(await h.call('status', {})).session.prepared, true);
  assert.deepEqual(okResult(await h.call('endSession', {})), { wiped: true });
  const status = okResult<Record<string, any>>(await h.call('status', {}));
  assert.deepEqual(status.session, { prepared: false, pending: 0, requests: 1 });
  const execute = { token: p.token, digest: p.digest, operation: 'score', policyReceipt: receipt };
  assert.equal(errorCode(await h.call('executeReal', execute)), 'INVALID_CONSENT_RECEIPT');
  assert.equal(errorCode(await h.call('executeReal', { ...execute, operation: 'agent' })), 'INVALID_CONSENT_RECEIPT');
  assert.equal(h.log.executions.length, 0);
  assert.equal(h.log.credentialRequests.length, 0);
  assert.equal(errorCode(await h.call('prepareReal', { packet: basePacket(), policyReceipt: receipt })), 'RECORD_NOT_IN_SESSION', 'the record-set subject is gone too');
});

test('endSession cancels in-flight work; late results from the old session are never returned', async () => {
  let resolveSearch!: (value: unknown) => void;
  const h = harness({
    pipelines: {
      searchTrials: () => new Promise(resolve => (resolveSearch = resolve)) as never,
    },
  });
  const running = h.call('searchTrials', { conditionTerms: ['asthma'] });
  await new Promise(r => setImmediate(r));
  okResult(await h.call('endSession', {}));
  resolveSearch({ records: [], retrievedAt: '2026-10-24T08:00:00Z', source: 'live', query: { conditionTerms: ['asthma'], country: 'US' } });
  assert.equal(errorCode(await running), 'CANCELLED');
});

test('endSession leaves no reference to pinned payloads, records, or the old session (garbage-collection proof)', async () => {
  const h = harness();
  let pinnedRef: WeakRef<object> | undefined;
  let recordsRef: WeakRef<object> | undefined;
  const RECORDS = defineSlot<object>('records');
  const capture = harness({
    execute: async (ctx, log) => {
      pinnedRef = new WeakRef(ctx.pinned.preview as object);
      const records = { ids: ['NCT90000001'], payload: 'x'.repeat(1000) };
      recordsRef = new WeakRef(records);
      ctx.session.set(RECORDS, records);
      return (await import('./support/harness.ts')).defaultExecute(ctx, log);
    },
  });
  void h;
  await (async () => {
    okResult(await capture.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }));
    const p = okResult<PreparedRealResult>(await capture.call('prepareReal', { packet: basePacket(), policyReceipt: receipt }));
    okResult(await capture.call('executeReal', { token: p.token, digest: p.digest, operation: 'score', policyReceipt: receipt }));
  })();
  capture.log.executions.length = 0; // the test log itself must not keep the pinned preview alive
  await collect();
  assert.ok(pinnedRef?.deref(), 'control: while the session lives, the store still pins the preview');
  assert.ok(recordsRef?.deref(), 'control: while the session lives, its slots hold state');
  okResult(await capture.call('endSession', {}));
  await collect();
  assert.equal(pinnedRef?.deref(), undefined, 'pinned preview collected after endSession');
  assert.equal(recordsRef?.deref(), undefined, 'session slot state collected after endSession');
});

test('the policy version is the apps notice identifier', () => {
  assert.equal(CONSENT_POLICY_VERSION, 'treatable-apps-health-api-2026-10-24-v1');
});
