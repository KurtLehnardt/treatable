// Mocked: no network. The transport gate (task A1b), ported from the outbound boundary checks in
// extension/native/transport.mjs at commit 48c569e. The point of these tests is exactly the A1b
// task requirement: a hostile caller (and a hostile or compromised transport port) tries to widen
// the outbound invariants - other hosts, other paths, bigger bodies, other headers - and fails
// before anything reaches the port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { utf8Decode, utf8Encode } from '../src/bytes.ts';
import { createCancelSource } from '../src/cancel.ts';
import { CoreError } from '../src/errors.ts';
import { MAX_OUTBOUND_BODY_BYTES, type PreparedRealResult } from '../src/protocol.ts';
import type { Transport, TransportRequest } from '../src/ports.ts';
import { guardTransport, toTransportRequest } from '../src/transport-gate.ts';
import { FAKE_KEY, defaultExecute, errorCode, harness, okResult, receipt } from './support/harness.ts';
import { basePacket } from './support/preview.ts';

/** A port that records every request it sees and answers a trivial empty-body 200. */
class Capture implements Transport {
  readonly calls: TransportRequest[] = [];
  async request(request: TransportRequest) {
    this.calls.push(request);
    return { status: 200, headers: {}, body: utf8Encode('{}') };
  }
}

const isCode = (code: string) => (e: unknown): boolean => e instanceof CoreError && e.code === code;

/** The invariant under test: a rejected request throws before the port is ever called. */
async function rejected(code: string, build: () => unknown): Promise<void> {
  const capture = new Capture();
  await assert.rejects(() => guardTransport(capture).request(build() as never), isCode(code));
  assert.equal(capture.calls.length, 0, 'a rejected request never reaches the port');
}

/** A nearly-valid request; each case overrides the one part it is hostile about. */
function baseRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { method: 'GET', url: 'https://api.openai.com/v1/decisions', headers: {}, ...overrides };
}

// -----------------------------------------------------------------------------------------------
// The origin and endpoint pins
// -----------------------------------------------------------------------------------------------

test('[ported transport.mjs] only the pinned origin with an allowlisted path connects; everything else is INVALID_ENDPOINT', async () => {
  const urls = [
    'https://evil.example/v1/decisions',
    'https://api.openai.com.evil.example/v1/decisions',
    'https://not-api.openai.com/v1/decisions',
    'https://openai.com/v1/decisions',
    'http://api.openai.com/v1/decisions',
    'https://api.openai.com:443/v1/decisions',
    'https://user:pass@api.openai.com/v1/decisions',
    'https://api.openai.com/v1/decisions?query=1',
    'https://api.openai.com/v1/decisions#fragment',
    'https://api.openai.com//v1/decisions',
    'https://api.openai.com/../v1/decisions',
    'https://api.openai.com/v1/decisions/',
    'https://API.OPENAI.COM/v1/decisions',
    'https://api.openai.com',
    'https://api.openai.com/',
    '',
    'not a url',
    'https://api.openai.com/v1/chat/completions',
    'https://api.openai.com/v1/agents',
    'https://api.openai.com/v1/agents/sessions/' + 'a'.repeat(161) + '/events',
    'https://api.openai.com/v1/agents/sessions/a.b/events',
    'https://api.openai.com/v1/decisions' + 'x'.repeat(512),
  ];
  for (const url of urls) await rejected('INVALID_ENDPOINT', () => baseRequest({ url }));
});

test('only GET, POST, and DELETE are transport methods', async () => {
  for (const method of ['PUT', 'PATCH', 'get', '', 'GET GET']) await rejected('INVALID_ENDPOINT', () => baseRequest({ method }));
  await rejected('INVALID_ENDPOINT', () => { const r = baseRequest(); delete (r as Record<string, unknown>).method; return r; });
});

// -----------------------------------------------------------------------------------------------
// The body cap and shape
// -----------------------------------------------------------------------------------------------

test('the request body cap is enforced on the bytes about to leave: at the cap passes, one byte over fails', async () => {
  await rejected('INPUT_TOO_LARGE', () =>
    baseRequest({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new Uint8Array(MAX_OUTBOUND_BODY_BYTES + 1) }),
  );
  const capture = new Capture();
  await guardTransport(capture).request(baseRequest({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: new Uint8Array(MAX_OUTBOUND_BODY_BYTES),
  }) as never);
  assert.equal(capture.calls.length, 1);
  assert.equal(capture.calls[0]!.body?.length, MAX_OUTBOUND_BODY_BYTES);
});

test('the body must be bytes, and GET may not carry one', async () => {
  await rejected('INVALID_REQUEST', () => baseRequest({ body: '{"model":"x"}' }));
  await rejected('INVALID_REQUEST', () => baseRequest({ body: utf8Encode('{}') }));
  await rejected('INVALID_REQUEST', () => baseRequest({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: [1, 2, 3] }));
});

// -----------------------------------------------------------------------------------------------
// Headers
// -----------------------------------------------------------------------------------------------

test('Content-Type is application/json exactly when a body is sent', async () => {
  await rejected('INVALID_REQUEST', () => baseRequest({ method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: utf8Encode('{}') }));
  await rejected('INVALID_REQUEST', () => baseRequest({ method: 'POST', headers: {}, body: utf8Encode('{}') }));
  await rejected('INVALID_REQUEST', () => baseRequest({ headers: { 'Content-Type': 'application/json' } }));
});

test('OpenAI-Beta: agents=v1 is required on agents paths and forbidden everywhere else', async () => {
  const sessions = 'https://api.openai.com/v1/agents/sessions';
  await rejected('INVALID_REQUEST', () => baseRequest({ method: 'POST', url: sessions, headers: {} }));
  await rejected('INVALID_REQUEST', () => baseRequest({ method: 'POST', url: sessions, headers: { 'OpenAI-Beta': 'agents=v2' } }));
  await rejected('INVALID_REQUEST', () => baseRequest({ method: 'POST', url: sessions, headers: { 'OpenAI-Beta': 'AGENTS=V1' } }));
  await rejected('INVALID_REQUEST', () => baseRequest({ headers: { 'OpenAI-Beta': 'agents=v1' } }));
  // Streaming events read on an agents path is exactly the shape the allowlist exists for.
  const capture = new Capture();
  await guardTransport(capture).request(baseRequest({
    url: 'https://api.openai.com/v1/agents/sessions/abc_123/events',
    headers: { 'OpenAI-Beta': 'agents=v1', 'openai-beta': 'agents=v1' },
  }) as never).catch(() => undefined);
  assert.equal(capture.calls.length, 0, 'a duplicate header (even same value) is rejected');
  const ok = new Capture();
  await guardTransport(ok).request(baseRequest({
    url: 'https://api.openai.com/v1/agents/sessions/abc_123/events',
    headers: { 'OpenAI-Beta': 'agents=v1', 'Accept': 'text/event-stream' },
  }) as never);
  assert.equal(ok.calls[0]!.headers['Accept'], 'text/event-stream');
});

test('Authorization is Bearer plus a contract-shaped key, or absent; nothing else is sent', async () => {
  await rejected('KEY_MISSING', () => baseRequest({ headers: { authorization: 'Bearer short' } }));
  await rejected('KEY_MISSING', () => baseRequest({ headers: { authorization: `Basic ${FAKE_KEY}` } }));
  await rejected('INVALID_REQUEST', () => baseRequest({ headers: { authorization: 'Bearer x\r\nX-Evil: 1' } }));
  await rejected('INVALID_REQUEST', () => baseRequest({ headers: { authorization: ['Bearer ' + FAKE_KEY] } }));
  const capture = new Capture();
  await guardTransport(capture).request(baseRequest({ headers: { authorization: 'Bearer ' + 'A'.repeat(43) } }) as never);
  assert.equal(capture.calls[0]!.headers['Authorization'], 'Bearer ' + 'A'.repeat(43));
});

test('unknown headers are rejected, not dropped, and values are one line of printable ASCII', async () => {
  await rejected('INVALID_REQUEST', () => baseRequest({ headers: { 'X-Custom': '1' } }));
  await rejected('INVALID_REQUEST', () => baseRequest({ headers: { Authorization: `Bearer ${FAKE_KEY}`, authorization: `Bearer ${FAKE_KEY}` } }));
  await rejected('INVALID_REQUEST', () => baseRequest({ headers: { Accept: 'text/plain' } }));
  await rejected('INVALID_REQUEST', () => baseRequest({ headers: { Accept: 'é' } }));
  await rejected('INVALID_REQUEST', () => baseRequest({ headers: { Accept: 'application/json ' + 'x'.repeat(8192) } }));
  await rejected('INVALID_REQUEST', () => baseRequest({ headers: { Accept: '' } }));
  await rejected('INVALID_REQUEST', () => baseRequest({ headers: ['Accept'] }));
  await rejected('INVALID_REQUEST', () => baseRequest({ headers: { 'Bad Header': 'x' } }));
});

test('the signal is shape-validated; a real cancel source passes through untouched', async () => {
  await rejected('INVALID_REQUEST', () => baseRequest({ signal: { aborted: 'no' } }));
  await rejected('INVALID_REQUEST', () => baseRequest({ signal: null }));
  const source = createCancelSource();
  const capture = new Capture();
  await guardTransport(capture).request(baseRequest({ signal: source.signal }) as never);
  assert.equal(capture.calls[0]!.signal, source.signal);
});

// -----------------------------------------------------------------------------------------------
// The rebuild: what the port receives is checked, canonical, frozen, and copied
// -----------------------------------------------------------------------------------------------

test('the port sees a rebuilt request: canonical header names, frozen objects, a fresh body copy', async () => {
  const capture = new Capture();
  const sourceBody = utf8Encode('{"model":"o4-mini","input":[]}');
  await guardTransport(capture).request(baseRequest({
    method: 'POST',
    headers: { authorization: `Bearer ${FAKE_KEY}`, 'content-type': 'application/json' },
    body: sourceBody,
  }) as never);
  const seen = capture.calls[0]!;
  assert.deepEqual(Object.keys(seen.headers).sort(), ['Authorization', 'Content-Type']);
  assert.equal(Object.isFrozen(seen), true);
  assert.equal(Object.isFrozen(seen.headers), true);
  assert.notEqual(seen.body, sourceBody, 'the body is a copy, not the bytes the caller handed over');
  sourceBody[0] = (sourceBody[0] ?? 0) ^ 0xff;
  assert.equal(utf8Decode(seen.body!), '{"model":"o4-mini","input":[]}');
});

// -----------------------------------------------------------------------------------------------
// toTransportRequest: the only constructor a core caller should use
// -----------------------------------------------------------------------------------------------

test('toTransportRequest pins method, path, serialization, and headers', () => {
  assert.throws(() => toTransportRequest({ method: 'PUT' as never, path: '/v1/decisions' }), isCode('INVALID_ENDPOINT'));
  assert.throws(() => toTransportRequest({ method: 'GET', path: '/v1/chat/completions' }), isCode('INVALID_ENDPOINT'));
  assert.throws(() => toTransportRequest({ method: 'GET', path: '/v1/decisions', body: {} }), isCode('INVALID_REQUEST'));
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(() => toTransportRequest({ method: 'POST', path: '/v1/decisions', body: circular }), isCode('INVALID_REQUEST'));
  assert.throws(
    () => toTransportRequest({ method: 'POST', path: '/v1/decisions', body: { pad: 'x'.repeat(MAX_OUTBOUND_BODY_BYTES) } }),
    isCode('INPUT_TOO_LARGE'),
  );
  assert.throws(() => toTransportRequest({ method: 'GET', path: '/v1/decisions', apiKey: 'bad key' }), isCode('KEY_MISSING'));

  const noKey = toTransportRequest({ method: 'GET', path: '/v1/decisions' });
  assert.equal('Authorization' in noKey.headers, false);
  const streaming = toTransportRequest({ method: 'GET', path: '/v1/agents/sessions/abc_123/events', accept: 'text/event-stream' });
  assert.deepEqual(streaming.headers, { 'OpenAI-Beta': 'agents=v1', Accept: 'text/event-stream' });
  assert.equal(streaming.url, 'https://api.openai.com/v1/agents/sessions/abc_123/events');
  assert.equal(Object.isFrozen(streaming), true);
  const posted = toTransportRequest({ method: 'POST', path: '/v1/decisions', apiKey: FAKE_KEY, body: { model: 'o4-mini' } });
  assert.deepEqual(posted.headers, { Authorization: `Bearer ${FAKE_KEY}`, 'Content-Type': 'application/json' });
});

test('parity: what the builder produces passes the guard unchanged in meaning', async () => {
  const capture = new Capture();
  const built = toTransportRequest({ method: 'POST', path: '/v1/decisions', apiKey: FAKE_KEY, body: { model: 'o4-mini' } });
  await guardTransport(capture).request(built);
  const seen = capture.calls[0]!;
  assert.equal(seen.url, 'https://api.openai.com/v1/decisions');
  assert.equal(seen.headers['Authorization'], `Bearer ${FAKE_KEY}`);
  assert.equal(seen.headers['Content-Type'], 'application/json');
  assert.equal(utf8Decode(seen.body!), '{"model":"o4-mini"}');
});

// -----------------------------------------------------------------------------------------------
// End to end: a hand-crafted request inside a pipeline cannot widen the gate
// -----------------------------------------------------------------------------------------------

const executePayload = (p: PreparedRealResult) => ({ token: p.token, digest: p.digest, operation: 'score' as const, policyReceipt: receipt });

async function prepared(h: ReturnType<typeof harness>): Promise<PreparedRealResult> {
  okResult(await h.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }));
  return okResult<PreparedRealResult>(await h.call('prepareReal', { packet: basePacket(), policyReceipt: receipt }));
}

test('end to end: hostile hand-crafted requests through ctx.ports.transport answer typed errors and zero port calls', async () => {
  const hostile: [string, string, Record<string, unknown>][] = [
    ['another host', 'INVALID_ENDPOINT', { url: 'https://evil.example/v1/decisions' }],
    ['unallowlisted path', 'INVALID_ENDPOINT', { url: 'https://api.openai.com/v1/chat/completions' }],
    ['another method', 'INVALID_ENDPOINT', { method: 'PUT' }],
    ['oversize body', 'INPUT_TOO_LARGE', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new Uint8Array(MAX_OUTBOUND_BODY_BYTES + 1) }],
    ['agents path without beta', 'INVALID_REQUEST', { url: 'https://api.openai.com/v1/agents/sessions/abc_123/events' }],
    ['key instead of a token', 'KEY_MISSING', { headers: { authorization: 'Basic abc' } }],
  ];
  for (const [name, code, over] of hostile) {
    const capture = new Capture();
    const h = harness({
      transport: capture,
      execute: async (ctx, log) => {
        await ctx.ports.transport.request(baseRequest(over) as never);
        throw new Error('unreachable: the guard must reject before this');
      },
    });
    const p = await prepared(h);
    assert.equal(errorCode(await h.call('executeReal', executePayload(p))), code, name);
    assert.equal(capture.calls.length, 0, name);
    assert.equal(h.log.credentialRequests.length, 0, `${name}: no credential is requested for a request that cannot leave`);
  }
});

test('end to end: the one valid hand-crafted request reaches the port rebuilt, and the operation still completes', async () => {
  const capture = new Capture();
  const h = harness({
    transport: capture,
    execute: async (ctx, log) => {
      await ctx.ports.transport.request(baseRequest({
        method: 'POST',
        headers: { authorization: `Bearer ${FAKE_KEY}`, 'content-type': 'application/json' },
        body: utf8Encode('{"model":"o4-mini","input":[]}'),
      }) as never);
      return defaultExecute(ctx, log);
    },
  });
  const p = await prepared(h);
  const scored = okResult<Record<string, any>>(await h.call('executeReal', executePayload(p)));
  assert.equal(scored.kind, 'scoreReal');
  assert.equal(capture.calls.length, 1);
  const seen = capture.calls[0]!;
  assert.equal(Object.isFrozen(seen), true);
  assert.deepEqual(Object.keys(seen.headers).sort(), ['Authorization', 'Content-Type']);
  assert.equal(seen.url, 'https://api.openai.com/v1/decisions');
  assert.equal(seen.method, 'POST');
  assert.equal(h.log.credentialRequests.length, 1, 'the one valid path requests the credential exactly once');
});
