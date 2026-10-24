import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import TestRenderer,{act} from 'react-test-renderer';
import {rm} from 'node:fs/promises';
import {sessionDetailsStore,DetailsContext,BLANK_DETAILS,YOUR_DETAILS_LIMITS,type DetailsStore} from '../src/your-details';
import {useApply,type ApplyController,type ApplyEnv} from '../src/use-apply';
import {ApplyView} from '../src/apply-view';
import {OverlayAssistant} from '../src/overlay-app';
import {captureSiteActivations} from '../src/overlay-port';
import {SITE_FILTERS} from '../src/site-filter-catalog';
import {installSiteAssistant} from '../src/site-background';
import {installApplyBroker,APPLY_PORT} from '../src/apply-background';
import {buildApplyPlan} from '../src/apply-plan';
import {normalizeApplyRecord,normalizeStudyBrief} from '../shared/apply-record.mjs';
import {record as fixtureRecord,TODAY,patient} from './apply-fixture';
// @ts-expect-error test-only native module has no ambient declaration
import {installHost,writeHook,startHost,readLines} from '../native/test/host-harness.mjs';
// @ts-expect-error test-only native decoder module has no ambient declaration
import {MessageDecoder} from '../native/core.mjs';

/** Unique markers, one per "Your details" field. They must reach the local drafts and nothing else. */
const NAME='NAME_CANARY_5c1e7',CONDITION='CONDITION_CANARY_8a42b',EXTRA='EXTRA_CANARY_e97d3',MARKERS=[NAME,CONDITION,EXTRA];
const leaks=(value:unknown)=>{const text=typeof value==='string'?value:JSON.stringify(value)??'';return MARKERS.filter(m=>text.includes(m))};
class Events{listeners:((...v:any[])=>void)[]=[];addListener=(f:(...v:any[])=>void)=>{this.listeners.push(f)};removeListener=(f:(...v:any[])=>void)=>{this.listeners=this.listeners.filter(x=>x!==f)};emit=(...v:any[])=>{for(const f of [...this.listeners])f(...v)}}
const settle=async(ms=0)=>{await act(async()=>{await new Promise(r=>setTimeout(r,ms));for(let i=0;i<20;i++)await new Promise<void>(r=>queueMicrotask(r))})};
async function until(check:()=>unknown,what:string,ms=20000){const end=Date.now()+ms;for(;;){if(check())return;if(Date.now()>end)throw Error('timeout waiting for '+what);await settle(25)}}
const ID='NCT99999990',STUDY=`https://clinicaltrials.gov/study/${ID}`;
function raw(){return{protocolSection:{identificationModule:{nctId:ID,briefTitle:'Synthetic public study for the details canary',orgStudyIdInfo:{id:'SYNTHETIC-ONLY'}},descriptionModule:{briefSummary:'A public synthetic fixture.',detailedDescription:'Two treatments are spaced 4 weeks apart. Follow-up visits occur at 3 and 12 months post injection. Participants can cross over after follow-up.'},designModule:{designInfo:{allocation:'RANDOMIZED'}},statusModule:{overallStatus:'RECRUITING'},eligibilityModule:{},contactsLocationsModule:{centralContacts:[{name:'Study Coordinator',phone:'303-555-0100',phoneExt:'7',email:'coordinator@example.org'}],locations:[{facility:'Synthetic Clinic',status:'RECRUITING',city:'Example City',state:'Colorado',country:'United States',contacts:[{name:'Site Nurse',phone:'(303) 555-0111',email:'site@example.org'}]}]}}}}
function agentOutput(){const b=normalizeStudyBrief(raw(),1),e=b.items.find(x=>x.text==='Two treatments are spaced 4 weeks apart.')!;return JSON.stringify({studies:[{nctId:ID,claims:[{category:e.category,text:e.text,evidenceIds:[e.id],sourceQuotes:[e.text]}],questionIds:['still_enrolling','visits','next_steps'],prescreenIds:['diagnosis_details','prior_treatments'],flagIds:[],questionEvidence:['still_enrolling','visits','next_steps'].map(questionId=>({questionId,evidenceIds:[]}))}]})}

test('session store keeps bounded values in memory only, clears, and has no persistent mode',()=>{
 const store=sessionDetailsStore();let changes=0;const off=store.subscribe(()=>changes++);
 assert.equal(store.persistence,'session');assert.deepEqual(store.get(),BLANK_DETAILS);
 store.set({name:'x'.repeat(500),condition:'c',extra:'e',other:'ignored'} as any);assert.equal(store.get().name.length,YOUR_DETAILS_LIMITS.name);assert.equal(store.get().condition,'c');assert.equal((store.get() as any).other,undefined);assert.ok(Object.isFrozen(store.get()));
 store.clear();assert.deepEqual(store.get(),BLANK_DETAILS);assert.equal(changes,2);off();store.set({name:'y'});assert.equal(changes,2);
 assert.notStrictEqual(sessionDetailsStore().get(),undefined);store.clear();
});

test('details fill the email, call script and follow-up message; a per-study name still takes priority; .ics stays free of them',()=>{
 const r=fixtureRecord(),details={name:NAME,condition:`${CONDITION}\n\n\n\nsecond paragraph\u0007`,extra:EXTRA},blank={...patient(),name:''};
 const plan=buildApplyPlan({record:r,patient:blank,details,today:TODAY});
 for(const text of [plan.body,plan.phoneScript,plan.followUpMessage])for(const m of MARKERS)assert.ok(text.includes(m),m);
 assert.match(plan.body,/Why I am reaching out:\nCONDITION_CANARY_8a42b\n\nsecond paragraph\n/);assert.match(plan.body,/Something else I would like you to know:\nEXTRA_CANARY_e97d3/);assert.match(plan.body,/Thank you,\nNAME_CANARY_5c1e7$/);
 assert.match(plan.phoneScript,/If they ask why you are interested, you can say:\nCONDITION_CANARY/);assert.match(plan.phoneScript,/Also mention:\nEXTRA_CANARY/);
 assert.match(plan.followUpMessage,/^Hello /);assert.match(plan.followUpMessage,/following up on my earlier message/);
 assert.deepEqual(plan.missing,[],'the details name satisfies the name check');
 const own=buildApplyPlan({record:r,patient:patient(),details,today:TODAY});assert.match(own.body,/My name is Morgan Example\./);assert.ok(own.body.includes(CONDITION));
 for(const value of [plan.subject,plan.followUp,plan.tel,JSON.stringify(plan.callContacts),plan.mailto?.split('&body=')[0]])assert.deepEqual(leaks(value),[],String(value));
 const none=buildApplyPlan({record:r,patient:patient(),today:TODAY});assert.doesNotMatch(none.body,/Why I am reaching out|Something else/);
});

test('settings fields edit the session store; Clear and ending the Treatable session wipe them',async(t)=>{
 const old={window:(globalThis as any).window,document:(globalThis as any).document,chrome:(globalThis as any).chrome};const win:any=new EventTarget(),doc:any=new EventTarget(),parent={postMessage(){}};win.parent=parent;doc.visibilityState='visible';doc.hidden=false;
 const messages=new Events(),storageCalls:string[]=[],area=new Proxy({},{get:(_t,key)=>()=>{storageCalls.push(String(key));throw Error('storage prohibited')}});
 const sitePort:any={onMessage:messages,onDisconnect:new Events(),disconnect(){},postMessage(v:any){if(v.type==='site.authenticate')messages.emit({type:'site.ready',snapshot:{generation:'g',url:'https://clinicaltrials.gov/search?cond=x',nctIds:[],diagnostic:'',supported:false},filters:SITE_FILTERS,search:{}});else messages.emit({id:v.id,ok:true,result:{active:true}})}};
 const applyPort:any={onMessage:new Events(),onDisconnect:new Events(),postMessage(){},disconnect(){}};
 const runtime={connect:({name}:{name:string})=>{if(name==='treatable.site.overlay.v1')return sitePort;if(name==='treatable-apply-v1')return applyPort;throw Error('unexpected port '+name)},sendMessage:async()=>({ok:true}),getURL:(v:string)=>`chrome-extension://test/${v}`};
 for(const[key,value]of Object.entries({window:win,document:doc,chrome:{runtime,storage:{local:area,session:area}}}))Object.defineProperty(globalThis,key,{configurable:true,value});captureSiteActivations(win);let renderer!:TestRenderer.ReactTestRenderer;
 try{await act(async()=>{renderer=TestRenderer.create(React.createElement(OverlayAssistant),{createNodeMock:()=>({focus(){}})});const e=new Event('message');Object.assign(e,{source:parent,origin:'https://clinicaltrials.gov',data:{type:'treatable.site.activate',purpose:'overlay',capability:'a'.repeat(64)}});win.dispatchEvent(e)});await settle();
  await act(async()=>renderer.root.findByProps({'aria-label':'Treatable settings'}).props.onClick());
  const field=(label:RegExp)=>renderer.root.findAll(n=>(n.type==='input'||n.type==='textarea')&&n.parent?.type==='label'&&label.test(String([n.parent.props.children].flat()[0])));
  assert.equal(field(/Your name/).length,1);assert.equal(field(/illness, condition, symptoms or reason/).length,1);assert.equal(field(/Anything else to include/).length,1);
  for(const [label,value] of [[/Your name/,NAME],[/illness, condition/,CONDITION],[/Anything else/,EXTRA]] as const)await act(async()=>field(label)[0].props.onChange({target:{value}}));
  assert.equal(field(/Your name/)[0].props.value,NAME);assert.equal(field(/illness, condition/)[0].props.autoComplete,'off');
  const clear=()=>renderer.root.findAll(n=>n.type==='button'&&n.props.children==='Clear my details')[0];assert.equal(clear().props.disabled,false);
  await act(async()=>clear().props.onClick());assert.equal(field(/Your name/)[0].props.value,'');assert.equal(field(/Anything else/)[0].props.value,'');assert.equal(clear().props.disabled,true);
  await act(async()=>field(/illness, condition/)[0].props.onChange({target:{value:CONDITION}}));assert.equal(field(/illness, condition/)[0].props.value,CONDITION);
  await act(async()=>renderer.root.findByProps({'aria-label':'Close Treatable and end session'}).props.onClick());await settle();assert.equal(field(/illness, condition/)[0].props.value,'','ending the session wipes the details');
  assert.ok(renderer.root.findAll(n=>n.type==='fieldset'&&n.props.disabled===true).length>0,'fields are disabled once the session ended');act(()=>renderer.unmount());
  await act(async()=>{renderer=TestRenderer.create(React.createElement(OverlayAssistant),{createNodeMock:()=>({focus(){}})});const e=new Event('message');Object.assign(e,{source:parent,origin:'https://clinicaltrials.gov',data:{type:'treatable.site.activate',purpose:'overlay',capability:'b'.repeat(64)}});win.dispatchEvent(e)});await settle();
  await act(async()=>renderer.root.findByProps({'aria-label':'Treatable settings'}).props.onClick());await act(async()=>field(/Your name/)[0].props.onChange({target:{value:NAME}}));assert.equal(field(/Your name/)[0].props.value,NAME,'a new frame starts blank and accepts input');
  await act(async()=>sitePort.onDisconnect.emit());await settle();assert.equal(field(/Your name/)[0].props.value,'','a lost site session also wipes them');
  assert.deepEqual(storageCalls,[],'no extension storage call of any kind');
 }finally{if(renderer)act(()=>renderer.unmount());for(const[key,value]of Object.entries(old))Object.defineProperty(globalThis,key,{configurable:true,value})}
});

test('canary: Generate study brief through the real broker and native helper (fake provider) never carries Your details; the local drafts do',async(t)=>{
 const installed=await installHost('treatable-details-canary-');let host:any;const consoleLines:unknown[]=[];
 for(const method of ['log','info','warn','error','debug','trace'] as const)t.mock.method(console,method,(...args:unknown[])=>{consoleLines.push(args)});
 const fetchCalls:unknown[]=[];t.mock.method(globalThis,'fetch',async(...args:unknown[])=>{fetchCalls.push(args);throw Error('network is not used in this test')});
 let renderer:TestRenderer.ReactTestRenderer|undefined;
 try{
  host=startHost(installed,{hook:await writeHook(installed.home,{log:installed.log,govRecords:{[ID]:raw()},briefOutput:agentOutput()})});
  // Broker → native helper, over the real stdio framing.
  const native={sent:[] as any[],closed:false,onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){this.sent.push(structuredClone(v));host.send(v)},disconnect(){if(this.closed)return;this.closed=true;host.child.stdin.end()}};
  const decoder=new MessageDecoder((v:any)=>native.onMessage.emit(v),()=>{throw Error('Invalid test frame')});host.child.stdout.on('data',(chunk:any)=>decoder.push(chunk));
  // Real site assistant and apply broker on a fake Chrome API that records every outbound call.
  const connect=new Events(),scripts:any[]=[],tabUpdates:any[]=[],contentCommands:any[]=[],publicFetches:string[]=[],brokerPorts:any[]=[],overlaySent:any[]=[],origin='chrome-extension://test';
  const api:any={runtime:{id:'test',lastError:undefined,getURL:(p:string)=>origin+'/'+p,onConnect:connect,onMessage:new Events(),connectNative:()=>native},action:{onClicked:new Events()},tabs:{get:async()=>({id:1,url:STUDY}),update:async(...a:any[])=>{tabUpdates.push(a)},sendMessage:async(_id:number,m:any)=>{contentCommands.push(structuredClone(m));return{ok:true,result:['snapshot','availability','clearAvailability','restore'].includes(m.type)?{generation:'doc-1',url:STUDY,nctIds:[],diagnostic:'Study page.',supported:false}:{}}},onUpdated:new Events(),onRemoved:new Events()},scripting:{executeScript:async(v:any)=>{scripts.push({...v,func:undefined,args:structuredClone(v.args)});return[]}},windows:{create:async()=>({id:2,tabs:[{id:9}]})}};
  const site=installSiteAssistant(api,{lookupPublicStatus:async()=>'RECRUITING'});installApplyBroker(api,site,{fetchStudyJson:async(nctId:string)=>{publicFetches.push(nctId);return raw()},now:()=>Date.now()});
  const frame={id:'test',tab:{id:1,url:STUDY},frameId:2,documentId:'frame-doc',url:origin+'/overlay.html'};
  await site.launch({id:1,url:STUDY});const sitePort={name:'treatable.site.overlay.v1',sender:frame,sent:[] as any[],onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){this.sent.push(structuredClone(v))},disconnect(){}};connect.emit(sitePort);sitePort.onMessage.emit({type:'site.authenticate',capability:scripts.at(-1).args[0].capability});await settle();
  // Overlay frame ↔ broker port pair.
  const runtime={connect:({name}:{name:string})=>{assert.equal(name,APPLY_PORT);const client:any={onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){const c=structuredClone(v);overlaySent.push(c);queueMicrotask(()=>server.onMessage.emit(c))},disconnect(){server.onDisconnect.emit()}};const server:any={name,sender:frame,sent:[] as any[],closed:false,onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){const c=structuredClone(v);this.sent.push(c);queueMicrotask(()=>client.onMessage.emit(c))},disconnect(){if(this.closed)return;this.closed=true;client.onDisconnect.emit()}};brokerPorts.push(server);connect.emit(server);return client}};
  const copies:string[]=[],downloads:any[]=[];const env:ApplyEnv={runtime,loadZips:async()=>({zips:{}}),userActivated:()=>true,today:()=>new Date(),now:()=>Date.now(),copyText:async v=>{copies.push(v)},download:(name,text,type)=>downloads.push({name,text,type}),openMailto:()=>{}};
  const store:DetailsStore=sessionDetailsStore(),ref:{vm?:ApplyController}={};
  function Probe(){const vm=useApply(ID,env);ref.vm=vm;return React.createElement(ApplyView,{vm})}
  await act(async()=>{renderer=TestRenderer.create(React.createElement(DetailsContext.Provider,{value:store},React.createElement(Probe)))});
  await until(()=>ref.vm?.record&&ref.vm.phase==='ready','public record');
  await act(async()=>store.set({name:NAME,condition:CONDITION,extra:EXTRA}));
  await act(async()=>ref.vm!.requestReview());await until(()=>ref.vm!.result||ref.vm!.agentCode,'study brief result');
  const vm=ref.vm!;assert.equal(vm.agentCode,undefined);assert.equal(vm.result!.agentStatus,'complete');assert.equal(vm.result!.decisionStatus,'complete');assert.equal(vm.result!.cleanup,'deleted');
  const calls=(await readLines(installed.log)) as any[],provider=calls.filter(c=>c.host==='api.openai.com');
  assert.ok(provider.some(c=>c.path==='/v1/agents/sessions'&&c.method==='POST'),'an Agents request was made');assert.ok(provider.some(c=>c.path==='/v1/decisions'),'a Decisions request was made');assert.ok(calls.some(c=>c.host==='clinicaltrials.gov'),'the helper fetched the public record');
  assert.ok(vm.activity.length>0,'traces were streamed');
  // Local drafts do carry every marker.
  for(const [label,text] of [['email draft',vm.draft!.body],['call script',vm.callScript],['follow-up message',vm.followUpMessage]] as const)assert.deepEqual(leaks(text),MARKERS,label);
  await act(async()=>{vm.copyMessage()});await settle();assert.deepEqual(leaks(copies.at(-1)),MARKERS,'the patient-started copy carries the details');
  // Nothing outbound does.
  const outbound:Record<string,unknown>={
   'overlay → broker messages':overlaySent,'broker → overlay messages and traces':brokerPorts.map(p=>p.sent),'broker → native helper requests':native.sent,'native helper frames and traces':host.frames,
   'provider and ClinicalTrials.gov request log (bodies, paths, argv, env keys)':calls,'native helper stderr':host.stderr(),'console output':consoleLines,'browser fetch calls':fetchCalls,
   'public record fetch arguments':publicFetches,'tab navigations':tabUpdates,'content-script commands':contentCommands,'injected scripts':scripts,'site overlay messages':sitePort.sent,
   'activity trace and analysis input':[vm.activity,vm.analysisInput],'result':vm.result,'.ics reminder':downloads,'tel links':vm.plan!.callContacts.map(c=>c.dial?.href),
  };
  for(const [where,value] of Object.entries(outbound))assert.deepEqual(leaks(value),[],where);
  assert.equal(fetchCalls.length,0);assert.ok(native.sent.length>=2&&host.frames.length>=2&&provider.length>=2,'the checked channels were actually used');
  await act(async()=>vm.saveReminder());assert.deepEqual(leaks(downloads),[],'.ics reminder');
  await act(async()=>ref.vm!.end());assert.deepEqual(store.get(),BLANK_DETAILS,'End and clear my details wipes Your details');assert.equal(ref.vm!.phase,'ended');
 }finally{if(renderer)act(()=>renderer!.unmount());try{host?.child.stdin.end()}catch{}host?.child.kill('SIGKILL');await rm(installed.home,{recursive:true,force:true})}
});

test('canary: the in-process test adapter flow keeps details out of every port message while drafts use them',async()=>{
 const sent:any[]=[],store=sessionDetailsStore(),ref:{vm?:ApplyController}={};const r=normalizeApplyRecord(raw(),Date.now()),b=normalizeStudyBrief(raw(),Date.now()),expires=Date.now()+300000;
 class Port{onMessage=new Events();onDisconnect=new Events();constructor(){queueMicrotask(()=>this.onMessage.emit({kind:'applyReady',nctId:ID,nctIds:[ID],expiresAt:expires,studies:[{nctId:ID,title:r.title}]}))}
  reply(reply:any){queueMicrotask(()=>this.onMessage.emit({reply}))}disconnect(){}
  postMessage(v:any){sent.push(structuredClone(v));if(v.kind==='studyBriefRecord'){this.reply({id:v.id,type:'briefRecords',ok:true,records:[r],briefs:[b]});return}const q=v.request;
   if(q.type==='prepareStudyBrief')this.reply({id:q.id,type:'result',ok:true,result:{kind:'preparedStudyBrief',token:'t'.repeat(43),digest:'a'.repeat(64),expiresAt:expires,records:[r],briefs:[b]}});
   else if(q.type==='executeStudyBrief'){this.reply({id:q.id,type:'trace',ok:true,trace:{sequence:1,stage:'agent.request'}});this.reply({id:q.id,type:'result',ok:true,result:{kind:'studyBrief',mode:'test',digest:'a'.repeat(64),briefs:[b],studyPlans:[{nctId:ID,briefItemIds:[],questionIds:['visits'],prescreenIds:[],flagIds:[],routes:[{questionId:'visits',route:'ask_coordinator',evidenceIds:[]}],prioritizedQuestionIds:['visits']}],agentStatus:'complete',decisionStatus:'complete',failureCodes:[],cleanup:'deleted',toolCalls:1}})}
   else this.reply({id:q.id,type:'result',ok:true})}}
 const env:ApplyEnv={runtime:{connect:()=>new Port()},loadZips:async()=>({zips:{}}),userActivated:()=>true,today:()=>new Date(),now:()=>Date.now(),copyText:async()=>{},download:()=>{},openMailto:()=>{}};
 function Probe(){const vm=useApply(ID,env);ref.vm=vm;return React.createElement(ApplyView,{vm})}
 let renderer!:TestRenderer.ReactTestRenderer;await act(async()=>{renderer=TestRenderer.create(React.createElement(DetailsContext.Provider,{value:store},React.createElement(Probe)))});
 try{await until(()=>ref.vm?.record,'record');await act(async()=>store.set({name:NAME,condition:CONDITION,extra:EXTRA}));await act(async()=>ref.vm!.requestReview());await until(()=>ref.vm!.result,'result');
  assert.equal(ref.vm!.result!.mode,'test');assert.match(JSON.stringify(renderer.toJSON()),/test adapter, not a live API call/);
  assert.ok(sent.some(v=>v.request?.type==='executeStudyBrief'));assert.deepEqual(leaks(sent),[]);assert.deepEqual(leaks(ref.vm!.activity),[]);
  assert.deepEqual(leaks(ref.vm!.draft!.body),MARKERS);assert.deepEqual(leaks(ref.vm!.callScript),MARKERS);assert.deepEqual(leaks(ref.vm!.followUpMessage),MARKERS);
  const text=JSON.stringify(renderer.toJSON());assert.ok(text.includes('Your call script')&&text.includes('Follow-up message'));
 }finally{act(()=>renderer.unmount())}
});

test('edited call script and follow-up message survive detail changes, flag them as outdated, and reset on request',async()=>{
 const store=sessionDetailsStore(),ref:{vm?:ApplyController}={},r=normalizeApplyRecord(raw(),Date.now()),b=normalizeStudyBrief(raw(),Date.now()),expires=Date.now()+300000;
 const env:ApplyEnv={runtime:{connect:()=>{const p:any={onMessage:new Events(),onDisconnect:new Events(),disconnect(){},postMessage(v:any){if(v.kind==='studyBriefRecord')queueMicrotask(()=>p.onMessage.emit({reply:{id:v.id,type:'briefRecords',ok:true,records:[r],briefs:[b]}}))}};queueMicrotask(()=>p.onMessage.emit({kind:'applyReady',nctId:ID,nctIds:[ID],expiresAt:expires}));return p}},loadZips:async()=>({zips:{}}),userActivated:()=>true,today:()=>new Date(),now:()=>Date.now(),copyText:async()=>{},download:()=>{},openMailto:()=>{}};
 function Probe(){const vm=useApply(ID,env);ref.vm=vm;return null}
 let renderer!:TestRenderer.ReactTestRenderer;await act(async()=>{renderer=TestRenderer.create(React.createElement(DetailsContext.Provider,{value:store},React.createElement(Probe)))});
 try{await until(()=>ref.vm?.plan,'plan');
  await act(async()=>{ref.vm!.editCallScript('My own script');ref.vm!.editFollowUp('My own follow-up')});
  await act(async()=>store.set({name:NAME}));assert.equal(ref.vm!.callScript,'My own script');assert.equal(ref.vm!.followUpMessage,'My own follow-up');assert.equal(ref.vm!.callScriptOutdated,true);assert.equal(ref.vm!.followUpOutdated,true);
  await act(async()=>{ref.vm!.resetCallScript();ref.vm!.resetFollowUp()});assert.ok(ref.vm!.callScript.includes(NAME));assert.ok(ref.vm!.followUpMessage.includes(NAME));assert.equal(ref.vm!.callScriptEdited,false);
  await act(async()=>ref.vm!.end());assert.deepEqual(store.get(),BLANK_DETAILS);assert.equal(ref.vm!.callScript,'');assert.equal(ref.vm!.followUpMessage,'');
 }finally{act(()=>renderer.unmount())}
});
