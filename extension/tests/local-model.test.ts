import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import TestRenderer,{act} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import {rm,mkdtemp,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {sessionDetailsStore,DetailsContext,type DetailsStore} from '../src/your-details';
import {useApply,type ApplyController,type ApplyEnv} from '../src/use-apply';
import {ApplyView} from '../src/apply-view';
import {installSiteAssistant} from '../src/site-background';
import {installApplyBroker,APPLY_PORT} from '../src/apply-background';
import {LocalModelsContext,LocalModelsStore} from '../src/local-models';
import {ModelProviderSettings} from '../src/model-settings';
import {FAILURE_COPY} from '../src/failures';
import {normalizeApplyRecord,normalizeStudyBrief} from '../shared/apply-record.mjs';
import {parseLocalModelsResult,type LocalModelsResult,type StudyBriefResult} from '../shared/apply-contract.mjs';
import {rawStudy,TOKEN,DIGEST} from './apply-fixture';
// @ts-expect-error test-only native module has no ambient declaration
import {installHost,writeHook,startHost,readLines} from '../native/test/host-harness.mjs';
// @ts-expect-error test-only native module has no ambient declaration
import {fakeOllama,modelsDir} from '../native/test/fake-ollama-harness.mjs';
// @ts-expect-error test-only native decoder module has no ambient declaration
import {MessageDecoder} from '../native/core.mjs';

const NAME='NAME_CANARY_41f0a',CONDITION='CONDITION_CANARY_77c2e',EXTRA='EXTRA_CANARY_0d9b1',MARKERS=[NAME,CONDITION,EXTRA];
const leaks=(value:unknown)=>{const text=typeof value==='string'?value:JSON.stringify(value)??'';return MARKERS.filter(m=>text.includes(m))};
class Events{listeners:((...v:any[])=>void)[]=[];addListener=(f:(...v:any[])=>void)=>{this.listeners.push(f)};removeListener=(f:(...v:any[])=>void)=>{this.listeners=this.listeners.filter(x=>x!==f)};emit=(...v:any[])=>{for(const f of [...this.listeners])f(...v)}}
const settle=async(ms=0)=>{await act(async()=>{await new Promise(r=>setTimeout(r,ms));for(let i=0;i<20;i++)await new Promise<void>(r=>queueMicrotask(r))})};
async function until(check:()=>unknown,what:string,ms=30000){const end=Date.now()+ms;for(;;){if(check())return;if(Date.now()>end)throw Error('timeout waiting for '+what);await settle(25)}}
/** Visible text of a rendered tree, with adjacent text nodes joined as the browser shows them. */
const textOf=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(textOf).join(''):node?.children?textOf(node.children):'';
const ID='NCT99999990',STUDY=`https://clinicaltrials.gov/study/${ID}`,GiB=1024**3;
function raw(){return{protocolSection:{identificationModule:{nctId:ID,briefTitle:'Synthetic public study for the local model canary',orgStudyIdInfo:{id:'SYNTHETIC-ONLY'}},descriptionModule:{briefSummary:'A public synthetic fixture.',detailedDescription:'Two treatments are spaced 4 weeks apart. Follow-up visits occur at 3 and 12 months post injection. Participants can cross over after follow-up.'},designModule:{designInfo:{allocation:'RANDOMIZED'}},statusModule:{overallStatus:'RECRUITING'},eligibilityModule:{},contactsLocationsModule:{centralContacts:[{name:'Study Coordinator',phone:'303-555-0100',email:'coordinator@example.org'}]}}}}

test('canary: a local study brief runs through the real broker, native helper and dedicated runtime; Your details never leave the drafts and nothing reaches OpenAI',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'treatable-local-canary-')),fake=await fakeOllama(root),models=await modelsDir(root);
 const installed=await installHost('treatable-local-canary-host-',['--ollama-path',fake.binary,'--ollama-models',models]);let host:any,renderer:TestRenderer.ReactTestRenderer|undefined;
 try{
  host=startHost(installed,{hook:await writeHook(installed.home,{log:installed.log,govRecords:{[ID]:raw()}})});
  const native={sent:[] as any[],closed:false,onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){this.sent.push(structuredClone(v));host.send(v)},disconnect(){if(this.closed)return;this.closed=true;host.child.stdin.end()}};
  const decoder=new MessageDecoder((v:any)=>native.onMessage.emit(v),()=>{throw Error('Invalid test frame')});host.child.stdout.on('data',(chunk:any)=>decoder.push(chunk));
  const connect=new Events(),scripts:any[]=[],overlaySent:any[]=[],brokerPorts:any[]=[],origin='chrome-extension://test';
  const api:any={runtime:{id:'test',lastError:undefined,getURL:(p:string)=>origin+'/'+p,onConnect:connect,onMessage:new Events(),connectNative:()=>native},action:{onClicked:new Events()},tabs:{get:async()=>({id:1,url:STUDY}),update:async()=>{},sendMessage:async(_id:number,m:any)=>({ok:true,result:['snapshot','availability','clearAvailability','restore'].includes(m.type)?{generation:'doc-1',url:STUDY,nctIds:[],diagnostic:'Study page.',supported:false}:{}}),onUpdated:new Events(),onRemoved:new Events()},scripting:{executeScript:async(v:any)=>{scripts.push({...v,func:undefined,args:structuredClone(v.args)});return[]}},windows:{create:async()=>({id:2,tabs:[{id:9}]})}};
  const site=installSiteAssistant(api,{lookupPublicStatus:async()=>'RECRUITING'});installApplyBroker(api,site,{fetchStudyJson:async()=>raw(),now:()=>Date.now()});
  const frame={id:'test',tab:{id:1,url:STUDY},frameId:2,documentId:'frame-doc',url:origin+'/overlay.html'};
  await site.launch({id:1,url:STUDY});const sitePort={name:'treatable.site.overlay.v1',sender:frame,sent:[] as any[],onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){this.sent.push(structuredClone(v))},disconnect(){}};connect.emit(sitePort);sitePort.onMessage.emit({type:'site.authenticate',capability:scripts.at(-1).args[0].capability});await settle();
  const runtime={connect:({name}:{name:string})=>{assert.equal(name,APPLY_PORT);const client:any={onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){const c=structuredClone(v);overlaySent.push(c);queueMicrotask(()=>server.onMessage.emit(c))},disconnect(){server.onDisconnect.emit()}};const server:any={name,sender:frame,sent:[] as any[],closed:false,onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){const c=structuredClone(v);this.sent.push(c);queueMicrotask(()=>client.onMessage.emit(c))},disconnect(){if(this.closed)return;this.closed=true;client.onDisconnect.emit()}};brokerPorts.push(server);connect.emit(server);return client}};
  const env:ApplyEnv={runtime,loadZips:async()=>({zips:{}}),userActivated:()=>true,today:()=>new Date(),now:()=>Date.now(),copyText:async()=>{},download:()=>{},openMailto:()=>{}};
  const store:DetailsStore=sessionDetailsStore(),localModels=new LocalModelsStore(),ref:{vm?:ApplyController}={};let model:string|null=null;
  function Probe(){const vm=useApply(ID,env,undefined,{provider:'local',localModel:model});ref.vm=vm;return React.createElement(React.Fragment,null,React.createElement(ModelProviderSettings,{provider:'local',localModel:model,setProvider:()=>{},setLocalModel:(v:string|null)=>{model=v}}),React.createElement(ApplyView,{vm}))}
  await act(async()=>{renderer=TestRenderer.create(React.createElement(DetailsContext.Provider,{value:store},React.createElement(LocalModelsContext.Provider,{value:localModels},React.createElement(Probe))))});
  await until(()=>ref.vm?.record&&ref.vm.phase==='ready','public record');
  // Settings checks Ollama through the same validated session and picks the recommended installed model.
  await until(()=>localModels.get().status==='ready','local model check');const check=(localModels.get() as {result:LocalModelsResult}).result;
  assert.equal(check.ollama.status,'ready');assert.equal(check.recommendation.kind,'installed');assert.ok(check.models.every(m=>!/embed|cloud|mirror|ghost/.test(m.name)));
  await until(()=>model!==null,'recommended model chosen');assert.equal(model,(check.recommendation as any).model);await act(async()=>renderer!.update(React.createElement(DetailsContext.Provider,{value:store},React.createElement(LocalModelsContext.Provider,{value:localModels},React.createElement(Probe)))));
  let text=JSON.stringify(renderer!.toJSON());assert.match(text,/Recommended/);assert.match(text,/via Ollama on this device/);assert.match(text,/nothing is sent to OpenAI/);
  await act(async()=>store.set({name:NAME,condition:CONDITION,extra:EXTRA}));
  await act(async()=>ref.vm!.requestReview());await until(()=>ref.vm!.result||ref.vm!.agentCode,'local study brief result');
  const vm=ref.vm!;assert.equal(vm.agentCode,undefined);assert.equal(vm.result!.mode,'local');assert.equal(vm.result!.agentStatus,'complete');assert.equal(vm.result!.decisionStatus,'complete');assert.equal(vm.result!.local!.model,model);
  text=textOf(renderer!.toJSON());assert.ok(text.includes(`Local model: ${model} via Ollama 0.99.0 on this device; nothing was sent to OpenAI.`),'the panel names the local model and says nothing went to OpenAI');assert.match(text,/Model-reported, not calibrated/);assert.doesNotMatch(text,/Provider session deletion/);
  for(const [label,draft] of [['email draft',vm.draft!.body],['call script',vm.callScript],['follow-up message',vm.followUpMessage]] as const)assert.deepEqual(leaks(draft),MARKERS,label);
  const ollamaLog=await readLines(fake.log),openai=(await readLines(installed.log)).filter((c:any)=>c.host==='api.openai.com');
  const outbound:Record<string,unknown>={'overlay → broker':overlaySent,'broker → overlay':brokerPorts.map(p=>p.sent),'broker → native':native.sent,'native frames':host.frames,'local runtime requests (bodies, env)':ollamaLog,'native stderr':host.stderr(),'activity and result':[vm.activity,vm.result]};
  for(const [where,value] of Object.entries(outbound))assert.deepEqual(leaks(value),[],where);
  assert.equal(openai.length,0,'nothing was sent to OpenAI');let reads='';try{reads=await readFile(installed.reads,'utf8')}catch{}assert.equal(reads,'','no Keychain read');
  assert.equal(ollamaLog.filter((x:any)=>x.path==='/api/chat').length,2);assert.ok(native.sent.some(v=>v.type==='prepareStudyBrief'&&v.payload.provider==='local'&&v.payload.model===model));
  await act(async()=>ref.vm!.end());
 }finally{if(renderer)act(()=>renderer!.unmount());try{host?.child.stdin.end()}catch{}host?.child.kill('SIGKILL');await rm(installed.home,{recursive:true,force:true});await rm(root,{recursive:true,force:true})}
});

/* Broker: the engine must be echoed exactly, a local result must come from a local preparation, and the model check carries no input. */
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r))};
function broker(){
 const connect=new Events(),scripts:any[]=[],natives:any[]=[],origin='chrome-extension://test',url='https://clinicaltrials.gov/study/NCT07254806';
 const api:any={runtime:{id:'test',lastError:undefined,getURL:(p:string)=>origin+'/'+p,onConnect:connect,onMessage:new Events(),connectNative:()=>{const n={sent:[] as any[],closed:false,onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){this.sent.push(structuredClone(v))},disconnect(){this.closed=true}};natives.push(n);return n}},action:{onClicked:new Events()},tabs:{get:async()=>({id:1,url}),update:async()=>{},sendMessage:async(_:number,m:any)=>({ok:true,result:['snapshot','availability','clearAvailability','restore'].includes(m.type)?{generation:'doc-1',url,nctIds:[],diagnostic:'x',supported:false}:{}}),onUpdated:new Events(),onRemoved:new Events()},scripting:{executeScript:async(v:any)=>{scripts.push(v);return[]}},windows:{create:async()=>({id:2,tabs:[{id:9}]})}};
 const site=installSiteAssistant(api,{lookupPublicStatus:async()=>'RECRUITING'});installApplyBroker(api,site,{fetchStudyJson:async()=>rawStudy(),now:()=>Date.UTC(2026,9,24,15,15)});
 const frame={id:'test',tab:{id:1,url},frameId:2,documentId:'frame-doc',url:origin+'/overlay.html'};
 const port=(name:string)=>{const p={name,sender:frame,sent:[] as any[],closed:false,onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){this.sent.push(structuredClone(v))},disconnect(){if(this.closed)return;this.closed=true;this.onDisconnect.emit()}};connect.emit(p);return p};
 return{natives,async open(){await site.launch({id:1,url});const o=port('treatable.site.overlay.v1');o.onMessage.emit({type:'site.authenticate',capability:scripts.at(-1).args[0].capability});await flush();const p=port(APPLY_PORT);await flush();return p},
  send:async(p:any,request:any)=>{p.onMessage.emit({kind:'applyNative',request});await flush()},reply:async(n:any,v:any)=>{n.onMessage.emit(structuredClone(v));await flush()}};
}
const replies=(p:any)=>p.sent.filter((v:any)=>v.reply).map((v:any)=>v.reply);
const preparedBrief=(engine?:{provider:'local';model:string})=>{const r=rawStudy();return{kind:'preparedStudyBrief',token:TOKEN,digest:DIGEST,expiresAt:Date.UTC(2026,9,24,15,20),records:[normalizeApplyRecord(r,1,16000)],briefs:[normalizeStudyBrief(r,1)],...(engine?{engine}:{})}};
function localResult(model='qwen3.5:9b'):StudyBriefResult{const b=normalizeStudyBrief(rawStudy(),1),body=(v:unknown)=>{const text=JSON.stringify(v,null,2);return{text,bytes:new TextEncoder().encode(text).length,truncated:false}};
 return{kind:'studyBrief',mode:'local',digest:DIGEST,briefs:[b],studyPlans:[{nctId:b.nctId,briefItemIds:[],questionIds:['still_enrolling','visits','next_steps'],prescreenIds:['diagnosis_details','prior_treatments'],flagIds:[],routes:[{questionId:'still_enrolling',route:'ask_coordinator',evidenceIds:[]},{questionId:'visits',route:'ask_patient',evidenceIds:[]},{questionId:'next_steps',route:'ask_coordinator',evidenceIds:[]}],prioritizedQuestionIds:['still_enrolling','next_steps']}],agentStatus:'complete',decisionStatus:'complete',failureCodes:[],cleanup:'not_started',toolCalls:0,local:{model,runtime:'ollama',version:'0.32.1',steps:[{step:'brief',status:'complete',durationMs:41000,request:body({model,messages:[]}),output:body({studies:[]})},{step:'routing',status:'complete',durationMs:9000,request:body({model}),output:body({routes:[]})}],confidences:[{nctId:b.nctId,questionId:'visits',confidence:0.62}]}}}
const LOCAL_CHECK:LocalModelsResult={kind:'localModels',ollama:{status:'ready',version:'0.32.1'},machine:{platform:'macos',arch:'arm64',cpu:'Apple M1 Max',memoryBytes:32*GiB,appleSilicon:true,unifiedMemory:true,freeDiskBytes:20e9},models:[{name:'qwen3.5:9b',sizeBytes:6594474711,family:'qwen35',parameterSize:'9.7B',quantization:'Q4_K_M',estimatedMemoryBytes:8253922182,fit:'comfortable',structured:'strong',recommended:true},{name:'qwen3:32b',sizeBytes:20201253829,family:'qwen3',parameterSize:'32.8B',quantization:'Q4_K_M',estimatedMemoryBytes:23221379212,fit:'too_large',structured:'good',recommended:false}],recommendation:{kind:'installed',model:'qwen3.5:9b',reason:'qwen3.5:9b fits in 32 GB of memory with room for macOS and Chrome (about 8.3 GB in use) and is good at structured output.'}};

test('broker: the local model check forwards an empty request and only a localModels reply; malformed checks end the channel',async()=>{
 const b=broker(),p=await b.open();await b.send(p,{id:'m',type:'localModels',payload:{}});const n=b.natives[0];assert.deepEqual(n.sent.at(-1),{id:'m',type:'localModels',payload:{}});
 await b.reply(n,{id:'m',type:'result',ok:true,result:LOCAL_CHECK});assert.deepEqual(replies(p).at(-1).result,LOCAL_CHECK);
 await b.send(p,{id:'m2',type:'localModels',payload:{}});await b.reply(n,{id:'m2',type:'result',ok:true,result:preparedBrief()});assert.equal(replies(p).at(-1).code,'RESULT_MISMATCH');
 await b.send(p,{id:'m3',type:'localModels',payload:{}});await b.reply(n,{id:'m3',type:'result',ok:false,code:'INVALID_REQUEST',error:'x'});assert.equal(replies(p).at(-1).code,'HELPER_VERSION_MISMATCH','an older helper without the local check is reported as a version mismatch');
 await b.send(p,{id:'bad',type:'localModels',payload:{model:'qwen3.5:9b'}});assert.equal(p.closed,true);
});

test('broker: a local preparation must echo the requested engine, and only a local result settles a local run',async()=>{
 const engine={provider:'local' as const,model:'qwen3.5:9b'};
 let b=broker(),p=await b.open();await b.send(p,{id:'p',type:'prepareStudyBrief',payload:{nctIds:['NCT07254806'],provider:'local',model:'qwen3.5:9b'}});let n=b.natives[0];assert.deepEqual(n.sent.at(-1).payload,{nctIds:['NCT07254806'],provider:'local',model:'qwen3.5:9b'});
 await b.reply(n,{id:'p',type:'result',ok:true,result:preparedBrief()});assert.equal(replies(p).at(-1).code,'RESULT_MISMATCH','an OpenAI preparation cannot answer a local request');
 await b.send(p,{id:'p2',type:'prepareStudyBrief',payload:{nctIds:['NCT07254806'],provider:'local',model:'qwen3.5:9b'}});await b.reply(n,{id:'p2',type:'result',ok:true,result:preparedBrief({provider:'local',model:'gemma4:latest'})});assert.equal(replies(p).at(-1).code,'RESULT_MISMATCH','a different model is refused');
 await b.send(p,{id:'p3',type:'prepareStudyBrief',payload:{nctIds:['NCT07254806']}});await b.reply(n,{id:'p3',type:'result',ok:true,result:preparedBrief(engine)});assert.equal(replies(p).at(-1).code,'RESULT_MISMATCH','a local preparation cannot answer an OpenAI request');
 await b.send(p,{id:'p4',type:'prepareStudyBrief',payload:{nctIds:['NCT07254806'],provider:'local',model:'qwen3.5:9b'}});await b.reply(n,{id:'p4',type:'result',ok:true,result:preparedBrief(engine)});assert.equal(replies(p).at(-1).ok,true);
 await b.send(p,{id:'run',type:'executeStudyBrief',payload:{token:TOKEN,digest:DIGEST}});await b.reply(n,{id:'run',type:'trace',ok:true,trace:{sequence:1,stage:'local.runtime.start'}});assert.equal(replies(p).at(-1).trace.stage,'local.runtime.start');
 await b.reply(n,{id:'run',type:'result',ok:true,result:localResult()});assert.equal(replies(p).at(-1).result.mode,'local');
 b=broker();p=await b.open();await b.send(p,{id:'p',type:'prepareStudyBrief',payload:{nctIds:['NCT07254806'],provider:'local',model:'qwen3.5:9b'}});n=b.natives[0];await b.reply(n,{id:'p',type:'result',ok:true,result:preparedBrief(engine)});
 await b.send(p,{id:'run',type:'executeStudyBrief',payload:{token:TOKEN,digest:DIGEST}});const{local:_,...live}=localResult();await b.reply(n,{id:'run',type:'result',ok:true,result:{...live,mode:'live',cleanup:'deleted',toolCalls:1}});assert.equal(replies(p).at(-1).code,'RESULT_MISMATCH','an OpenAI result cannot settle a local run');
});

/* Settings → Model provider. */
function settingsWith(state:(s:LocalModelsStore)=>void,props:Partial<React.ComponentProps<typeof ModelProviderSettings>>={}){
 const store=new LocalModelsStore();state(store);const chosen:any[]=[];
 const html=renderToStaticMarkup(React.createElement(LocalModelsContext.Provider,{value:store},React.createElement(ModelProviderSettings,{provider:'local',localModel:'qwen3.5:9b',setProvider:()=>{},setLocalModel:v=>chosen.push(v),...props})));
 return{html,chosen,store};
}
const ready=(result:LocalModelsResult)=>(s:LocalModelsStore)=>{s.setDetector(async()=>result);(s as any).state={status:'ready',result}};
test('settings: OpenAI is the default; Local lists installed models with the recommended one marked, the device profile and the privacy note',()=>{
 const openai=settingsWith(()=>{}, {provider:'openai'});assert.match(openai.html,/<option value="openai" selected="">OpenAI \(default\)<\/option>/);assert.doesNotMatch(openai.html,/Local model<select/);
 const{html}=settingsWith(ready(LOCAL_CHECK));
 assert.match(html,/<option value="local" selected="">Local model \(Ollama on this device\)<\/option>/);
 assert.match(html,/qwen3\.5:9b · 6\.6 GB · Recommended/);assert.match(html,/qwen3:32b · 20 GB · may not fit in memory/);
 assert.match(html,/This device: Apple M1 Max · 32 GB unified memory · 20 GB free disk · Ollama 0\.32\.1/);
 assert.match(html,/Recommended:<\/strong> qwen3\.5:9b fits in 32 GB of memory/);assert.match(html,/Nothing is sent to OpenAI\. Quality and speed depend on this computer and the model/);
});
test('settings: missing Ollama links to the official download; no suitable model shows the exact pull command; failures use fixed copy',()=>{
 const missing:LocalModelsResult={...LOCAL_CHECK,ollama:{status:'not_installed',version:null},models:[],recommendation:{kind:'pull',model:'qwen3.5:9b',command:'ollama pull qwen3.5:9b',downloadBytes:6.6e9,reason:'After installing Ollama, qwen3.5:9b (about 6.6 GB download) fits this device and is good at structured output.'}};parseLocalModelsResult(missing);
 let{html}=settingsWith(ready(missing));assert.match(html,/Ollama is not installed on this device\. <a href="https:\/\/ollama\.com\/download" target="_blank" rel="noopener noreferrer">Download Ollama<\/a>/);assert.match(html,/<code>ollama pull qwen3\.5:9b<\/code>/);assert.match(html,/Treatable never downloads models/);
 const tooBig:LocalModelsResult={...LOCAL_CHECK,models:[{...LOCAL_CHECK.models[1]}],recommendation:{kind:'pull',model:'qwen3.5:9b',command:'ollama pull qwen3.5:9b',downloadBytes:6.6e9,reason:'No installed model fits in 32 GB of memory. qwen3.5:9b (about 6.6 GB download) fits this device and is good at structured output.'}};parseLocalModelsResult(tooBig);
 ({html}=settingsWith(ready(tooBig)));assert.match(html,/No installed model fits in 32 GB/);assert.match(html,/<code>ollama pull qwen3\.5:9b<\/code>/);assert.match(html,/qwen3\.5:9b is not installed on this device\. Choose another model\./);
 ({html}=settingsWith(s=>{(s as any).state={status:'failed',code:'LOCAL_RUNTIME_FAILED'}}));assert.ok(html.includes(FAILURE_COPY.LOCAL_RUNTIME_FAILED.replace(/’/g,'’')));
 ({html}=settingsWith(s=>{(s as any).state={status:'unavailable'}}));assert.match(html,/Open a ClinicalTrials\.gov study or results page/);
});
test('local model store: a check needs a registered session; a result from an ended session is ignored',async()=>{
 const s=new LocalModelsStore();s.check();assert.equal(s.get().status,'unavailable');let release!:(v:LocalModelsResult)=>void;const off=s.setDetector(()=>new Promise(r=>{release=r}));assert.equal(s.get().status,'idle');
 s.check();assert.equal(s.get().status,'checking');off();assert.equal(s.get().status,'idle');release(LOCAL_CHECK);await flush();assert.equal(s.get().status,'idle','late result from an ended session is dropped');
 s.setDetector(async()=>{throw Object.assign(Error('x'),{code:'x'})});s.check();await flush();assert.deepEqual(s.get(),{status:'failed',code:'UNEXPECTED_FAILURE'});
});
test('study brief view: a local result says which model ran on this device, that nothing went to OpenAI, and labels confidence as model-reported',()=>{
 const result=localResult(),b=result.briefs[0],r=normalizeApplyRecord(rawStudy(),1);
 const vm:any={phase:'ready',nctId:b.nctId,engine:{provider:'local',localModel:'qwen3.5:9b'},activity:[{sequence:1,stage:'local.runtime.start'},{sequence:2,stage:'local.brief.request'}],analysisInput:{nctIds:[b.nctId],sourceItemIds:['e1']},candidates:[{nctId:b.nctId}],selectedIds:[b.nctId],records:[r],record:r,brief:b,result,agentBusy:false,patient:{name:'',phone:'',email:'',bestTimes:'',zip:'',answers:{}},zipNote:'',plan:{nctId:b.nctId,questionIds:['still_enrolling'],answerIds:[],siteOptions:[],flagIds:[],callContacts:[],backups:[],followUp:'',phoneScript:'',followUpMessage:'',subject:'s',body:'b'},draftEdited:false,draftOutdated:false,draftHeaders:false,callScript:'',callScriptEdited:false,callScriptOutdated:false,followUpMessage:'',followUpEdited:false,followUpOutdated:false,copied:'',reminder:''};
 const html=renderToStaticMarkup(React.createElement(ApplyView,{vm}));
 assert.match(html,/with the local model <strong>qwen3\.5:9b<\/strong> via Ollama on this device/);assert.match(html,/Local model qwen3\.5:9b: brief complete · question routing complete · nothing sent to OpenAI/);
 assert.match(html,/Local model: qwen3\.5:9b via Ollama 0\.32\.1 on this device; nothing was sent to OpenAI\./);assert.match(html,/Starting the private Ollama runtime on this device/);
 assert.match(html,/Model-reported, not calibrated/);assert.match(html,/0\.62/);assert.match(html,/Local request body/);assert.match(html,/Model output/);assert.doesNotMatch(html,/Provider session deletion|public-record tool lookups/);
 const openaiView=renderToStaticMarkup(React.createElement(ApplyView,{vm:{...vm,engine:{provider:'openai',localModel:null},result:undefined,activity:[]}}));assert.match(openaiView,/using OpenAI Agents and Decisions/);assert.doesNotMatch(openaiView,/Ollama/);
});
