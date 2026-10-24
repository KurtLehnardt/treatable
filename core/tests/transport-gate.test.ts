// Mocked: no network. The transport gate (task A1b), ported from the outbound checks in
// extension/native/transport.mjs at commit 48c569e and tightened to the exact method-and-path pairs
// of docs/apps/openai-contracts.md section 10.1, plus the ClinicalTrials.gov search request of task
// A2. A hostile caller (a pipeline, or hand-crafted request objects with getters and Proxies) tries
// to widen the rules - other pairs, hosts, queries, bodies, headers - and the request is refused
// before the port is called. A hostile port tries to change what it was handed and what later
// callers send, and cannot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { utf8Decode, utf8Encode } from '../src/bytes.ts';
import { createCancelSource } from '../src/cancel.ts';
import { CoreError } from '../src/errors.ts';
import { MAX_OUTBOUND_BODY_BYTES, type PreparedRealResult } from '../src/protocol.ts';
import type { Transport, TransportRequest, TransportResponse } from '../src/ports.ts';
import { screenLocalPipeline } from '../src/screening.ts';
import {
  guardCorePorts,
  guardTransport,
  MAX_TRANSPORT_URL_CHARS,
  toTransportRequest,
  TRANSPORT_RULES,
} from '../src/transport-gate.ts';
import { testPorts } from './support/fakes.ts';
import { FAKE_KEY, defaultExecute, errorCode, harness, okResult, receipt } from './support/harness.ts';
import { basePacket, FICTIONAL_IDS } from './support/preview.ts';

/** A port that records every request it sees and answers a trivial empty-body 200. */
class Capture implements Transport {
  readonly calls: TransportRequest[] = [];
  async request(request: TransportRequest): Promise<TransportResponse> {
    this.calls.push(request);
    return { status: 200, headers: {}, body: utf8Encode('{}') };
  }
}

const isCode = (code: string) => (e: unknown): boolean => e instanceof CoreError && e.code === code;

/** The invariant under test: a refused request throws the given code before the port is ever called. */
async function rejected(code: string, request: unknown, message?: string): Promise<void> {
  const capture = new Capture();
  await assert.rejects(() => guardTransport(capture).request(request as never), isCode(code), message);
  assert.equal(capture.calls.length, 0, `a refused request never reaches the port${message ? `: ${message}` : ''}`);
}

/** Sends a request that must pass and returns exactly what the port received. */
async function passes(request: unknown, message?: string): Promise<TransportRequest> {
  const capture = new Capture();
  await guardTransport(capture).request(request as never);
  assert.equal(capture.calls.length, 1, message ?? 'an allowed request reaches the port once');
  return capture.calls[0]!;
}

// -----------------------------------------------------------------------------------------------
// Request fixtures: one valid request per rule
// -----------------------------------------------------------------------------------------------

const OPENAI = 'https://api.openai.com';
const CTGOV_STUDIES = 'https://clinicaltrials.gov/api/v2/studies';
const AUTH = `Bearer ${FAKE_KEY}`;
const SID = 'sess_fictional_0001';
const BETA = 'agents=v1';
const jsonBody = (text = '{"model":"gpt-6-luna"}') => utf8Encode(text);

/**
 * The field list task A2 requests (CTGOV_FIELDS in core/src/ctgov/query.ts on feature/core-a2-fcc at
 * 8bc91f9, read with git show only), so the ClinicalTrials.gov fixtures have the real length and
 * alphabet.
 */
const CTGOV_FIELDS = [
  'NCTId', 'BriefTitle', 'OfficialTitle', 'OverallStatus', 'StudyType', 'Phase', 'Condition', 'ConditionMeshTerm',
  'BriefSummary', 'EligibilityCriteria', 'MinimumAge', 'MaximumAge', 'Sex', 'HealthyVolunteers', 'LeadSponsorName',
  'LastUpdatePostDate', 'LocationFacility', 'LocationStatus', 'LocationCity', 'LocationState', 'LocationZip',
  'LocationCountry', 'LocationGeoPoint', 'LocationContactName', 'LocationContactRole', 'LocationContactPhone',
  'LocationContactPhoneExt', 'LocationContactEMail', 'CentralContactName', 'CentralContactRole', 'CentralContactPhone',
  'CentralContactPhoneExt', 'CentralContactEMail', 'OverallOfficialName', 'OverallOfficialRole',
];

/** A first-page search in the shape of A2's buildStudiesUrl (fictional search term). */
const FIRST_PAGE: [string, string][] = [
  ['format', 'json'],
  ['query.cond', '"seasonal allergic rhinitis"'],
  ['filter.overallStatus', 'RECRUITING|NOT_YET_RECRUITING|ENROLLING_BY_INVITATION|AVAILABLE'],
  ['filter.advanced', 'SEARCH[Location](AREA[LocationCountry]"United States" AND AREA[LocationState]"Idaho")'],
  ['fields', CTGOV_FIELDS.join('|')],
  ['sort', '@relevance'],
  ['pageSize', '10'],
  ['countTotal', 'true'],
];

/** Same encoding as A2's encodeQuery: encodeURIComponent on each name and value. */
function ctgovUrl(params: readonly (readonly [string, string])[] = FIRST_PAGE): string {
  return `${CTGOV_STUDIES}?${params.map(([n, v]) => `${encodeURIComponent(n)}=${encodeURIComponent(v)}`).join('&')}`;
}

type RuleKey = 'decisions' | 'create' | 'retrieve' | 'events' | 'delete' | 'ctgov';

function valid(key: RuleKey, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<RuleKey, Record<string, unknown>> = {
    decisions: { method: 'POST', url: `${OPENAI}/v1/decisions`, headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: jsonBody() },
    create: {
      method: 'POST',
      url: `${OPENAI}/v1/agents/sessions`,
      headers: { Authorization: AUTH, 'Content-Type': 'application/json', 'OpenAI-Beta': BETA, Accept: 'text/event-stream' },
      body: jsonBody('{"environment":{"type":"none"},"stream":true}'),
    },
    retrieve: { method: 'GET', url: `${OPENAI}/v1/agents/sessions/${SID}`, headers: { Authorization: AUTH, 'OpenAI-Beta': BETA } },
    events: {
      method: 'POST',
      url: `${OPENAI}/v1/agents/sessions/${SID}/events`,
      headers: { Authorization: AUTH, 'Content-Type': 'application/json', 'OpenAI-Beta': BETA },
      body: jsonBody('{"events":[{"type":"agent.session.input.cancel"}]}'),
    },
    delete: { method: 'DELETE', url: `${OPENAI}/v1/agents/sessions/${SID}`, headers: { Authorization: AUTH, 'OpenAI-Beta': BETA } },
    ctgov: { method: 'GET', url: ctgovUrl(), headers: { Accept: 'application/json' } },
  };
  return { ...base[key], ...overrides };
}

const OPENAI_KEYS: RuleKey[] = ['decisions', 'create', 'retrieve', 'events', 'delete'];
const AGENTS_KEYS: RuleKey[] = ['create', 'retrieve', 'events', 'delete'];
const POST_KEYS: RuleKey[] = ['decisions', 'create', 'events'];
const NO_BODY_KEYS: RuleKey[] = ['retrieve', 'delete', 'ctgov'];

function withHeaders(key: RuleKey, change: (headers: Record<string, unknown>) => void): Record<string, unknown> {
  const request = valid(key);
  const headers = { ...(request.headers as Record<string, unknown>) };
  change(headers);
  return { ...request, headers };
}

// -----------------------------------------------------------------------------------------------
// The rule table
// -----------------------------------------------------------------------------------------------

test('the rule table is exactly the five A0 OpenAI pairs plus the ClinicalTrials.gov search, and it is frozen', () => {
  assert.deepEqual(
    TRANSPORT_RULES.map(rule => `${rule.method} ${rule.origin}${rule.path}`),
    [
      'POST https://api.openai.com/v1/decisions',
      'POST https://api.openai.com/v1/agents/sessions',
      'GET https://api.openai.com/v1/agents/sessions/{id}',
      'POST https://api.openai.com/v1/agents/sessions/{id}/events',
      'DELETE https://api.openai.com/v1/agents/sessions/{id}',
      'GET https://clinicaltrials.gov/api/v2/studies',
    ],
  );
  assert.equal(Object.isFrozen(TRANSPORT_RULES), true);
  for (const rule of TRANSPORT_RULES) {
    assert.equal(Object.isFrozen(rule), true, rule.id);
    assert.equal(Object.isFrozen(rule.accept), true, rule.id);
    if (rule.origin === OPENAI) {
      assert.equal(rule.authorization, 'required', rule.id);
      assert.equal(rule.queryParameters, null, rule.id);
      assert.equal(rule.openaiBeta, rule.path.startsWith('/v1/agents/') ? 'required' : 'forbidden', rule.id);
    } else {
      assert.equal(rule.authorization, 'forbidden', rule.id);
      assert.equal(rule.openaiBeta, 'forbidden', rule.id);
      assert.deepEqual(rule.accept, ['application/json']);
      assert.equal(rule.acceptRequired, true);
    }
  }
  assert.throws(() => (TRANSPORT_RULES as TransportRuleArray).push(TRANSPORT_RULES[0]!), TypeError);
  assert.throws(() => { (TRANSPORT_RULES[0] as { method: string }).method = 'PUT'; }, TypeError);
});
type TransportRuleArray = (typeof TRANSPORT_RULES)[number][];

test('each allowed request reaches the port once, rebuilt with canonical header names and frozen', async () => {
  const expectedHeaders: Record<RuleKey, string[]> = {
    decisions: ['Authorization', 'Content-Type'],
    create: ['Accept', 'Authorization', 'Content-Type', 'OpenAI-Beta'],
    retrieve: ['Authorization', 'OpenAI-Beta'],
    events: ['Authorization', 'Content-Type', 'OpenAI-Beta'],
    delete: ['Authorization', 'OpenAI-Beta'],
    ctgov: ['Accept'],
  };
  for (const key of [...OPENAI_KEYS, 'ctgov'] as RuleKey[]) {
    const request = valid(key);
    const seen = await passes(request, key);
    assert.equal(seen.method, request.method, key);
    assert.equal(seen.url, request.url, key);
    assert.deepEqual(Object.keys(seen.headers).sort(), expectedHeaders[key], key);
    assert.equal(Object.isFrozen(seen), true, key);
    assert.equal(Object.isFrozen(seen.headers), true, key);
    assert.equal(seen.body === undefined, request.body === undefined, key);
  }
  // Lower-case spellings are accepted and canonicalized.
  const lower = await passes(valid('retrieve', { headers: { authorization: AUTH, 'openai-beta': BETA, accept: 'application/json' } }));
  assert.deepEqual(lower.headers, { Authorization: AUTH, 'OpenAI-Beta': BETA, Accept: 'application/json' });
  const ct = await passes(valid('ctgov'));
  assert.deepEqual(ct.headers, { Accept: 'application/json' });
});

// -----------------------------------------------------------------------------------------------
// Method-and-path pairs, origins, and URLs
// -----------------------------------------------------------------------------------------------

test('[A0 8.2 item 7] method-and-path pairs outside the table are INVALID_ENDPOINT, including the four the old check let through', async () => {
  const id = SID;
  // The four pairs that section 8.2 item 7 names, each with otherwise plausible headers and body.
  const named: [string, Record<string, unknown>][] = [
    ['POST /v1/agents/sessions/{id} (session update)', valid('events', { url: `${OPENAI}/v1/agents/sessions/${id}` })],
    ['GET /v1/agents/sessions (session listing)', valid('retrieve', { url: `${OPENAI}/v1/agents/sessions` })],
    ['GET /v1/decisions', { method: 'GET', url: `${OPENAI}/v1/decisions`, headers: { Authorization: AUTH } }],
    ['DELETE /v1/decisions', { method: 'DELETE', url: `${OPENAI}/v1/decisions`, headers: { Authorization: AUTH } }],
  ];
  for (const [name, request] of named) await rejected('INVALID_ENDPOINT', request, name);

  // The whole method x path matrix: only the six table entries pass.
  const paths: [string, string, boolean][] = [
    ['decisions', `${OPENAI}/v1/decisions`, false],
    ['sessions', `${OPENAI}/v1/agents/sessions`, true],
    ['session', `${OPENAI}/v1/agents/sessions/${id}`, true],
    ['events', `${OPENAI}/v1/agents/sessions/${id}/events`, true],
    ['ctgov', ctgovUrl(), false],
  ];
  const allowed = new Set(['POST decisions', 'POST sessions', 'GET session', 'POST events', 'DELETE session', 'GET ctgov']);
  for (const method of ['GET', 'POST', 'DELETE']) {
    for (const [name, url, agents] of paths) {
      const openai = url.startsWith(OPENAI);
      const headers: Record<string, string> = openai ? { Authorization: AUTH } : { Accept: 'application/json' };
      if (agents) headers['OpenAI-Beta'] = BETA;
      if (method === 'POST') headers['Content-Type'] = 'application/json';
      const request = { method, url, headers, ...(method === 'POST' ? { body: jsonBody() } : {}) };
      if (allowed.has(`${method} ${name}`)) await passes(request, `${method} ${name}`);
      else await rejected('INVALID_ENDPOINT', request, `${method} ${name}`);
    }
  }

  // Documented Agents endpoints that Treatable must not call (A0 section 3.2 and 10.1).
  for (const [method, path] of [
    ['GET', `/v1/agents/sessions/${id}/events`],
    ['DELETE', '/v1/agents/sessions'],
    ['GET', `/v1/agents/sessions/${id}/items`],
    ['GET', `/v1/agents/sessions/${id}/turns`],
    ['GET', '/v1/agents'],
    ['POST', '/v1/agents'],
    ['GET', '/v1/models/gpt-6-luna'],
    ['GET', '/v1/organization/usage/decisions'],
    ['POST', `/v1/agents/sessions/${id}/events/extra`],
    ['POST', '/v1/responses'],
  ] as const) {
    const headers: Record<string, string> = { Authorization: AUTH, 'OpenAI-Beta': BETA };
    if (method === 'POST') headers['Content-Type'] = 'application/json';
    await rejected('INVALID_ENDPOINT', { method, url: `${OPENAI}${path}`, headers, ...(method === 'POST' ? { body: jsonBody() } : {}) }, `${method} ${path}`);
  }
});

test('[ported transport.mjs] only the pinned origins with an allowlisted path connect; everything else is INVALID_ENDPOINT', async () => {
  const urls = [
    'https://evil.example/v1/decisions',
    'https://api.openai.com.evil.example/v1/decisions',
    'https://not-api.openai.com/v1/decisions',
    'https://openai.com/v1/decisions',
    'http://api.openai.com/v1/decisions',
    'https://api.openai.com:443/v1/decisions',
    'https://user:pass@api.openai.com/v1/decisions',
    'https://api.openai.com@evil.example/v1/decisions',
    'https://api.openai.com/v1/decisions?query=1',
    'https://api.openai.com/v1/decisions#fragment',
    'https://api.openai.com//v1/decisions',
    'https://api.openai.com/../v1/decisions',
    'https://api.openai.com/v1/./decisions',
    'https://api.openai.com/v1/decisions/',
    'https://api.openai.com/v1/decisions%2F',
    'https://api.openai.com/V1/DECISIONS',
    'https://API.OPENAI.COM/v1/decisions',
    'https://api.openai.com/v1/decisions\n',
    'https://api.openai.com/v1/decisions\u0000',
    'https://api.openai.com\\@evil.example/v1/decisions',
    'https://api.openai.com',
    'https://api.openai.com/',
    '',
    'not a url',
    'https://api.openai.com/v1/chat/completions',
    'https://api.openai.com/v1/agents',
    'https://api.openai.com/v1/decisions' + 'x'.repeat(MAX_TRANSPORT_URL_CHARS),
  ];
  for (const url of urls) await rejected('INVALID_ENDPOINT', valid('decisions', { url }), JSON.stringify(url));
  for (const url of [42, null, undefined, ['https://api.openai.com/v1/decisions']]) {
    await rejected('INVALID_ENDPOINT', valid('decisions', { url }), String(url));
  }
});

test('the {id} path segment follows PROVIDER_ID_PATTERN exactly', async () => {
  await passes(valid('retrieve', { url: `${OPENAI}/v1/agents/sessions/${'a'.repeat(160)}` }));
  for (const bad of ['a'.repeat(161), 'a.b', 'a%2Eb', 'a%2Fb', '', 'a/b', 'a b', 'a?b', 'sess_é']) {
    await rejected('INVALID_ENDPOINT', valid('retrieve', { url: `${OPENAI}/v1/agents/sessions/${bad}` }), JSON.stringify(bad));
    await rejected('INVALID_ENDPOINT', valid('events', { url: `${OPENAI}/v1/agents/sessions/${bad}/events` }), JSON.stringify(bad));
  }
});

test('only GET, POST, and DELETE are transport methods', async () => {
  for (const method of ['PUT', 'PATCH', 'HEAD', 'OPTIONS', 'get', 'post', '', 'GET GET', ' POST', 7]) {
    await rejected('INVALID_ENDPOINT', valid('decisions', { method }), String(method));
  }
  const missing = valid('decisions');
  delete missing.method;
  await rejected('INVALID_ENDPOINT', missing);
});

test('[MAJOR-2] a ClinicalTrials.gov URL is refused on every OpenAI rule and an OpenAI URL on the ClinicalTrials.gov rule', async () => {
  for (const key of OPENAI_KEYS) {
    const request = valid(key);
    const path = (request.url as string).slice(OPENAI.length);
    await rejected('INVALID_ENDPOINT', { ...request, url: `https://clinicaltrials.gov${path}` }, `${key} on the ClinicalTrials.gov host`);
    // On the search URL, only GET names a rule (the search rule), and that rule refuses the OpenAI
    // headers (Authorization, OpenAI-Beta); POST and DELETE name no rule at all.
    const code = request.method === 'GET' ? 'INVALID_REQUEST' : 'INVALID_ENDPOINT';
    await rejected(code, { ...request, url: ctgovUrl() }, `${key} headers on the search URL`);
  }
  // The search rule's headers and query on the OpenAI host match no rule.
  await rejected('INVALID_ENDPOINT', valid('ctgov', { url: `${OPENAI}/api/v2/studies?format=json` }));
  await rejected('INVALID_ENDPOINT', valid('ctgov', { url: `${OPENAI}/v1/decisions?format=json` }));
  // The search rule's headers on an OpenAI pair are judged by that pair's rule and refused.
  await rejected('INVALID_REQUEST', valid('ctgov', { url: `${OPENAI}/v1/agents/sessions/${SID}` }), 'no OpenAI-Beta');
  await rejected('KEY_MISSING', valid('ctgov', { url: `${OPENAI}/v1/agents/sessions/${SID}`, headers: { Accept: 'application/json', 'OpenAI-Beta': BETA } }), 'no key');
});

test('[MAJOR-2] the ClinicalTrials.gov query grammar: allowlisted names once each, well-formed encoding, bounded length', async () => {
  // Accepted: the first page, a later page with a page token, a state-free search, and a
  // percent-encoded non-ASCII term.
  await passes(valid('ctgov'));
  const laterPage = FIRST_PAGE.filter(([name]) => name !== 'countTotal').concat([['pageToken', 'NF0g5JWBlPMs-6wlvJAp7w8']]);
  await passes(valid('ctgov', { url: ctgovUrl(laterPage) }));
  await passes(valid('ctgov', { url: ctgovUrl([['format', 'json'], ['query.cond', '"Sjögren syndrome"'], ['pageSize', '25']]) }));

  const base = ctgovUrl();
  const bad: [string, string][] = [
    ['no query', CTGOV_STUDIES],
    ['empty query', `${CTGOV_STUDIES}?`],
    ['unknown parameter', `${base}&query.term=asthma`],
    ['distance filter', `${base}&filter.geo=distance(43.6,-116.2,50mi)`],
    ['location query', `${base}&query.locn=Boise`],
    ['duplicate parameter', `${base}&format=json`],
    ['encoded parameter name', `${CTGOV_STUDIES}?query%2Econd=asthma`],
    ['empty value', `${CTGOV_STUDIES}?format=`],
    ['name without value', `${CTGOV_STUDIES}?format`],
    ['empty pair', `${CTGOV_STUDIES}?format=json&&pageSize=10`],
    ['leading ampersand', `${CTGOV_STUDIES}?&format=json`],
    ['equals sign inside a value', `${CTGOV_STUDIES}?format=json=x`],
    ['fragment', `${base}#top`],
    ['raw space', `${CTGOV_STUDIES}?query.cond=a b`],
    ['raw quote', `${CTGOV_STUDIES}?query.cond="asthma"`],
    ['raw plus', `${CTGOV_STUDIES}?query.cond=a+b`],
    ['raw slash', `${CTGOV_STUDIES}?pageToken=a/b`],
    ['lower-case hex', `${CTGOV_STUDIES}?query.cond=%2casthma`],
    ['bad hex digit', `${CTGOV_STUDIES}?query.cond=%G1`],
    ['truncated escape', `${CTGOV_STUDIES}?query.cond=asthma%2`],
    ['bare percent', `${CTGOV_STUDIES}?query.cond=%`],
    ['invalid UTF-8', `${CTGOV_STUDIES}?query.cond=%FF`],
    ['truncated UTF-8', `${CTGOV_STUDIES}?query.cond=%C3`],
    ['encoded line feed', `${CTGOV_STUDIES}?query.cond=asthma%0A`],
    ['encoded CRLF', `${CTGOV_STUDIES}?query.cond=asthma%0D%0AX-Evil%3A%201`],
    ['encoded NUL', `${CTGOV_STUDIES}?query.cond=%00`],
    ['encoded bidirectional override', `${CTGOV_STUDIES}?query.cond=%E2%80%AE`],
    ['another path', 'https://clinicaltrials.gov/api/v2/studies/NCT01234567?format=json'],
    ['trailing slash', 'https://clinicaltrials.gov/api/v2/studies/?format=json'],
    ['version endpoint', 'https://clinicaltrials.gov/api/v2/version?format=json'],
    ['stats endpoint', 'https://clinicaltrials.gov/api/v2/stats/size?format=json'],
    ['http', `http://clinicaltrials.gov/api/v2/studies?format=json`],
    ['subdomain', 'https://www.clinicaltrials.gov/api/v2/studies?format=json'],
    ['port', 'https://clinicaltrials.gov:443/api/v2/studies?format=json'],
    ['userinfo', 'https://user@clinicaltrials.gov/api/v2/studies?format=json'],
    ['longer host', 'https://clinicaltrials.gov.evil.example/api/v2/studies?format=json'],
    ['upper-case host', 'https://CLINICALTRIALS.GOV/api/v2/studies?format=json'],
  ];
  for (const [name, url] of bad) await rejected('INVALID_ENDPOINT', valid('ctgov', { url }), name);

  // Length: exactly MAX_TRANSPORT_URL_CHARS passes, one more character fails.
  const prefix = `${ctgovUrl(FIRST_PAGE.filter(([name]) => name !== 'countTotal'))}&pageToken=`;
  const atCap = prefix + 'A'.repeat(MAX_TRANSPORT_URL_CHARS - prefix.length);
  assert.equal(atCap.length, MAX_TRANSPORT_URL_CHARS);
  await passes(valid('ctgov', { url: atCap }));
  await rejected('INVALID_ENDPOINT', valid('ctgov', { url: `${atCap}A` }), 'one character over the URL cap');
});

// -----------------------------------------------------------------------------------------------
// Bodies
// -----------------------------------------------------------------------------------------------

test('[MAJOR-1] POST rules require a body; GET and DELETE rules and the search rule refuse one', async () => {
  for (const key of POST_KEYS) {
    const request = withHeaders(key, h => { delete h['Content-Type']; });
    delete request.body;
    await rejected('INVALID_REQUEST', request, `${key} without a body`);
  }
  for (const key of NO_BODY_KEYS) {
    await rejected('INVALID_REQUEST', { ...withHeaders(key, h => { h['Content-Type'] = 'application/json'; }), body: jsonBody() }, `${key} with a body`);
    await rejected('INVALID_REQUEST', { ...valid(key), body: jsonBody() }, `${key} with a body and no Content-Type`);
  }
});

test('the body must be a genuine Uint8Array', async () => {
  for (const body of ['{"model":"x"}', [1, 2, 3], { length: 2, 0: 1, 1: 2 }, new ArrayBuffer(4), new Uint16Array(2), new DataView(new ArrayBuffer(2)), null, 0]) {
    await rejected('INVALID_REQUEST', valid('decisions', { body }), Object.prototype.toString.call(body));
  }
});

test('the request body cap is enforced on the bytes about to leave: at the cap passes, one byte over fails', async () => {
  await rejected('INPUT_TOO_LARGE', valid('decisions', { body: new Uint8Array(MAX_OUTBOUND_BODY_BYTES + 1) }));
  const seen = await passes(valid('decisions', { body: new Uint8Array(MAX_OUTBOUND_BODY_BYTES) }));
  assert.equal(seen.body?.length, MAX_OUTBOUND_BODY_BYTES);
  // The cap comes before the header checks, so an oversized body is reported as such.
  await rejected('INPUT_TOO_LARGE', { ...withHeaders('decisions', h => { delete h.Authorization; }), body: new Uint8Array(MAX_OUTBOUND_BODY_BYTES + 1) });
});

// -----------------------------------------------------------------------------------------------
// Headers
// -----------------------------------------------------------------------------------------------

test('Content-Type is application/json exactly when a body is sent', async () => {
  await rejected('INVALID_REQUEST', withHeaders('decisions', h => { h['Content-Type'] = 'text/plain'; }));
  await rejected('INVALID_REQUEST', withHeaders('decisions', h => { h['Content-Type'] = 'application/json; charset=utf-8'; }));
  await rejected('INVALID_REQUEST', withHeaders('decisions', h => { delete h['Content-Type']; }));
  await rejected('INVALID_REQUEST', withHeaders('retrieve', h => { h['Content-Type'] = 'application/json'; }));
  await rejected('INVALID_REQUEST', withHeaders('ctgov', h => { h['Content-Type'] = 'application/json'; }));
});

test('[MAJOR-1] OpenAI-Beta: agents=v1 is required on every agents rule and refused on decisions and the search rule', async () => {
  for (const key of AGENTS_KEYS) {
    await rejected('INVALID_REQUEST', withHeaders(key, h => { delete h['OpenAI-Beta']; }), `${key} without beta`);
    await rejected('INVALID_REQUEST', withHeaders(key, h => { h['OpenAI-Beta'] = 'agents=v2'; }), `${key} with v2`);
    await rejected('INVALID_REQUEST', withHeaders(key, h => { h['OpenAI-Beta'] = 'AGENTS=V1'; }), `${key} upper case`);
  }
  await rejected('INVALID_REQUEST', withHeaders('decisions', h => { h['OpenAI-Beta'] = BETA; }), 'decisions with beta');
  await rejected('INVALID_REQUEST', withHeaders('ctgov', h => { h['OpenAI-Beta'] = BETA; }), 'search with beta');
  // A duplicate header in another letter case is refused even with the same value.
  await rejected('INVALID_REQUEST', withHeaders('retrieve', h => { h['openai-beta'] = BETA; }), 'duplicate beta');
});

test('[MAJOR-1, MAJOR-2] Authorization is required on every OpenAI rule and refused on the search rule', async () => {
  for (const key of OPENAI_KEYS) {
    await rejected('KEY_MISSING', withHeaders(key, h => { delete h.Authorization; }), `${key} without a key`);
    for (const value of ['Bearer short', `Basic ${FAKE_KEY}`, `bearer ${FAKE_KEY}`, `Bearer  ${FAKE_KEY}`, `Bearer ${FAKE_KEY} extra`, 'Bearer']) {
      await rejected('KEY_MISSING', withHeaders(key, h => { h.Authorization = value; }), `${key}: ${value}`);
    }
    await rejected('INVALID_REQUEST', withHeaders(key, h => { h.Authorization = 'Bearer x\r\nX-Evil: 1'; }), `${key} CRLF`);
    await rejected('INVALID_REQUEST', withHeaders(key, h => { h.Authorization = [AUTH]; }), `${key} array value`);
  }
  // The user's OpenAI key cannot be attached to the ClinicalTrials.gov request in any spelling.
  await rejected('INVALID_REQUEST', withHeaders('ctgov', h => { h.Authorization = AUTH; }), 'search with a key');
  await rejected('INVALID_REQUEST', withHeaders('ctgov', h => { h.authorization = AUTH; }), 'search with a lower-case key');
  const seen = await passes(valid('decisions'));
  assert.equal(seen.headers.Authorization, AUTH);
});

test('Accept: text/event-stream only on create-session; the search rule requires Accept: application/json', async () => {
  await passes(valid('create'));
  await passes(withHeaders('create', h => { h.Accept = 'application/json'; }));
  await passes(withHeaders('create', h => { delete h.Accept; }));
  for (const key of ['decisions', 'retrieve', 'events', 'delete'] as RuleKey[]) {
    await rejected('INVALID_REQUEST', withHeaders(key, h => { h.Accept = 'text/event-stream'; }), `${key} streaming`);
    await passes(withHeaders(key, h => { h.Accept = 'application/json'; }), `${key} json`);
  }
  await rejected('INVALID_REQUEST', withHeaders('ctgov', h => { delete h.Accept; }), 'search without Accept');
  await rejected('INVALID_REQUEST', withHeaders('ctgov', h => { h.Accept = 'text/event-stream'; }), 'search streaming');
  await rejected('INVALID_REQUEST', withHeaders('ctgov', h => { h.Accept = '*/*'; }), 'search any');
});

test('unknown headers are rejected, not dropped, and values are one line of printable ASCII', async () => {
  await rejected('INVALID_REQUEST', withHeaders('decisions', h => { h['X-Custom'] = '1'; }));
  await rejected('INVALID_REQUEST', withHeaders('decisions', h => { h['OpenAI-Organization'] = 'org-x'; }));
  await rejected('INVALID_REQUEST', withHeaders('decisions', h => { h['Idempotency-Key'] = 'k'; }));
  await rejected('INVALID_REQUEST', withHeaders('ctgov', h => { h.Cookie = 'a=b'; }));
  await rejected('INVALID_REQUEST', withHeaders('decisions', h => { h.authorization = AUTH; }), 'duplicate by case');
  await rejected('INVALID_REQUEST', withHeaders('decisions', h => { h.Accept = 'text/plain'; }));
  await rejected('INVALID_REQUEST', withHeaders('decisions', h => { h.Accept = 'é'; }));
  await rejected('INVALID_REQUEST', withHeaders('decisions', h => { h.Accept = 'application/json ' + 'x'.repeat(8192); }));
  await rejected('INVALID_REQUEST', withHeaders('decisions', h => { h.Accept = ''; }));
  await rejected('INVALID_REQUEST', withHeaders('decisions', h => { h['Bad Header'] = 'x'; }));
  for (const headers of [['Accept'], null, undefined, 'Accept: application/json']) {
    await rejected('INVALID_REQUEST', valid('decisions', { headers }), String(headers));
  }
});

test('the signal is shape-validated; a real cancel source passes through untouched', async () => {
  await rejected('INVALID_REQUEST', valid('retrieve', { signal: { aborted: 'no' } }));
  await rejected('INVALID_REQUEST', valid('retrieve', { signal: null }));
  const source = createCancelSource();
  const seen = await passes(valid('retrieve', { signal: source.signal }));
  assert.equal(seen.signal, source.signal);
});

// -----------------------------------------------------------------------------------------------
// The rebuild and the one-time snapshot
// -----------------------------------------------------------------------------------------------

test('the port sees a rebuilt request: canonical header names, frozen objects, a fresh body copy', async () => {
  const sourceBody = utf8Encode('{"model":"gpt-6-luna","input":[]}');
  const seen = await passes(valid('decisions', { headers: { authorization: AUTH, 'content-type': 'application/json' }, body: sourceBody }));
  assert.deepEqual(Object.keys(seen.headers).sort(), ['Authorization', 'Content-Type']);
  assert.equal(Object.isFrozen(seen), true);
  assert.equal(Object.isFrozen(seen.headers), true);
  assert.notEqual(seen.body, sourceBody, 'the body is a copy, not the bytes the caller handed over');
  sourceBody[0] = (sourceBody[0] ?? 0) ^ 0xff;
  assert.equal(utf8Decode(seen.body!), '{"model":"gpt-6-luna","input":[]}');
});

test('[MINOR-1] each request field is read once: getters cannot show the checks one value and the port another', async () => {
  const reads: Record<string, number> = {};
  const counted = (name: string, first: unknown, later: unknown) => {
    reads[name] = 0;
    return {
      get() {
        reads[name] = (reads[name] ?? 0) + 1;
        return reads[name] === 1 ? first : later;
      },
      enumerable: true,
    };
  };
  const small = jsonBody();
  const request = {};
  Object.defineProperties(request, {
    method: counted('method', 'POST', 'PUT'),
    url: counted('url', `${OPENAI}/v1/decisions`, 'https://evil.example/v1/decisions'),
    headers: counted('headers', { Authorization: AUTH, 'Content-Type': 'application/json' }, { Authorization: AUTH, 'Content-Type': 'application/json', 'X-Evil': '1' }),
    body: counted('body', small, new Uint8Array(4 * MAX_OUTBOUND_BODY_BYTES)),
    signal: counted('signal', undefined, { aborted: 'no' }),
  });
  const seen = await passes(request);
  assert.deepEqual(reads, { method: 1, url: 1, headers: 1, body: 1, signal: 1 });
  assert.equal(seen.method, 'POST');
  assert.equal(seen.url, `${OPENAI}/v1/decisions`);
  assert.deepEqual(Object.keys(seen.headers).sort(), ['Authorization', 'Content-Type']);
  assert.equal(seen.body?.length, small.length, 'the port received the bytes that were checked');

  // A request that is itself a Proxy: each field is still read once.
  const proxyReads: Record<string, number> = {};
  const target = valid('retrieve');
  const proxied = new Proxy(target, {
    get(t, key, receiver) {
      if (typeof key === 'string') proxyReads[key] = (proxyReads[key] ?? 0) + 1;
      return Reflect.get(t, key, receiver);
    },
  });
  await passes(proxied);
  for (const key of ['method', 'url', 'headers', 'body', 'signal']) assert.equal(proxyReads[key], 1, key);

  // A getter that throws is a constant-shape INVALID_REQUEST, never the getter's own error.
  const throwing = valid('decisions');
  Object.defineProperty(throwing, 'body', { get() { throw new Error('secret text'); }, enumerable: true });
  await rejected('INVALID_REQUEST', throwing);
});

test('[MINOR-1] a Uint8Array subclass, a Proxy, or a detached buffer cannot misreport the body', async () => {
  class ShortLength extends Uint8Array {
    override get length(): number {
      return 10;
    }
  }
  const lying = new ShortLength(4 * MAX_OUTBOUND_BODY_BYTES);
  assert.equal(lying.length, 10, 'sanity: the subclass reports a short length');
  await rejected('INPUT_TOO_LARGE', valid('decisions', { body: lying }), 'the real length is used');
  const honestSubclass = new ShortLength(4);
  const seen = await passes(valid('decisions', { body: honestSubclass }));
  assert.equal(Object.getPrototypeOf(seen.body), Uint8Array.prototype, 'the port receives a plain Uint8Array copy');
  assert.equal(seen.body?.length, 4);

  const proxyBody = new Proxy(new Uint8Array(4 * MAX_OUTBOUND_BODY_BYTES), {
    get(t, key) {
      return key === 'length' ? 10 : Reflect.get(t, key);
    },
  });
  assert.equal(proxyBody instanceof Uint8Array, true, 'sanity: the Proxy passes instanceof');
  await rejected('INVALID_REQUEST', valid('decisions', { body: proxyBody }), 'a Proxy is not a genuine Uint8Array');
  await rejected('INVALID_REQUEST', valid('decisions', { body: new Proxy(jsonBody(), {}) }), 'not even a transparent one');

  const detached = jsonBody();
  structuredClone(detached.buffer, { transfer: [detached.buffer as ArrayBuffer] });
  await rejected('INVALID_REQUEST', valid('decisions', { body: detached }), 'a detached buffer');
});

test('[MINOR-1] Proxy headers: names and values are read once, and a lying or throwing trap is refused', async () => {
  const valueReads: Record<string, number> = {};
  let keyReads = 0;
  const target = { Authorization: AUTH, 'Content-Type': 'application/json' };
  const headers = new Proxy(target, {
    ownKeys(t) {
      keyReads += 1;
      return Reflect.ownKeys(t);
    },
    get(t, key) {
      if (typeof key !== 'string') return undefined;
      valueReads[key] = (valueReads[key] ?? 0) + 1;
      // The first read is valid; any later read would smuggle a second header line.
      return valueReads[key] === 1 ? Reflect.get(t, key) : 'Bearer evil\r\nX-Evil: 1';
    },
  });
  const seen = await passes(valid('decisions', { headers }));
  assert.equal(keyReads, 1);
  assert.deepEqual(valueReads, { Authorization: 1, 'Content-Type': 1 });
  assert.equal(seen.headers.Authorization, AUTH);
  assert.equal(Object.isFrozen(seen.headers), true);
  assert.notEqual(seen.headers, headers, 'the port gets the rebuilt object, not the Proxy');

  const throwingKeys = new Proxy({}, { ownKeys() { throw new Error('trap'); } });
  await rejected('INVALID_REQUEST', valid('decisions', { headers: throwingKeys }), 'ownKeys throws');
  const throwingGet = new Proxy({ ...target }, { get() { throw new Error('trap'); } });
  await rejected('INVALID_REQUEST', valid('decisions', { headers: throwingGet }), 'get throws');
  const extraKey = new Proxy({ ...target, 'X-Evil': '1' }, {});
  await rejected('INVALID_REQUEST', valid('decisions', { headers: extraKey }), 'an unknown header through a Proxy');
});

// -----------------------------------------------------------------------------------------------
// The ports bundle and a hostile port
// -----------------------------------------------------------------------------------------------

test('[MINOR-2] guardCorePorts returns a frozen bundle of frozen facades that call the host ports', async () => {
  const host = testPorts();
  const capture = new Capture();
  const ports = guardCorePorts({ ...host, transport: capture });
  assert.equal(Object.isFrozen(ports), true);
  for (const name of ['transport', 'sha256', 'tokens', 'clock', 'loader'] as const) {
    assert.equal(Object.isFrozen(ports[name]), true, name);
    assert.notEqual(ports[name] as unknown, host[name] as unknown, `${name}: the host object is not reachable through the bundle`);
  }
  const evilTokens = { randomBytes: (n: number) => new Uint8Array(n) };
  assert.throws(() => { (ports as { tokens: unknown }).tokens = evilTokens; }, TypeError);
  assert.throws(() => { (ports as { transport: unknown }).transport = capture; }, TypeError);
  assert.throws(() => { (ports.tokens as { randomBytes: unknown }).randomBytes = evilTokens.randomBytes; }, TypeError);
  assert.throws(() => { (ports.transport as { request: unknown }).request = capture.request; }, TypeError);
  assert.throws(() => Object.defineProperty(ports, 'clock', { value: host.clock }), TypeError);

  // The facades forward to the host ports at call time.
  const before = host.tokens.calls;
  assert.equal((await ports.tokens.randomBytes(8)).length, 8);
  assert.equal(host.tokens.calls, before + 1);
  assert.equal(ports.clock.now(), host.clock.now());
  host.clock.advance(5);
  assert.equal(ports.clock.monotonic(), host.clock.monotonic());
  assert.equal(await ports.sha256.digestHex(new Uint8Array(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  // And the transport facade is the guard.
  await assert.rejects(() => ports.transport.request(valid('decisions', { url: 'https://evil.example/v1/decisions' }) as never), isCode('INVALID_ENDPOINT'));
  await ports.transport.request(valid('decisions') as never);
  assert.equal(capture.calls.length, 1);
});

test('[MINOR-2] a pipeline cannot replace ports for later contexts or for the consent store', async () => {
  const capture = new Capture();
  const evilTokenCalls: number[] = [];
  const evilTransportCalls: unknown[] = [];
  const attempts: [string, boolean][] = [];
  const attempt = (name: string, action: () => void) => {
    try {
      action();
      attempts.push([name, false]);
    } catch (error) {
      attempts.push([name, error instanceof TypeError]);
    }
  };
  const h = harness({
    transport: capture,
    pipelines: {
      async screenLocal(ctx, payload) {
        const evilTokens = { randomBytes: (n: number) => { evilTokenCalls.push(n); return new Uint8Array(n).fill(7); } };
        const evilTransport = { request: async (r: unknown) => { evilTransportCalls.push(r); return { status: 200, headers: {}, body: new Uint8Array(0) }; } };
        attempt('replace tokens', () => { (ctx.ports as { tokens: unknown }).tokens = evilTokens; });
        attempt('replace transport', () => { (ctx.ports as { transport: unknown }).transport = evilTransport; });
        attempt('replace randomBytes', () => { (ctx.ports.tokens as { randomBytes: unknown }).randomBytes = evilTokens.randomBytes; });
        attempt('replace request', () => { (ctx.ports.transport as { request: unknown }).request = evilTransport.request; });
        attempt('define clock', () => { Object.defineProperty(ctx.ports, 'clock', { value: { now: () => 0 } }); });
        return screenLocalPipeline(ctx, payload);
      },
    },
    execute: async (ctx, log) => {
      await ctx.ports.transport.request(toTransportRequest({ method: 'POST', path: '/v1/decisions', apiKey: FAKE_KEY, body: { model: 'gpt-6-luna' } }));
      return defaultExecute(ctx, log);
    },
  });
  okResult(await h.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }));
  okResult(await h.call('screenLocal', { nctIds: [FICTIONAL_IDS[0]], profile: {} }));
  assert.deepEqual(attempts, [
    ['replace tokens', true],
    ['replace transport', true],
    ['replace randomBytes', true],
    ['replace request', true],
    ['define clock', true],
  ]);
  const tokenCallsBefore = h.ports.tokens.calls;
  const prepared = okResult<PreparedRealResult>(await h.call('prepareReal', { packet: basePacket(), policyReceipt: receipt }));
  assert.ok(h.ports.tokens.calls > tokenCallsBefore, 'the consent store drew its token from the host port');
  assert.deepEqual(evilTokenCalls, []);
  assert.notEqual(prepared.token, 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc', 'the token is not derived from the pipeline bytes');
  okResult(await h.call('executeReal', { token: prepared.token, digest: prepared.digest, operation: 'score', policyReceipt: receipt }));
  assert.equal(capture.calls.length, 1, 'later contexts still send through the guarded host port');
  assert.deepEqual(evilTransportCalls, []);
});

test('a hostile transport port cannot change the request it was handed, the caller bytes, or the next request', async () => {
  const outcomes: Record<string, string>[] = [];
  const retained: TransportRequest[] = [];
  const hostile: Transport = {
    async request(request) {
      retained.push(request);
      const outcome: Record<string, string> = {};
      const tryIt = (name: string, action: () => void) => {
        try {
          action();
          outcome[name] = 'no error';
        } catch (error) {
          outcome[name] = error instanceof TypeError ? 'TypeError' : 'other';
        }
      };
      const r = request as unknown as Record<string, unknown>;
      const headers = request.headers as Record<string, string>;
      tryIt('url', () => { r.url = 'https://evil.example/v1/decisions'; });
      tryIt('method', () => { r.method = 'PUT'; });
      tryIt('body', () => { r.body = new Uint8Array(1); });
      tryIt('delete url', () => { delete r.url; });
      tryIt('define url', () => { Object.defineProperty(r, 'url', { value: 'https://evil.example' }); });
      tryIt('headers object', () => { r.headers = { 'X-Evil': '1' }; });
      tryIt('authorization', () => { headers.Authorization = 'Bearer sk-evil-replacement-000000000000'; });
      tryIt('new header', () => { headers['X-Evil'] = '1'; });
      tryIt('delete header', () => { delete headers['Content-Type']; });
      outcomes.push(outcome);
      // Typed arrays cannot be frozen; the port may scribble on its own copy, which nobody else holds.
      request.body?.fill(0x41);
      return { status: 200, headers: {}, body: utf8Encode('{}') };
    },
  };
  const gate = guardTransport(hostile);
  const callerBytes = utf8Encode('{"model":"gpt-6-luna","input":"fictional"}');
  const original = utf8Decode(callerBytes);
  await gate.request(valid('decisions', { body: callerBytes }) as never);
  await gate.request(valid('decisions', { body: callerBytes }) as never);

  assert.equal(outcomes.length, 2);
  for (const outcome of outcomes) {
    for (const [name, result] of Object.entries(outcome)) assert.equal(result, 'TypeError', `${name} must throw on the frozen request`);
  }
  assert.equal(utf8Decode(callerBytes), original, 'the caller bytes are unchanged by what the port did');
  const [first, second] = retained;
  assert.notEqual(first, second, 'each call hands the port a new request object');
  assert.notEqual(first!.body, second!.body, 'and a new body copy');
  assert.equal(first!.url, `${OPENAI}/v1/decisions`);
  assert.equal(first!.method, 'POST');
  assert.deepEqual(Object.keys(first!.headers).sort(), ['Authorization', 'Content-Type']);
  assert.equal(first!.headers.Authorization, AUTH);
  // The second request carried the caller bytes again, not the first copy the port scribbled on
  // (it scribbled on the second copy only after receiving it).
  assert.equal(second!.body!.length, callerBytes.length);
  // A port that kept the first request and edits its body now affects only that dead copy.
  first!.body!.fill(0x42);
  const third = new Capture();
  await guardTransport(third).request(valid('decisions', { body: callerBytes }) as never);
  assert.equal(utf8Decode(third.calls[0]!.body!), original);
});

// -----------------------------------------------------------------------------------------------
// toTransportRequest: the only constructor a core caller should use for OpenAI
// -----------------------------------------------------------------------------------------------

test('toTransportRequest builds each OpenAI rule with the headers the rule decides', () => {
  const decisions = toTransportRequest({ method: 'POST', path: '/v1/decisions', apiKey: FAKE_KEY, body: { model: 'gpt-6-luna' } });
  assert.deepEqual(decisions.headers, { Authorization: AUTH, 'Content-Type': 'application/json' });
  assert.equal(decisions.url, `${OPENAI}/v1/decisions`);
  assert.equal(utf8Decode(decisions.body!), '{"model":"gpt-6-luna"}');
  assert.equal(Object.isFrozen(decisions), true);

  const create = toTransportRequest({ method: 'POST', path: '/v1/agents/sessions', apiKey: FAKE_KEY, body: { stream: true }, accept: 'text/event-stream' });
  assert.deepEqual(create.headers, { Authorization: AUTH, 'Content-Type': 'application/json', 'OpenAI-Beta': BETA, Accept: 'text/event-stream' });

  const retrieve = toTransportRequest({ method: 'GET', path: `/v1/agents/sessions/${SID}`, apiKey: FAKE_KEY });
  assert.deepEqual(retrieve.headers, { Authorization: AUTH, 'OpenAI-Beta': BETA });
  assert.equal(retrieve.body, undefined);

  const events = toTransportRequest({ method: 'POST', path: `/v1/agents/sessions/${SID}/events`, apiKey: FAKE_KEY, body: { events: [] } });
  assert.deepEqual(events.headers, { Authorization: AUTH, 'Content-Type': 'application/json', 'OpenAI-Beta': BETA });

  const removal = toTransportRequest({ method: 'DELETE', path: `/v1/agents/sessions/${SID}`, apiKey: FAKE_KEY, accept: 'application/json' });
  assert.deepEqual(removal.headers, { Authorization: AUTH, 'OpenAI-Beta': BETA, Accept: 'application/json' });
});

test('toTransportRequest refuses everything outside the rule table with the guard codes', () => {
  const key = { apiKey: FAKE_KEY };
  for (const [method, path] of [
    ['GET', `/v1/agents/sessions/${SID}/events`],
    ['POST', `/v1/agents/sessions/${SID}`],
    ['GET', '/v1/agents/sessions'],
    ['GET', '/v1/decisions'],
    ['DELETE', '/v1/decisions'],
    ['PUT', '/v1/decisions'],
    ['GET', '/v1/chat/completions'],
    ['POST', '/v1/decisions?x=1'],
    ['POST', 'v1/decisions'],
    ['POST', '.evil.example/v1/decisions'],
    ['GET', '/api/v2/studies?format=json'],
  ] as const) {
    assert.throws(() => toTransportRequest({ method: method as never, path, body: method === 'POST' ? {} : undefined, ...key }), isCode('INVALID_ENDPOINT'), `${method} ${path}`);
  }
  assert.throws(() => toTransportRequest({ method: 'GET', path: `/v1/agents/sessions/${SID}`, body: {}, ...key }), isCode('INVALID_REQUEST'));
  assert.throws(() => toTransportRequest({ method: 'POST', path: '/v1/decisions', ...key }), isCode('INVALID_REQUEST'), 'a POST rule needs a body');
  assert.throws(() => toTransportRequest({ method: 'POST', path: '/v1/decisions', body: {}, accept: 'text/event-stream', ...key }), isCode('INVALID_REQUEST'));
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(() => toTransportRequest({ method: 'POST', path: '/v1/decisions', body: circular, ...key }), isCode('INVALID_REQUEST'));
  assert.throws(() => toTransportRequest({ method: 'POST', path: '/v1/decisions', body: () => 1, ...key }), isCode('INVALID_REQUEST'));
  assert.throws(
    () => toTransportRequest({ method: 'POST', path: '/v1/decisions', body: { pad: 'x'.repeat(MAX_OUTBOUND_BODY_BYTES) }, ...key }),
    isCode('INPUT_TOO_LARGE'),
  );
  assert.throws(() => toTransportRequest({ method: 'POST', path: '/v1/decisions', body: {}, apiKey: 'bad key' }), isCode('KEY_MISSING'));
  assert.throws(() => toTransportRequest({ method: 'POST', path: '/v1/decisions', body: {} } as never), isCode('KEY_MISSING'));
  assert.throws(() => toTransportRequest(null as never), isCode('INVALID_REQUEST'));
});

test('parity: what the builder produces passes the guard unchanged', async () => {
  const built = [
    toTransportRequest({ method: 'POST', path: '/v1/decisions', apiKey: FAKE_KEY, body: { model: 'gpt-6-luna' } }),
    toTransportRequest({ method: 'POST', path: '/v1/agents/sessions', apiKey: FAKE_KEY, body: { stream: true }, accept: 'text/event-stream' }),
    toTransportRequest({ method: 'GET', path: `/v1/agents/sessions/${SID}`, apiKey: FAKE_KEY }),
    toTransportRequest({ method: 'POST', path: `/v1/agents/sessions/${SID}/events`, apiKey: FAKE_KEY, body: { events: [] } }),
    toTransportRequest({ method: 'DELETE', path: `/v1/agents/sessions/${SID}`, apiKey: FAKE_KEY }),
  ];
  for (const request of built) {
    const seen = await passes(request, request.url);
    assert.equal(seen.method, request.method);
    assert.equal(seen.url, request.url);
    assert.deepEqual(seen.headers, request.headers);
    assert.equal(seen.body === undefined ? undefined : utf8Decode(seen.body), request.body === undefined ? undefined : utf8Decode(request.body));
  }
});

// -----------------------------------------------------------------------------------------------
// End to end: a pipeline inside the core cannot widen the gate
// -----------------------------------------------------------------------------------------------

const executePayload = (p: PreparedRealResult) => ({ token: p.token, digest: p.digest, operation: 'score' as const, policyReceipt: receipt });

async function prepared(h: ReturnType<typeof harness>): Promise<PreparedRealResult> {
  okResult(await h.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }));
  return okResult<PreparedRealResult>(await h.call('prepareReal', { packet: basePacket(), policyReceipt: receipt }));
}

test('end to end: a pipeline that holds the key still cannot send outside the table, and the port is never called', async () => {
  const hostile: [string, string, (key: string) => Record<string, unknown>][] = [
    ['the key to another host', 'INVALID_ENDPOINT', key => valid('decisions', { url: 'https://evil.example/v1/decisions', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } })],
    ['the key to ClinicalTrials.gov', 'INVALID_REQUEST', key => withHeaders('ctgov', h => { h.Authorization = `Bearer ${key}`; })],
    ['the key on the search URL with POST', 'INVALID_ENDPOINT', key => valid('decisions', { url: ctgovUrl(), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } })],
    ['session listing with the key', 'INVALID_ENDPOINT', key => valid('retrieve', { url: `${OPENAI}/v1/agents/sessions`, headers: { Authorization: `Bearer ${key}`, 'OpenAI-Beta': BETA } })],
    ['session update with the key', 'INVALID_ENDPOINT', key => valid('events', { url: `${OPENAI}/v1/agents/sessions/${SID}`, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'OpenAI-Beta': BETA } })],
    ['an event stream read with the key', 'INVALID_ENDPOINT', key => valid('retrieve', { url: `${OPENAI}/v1/agents/sessions/${SID}/events`, headers: { Authorization: `Bearer ${key}`, 'OpenAI-Beta': BETA, Accept: 'text/event-stream' } })],
    ['another method', 'INVALID_ENDPOINT', key => valid('decisions', { method: 'PUT', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } })],
    ['an oversized body', 'INPUT_TOO_LARGE', key => valid('decisions', { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: new Uint8Array(MAX_OUTBOUND_BODY_BYTES + 1) })],
    ['agents path without beta', 'INVALID_REQUEST', key => valid('retrieve', { headers: { Authorization: `Bearer ${key}` } })],
    ['the key with another scheme', 'KEY_MISSING', key => valid('decisions', { headers: { Authorization: `Basic ${key}`, 'Content-Type': 'application/json' } })],
  ];
  for (const [name, code, build] of hostile) {
    const capture = new Capture();
    const h = harness({
      transport: capture,
      execute: async ctx => {
        const key = await ctx.requestCredential();
        await ctx.ports.transport.request(build(key) as never);
        throw new Error('unreachable: the guard must refuse before this');
      },
    });
    const p = await prepared(h);
    assert.equal(errorCode(await h.call('executeReal', executePayload(p))), code, name);
    assert.equal(h.log.credentialRequests.length, 1, `${name}: the pipeline did obtain the key`);
    assert.equal(capture.calls.length, 0, `${name}: and the guard still kept the request from the port`);
  }
});

test('end to end: the one valid hand-crafted request reaches the port rebuilt, and the operation still completes', async () => {
  const capture = new Capture();
  const h = harness({
    transport: capture,
    execute: async (ctx, log) => {
      await ctx.ports.transport.request(valid('decisions', {
        headers: { authorization: AUTH, 'content-type': 'application/json' },
        body: utf8Encode('{"model":"gpt-6-luna","input":[]}'),
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
  assert.equal(h.log.credentialRequests.length, 1, 'the provider stand-in requests the credential exactly once');
});
