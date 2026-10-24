// Live current-page path (liveCatalog/prepareLive/executeLive): consent lifecycle parity with the snapshot path's pen-test fixes.
import test,{mock}from'node:test';import assert from'node:assert/strict';import{rm}from'node:fs/promises';
import{LiveEvidenceStore}from'../live-evidence.mjs';import{PreparedLiveStore}from'../live.mjs';
import{LIVE_SNAPSHOT_TTL_MS}from'../../shared/live-analysis-contract.mjs';import{REAL_POLICY_VERSION}from'../../shared/real-contract.mjs';
import{installHost,writeHook,startHost,readLines}from'./host-harness.mjs';
import{PUBLIC_CONDITIONS,PUBLIC_STUDY_IDS}from'../../shared/public-catalog.mjs';
const ids=['NCT99999900','NCT99999901'],source={generation:'generation_lifecycle',queryKey:'b'.repeat(64)},receipt={accepted:true,policyVersion:REAL_POLICY_VERSION};
const record=nctId=>({hasResults:false,protocolSection:{identificationModule:{nctId,briefTitle:'Fictional public study'},statusModule:{overallStatus:'RECRUITING'},conditionsModule:{conditions:['Fictional condition']},descriptionModule:{briefSummary:'Public summary'},eligibilityModule:{eligibilityCriteria:'Public criteria',minimumAge:'18 Years',sex:'ALL',healthyVolunteers:false}}});
const livePacket=c=>({ageBand:'45_59',conditionIds:[c.conditions[0].id],selectedNctIds:c.studies.map(s=>s.id),agentNctIds:[c.studies[0].id]});
const execute=(p,operation='score')=>({token:p.token,digest:p.digest,operation,policyReceipt:receipt});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const openai=async log=>(await readLines(log)).filter(x=>x.host==='api.openai.com').map(x=>x.method+' '+x.path);
async function withHost(prefix,config,body){const installed=await installHost(prefix);let host;try{host=startHost(installed,{hook:await writeHook(installed.home,{log:installed.log,...config})});await body(host,installed);host.child.stdin.end();await host.exit;host=undefined;}finally{host?.child.kill('SIGKILL');await rm(installed.home,{recursive:true,force:true});}}
async function preparedLive(host,suffix=''){const c=(await host.call({id:'cat'+suffix,type:'liveCatalog',payload:{nctIds:ids,source}})).result;assert.equal(c?.kind,'liveCatalog');const p=(await host.call({id:'prep'+suffix,type:'prepareLive',payload:{snapshotId:c.snapshotId,source,packet:livePacket(c),policyReceipt:receipt}})).result;assert.equal(p?.kind,'preparedLive');return p;}

// Pen-test M3 on the live path: token/snapshot expiry must never abort an executeLive that already started.
test('live token and snapshot expiry only block take(); only explicit clear/revoke invalidates running live sends',async()=>{
 mock.timers.enable({apis:['setTimeout']});let evidenceInvalidations=0,liveInvalidations=0,prepared;
 const evidence=new LiveEvidenceStore({fetchRecord:async id=>record(id),onInvalidate:()=>{evidenceInvalidations++;prepared?.clear();}});prepared=new PreparedLiveStore(evidence,{onInvalidate:()=>liveInvalidations++});
 const fresh=async()=>{const c=await evidence.catalog(ids,source);evidenceInvalidations=0;liveInvalidations=0;return prepared.prepare({snapshotId:c.snapshotId,source,packet:livePacket(c),policyReceipt:receipt});};
 try{
  const p=await fresh();assert.equal(prepared.take(execute(p)).consentDigest,p.digest);
  mock.timers.tick(LIVE_SNAPSHOT_TTL_MS);assert.equal(liveInvalidations,0,'token expiry must not abort a live send that already started');assert.equal(evidenceInvalidations,0,'snapshot expiry must not abort it either');
  assert.throws(()=>prepared.take(execute(p,'agent')),{code:'CONSENT_EXPIRED'});assert.throws(()=>evidence.get(p.snapshotId,source),{code:'LIVE_SNAPSHOT_EXPIRED'});assert.equal(liveInvalidations+evidenceInvalidations,0);
  const p2=await fresh();prepared.discard();evidence.discard();assert.equal(liveInvalidations+evidenceInvalidations,0);assert.throws(()=>prepared.take(execute(p2)),{code:'CONSENT_EXPIRED'});
  const p3=await fresh();prepared.revoke(p3.token);assert.equal(liveInvalidations,1);
  await fresh();evidence.clear();assert.equal(evidenceInvalidations,1);assert.equal(liveInvalidations,1);
 }finally{mock.timers.reset();prepared.discard();evidence.discard();}
 let time=0;const clocked=new LiveEvidenceStore({now:()=>time,fetchRecord:async id=>record(id),onInvalidate:()=>evidenceInvalidations++}),store=new PreparedLiveStore(clocked,{now:()=>time,onInvalidate:()=>liveInvalidations++});try{
  const c=await clocked.catalog(ids,source);evidenceInvalidations=0;liveInvalidations=0;const p=store.prepare({snapshotId:c.snapshotId,source,packet:livePacket(c),policyReceipt:receipt});time+=LIVE_SNAPSHOT_TTL_MS+1;
  assert.throws(()=>store.take(execute(p)),{code:'CONSENT_EXPIRED'});assert.throws(()=>clocked.get(c.snapshotId,source),{code:'LIVE_SNAPSHOT_EXPIRED'});assert.equal(liveInvalidations+evidenceInvalidations,0);
 }finally{store.discard();clocked.discard();}
});
test('stdio: a consented live send in flight when its token and snapshot expire completes; expiry blocks only the next send; revoke still aborts',async()=>{
 await withHost('treatable-live-ttl-',{ttl:300,delay:1000},async(host,{log})=>{
  const p=await preparedLive(host);
  const scored=await host.call({id:'exec',type:'executeLive',payload:execute(p)});assert.equal(scored.ok,true,scored.code);assert.equal(scored.result.kind,'scoreLive');assert.equal(scored.result.analysisId,p.analysisId);
  assert.ok(!host.frames.some(m=>m.id==='exec'&&m.trace?.stage==='cancelled'));
  assert.equal((await host.call({id:'late',type:'executeLive',payload:execute(p,'agent')})).code,'CONSENT_EXPIRED');
  assert.deepEqual(await openai(log),['POST /v1/decisions']);
  // Explicit revocation of the live preview still aborts a live send that is running.
  const p2=await preparedLive(host,'2');host.send({id:'exec2',type:'executeLive',payload:execute(p2)});await sleep(100);
  assert.equal((await host.call({id:'revoke2',type:'revokeLive',payload:{token:p2.token}})).ok,true);assert.equal((await host.result('exec2')).code,'CANCELLED');
  assert.equal(host.stderr(),'');
 });
});
// Pen-test L1 on the live path: Stop/invalid frames for the fictional demo or the snapshot path must not clear a prepared live token.
test('stdio: demo and snapshot-path cancels or invalid frames keep the live token; live cancels and invalid live input discard it',async()=>{
 await withHost('treatable-live-scope-',{delay:400},async(host,{log})=>{
  let p=await preparedLive(host);
  host.send({id:'demo',type:'scoreDemo',payload:{fixtureId:'fibromyalgia',consent:true}});await sleep(100);
  assert.equal((await host.call({id:'stop',type:'cancel',payload:{requestId:'demo'}})).ok,true);assert.equal((await host.result('demo')).code,'CANCELLED');
  for(const bad of [{id:'b1',type:'scoreDemo',payload:{fixtureId:'fibromyalgia',consent:true,notes:'x'}},{id:'b2',type:'executeReal',payload:{token:'x',digest:'y',operation:'score'}},{id:'b3',type:'prepareReal',payload:{packet:{ageBand:'45_59',notes:'PRIVATE_SENTINEL'}}},{id:'b4',type:'revokeReal',payload:{token:7}},{id:'b5',type:'cancel',payload:{requestId:7}},{id:'stop',type:'status',payload:{}}])assert.equal((await host.call(bad)).code,'INVALID_REQUEST');
  assert.equal((await host.call({id:'rr',type:'revokeReal',payload:{}})).ok,true);assert.equal((await host.call({id:'cr',type:'cancel',payload:{requestId:'rr'}})).ok,true);
  assert.equal((await host.call({id:'er',type:'executeReal',payload:{token:'A'.repeat(43),digest:'a'.repeat(64),operation:'score',policyReceipt:receipt}})).code,'CONSENT_EXPIRED');
  // A running live send survives invalid demo/snapshot frames, and the token still starts the agent operation afterwards.
  host.send({id:'live1',type:'executeLive',payload:execute(p)});await sleep(100);
  for(const bad of [{id:'d1',type:'agentDemo',payload:{fixtureId:'x'}},{id:'d2',type:'executeReal',payload:{notes:'x'}}])assert.equal((await host.call(bad)).code,'INVALID_REQUEST');
  const scored=await host.result('live1');assert.equal(scored.ok,true,scored.code);assert.ok(!host.frames.some(m=>m.id==='live1'&&m.trace?.stage==='cancelled'));
  const planned=await host.call({id:'live2',type:'executeLive',payload:execute(p,'agent')});assert.equal(planned.ok,true,planned.code);assert.equal(planned.result.kind,'agentLive');
  // Malformed live input fails closed for the live token without aborting the live send that already started.
  p=await preparedLive(host,'b');host.send({id:'live3',type:'executeLive',payload:execute(p)});await sleep(100);
  assert.equal((await host.call({id:'badlive',type:'executeLive',payload:{...execute(p,'agent'),notes:'PRIVATE_SENTINEL'}})).code,'INVALID_REQUEST');
  assert.equal((await host.result('live3')).ok,true);assert.equal((await host.call({id:'live4',type:'executeLive',payload:execute(p,'agent')})).code,'CONSENT_EXPIRED');
  // Cancelling a live send aborts it and revokes the live token.
  p=await preparedLive(host,'c');host.send({id:'live5',type:'executeLive',payload:execute(p)});await sleep(100);
  assert.equal((await host.call({id:'stop5',type:'cancel',payload:{requestId:'live5'}})).ok,true);assert.equal((await host.result('live5')).code,'CANCELLED');
  assert.equal((await host.call({id:'live6',type:'executeLive',payload:execute(p,'agent')})).code,'CONSENT_EXPIRED');
  assert.ok(!JSON.stringify(await readLines(log)).includes('PRIVATE_SENTINEL'));assert.equal(host.stderr(),'');
 });
});
test('stdio: live cancels, failed or invalid live requests and revokeLive keep the snapshot preview and never abort a running snapshot send',async()=>{
 await withHost('treatable-live-scope2-',{delay:400,govDelay:400},async(host)=>{
  const realPacket={ageBand:'45_59',conditionIds:[PUBLIC_CONDITIONS[0].id],selectedNctIds:[PUBLIC_STUDY_IDS[3]]};
  const r=(await host.call({id:'rp',type:'prepareReal',payload:{packet:realPacket,policyReceipt:receipt}})).result;assert.equal(r?.kind,'preparedReal');
  host.send({id:'cat',type:'liveCatalog',payload:{nctIds:ids,source}});await sleep(100);
  assert.equal((await host.call({id:'stopcat',type:'cancel',payload:{requestId:'cat'}})).ok,true);assert.equal((await host.result('cat')).code,'CANCELLED');
  for(const bad of [{id:'l1',type:'executeLive',payload:{token:'x'}},{id:'l2',type:'liveCatalog',payload:{nctIds:['bad'],source}},{id:'l3',type:'prepareLive',payload:{snapshotId:'a'.repeat(64),source,packet:{ageBand:'45_59',notes:'PRIVATE_SENTINEL'},policyReceipt:receipt}},{id:'l4',type:'revokeLive',payload:{token:7}}])assert.equal((await host.call(bad)).code,'INVALID_REQUEST');
  assert.equal((await host.call({id:'l5',type:'prepareLive',payload:{snapshotId:'a'.repeat(64),source,packet:{ageBand:'45_59',conditionIds:['lc_'+'a'.repeat(64)],selectedNctIds:ids,agentNctIds:[ids[0]]},policyReceipt:receipt}})).code,'LIVE_SNAPSHOT_EXPIRED');
  assert.equal((await host.call({id:'l6',type:'revokeLive',payload:{}})).ok,true);assert.equal((await host.call({id:'l7',type:'cancel',payload:{requestId:'l6'}})).ok,true);
  host.send({id:'re1',type:'executeReal',payload:execute(r)});await sleep(100);
  assert.equal((await host.call({id:'l8',type:'executeLive',payload:{notes:'x'}})).code,'INVALID_REQUEST');assert.equal((await host.call({id:'l9',type:'revokeLive',payload:{}})).ok,true);
  const scored=await host.result('re1');assert.equal(scored.ok,true,scored.code);assert.equal(scored.result.kind,'scoreReal');assert.ok(!host.frames.some(m=>m.id==='re1'&&m.trace?.stage==='cancelled'));
  const planned=await host.call({id:'re2',type:'executeReal',payload:execute(r,'agent')});assert.equal(planned.ok,true,planned.code);assert.equal(planned.result.kind,'agentReal');
  assert.equal(host.stderr(),'');
 });
});
