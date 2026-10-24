// Pen-test M2 on the live path: Agents sessions created by executeLive (agentLive) are tracked by the same pending-cleanup file and
// detached cleanup as the fictional-demo and snapshot paths.
import test from 'node:test';import assert from 'node:assert/strict';import{readFile,rm,stat}from'node:fs/promises';import path from 'node:path';
import{PendingCleanup,PENDING_FILE}from'../pending-cleanup.mjs';import{REAL_POLICY_VERSION}from'../../shared/real-contract.mjs';
import{installHost,writeHook,startHost,readLines,poll}from'./host-harness.mjs';
const ids=['NCT99999940','NCT99999941'],source={generation:'generation_cleanup',queryKey:'f'.repeat(64)},receipt={accepted:true,policyVersion:REAL_POLICY_VERSION};
const pendingIds=async dir=>new PendingCleanup(path.join(dir,PENDING_FILE)).read().then(rows=>rows.map(e=>e.id));
async function prepared(host){const c=(await host.call({id:'cat',type:'liveCatalog',payload:{nctIds:ids,source}})).result;const p=(await host.call({id:'prep',type:'prepareLive',payload:{snapshotId:c.snapshotId,source,packet:{ageBand:'45_59',conditionIds:[c.conditions[0].id],selectedNctIds:ids,agentNctIds:ids},policyReceipt:receipt}})).result;assert.equal(p?.kind,'preparedLive');return p;}
const agentLive=p=>({id:'agent',type:'executeLive',payload:{token:p.token,digest:p.digest,operation:'agent',policyReceipt:receipt}});
test('stdio: an agentLive session is recorded while live and removed only after a confirmed delete',async()=>{
 for(const session of ['sess_live_path_ok','sess_live_path_fail']){const installed=await installHost('treatable-live-track-');let host;try{
  host=startHost(installed,{hook:await writeHook(installed.home,{log:installed.log,session,delay:150})});
  host.send(agentLive(await prepared(host)));await host.until(m=>m.id==='agent'&&m.trace?.stage==='agent.session.created'&&m.trace.sessionId===session);
  assert.deepEqual(await poll(async()=>{const found=await pendingIds(installed.dir);return found.length&&found;}),[session]);
  const result=await host.result('agent');assert.equal(result.ok,true,result.code);assert.equal(result.result.kind,'agentLive');
  assert.match(await readFile(path.join(installed.dir,PENDING_FILE),'utf8'),/^\[(\{"id":"[A-Za-z0-9_-]{1,160}","at":\d+\},?)*\]$/);assert.equal((await stat(path.join(installed.dir,PENDING_FILE))).mode&0o777,0o600);
  if(session.endsWith('ok')){assert.equal(result.result.cleanup,'deleted');await poll(async()=>(await pendingIds(installed.dir)).length===0);}
  else{assert.equal(result.result.cleanup,'failed');await new Promise(r=>setTimeout(r,200));assert.deepEqual(await pendingIds(installed.dir),[session]);}
  host.child.stdin.end();assert.equal((await host.exit).code,0);const hostPid=host.child.pid;host=undefined;
  if(session.endsWith('fail'))await poll(async()=>(await readLines(installed.log)).filter(x=>x.pid!==hostPid&&x.method==='DELETE').length===2);
 }finally{host?.child.kill('SIGKILL');await rm(installed.home,{recursive:true,force:true});}}
});
test('stdio: stdin end mid-agentLive starts a detached cleanup that deletes the live session after the host is SIGKILLed',async()=>{
 const installed=await installHost('treatable-live-detached-');let host;try{
  host=startHost(installed,{hook:await writeHook(installed.home,{log:installed.log,agent:'hang',session:'sess_live_orphan',eventsDelay:5000})});
  host.send(agentLive(await prepared(host)));await host.until(m=>m.trace?.stage==='agent.session.created');await poll(async()=>(await pendingIds(installed.dir)).includes('sess_live_orphan'));
  const hostPid=host.child.pid;host.child.stdin.end();await new Promise(r=>setTimeout(r,300));host.child.kill('SIGKILL');assert.equal((await host.exit).signal,'SIGKILL');host=undefined;
  const removal=await poll(async()=>(await readLines(installed.log)).find(x=>x.pid!==hostPid&&x.method==='DELETE'));
  assert.equal(removal.path,'/v1/agents/sessions/sess_live_orphan');assert.deepEqual(removal.argv.slice(-1),['sess_live_orphan']);assert.ok(removal.argv.at(-2).endsWith(path.join('native','cleanup.mjs')));assert.deepEqual(removal.envKeys,['HOME','PATH']);
  await poll(async()=>(await pendingIds(installed.dir)).length===0);
 }finally{host?.child.kill('SIGKILL');await new Promise(r=>setTimeout(r,200));await rm(installed.home,{recursive:true,force:true});}
});
