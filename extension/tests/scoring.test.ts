import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {StudySchema, profileFromForm, type Study} from '../src/core';
import {retrieveCandidates, screenCandidates, buildQuery, patientRegion} from '../src/match';
import {parseDecisionAnswers, combineScore, unrefinedScore, validateChecklist, buildEvidence, ageBand, ProviderFormatError, type ScoringAnswers} from '../src/scoring';
import {OpenAIProvider, ProviderError, readAgentStream, redact, FAILURE_MESSAGES} from '../src/openai';
import {LocalProvider, parseLocalAnswers} from '../src/localProvider';
import {runPipeline, visibleAt, countLine, emptyMessage} from '../src/pipeline';

// All profiles in this file are synthetic examples, not real patients.
const studies = JSON.parse(readFileSync(new URL('../../scaffold/data/studies.json', import.meta.url), 'utf8')).map((x: unknown) => StudySchema.parse(x)) as Study[];
const zips = JSON.parse(readFileSync(new URL('../../scaffold/data/us-zip-centroids.json', import.meta.url), 'utf8'));
const FAKE_KEY = 'sk-test-SECRETSECRETSECRET1234567890';
const profileOf = (condition: string, extra: Partial<{age: string; sex: string; zip: string; notes: string}> = {}) =>
  profileFromForm({condition, notes: extra.notes ?? '', age: extra.age ?? '40', sex: extra.sex ?? 'male', zip: extra.zip ?? '', radius: 'anywhere'}, zips);

function study(overrides: Partial<Study> = {}): Study {
  return {...studies[0], id: 'NCT12345678', sourceUrl: 'https://clinicaltrials.gov/study/NCT12345678', conditions: ['Degenerative Disc Disease'], keywords: [], briefTitle: 'Thoracic disc study', officialTitle: '', briefSummary: '', studyType: 'INTERVENTIONAL', overallStatus: 'RECRUITING', locations: [],
    eligibility: {criteriaText: 'Inclusion Criteria:\n- Age 18 to 75 years\n- Thoracic disc degeneration on MRI\nExclusion Criteria:\n- Prior spine surgery', minimumAge: '18 Years', maximumAge: '75 Years', sex: 'ALL', stdAges: []}, ...overrides};
}

function answers(overrides: Partial<{cond: 'exact' | 'related' | 'different'; condConf: number; site: 'match' | 'mismatch' | 'unspecified'; fitLevel: number; fitConf: number; ageSex: number}> = {}): ScoringAnswers {
  const o = {cond: 'exact' as const, condConf: 0.9, site: 'match' as const, fitLevel: 4, fitConf: 0.9, ageSex: 0.95, ...overrides};
  return {condition_match: {choice: o.cond, confidence: o.condConf, probabilities: []}, site_match: {choice: o.site, confidence: 0.9, probabilities: []}, fit_score: {score: Math.round(o.fitLevel / 4 * 100), level: o.fitLevel, confidence: o.fitConf, probabilities: []}, age_sex_compatible: {probability: o.ageSex}};
}

function decisionJson(o: {cond?: string; site?: string; score?: number; conf?: number; ageSex?: number} = {}) {
  return {model: 'gpt-6-luna', answers: [
    {type: 'choice', name: 'condition_match', choice: o.cond ?? 'exact', probabilities: [{value: 'exact', probability: 0.9}, {value: 'related', probability: 0.08}, {value: 'different', probability: 0.02}], confidence: 0.88},
    {type: 'choice', name: 'site_match', choice: o.site ?? 'match', probabilities: [{value: 'match', probability: 0.9}, {value: 'mismatch', probability: 0.05}, {value: 'unspecified', probability: 0.05}], confidence: 0.85},
    {type: 'score', name: 'fit_score', score: o.score ?? 3.6, probabilities: [{value: 0, label: 'No fit', probability: 0}, {value: 4, label: 'Strong fit', probability: 0.6}], confidence: o.conf ?? 0.8},
    {type: 'predicate', name: 'age_sex_compatible', probability: o.ageSex ?? 0.97},
  ], usage: {input_tokens: 400}};
}

type Call = {url: string; init: RequestInit};
function mockFetch(handler: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => { const call = {url: String(url), init}; calls.push(call); return handler(call, calls.length); }) as unknown as typeof fetch;
  return {fn, calls};
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const noSleep = async () => {};

function sse(events: unknown[]): Response {
  const text = events.map(e => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(new ReadableStream({start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); }}), {status: 201, headers: {'content-type': 'text/event-stream'}});
}

test('generic-token gate: generic or region-only overlap never makes a candidate', () => {
  const q = buildQuery('thoracic degenerative disc disease');
  assert.ok(q.distinctive.includes('disc'));
  for (const generic of ['disease', 'degenerative', 'thoracic', 'chronic']) assert.ok(!q.distinctive.includes(generic), generic);
  const noise = [
    study({id: 'NCT00000001', conditions: ["Crohn's Disease"], briefTitle: 'Chronic disease study in patients'}),
    study({id: 'NCT00000002', conditions: ["Alzheimer's Disease"], briefTitle: 'Degenerative disease syndrome'}),
    study({id: 'NCT00000003', conditions: ['Lung Cancer'], briefTitle: 'Thoracic surgery pain study'}),
    study({id: 'NCT00000004', conditions: ['Degenerative Disc Disease'], briefTitle: 'Disc study'}),
  ];
  assert.deepEqual(retrieveCandidates(noise, 'thoracic degenerative disc disease').map(c => c.study.id), ['NCT00000004']);
  const real = retrieveCandidates(studies, 'thoracic degenerative disc disease');
  assert.ok(real.length > 0);
  for (const c of real) assert.match(`${c.study.briefTitle} ${c.study.conditions.join(' ')} ${c.study.keywords.join(' ')}`, /dis[ck]|spondyl|intervertebral/i, c.study.id);
  assert.ok(!real.some(c => /crohn|alzheimer|sickle/i.test(c.study.conditions.join(' '))));
  assert.equal(retrieveCandidates(studies, 'chronic degenerative disease syndrome').length, 0);
});

test('region mismatch caps at 49 and routes to near miss, even when the model says 100', () => {
  const p = profileOf('thoracic degenerative disc disease');
  assert.equal(patientRegion('thoracic degenerative disc disease'), 'thoracic');
  const [screen] = screenCandidates(retrieveCandidates([study({briefTitle: 'Lumbar disc degeneration trial', conditions: ['Lumbar Degenerative Disc Disease']})], 'thoracic degenerative disc disease'), p);
  assert.equal(screen.region.status, 'mismatch');
  assert.equal(screen.cap, 49);
  const b = combineScore(screen, answers({fitLevel: 4}));
  assert.ok(b.final <= 49);
  assert.equal(b.nearMiss, true);
  assert.ok(unrefinedScore(screen).final <= 49);
});

test('structured age/sex contradiction excludes the study entirely', async () => {
  const p = profileOf('thoracic degenerative disc disease', {sex: 'male'});
  const femaleOnly = study({id: 'NCT00000010', eligibility: {...study().eligibility, sex: 'FEMALE'}});
  const tooOld = study({id: 'NCT00000011', eligibility: {...study().eligibility, minimumAge: '65 Years'}});
  const ok = study({id: 'NCT00000012'});
  const result = await runPipeline({studies: [femaleOnly, tooOld, ok], profile: p});
  const ids = [...result.studies, ...result.nearMiss].map(s => s.screen.study.id);
  assert.deepEqual(ids, ['NCT00000012']);
  assert.equal(result.excludedCount, 2);
});

test('Decisions response parsing validates every question and rejects bad shapes', () => {
  const a = parseDecisionAnswers(decisionJson());
  assert.equal(a.condition_match.choice, 'exact');
  assert.equal(a.fit_score.score, 90);
  assert.equal(a.age_sex_compatible.probability, 0.97);
  const missing = decisionJson(); missing.answers.pop();
  assert.throws(() => parseDecisionAnswers(missing), ProviderFormatError);
  const refusal = decisionJson(); (refusal.answers as unknown[])[0] = {type: 'refusal', name: 'condition_match'};
  assert.throws(() => parseDecisionAnswers(refusal), /declined/);
  assert.throws(() => parseDecisionAnswers(decisionJson({cond: 'maybe'})), ProviderFormatError);
  assert.throws(() => parseDecisionAnswers(decisionJson({score: 7})), ProviderFormatError);
  assert.throws(() => parseDecisionAnswers({nope: true}), ProviderFormatError);
});

test('final score is min(model fit, caps); models lower but never lift; low confidence drops a tier', () => {
  const p = profileOf('thoracic degenerative disc disease');
  const [screen] = screenCandidates(retrieveCandidates([study()], 'thoracic degenerative disc disease'), p);
  assert.equal(screen.cap, 100);
  assert.equal(combineScore(screen, answers()).final, 100);
  assert.equal(combineScore(screen, answers({fitLevel: 2})).final, 50);
  assert.equal(combineScore(screen, answers({cond: 'related'})).final, 79);
  assert.equal(combineScore(screen, answers({site: 'mismatch'})).final, 49);
  assert.equal(combineScore(screen, answers({ageSex: 0.1})).final, 49);
  const low = combineScore(screen, answers({fitConf: 0.3}));
  assert.equal(low.final, 79);
  assert.equal(low.lowConfidence, true);
  assert.equal(combineScore(screen, answers({cond: 'different', site: 'unspecified'})).hidden, true);
});

test('consent gating: no provider without consent, and no request is ever made', async () => {
  assert.throws(() => new OpenAIProvider({apiKey: FAKE_KEY, consented: false}), (e: unknown) => e instanceof ProviderError && e.kind === 'consent');
  assert.throws(() => new OpenAIProvider({apiKey: '  ', consented: true}), (e: unknown) => e instanceof ProviderError && e.kind === 'missing_key');
  const original = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => { fetched++; return json({}); }) as typeof fetch;
  try {
    const result = await runPipeline({studies, profile: profileOf('lumbar degenerative disc disease'), unrefinedReason: FAILURE_MESSAGES.consent});
    assert.equal(result.mode, 'unrefined');
    assert.equal(result.failure, FAILURE_MESSAGES.consent);
  } finally { globalThis.fetch = original; }
  assert.equal(fetched, 0);
});

test('the API key never appears in logs, errors, or request bodies; payload is minimal', async () => {
  const logged: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map(m => console[m]);
  methods.forEach(m => { console[m] = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); }; });
  try {
    const ok = mockFetch(() => json(decisionJson()));
    const provider = new OpenAIProvider({apiKey: FAKE_KEY, consented: true, fetch: ok.fn, sleep: noSleep});
    const p = profileOf('lumbar degenerative disc disease', {zip: '83702', notes: 'PRIVATE-NOTE-TEXT', age: '43'});
    const result = await runPipeline({studies, profile: p, provider});
    assert.equal(result.mode, 'refined');
    for (const call of ok.calls) {
      assert.equal(call.url, 'https://api.openai.com/v1/decisions');
      assert.equal((call.init.headers as Record<string, string>).Authorization, `Bearer ${FAKE_KEY}`);
      const body = String(call.init.body);
      assert.ok(!body.includes(FAKE_KEY));
      assert.ok(!body.includes('83702') && !body.includes('PRIVATE-NOTE-TEXT') && !body.includes('Boise'));
      assert.ok(body.includes('"age_band":"40-44"') && !/"age(Years)?":\s*43/.test(body));
    }
    for (const s of result.studies) assert.ok(!JSON.stringify(s.providerResult?.requestShown).includes(FAKE_KEY));
    const echo = mockFetch(() => new Response(`invalid key ${FAKE_KEY}`, {status: 401}));
    const bad = new OpenAIProvider({apiKey: FAKE_KEY, consented: true, fetch: echo.fn, sleep: noSleep});
    const failed = await runPipeline({studies, profile: p, provider: bad});
    assert.ok(failed.failure && !failed.failure.includes(FAKE_KEY));
    await assert.rejects(bad.score(buildEvidence(p, screenCandidates(retrieveCandidates(studies, 'lumbar degenerative disc disease'), p)[0])), (e: Error) => !e.message.includes(FAKE_KEY));
  } finally { methods.forEach((m, i) => { console[m] = saved[i]; }); }
  assert.ok(logged.every(line => !line.includes(FAKE_KEY)));
  assert.equal(redact(`Bearer ${FAKE_KEY} and ${FAKE_KEY}`).includes(FAKE_KEY), false);
  assert.equal(ageBand(43), '40-44');
});

test('failure handling: each failure has a specific message, retries once, never loops, falls back unrefined', async () => {
  const p = profileOf('lumbar degenerative disc disease');
  const evidence = buildEvidence(p, screenCandidates(retrieveCandidates(studies, 'lumbar degenerative disc disease'), p)[0]);
  const cases: Array<[string, () => Response | Promise<Response>, string, number]> = [
    ['401', () => new Response('', {status: 401}), 'unauthorized', 1],
    ['403', () => new Response('', {status: 403}), 'forbidden', 1],
    ['429', () => new Response('', {status: 429}), 'rate_limited', 2],
    ['500', () => new Response('', {status: 500}), 'server', 2],
    ['offline', () => { throw new TypeError('Failed to fetch'); }, 'offline', 2],
    ['malformed', () => json({answers: 'nope'}), 'malformed', 1],
    ['not json', () => new Response('<html>', {status: 200}), 'malformed', 1],
  ];
  for (const [label, handler, kind, expectedCalls] of cases) {
    const m = mockFetch(handler);
    const provider = new OpenAIProvider({apiKey: FAKE_KEY, consented: true, fetch: m.fn, sleep: noSleep});
    await assert.rejects(provider.score(evidence), (e: unknown) => e instanceof ProviderError && e.kind === kind && e.message.startsWith(FAILURE_MESSAGES[e.kind]), label);
    assert.equal(m.calls.length, expectedCalls, label);
  }
  const hang = mockFetch(({init}) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
  const slow = new OpenAIProvider({apiKey: FAKE_KEY, consented: true, fetch: hang.fn, sleep: noSleep, decisionsTimeoutMs: 20});
  await assert.rejects(slow.score(evidence), (e: unknown) => e instanceof ProviderError && e.kind === 'timeout');
  assert.equal(hang.calls.length, 2);
  const flaky = mockFetch((_, n) => n === 1 ? new Response('', {status: 429}) : json(decisionJson()));
  assert.equal((await new OpenAIProvider({apiKey: FAKE_KEY, consented: true, fetch: flaky.fn, sleep: noSleep}).score(evidence)).answers.condition_match.choice, 'exact');
  const down = mockFetch(() => new Response('', {status: 401}));
  const result = await runPipeline({studies, profile: p, provider: new OpenAIProvider({apiKey: FAKE_KEY, consented: true, fetch: down.fn, sleep: noSleep})});
  assert.equal(result.mode, 'unrefined');
  assert.match(result.failure!, /401/);
  assert.match(result.failure!, /unrefined keyword screening/);
  assert.ok(down.calls.length <= 5, 'stops after the first global failure');
});

test('Minimum match changes visibility only, never scores', async () => {
  const provider = new OpenAIProvider({apiKey: FAKE_KEY, consented: true, sleep: noSleep, fetch: mockFetch((call, n) => json(decisionJson({score: [4, 3, 2.4, 2, 1][n % 5]}))).fn});
  const result = await runPipeline({studies, profile: profileOf('lumbar degenerative disc disease'), provider, concurrency: 1});
  const before = JSON.stringify(result.studies.map(s => s.breakdown.final));
  const at = {80: visibleAt(result, 80), 65: visibleAt(result, 65), 50: visibleAt(result, 50)};
  assert.equal(JSON.stringify(result.studies.map(s => s.breakdown.final)), before);
  assert.ok(at[80].shown.length <= at[65].shown.length && at[65].shown.length <= at[50].shown.length);
  assert.ok(at[80].shown.every(s => s.breakdown.final >= 80));
  assert.equal(at[50].shown.length, result.studies.length);
  assert.match(countLine(result, 80), new RegExp(`^Showing ${at[80].shown.length} at 80%\\+\\. ${result.studies.length - at[80].shown.length} more at 50%\\+\\.$`));
});

test('unrefined (Send nothing) mode can never show 80+; honest empty state', async () => {
  for (const condition of ['fibromyalgia', 'lumbar degenerative disc disease', 'back pain']) {
    const result = await runPipeline({studies, profile: profileOf(condition)});
    assert.equal(result.mode, 'unrefined');
    assert.ok([...result.studies, ...result.nearMiss].every(s => s.breakdown.final <= 79), condition);
    assert.equal(visibleAt(result, 80).shown.length, 0);
    assert.equal(emptyMessage(result, 80), 'No strong matches in the offline snapshot of 2,000 studies.');
  }
  const nothing = await runPipeline({studies, profile: profileOf('zzzz unknown condition')});
  assert.equal(nothing.studies.length + nothing.nearMiss.length, 0);
});

test('Agents API stream: final answer is read, failure surfaces, and fabricated quotes are dropped', async () => {
  const criteria = study().eligibility.criteriaText;
  const output = {items: [
    {criterion: 'Age 18-75', patient_status: 'met', source_quote: 'Age 18 to 75 years'},
    {criterion: 'Invented', patient_status: 'not_met', source_quote: 'Must live on the moon for ten years'},
  ], questions_for_study_team: ['Do you accept thoracic disc patients?', 'See https://evil.example']};
  const events = [
    {type: 'agent.session.created', session: {id: 'sess_1'}},
    {type: 'agent.session.turn.output_text.done', session_id: 'sess_1', text: JSON.stringify(output)},
    {type: 'agent.session.turn.completed', session_id: 'sess_1', turn: {status: 'completed', subagent_id: null}},
  ];
  const m = mockFetch(({init}) => init.method === 'DELETE' ? new Response(null, {status: 204}) : sse(events));
  const provider = new OpenAIProvider({apiKey: FAKE_KEY, consented: true, fetch: m.fn, sleep: noSleep});
  const p = profileOf('thoracic degenerative disc disease');
  const evidence = buildEvidence(p, screenCandidates(retrieveCandidates([study()], 'thoracic degenerative disc disease'), p)[0]);
  const out = await provider.checklist(evidence);
  assert.equal(out.checklist.items.length, 1);
  assert.equal(out.checklist.droppedCitations, 1);
  assert.deepEqual(out.checklist.questions_for_study_team, ['Do you accept thoracic disc patients?']);
  const create = JSON.parse(String(m.calls[0].init.body));
  assert.equal(m.calls[0].url, 'https://api.openai.com/v1/agents/sessions');
  assert.equal((m.calls[0].init.headers as Record<string, string>)['OpenAI-Beta'], 'agents=v1');
  assert.equal(create.environment.type, 'none');
  assert.equal(create.agent.text.format.type, 'json_schema');
  assert.ok(m.calls.some(c => c.init.method === 'DELETE' && c.url.endsWith('/v1/agents/sessions/sess_1')));
  await assert.rejects(readAgentStream(sse([{type: 'agent.session.turn.failed', turn: {subagent_id: null}}])), (e: unknown) => e instanceof ProviderError && e.kind === 'agent_failed');
  await assert.rejects(readAgentStream(sse([{type: 'agent.session.turn.output_text.done', text: '{}'}])), (e: unknown) => e instanceof ProviderError && e.kind === 'agent_failed');
  assert.throws(() => validateChecklist({items: 'x'}, criteria, 'NCT12345678'), ProviderFormatError);
});

test('Local LLM provider: same contract, validated output, and never makes a network request', async () => {
  const original = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => { fetched++; throw new Error('network'); }) as typeof fetch;
  try {
    const prompts: string[] = [];
    const generator = {generate: async (_model: string, prompt: string) => {
      prompts.push(prompt);
      if (prompt.includes('checklist')) return '```json\n' + JSON.stringify({items: [{criterion: 'Age', patient_status: 'met', source_quote: 'Age 18 to 75 years'}], questions_for_study_team: ['Are you enrolling?']}) + '\n```';
      return JSON.stringify({condition_match: 'exact', condition_confidence: 0.9, site_match: 'match', site_confidence: 0.9, fit_level: 3, fit_confidence: 0.8, age_sex_compatible_probability: 0.9});
    }};
    const local = new LocalProvider(generator, 'llama3.2:3b');
    const p = profileOf('thoracic degenerative disc disease', {zip: '83702', notes: 'PRIVATE-NOTE-TEXT'});
    const result = await runPipeline({studies: [study()], profile: p, provider: local});
    assert.equal(result.mode, 'refined');
    assert.equal(result.providerId, 'local');
    assert.equal(result.studies[0].breakdown.final, 75);
    const c = await local.checklist(result.studies[0].evidence);
    assert.equal(c.checklist.items.length, 1);
    assert.ok(prompts.every(x => !x.includes('83702') && !x.includes('PRIVATE-NOTE-TEXT')));
    assert.throws(() => parseLocalAnswers('not json'), ProviderFormatError);
    assert.throws(() => parseLocalAnswers(JSON.stringify({condition_match: 'exact'})), ProviderFormatError);
    const broken = new LocalProvider({generate: async () => 'nonsense'}, 'llama3.2:3b');
    const fallback = await runPipeline({studies: [study()], profile: p, provider: broken});
    assert.equal(fallback.mode, 'unrefined');
    assert.equal(fallback.studies[0].refined, false);
    assert.match(fallback.failure!, /Local LLM scoring failed for every study/);
    assert.match(fallback.failure!, /local model/i);
  } finally { globalThis.fetch = original; }
  assert.equal(fetched, 0);
});

test('provider switching: OpenAI and Local return the same result shape for the same evidence', async () => {
  const p = profileOf('thoracic degenerative disc disease');
  const openai = new OpenAIProvider({apiKey: FAKE_KEY, consented: true, sleep: noSleep, fetch: mockFetch(() => json(decisionJson({score: 3}))).fn});
  const local = new LocalProvider({generate: async () => JSON.stringify({condition_match: 'exact', condition_confidence: 0.88, site_match: 'match', site_confidence: 0.85, fit_level: 3, fit_confidence: 0.8, age_sex_compatible_probability: 0.97})}, 'm');
  const [a, b] = await Promise.all([runPipeline({studies: [study()], profile: p, provider: openai}), runPipeline({studies: [study()], profile: p, provider: local})]);
  assert.equal(a.providerId, 'openai');
  assert.equal(b.providerId, 'local');
  assert.deepEqual(Object.keys(a.studies[0].providerResult!.answers).sort(), Object.keys(b.studies[0].providerResult!.answers).sort());
  assert.equal(a.studies[0].breakdown.final, b.studies[0].breakdown.final);
  assert.match(a.providerLabel!, /OpenAI/);
  assert.match(b.providerLabel!, /Local LLM/);
});

test('consent and README copy: not set up for PHI, BAA plus Modified Retention, no compliance claim', () => {
  const panel = readFileSync(new URL('../src/panel.tsx', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const text of [panel, readme]) {
    assert.match(text, /OpenAI mode is not set up for protected health information/);
    assert.match(text, /executed BAA and Modified Retention/);
    assert.match(text, /use only synthetic or non-identifying information, or use Local LLM mode/);
    assert.doesNotMatch(text, /HIPAA[- ]compliant|is HIPAA compliant|HIPAA-ready/i);
  }
  assert.doesNotMatch(readme, /No OpenAI key or cloud provider is used|No all-sites access, cloud requests/i);
  assert.match(panel, /Your ZIP code, notes, and saved studies are not included in requests/);
  assert.match(readme, /Research information, not medical advice/);
  assert.match(readme, /No warranty/);
});

test('critic fixes: multi-region patient is unspecified; partial failures are surfaced; agent sessions are deleted on failure; CRLF SSE parses', async () => {
  assert.equal(patientRegion('cervical and lumbar stenosis'), 'unspecified');
  const p = profileOf('lumbar degenerative disc disease');
  const partial = mockFetch((_, n) => n === 2 ? json({answers: []}) : json(decisionJson()));
  const r = await runPipeline({studies, profile: p, provider: new OpenAIProvider({apiKey: FAKE_KEY, consented: true, fetch: partial.fn, sleep: noSleep}), concurrency: 1});
  assert.equal(r.mode, 'refined');
  assert.match(r.failure!, /could not score 1 of/);
  const failing = mockFetch(({init}) => init.method === 'DELETE' ? new Response(null, {status: 200}) : sse([{type: 'agent.session.created', session: {id: 'sess_9'}}, {type: 'agent.session.turn.failed', session_id: 'sess_9', turn: {subagent_id: null}}]));
  const provider = new OpenAIProvider({apiKey: FAKE_KEY, consented: true, fetch: failing.fn, sleep: noSleep});
  const evidence = buildEvidence(p, screenCandidates(retrieveCandidates([study()], 'thoracic degenerative disc disease'), profileOf('thoracic degenerative disc disease'))[0]);
  await assert.rejects(provider.checklist(evidence), (e: unknown) => e instanceof ProviderError && e.kind === 'agent_failed');
  assert.ok(failing.calls.some(c => c.init.method === 'DELETE' && c.url.endsWith('/sess_9')));
  assert.equal(failing.calls.filter(c => c.init.method === 'POST').length, 1, 'session creation is never retried');
  const crlf = new Response(new ReadableStream({start(c) { c.enqueue(new TextEncoder().encode('data: {"type":"agent.session.turn.output_text.done","text":"{}"}\r\n\r\ndata: {"type":"agent.session.turn.completed","turn":{"subagent_id":null}}')); c.close(); }}));
  assert.equal((await readAgentStream(crlf)).text, '{}');
});

test('one study failing with 429 twice keeps every other refined score; Retry-After is honored and bounded', async () => {
  const q = 'lumbar degenerative disc disease';
  const p = profileOf(q);
  const kept = screenCandidates(retrieveCandidates(studies, q, 20), p).filter(s => !s.excluded);
  assert.ok(kept.length >= 3);
  const targetId = kept[1].study.id;
  const sleeps: number[] = [];
  const m = mockFetch(({init}) => String(init.body).includes(targetId) ? new Response('', {status: 429, headers: {'retry-after': '999'}}) : json(decisionJson()));
  const provider = new OpenAIProvider({apiKey: FAKE_KEY, consented: true, fetch: m.fn, sleep: async ms => { sleeps.push(ms); }});
  const result = await runPipeline({studies, profile: p, provider});
  assert.equal(result.mode, 'refined');
  assert.match(result.failure!, /could not score 1 of/);
  const all = [...result.studies, ...result.nearMiss];
  const bad = all.find(s => s.screen.study.id === targetId);
  assert.ok(bad && !bad.refined && bad.breakdown.final <= 79);
  assert.ok(all.filter(s => s.screen.study.id !== targetId && s.refined).length >= 2);
  assert.ok(sleeps.length >= 1 && sleeps.every(ms => ms <= 8000));
});

test('an auth failure still aborts globally', async () => {
  const p = profileOf('lumbar degenerative disc disease');
  const m = mockFetch((_, n) => n === 1 ? json(decisionJson()) : new Response('', {status: 403}));
  const result = await runPipeline({studies, profile: p, provider: new OpenAIProvider({apiKey: FAKE_KEY, consented: true, fetch: m.fn, sleep: noSleep}), concurrency: 1});
  assert.equal(result.mode, 'unrefined');
  assert.match(result.failure!, /403/);
});

test('checklist validation: short fragments, claim phrases, and claim questions are dropped', () => {
  const text = study().eligibility.criteriaText;
  const item = (criterion: string, source_quote: string) => ({criterion, patient_status: 'unknown', source_quote});
  const run = (items: unknown[], questions: string[] = []) => validateChecklist({items, questions_for_study_team: questions}, text, 'NCT12345678');
  // Header fragment used to launder an eligibility claim.
  assert.equal(run([item('You meet all inclusion criteria', 'inclusion criteria')]).items.length, 0);
  // Claim text is dropped even with a long, genuine quote.
  assert.equal(run([item('You meet all inclusion criteria', 'Thoracic disc degeneration on MRI')]).items.length, 0);
  assert.equal(run([item('You are eligible', 'Thoracic disc degeneration on MRI')]).items.length, 0);
  // Short generic fragment that is not a whole line is dropped.
  assert.equal(run([item('Age', 'Age 18')]).items.length, 0);
  // A short quote that is a full source line is kept; a long verbatim quote is kept.
  assert.equal(run([item('Age 18 to 75', 'Age 18 to 75 years')]).items.length, 1);
  assert.equal(run([item('Prior spine surgery excluded', 'Prior spine surgery')]).items.length, 1);
  assert.equal(run([item('Disc degeneration on MRI', 'Thoracic disc degeneration on MRI')]).items.length, 1);
  assert.deepEqual(run([], ['Do you accept thoracic disc patients?', 'You can enroll in this trial', 'Is the patient eligible?']).questions_for_study_team, ['Do you accept thoracic disc patients?', 'Is the patient eligible?']);
});
