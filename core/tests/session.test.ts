// Mocked: no network. endSession wipes all in-memory session state; proven by behavior and by garbage collection.
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { createSession, defineSlot } from '../src/session.ts';
import { CoreError } from '../src/errors.ts';
import { computeRequestPins } from '../src/outbound.ts';
import { CONSENT_POLICY_VERSION, type PreparedRealResult, type Preview } from '../src/protocol.ts';
import { nodeSha256 } from '../node/ports.node.ts';
import { testPorts } from './support/fakes.ts';
import { errorCode, fakeRecord, harness, okResult, receipt } from './support/harness.ts';
import { FICTIONAL_IDS, basePacket, makePreview } from './support/preview.ts';
import type { JsonObject } from '../src/json.ts';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;

async function collect(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    gc();
    await new Promise(resolve => setImmediate(resolve));
  }
}

test('wipe cancels running work, clears and closes consent, drops records, slots, and IDs, and refuses writes', async () => {
  const ports = testPorts();
  const session = createSession(ports);
  const SLOT = defineSlot<{ ids: string[] }>('test.slot');
  session.slots.set(SLOT, { ids: ['NCT90000001'] });
  session.commitRecords(await session.records.prepareMerge(nodeSha256, [fakeRecord(FICTIONAL_IDS[0])]));
  const subject = session.subjectDigest();
  assert.match(subject ?? '', /^[a-f0-9]{64}$/, 'the subject is the record-set digest');
  assert.equal(session.markSeen('r1'), 'ok');
  const preview = makePreview(basePacket({ agentNctIds: undefined, scoreNctIds: [FICTIONAL_IDS[0]] })) as unknown as JsonObject;
  const pins = await computeRequestPins(nodeSha256, preview as unknown as Preview);
  const prepared = await session.consent.prepare({ policyReceipt: receipt, subjectDigest: subject!, operations: ['score'], preview, pins });
  const running = session.begin('r2', { real: true });
  let aborted = false;
  running.signal.addEventListener('abort', () => (aborted = true));
  assert.equal(ports.clock.pendingTimers(), 1);

  session.wipe();

  assert.equal(aborted, true);
  assert.equal(session.ended, true);
  assert.equal(session.pendingCount(), 0);
  assert.equal(session.requestCount(), 0);
  assert.equal(session.slots.get(SLOT), undefined);
  assert.equal(session.records.size, 0);
  assert.equal(session.records.view.has(FICTIONAL_IDS[0]), false);
  assert.equal(session.subjectDigest(), undefined);
  assert.deepEqual(session.consent.snapshot(), { active: false, remaining: [] });
  assert.equal(ports.clock.pendingTimers(), 0, 'the expiry timer is cancelled, so the clock holds no reference');
  assert.throws(
    () => session.consent.take({ policyReceipt: receipt, token: prepared.token, digest: prepared.digest, operation: 'score', subjectDigest: subject }),
    (e: unknown) => e instanceof CoreError && e.code === 'INVALID_CONSENT_RECEIPT',
  );
  assert.throws(() => session.slots.set(SLOT, { ids: [] }), (e: unknown) => e instanceof CoreError && e.code === 'CANCELLED');
  assert.throws(() => session.begin('r3', { real: false }), (e: unknown) => e instanceof CoreError && e.code === 'CANCELLED');
  const late = await createSession(testPorts()).records.prepareMerge(nodeSha256, [fakeRecord(FICTIONAL_IDS[1])]);
  assert.throws(() => session.commitRecords(late), (e: unknown) => e instanceof CoreError && e.code === 'CANCELLED', 'an ended session takes no records');
  await assert.rejects(session.consent.prepare({ policyReceipt: receipt, subjectDigest: 'a'.repeat(64), operations: ['score'], preview: {}, pins }));
});

test('endSession: prepared receipts are invalid afterwards, make zero provider requests, and the records are gone', async () => {
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
  assert.equal(h.openai.calls.length, 0);
  assert.equal(errorCode(await h.call('prepareReal', { packet: basePacket(), policyReceipt: receipt })), 'RECORD_NOT_IN_SESSION', 'the record index is gone too');
});

test('endSession cancels in-flight work; late results from the old session are never returned or held', async () => {
  let resolveSearch!: (value: unknown) => void;
  const h = harness({
    pipelines: {
      searchTrials: () => new Promise(resolve => (resolveSearch = resolve)) as never,
    },
  });
  const running = h.call('searchTrials', { conditionTerms: ['asthma'] });
  await new Promise(r => setImmediate(r));
  okResult(await h.call('endSession', {}));
  resolveSearch({ records: [fakeRecord(FICTIONAL_IDS[0])], retrievedAt: '2026-10-24T08:00:00Z', source: 'live', skippedRecords: 0, query: { conditionTerms: ['asthma'], country: 'US' } });
  assert.equal(errorCode(await running), 'CANCELLED');
  assert.equal(errorCode(await h.call('prepareReal', { packet: basePacket(), policyReceipt: receipt })), 'RECORD_NOT_IN_SESSION');
});

test('endSession leaves no reference to pinned payloads, records, slots, or the old session (garbage-collection proof)', async () => {
  let pinnedRef: WeakRef<object> | undefined;
  let recordRef: WeakRef<object> | undefined;
  let slotRef: WeakRef<object> | undefined;
  const SLOT = defineSlot<object>('test.cursor');
  const capture = harness({
    pipelines: {
      async searchTrials(ctx, payload) {
        const cursor = { terms: payload.conditionTerms, padding: 'x'.repeat(1000) };
        slotRef = new WeakRef(cursor);
        ctx.slots.set(SLOT, cursor);
        return { records: [fakeRecord(FICTIONAL_IDS[0]), fakeRecord(FICTIONAL_IDS[1])] as never, retrievedAt: '2026-10-24T08:00:00Z', source: 'live', skippedRecords: 0, query: { conditionTerms: payload.conditionTerms, country: 'US' } };
      },
      async screenLocal(ctx, payload) {
        // A held record is reachable only through the session index; keep a weak reference to it.
        recordRef = new WeakRef(ctx.records.get(payload.nctIds[0]!)!.record);
        return { results: [] };
      },
    },
    execute: async (ctx, log) => {
      pinnedRef = new WeakRef(ctx.preview as object);
      return (await import('./support/harness.ts')).defaultExecute(ctx, log);
    },
  });
  await (async () => {
    okResult(await capture.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }));
    const p = okResult<PreparedRealResult>(await capture.call('prepareReal', { packet: basePacket(), policyReceipt: receipt }));
    okResult(await capture.call('executeReal', { token: p.token, digest: p.digest, operation: 'score', policyReceipt: receipt }));
    okResult(await capture.call('screenLocal', { nctIds: [FICTIONAL_IDS[1]], profile: {} }));
  })();
  // The test's own logs must not keep the pinned objects alive.
  capture.log.executions.length = 0;
  capture.log.contexts.length = 0;
  await collect();
  assert.ok(pinnedRef?.deref(), 'control: while the session lives, the store still pins the preview');
  assert.ok(slotRef?.deref(), 'control: while the session lives, its slots hold state');
  assert.ok(recordRef?.deref(), 'control: while the session lives, the index holds the record');
  okResult(await capture.call('endSession', {}));
  await collect();
  assert.equal(pinnedRef?.deref(), undefined, 'pinned preview collected after endSession');
  assert.equal(slotRef?.deref(), undefined, 'session slot state collected after endSession');
  assert.equal(recordRef?.deref(), undefined, 'held record collected after endSession');
});

test('the policy version is the apps notice identifier', () => {
  assert.equal(CONSENT_POLICY_VERSION, 'treatable-apps-health-api-2026-10-24-v1');
});
