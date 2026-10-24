import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {StudySchema, profileFromForm, type Study} from '../src/core';
import {runPipeline} from '../src/pipeline';

// Golden set: synthetic example profiles only. Runs Stages 1-2 (no network).
const studies = JSON.parse(readFileSync(new URL('../../scaffold/data/studies.json', import.meta.url), 'utf8')).map((x: unknown) => StudySchema.parse(x)) as Study[];
const zips = JSON.parse(readFileSync(new URL('../../scaffold/data/us-zip-centroids.json', import.meta.url), 'utf8'));
const cases = readFileSync(new URL('../evals/golden-set.jsonl', import.meta.url), 'utf8').trim().split('\n').map(line => JSON.parse(line));

for (const c of cases) {
  test(`golden set (unrefined): ${c.name}`, async () => {
    assert.equal(c.synthetic, true);
    const profile = profileFromForm({condition: c.profile.condition, notes: '', age: c.profile.age, sex: c.profile.sex, zip: '', radius: 'anywhere'}, zips);
    const result = await runPipeline({studies, profile});
    const main = result.studies.map(s => s.screen.study.id), near = result.nearMiss.map(s => s.screen.study.id), all = [...main, ...near];
    const e = c.expect;
    if (e.total !== undefined) assert.equal(all.length, e.total);
    if (e.max_score_in_main !== undefined) assert.ok(result.studies.every(s => s.breakdown.final <= e.max_score_in_main));
    for (const id of e.main_should_appear || []) assert.ok(main.includes(id), `${id} should appear`);
    for (const id of e.main_should_not_appear || []) assert.ok(!main.includes(id), `${id} should not be in the main list`);
    for (const id of e.near_miss_should_include || []) assert.ok(near.includes(id), `${id} should be a near miss`);
    for (const id of e.should_not_appear_anywhere || []) assert.ok(!all.includes(id), `${id} should not appear`);
    assert.ok(result.studies.every(s => s.breakdown.final <= 79), 'unrefined never reaches Strong');
  });
}
