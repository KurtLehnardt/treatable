// Explicit opt-in: this script can spend at most three Decisions requests. It never retries.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {parseLiveReply,LIVE_POLICY_VERSION} from '../../extension/shared/live-analysis-contract.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const sha=v=>createHash('sha256').update(v).digest('hex');
const read=name=>readFile(path.join(dir,name),'utf8').then(JSON.parse);
const PREDECLARATION='4a31b36';
const spec=await read('predeclared.json'),frozen=await read('public-records.json');
assert.equal(sha(await readFile(path.join(dir,'public-records.json'))),spec.publicArtifactSha256);
assert.equal(sha(await readFile(path.join(dir,'synthetic.json'))),spec.syntheticArtifactSha256);
for(const name of ['predeclared.json','public-records.json','synthetic.json'])assert.equal(sha(await readFile(path.join(dir,name))),sha(execFileSync('git',['show',`${PREDECLARATION}:evals/basic-comparison/${name}`],{cwd:dir})));
if(process.argv[2]!=='--execute-authorized')throw Error('Live requests require explicit --execute-authorized and human authorization. Default analysis is offline.');
const outputPath=path.join(dir,'live-results.json');
const output={predeclarationCommit:PREDECLARATION,startedAt:new Date().toISOString(),authenticatedRequestsAttempted:0,completed:0,agentsRequests:0,results:[],cost:null,costReason:'Actual usage/cost are not exposed by the production native protocol.'};
// Exclusive creation also prevents accidental second execution against the same evaluation.
await writeFile(outputPath,JSON.stringify(output,null,2)+'\n',{flag:'wx'});
const installed=path.join(os.homedir(),'Library/Application Support/Treatable/native-host/native');
for(const f of ['live-evidence.mjs','live.mjs','provider.mjs'])assert.equal(sha(await readFile(path.join(installed,f))),spec.sourceHashes['extension/native/'+f],'Installed source differs from predeclared source');
const config=JSON.parse(await readFile(path.join(installed,'config.json'),'utf8'));
const child=spawn(process.execPath,[path.join(installed,'host.mjs'),`chrome-extension://${config.extensionId}/`],{stdio:['pipe','pipe','pipe'],env:{HOME:os.homedir(),PATH:'/usr/bin:/bin'}});
let buffer=Buffer.alloc(0),next=0;const pending=new Map();let nativeStderr=false;
child.stderr.on('data',()=>{nativeStderr=true});
child.stdout.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4&&buffer.length>=4+buffer.readUInt32LE(0)){const size=buffer.readUInt32LE(0);const raw=JSON.parse(buffer.subarray(4,4+size));buffer=buffer.subarray(4+size);const item=pending.get(raw.id);if(!item)continue;if(raw.type==='trace'){if(raw.trace?.stage==='decisions.request')item.requestObserved=true;continue;}pending.delete(raw.id);clearTimeout(item.timer);item.resolve({raw,requestObserved:item.requestObserved});}});
child.on('exit',()=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('NATIVE_EXIT'));}pending.clear();});
const send=(type,payload)=>new Promise((resolve,reject)=>{const id=`eval-${++next}-${randomUUID()}`;const body=Buffer.from(JSON.stringify({id,type,payload})),header=Buffer.alloc(4);header.writeUInt32LE(body.length);const timer=setTimeout(()=>{pending.delete(id);reject(Error('NATIVE_TIMEOUT'));child.kill();},40000);pending.set(id,{resolve,reject,timer});child.stdin.write(Buffer.concat([header,body]));});
const request=async(type,payload)=>{const x=await send(type,payload);if(!x.raw.ok){const code=/^[A-Z_]{1,40}$/.test(x.raw.code)?x.raw.code:'INVALID_NATIVE_REPLY';throw Error(code);}if(type!=='status')parseLiveReply(x.raw,x.raw.id);return x.raw.result??x.raw;};
const normalizeTime=s=>({...s,fetchedAt:0});
const persist=()=>writeFile(outputPath,JSON.stringify(output,null,2)+'\n');
try{
 const status=await request('status',{});assert.equal(status.configured,true,'KEY_MISSING');
 const source={generation:'predeclared-basic-comparison',queryKey:sha(JSON.stringify(spec.ids))};
 const catalog=await request('liveCatalog',{nctIds:spec.ids,source});
 assert.deepEqual(catalog.studies.map(normalizeTime),frozen.records.map(r=>normalizeTime(r.normalized)),'FROZEN_PUBLIC_RECORD_MISMATCH');
 output.catalogFetchedAt=catalog.fetchedAt;output.catalogContentSha256=sha(JSON.stringify(catalog.studies.map(normalizeTime)));await persist();
 for(const profile of spec.profiles){
  const packet={ageBand:profile.ageBand,...(profile.sex?{sex:profile.sex}:{}),...(profile.state?{state:profile.state}:{}),conditionIds:profile.conditions.map(label=>{const c=catalog.conditions.find(c=>c.label===label);assert.ok(c,'PUBLIC_CONDITION_MISSING');return c.id;}),selectedNctIds:spec.ids,agentNctIds:spec.ids.slice(0,1)};
  const policyReceipt={policyVersion:LIVE_POLICY_VERSION,accepted:true};
  const prepared=await request('prepareLive',{snapshotId:catalog.snapshotId,source,packet,policyReceipt});
  const requestBody=prepared.preview.decisionsRequest;
  assert.equal(requestBody.model,'gpt-6-luna');assert.deepEqual(requestBody.questions.map(q=>q.name),spec.ids);
  const data=requestBody.input[0].content.find(c=>c.type==='input_json').data;
  const expectedProfile={ageBand:profile.ageBand,...(profile.sex?{sex:profile.sex}:{}),...(profile.state?{state:profile.state}:{}),conditions:profile.conditions};
  assert.deepEqual(data.profile,expectedProfile);assert.deepEqual(data.publicStudies.map(s=>s.id),spec.ids);
  assert.deepEqual(prepared.preview.packet,packet);
  // Public evidence + invented minimized profile only. Opaque consent token and all credentials remain in memory.
  await writeFile(path.join(dir,profile.id+'-request.json'),JSON.stringify(requestBody,null,2)+'\n');
  output.authenticatedRequestsAttempted++;await persist();const start=performance.now();
  const result=await request('executeLive',{token:prepared.token,digest:prepared.digest,operation:'score',policyReceipt});
  assert.equal(result.kind,'scoreLive');assert.equal(result.mode,'live');assert.equal(result.analysisId,prepared.analysisId);assert.equal(result.snapshotId,catalog.snapshotId);assert.equal(result.profileKey,prepared.profileKey);assert.equal(result.consentDigest,prepared.digest);assert.deepEqual(result.source,source);assert.deepEqual(result.scores.map(s=>s.nctId).sort(),[...spec.ids].sort());
  output.results.push({profileId:profile.id,latencyMs:performance.now()-start,requestSha256:sha(JSON.stringify(requestBody)),scores:result.scores});output.completed++;await persist();
  console.log(JSON.stringify({profileId:profile.id,completed:true,authenticatedRequestsAttempted:output.authenticatedRequestsAttempted}));
 }
 await request('revokeLive',{});
}catch(error){output.failure={code:/^[A-Z_]{1,60}$/.test(error.message)?error.message:'LOCAL_VALIDATION_FAILED',nativeStderr};await persist();console.log(JSON.stringify({stopped:true,...output.failure,authenticatedRequestsAttempted:output.authenticatedRequestsAttempted,completed:output.completed}));process.exitCode=1;
}finally{child.stdin.end();child.kill();output.finishedAt=new Date().toISOString();await persist();}
