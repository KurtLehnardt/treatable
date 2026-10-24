// Mocked: no network. The session record index and the record rules the dispatcher enforces before
// any consent preparation (condition term, NCT IDs, and study objects bound to held records).
import test from 'node:test';
import assert from 'node:assert/strict';
import { utf8ByteLength } from '../src/bytes.ts';
import { CoreError } from '../src/errors.ts';
import { canonicalJson, jsonClone, type JsonObject } from '../src/json.ts';
import { buildPreview, buildRecordPreview, projectModelStudy, verifyPreviewAgainstRecords } from '../src/preview.ts';
import {
  MAX_MODEL_CRITERIA_BYTES,
  MAX_MODEL_STUDY_BYTES,
  MAX_MODEL_SUMMARY_BYTES,
  ModelStudySchema,
  StudyRecordSchema,
  type PreparedRealResult,
  type Preview,
  type StudyRecord,
} from '../src/protocol.ts';
import { MAX_SESSION_RECORDS, RECORD_SET_FORMAT, createRecordIndex, recordDigest, type RecordIndex } from '../src/records.ts';
import { nodeSha256 } from '../node/ports.node.ts';
import { sha256Hex } from './support/fakes.ts';
import { errorCode, fakeRecord, harness, okResult, receipt } from './support/harness.ts';
import { FICTIONAL_IDS, basePacket } from './support/preview.ts';

const isCode = (code: string) => (e: unknown) => e instanceof CoreError && e.code === code;

function record(nctId: string, overrides: Record<string, unknown> = {}): StudyRecord {
  return StudyRecordSchema.parse(fakeRecord(nctId, overrides));
}

function nct(n: number): string {
  return `NCT${String(80000000 + n).padStart(8, '0')}`;
}

async function merged(index: RecordIndex, records: readonly unknown[]): Promise<void> {
  (await index.prepareMerge(nodeSha256, records)).commit();
}

test('the index accumulates validated, frozen records and digests them in the record-set format', async () => {
  const index = createRecordIndex();
  assert.equal(index.digest, undefined);
  await merged(index, [record(FICTIONAL_IDS[1]), record(FICTIONAL_IDS[0])]);
  await merged(index, [record(FICTIONAL_IDS[2], { conditions: ['Asthma'], meshTerms: ['Asthma'] })]);
  assert.equal(index.size, 3);
  assert.deepEqual(index.nctIds(), [FICTIONAL_IDS[0], FICTIONAL_IDS[1], FICTIONAL_IDS[2]]);
  const held = index.get(FICTIONAL_IDS[0])!;
  assert.ok(Object.isFrozen(held) && Object.isFrozen(held.record) && Object.isFrozen(held.record.eligibility));
  assert.equal(held.digest, sha256Hex(canonicalJson(record(FICTIONAL_IDS[0]) as unknown as JsonObject)));
  assert.equal(held.digest, await recordDigest(nodeSha256, held.record));
  const expected = sha256Hex(
    canonicalJson({
      format: RECORD_SET_FORMAT,
      records: index.nctIds().map(id => [id, index.get(id)!.digest]),
    }),
  );
  assert.equal(index.digest, expected, 'set digest = sha256(canonical({format, records: [[nctId, recordDigest]...] sorted}))');
  // A record returned again replaces the held version; the digest follows the content.
  const before = index.digest;
  await merged(index, [record(FICTIONAL_IDS[0])]);
  assert.equal(index.digest, before, 'same version, same digest');
  await merged(index, [record(FICTIONAL_IDS[0], { summary: 'Changed upstream.' })]);
  assert.notEqual(index.digest, before);
  assert.equal(index.get(FICTIONAL_IDS[0])!.record.summary, 'Changed upstream.');
});

test('the view is read-only and the writer refuses invalid, duplicate, oversized, or stale merges', async () => {
  const index = createRecordIndex();
  const view = index.view;
  assert.ok(Object.isFrozen(view));
  for (const name of ['prepareMerge', 'clear', 'commit', 'set', 'delete']) assert.equal(name in view, false, name);
  await assert.rejects(index.prepareMerge(nodeSha256, [{ ...record(FICTIONAL_IDS[0]), contacts: 'x' }]), isCode('INTERNAL_ERROR'));
  await assert.rejects(index.prepareMerge(nodeSha256, [record(FICTIONAL_IDS[0]), record(FICTIONAL_IDS[0])]), isCode('INTERNAL_ERROR'));
  await assert.rejects(index.prepareMerge(nodeSha256, Array.from({ length: 101 }, (_v, i) => record(nct(i)))), isCode('INTERNAL_ERROR'));
  await assert.rejects(index.prepareMerge({ digestHex: () => 'nothex' }, [record(FICTIONAL_IDS[0])]), isCode('INTERNAL_ERROR'));
  const first = await index.prepareMerge(nodeSha256, [record(FICTIONAL_IDS[0])]);
  const second = await index.prepareMerge(nodeSha256, [record(FICTIONAL_IDS[1])]);
  first.commit();
  assert.throws(() => second.commit(), isCode('CANCELLED'), 'a merge prepared against an older index cannot commit');
  assert.deepEqual(view.nctIds(), [FICTIONAL_IDS[0]]);
  index.clear();
  assert.equal(view.size, 0);
  assert.equal(view.digest, undefined);
});

test('at most MAX_SESSION_RECORDS records are held; the oldest are evicted first', async () => {
  const index = createRecordIndex();
  for (let page = 0; page < 11; page += 1) {
    await merged(index, Array.from({ length: 25 }, (_v, i) => record(nct(page * 25 + i), { conditions: [`Fictional condition ${page}`] })));
  }
  assert.equal(index.size, MAX_SESSION_RECORDS);
  assert.equal(index.has(nct(0)), false, 'the first page is evicted');
  assert.equal(index.has(nct(24)), false);
  assert.equal(index.has(nct(25)), true);
  assert.equal(index.hasConditionTerm('Fictional condition 0'), false, 'terms of evicted records are gone');
  assert.equal(index.hasConditionTerm('Fictional condition 10'), true);
});

test('condition terms match byte for byte only: no case folding, trimming, or Unicode normalization', async () => {
  const index = createRecordIndex();
  await merged(index, [record(FICTIONAL_IDS[0], { conditions: ['Sjögren Syndrome'], meshTerms: ['Rhinitis, Allergic, Seasonal'] })]);
  assert.equal(index.hasConditionTerm('Sjögren Syndrome'), true);
  assert.equal(index.hasConditionTerm('Rhinitis, Allergic, Seasonal'), true, 'MeSH terms count');
  for (const variant of ['sjögren syndrome', 'Sjögren Syndrome ', ' Sjögren Syndrome', 'Sjo\u0308gren Syndrome', 'Sjogren Syndrome', 'Sjögren', '', 'Rhinitis', 42 as unknown as string]) {
    assert.equal(index.hasConditionTerm(variant), false, JSON.stringify(variant));
  }
});

test('projectModelStudy keeps the publicStudy fields, fits the byte budgets, and flags exactly when criteria were cut', () => {
  const plain = projectModelStudy(record(FICTIONAL_IDS[0]));
  assert.equal(ModelStudySchema.safeParse(plain).success, true);
  assert.deepEqual(Object.keys(plain).sort(), ['conditions', 'criteria', 'criteriaTruncated', 'id', 'lastUpdatePostDate', 'maximumAge', 'minimumAge', 'retrievedAt', 'sex', 'sourceUrl', 'status', 'summary', 'title']);
  assert.equal(plain.criteriaTruncated, false);
  assert.ok(!JSON.stringify(plain).includes('Fictional Study Team') && !JSON.stringify(plain).includes('Boise'), 'no contacts or locations');
  assert.deepEqual(projectModelStudy(record(FICTIONAL_IDS[0])), plain, 'deterministic');

  const long = record(FICTIONAL_IDS[1], {
    summary: 'Ünïcödé summary — "quoted" \\ text. '.repeat(400).slice(0, 9000),
    eligibility: { criteria: 'Inclusion Criteria:\n* naïve “dose”\t'.repeat(600).slice(0, 19000), minimumAge: '18 Years', maximumAge: null, sex: 'ALL', healthyVolunteers: false },
  });
  const projected = projectModelStudy(long);
  assert.equal(ModelStudySchema.safeParse(projected).success, true);
  assert.ok(utf8ByteLength(JSON.stringify(projected)) <= MAX_MODEL_STUDY_BYTES);
  assert.ok(utf8ByteLength(projected.summary) <= MAX_MODEL_SUMMARY_BYTES);
  assert.ok(utf8ByteLength(projected.criteria) <= MAX_MODEL_CRITERIA_BYTES);
  assert.equal(projected.criteriaTruncated, true);
  assert.ok(long.summary.startsWith(projected.summary) && long.eligibility.criteria.startsWith(projected.criteria), 'prefixes, never rewritten text');

  const shortCriteria = record(FICTIONAL_IDS[2], { summary: 'x'.repeat(9000), eligibility: { criteria: '', minimumAge: null, maximumAge: null, sex: 'ALL', healthyVolunteers: null } });
  assert.equal(projectModelStudy(shortCriteria).criteriaTruncated, false, 'empty criteria are not reported as cut');

  const crowded = record(FICTIONAL_IDS[3], { title: 'T'.repeat(600), conditions: Array.from({ length: 50 }, (_v, i) => `Fictional condition number ${i} `.padEnd(299, 'é')) });
  assert.throws(() => projectModelStudy(crowded), isCode('PREVIEW_TOO_LARGE'), 'conditions are never dropped silently to make room');
});

async function preparedWith(h: ReturnType<typeof harness>, packet: unknown) {
  okResult(await h.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }));
  return h.call('prepareReal', { packet, policyReceipt: receipt });
}

test('prepareReal refuses a condition term that is not a term on a held record, before any preparation', async () => {
  for (const conditionTerm of [
    'stage 3 cancer, John Smith, 3 days of chest pain',
    'seasonal allergic rhinitis',
    'Seasonal Allergic Rhinitis ',
    'Seasonal Allergic Rhinitis, worse at night',
    'Asthma',
  ]) {
    const h = harness();
    const response = await preparedWith(h, basePacket({ conditionTerm }));
    assert.equal(errorCode(response), 'CONDITION_TERM_NOT_IN_SESSION', conditionTerm);
    assert.equal(okResult<Record<string, any>>(await h.call('status', {})).session.prepared, false);
    assert.ok(!JSON.stringify(response).includes(conditionTerm), 'the term is not echoed');
  }
  const h = harness();
  const mesh = okResult<PreparedRealResult>(await preparedWith(h, basePacket({ conditionTerm: 'Rhinitis, Allergic, Seasonal' })));
  assert.equal(mesh.preview.packet.conditionTerm, 'Rhinitis, Allergic, Seasonal', 'a MeSH term of a held record is accepted');
});

test('prepareReal refuses NCT IDs that are not held records, for scoring and for the agent', async () => {
  for (const packet of [
    basePacket({ scoreNctIds: [FICTIONAL_IDS[0], FICTIONAL_IDS[7]] }),
    basePacket({ agentNctIds: [FICTIONAL_IDS[8]] }),
    basePacket({ scoreNctIds: undefined, agentNctIds: [FICTIONAL_IDS[0], 'NCT00000001'] }),
  ]) {
    const h = harness();
    assert.equal(errorCode(await preparedWith(h, packet)), 'RECORD_NOT_IN_SESSION');
    assert.equal(okResult<Record<string, any>>(await h.call('status', {})).session.prepared, false);
  }
  const empty = harness();
  assert.equal(errorCode(await empty.call('prepareReal', { packet: basePacket(), policyReceipt: receipt })), 'RECORD_NOT_IN_SESSION', 'no records held at all');
});

test('every study object in a prepared preview is the core projection of the held record', async () => {
  const longSummary = 'A long fictional public summary. '.repeat(200);
  const h = harness({ records: id => fakeRecord(id, { summary: longSummary }) });
  const p = okResult<PreparedRealResult>(await preparedWith(h, basePacket()));
  const expected = (id: string) => projectModelStudy(StudyRecordSchema.parse(fakeRecord(id, { summary: longSummary })));
  p.preview.decisionsRequests.forEach((body, i) => assert.deepEqual(body.input[0].content[1].data.study, expected(basePacket().scoreNctIds![i]!)));
  p.preview.toolResults.forEach((result, i) => assert.deepEqual(result.study, expected(basePacket().agentNctIds![i]!)));
  assert.ok(p.preview.toolResults[0]!.study.summary.length < longSummary.length, 'the projection cut the summary');
});

test('verifyPreviewAgainstRecords rejects any study object that differs from the projection of its held record', async () => {
  const index = createRecordIndex();
  await merged(index, [record(FICTIONAL_IDS[0]), record(FICTIONAL_IDS[1]), record(FICTIONAL_IDS[2])]);
  const good = buildRecordPreview(basePacket(), index.view);
  assert.deepEqual(verifyPreviewAgainstRecords(good, index.view), good);
  const clone = () => jsonClone(good as unknown as JsonObject) as unknown as Preview;
  const edits: [string, (p: Preview) => void][] = [
    ['summary changed', p => (p.decisionsRequests[0]!.input[0].content[1].data.study.summary = 'Invented summary.')],
    ['criteriaTruncated flipped', p => (p.decisionsRequests[1]!.input[0].content[1].data.study.criteriaTruncated = true)],
    ['condition added', p => p.toolResults[0]!.study.conditions.push('Fictional extra condition')],
    ['title changed in tool result', p => (p.toolResults[1]!.study.title = 'Another title')],
    ['retrievedAt changed', p => (p.toolResults[1]!.study.retrievedAt = '2026-10-25T00:00:00.000Z')],
    ['study swapped between bodies', p => {
      const swapped = buildPreview(basePacket({ scoreNctIds: [FICTIONAL_IDS[0], FICTIONAL_IDS[1]] }), id => projectModelStudy(record(id === FICTIONAL_IDS[0] ? FICTIONAL_IDS[0] : FICTIONAL_IDS[1], { title: `Fictional study ${id} (older version)` })));
      p.decisionsRequests[0] = swapped.decisionsRequests[0]!;
    }],
  ];
  for (const [name, edit] of edits) {
    const p = clone();
    edit(p);
    assert.throws(() => verifyPreviewAgainstRecords(p, index.view), isCode('INTERNAL_ERROR'), name);
  }
  const notHeld = buildPreview(basePacket({ scoreNctIds: [FICTIONAL_IDS[5]], agentNctIds: undefined }), id => projectModelStudy(record(id)));
  assert.throws(() => verifyPreviewAgainstRecords(notHeld, index.view), isCode('RECORD_NOT_IN_SESSION'), 'a correct projection of a record the session does not hold');
  const freeText = buildPreview(basePacket({ conditionTerm: 'my own words', agentNctIds: undefined }), id => projectModelStudy(record(id)));
  assert.throws(() => verifyPreviewAgainstRecords(freeText, index.view), isCode('CONDITION_TERM_NOT_IN_SESSION'));
});

test('screenLocal screens only held records and its pipeline receives no transport', async () => {
  let seen: unknown;
  const h = harness({
    pipelines: {
      async screenLocal(ctx, payload) {
        seen = ctx;
        return { results: payload.nctIds.map(nctId => ({ nctId, bucket: 'unknown' as const, checks: [], distanceMiles: null, radiusStatus: 'not_set' as const, outOfRadius: false, stale: false })) };
      },
    },
  });
  assert.equal(errorCode(await h.call('screenLocal', { nctIds: [FICTIONAL_IDS[0]], profile: { ageYears: 41 } })), 'RECORD_NOT_IN_SESSION');
  assert.equal(seen, undefined, 'the pipeline did not run');
  okResult(await h.call('searchTrials', { conditionTerms: ['seasonal allergic rhinitis'] }));
  assert.equal(errorCode(await h.call('screenLocal', { nctIds: [FICTIONAL_IDS[0], FICTIONAL_IDS[9]], profile: {} })), 'RECORD_NOT_IN_SESSION');
  okResult(await h.call('screenLocal', { nctIds: [FICTIONAL_IDS[0]], profile: { ageYears: 41, location: { zip: '83702' } } }));
  const ctx = seen as unknown as Record<string, any>;
  assert.deepEqual(Object.keys(ctx).sort(), ['mode', 'ports', 'records', 'requestId', 'signal', 'slots']);
  assert.deepEqual(Object.keys(ctx.ports).sort(), ['clock', 'loader', 'sha256', 'tokens'], 'no transport for local screening');
  assert.equal('session' in ctx || 'consent' in ctx, false);
  assert.equal(ctx.records.has(FICTIONAL_IDS[0]), true);
  assert.equal(typeof ctx.records.prepareMerge, 'undefined', 'read-only view');
});
