import test,{mock}from'node:test';import assert from'node:assert/strict';import{rm}from'node:fs/promises';
import{loadPublicCorpus,PreparedRealStore}from'../real.mjs';
import{REAL_POLICY_VERSION,PREPARED_TTL_MS}from'../../shared/real-contract.mjs';import{PUBLIC_CONDITIONS,PUBLIC_STUDY_IDS}from'../../shared/public-catalog.mjs';
import{installHost,writeHook,startHost,readLines}from'./host-harness.mjs';
const receipt={policyVersion:REAL_POLICY_VERSION,accepted:true},packet={ageBand:'45_59',conditionIds:[PUBLIC_CONDITIONS[0].id],selectedNctIds:[PUBLIC_STUDY_IDS[3]]};
const execute=(p,operation='score')=>({token:p.token,digest:p.digest,operation,policyReceipt:receipt});
const corpus=await loadPublicCorpus();
async function withHost(prefix,config,body){const installed=await installHost(prefix);let host;try{host=startHost(installed,{hook:await writeHook(installed.home,{log:installed.log,...config})});await body(host,installed);host.child.stdin.end();await host.exit;host=undefined;}finally{host?.child.kill('SIGKILL');await rm(installed.home,{recursive:true,force:true});}}
test('preview expiry only blocks take(); only explicit clear/revoke invalidates running real sends',()=>{
 mock.timers.enable({apis:['setTimeout']});let invalidations=0;const store=new PreparedRealStore(corpus,{onInvalidate:()=>invalidations++});try{
  const p=store.prepare(packet,receipt);assert.equal(store.take(execute(p)).consentDigest,p.digest);
  mock.timers.tick(PREPARED_TTL_MS);assert.equal(invalidations,0,'expiry must not abort an operation that already started');assert.throws(()=>store.take(execute(p,'agent')),e=>e.code==='CONSENT_EXPIRED');assert.equal(invalidations,0);
  const p2=store.prepare(packet,receipt);store.discard();assert.equal(invalidations,0);assert.throws(()=>store.take(execute(p2)),e=>e.code==='CONSENT_EXPIRED');
  const p3=store.prepare(packet,receipt);store.revoke(p3.token);assert.equal(invalidations,1);store.prepare(packet,receipt);store.clear();assert.equal(invalidations,2);
 }finally{mock.timers.reset();store.discard();}
 let time=0;const clocked=new PreparedRealStore(corpus,{now:()=>time,onInvalidate:()=>invalidations++});try{const p=clocked.prepare(packet,receipt);time+=PREPARED_TTL_MS+1;assert.throws(()=>clocked.take(execute(p)),e=>e.code==='CONSENT_EXPIRED');assert.equal(invalidations,2);}finally{clocked.discard();}
});
// Pen-test M3 (poc-consent part B): the TTL fired 1.5 s into a Decisions request that had already been sent and the host replied CANCELLED.
test('stdio: a consented real send that is in flight when the preview expires completes; expiry blocks only the next send',async()=>{
 await withHost('treatable-ttl-',{ttl:300,delay:1000},async(host,{log})=>{
  const p=(await host.call({id:'prep',type:'prepareReal',payload:{packet,policyReceipt:receipt}})).result;
  const scored=await host.call({id:'exec',type:'executeReal',payload:execute(p)});assert.equal(scored.ok,true,scored.code);assert.equal(scored.result.kind,'scoreReal');assert.equal(scored.result.consentDigest,p.digest);
  assert.ok(!host.frames.some(m=>m.id==='exec'&&m.trace?.stage==='cancelled'));
  const late=await host.call({id:'late',type:'executeReal',payload:execute(p,'agent')});assert.equal(late.code,'CONSENT_EXPIRED');
  assert.deepEqual((await readLines(log)).map(x=>x.method+' '+x.path),['POST /v1/decisions']);
 });
});
// Pen-test L1 (poc-crossclear): Stop on the fictional demo cleared the prepared real preview, so Send later failed as "expired".
test('stdio: demo cancels and non-real invalid frames keep the real preview; real cancels and malformed real input discard it',async()=>{
 await withHost('treatable-crossclear-',{delay:400},async(host)=>{
  const prep=async id=>(await host.call({id,type:'prepareReal',payload:{packet,policyReceipt:receipt}})).result;
  let p=await prep('prep1');
  host.send({id:'demo',type:'scoreDemo',payload:{fixtureId:'fibromyalgia',consent:true}});await new Promise(r=>setTimeout(r,100));
  assert.equal((await host.call({id:'stop',type:'cancel',payload:{requestId:'demo'}})).ok,true);assert.equal((await host.result('demo')).code,'CANCELLED');
  for(const bad of [{id:'b1',type:'scoreDemo',payload:{fixtureId:'fibromyalgia',consent:true,notes:'x'}},{id:'b2',type:'status',payload:{x:1}},{id:'b3',type:'cancel',payload:{requestId:7}},{id:'stop',type:'status',payload:{}}])assert.equal((await host.call(bad)).code,'INVALID_REQUEST');
  assert.equal((await host.call({id:'c0',type:'cancel',payload:{requestId:'never-sent'}})).ok,true);
  const scored=await host.call({id:'exec1',type:'executeReal',payload:execute(p)});assert.equal(scored.ok,true,scored.code);
  // Malformed real-path input still fails closed: the preview can no longer start the agent send.
  assert.equal((await host.call({id:'bad-real',type:'executeReal',payload:{...execute(p,'agent'),notes:'PRIVATE_SENTINEL'}})).code,'INVALID_REQUEST');
  assert.equal((await host.call({id:'exec2',type:'executeReal',payload:execute(p,'agent')})).code,'CONSENT_EXPIRED');
  p=await prep('prep2');assert.equal((await host.call({id:'garbage',type:'toString',payload:{}})).code,'INVALID_REQUEST');assert.equal((await host.call({id:'exec3',type:'executeReal',payload:execute(p)})).code,'CONSENT_EXPIRED');
  // Cancelling a real send aborts it and revokes the preview.
  p=await prep('prep3');host.send({id:'exec4',type:'executeReal',payload:execute(p)});await new Promise(r=>setTimeout(r,100));
  assert.equal((await host.call({id:'stop4',type:'cancel',payload:{requestId:'exec4'}})).ok,true);assert.equal((await host.result('exec4')).code,'CANCELLED');
  assert.equal((await host.call({id:'exec5',type:'executeReal',payload:execute(p,'agent')})).code,'CONSENT_EXPIRED');
  // A late cancel for an already finished real send also revokes the preview.
  p=await prep('prep4');assert.equal((await host.call({id:'exec6',type:'executeReal',payload:execute(p)})).ok,true);assert.equal((await host.call({id:'stop6',type:'cancel',payload:{requestId:'exec6'}})).ok,true);
  assert.equal((await host.call({id:'exec7',type:'executeReal',payload:execute(p,'agent')})).code,'CONSENT_EXPIRED');
  assert.equal(host.stderr(),'');
 });
});
// Pen-test info (poc-protocol op1): a duplicate of an in-flight ID got an INVALID_REQUEST reply carrying the original's ID.
test('stdio: a frame reusing an in-flight ID gets no reply, so the original keeps exactly one result; completed-ID replays are still rejected',async()=>{
 await withHost('treatable-dupid-',{delay:500},async(host)=>{
  host.send({id:'op1',type:'scoreDemo',payload:{fixtureId:'fibromyalgia',consent:true}});await new Promise(r=>setTimeout(r,100));
  host.send({id:'op1',type:'status',payload:{}},{id:'op1',type:'agentDemo',payload:{fixtureId:'pancreatic',consent:true}},{id:'op1',type:'bogus',payload:{}});
  const first=await host.result('op1');await new Promise(r=>setTimeout(r,100));assert.equal(first.ok,true);assert.equal(first.result.kind,'scoreDemo');
  assert.equal((await host.call({id:'after',type:'status',payload:{}})).ok,true);
  assert.deepEqual(host.frames.filter(m=>m.id==='op1'&&m.type!=='trace').map(m=>m.ok),[true]);assert.equal(host.frames.filter(m=>m.id==='op1'&&m.type==='trace').length,2);
  const replay=await host.call({id:'op1',type:'status',payload:{}});assert.equal(replay.code,'INVALID_REQUEST');
  // Duplicate of an in-flight real send: no reply, the send is not aborted, and the preview fails closed for the next send.
  const p=(await host.call({id:'prep',type:'prepareReal',payload:{packet,policyReceipt:receipt}})).result;host.send({id:'x1',type:'executeReal',payload:execute(p)});await new Promise(r=>setTimeout(r,100));
  host.send({id:'x1',type:'executeReal',payload:execute(p,'agent')});const x1=await host.result('x1');assert.equal(x1.ok,true,x1.code);
  assert.equal((await host.call({id:'x2',type:'executeReal',payload:execute(p,'agent')})).code,'CONSENT_EXPIRED');
  assert.deepEqual(host.frames.filter(m=>m.id==='x1'&&m.type!=='trace').length,1);
 });
});
