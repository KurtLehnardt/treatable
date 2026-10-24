import test from 'node:test';import assert from 'node:assert/strict';
import{mkdtemp,readFile,writeFile,rm,stat}from'node:fs/promises';import os from 'node:os';import path from 'node:path';
import{PendingCleanup,deleteSessions,MAX_PENDING,MAX_AGE_MS,MIN_LEFTOVER_AGE_MS,PENDING_FILE}from'../pending-cleanup.mjs';
import{ApiError}from'../transport.mjs';
import{installHost,writeHook,startHost,readLines,poll}from'./host-harness.mjs';
const SHAPE=/^\[(\{"id":"[A-Za-z0-9_-]{1,160}","at":\d+\},?)*\]$/;
const tmp=async()=>mkdtemp(path.join(os.tmpdir(),'treatable-pending-'));
const keyReads=async file=>(await readFile(file,'utf8').catch(()=>'')).split('\n').filter(Boolean).length;
test('pending-cleanup file holds only validated provider IDs and timestamps, mode 0600, bounded and fail-safe',async()=>{
 const dir=await tmp(),file=path.join(dir,PENDING_FILE);let now=1_800_000_000_000;const store=new PendingCleanup(file,{now:()=>now});try{
  await store.add('sess_a');await store.add('sess_b');await store.add('sess_a');assert.deepEqual((await store.read()).map(e=>e.id),['sess_b','sess_a']);
  assert.equal((await stat(file)).mode&0o777,0o600);assert.match(await readFile(file,'utf8'),SHAPE);
  for(const bad of ['sess/../x','',`s${'x'.repeat(160)}`,'NCT06567886 notes',7,undefined])await store.add(bad);assert.deepEqual((await store.read()).map(e=>e.id),['sess_b','sess_a']);
  await store.remove(['sess_b','missing']);assert.deepEqual((await store.read()).map(e=>e.id),['sess_a']);
  for(let i=0;i<MAX_PENDING+10;i++)await store.add(`sess_${i}`);const rows=await store.read();assert.equal(rows.length,MAX_PENDING);assert.equal(rows.at(-1).id,`sess_${MAX_PENDING+9}`);assert.equal(rows[0].id,'sess_10');
  // Hand-edited or corrupted content: extra keys, wrong types, duplicates, future and >24 h entries are ignored; garbage reads as empty.
  await writeFile(file,JSON.stringify([{id:'sess_ok',at:now-1000},{id:'sess_ok',at:now},{id:'sess_old',at:now-MAX_AGE_MS},{id:'sess_future',at:now+120000},{id:'sess_extra',at:now,ageBand:'45_59'},{id:['sess_x'],at:now},{id:'sess_str',at:String(now)}]));
  assert.deepEqual(await store.read(),[{id:'sess_ok',at:now-1000}]);
  for(const junk of ['not json','{"id":"sess_x"}','ÿ'.repeat(20000)]){await writeFile(file,junk);assert.deepEqual(await store.read(),[]);}
  await writeFile(file,'[]');now+=1;await store.add('sess_new');assert.deepEqual(await store.read(),[{id:'sess_new',at:now}]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('deleteSessions confirms only 2xx and 404, retries within a short budget and skips invalid IDs',async()=>{
 const calls=[];const transport={async request(method,url,body,options){calls.push({method,url,timeout:options.timeout});const id=url.split('/').at(-1);if(id.includes('gone'))throw new ApiError('API_ERROR',404);if(id.includes('fail'))throw new ApiError('API_ERROR',500);if(id.includes('net'))throw new ApiError('NETWORK_ERROR');return{id,deleted:true,object:'agent.session.deleted'};}};
 assert.deepEqual(await deleteSessions(transport,['sess_ok','sess_gone','sess_fail','sess_net','bad/../id'],{attempts:2}),['sess_ok','sess_gone']);
 assert.deepEqual(calls.map(c=>c.method+' '+c.url),['DELETE /v1/agents/sessions/sess_ok','DELETE /v1/agents/sessions/sess_gone','DELETE /v1/agents/sessions/sess_fail','DELETE /v1/agents/sessions/sess_fail','DELETE /v1/agents/sessions/sess_net','DELETE /v1/agents/sessions/sess_net']);
 assert.ok(calls.every(c=>c.timeout<=3000));
 calls.length=0;assert.deepEqual(await deleteSessions(transport,['sess_ok','sess_fail'],{attempts:2,retryDelay:20,cancelFirst:true}),['sess_ok']);
 assert.deepEqual(calls.map(c=>c.method+' '+c.url),['POST /v1/agents/sessions/sess_ok/events','DELETE /v1/agents/sessions/sess_ok','POST /v1/agents/sessions/sess_fail/events','DELETE /v1/agents/sessions/sess_fail','DELETE /v1/agents/sessions/sess_fail']);assert.ok(calls[0].timeout<=1000);
 const slow={async request(){await new Promise(r=>setTimeout(r,30));throw new ApiError('NETWORK_ERROR');}};const started=Date.now();assert.deepEqual(await deleteSessions(slow,Array.from({length:40},(_,i)=>`sess_${i}`),{budget:100}),[]);assert.ok(Date.now()-started<1000);
});
const agent={id:'agent',type:'agentDemo',payload:{fixtureId:'fibromyalgia',consent:true}};
const pendingIds=async dir=>new PendingCleanup(path.join(dir,PENDING_FILE)).read().then(rows=>rows.map(e=>e.id));
test('stdio: an observed agent session is recorded while live and removed only after a confirmed delete',async()=>{
 for(const session of ['sess_live_ok','sess_live_fail']){const installed=await installHost('treatable-track-');let host;try{
  host=startHost(installed,{hook:await writeHook(installed.home,{log:installed.log,session,delay:150})});
  host.send(agent);await host.until(m=>m.trace?.stage==='agent.session.created'&&m.trace.sessionId===session);
  assert.deepEqual(await poll(async()=>{const ids=await pendingIds(installed.dir);return ids.length&&ids;}),[session]);
  const result=await host.result('agent');assert.equal(result.ok,true,result.code);
  const raw=await readFile(path.join(installed.dir,PENDING_FILE),'utf8');assert.match(raw,SHAPE);assert.equal((await stat(path.join(installed.dir,PENDING_FILE))).mode&0o777,0o600);
  // The file update is asynchronous bookkeeping, so wait for it rather than racing the reply.
  if(session.includes('ok')){assert.equal(result.result.cleanup,'deleted');await poll(async()=>(await pendingIds(installed.dir)).length===0);}
  else{assert.equal(result.result.cleanup,'failed');await new Promise(r=>setTimeout(r,200));assert.deepEqual(await pendingIds(installed.dir),[session]);}
  host.child.stdin.end();assert.equal((await host.exit).code,0);const hostPid=host.child.pid;host=undefined;
  if(session.includes('ok')){await new Promise(r=>setTimeout(r,400));assert.ok((await readLines(installed.log)).every(x=>x.pid===hostPid),'no detached cleanup after a confirmed delete');}
  else{// The unconfirmed session gets a detached retry; a failing DELETE keeps the entry for a later host.
   await poll(async()=>(await readLines(installed.log)).filter(x=>x.pid!==hostPid&&x.method==='DELETE').length===2);await new Promise(r=>setTimeout(r,200));assert.deepEqual(await pendingIds(installed.dir),[session]);}
 }finally{host?.child.kill('SIGKILL');await rm(installed.home,{recursive:true,force:true});}}
});
test('stdio: leftovers are deleted only after the first normal key read, never on status, and only when older than a live run',async()=>{
 const installed=await installHost('treatable-leftover-');let host;try{
  const now=Date.now(),old=now-MIN_LEFTOVER_AGE_MS-60000;
  await writeFile(path.join(installed.dir,PENDING_FILE),JSON.stringify([{id:'sess_expired',at:now-MAX_AGE_MS-1000},{id:'sess_young',at:now-60000},{id:'sess_left_ok',at:old},{id:'sess_left_gone',at:old},{id:'sess_left_fail',at:old},{id:'bad/../id',at:old}]),{mode:0o600});
  host=startHost(installed,{hook:await writeHook(installed.home,{log:installed.log})});
  assert.equal((await host.call({id:'s',type:'status',payload:{}})).ok,true);await new Promise(r=>setTimeout(r,300));
  assert.deepEqual(await readLines(installed.log),[]);assert.equal(await keyReads(installed.reads),0);
  const scored=await host.call({id:'score',type:'scoreDemo',payload:{fixtureId:'fibromyalgia',consent:true}});assert.equal(scored.ok,true,scored.code);
  await poll(async()=>(await pendingIds(installed.dir)).join()==='sess_young,sess_left_fail');
  const deletes=(await readLines(installed.log)).filter(x=>x.method==='DELETE').map(x=>x.path).sort();
  assert.deepEqual(deletes,['/v1/agents/sessions/sess_left_fail','/v1/agents/sessions/sess_left_gone','/v1/agents/sessions/sess_left_ok']);assert.equal(await keyReads(installed.reads),1);
  assert.equal((await host.call({id:'score2',type:'scoreDemo',payload:{fixtureId:'fibromyalgia',consent:true}})).ok,true);await new Promise(r=>setTimeout(r,300));
  assert.equal((await readLines(installed.log)).filter(x=>x.method==='DELETE').length,3,'each leftover is attempted once per host process');
  host.child.stdin.end();assert.equal((await host.exit).code,0);host=undefined;
 }finally{host?.child.kill('SIGKILL');await rm(installed.home,{recursive:true,force:true});}
});
// Pen-test M2: Chrome SIGKILLs the host ~2 s after the port closes; in-process cleanup needs up to ~5.5 s.
test('stdio: SIGTERM or stdin end mid-agent-run starts a detached cleanup that deletes the session after the host is SIGKILLed',async()=>{
 for(const close of ['SIGTERM','stdin-end']){const installed=await installHost('treatable-detached-');let host;try{
  host=startHost(installed,{hook:await writeHook(installed.home,{log:installed.log,agent:'hang',session:'sess_orphan',eventsDelay:5000})});
  host.send(agent);await host.until(m=>m.trace?.stage==='agent.session.created');await poll(async()=>(await pendingIds(installed.dir)).includes('sess_orphan'));
  const hostPid=host.child.pid;if(close==='SIGTERM')host.child.kill('SIGTERM');else host.child.stdin.end();await new Promise(r=>setTimeout(r,300));host.child.kill('SIGKILL');assert.equal((await host.exit).signal,'SIGKILL');host=undefined;
  const removal=await poll(async()=>(await readLines(installed.log)).find(x=>x.pid!==hostPid&&x.method==='DELETE'));
  assert.equal(removal.path,'/v1/agents/sessions/sess_orphan');assert.equal(removal.auth,true);
  assert.deepEqual(removal.argv.slice(-1),['sess_orphan']);assert.ok(removal.argv.at(-2).endsWith(path.join('native','cleanup.mjs')));assert.ok(!JSON.stringify(removal.argv).includes('sk-'));assert.deepEqual(removal.envKeys,['HOME','PATH']);
  await poll(async()=>(await pendingIds(installed.dir)).length===0);assert.equal(await keyReads(installed.reads),2);
 }finally{host?.child.kill('SIGKILL');await new Promise(r=>setTimeout(r,200));await rm(installed.home,{recursive:true,force:true});}}
});
