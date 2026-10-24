import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {StudySchema, profileFromForm, type Study} from '../src/core';
import {phaseConfig, CONFIG} from '../src/config';
import {parsePolicy, evaluateGate, resolveProvider} from '../src/hipaaGate';
import {OpenAIProvider, ProviderError, verifyOrganization} from '../src/openai';
import {LocalProvider} from '../src/localProvider';
import {runPipeline} from '../src/pipeline';
import {retrieveCandidates, screenCandidates} from '../src/match';
import {buildEvidence} from '../src/scoring';

// Synthetic example profiles only.
const studies = JSON.parse(readFileSync(new URL('../../scaffold/data/studies.json', import.meta.url), 'utf8')).map((x: unknown) => StudySchema.parse(x)) as Study[];
const zips = JSON.parse(readFileSync(new URL('../../scaffold/data/us-zip-centroids.json', import.meta.url), 'utf8'));
const profile = profileFromForm({condition: 'lumbar degenerative disc disease', notes: '', age: '40', sex: 'male', zip: '', radius: 'anywhere'}, zips);
const KEY = 'sk-test-GATEKEY1234567890';
const ORG = 'org-AllowedOrg123';
const POLICY = {hipaaOpenAIEnabled: true, allowedOpenAIOrgIds: [ORG]};
const hipaa = phaseConfig('hipaa'), demo = phaseConfig('demo');
const localGen = {generate: async () => JSON.stringify({condition_match: 'exact', condition_confidence: 0.9, site_match: 'match', site_confidence: 0.9, fit_level: 3, fit_confidence: 0.8, age_sex_compatible_probability: 0.9})};
const decision = {answers: [
  {type: 'choice', name: 'condition_match', choice: 'exact', probabilities: [], confidence: 0.9},
  {type: 'choice', name: 'site_match', choice: 'match', probabilities: [], confidence: 0.9},
  {type: 'score', name: 'fit_score', score: 3.5, probabilities: [], confidence: 0.9},
  {type: 'predicate', name: 'age_sex_compatible', probability: 0.95},
]};

test('phase config: the built default is Phase 1 demo; Phase 2 defaults to Local with the gate on', () => {
  assert.equal(CONFIG.phase, 'demo');
  assert.deepEqual(demo, {phase: 'demo', defaultProvider: 'openai', hipaaGateEnabled: false, syntheticDemoBanner: true});
  assert.deepEqual(hipaa, {phase: 'hipaa', defaultProvider: 'local', hipaaGateEnabled: true, syntheticDemoBanner: false});
  const resolved = resolveProvider({config: hipaa, consented: false, apiKey: '', attested: false, local: {generator: localGen, model: 'llama3.2:3b'}});
  assert.ok(resolved.provider instanceof LocalProvider, 'no choice made: Phase 2 uses Local');
});

test('policy parsing fails closed on every bad input', () => {
  for (const raw of [undefined, null, {}, 'x', {hipaaOpenAIEnabled: 'true', allowedOpenAIOrgIds: [ORG]}, {hipaaOpenAIEnabled: true}, {hipaaOpenAIEnabled: true, allowedOpenAIOrgIds: 'org-x'},
    {hipaaOpenAIEnabled: false, allowedOpenAIOrgIds: [ORG]}, {hipaaOpenAIEnabled: true, allowedOpenAIOrgIds: []}, {hipaaOpenAIEnabled: true, allowedOpenAIOrgIds: ['not-an-org']}, {hipaaOpenAIEnabled: true, allowedOpenAIOrgIds: [ORG, 7]}])
    assert.equal(parsePolicy(raw).ok, false, JSON.stringify(raw));
  assert.equal(parsePolicy(POLICY).ok, true);
});

test('gate fails closed: no policy, bad schema, missing attestation, missing key, org mismatch, network error', async () => {
  let verifyCalls = 0;
  const verify = (result: 'match' | 'mismatch' | 'throw') => async () => { verifyCalls++; if (result === 'throw') throw new ProviderError('offline'); return result; };
  for (const policyRaw of [undefined, {}, {hipaaOpenAIEnabled: 'yes'}]) assert.equal((await evaluateGate({policyRaw, attested: true, apiKey: KEY, verify: verify('match')})).open, false);
  assert.equal((await evaluateGate({policyRaw: POLICY, attested: false, apiKey: KEY, verify: verify('match')})).open, false);
  assert.equal((await evaluateGate({policyRaw: POLICY, attested: true, apiKey: ' ', verify: verify('match')})).open, false);
  assert.equal(verifyCalls, 0, 'no network check unless policy, attestation, and key are present');
  const mismatch = await evaluateGate({policyRaw: POLICY, attested: true, apiKey: KEY, verify: verify('mismatch')});
  assert.equal(mismatch.open, false);
  assert.match((mismatch as {reason: string}).reason, /does not belong/);
  const offline = await evaluateGate({policyRaw: POLICY, attested: true, apiKey: KEY, verify: verify('throw')});
  assert.equal(offline.open, false);
  assert.match((offline as {reason: string}).reason, /stays locked/);
  assert.deepEqual(await evaluateGate({policyRaw: POLICY, attested: true, apiKey: KEY, verify: verify('match')}), {open: true, organizationId: ORG});
});

test('no OpenAI request ever occurs when the Phase 2 gate is locked', async () => {
  const original = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => { fetched++; return new Response('{}'); }) as typeof fetch;
  try {
    for (const gate of [undefined, {open: false as const, reason: 'locked'}]) {
      const r = resolveProvider({config: hipaa, choice: 'openai', consented: true, apiKey: KEY, attested: true, gate, local: {generator: localGen, model: 'm'}});
      assert.ok(!(r.provider instanceof OpenAIProvider));
      assert.ok(r.provider instanceof LocalProvider);
      assert.match(r.reason!, /OpenAI mode is locked/);
      const out = await runPipeline({studies, profile, provider: r.provider});
      assert.equal(out.providerId, 'local');
      const none = resolveProvider({config: hipaa, choice: 'openai', consented: true, apiKey: KEY, attested: true, gate});
      assert.equal(none.provider, undefined);
      assert.equal((await runPipeline({studies, profile, provider: none.provider, unrefinedReason: none.reason})).mode, 'unrefined');
    }
  } finally { globalThis.fetch = original; }
  assert.equal(fetched, 0);
});

test('open gate pins every request to the verified organization and disables the Agents API checklist', async () => {
  const calls: Array<{url: string; init: RequestInit}> = [];
  const fetchMock = (async (url: string, init: RequestInit) => { calls.push({url, init}); return new Response(JSON.stringify(decision), {status: 200}); }) as unknown as typeof fetch;
  const r = resolveProvider({config: hipaa, choice: 'openai', consented: true, apiKey: KEY, attested: true, gate: {open: true, organizationId: ORG}, fetch: fetchMock});
  assert.ok(r.provider instanceof OpenAIProvider);
  const out = await runPipeline({studies, profile, provider: r.provider});
  assert.equal(out.mode, 'refined');
  assert.ok(calls.length > 0 && calls.every(c => (c.init.headers as Record<string, string>)['OpenAI-Organization'] === ORG));
  const evidence = buildEvidence(profile, screenCandidates(retrieveCandidates(studies, 'lumbar degenerative disc disease'), profile)[0]);
  const before = calls.length;
  await assert.rejects(r.provider!.checklist(evidence), (e: unknown) => e instanceof ProviderError && e.kind === 'agents_disabled');
  assert.equal(calls.length, before, 'no Agents API request in gate mode');
});

test('organization verification uses the documented OpenAI-Organization header and fails closed', async () => {
  const seen: string[] = [];
  const respond = (status: number, body: unknown) => (async (_url: string, init: RequestInit) => { seen.push((init.headers as Record<string, string>)['OpenAI-Organization']); assert.ok(!String(init.body).includes('lumbar')); return new Response(JSON.stringify(body), {status}); }) as unknown as typeof fetch;
  assert.equal(await verifyOrganization(KEY, ORG, respond(200, decision)), 'match');
  assert.equal(await verifyOrganization(KEY, ORG, respond(401, {error: {code: 'mismatched_organization'}})), 'mismatch');
  await assert.rejects(verifyOrganization(KEY, ORG, respond(401, {error: {code: 'invalid_api_key'}})), ProviderError);
  await assert.rejects(verifyOrganization(KEY, ORG, respond(500, {})), ProviderError);
  await assert.rejects(verifyOrganization(KEY, ORG, (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch), ProviderError);
  assert.ok(seen.every(v => v === ORG));
});

test('Phase 1 demo config works end to end with consent and a key (mocked OpenAI)', async () => {
  const fetchMock = (async (url: string, init: RequestInit) => {
    if (String(url).endsWith('/v1/agents/sessions') && init.method === 'POST') {
      const text = JSON.stringify({items: [], questions_for_study_team: ['Are you enrolling?']});
      const events = [{type: 'agent.session.created', session: {id: 'sess_d'}}, {type: 'agent.session.turn.output_text.done', text}, {type: 'agent.session.turn.completed', turn: {subagent_id: null}}];
      return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), {status: 201});
    }
    if (init.method === 'DELETE') return new Response(null, {status: 200});
    assert.equal((init.headers as Record<string, string>)['OpenAI-Organization'], undefined);
    return new Response(JSON.stringify(decision), {status: 200});
  }) as unknown as typeof fetch;
  assert.equal(resolveProvider({config: demo, consented: false, apiKey: KEY, attested: false, fetch: fetchMock}).provider, undefined, 'demo still needs consent');
  const r = resolveProvider({config: demo, consented: true, apiKey: KEY, attested: false, fetch: fetchMock});
  assert.ok(r.provider instanceof OpenAIProvider, 'demo default provider is OpenAI');
  const out = await runPipeline({studies, profile, provider: r.provider});
  assert.equal(out.mode, 'refined');
  assert.ok(out.studies.length > 0);
  const c = await r.provider!.checklist(out.studies[0].evidence);
  assert.equal(c.sessionDeleted, true);
});

test('manifest declares the managed policy schema', () => {
  const manifest = JSON.parse(readFileSync(new URL('../dist/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.storage.managed_schema, 'managed_schema.json');
  const schema = JSON.parse(readFileSync(new URL('../dist/managed_schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.hipaaOpenAIEnabled.type, 'boolean');
  assert.equal(schema.properties.allowedOpenAIOrgIds.type, 'array');
});
