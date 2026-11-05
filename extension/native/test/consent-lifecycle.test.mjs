// Lifecycle of the one-use receipts of the two shipped paths (AI ranking, study brief): expiry only blocks the next send, explicit
// revoke aborts, each path's revoke or invalid input leaves the other path's preview alone, and in-flight request IDs cannot be reused.
import test,{mock}from'node:test';import assert from'node:assert/strict';
import{PreparedRankStore}from'../rank.mjs';import{PreparedStudyBriefStore}from'../study-brief.mjs';
import{RANK_TTL_MS}from'../../shared/rank-contract.mjs';import{APPLY_TOKEN_TTL_MS}from'../../shared/apply-contract.mjs';
import{withHost,readLines,prepareRank,prepareBrief,receipt}from'./host-harness.mjs';
const record=nctId=>({hasResults:false,protocolSection:{identificationModule:{nctId,briefTitle:'Fictional public study'},statusModule:{overallStatus:'RECRUITING'},conditionsModule:{conditions:['Fictional condition']},descriptionModule:{briefSummary:'Public summary.'},eligibilityModule:{eligibilityCriteria:'Public criteria',minimumAge:'18 Years',sex:'ALL',healthyVolunteers:false},contactsLocationsModule:{}}});
const ids=['NCT99999950','NCT99999951'],sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const [name,make,prepare,ttl,expired] of [
 ['AI ranking',options=>new PreparedRankStore({fetchRecord:async id=>record(id),...options}),s=>s.prepare({nctIds:ids,profile:{conditions:['Asthma']}}),RANK_TTL_MS,'CONSENT_EXPIRED'],
 ['study brief',options=>new PreparedStudyBriefStore({fetchRecord:async id=>record(id),...options}),s=>s.prepare(ids),APPLY_TOKEN_TTL_MS,'APPLY_EXPIRED']])
 test(`${name}: preview expiry only blocks take(); only explicit clear/revoke invalidates running sends`,async()=>{
  mock.timers.enable({apis:['setTimeout']});let invalidations=0;const store=make({onInvalidate:()=>invalidations++});try{
   const p=await prepare(store);let before=invalidations;assert.ok(store.take(receipt(p)));
   mock.timers.tick(ttl);assert.equal(invalidations,before,'expiry must not abort an operation that already started');
   const p2=await prepare(store);before=invalidations;mock.timers.tick(ttl);assert.throws(()=>store.take(receipt(p2)),{code:expired});assert.equal(invalidations,before);
   const p3=await prepare(store);before=invalidations;store.discard();assert.equal(invalidations,before,'invalid input only discards');assert.throws(()=>store.take(receipt(p3)),{code:expired});
   const p4=await prepare(store);before=invalidations;store.revoke(p4.token);assert.equal(invalidations,before+1);assert.throws(()=>store.take(receipt(p4)),{code:expired});
   await prepare(store);before=invalidations;store.clear();assert.equal(invalidations,before+1);
  }finally{mock.timers.reset();store.discard();}
  let time=0;const clocked=make({now:()=>time});try{const p=await prepare(clocked);time+=ttl+1;assert.throws(()=>clocked.take(receipt(p)),{code:expired});}finally{clocked.discard();}
 });
// Pen-test M3 (poc-consent part B), on the remaining paths: a TTL that fires while the provider request is in flight never cancels it.
test('stdio: a ranking or brief send in flight when its receipt expires completes; expiry blocks only the next send',async()=>{
 await withHost('treatable-ttl-',{ttl:300,delay:1000},async(host,{log})=>{
  const p=await prepareRank(host,'prep');const scored=await host.call({id:'exec',type:'executeRank',payload:receipt(p)});assert.equal(scored.ok,true,scored.code);assert.equal(scored.result.digest,p.digest);
  assert.ok(!host.frames.some(m=>m.id==='exec'&&m.trace?.stage==='cancelled'));
  const p2=await prepareRank(host,'prep2');await sleep(600);assert.equal((await host.call({id:'late',type:'executeRank',payload:receipt(p2)})).code,'CONSENT_EXPIRED');
  const b=await prepareBrief(host,'brief');const brief=await host.call({id:'briefRun',type:'executeStudyBrief',payload:receipt(b)});assert.equal(brief.ok,true,brief.code);assert.equal(brief.result.agentStatus,'complete');assert.equal(brief.result.cleanup,'deleted');
  const b2=await prepareBrief(host,'brief2');await sleep(600);assert.equal((await host.call({id:'lateBrief',type:'executeStudyBrief',payload:receipt(b2)})).code,'APPLY_EXPIRED');
  const sent=(await readLines(log)).filter(x=>x.host==='api.openai.com').map(x=>x.method+' '+x.path.replace(/sess_[A-Za-z0-9_]+/,'sess'));
  assert.deepEqual(sent.filter(x=>x==='POST /v1/decisions').length,2,'one Decisions request per completed send, none for the expired receipts');
 });
});
// Pen-test L1 (poc-crossclear), on the remaining paths: Stop or bad input on one feature must not cancel the other feature's preview.
test('stdio: rank revokes and invalid rank frames keep the brief preview; brief revokes and invalid brief frames keep the rank preview; unknown or removed names discard both',async()=>{
 await withHost('treatable-crossclear-',{delay:50},async host=>{
  let r=await prepareRank(host,'r1'),b=await prepareBrief(host,'b1');
  for(const frame of [{id:'k1',type:'revokeRank',payload:{}},{id:'k2',type:'revokeRank',payload:{token:'B'.repeat(43)}},{id:'k3',type:'prepareRank',payload:{nctIds:['NCT99999960'],profile:{conditions:['Asthma'],notes:'PRIVATE_SENTINEL'}}},{id:'k4',type:'executeRank',payload:{token:'x'}}])await host.call(frame);
  const brief=await host.call({id:'bRun',type:'executeStudyBrief',payload:receipt(b)});assert.equal(brief.ok,true,brief.code);
  assert.equal((await host.call({id:'rLate',type:'executeRank',payload:receipt(r)})).code,'CONSENT_EXPIRED','revokeRank and invalid rank input did discard the rank preview');
  r=await prepareRank(host,'r2');b=await prepareBrief(host,'b2');
  for(const frame of [{id:'j1',type:'revokeStudyBrief',payload:{}},{id:'j2',type:'prepareStudyBrief',payload:{nctIds:['NCT99999970'],patient:'PRIVATE_SENTINEL'}},{id:'j3',type:'executeStudyBrief',payload:{token:'x'}},{id:'j4',type:'localModels',payload:{model:'x'}}])await host.call(frame);
  const ranked=await host.call({id:'rRun',type:'executeRank',payload:receipt(r)});assert.equal(ranked.ok,true,ranked.code);
  assert.equal((await host.call({id:'bLate',type:'executeStudyBrief',payload:receipt(b)})).code,'APPLY_EXPIRED','brief revoke and invalid brief input did discard the brief preview');
  // Anything that is not clearly one path's frame fails closed for both, including every removed operation name.
  for(const type of ['scoreDemo','status','cancel','executeLive','executeApply','toString']){r=await prepareRank(host,'r-'+type);b=await prepareBrief(host,'b-'+type);
   assert.equal((await host.call({id:'x-'+type,type,payload:{}})).code,'INVALID_REQUEST');
   assert.equal((await host.call({id:'rx-'+type,type:'executeRank',payload:receipt(r)})).code,'CONSENT_EXPIRED',type);assert.equal((await host.call({id:'bx-'+type,type:'executeStudyBrief',payload:receipt(b)})).code,'APPLY_EXPIRED',type);}
  assert.equal(host.stderr(),'');
 });
});
test('stdio: an explicit revoke aborts the matching send that is in flight, and only that one',async()=>{
 await withHost('treatable-revoke-abort-',{delay:1500},async host=>{
  const r=await prepareRank(host,'r');host.send({id:'rRun',type:'executeRank',payload:receipt(r)});await host.until(m=>m.id==='rRun'&&m.trace?.stage==='decisions.request');
  const settled=id=>host.frames.some(m=>m.id===id&&m.type==='result');
  assert.equal((await host.call({id:'bRevoke',type:'revokeStudyBrief',payload:{}})).ok,true);await sleep(150);assert.equal(settled('rRun'),false,'the other path\'s revoke does not touch the ranking send');
  assert.equal((await host.call({id:'rRevoke',type:'revokeRank',payload:{token:r.token}})).ok,true);assert.equal((await host.result('rRun')).code,'CANCELLED');
  const b=await prepareBrief(host,'b');host.send({id:'bRun',type:'executeStudyBrief',payload:receipt(b)});await host.until(m=>m.id==='bRun'&&m.trace?.stage==='agent.request');
  assert.equal((await host.call({id:'rRevoke2',type:'revokeRank',payload:{}})).ok,true);await sleep(150);assert.equal(settled('bRun'),false,'the other path\'s revoke does not touch the brief send');
  assert.equal((await host.call({id:'bRevoke2',type:'revokeStudyBrief',payload:{token:b.token}})).ok,true);assert.equal((await host.result('bRun')).code,'CANCELLED');
 });
});
// Pen-test info (poc-protocol op1): a duplicate of an in-flight ID got an INVALID_REQUEST reply carrying the original's ID.
test('stdio: a frame reusing an in-flight ID gets no reply, so the original keeps exactly one result; completed-ID replays are still rejected',async()=>{
 await withHost('treatable-dupid-',{delay:800},async host=>{
  const p=await prepareRank(host,'prep');host.send({id:'op1',type:'executeRank',payload:receipt(p)});await host.until(m=>m.id==='op1'&&m.trace?.stage==='decisions.request');
  host.send({id:'op1',type:'revokeStudyBrief',payload:{}},{id:'op1',type:'prepareRank',payload:{nctIds:['NCT99999960'],profile:{conditions:['Asthma']}}},{id:'op1',type:'executeRank',payload:receipt(p)},{id:'op1',type:'bogus',payload:{}});
  const first=await host.result('op1');await sleep(200);assert.equal(first.ok,true,first.code);assert.equal(first.result.kind,'rankResult');
  assert.equal((await host.call({id:'after',type:'revokeRank',payload:{}})).ok,true);
  assert.deepEqual(host.frames.filter(m=>m.id==='op1'&&m.type!=='trace').map(m=>m.ok),[true]);
  assert.equal((await host.call({id:'op1',type:'revokeRank',payload:{}})).code,'INVALID_REQUEST');
 });
});
