// Shared helpers for spawning an isolated installed native host (temporary --home, fake Keychain helper, fake OpenAI hook).
import{mkdtemp,writeFile,readFile}from'node:fs/promises';import os from 'node:os';import path from 'node:path';import{spawn,spawnSync}from'node:child_process';
import{MessageDecoder,encodeMessage}from'../core.mjs';
export const origin='chrome-extension://lmgmjeabbalehlcakdbolielnfgchojf/';
const installer=new URL('../install.mjs',import.meta.url).pathname,fake=new URL('./fake-openai.mjs',import.meta.url).href;
export const nativeDir=home=>path.join(home,'Library','Application Support','Treatable','native-host','native');
// The fake helper appends one line per key read to <home>/key-reads, so tests can count Keychain reads.
export async function installHost(prefix,extraArgs=[]){const home=await mkdtemp(path.join(os.tmpdir(),prefix)),helper=path.join(home,'keychain'),reads=path.join(home,'key-reads');
 await writeFile(helper,`#!${process.execPath}\nif(process.argv[2]==='status')process.stdout.write('{"configured":true}');else{require('fs').appendFileSync(${JSON.stringify(reads)},'read\\n');process.stdout.write('sk-test-not-a-real-credential');}`,{mode:0o700});
 const r=spawnSync(process.execPath,[installer,'--home',home,'--credential-helper',helper,...extraArgs],{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr);
 return{home,dir:nativeDir(home),reads,log:path.join(home,'requests.log')};}
export async function writeHook(home,config){const file=path.join(home,`hook-${Math.random().toString(36).slice(2)}.mjs`);await writeFile(file,`import ${JSON.stringify(fake)};globalThis.__FAKE_OPENAI=${JSON.stringify(config)};\n`);return file;}
export async function readLines(file){try{return(await readFile(file,'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));}catch{return[];}}
export function startHost(installed,{hook}={}){const child=spawn(process.execPath,[...(hook?['--import',hook]:[]),path.join(installed.dir,'host.mjs'),origin],{stdio:['pipe','pipe','pipe']});const frames=[],waiters=new Set();let stderr='';child.stderr.on('data',x=>stderr+=x);
 const decoder=new MessageDecoder(m=>{frames.push(m);for(const w of waiters)w();},()=>{stderr+='[undecodable frame]';});child.stdout.on('data',x=>decoder.push(x));const exit=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));
 // Matches only frames at index >= from, so a reused ID never matches an earlier reply.
 const until=(pred,ms=15000,from=0)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiters.delete(check);reject(new Error('timeout; frames='+JSON.stringify(frames.slice(from)).slice(0,600)));},ms);const check=()=>{const hit=frames.slice(from).find(pred);if(hit){clearTimeout(timer);waiters.delete(check);resolve(hit);}};waiters.add(check);check();});
 const result=(id,from=0)=>until(m=>m.id===id&&m.type!=='trace',15000,from);
 return{child,frames,until,result,exit,stderr:()=>stderr,send:(...ms)=>child.stdin.write(Buffer.concat(ms.map(encodeMessage))),call:(m)=>{const from=frames.length;child.stdin.write(encodeMessage(m));return result(m.id,from);}};}
export async function poll(check,ms=10000){const end=Date.now()+ms;for(;;){const value=await check();if(value)return value;if(Date.now()>end)throw new Error('poll timeout');await new Promise(r=>setTimeout(r,50));}}
