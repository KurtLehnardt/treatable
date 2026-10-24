// Mocked: no network. Consent store semantics ported from extension/native/real.mjs (PreparedRealStore)
// and extension/native/test/real.test.mjs at 48c569e, adapted to the runtime-neutral store.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSENT_POLICY_VERSION,
  PREPARED_TTL_MS,
  computeConsentDigest,
  createConsentStore,
  type ConsentPins,
  type ConsentStore,
  type PinnedConsent,
} from '../src/consent/index.ts';
import { CoreError } from '../src/errors.ts';
import { canonicalJson, type JsonObject } from '../src/json.ts';
import { computeRequestPins } from '../src/outbound.ts';
import type { Preview } from '../src/protocol.ts';
import { nodeSha256 } from '../node/ports.node.ts';
import { FakeClock, SequentialTokens, sha256Hex } from './support/fakes.ts';
import { basePacket, makePreview } from './support/preview.ts';

const receipt = { policyVersion: CONSENT_POLICY_VERSION, accepted: true } as const;
const SUBJECT = 'c'.repeat(64);
const preview = () => makePreview(basePacket()) as unknown as JsonObject;

/** Pins recomputed independently with node:crypto over the canonical body serializations. */
function independentPins(p: JsonObject): ConsentPins {
  const value = p as unknown as Preview;
  return {
    decisionsRequests: value.decisionsRequests.map(body => sha256Hex(canonicalJson(body))),
    agentsCreate: value.agentsRequest === null ? null : sha256Hex(canonicalJson(value.agentsRequest)),
    toolResults: value.toolResults.map(result => sha256Hex(canonicalJson(result))),
  };
}

function setup(overrides: { maxReplyBytes?: number; ttlMs?: number } = {}) {
  const clock = new FakeClock();
  const tokens = new SequentialTokens();
  let invalidations = 0;
  const store = createConsentStore(
    { sha256: nodeSha256, tokens, clock },
    { maxReplyBytes: overrides.maxReplyBytes ?? 96 * 1024 - 1024, ...(overrides.ttlMs ? { ttlMs: overrides.ttlMs } : {}), onInvalidate: () => (invalidations += 1) },
  );
  return { clock, tokens, store, invalidations: () => invalidations };
}

const prepare = (store: ConsentStore, p: JsonObject = preview(), operations: ('score' | 'agent')[] = ['score', 'agent']) =>
  store.prepare({ policyReceipt: receipt, subjectDigest: SUBJECT, operations, preview: p, pins: independentPins(p) });

const takeInput = (prepared: { token: string; digest: string }, operation: unknown = 'score', extra: Record<string, unknown> = {}) => ({
  policyReceipt: receipt,
  token: prepared.token,
  digest: prepared.digest,
  operation,
  subjectDigest: SUBJECT,
  ...extra,
});

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof CoreError, 'only CoreError leaves the store');
    assert.equal(error.message, error.code, 'constant-shape: the message is the code');
    return error.code;
  }
  return undefined;
}

test('[ported real.test.mjs#3] preparation pins the exact preview and the SHA-256 of each sent byte string, with an independently recomputable digest', async () => {
  const { store, clock } = setup();
  const p = preview();
  const pins = independentPins(p);
  assert.deepEqual(await computeRequestPins(nodeSha256, p as unknown as Preview), pins, 'the core pins the canonical serialization of every body');
  const prepared = await prepare(store, p);
  assert.match(prepared.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(prepared.digest, /^[a-f0-9]{64}$/);
  const expected = sha256Hex(canonicalJson({ operations: ['score', 'agent'], pins: { ...pins }, policyVersion: CONSENT_POLICY_VERSION, preview: p, subjectDigest: SUBJECT }));
  assert.equal(prepared.digest, expected, 'digest = sha256(canonical({operations, pins, policyVersion, preview, subjectDigest}))');
  assert.equal(await computeConsentDigest(nodeSha256, { policyVersion: CONSENT_POLICY_VERSION, subjectDigest: SUBJECT, operations: ['score', 'agent'], preview: p, pins }), expected);
  assert.deepEqual(prepared.preview, p);
  assert.notEqual(prepared.preview, p, 'reply is a copy');
  assert.equal(prepared.expiresAt, clock.now() + PREPARED_TTL_MS);
  assert.equal(prepared.policyVersion, CONSENT_POLICY_VERSION);
  assert.deepEqual(store.snapshot(), { active: true, remaining: ['score', 'agent'] });
  const reordered = JSON.parse(JSON.stringify({ ...p, packet: { ...(p.packet as object) } })) as JsonObject;
  const second = await prepare(store, reordered);
  assert.equal(second.digest, expected, 'key order does not change the canonical digest');
  assert.notEqual(second.token, prepared.token, 'every preparation gets a fresh token');
  const otherPins = await store.prepare({ policyReceipt: receipt, subjectDigest: SUBJECT, operations: ['score', 'agent'], preview: p, pins: { ...pins, agentsCreate: 'e'.repeat(64) } });
  assert.notEqual(otherPins.digest, expected, 'the pins are part of the digest');
  await assert.rejects(store.prepare({ policyReceipt: receipt, subjectDigest: SUBJECT, operations: ['score'], preview: p, pins: { ...pins, toolResults: ['nothex'] } }), (e: unknown) => e instanceof CoreError && e.code === 'INTERNAL_ERROR');
});

test('[ported real.test.mjs#4] stale, changed, replayed, expired, revoked and missing-policy receipts are rejected before anything is returned', async () => {
  const { store, clock } = setup();
  for (const invalid of [
    (p: { token: string; digest: string }) => takeInput({ ...p, token: 'x'.repeat(43) }),
    (p: { token: string; digest: string }) => takeInput({ ...p, digest: '0'.repeat(64) }),
    (p: { token: string; digest: string }) => takeInput(p, 'score', { policyReceipt: { accepted: true, policyVersion: 'old' } }),
    (p: { token: string; digest: string }) => takeInput(p, 'score', { policyReceipt: undefined }),
    (p: { token: string; digest: string }) => takeInput(p, 'score', { policyReceipt: { ...receipt, extra: true } }),
    (p: { token: string; digest: string }) => takeInput(p, 'both'),
    (p: { token: string; digest: string }) => takeInput(p, 'score', { token: 42 }),
  ]) {
    const p = await prepare(store);
    assert.equal(code(() => store.take(invalid(p))), 'INVALID_CONSENT_RECEIPT');
    assert.equal(code(() => store.take(takeInput(p))), 'INVALID_CONSENT_RECEIPT', 'the failed take cleared the preparation');
  }
  const p = await prepare(store);
  const pinned = store.take(takeInput(p));
  assert.equal(pinned.consentDigest, p.digest);
  assert.deepEqual(pinned.pins, independentPins(preview()), 'take hands the pins to the dispatcher');
  const agent = store.take(takeInput(p, 'agent'));
  assert.equal(agent.operation, 'agent', 'each authorized operation runs once per token');
  assert.equal(code(() => store.take(takeInput(p, 'agent'))), 'INVALID_CONSENT_RECEIPT', 'replay');
  await prepare(store);
  const p2 = await prepare(store, makePreview(basePacket({ state: 'WA' })) as unknown as JsonObject);
  store.revoke(p2.token);
  assert.equal(code(() => store.take(takeInput(p2))), 'INVALID_CONSENT_RECEIPT', 'revoked');
  const p3 = await prepare(store);
  clock.mono += PREPARED_TTL_MS + 1; // past expiry without firing the timer: lazy check
  assert.equal(code(() => store.take(takeInput(p3))), 'CONSENT_EXPIRED');
  assert.equal(code(() => store.take(takeInput(p3))), 'CONSENT_EXPIRED', 'stays expired');
});

test('clear/keep matrix: every failed take() with an active preparation clears it; only a take() with nothing active has nothing to clear', async () => {
  const cases: [string, (p: { token: string; digest: string }, store: ConsentStore) => unknown, string][] = [
    ['invalid policy receipt', p => takeInput(p, 'score', { policyReceipt: { ...receipt, accepted: false } }), 'INVALID_CONSENT_RECEIPT'],
    ['wrong token', p => takeInput({ ...p, token: 'x'.repeat(43) }), 'INVALID_CONSENT_RECEIPT'],
    ['wrong digest', p => takeInput({ ...p, digest: 'f'.repeat(64) }), 'INVALID_CONSENT_RECEIPT'],
    ['unknown operation', p => takeInput(p, 'both'), 'INVALID_CONSENT_RECEIPT'],
    ['changed subject', p => takeInput(p, 'score', { subjectDigest: 'd'.repeat(64) }), 'INVALID_CONSENT_RECEIPT'],
    ['no subject', p => takeInput(p, 'score', { subjectDigest: undefined }), 'INVALID_CONSENT_RECEIPT'],
  ];
  for (const [name, input, expected] of cases) {
    const { store, invalidations } = setup();
    const p = await prepare(store);
    const before = invalidations();
    assert.equal(code(() => store.take(input(p, store) as never)), expected, name);
    assert.equal(store.snapshot().active, false, `${name} clears`);
    assert.equal(invalidations(), before + 1, `${name} invalidates running work`);
  }
  {
    const { store } = setup();
    const p = await prepare(store, makePreview(basePacket({ agentNctIds: undefined })) as unknown as JsonObject, ['score']);
    assert.equal(code(() => store.take(takeInput(p, 'agent'))), 'INVALID_CONSENT_RECEIPT', 'unauthorized operation');
    assert.equal(store.snapshot().active, false, 'unauthorized operation clears');
  }
  {
    const { store } = setup();
    const p = await prepare(store);
    assert.equal(store.take(takeInput(p)).operation, 'score');
    assert.deepEqual(store.snapshot(), { active: true, remaining: ['agent'] }, 'a successful take keeps the other operation');
    assert.equal(code(() => store.take(takeInput(p))), 'INVALID_CONSENT_RECEIPT', 'used operation');
    assert.equal(store.snapshot().active, false, 'a replayed operation clears, and the unused agent operation goes with it');
  }
  {
    const { store, clock, invalidations } = setup();
    const p = await prepare(store);
    clock.mono += PREPARED_TTL_MS;
    const before = invalidations();
    assert.equal(code(() => store.take(takeInput(p))), 'CONSENT_EXPIRED');
    assert.equal(invalidations(), before + 1, 'expiry clears');
  }
  {
    const { store, invalidations } = setup();
    const before = invalidations();
    assert.equal(code(() => store.take(takeInput({ token: 'a'.repeat(43), digest: 'b'.repeat(64) }))), 'INVALID_CONSENT_RECEIPT');
    assert.equal(code(() => store.take(takeInput({ token: 'a'.repeat(43), digest: 'b'.repeat(64) }, 'score', { policyReceipt: undefined }))), 'INVALID_CONSENT_RECEIPT');
    assert.equal(invalidations(), before, 'no active preparation: nothing to clear, no invalidation');
  }
});

test('clear/keep matrix for revoke(): it always clears; a non-string or mismatched token is still reported', async () => {
  const cases: [string, unknown, string | undefined][] = [
    ['no token', undefined, undefined],
    ['matching token', 'MATCH', undefined],
    ['mismatched token', 'z'.repeat(43), 'INVALID_CONSENT_RECEIPT'],
    ['non-string token', 7, 'INVALID_CONSENT_RECEIPT'],
  ];
  for (const [name, token, expected] of cases) {
    const { store } = setup();
    const p = await prepare(store);
    assert.equal(code(() => store.revoke(token === 'MATCH' ? p.token : token)), expected, name);
    assert.equal(store.snapshot().active, false, `${name}: cleared`);
    assert.equal(code(() => store.take(takeInput(p))), 'INVALID_CONSENT_RECEIPT', `${name}: receipt unusable`);
  }
  const { store } = setup();
  assert.equal(code(() => store.revoke('q'.repeat(43))), undefined, 'a token with nothing active is accepted (as in real.mjs)');
});

test('a preparation authorizes only the operations it names', async () => {
  const { store } = setup();
  const p = await prepare(store, makePreview(basePacket({ agentNctIds: undefined })) as unknown as JsonObject, ['score']);
  assert.deepEqual(p.operations, ['score']);
  assert.equal(store.take(takeInput(p, 'score')).operation, 'score');
  assert.deepEqual(store.snapshot(), { active: true, remaining: [] });
});

test('expiry: the five-minute timer clears the preparation, invalidates running work, and reports CONSENT_EXPIRED', async () => {
  const { store, clock, invalidations } = setup();
  const p = await prepare(store);
  const before = invalidations();
  clock.advance(PREPARED_TTL_MS - 1);
  assert.equal(store.snapshot().active, true);
  assert.equal(store.take(takeInput(p)).operation, 'score', 'still valid one millisecond before expiry');
  clock.advance(1);
  assert.equal(store.snapshot().active, false);
  assert.equal(invalidations(), before + 1, 'expiry calls onInvalidate (aborts in-flight real operations)');
  assert.equal(code(() => store.take(takeInput(p, 'agent'))), 'CONSENT_EXPIRED');
  assert.equal(clock.pendingTimers(), 0);
  // A changed wall clock cannot extend the window: expiry uses the monotonic clock.
  const q = await prepare(store);
  clock.wall -= 3_600_000;
  clock.mono += PREPARED_TTL_MS;
  assert.equal(code(() => store.take(takeInput(q))), 'CONSENT_EXPIRED');
});

test('mutation invalidation: clear() and a changed pinned subject digest make the receipt unusable', async () => {
  const { store, invalidations } = setup();
  const p = await prepare(store);
  const before = invalidations();
  store.clear();
  assert.equal(invalidations(), before + 1);
  assert.equal(code(() => store.take(takeInput(p))), 'INVALID_CONSENT_RECEIPT');
  const q = await prepare(store);
  assert.equal(code(() => store.take(takeInput(q, 'score', { subjectDigest: 'd'.repeat(64) }))), 'INVALID_CONSENT_RECEIPT');
  assert.equal(store.snapshot().active, false, 'a subject mismatch clears the preparation');
});

test('digest mismatch: any change to the returned preview cannot change pinned data, and a different digest never matches', async () => {
  const { store } = setup();
  const p = await prepare(store);
  const returned = p.preview as unknown as ReturnType<typeof makePreview>;
  returned.decisionsRequests[0]!.input[0].content[1].data.profile.conditionTerm = 'PRIVATE_SENTINEL';
  returned.packet.conditionTerm = 'PRIVATE_SENTINEL';
  const tampered = sha256Hex(canonicalJson({ operations: ['score', 'agent'], pins: independentPins(returned as unknown as JsonObject), policyVersion: CONSENT_POLICY_VERSION, preview: returned as unknown as JsonObject, subjectDigest: SUBJECT }));
  assert.notEqual(tampered, p.digest);
  const pinned: PinnedConsent = store.take(takeInput(p));
  assert.ok(!JSON.stringify(pinned.preview).includes('PRIVATE_SENTINEL'));
  assert.ok(Object.isFrozen(pinned.preview));
  assert.ok(Object.isFrozen((pinned.preview as { decisionsRequests: object[] }).decisionsRequests[0]));
  assert.ok(Object.isFrozen(pinned.pins) && Object.isFrozen(pinned.pins.decisionsRequests));
  assert.throws(() => {
    (pinned.preview as Record<string, unknown>).packet = {};
  });
  assert.equal(code(() => store.take(takeInput({ token: p.token, digest: tampered }, 'agent'))), 'INVALID_CONSENT_RECEIPT');
});

test('close() wipes and permanently disables the store', async () => {
  const { store } = setup();
  const p = await prepare(store);
  store.close();
  assert.equal(store.snapshot().active, false);
  assert.equal(code(() => store.take(takeInput(p))), 'INVALID_CONSENT_RECEIPT');
  await assert.rejects(prepare(store), (e: unknown) => e instanceof CoreError && e.code === 'CANCELLED');
});

test('a clear while the digest is being computed wins over the preparation', async () => {
  const clock = new FakeClock();
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  const slowSha = { digestHex: async (bytes: Uint8Array) => { await gate; return nodeSha256.digestHex(bytes); } };
  const store = createConsentStore({ sha256: slowSha, tokens: new SequentialTokens(), clock }, { maxReplyBytes: 95 * 1024 });
  const pending = prepare(store);
  store.clear();
  release();
  await assert.rejects(pending, (e: unknown) => e instanceof CoreError && e.code === 'CANCELLED');
  assert.equal(store.snapshot().active, false);
  assert.equal(clock.pendingTimers(), 0);
});

test('PREVIEW_TOO_LARGE, bad policy receipts, and misbehaving ports fail closed without pinning anything', async () => {
  const small = setup({ maxReplyBytes: 1000 });
  await assert.rejects(prepare(small.store), (e: unknown) => e instanceof CoreError && e.code === 'PREVIEW_TOO_LARGE');
  assert.equal(small.store.snapshot().active, false);
  const { store } = setup();
  const p = preview();
  const pins = independentPins(p);
  await assert.rejects(store.prepare({ policyReceipt: { ...receipt, accepted: false }, subjectDigest: SUBJECT, operations: ['score'], preview: p, pins }), (e: unknown) => e instanceof CoreError && e.code === 'INVALID_REQUEST');
  await assert.rejects(store.prepare({ policyReceipt: receipt, subjectDigest: 'nothex', operations: ['score'], preview: p, pins }), (e: unknown) => e instanceof CoreError && e.code === 'INTERNAL_ERROR');
  await assert.rejects(store.prepare({ policyReceipt: receipt, subjectDigest: SUBJECT, operations: [], preview: p, pins }));
  await assert.rejects(store.prepare({ policyReceipt: receipt, subjectDigest: SUBJECT, operations: ['score', 'score'], preview: p, pins }));
  await assert.rejects(store.prepare({ policyReceipt: receipt, subjectDigest: SUBJECT, operations: ['score'], preview: { bad: undefined } as unknown as JsonObject, pins }));
  await assert.rejects(store.prepare({ policyReceipt: receipt, subjectDigest: SUBJECT, operations: ['score'], preview: p, pins: undefined as never }));
  const clock = new FakeClock();
  const badPorts = [
    { sha256: { digestHex: () => 'NOT-HEX' }, tokens: new SequentialTokens() },
    { sha256: nodeSha256, tokens: { randomBytes: (n: number) => new Uint8Array(n) } },
    { sha256: nodeSha256, tokens: { randomBytes: () => new Uint8Array(8) } },
    { sha256: nodeSha256, tokens: { randomBytes: () => 'not bytes' as unknown as Uint8Array } },
  ];
  for (const ports of badPorts) {
    const broken = createConsentStore({ ...ports, clock }, { maxReplyBytes: 95 * 1024 });
    await assert.rejects(prepare(broken), (e: unknown) => e instanceof CoreError && e.code === 'INTERNAL_ERROR');
    assert.equal(broken.snapshot().active, false);
  }
  assert.throws(() => createConsentStore({ sha256: nodeSha256, tokens: new SequentialTokens(), clock }, { maxReplyBytes: 1000, ttlMs: PREPARED_TTL_MS + 1 }));
});

test('errors never contain tokens, digests, or payload text', async () => {
  const messages: string[] = [];
  for (const bad of [(p: { token: string; digest: string }) => takeInput({ ...p, token: 'PRIVATE_SENTINEL'.padEnd(43, 'x') }), (p: { token: string; digest: string }) => takeInput(p, 'PRIVATE_SENTINEL')]) {
    const { store } = setup();
    const p = await prepare(store);
    try {
      store.take(bad(p));
    } catch (error) {
      messages.push(JSON.stringify({ ...(error as object), message: (error as Error).message }));
      for (const m of messages) assert.ok(!m.includes('PRIVATE_SENTINEL') && !m.includes(p.token) && !m.includes(p.digest), m);
    }
  }
  assert.equal(messages.length, 2);
});
