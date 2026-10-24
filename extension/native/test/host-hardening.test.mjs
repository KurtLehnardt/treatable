import test from 'node:test';import assert from 'node:assert/strict';
import{mkdtemp,writeFile,rm}from'node:fs/promises';import os from 'node:os';import path from 'node:path';import{spawn,spawnSync}from'node:child_process';
import{MessageDecoder,encodeMessage,encodeReply,MAX_MESSAGE_BYTES}from'../core.mjs';import{parseDemoReply}from'../../shared/demo-contract.mjs';
const origin='chrome-extension://lmgmjeabbalehlcakdbolielnfgchojf/';
const installer=new URL('../install.mjs',import.meta.url).pathname;

test('encodeReply turns unframeable replies into a small fixed error that never echoes the value',()=>{
 const ok=encodeReply({id:'a',type:'result',ok:true});assert.equal(ok.ok,true);
 for(const value of [{id:'big',type:'result',ok:true,result:{x:'SENSITIVE_SENTINEL'.repeat(MAX_MESSAGE_BYTES)}},{id:'big',type:'trace',ok:true,trace:{n:10n}}]){const r=encodeReply(value,'Fixed.');assert.equal(r.ok,false);assert.ok(r.frame.length<200);const decoded=JSON.parse(r.frame.subarray(4).toString('utf8'));assert.deepEqual(decoded,{id:'big',type:'result',ok:false,code:'INTERNAL_ERROR',error:'Fixed.'});parseDemoReply(decoded,'big');}
 assert.equal(JSON.parse(encodeReply({id:'bad id',x:1n}).frame.subarray(4)).id,'invalid');
});
async function fakeHome(prefix){const home=await mkdtemp(path.join(os.tmpdir(),prefix)),helper=path.join(home,'keychain');await writeFile(helper,`#!${process.execPath}\nif(process.argv[2]==='status')process.stdout.write('{"configured":false}');else process.stdout.write('sk-test-not-a-real-credential');`,{mode:0o700});return{home,helper};}
const install=(...args)=>spawnSync(process.execPath,[installer,...args],{encoding:'utf8'});
const nativeDir=home=>path.join(home,'Library','Application Support','Treatable','native-host');
function startHost(host,pre=[]){const child=spawn(process.execPath,[...pre,host,origin],{stdio:['pipe','pipe','pipe']});const frames=[],waiters=new Set();let stderr='';child.stderr.on('data',x=>stderr+=x);
 const decoder=new MessageDecoder(m=>{frames.push(m);for(const w of waiters)w();},()=>assert.fail('bad frame'));child.stdout.on('data',x=>decoder.push(x));const exit=new Promise(r=>child.once('exit',code=>r(code)));
 const until=(pred,ms=15000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiters.delete(check);reject(Error('timeout'));},ms);const check=()=>{const hit=frames.find(pred);if(hit){clearTimeout(timer);waiters.delete(check);resolve(hit);}};waiters.add(check);check();});
 return{child,frames,until,exit,stderr:()=>stderr,send:(...ms)=>child.stdin.write(Buffer.concat(ms.map(encodeMessage)))};}
test('long sessions keep working past 1,000 request IDs while replay of a recent ID is still rejected',async()=>{
 const{home,helper}=await fakeHome('treatable-ids-');let host;try{const r=install('--home',home,'--credential-helper',helper);assert.equal(r.status,0,r.stderr);host=startHost(path.join(nativeDir(home),'native','host.mjs'));
  host.send(...Array.from({length:1100},(_,i)=>({id:`c${i}`,type:'cancel',payload:{requestId:'none'}})));await host.until(m=>m.id==='c1099');assert.equal(host.frames.length,1100);assert.ok(host.frames.every(m=>m.ok===true));
  host.send({id:'c1099',type:'cancel',payload:{requestId:'none'}});assert.equal((await host.until((m,i)=>host.frames.indexOf(m)>=1100&&m.id==='c1099')).code,'INVALID_REQUEST');
  host.send({id:'c0',type:'cancel',payload:{requestId:'none'}});assert.equal((await host.until(m=>host.frames.indexOf(m)>=1101&&m.id==='c0')).ok,true);
  host.send({id:'s',type:'status',payload:{}});assert.equal((await host.until(m=>m.id==='s')).ok,true);assert.equal(host.stderr(),'');host.child.stdin.end();assert.equal(await host.exit,0);host=undefined;
 }finally{host?.child.kill();await rm(home,{recursive:true,force:true});}
});
test('uncaught exceptions and unhandled rejections send a fixed reply for the in-flight ID, one fixed stderr line, no stack or data, then exit',async()=>{
 for(const fault of ['throw','reject']){const{home,helper}=await fakeHome('treatable-fatal-'),hook=path.join(home,'fault.mjs');let host;try{
  await writeFile(hook,`import https from'node:https';import{EventEmitter}from'node:events';https.request=(options)=>{const req=new EventEmitter();req.write=()=>{};req.end=()=>setImmediate(()=>{${fault==='throw'?"throw new Error('SENSITIVE_SENTINEL '+JSON.stringify(options.headers))":"Promise.reject(new Error('SENSITIVE_SENTINEL'))"};});options.signal?.addEventListener('abort',()=>req.emit('error',new Error('aborted')),{once:true});return req;};`);
  const r=install('--home',home,'--credential-helper',helper);assert.equal(r.status,0,r.stderr);host=startHost(path.join(nativeDir(home),'native','host.mjs'),['--import',hook]);
  host.send({id:'op1',type:'scoreDemo',payload:{fixtureId:'fibromyalgia',consent:true}});const code=await host.exit;host.child.stdin.destroy();
  assert.equal(code,1);const results=host.frames.filter(m=>m.type==='result');assert.deepEqual(results,[{id:'op1',type:'result',ok:false,code:'INTERNAL_ERROR',error:'The native helper could not complete this request.'}]);
  assert.equal(host.stderr(),'Treatable native helper stopped after an internal error.\n');assert.ok(!JSON.stringify(host.frames).includes('SENSITIVE_SENTINEL')&&!JSON.stringify(host.frames).includes('sk-test'));host=undefined;
 }finally{host?.child.kill();await rm(home,{recursive:true,force:true});}}
});
