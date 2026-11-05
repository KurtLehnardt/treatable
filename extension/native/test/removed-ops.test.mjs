// The helper no longer serves the fictional demo, bundled-catalog, private-matching (live), Help me apply, status or cancel operations.
// Each removed name is refused with the generic unknown-operation reply before any credential, Keychain or network use, and an update
// deletes the files that implemented them.
import test from 'node:test';import assert from 'node:assert/strict';
import{mkdtemp,mkdir,writeFile,readdir,rm,access,readFile}from'node:fs/promises';import os from 'node:os';import path from 'node:path';import{spawnSync}from'node:child_process';
import{PENDING_FILE}from'../pending-cleanup.mjs';
import{withHost,readLines,keyReads,nativeDir}from'./host-harness.mjs';
const policyReceipt={policyVersion:'treatable-health-api-2026-10-24-v1',accepted:true},token='A'.repeat(43),digest='a'.repeat(64),source={generation:'generation_old',queryKey:'b'.repeat(64)};
// One plausible request per removed operation, shaped as the old contracts accepted it.
const REMOVED_OPERATIONS=Object.freeze({
 status:{},
 cancel:{requestId:'earlier'},
 scoreDemo:{fixtureId:'fibromyalgia',consent:true},
 agentDemo:{fixtureId:'pancreatic',consent:true,studyIds:['NCT06567886']},
 prepareReal:{packet:{ageBand:'45_59',state:'ID',sex:'female',conditionIds:['condition_1'],selectedNctIds:['NCT06567886']},policyReceipt},
 executeReal:{token,digest,operation:'score',policyReceipt},
 revokeReal:{token},
 liveCatalog:{nctIds:['NCT99999901','NCT99999902'],source},
 prepareLive:{snapshotId:'c'.repeat(64),source,packet:{ageBand:'45_59',conditionIds:['lc_'+'d'.repeat(64)],selectedNctIds:['NCT99999901'],agentNctIds:['NCT99999901']},policyReceipt},
 executeLive:{token,digest,operation:'agent',policyReceipt},
 revokeLive:{},
 prepareApply:{nctId:'NCT04704505'},
 executeApply:{token,digest},
 revokeApply:{token},
});
const GENERIC={type:'result',ok:false,code:'INVALID_REQUEST',error:'Invalid or unsupported native request.'};
test('the installed helper refuses every removed operation with the generic unknown-operation reply, reads no key and opens no OpenAI or Gov transport',async()=>{
 assert.equal(Object.keys(REMOVED_OPERATIONS).length,14);
 await withHost('treatable-removed-ops-',{},async(host,installed)=>{
  for(const [type,payload] of Object.entries(REMOVED_OPERATIONS)){const reply=await host.call({id:`removed_${type}`,type,payload});assert.deepEqual(reply,{id:`removed_${type}`,...GENERIC},type);}
  // The same names with empty payloads, and repeated after a refusal, get the same reply.
  for(const type of Object.keys(REMOVED_OPERATIONS)){const reply=await host.call({id:`empty_${type}`,type,payload:{}});assert.deepEqual(reply,{id:`empty_${type}`,...GENERIC},type);}
  await new Promise(r=>setTimeout(r,200));
  assert.equal(await keyReads(installed.reads),0,'no removed operation reads the Keychain key');
  assert.deepEqual(await readLines(installed.log),[],'no removed operation reaches api.openai.com or clinicaltrials.gov');
  assert.ok(!host.frames.some(m=>m.type==='trace'),'no removed operation starts any work');
  // The helper keeps serving the shipped operations afterwards.
  assert.deepEqual(await host.call({id:'still_serving',type:'revokeStudyBrief',payload:{}}),{id:'still_serving',type:'result',ok:true});
  assert.equal(host.stderr(),'');
  const installedFiles=await readdir(installed.dir),shared=await readdir(path.join(installed.dir,'..','shared'));
  for(const retired of ['real.mjs','live.mjs','apply.mjs','data'])assert.ok(!installedFiles.includes(retired),retired);
  for(const retired of ['demo-fixtures.mjs','real-contract.mjs','public-catalog.mjs','live-analysis-contract.mjs'])assert.ok(!shared.includes(retired),retired);
  for(const kept of ['host.mjs','core.mjs','rank.mjs','study-brief.mjs','live-evidence.mjs','provider.mjs','cleanup.mjs'])assert.ok(installedFiles.includes(kept),kept);
 });
});
test('reinstalling over an earlier helper deletes the retired operation files and corpus, and keeps the pending-cleanup record',async()=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'treatable-retired-')),helper=path.join(home,'keychain'),native=nativeDir(home),shared=path.join(native,'..','shared');
 try{
  await writeFile(helper,`#!${process.execPath}\nprocess.stdout.write('sk-test-not-a-real-credential');`,{mode:0o700});
  await mkdir(path.join(native,'data'),{recursive:true});await mkdir(shared,{recursive:true});
  for(const file of ['real.mjs','live.mjs','apply.mjs'])await writeFile(path.join(native,file),'export const RETIRED=true;\n');await writeFile(path.join(native,'data','studies.json'),'[]');
  for(const file of ['demo-fixtures.mjs','real-contract.mjs','public-catalog.mjs','live-analysis-contract.mjs'])await writeFile(path.join(shared,file),'export const RETIRED=true;\n');
  const pending=JSON.stringify([{id:'sess_kept',at:Date.now()}]);await writeFile(path.join(native,PENDING_FILE),pending,{mode:0o600});
  const r=spawnSync(process.execPath,[new URL('../install.mjs',import.meta.url).pathname,'--home',home,'--credential-helper',helper],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  for(const file of ['real.mjs','live.mjs','apply.mjs','data'])await assert.rejects(access(path.join(native,file)),file);
  for(const file of ['demo-fixtures.mjs','real-contract.mjs','public-catalog.mjs','live-analysis-contract.mjs'])await assert.rejects(access(path.join(shared,file)),file);
  await access(path.join(native,'host.mjs'));assert.equal(await readFile(path.join(native,PENDING_FILE),'utf8'),pending,'unconfirmed provider sessions are still cleaned up after an update');
  // Running the installer again with nothing retired left is a no-op for those paths.
  const again=spawnSync(process.execPath,[new URL('../install.mjs',import.meta.url).pathname,'--home',home,'--credential-helper',helper],{encoding:'utf8'});assert.equal(again.status,0,again.stderr);
 }finally{await rm(home,{recursive:true,force:true});}
});
