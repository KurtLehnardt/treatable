// Integrity verification only. No network, credentials or native-host access.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base=new URL('./',import.meta.url),read=async n=>JSON.parse(await readFile(new URL(n,base),'utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const [spec,records,live,results,manifest]=await Promise.all(['predeclared.json','public-records.json','live-results.json','results.json','sha256.json'].map(read));
for(const [file,digest]of Object.entries(manifest))assert.equal(sha(await readFile(new URL(file,base))),digest,`Artifact changed: ${file}`);
assert.equal(sha(await readFile(new URL('public-records.json',base))),spec.publicArtifactSha256);
assert.equal(sha(await readFile(new URL('synthetic.json',base))),spec.syntheticArtifactSha256);
for(const record of records.records)assert.equal(sha(JSON.stringify(record.raw)),record.sha256);
assert.equal(live.authenticatedRequestsAttempted,3);assert.equal(live.completed,3);assert.equal(live.agentsRequests,0);
assert.equal(results.profiles.filter(p=>p.strictInputParity).length,2);
for(const p of spec.profiles){
 const request=await read(`${p.id}-request.json`),data=request.input[0].content.find(c=>c.type==='input_json').data;
 assert.equal(request.model,'gpt-6-luna');assert.deepEqual(request.questions.map(q=>q.name),spec.ids);
 const expected={ageBand:p.ageBand,...(p.sex?{sex:p.sex}:{}),...(p.state?{state:p.state}:{}),conditions:p.conditions};assert.deepEqual(data.profile,expected);
 for(const study of data.publicStudies){const frozen=records.records.find(r=>r.id===study.id).normalized;for(const field of ['title','conditions','summary','criteria','countries'])assert.deepEqual(study.untrusted_public_record_text[field],frozen[field]);}
 const measured=live.results.find(r=>r.profileId===p.id);assert.equal(measured.requestSha256,sha(JSON.stringify(request)));assert.deepEqual(measured.scores.map(s=>s.nctId).sort(),[...spec.ids].sort());
 for(const s of measured.scores){assert.ok(s.index>=0&&s.index<=100);assert.ok(s.confidence>=0&&s.confidence<=1);}
}
assert.equal(results.synthetic.passed,22);assert.equal(results.synthetic.evaluated,23);assert.equal(results.synthetic.invalidAssertions,1);assert.equal(results.synthetic.supplementalUSSiteProbe.pass,true);
assert.equal(results.safety.falseEligibilityBuckets,0);assert.equal(results.safety.falseExclusions,0);
console.log('PASS: artifact SHA integrity, public record hashes, exact previews, 3 bounded score requests, 2 strict pairs, and reported synthetic counts. No network calls.');
