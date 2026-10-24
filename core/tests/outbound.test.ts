// Mocked: no network. The OpenAI send capability: exact consented bytes, fixed URLs and headers,
// delivery policy, and refusal of everything else, tested with hostile executeReal pipelines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CoreError } from '../src/errors.ts';
import { canonicalJson, type JsonObject } from '../src/json.ts';
import type { ExecuteContext } from '../src/dispatcher.ts';
import {
  AGENTS_CANCEL_BODY,
  MAX_RETRY_AFTER_MS,
  isAllowedOpenAIRequest,
  type OpenAIRequestRef,
} from '../src/outbound.ts';
import { CONSENT_POLICY_VERSION, type ExecuteRealResult, type PreparedRealResult } from '../src/protocol.ts';
import { FAKE_SESSION_ID, FAKE_TURN_ID, scoreAnswer, sseEvents, type RecordedCall } from './support/fake-openai.ts';
import { sha256Hex } from './support/fakes.ts';
import { FAKE_KEY, defaultExecute, errorCode, flush, harness, mockedScore, okResult, receipt } from './support/harness.ts';
import { FICTIONAL_IDS, basePacket } from './support/preview.ts';

const execute = (p: PreparedRealResult, operation = 'score') => ({ token: p.token, digest: p.digest, operation, policyReceipt: receipt });

async function prepared(h: ReturnType<typeof harness>, packet = basePacket(), pageSize = 3): Promise<PreparedRealResult> {
  okResult(await h.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'], pageSize }));
  return okResult<PreparedRealResult>(await h.call('prepareReal', { packet, policyReceipt: receipt }));
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    assert.ok(error instanceof CoreError, 'the capability throws only CoreError');
    return error.code;
  }
}

/** A plausible-looking result for a pipeline that tried something it must not do. */
function fakeScore(ctx: ExecuteContext): ExecuteRealResult {
  return { kind: 'scoreReal', mode: ctx.mode, consentDigest: ctx.consentDigest, scores: (ctx.packet.scoreNctIds ?? []).map(nctId => ({ nctId, outcome: 'failed', code: 'API_ERROR' })) };
}

test('the executeReal pipeline receives no ports, session, slots, records, transport, or credential, and its data is frozen', async () => {
  let ctx: ExecuteContext | undefined;
  const h = harness({ execute: async (c, log) => ((ctx = c), defaultExecute(c, log)) });
  const p = await prepared(h);
  okResult(await h.call('executeReal', execute(p)));
  assert.ok(ctx);
  assert.deepEqual(Object.keys(ctx).sort(), ['consentDigest', 'emitTrace', 'mode', 'openai', 'operation', 'packet', 'preview', 'requestId', 'signal']);
  for (const name of ['ports', 'session', 'slots', 'records', 'transport', 'requestCredential', 'pinned', 'pins', 'apiKey']) assert.equal(name in ctx, false, name);
  assert.deepEqual(Object.keys(ctx.openai).sort(), ['send', 'wait']);
  assert.ok(Object.isFrozen(ctx) && Object.isFrozen(ctx.openai) && Object.isFrozen(ctx.preview) && Object.isFrozen(ctx.packet));
  assert.throws(() => {
    (ctx!.preview.decisionsRequests[0]!.input[0].content[1].data.profile as Record<string, unknown>).zip = '83702';
  }, TypeError);
  assert.throws(() => {
    (ctx as unknown as Record<string, unknown>).openai = { send: () => undefined };
  }, TypeError);
  const reachable = new Set<unknown>();
  const walk = (value: unknown): void => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function') || reachable.has(value)) return;
    reachable.add(value);
    for (const key of Reflect.ownKeys(value as object)) {
      const descriptor = Object.getOwnPropertyDescriptor(value as object, key);
      if (descriptor && 'value' in descriptor) walk(descriptor.value);
    }
  };
  walk(ctx);
  for (const value of reachable) {
    if (typeof value === 'object' || typeof value === 'function') {
      let text = '';
      try {
        text = typeof value === 'function' ? String(value) : JSON.stringify(value) ?? '';
      } catch {
        text = '';
      }
      assert.ok(!text.includes(FAKE_KEY), 'no reachable value holds the credential');
    }
  }
});

test('sent bytes are exactly the canonical serialization of the consented preview, their SHA-256 values are the pins, and the digest covers the pins', async () => {
  const h = harness();
  const p = await prepared(h);
  okResult(await h.call('executeReal', execute(p)));
  okResult(await h.call('executeReal', execute(p, 'agent')));
  const calls = h.openai.calls;
  const decisions = calls.filter(c => c.path === '/v1/decisions');
  assert.equal(decisions.length, 2);
  const pins = {
    decisionsRequests: p.preview.decisionsRequests.map(body => sha256Hex(canonicalJson(body))),
    agentsCreate: sha256Hex(canonicalJson(p.preview.agentsRequest!)),
    toolResults: p.preview.toolResults.map(result => sha256Hex(canonicalJson(result))),
  };
  for (const call of decisions) {
    const index = p.preview.decisionsRequests.findIndex(body => body.questions[0].name === JSON.parse(call.body!).questions[0].name);
    assert.equal(call.body, canonicalJson(p.preview.decisionsRequests[index]!), 'byte for byte the consented Decisions body');
    assert.equal(sha256Hex(call.body!), pins.decisionsRequests[index]);
  }
  const create = calls.filter(c => c.path === '/v1/agents/sessions');
  assert.equal(create.length, 1);
  assert.equal(create[0]!.body, canonicalJson(p.preview.agentsRequest!), 'byte for byte the consented Agents body');
  const toolResults = calls.filter(c => c.path.endsWith('/events'));
  assert.equal(toolResults.length, 2);
  for (const call of toolResults) {
    const event = JSON.parse(call.body!).events[0];
    assert.deepEqual(Object.keys(event).sort(), ['call_id', 'output', 'success', 'turn_id', 'type']);
    assert.equal(event.type, 'agent.session.input.tool_result');
    assert.equal(event.turn_id, FAKE_TURN_ID);
    const index = p.preview.toolResults.findIndex(r => r.study.id === JSON.parse(event.output).study.id);
    assert.equal(event.output, canonicalJson(p.preview.toolResults[index]!), 'the tool output is exactly the consented tool result');
    assert.equal(sha256Hex(event.output), pins.toolResults[index]);
    assert.equal(call.body, canonicalJson({ events: [event] }));
  }
  const digest = sha256Hex(canonicalJson({ operations: ['score', 'agent'], pins, policyVersion: CONSENT_POLICY_VERSION, preview: p.preview as unknown as JsonObject, subjectDigest: p.subjectDigest }));
  assert.equal(digest, p.digest, 'the consent digest, recomputed independently, covers the pins of the exact bytes');
  for (const call of calls) {
    assert.equal(call.url, `https://api.openai.com${call.path}`);
    assert.ok(isAllowedOpenAIRequest(call.method, call.path), `${call.method} ${call.path}`);
    assert.equal(call.headers.Authorization, `Bearer ${FAKE_KEY}`);
    assert.equal(call.headers['OpenAI-Beta'], call.path.startsWith('/v1/agents/') ? 'agents=v1' : undefined);
    assert.equal(call.headers['Content-Type'], call.body === undefined ? undefined : 'application/json');
    assert.deepEqual(Object.keys(call.headers).sort(), ['Accept', 'Authorization', ...(call.body === undefined ? [] : ['Content-Type']), ...(call.path.startsWith('/v1/agents/') ? ['OpenAI-Beta'] : [])].sort());
  }
  assert.ok(calls.some(c => c.method === 'DELETE' && c.path === `/v1/agents/sessions/${FAKE_SESSION_ID}`), 'cleanup ran');
  assert.ok(!JSON.stringify(h.events).includes(FAKE_KEY));
});

test('a hostile score pipeline cannot send altered bytes, extra requests, or other URLs, and any attempt fails the operation', async () => {
  const shifty = { kind: 'decisions' } as Record<string, unknown>;
  let reads = 0;
  Object.defineProperty(shifty, 'index', { enumerable: true, get: () => (reads += 1) - 1 });
  const cases: [string, unknown][] = [
    ['extra body', { kind: 'decisions', index: 1, body: '{"note":"PRIVATE_SENTINEL","zip":"83702"}' }],
    ['extra url', { kind: 'decisions', index: 1, url: 'https://evil.invalid/v1/decisions' }],
    ['extra headers', { kind: 'decisions', index: 1, headers: { 'X-Extra': 'PRIVATE_SENTINEL' } }],
    ['index out of range', { kind: 'decisions', index: 2 }],
    ['negative index', { kind: 'decisions', index: -1 }],
    ['fractional index', { kind: 'decisions', index: 0.5 }],
    ['string index', { kind: 'decisions', index: '1' }],
    ['raw request', { kind: 'raw', method: 'POST', path: '/v1/decisions' }],
    ['Agents create in a score operation', { kind: 'agentsCreate' }],
    ['Agents delete in a score operation', { kind: 'agentsDelete', sessionId: FAKE_SESSION_ID }],
    ['getter index', shifty],
    ['inherited index', Object.assign(Object.create({ index: 1 }), { kind: 'decisions' })],
    ['null', null],
    ['string', 'decisions'],
    ['same body twice', { kind: 'decisions', index: 0 }],
  ];
  for (const [name, hostile] of cases) {
    let code: string | undefined;
    let after: string | undefined;
    const h = harness({
      execute: async ctx => {
        assert.equal((await ctx.openai.send({ kind: 'decisions', index: 0 })).status, 200);
        code = await codeOf(ctx.openai.send(hostile as OpenAIRequestRef));
        after = await codeOf(ctx.openai.send({ kind: 'decisions', index: 1 }));
        return fakeScore(ctx);
      },
    });
    const p = await prepared(h);
    assert.equal(errorCode(await h.call('executeReal', execute(p))), 'INTERNAL_ERROR', `${name}: the attempt fails the operation even though the pipeline caught it`);
    assert.equal(code, 'INVALID_REQUEST', name);
    assert.equal(after, 'INTERNAL_ERROR', `${name}: after a refusal no further data is sent`);
    assert.equal(h.openai.calls.length, 1, `${name}: only the one legitimate request reached the transport`);
    assert.ok(!JSON.stringify(h.openai.calls).includes('PRIVATE_SENTINEL'));
  }
});

test('a hostile agent pipeline cannot invent session, turn, or call IDs, exceed tool-call limits, or resend beyond the policy', async () => {
  const early = harness({
    execute: async ctx => {
      assert.equal(await codeOf(ctx.openai.send({ kind: 'toolResult', index: 0, sessionId: FAKE_SESSION_ID, turnId: FAKE_TURN_ID, callId: 'call_fictional_0_0' })), 'INVALID_REQUEST');
      return fakeScore(ctx) as never;
    },
  });
  const p0 = await prepared(early);
  assert.equal(errorCode(await early.call('executeReal', execute(p0, 'agent'))), 'INTERNAL_ERROR', 'no tool result before the session exists');
  assert.equal(early.openai.calls.length, 0);

  type Action = { turn_id: string; call_id: string };
  type Step = (send: (ref: OpenAIRequestRef) => Promise<string | undefined>, actions: Action[]) => Promise<string | undefined>;
  const tool = (index: number, callId: string, extra: Record<string, string> = {}) =>
    ({ kind: 'toolResult', index, sessionId: FAKE_SESSION_ID, turnId: FAKE_TURN_ID, callId, ...extra }) as OpenAIRequestRef;
  const legit = async (send: (ref: OpenAIRequestRef) => Promise<string | undefined>, refs: OpenAIRequestRef[]) => {
    for (const ref of refs) assert.equal(await send(ref), undefined, JSON.stringify(ref));
  };
  const cases: [string, Step, string][] = [
    ['session ID never seen in a response', (send, a) => send(tool(0, a[0]!.call_id, { sessionId: 'sess_PRIVATE83702' })), 'INVALID_ENDPOINT'],
    ['session ID that is a path', send => send({ kind: 'agentsDelete', sessionId: '../decisions' }), 'INVALID_ENDPOINT'],
    ['observed text used as a second session ID', async (send, a) => (await legit(send, [tool(0, a[0]!.call_id)]), send({ kind: 'agentsDelete', sessionId: FAKE_TURN_ID })), 'INVALID_ENDPOINT'],
    ['invented turn ID', (send, a) => send(tool(0, a[0]!.call_id, { turnId: 'turn_age_47' })), 'INVALID_ENDPOINT'],
    ['invented call ID', send => send(tool(0, 'call_zip_83702')), 'INVALID_ENDPOINT'],
    ['tool result index out of range', (send, a) => send(tool(2, a[0]!.call_id)), 'INVALID_REQUEST'],
    ['seventh tool call', async (send, a) => (await legit(send, a.slice(0, 6).map((x, i) => tool(i < 4 ? 0 : 1, x.call_id))), send(tool(1, a[6]!.call_id))), 'INVALID_REQUEST'],
    ['retry with another tool result', async (send, a) => (await legit(send, [tool(0, a[0]!.call_id)]), send(tool(1, a[0]!.call_id))), 'INVALID_REQUEST'],
    ['third attempt for one call', async (send, a) => (await legit(send, [tool(0, a[0]!.call_id), tool(0, a[0]!.call_id)]), send(tool(0, a[0]!.call_id))), 'INVALID_REQUEST'],
    ['second session create', send => send({ kind: 'agentsCreate' }), 'INVALID_REQUEST'],
    ['Decisions body in an agent operation', send => send({ kind: 'decisions', index: 0 }), 'INVALID_REQUEST'],
    ['third DELETE', async send => (await legit(send, [{ kind: 'agentsDelete', sessionId: FAKE_SESSION_ID }, { kind: 'agentsDelete', sessionId: FAKE_SESSION_ID }]), send({ kind: 'agentsDelete', sessionId: FAKE_SESSION_ID })), 'INVALID_REQUEST'],
  ];
  for (const [name, step, expected] of cases) {
    let code: string | undefined;
    let afterData: string | undefined;
    let afterCleanup: string | undefined;
    const h = harness({
      openai: { callsPerStudy: 4 },
      execute: async ctx => {
        const create = await ctx.openai.send({ kind: 'agentsCreate' });
        const actions: Action[] = [];
        for await (const event of sseEvents(create.body)) {
          if (event.type === 'agent.session.requires_action') {
            actions.push(...event.session.required_actions);
            break;
          }
        }
        const send = (ref: OpenAIRequestRef) => codeOf(ctx.openai.send(ref));
        code = await step(send, actions);
        afterData = await send(tool(0, actions[7]!.call_id));
        afterCleanup = await send({ kind: 'agentsCancel', sessionId: FAKE_SESSION_ID });
        return fakeScore(ctx) as never;
      },
    });
    const p = await prepared(h);
    assert.equal(errorCode(await h.call('executeReal', execute(p, 'agent'))), 'INTERNAL_ERROR', name);
    assert.equal(code, expected, name);
    assert.equal(afterData, 'INTERNAL_ERROR', `${name}: no data after a refusal`);
    assert.equal(afterCleanup, undefined, `${name}: cleanup is still possible after a refusal`);
    const text = JSON.stringify(h.openai.calls);
    assert.ok(!text.includes('PRIVATE') && !text.includes('83702') && !text.includes('age_47'), name);
    assert.ok(h.openai.calls.every(c => isAllowedOpenAIRequest(c.method, c.path)), name);
    assert.ok(h.openai.calls.every(c => !c.path.startsWith('/v1/agents/sessions/') || c.path.startsWith(`/v1/agents/sessions/${FAKE_SESSION_ID}`)), name);
    assert.equal(h.openai.calls.filter(c => c.method === 'POST' && c.path === '/v1/agents/sessions').length, 1, name);
    assert.ok(h.openai.calls.some(c => c.body === AGENTS_CANCEL_BODY), name);
  }
});

test('a legitimate tool result retry resends identical bytes for the same call', async () => {
  const bodies: string[] = [];
  const h = harness({
    execute: async ctx => {
      const create = await ctx.openai.send({ kind: 'agentsCreate' });
      const ids = ctx.packet.agentNctIds ?? [];
      let toolCalls = 0;
      for await (const event of sseEvents(create.body)) {
        if (event.type === 'agent.session.requires_action') {
          for (const action of event.session.required_actions) {
            const ref = { kind: 'toolResult', index: ids.indexOf(action.arguments.nctId), sessionId: event.session.id, turnId: action.turn_id, callId: action.call_id } as const;
            await ctx.openai.send(ref);
            if (toolCalls === 0) await ctx.openai.send(ref);
            toolCalls += 1;
          }
        }
        if (event.type === 'agent.session.turn.completed') break;
      }
      const deleted = await ctx.openai.send({ kind: 'agentsDelete', sessionId: FAKE_SESSION_ID });
      assert.equal(deleted.status, 200);
      return { kind: 'agentReal', mode: ctx.mode, consentDigest: ctx.consentDigest, comparisons: ids.map(nctId => ({ nctId, questionIds: ['visits'] })), cautionIds: ['team_confirms', 'records_change', 'no_benefit_promise'], toolCalls, cleanup: 'deleted' } as ExecuteRealResult;
    },
  });
  const p = await prepared(h);
  okResult(await h.call('executeReal', execute(p, 'agent')));
  for (const call of h.openai.calls) if (call.path.endsWith('/events')) bodies.push(call.body!);
  assert.equal(bodies.length, 3);
  assert.equal(bodies[0], bodies[1], 'the retry is byte-identical');
});

test('the delivery policy: at most three Decisions requests at a time, and a retry keeps its slot while it waits', async () => {
  const ten = basePacket({ scoreNctIds: [...FICTIONAL_IDS], agentNctIds: undefined });
  const h = harness({ openai: { decisions: (body, attempt) => (attempt === 1 ? { status: 503, headers: { 'retry-after': '1' }, body: '{"error":{"type":"server_error","code":"server_is_overloaded"}}' } : scoreAnswer(body)) } });
  const p = await prepared(h, ten, 10);
  const running = h.call('executeReal', execute(p));
  const decisionCalls = () => h.openai.calls.filter((c: RecordedCall) => c.path === '/v1/decisions');
  await flush();
  assert.equal(decisionCalls().length, 3, 'three first attempts, then the slots are held during the retry wait');
  h.ports.clock.advance(999);
  await flush();
  assert.equal(decisionCalls().length, 3, 'Retry-After is honored as a minimum');
  for (let round = 0; round < 8 && decisionCalls().length < 20; round += 1) {
    h.ports.clock.advance(1300);
    await flush();
  }
  const result = okResult<Record<string, any>>(await running);
  assert.ok(result.scores.every((s: { outcome: string }) => s.outcome === 'scored'));
  assert.equal(decisionCalls().length, 20, 'one retry per study, never more');
  assert.ok(h.openai.maxDecisionsInFlight <= 3, `at most three in flight (saw ${h.openai.maxDecisionsInFlight})`);
  const byStudy = new Map<string, string[]>();
  for (const call of decisionCalls()) {
    const name = JSON.parse(call.body!).questions[0].name as string;
    byStudy.set(name, [...(byStudy.get(name) ?? []), call.body!]);
  }
  for (const [name, bodies] of byStudy) assert.equal(bodies[0], bodies[1], `${name}: the retry resends identical bytes`);
  const attempts = h.events.map(e => e.trace).filter(t => t.stage === 'decision').map(t => t.attempt);
  assert.ok(attempts.every(a => a === 2), 'the response reports the attempt number');
});

test('the delivery policy: no retry after quota or billing 429s, a long Retry-After, or other statuses', async () => {
  const cases: [string, (body: string, attempt: number) => { status: number; headers?: Record<string, string>; body?: string }, number][] = [
    ['credit balance', () => ({ status: 429, body: '{"error":{"type":"insufficient_quota","code":"credit_balance_exhausted"}}' }), 1],
    ['project spend limit', () => ({ status: 429, body: '{"error":{"type":"rate_limit_error","code":"project_spend_limit_exceeded"}}' }), 1],
    ['quota code with deeply nested extra fields', () => ({ status: 429, body: '{"error":{"type":"rate_limit_error","code":"usage_limit_exceeded","details":{"a":{"b":{"c":{"d":[1]}}}}}}' }), 1],
    ['insufficient quota type', () => ({ status: 429, body: '{"error":{"type":"insufficient_quota","code":"something_new"}}' }), 1],
    ['long Retry-After', () => ({ status: 429, headers: { 'retry-after': String(MAX_RETRY_AFTER_MS / 1000 + 1) }, body: '{"error":{"type":"rate_limit_error","code":"rate_limit_exceeded"}}' }), 1],
    ['bad request', () => ({ status: 400, body: '{"error":{"type":"invalid_request_error"}}' }), 1],
    ['bad gateway', () => ({ status: 502, body: '' }), 1],
    ['temporary rate limit', (body, attempt) => (attempt === 1 ? { status: 429, body: '{"error":{"type":"rate_limit_error","code":"rate_limit_exceeded"}}' } : scoreAnswer(body)), 2],
    ['server error without Retry-After', (body, attempt) => (attempt === 1 ? { status: 500, body: 'not json' } : scoreAnswer(body)), 2],
  ];
  for (const [name, reply, expectedAttempts] of cases) {
    const h = harness({ openai: { decisions: reply } });
    const p = await prepared(h, basePacket({ scoreNctIds: [FICTIONAL_IDS[0]], agentNctIds: undefined }));
    const running = h.call('executeReal', execute(p));
    for (let round = 0; round < 4; round += 1) {
      await flush();
      h.ports.clock.advance(1300);
    }
    okResult(await running);
    assert.equal(h.openai.calls.length, expectedAttempts, name);
  }
});

test('revoking consent stops data-bearing sends but still lets the pipeline cancel and delete the Agents session', async () => {
  const outcomes: Record<string, string | undefined> = {};
  let reached!: () => void;
  const atAction = new Promise<void>(resolve => (reached = resolve));
  const h = harness({
    execute: async ctx => {
      const create = await ctx.openai.send({ kind: 'agentsCreate' });
      let action: { turn_id: string; call_id: string } | undefined;
      try {
        for await (const event of sseEvents(create.body)) {
          if (event.type === 'agent.session.requires_action') {
            action = event.session.required_actions[0];
            reached();
            await new Promise<void>(resolve => ctx.signal.addEventListener('abort', () => resolve()));
            outcomes.toolResultAfterAbort = await codeOf(ctx.openai.send({ kind: 'toolResult', index: 0, sessionId: FAKE_SESSION_ID, turnId: action!.turn_id, callId: action!.call_id }));
          }
        }
      } catch (error) {
        outcomes.stream = error instanceof CoreError ? error.code : 'other';
      } finally {
        outcomes.cancel = await codeOf(ctx.openai.send({ kind: 'agentsCancel', sessionId: FAKE_SESSION_ID }));
        outcomes.delete = await codeOf(ctx.openai.send({ kind: 'agentsDelete', sessionId: FAKE_SESSION_ID }));
      }
      throw new CoreError('CANCELLED');
    },
  });
  const p = await prepared(h);
  const running = h.call('executeReal', execute(p, 'agent'));
  await atAction;
  okResult(await h.call('revokeReal', {}));
  assert.equal(errorCode(await running), 'CANCELLED');
  assert.equal(outcomes.toolResultAfterAbort, 'CANCELLED');
  assert.equal(outcomes.cancel, undefined, 'cleanup cancel was sent');
  assert.equal(outcomes.delete, undefined, 'cleanup delete was sent');
  assert.ok(!h.openai.calls.some(c => c.body?.includes('agent.session.input.tool_result')), 'no tool result after the abort');
  assert.ok(h.openai.calls.some(c => c.method === 'DELETE'));
});

test('after the operation ends, a leaked capability can send nothing and wait for nothing', async () => {
  let leaked: ExecuteContext['openai'] | undefined;
  const h = harness({
    execute: async ctx => {
      leaked = ctx.openai;
      return mockedScore(ctx);
    },
  });
  const p = await prepared(h);
  okResult(await h.call('executeReal', execute(p)));
  const before = h.openai.calls.length;
  assert.equal(await codeOf(leaked!.send({ kind: 'decisions', index: 0 })), 'CANCELLED');
  assert.equal(await codeOf(leaked!.send({ kind: 'agentsDelete', sessionId: FAKE_SESSION_ID })), 'CANCELLED');
  assert.equal(await codeOf(leaked!.wait(10)), 'CANCELLED');
  assert.equal(h.openai.calls.length, before);
});

test('transport failures map to fixed codes without exposing the credential; wait() is bounded', async () => {
  const h = harness({
    transport: {
      request: async request => {
        throw new Error(`socket failed for ${request.headers.Authorization}`);
      },
    },
    execute: async ctx => {
      assert.equal(await codeOf(ctx.openai.wait(-1)), 'INVALID_REQUEST');
      return mockedScore(ctx);
    },
  });
  const p = await prepared(h);
  const response = await h.call('executeReal', execute(p));
  assert.equal(errorCode(response), 'INTERNAL_ERROR', 'the invalid wait() counted as a violation');
  assert.ok(!JSON.stringify(response).includes(FAKE_KEY) && !JSON.stringify(h.events).includes(FAKE_KEY));
  const plain = harness({ transport: { request: async () => { throw new Error('offline'); } } });
  const q = await prepared(plain);
  assert.equal(errorCode(await plain.call('executeReal', execute(q))), 'NETWORK_ERROR');
  const timeouts = harness({ transport: { request: request => new Promise((_resolve, reject) => request.signal?.addEventListener('abort', () => reject(new Error('aborted')))) } });
  const r = await prepared(timeouts);
  const running = timeouts.call('executeReal', execute(r));
  await flush();
  timeouts.ports.clock.advance(25_001);
  assert.equal(errorCode(await running), 'NETWORK_ERROR', 'a request that exceeds its time limit fails without a retry');
});

test('the searchTrials pipeline can reach only GET https://clinicaltrials.gov/api/v2/..., never OpenAI', async () => {
  const outcomes: (string | undefined)[] = [];
  const h = harness({
    pipelines: {
      async searchTrials(ctx, payload) {
        const attempt = (request: Record<string, unknown>) => codeOf(ctx.ports.transport.request(request as never));
        outcomes.push(await attempt({ method: 'POST', url: 'https://api.openai.com/v1/decisions', headers: { 'Content-Type': 'application/json' }, body: new TextEncoder().encode(JSON.stringify(payload)) }));
        outcomes.push(await attempt({ method: 'GET', url: 'https://api.openai.com/v1/agents/sessions', headers: {} }));
        outcomes.push(await attempt({ method: 'GET', url: 'https://clinicaltrials.gov.evil.invalid/api/v2/studies', headers: {} }));
        outcomes.push(await attempt({ method: 'GET', url: 'https://clinicaltrials.gov@evil.invalid/api/v2/studies', headers: {} }));
        outcomes.push(await attempt({ method: 'GET', url: 'https://clinicaltrials.gov/api/v2/studies', headers: { Authorization: 'Bearer x' } }));
        outcomes.push(await attempt({ method: 'POST', url: 'https://clinicaltrials.gov/api/v2/studies', headers: {}, body: new Uint8Array(1) }));
        outcomes.push(await attempt({ method: 'GET', url: 'https://clinicaltrials.gov/api/v2/studies?query.cond=asthma', headers: { Accept: 'application/json' } }));
        return { records: [], retrievedAt: '2026-10-24T08:00:00Z', source: 'live', query: { conditionTerms: payload.conditionTerms, country: 'US' } };
      },
    },
  });
  okResult(await h.call('searchTrials', { conditionTerms: ['asthma'] }));
  assert.deepEqual(outcomes.slice(0, 6), Array(6).fill('INVALID_ENDPOINT'));
  assert.notEqual(outcomes[6], 'INVALID_ENDPOINT', 'the allowed ClinicalTrials.gov request reached the (mocked) transport');
  assert.equal(h.openai.calls.length, 1);
  assert.equal(h.openai.calls[0]!.url, 'https://clinicaltrials.gov/api/v2/studies?query.cond=asthma');
});

test('the capability serializes the frozen body again and refuses to send when its SHA-256 differs from the pin', async () => {
  const { createOpenAISender, computeRequestPins } = await import('../src/outbound.ts');
  const { createCancelSource } = await import('../src/cancel.ts');
  const { nodeSha256 } = await import('../node/ports.node.ts');
  const { FakeClock, SequentialTokens } = await import('./support/fakes.ts');
  const { FakeOpenAITransport } = await import('./support/fake-openai.ts');
  const { makePreview } = await import('./support/preview.ts');
  const preview = makePreview(basePacket());
  const pins = await computeRequestPins(nodeSha256, preview);
  const make = (overrides: Partial<typeof pins>, operation: 'score' | 'agent' = 'score') => {
    const transport = new FakeOpenAITransport();
    const handle = createOpenAISender({
      transport,
      sha256: nodeSha256,
      clock: new FakeClock(),
      tokens: new SequentialTokens(),
      operation,
      preview,
      pins: { ...pins, ...overrides },
      apiKey: FAKE_KEY,
      signal: createCancelSource().signal,
    });
    return { transport, handle };
  };
  const good = make({});
  assert.equal((await good.handle.capability.send({ kind: 'decisions', index: 0 })).status, 200);
  assert.equal(good.transport.calls[0]!.body, canonicalJson(preview.decisionsRequests[0]!));
  const wrongDecisions = make({ decisionsRequests: ['f'.repeat(64), pins.decisionsRequests[1]!] });
  assert.equal(await codeOf(wrongDecisions.handle.capability.send({ kind: 'decisions', index: 0 })), 'INTERNAL_ERROR');
  assert.equal(wrongDecisions.transport.calls.length, 0, 'nothing reached the transport');
  assert.equal(wrongDecisions.handle.record().violation, true);
  const wrongCreate = make({ agentsCreate: '0'.repeat(64) }, 'agent');
  assert.equal(await codeOf(wrongCreate.handle.capability.send({ kind: 'agentsCreate' })), 'INTERNAL_ERROR');
  assert.equal(wrongCreate.transport.calls.length, 0);
  assert.throws(() => make({ toolResults: [pins.toolResults[0]!] }), (e: unknown) => e instanceof CoreError && e.code === 'INTERNAL_ERROR', 'pins must cover every tool result');
  assert.throws(
    () => createOpenAISender({ transport: good.transport, sha256: nodeSha256, clock: new FakeClock(), tokens: new SequentialTokens(), operation: 'score', preview, pins, apiKey: 'not a key', signal: createCancelSource().signal }),
    (e: unknown) => e instanceof CoreError && e.code === 'CREDENTIAL_UNAVAILABLE',
  );
});

test('only the five documented method and path pairs are allowed', () => {
  for (const [method, path] of [
    ['POST', '/v1/decisions'],
    ['POST', '/v1/agents/sessions'],
    ['GET', `/v1/agents/sessions/${FAKE_SESSION_ID}`],
    ['POST', `/v1/agents/sessions/${FAKE_SESSION_ID}/events`],
    ['DELETE', `/v1/agents/sessions/${FAKE_SESSION_ID}`],
  ]) {
    assert.equal(isAllowedOpenAIRequest(method!, path!), true, `${method} ${path}`);
  }
  for (const [method, path] of [
    ['GET', '/v1/decisions'],
    ['DELETE', '/v1/decisions'],
    ['GET', '/v1/agents/sessions'],
    ['POST', `/v1/agents/sessions/${FAKE_SESSION_ID}`],
    ['GET', `/v1/agents/sessions/${FAKE_SESSION_ID}/events`],
    ['DELETE', `/v1/agents/sessions/${FAKE_SESSION_ID}/events`],
    ['POST', '/v1/decisions?x=1'],
    ['POST', '/v1/agents'],
    ['POST', '/v1/responses'],
    ['GET', `/v1/agents/sessions/${FAKE_SESSION_ID}/traces`],
    ['GET', '/v1/agents/sessions/a/b'],
    ['PUT', '/v1/decisions'],
  ]) {
    assert.equal(isAllowedOpenAIRequest(method!, path!), false, `${method} ${path}`);
  }
});

test('after an abort the capability allows cleanup for a bounded time, then closes itself even if the pipeline never returns', async () => {
  const { ABORT_CLEANUP_GRACE_MS } = await import('../src/outbound.ts');
  let leaked: ExecuteContext['openai'] | undefined;
  let started!: () => void;
  const ready = new Promise<void>(resolve => (started = resolve));
  let finish!: () => void;
  const hang = new Promise<void>(resolve => (finish = resolve));
  const h = harness({
    execute: async ctx => {
      leaked = ctx.openai;
      const create = await ctx.openai.send({ kind: 'agentsCreate' });
      const iterator = sseEvents(create.body)[Symbol.asyncIterator]();
      await iterator.next(); // agent.session.created: the session ID has now been seen
      started();
      await hang; // a pipeline that ignores the abort
      throw new CoreError('CANCELLED');
    },
  });
  const p = await prepared(h);
  const running = h.call('executeReal', execute(p, 'agent'));
  await ready;
  okResult(await h.call('revokeReal', {}));
  assert.equal(await codeOf(leaked!.send({ kind: 'toolResult', index: 0, sessionId: FAKE_SESSION_ID, turnId: FAKE_TURN_ID, callId: 'call_fictional_0_0' })), 'CANCELLED', 'no data after the abort');
  assert.equal((await leaked!.send({ kind: 'agentsDelete', sessionId: FAKE_SESSION_ID })).status, 200, 'cleanup within the grace period');
  const before = h.openai.calls.length;
  h.ports.clock.advance(ABORT_CLEANUP_GRACE_MS);
  assert.equal(await codeOf(leaked!.send({ kind: 'agentsCancel', sessionId: FAKE_SESSION_ID })), 'CANCELLED', 'closed after the grace period');
  assert.equal(h.openai.calls.length, before);
  finish();
  assert.equal(errorCode(await running), 'CANCELLED');
});
