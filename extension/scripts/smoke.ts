/**
 * Live smoke test against the real OpenAI API with a SYNTHETIC profile.
 * Usage: OPENAI_API_KEY=... npx tsx scripts/smoke.ts ["condition"] [age] [sex]
 * Prints scores and the agent checklist. Never prints the key or request headers.
 */
import {readFileSync} from 'node:fs';
import {StudySchema, profileFromForm, type Study} from '../src/core';
import {OpenAIProvider} from '../src/openai';
import {runPipeline, countLine, emptyMessage} from '../src/pipeline';

const root = new URL('../../scaffold/data/', import.meta.url);
const studies: Study[] = JSON.parse(readFileSync(new URL('studies.json', root), 'utf8')).map((x: unknown) => StudySchema.parse(x));
const zips = JSON.parse(readFileSync(new URL('us-zip-centroids.json', root), 'utf8'));
const [condition = 'thoracic degenerative disc disease', age = '40', sex = 'male'] = process.argv.slice(2);
const profile = profileFromForm({condition, notes: '', age, sex, zip: '', radius: 'anywhere'}, zips);
const apiKey = process.env.OPENAI_API_KEY || '';
if (!apiKey) { console.log('No OPENAI_API_KEY in the environment; live smoke test skipped.'); process.exit(0); }
const provider = new OpenAIProvider({apiKey, consented: true});
console.log(`Synthetic example profile: ${condition}, ${sex}, ${age}`);
const t0 = Date.now();
const result = await runPipeline({studies, profile, provider});
console.log(`mode=${result.mode} shortlist=${result.shortlistCount} excluded=${result.excludedCount} ${Date.now() - t0}ms${result.failure ? ' failure=' + result.failure : ''}`);
for (const min of [80, 65, 50] as const) console.log(`[min ${min}] ${countLine(result, min)} ${emptyMessage(result, min) || ''}`);
const show = (label: string, list: typeof result.studies) => {
  console.log(`\n${label} (${list.length})`);
  for (const s of list.slice(0, 10)) {
    const a = s.providerResult?.answers;
    console.log(`  ${s.screen.study.id} final=${s.breakdown.final} tier=${s.breakdown.tier} model=${s.breakdown.modelScore ?? '-'} region=${s.screen.region.status} ${a ? `cond=${a.condition_match.choice}(${a.condition_match.confidence.toFixed(2)}) site=${a.site_match.choice} fitconf=${a.fit_score.confidence.toFixed(2)} agesex=${a.age_sex_compatible.probability.toFixed(2)}` : 'unrefined'} | ${s.screen.study.briefTitle.slice(0, 70)}`);
  }
};
show('Main list', result.studies);
show('Related research you likely do not qualify for', result.nearMiss);
const target = result.studies[0] || result.nearMiss[0];
if (target) {
  const t1 = Date.now();
  try {
    const c = await provider.checklist(target.evidence);
    console.log(`\nAgent checklist for ${target.screen.study.id} (${c.model}, ${Date.now() - t1}ms, dropped citations: ${c.checklist.droppedCitations})`);
    for (const item of c.checklist.items) console.log(`  [${item.patient_status}] ${item.criterion} <- "${item.source_quote.slice(0, 100)}"`);
    for (const q of c.checklist.questions_for_study_team) console.log(`  Q: ${q}`);
  } catch (e) { console.log('Agent task failed:', e instanceof Error ? e.message : e); }
}
