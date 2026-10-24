// Local model support for the native helper: find Ollama, profile this machine, list installed generation models, recommend one, and run
// a dedicated `ollama serve` that only this helper talks to. The dedicated runtime listens on an ephemeral 127.0.0.1 port, has cloud
// features disabled, gets a minimal environment and a private empty HOME, and is stopped when the helper ends. The user's own Ollama
// daemon and its port are never contacted. Nothing here downloads a model or reads a credential.
import{spawn,execFile}from'node:child_process';
import{access,stat,readFile,statfs,mkdtemp,rm,realpath,constants}from'node:fs/promises';
import net from'node:net';import os from'node:os';import path from'node:path';
import{request as loopbackRequest}from'node:http';
import{fileURLToPath}from'node:url';
import{isLocalModelName}from'../shared/local-model.mjs';
import{ApiError}from'./transport.mjs';

// Known install locations, checked in order. PATH is never consulted.
export const OLLAMA_LOCATIONS=Object.freeze(['/opt/homebrew/bin/ollama','/usr/local/bin/ollama','/Applications/Ollama.app/Contents/Resources/ollama']);
export const RUNTIME_START_TIMEOUT_MS=20000;
const unsafePath=v=>typeof v!=='string'||!path.isAbsolute(v)||/[\u0000-\u001f\u007f]/.test(v);
const execText=(file,args,timeout=3000)=>new Promise(resolve=>{try{execFile(file,args,{timeout,maxBuffer:16384,env:{PATH:'/usr/bin:/bin'}},(error,stdout)=>resolve(error?undefined:String(stdout).trim()));}catch{resolve(undefined)}});

/** First known location holding an executable regular file, resolved through symlinks; undefined when Ollama is not installed. */
export async function findOllama(candidates=OLLAMA_LOCATIONS){
 for(const candidate of candidates){if(unsafePath(candidate))continue;try{const real=await realpath(candidate);if(!(await stat(real)).isFile())continue;await access(real,constants.X_OK);return real;}catch{}}
 return undefined;
}

// ---------- installed models ----------
/** Manifest path for a library-style name, always inside <modelsDir>/manifests/registry.ollama.ai. */
export function manifestPath(modelsDir,name){
 if(!isLocalModelName(name))return undefined;const[repository,tag='latest']=name.split(':'),[namespace,model]=repository.includes('/')?repository.split('/'):['library',repository];
 const root=path.join(modelsDir,'manifests','registry.ollama.ai'),file=path.join(root,namespace,model,tag);
 return path.relative(root,file).split(path.sep).length===3&&!path.relative(root,file).startsWith('..')?file:undefined;
}
/** True only when the manifest is local (no remote host or model) and every model layer blob is present with its recorded size. */
export async function hasLocalWeights(modelsDir,name){
 const file=manifestPath(modelsDir,name);if(!file)return false;
 try{
  const info=await stat(file);if(!info.isFile()||info.size>1024*1024)return false;
  const manifest=JSON.parse(await readFile(file,'utf8'));if(manifest.remote_host||manifest.remote_model)return false;
  const layers=Array.isArray(manifest.layers)?manifest.layers.filter(l=>l?.mediaType==='application/vnd.ollama.image.model'):[];if(!layers.length)return false;
  for(const layer of layers){if(typeof layer.digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(layer.digest)||!Number.isSafeInteger(layer.size)||layer.size<=0)return false;const blob=await stat(path.join(modelsDir,'blobs',layer.digest.replace(':','-')));if(!blob.isFile()||blob.size!==layer.size)return false;}
  return true;
 }catch{return false;}
}
const familyOf=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(v)?v:null;
const paramsOf=v=>typeof v==='string'&&/^[0-9]{1,4}(?:\.[0-9]{1,3})?[KMBT]$/.test(v)?v:null;
const quantOf=v=>typeof v==='string'&&/^[A-Za-z0-9_]{1,20}$/.test(v)?v:null;
/** Installed models that can generate text: listed by the dedicated runtime, backed by local weights (checked in describe), with the completion capability. */
// At most 40 listed models are inspected; a runtime that stops during the check fails it instead of being restarted.
export async function listLocalModels(runtime,signal){
 const tags=await runtime.request('/api/tags',undefined,{signal,timeout:5000});const models=[];
 for(const item of(Array.isArray(tags?.models)?tags.models:[]).slice(0,40)){
  const name=item?.name;if(!isLocalModelName(name)||item.remote_host||item.remote_model||!Number.isSafeInteger(item.size)||item.size<=0||models.some(m=>m.name===name))continue;
  if(runtime.running===false)throw new ApiError('LOCAL_RUNTIME_FAILED');
  let info;try{info=await runtime.describe(name,signal);}catch(e){if(signal?.aborted||e?.code==='LOCAL_RUNTIME_FAILED'||e?.code==='LOCAL_TIMEOUT')throw e;continue;}
  if(!info.completion)continue;
  models.push({name,sizeBytes:item.size,family:familyOf(item.details?.family),parameterSize:paramsOf(item.details?.parameter_size),quantization:quantOf(item.details?.quantization_level),...(Number.isSafeInteger(info.kvBytes)?{kvBytes:info.kvBytes}:{})});
  if(models.length>=32)break;
 }
 return models;
}

// ---------- machine profile ----------
const printable=v=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/\s+/g,' ').trim().slice(0,120)||null:null;
/** Total memory, CPU brand and architecture, Apple Silicon unified memory and free disk. No identifiers, user names or paths are returned. */
export async function machineProfile({platform=process.platform,arch=os.arch(),totalmem=os.totalmem(),cpuModel=os.cpus()?.[0]?.model,sysctl=execText,diskPath=os.homedir(),statfsImpl=statfs}={}){
 const mac=platform==='darwin';let cpu=printable(cpuModel),appleSilicon=false;
 if(mac){cpu=printable(await sysctl('/usr/sbin/sysctl',['-n','machdep.cpu.brand_string']))??cpu;appleSilicon=(await sysctl('/usr/sbin/sysctl',['-n','hw.optional.arm64']))==='1'||arch==='arm64';}
 let freeDiskBytes=null;try{const s=await statfsImpl(diskPath);const free=Number(s.bavail)*Number(s.bsize);if(Number.isSafeInteger(free)&&free>=0)freeDiskBytes=free;}catch{}
 return{platform:mac?'macos':platform==='linux'?'linux':platform==='win32'?'windows':'other',arch:appleSilicon?'arm64':arch==='arm64'||arch==='x64'?arch:'other',cpu,memoryBytes:Number.isSafeInteger(totalmem)&&totalmem>0?totalmem:1,appleSilicon,unifiedMemory:mac&&appleSilicon,freeDiskBytes};
}

// ---------- recommendation ----------
// Context the estimate allows for: the largest window a two-study brief normally needs.
export const ESTIMATE_CONTEXT_TOKENS=24576;
/** f16 key/value cache at ESTIMATE_CONTEXT_TOKENS from the runtime's model_info, or undefined when the architecture does not say enough.
 * Hybrid models count only their full-attention layers; sliding-window models are counted as if a quarter of their layers kept a full cache. */
export function kvCacheBytes(modelInfo){
 if(!modelInfo||typeof modelInfo!=='object')return undefined;const arch=modelInfo['general.architecture'];if(typeof arch!=='string'||!/^[a-z0-9_]{1,40}$/.test(arch))return undefined;
 const num=key=>{const v=modelInfo[`${arch}.${key}`];return Number.isSafeInteger(v)&&v>0?v:undefined;};
 const layers=num('block_count'),kvHeads=num('attention.head_count_kv'),heads=num('attention.head_count'),width=num('embedding_length');
 const key=num('attention.key_length')??(width&&heads?Math.round(width/heads):undefined),value=num('attention.value_length')??key;
 if(!layers||!kvHeads||!key||!value)return undefined;
 const interval=num('full_attention_interval'),full=interval?Math.ceil(layers/interval):num('attention.sliding_window')?Math.ceil(layers/4):layers;
 return full*ESTIMATE_CONTEXT_TOKENS*kvHeads*(key+value)*2;
}
// Running memory estimate: the weights plus 5%, the key/value cache (or 15% of the weights when the architecture is not known), and
// half a gigabyte of compute buffers.
export function estimateMemory(sizeBytes,kvBytes){return Math.round(sizeBytes*1.05+(Number.isSafeInteger(kvBytes)&&kvBytes>=0?kvBytes:sizeBytes*0.15)+5e8);}
// Comfortable leaves at least half of memory for macOS, Chrome and other apps; above 60% the model is not recommended at all.
export const COMFORTABLE_SHARE=0.5,MAX_SHARE=0.6;
export function memoryFit(estimate,memoryBytes){return estimate<=memoryBytes*COMFORTABLE_SHARE?'comfortable':estimate<=memoryBytes*MAX_SHARE?'tight':'too_large';}
// How reliably a model family follows a JSON schema with exact copies and fixed catalog IDs. 'strong' is based on this project's local
// smoke tests; 'good' covers current instruction-tuned families; anything unknown is 'basic' and only chosen when nothing better fits.
const STRONG=['qwen35','qwen35moe','qwen3.5'];
const GOOD=['qwen3','qwen3moe','qwen2','qwen2.5','gemma4','gemma3','llama','mistral','mistral3','phi3','phi4','gptoss','gpt-oss','granite','olmo2','command-r','cohere2','deepseek2','exaone'];
export function structuredTier(model){const keys=[model.family,model.name.split(/[/:]/).at(-2)??model.name.split(':')[0]].filter(Boolean).map(v=>v.toLowerCase());return keys.some(k=>STRONG.includes(k))?'strong':keys.some(k=>GOOD.includes(k)||GOOD.some(g=>k.startsWith(g)))?'good':'basic';}
const paramsB=p=>{const m=/^([0-9.]+)([KMBT])$/.exec(p??'');return m?Number(m[1])*{K:1e-6,M:1e-3,B:1,T:1e3}[m[2]]:0;};
// Pull suggestions, best first. Names and download sizes were checked on https://ollama.com/library/qwen3.5/tags (October 2026).
export const PULL_CANDIDATES=Object.freeze([{model:'qwen3.5:27b',downloadBytes:17e9},{model:'qwen3.5:9b',downloadBytes:6.6e9},{model:'qwen3.5:4b',downloadBytes:3.3e9},{model:'qwen3.5:2b',downloadBytes:2.7e9},{model:'qwen3.5:0.8b',downloadBytes:1.2e9}]);
const gb=bytes=>{const v=bytes/1e9;return v>=10?String(Math.round(v)):v.toFixed(1).replace(/\.0$/,'');};
const ram=bytes=>String(Math.max(1,Math.round(bytes/1024**3)));
const TIER_COPY={strong:'good at structured output',good:'reasonably good at structured output',basic:'untested for structured output'};
/** Ranks installed models for this machine and picks one, or suggests a model to pull. Pure: the same inputs always give the same answer. */
export function recommend({machine,models,installed=true}){
 const mem=machine.memoryBytes,ranked=models.map(({kvBytes,...m})=>{const estimatedMemoryBytes=estimateMemory(m.sizeBytes,kvBytes);return{...m,estimatedMemoryBytes,fit:memoryFit(estimatedMemoryBytes,mem),structured:structuredTier(m),recommended:false};});
 const order={comfortable:0,tight:1,too_large:2},tier={strong:0,good:1,basic:2};
 const best=ranked.filter(m=>m.fit!=='too_large').sort((a,b)=>order[a.fit]-order[b.fit]||tier[a.structured]-tier[b.structured]||paramsB(b.parameterSize)-paramsB(a.parameterSize)||a.name.length-b.name.length||(a.name<b.name?-1:a.name>b.name?1:0))[0];
 if(installed&&best){best.recommended=true;const reason=best.fit==='comfortable'?`${best.name} fits in ${ram(mem)} GB of memory with room for macOS and Chrome (about ${gb(best.estimatedMemoryBytes)} GB in use) and is ${TIER_COPY[best.structured]}.`:`${best.name} fits in ${ram(mem)} GB of memory but leaves little headroom (about ${gb(best.estimatedMemoryBytes)} GB in use); close other apps first. It is ${TIER_COPY[best.structured]}.`;return{models:ranked,recommendation:{kind:'installed',model:best.name,reason}};}
 const pick=['comfortable','tight'].map(fit=>PULL_CANDIDATES.find(c=>memoryFit(estimateMemory(c.downloadBytes),mem)===fit)).find(Boolean);
 if(!pick)return{models:ranked,recommendation:{kind:'none',reason:`This device has ${ram(mem)} GB of memory, which is not enough for a local model that can write a useful brief. Use OpenAI instead.`}};
 const disk=machine.freeDiskBytes,short=disk!==null&&disk<pick.downloadBytes+2e9;
 const lead=!installed?'After installing Ollama, ':models.length?`No installed model fits in ${ram(mem)} GB of memory. `:'No local model is installed yet. ';
 const reason=`${lead}${pick.model} (about ${gb(pick.downloadBytes)} GB download) fits this device and is good at structured output.${short?` Free at least ${gb(pick.downloadBytes+2e9)} GB of disk first; ${gb(disk)} GB is free.`:''}`;
 return{models:ranked,recommendation:{kind:'pull',model:pick.model,command:`ollama pull ${pick.model}`,downloadBytes:pick.downloadBytes,reason}};
}

// ---------- dedicated runtime ----------
const CHAT_MAX_BYTES=2*1024*1024,INFO_MAX_BYTES=8*1024*1024,WATCHDOG=fileURLToPath(new URL('./local-watchdog.mjs',import.meta.url));
/** A dedicated `ollama serve` owned by this helper. All HTTP goes directly to its own loopback port; proxies are never used. */
export class OllamaRuntime{
 // The runtime is started through local-watchdog.mjs (with this Node executable), which stops it as soon as the helper's pipe closes, so a
 // helper killed without warning never leaves `ollama serve` behind.
 constructor({binary,modelsDir,lsof=['/usr/sbin/lsof','/usr/bin/lsof'],spawnImpl=spawn,startTimeoutMs=RUNTIME_START_TIMEOUT_MS,tmpRoot=os.tmpdir(),node=process.execPath}){
  if(unsafePath(binary)||unsafePath(modelsDir))throw new ApiError('LOCAL_RUNTIME_FAILED');
  Object.assign(this,{binary,modelsDir,lsofPaths:lsof,spawnImpl,startTimeoutMs,tmpRoot,node});this.version=null;this.info=new Map();
 }
 get running(){return!!this.child&&this.child.exitCode===null&&this.child.signalCode===null&&!!this.port&&!!this.serverPid;}
 async ensure(signal){
  if(this.running&&this.ready)return;
  this.starting??=this.start(signal).finally(()=>{this.starting=undefined;});
  return this.starting;
 }
 async start(signal){
  await this.stop();
  // Reserve an OS-assigned loopback port, then hand it to the dedicated runtime. Ownership is verified below before any request.
  const reservation=net.createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const home=await mkdtemp(path.join(this.tmpRoot,'treatable-ollama-'));
  const env={PATH:'/usr/bin:/bin',HOME:home,TMPDIR:home,OLLAMA_HOST:`127.0.0.1:${port}`,OLLAMA_MODELS:this.modelsDir,OLLAMA_NO_CLOUD:'1',OLLAMA_NOPRUNE:'1',OLLAMA_KEEP_ALIVE:'2m',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_QUEUE:'4'};
  let child;try{child=this.spawnImpl(this.node,[WATCHDOG,this.binary],{env,stdio:['pipe','pipe','ignore'],cwd:home});}catch{await rm(home,{recursive:true,force:true});throw new ApiError('LOCAL_RUNTIME_FAILED');}
  Object.assign(this,{child,port,home,ready:false,serverPid:undefined});child.stdin?.on('error',()=>{});
  // The watchdog reports the runtime's own pid once; the listener must belong to exactly that process.
  let line='';child.stdout?.setEncoding('utf8');child.stdout?.on('data',chunk=>{if(this.child!==child||this.serverPid)return;line+=chunk;if(line.length>200){line='';return;}const end=line.indexOf('\n');if(end<0)return;try{const v=JSON.parse(line.slice(0,end));if(Number.isSafeInteger(v?.pid)&&v.pid>1)this.serverPid=v.pid;}catch{}});let exited=false;child.once('error',()=>{exited=true;});child.once('exit',()=>{exited=true;if(this.child===child){this.ready=false;this.info.clear();}});
  const deadline=Date.now()+this.startTimeoutMs;
  try{
   while(Date.now()<deadline){
    if(signal?.aborted)throw new ApiError('CANCELLED');if(exited)throw new ApiError('LOCAL_RUNTIME_FAILED');
    if(await this.ownsListener()){try{const v=await this.raw('/api/version',undefined,{signal,timeout:2000,maxBytes:4096});if(typeof v?.version!=='string'||!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(v.version))throw new ApiError('LOCAL_RUNTIME_FAILED');this.version=v.version;this.ready=true;return;}catch{if(signal?.aborted)throw new ApiError('CANCELLED');}}
    await new Promise(r=>setTimeout(r,100));
   }
   throw new ApiError('LOCAL_RUNTIME_FAILED');
  }catch(e){await this.stop();throw e;}
 }
 /** The listening socket on our port must belong to the process we started, bound to 127.0.0.1 only. */
 async ownsListener(){
  const pid=this.serverPid;if(!pid||!this.port)return false;
  for(const lsof of this.lsofPaths){try{await access(lsof,constants.X_OK);}catch{continue;}const out=await execText(lsof,['-nP','-a','-p',String(pid),`-iTCP@127.0.0.1:${this.port}`,'-sTCP:LISTEN','-Fp'],1500);return out!==undefined&&out.split('\n').includes(`p${pid}`);}
  return false;
 }
 // node:http straight to the loopback port: proxy variables are never honored and no agent is shared.
 raw(route,body,{signal,timeout,maxBytes}){
  return new Promise((resolve,reject)=>{
   const timer=AbortSignal.timeout(timeout),combined=signal?AbortSignal.any([signal,timer]):timer,encoded=body===undefined?undefined:Buffer.from(JSON.stringify(body),'utf8');
   const fail=code=>reject(new ApiError(signal?.aborted?'CANCELLED':timer.aborted?'LOCAL_TIMEOUT':code));
   const request=loopbackRequest({hostname:'127.0.0.1',port:this.port,path:route,method:encoded?'POST':'GET',agent:false,signal:combined,headers:{Accept:'application/json',...(encoded?{'Content-Type':'application/json','Content-Length':encoded.length}:{})}},response=>{
    const chunks=[];let bytes=0;
    response.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){response.destroy();fail('LOCAL_INVALID_OUTPUT');}else chunks.push(chunk);});
    response.on('error',()=>fail('LOCAL_RUNTIME_FAILED'));
    response.on('end',()=>{let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{fail(response.statusCode===200?'LOCAL_INVALID_OUTPUT':'LOCAL_RUNTIME_FAILED');return;}
     if(response.statusCode===404&&route!=='/api/version'){reject(new ApiError('LOCAL_MODEL_UNAVAILABLE'));return;}
     if(response.statusCode<200||response.statusCode>=300){reject(new ApiError(route==='/api/chat'?'LOCAL_MODEL_FAILED':'LOCAL_RUNTIME_FAILED',response.statusCode));return;}resolve(value);});
   });
   request.on('error',()=>fail('LOCAL_RUNTIME_FAILED'));if(encoded)request.write(encoded);request.end();
  });
 }
 async request(route,body,{signal,timeout=5000,maxBytes=INFO_MAX_BYTES}={}){await this.ensure(signal);if(!await this.ownsListener())throw new ApiError('LOCAL_RUNTIME_FAILED');return this.raw(route,body,{signal,timeout,maxBytes});}
 /** Capabilities of one installed model, from the dedicated runtime. Remote (cloud) models never count as installed. */
 async describe(model,signal){
  if(!isLocalModelName(model))throw new ApiError('LOCAL_MODEL_UNAVAILABLE');if(this.info.has(model))return this.info.get(model);
  if(!await hasLocalWeights(this.modelsDir,model))throw new ApiError('LOCAL_MODEL_UNAVAILABLE');
  const show=await this.request('/api/show',{model},{signal,timeout:10000});
  const caps=Array.isArray(show?.capabilities)?show.capabilities:[],info={completion:!show?.remote_host&&!show?.remote_model&&caps.includes('completion'),thinking:caps.includes('thinking'),kvBytes:kvCacheBytes(show?.model_info)};
  this.info.set(model,info);return info;
 }
 /** One non-streaming chat request. Remote answers are refused; a timeout is reported as LOCAL_TIMEOUT, a stop as CANCELLED. */
 async chat(body,{signal,timeout}){
  const info=await this.describe(body?.model,signal);if(!info.completion)throw new ApiError('LOCAL_MODEL_UNAVAILABLE');
  const reply=await this.request('/api/chat',body,{signal,timeout,maxBytes:CHAT_MAX_BYTES});if(reply?.remote_host||reply?.remote_model)throw new ApiError('LOCAL_INVALID_OUTPUT');return reply;
 }
 async stop(){
  const child=this.child,home=this.home,server=this.serverPid;this.child=undefined;this.port=undefined;this.home=undefined;this.serverPid=undefined;this.ready=false;this.info.clear();
  // The watchdog stops the runtime's whole process group (SIGTERM, then SIGKILL after 1.5 s). Only if it has not finished after 4 s is the
  // group killed from here, followed by the watchdog itself.
  let exited=!child||child.exitCode!==null||child.signalCode!==null;
  if(!exited){const done=new Promise(r=>child.once('exit',()=>{exited=true;r();}));try{child.stdin?.end();child.kill('SIGTERM');}catch{}await Promise.race([done,new Promise(r=>setTimeout(r,4000))]);}
  if(!exited){try{if(server)process.kill(-server,'SIGKILL');}catch{}try{child.kill('SIGKILL');}catch{}}
  if(home)await rm(home,{recursive:true,force:true}).catch(()=>{});
 }
 /** For process exit: ask the watchdog to stop the runtime group. It also stops it on its own when this helper's pipe closes, and removes
  * the private HOME, so the watchdog is deliberately left alive to finish that work. */
 killNow(){const child=this.child;this.child=undefined;this.home=undefined;this.serverPid=undefined;try{child?.stdin?.end();child?.kill('SIGTERM');}catch{}}
}
/** Stand-in when Ollama is missing: every use reports LOCAL_NOT_INSTALLED. */
export const MISSING_RUNTIME=Object.freeze({version:null,async ensure(){throw new ApiError('LOCAL_NOT_INSTALLED');},async describe(){throw new ApiError('LOCAL_NOT_INSTALLED');},async chat(){throw new ApiError('LOCAL_NOT_INSTALLED');},async request(){throw new ApiError('LOCAL_NOT_INSTALLED');},async stop(){},killNow(){}});
