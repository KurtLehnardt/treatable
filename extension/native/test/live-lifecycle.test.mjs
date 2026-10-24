// Live current-page path (liveCatalog/prepareLive/executeLive): consent lifecycle parity with the snapshot path's pen-test fixes.
import test,{mock}from'node:test';import assert from'node:assert/strict';import{rm}from'node:fs/promises';
import{LiveEvidenceStore}from'../live-evidence.mjs';import{PreparedLiveStore}from'../live.mjs';
import{LIVE_SNAPSHOT_TTL_MS}from'../../shared/live-analysis-contract.mjs';import{REAL_POLICY_VERSION}from'../../shared/real-contract.mjs';
import{installHost,writeHook,startHost,readLines}from'./host-harness.mjs';
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
