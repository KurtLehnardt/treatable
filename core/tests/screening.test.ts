// Mocked: no network. Deterministic screening (task A1b). Ported from the screening cases of
// scaffold/lib/studies/__tests__/clinical.test.ts (age boundaries, unknown retention, distance as
// a soft preference, sex sources, staleness), adapted to the core protocol shapes and the session
// rules; nearestSite cases come from extension/src/core.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCore } from '../src/dispatcher.ts';
import { CoreError } from '../src/errors.ts';
import { StudyRecordSchema, type RequestPayload, type StudyRecord } from '../src/protocol.ts';
import type { Loader } from '../src/ports.ts';
import { createSession } from '../src/session.ts';
import {
  ageInYears,
  ALLOWED_STATUSES,
  civilDateOf,
  haversineMiles,
  isStaleRecord,
  MAX_SESSION_RECORDS,
  nearestDistanceMiles,
  nearestSite,
  rememberRecords,
  screenStudyRecord,
  STUDY_RECORDS,
} from '../src/screening.ts';
import { testPorts } from './support/fakes.ts';
import { errorCode, fakeRecord, harness, okResult, req } from './support/harness.ts';
import { FICTIONAL_IDS } from './support/preview.ts';

/** FakeClock's wall time: 2026-10-26T07:33:20Z, so the staleness cutoff is 2024-10-26. */
const NOW = 1_793_000_000_000;

type Profile = RequestPayload<'screenLocal'>['profile'];

const invalidRequest = (e: unknown): boolean => e instanceof CoreError && e.code === 'INVALID_REQUEST';
const inputTooLarge = (e: unknown): boolean => e instanceof CoreError && e.code === 'INPUT_TOO_LARGE';

/** A valid record with overrides, parsed through the schema so every fixture is a real record. */
function record(overrides: Record<string, unknown> = {}): StudyRecord {
  return StudyRecordSchema.parse(JSON.parse(JSON.stringify({ ...fakeRecord('NCT90000001'), ...overrides })));
}

function entry(record_: StudyRecord, profile: Profile = {}, nowMs = NOW) {
  return screenStudyRecord(record_, profile, profile.location && 'lat' in profile.location ? { lat: profile.location.lat, lon: profile.location.lon } : undefined, nowMs);
}

// -----------------------------------------------------------------------------------------------
// Ported helpers
// -----------------------------------------------------------------------------------------------

test('[ported clinical.test.ts#4] ageInYears normalizes units conservatively and leaves the rest unknown', () => {
  assert.equal(ageInYears('18 Years'), 18);
  assert.equal(ageInYears('18 years'), 18);
  assert.equal(ageInYears('12 YEARS'), 12);
  assert.equal(ageInYears('24 Months'), 2);
  assert.equal(ageInYears('6 Weeks'), (6 * 7) / 365.25);
  assert.equal(ageInYears('7 Days'), 7 / 365.25);
  assert.equal(ageInYears('N/A'), undefined);
  assert.equal(ageInYears('n/a'), undefined);
  assert.equal(ageInYears(undefined), undefined);
  assert.equal(ageInYears(null), undefined);
  assert.equal(ageInYears(''), undefined);
  assert.equal(ageInYears('18+'), undefined, 'non-numeric ranges stay unknown');
  assert.equal(ageInYears('>18 Years'), undefined);
});

test('[ported clinical.test.ts#6] haversine is sane at one degree of longitude', () => {
  assert.ok(haversineMiles({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) > 69);
  assert.equal(haversineMiles({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }), 0);
});

test('civilDateOf truncates wall-clock time to whole days (FakeClock wall is 2026-10-26 UTC)', () => {
  assert.deepEqual(civilDateOf(NOW), { year: 2026, month: 10, day: 26 });
  assert.deepEqual(civilDateOf(0), { year: 1970, month: 1, day: 1 });
  assert.deepEqual(civilDateOf(-1), { year: 1969, month: 12, day: 31 });
  assert.deepEqual(civilDateOf(Date.UTC(2000, 1, 29)), { year: 2000, month: 2, day: 29 });
});

test('staleness cuts at exactly two calendar years back: strictly before the cutoff date', () => {
  const stale = (date: string | null) => isStaleRecord(record({ lastUpdatePostDate: date }), NOW);
  assert.equal(stale('2024-10-25'), true);
  assert.equal(stale('2024-10-26'), false, 'the cutoff date itself is not stale');
  assert.equal(stale('2024-10-27'), false);
  assert.equal(stale('2024-10'), true, 'a month-only date counts as its first day');
  assert.equal(stale('2025-06-30'), false);
  assert.equal(stale('2020-01-01'), true, 'the scaffold staleness case');
  assert.equal(stale('2024-13-99'), false, 'an impossible date is never stale');
  assert.equal(stale(null), false);
});

// -----------------------------------------------------------------------------------------------
// screenStudyRecord: the three structured checks
// -----------------------------------------------------------------------------------------------

test('[ported clinical.test.ts#4] age boundaries are inclusive on both ends', () => {
  const ranged = record({ eligibility: { criteria: 'Inclusion Criteria:\n* Fictional', minimumAge: '18 Years', maximumAge: '65 Years', sex: 'ALL', healthyVolunteers: false } });
  assert.equal(entry(ranged, { ageYears: 18 }).checks.find(c => c.rule === 'age')?.status, 'met');
  assert.equal(entry(ranged, { ageYears: 65 }).checks.find(c => c.rule === 'age')?.status, 'met');
  assert.equal(entry(ranged, { ageYears: 66 }).checks.find(c => c.rule === 'age')?.status, 'unmet');
  assert.equal(entry(ranged, { ageYears: 66 }).bucket, 'known_mismatch');
  assert.equal(entry(ranged, { ageYears: 28, sex: 'female' }).bucket, 'no_known_mismatch');
});

test('[ported clinical.test.ts#5] missing medical and location fields keep candidates unknown', () => {
  const empty = record({
    eligibility: { criteria: '', minimumAge: null, maximumAge: null, sex: 'UNKNOWN', healthyVolunteers: null },
    locations: [],
  });
  const result = entry(empty, { ageYears: 45, sex: 'female' });
  assert.equal(result.bucket, 'unknown');
  assert.deepEqual(result.checks.map(c => c.status), ['unknown', 'unknown', 'met']);
  assert.equal(result.distanceMiles, null);
  assert.equal(result.outOfRadius, false);
});

test('an unstated structured field never mismatches: unstated ages and unstated profiles stay unknown', () => {
  const ageUnstated = record({ eligibility: { criteria: '', minimumAge: null, maximumAge: null, sex: 'ALL', healthyVolunteers: false } });
  assert.equal(entry(ageUnstated, { ageYears: 45 }).checks.find(c => c.rule === 'age')?.status, 'unknown');
  const withRange = record();
  assert.equal(entry(withRange, {}).checks.find(c => c.rule === 'age')?.status, 'unknown', 'no shared age against a stated range');
  assert.equal(entry(withRange, {}).bucket, 'unknown');
});

test('[ported clinical.test.ts#7] sex ALL matches; an explicit mismatch comes only from the record', () => {
  const r = entry(record(), { ageYears: 45, sex: 'female' });
  assert.equal(r.bucket, 'no_known_mismatch');
  assert.equal(r.checks.find(c => c.rule === 'sex')?.status, 'met');
  const mismatch = entry(record({ eligibility: { criteria: '', minimumAge: '18 Years', maximumAge: null, sex: 'MALE', healthyVolunteers: false } }), { ageYears: 45, sex: 'female' });
  assert.equal(mismatch.bucket, 'known_mismatch');
  assert.equal(mismatch.checks.find(c => c.rule === 'sex')?.status, 'unmet');
  const preferNotToSay = entry(record(), { ageYears: 45, sex: 'prefer_not_to_say' });
  assert.equal(preferNotToSay.checks.find(c => c.rule === 'sex')?.status, 'unknown');
  const unknownSexRecord = entry(record({ eligibility: { criteria: '', minimumAge: null, maximumAge: null, sex: 'UNKNOWN', healthyVolunteers: false } }), { ageYears: 45, sex: 'female' });
  assert.equal(unknownSexRecord.checks.find(c => c.rule === 'sex')?.status, 'unknown');
});

test('accepting healthy volunteers never implies healthy-only', () => {
  const r = entry(record({ eligibility: { criteria: '', minimumAge: '18 Years', maximumAge: null, sex: 'ALL', healthyVolunteers: true } }), { ageYears: 45, sex: 'female' });
  assert.equal(r.bucket, 'no_known_mismatch');
});

test('the status check follows the refreshed listing statuses, and UNKNOWN stays unknown', () => {
  for (const status of ['RECRUITING', 'NOT_YET_RECRUITING', 'ENROLLING_BY_INVITATION', 'AVAILABLE']) {
    assert.equal(entry(record({ status }), { ageYears: 45 }).checks.find(c => c.rule === 'status')?.status, 'met', status);
  }
  for (const status of ['COMPLETED', 'SUSPENDED', 'TERMINATED', 'WITHDRAWN', 'ACTIVE_NOT_RECRUITING', 'NO_LONGER_AVAILABLE']) {
    assert.equal(entry(record({ status }), { ageYears: 45 }).checks.find(c => c.rule === 'status')?.status, 'unmet', status);
    assert.equal(entry(record({ status }), { ageYears: 45 }).bucket, 'known_mismatch', status);
  }
  assert.equal(entry(record({ status: 'UNKNOWN' }), { ageYears: 45 }).checks.find(c => c.rule === 'status')?.status, 'unknown');
  assert.equal(entry(record({ status: 'UNKNOWN' }), { ageYears: 45 }).bucket, 'unknown');
  assert.deepEqual([...ALLOWED_STATUSES], ['RECRUITING', 'NOT_YET_RECRUITING', 'ENROLLING_BY_INVITATION', 'AVAILABLE']);
});

test('the bucket keeps the ported precedence: any unmet wins, then any unknown, then full agreement', () => {
  const allMet = entry(record(), { ageYears: 45, sex: 'female' });
  assert.deepEqual(allMet.checks.map(c => c.status), ['met', 'met', 'met']);
  assert.equal(allMet.bucket, 'no_known_mismatch');
  const mixed = entry(record({ eligibility: { criteria: '', minimumAge: '40 Years', maximumAge: null, sex: 'MALE', healthyVolunteers: false }, status: 'COMPLETED' }), { ageYears: 45, sex: 'female' });
  assert.equal(mixed.bucket, 'known_mismatch', 'unmet beats unknown');
});

// -----------------------------------------------------------------------------------------------
// Distance and nearest site: local and informational only
// -----------------------------------------------------------------------------------------------

test('[ported clinical.test.ts#6] distance is a soft travel preference, never a medical exclusion', () => {
  const byEquator = record({ locations: [{ city: 'Null Island Site', country: 'United States', geo: { lat: 0, lon: 0 } }] });
  const near = entry(byEquator, { ageYears: 45, sex: 'female', location: { lat: 0, lon: 1 }, travelRadiusMiles: 25 });
  assert.ok((near.distanceMiles ?? 0) > 69);
  assert.equal(near.outOfRadius, true);
  assert.equal(near.bucket, 'no_known_mismatch', 'out of radius does not change the bucket');
});

test('no shared location means distance is unknown, never zero', () => {
  assert.equal(entry(record(), {}).distanceMiles, null);
  assert.equal(entry(record(), {}).outOfRadius, false);
  const noGeo = record({ locations: [{ city: 'Somewhere', country: 'United States' }] });
  assert.equal(entry(noGeo, { location: { lat: 43.6, lon: -116.2 } }).distanceMiles, null);
});

test('nearestDistanceMiles takes the closest located site', () => {
  const r = record({
    locations: [
      { city: 'Distant site', country: 'United States', geo: { lat: 40.7, lon: -74 } },
      { city: 'Nearby site', country: 'United States', geo: { lat: 43.55, lon: -116.25 } },
    ],
  });
  const from = { lat: 43.6, lon: -116.2 };
  const d = nearestDistanceMiles(r, from);
  assert.ok(d !== undefined && d < 10, `distance ${d}`);
  assert.ok((d ?? 0) < haversineMiles(from, { lat: 40.7, lon: -74 }));
});

test('[ported nearestSite] the nearest site is chosen without reordering the record; fallbacks keep the first site', () => {
  const r = record({
    locations: [
      { city: 'No coordinates', country: 'United States' },
      { city: 'Distant site', country: 'United States', geo: { lat: 40.7, lon: -74 } },
      { city: 'Nearby site', country: 'United States', geo: { lat: 43.55, lon: -116.25 } },
    ],
  });
  assert.equal(nearestSite(r, undefined)?.city, 'No coordinates');
  const nearest = nearestSite(r, { lat: 43.6, lon: -116.2 });
  assert.equal(nearest?.city, 'Nearby site');
  assert.deepEqual(r.locations.map(l => l.city), ['No coordinates', 'Distant site', 'Nearby site'], 'the record was not reordered');
  const noneGeo = record({ locations: [{ city: 'Only site', country: 'United States' }] });
  assert.equal(nearestSite(noneGeo, { lat: 43.6, lon: -116.2 })?.city, 'Only site');
  assert.equal(nearestSite(record({ locations: [] }), { lat: 43.6, lon: -116.2 }), undefined);
});

// -----------------------------------------------------------------------------------------------
// rememberRecords: what the session will screen
// -----------------------------------------------------------------------------------------------

test('rememberRecords validates, rejects duplicates and oversized sets, and replaces the set', () => {
  const session = createSession(testPorts());
  const ids = ['NCT90000001', 'NCT90000002'];
  assert.equal(rememberRecords(session, ids.map(fakeRecord)).length, 2);
  assert.equal(session.get(STUDY_RECORDS)?.length, 2);
  assert.throws(() => rememberRecords(session, [...ids.map(fakeRecord), fakeRecord('NCT90000001')]), invalidRequest, 'duplicate nctId');
  const broken = { ...fakeRecord('NCT90000003'), title: '' };
  assert.throws(() => rememberRecords(session, [broken]), invalidRequest, 'schema-invalid record');
  assert.throws(
    () => rememberRecords(session, Array.from({ length: MAX_SESSION_RECORDS + 1 }, (_, i) => fakeRecord(`NCT${String(99900000 + i).slice(-8)}`))),
    inputTooLarge,
    'whole-registry dumps',
  );
  assert.equal(rememberRecords(session, [fakeRecord('NCT90000009')]).length, 1, 'a call replaces the remembered set');
  session.wipe();
  assert.equal(session.get(STUDY_RECORDS), undefined, 'wipe drops the slot');
});

// -----------------------------------------------------------------------------------------------
// End to end through the dispatcher
// -----------------------------------------------------------------------------------------------

test('screenLocal works through the dispatcher: session records, real ZIP table, structured result', async () => {
  const h = harness();
  okResult(await h.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }));
  const result = okResult<Record<string, any>>(await h.call('screenLocal', {
    nctIds: [...FICTIONAL_IDS.slice(0, 2)],
    profile: { ageYears: 45, sex: 'female', location: { zip: '83702' }, travelRadiusMiles: 25 },
  }));
  assert.equal(result.results.length, 2);
  const r = result.results[0];
  assert.equal(r.nctId, FICTIONAL_IDS[0]);
  assert.equal(r.bucket, 'no_known_mismatch');
  assert.deepEqual(r.checks, [
    { rule: 'age', status: 'met' },
    { rule: 'sex', status: 'met' },
    { rule: 'status', status: 'met' },
  ]);
  assert.ok(typeof r.distanceMiles === 'number' && r.distanceMiles > 0 && r.distanceMiles < 10, `distance ${r.distanceMiles}`);
  assert.equal(r.outOfRadius, false);
  assert.equal(r.stale, false);
});

test('an empty profile keeps everything unknown where the record states nothing', async () => {
  const h = harness();
  okResult(await h.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }));
  const result = okResult<Record<string, any>>(await h.call('screenLocal', { nctIds: [FICTIONAL_IDS[0]], profile: {} }));
  assert.deepEqual(result.results[0].checks.map((c: { status: string }) => c.status), ['unknown', 'unknown', 'met']);
  assert.equal(result.results[0].bucket, 'unknown');
  assert.equal(result.results[0].distanceMiles, null);
  assert.equal(result.results[0].outOfRadius, false);
});

test('screenLocal is session-scoped: unknown nctIds, no search, and wiped sessions are RECORD_NOT_IN_SESSION', async () => {
  const h = harness();
  assert.equal(errorCode(await h.call('screenLocal', { nctIds: [FICTIONAL_IDS[0]], profile: {} })), 'RECORD_NOT_IN_SESSION');
  okResult(await h.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }));
  assert.equal(errorCode(await h.call('screenLocal', { nctIds: ['NCT11111111'], profile: {} })), 'RECORD_NOT_IN_SESSION');
  okResult(await h.call('screenLocal', { nctIds: [FICTIONAL_IDS[0]], profile: {} }));
  okResult(await h.call('endSession', {}));
  assert.equal(errorCode(await h.call('screenLocal', { nctIds: [FICTIONAL_IDS[0]], profile: {} })), 'RECORD_NOT_IN_SESSION');
});

test('an unresolvable ZIP is a plain input error; direct coordinates and distance flags still work', async () => {
  const h = harness();
  okResult(await h.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }));
  assert.equal(errorCode(await h.call('screenLocal', { nctIds: [FICTIONAL_IDS[0]], profile: { location: { zip: '00000' } } })), 'INVALID_REQUEST');
  const direct = okResult<Record<string, any>>(await h.call('screenLocal', { nctIds: [FICTIONAL_IDS[0]], profile: { location: { lat: 43.61, lon: -116.2 } } }));
  assert.ok(typeof direct.results[0].distanceMiles === 'number' && direct.results[0].distanceMiles < 10);
  const far = okResult<Record<string, any>>(await h.call('screenLocal', {
    nctIds: [FICTIONAL_IDS[0]],
    profile: { ageYears: 45, location: { lat: 0, lon: 0 }, travelRadiusMiles: 250 },
  }));
  assert.ok(typeof far.results[0].distanceMiles === 'number' && far.results[0].distanceMiles > 2000);
  assert.equal(far.results[0].outOfRadius, true);
  assert.equal(far.results[0].bucket, 'unknown', 'out of radius with an unstated sex stays unknown, not a mismatch');
  assert.deepEqual(far.results[0].checks.map((c: { status: string }) => c.status), ['met', 'unknown', 'met']);
});

test('the ZIP table is loaded once per session and again after endSession', async () => {
  const bytes = new Uint8Array(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'zip-centroids.v1.json')));
  const base = testPorts({ 'zip-centroids.v1.json': bytes });
  let loads = 0;
  const counting: Loader = {
    async load(id, maxBytes, signal) {
      loads += 1;
      return base.loader.load(id, maxBytes, signal);
    },
  };
  const core = createCore({ ...base, loader: counting }, {
    mode: 'mocked',
    runtime: 'test',
    pipelines: {
      // Stand-in for A2: remembered records so the built-in screenLocal has something to screen.
      async searchTrials(ctx, payload) {
        ctx.session.setSubjectDigest('a'.repeat(64));
        const records = rememberRecords(ctx.session, [fakeRecord(FICTIONAL_IDS[0])]);
        return {
          records,
          retrievedAt: '2026-10-24T08:00:00.000Z',
          source: 'live',
          query: { conditionTerms: payload.conditionTerms, country: 'US' },
        } as never;
      },
    },
  });
  const call = (op: string, payload: unknown, id: string) => core.handle(req(op, payload, id));
  okResult(await call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }, 'q1'));
  okResult(await call('screenLocal', { nctIds: [FICTIONAL_IDS[0]], profile: { location: { zip: '83702' } } }, 's1'));
  okResult(await call('screenLocal', { nctIds: [FICTIONAL_IDS[0]], profile: { location: { zip: '02108' } } }, 's2'));
  assert.equal(loads, 1);
  okResult(await call('endSession', {}, 'end'));
  okResult(await call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }, 'q2'));
  okResult(await call('screenLocal', { nctIds: [FICTIONAL_IDS[0]], profile: { location: { zip: '83702' } } }, 's3'));
  assert.equal(loads, 2, 'a new session loads the table again');
});
