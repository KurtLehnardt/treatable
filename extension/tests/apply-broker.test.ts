import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
import{installSiteAssistant}from'../src/site-background';import{installApplyBroker,APPLY_PORT,APPLY_NATIVE_TIMEOUT_MS}from'../src/apply-background';import{FAILURE_COPY,GENERIC_FAILURE_COPY}from'../src/failures';
import{rawStudy,briefTraceFixture,TOKEN,DIGEST}from'./apply-fixture';import{traceBody,APPLY_TOKEN_TTL_MS}from'../shared/apply-contract.mjs';
import{SESSION_TTL_MS}from'../src/session-lease';
class Events{listeners:((...v:any[])=>void)[]=[];addListener=(f:(...v:any[])=>void)=>this.listeners.push(f);removeListener=()=>{};emit=(...v:any[])=>{for(const f of this.listeners)f(...v)}}
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r))};
const STUDY='https://clinicaltrials.gov/study/NCT07254806';
function harness(url=STUDY,options:{fetchStudyJson?:(id:string)=>Promise<unknown>;now?:()=>number;resultIds?:string[];nativeFactory?:()=>any}={}){
 const connect=new Events(),messages=new Events(),updates=new Events(),removed=new Events(),scripts:any[]=[],natives:any[]=[],origin='chrome-extension://test';let tabUrl=url;
 const snap=()=>({generation:'doc-1',url:tabUrl,nctIds:options.resultIds??[],diagnostic:'Synthetic current page.',supported:!!options.resultIds?.length});
 const api:any={runtime:{id:'test',lastError:undefined as any,getURL:(p:string)=>origin+'/'+p,onConnect:connect,onMessage:messages,connectNative:()=>{if(options.nativeFactory){const n=options.nativeFactory();natives.push(n);return n}const n={sent:[] as any[],closed:false,onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){this.sent.push(structuredClone(v))},disconnect(){this.closed=true}};natives.push(n);return n}},action:{onClicked:new Events()},tabs:{get:async()=>({id:1,url:tabUrl}),update:async()=>{},sendMessage:async(_id:number,m:any)=>({ok:true,result:['snapshot','availability','clearAvailability','restore'].includes(m.type)?snap():{}}),onUpdated:updates,onRemoved:removed},scripting:{executeScript:async(v:any)=>{scripts.push(v);return[]}},windows:{create:async()=>({id:2,tabs:[{id:9}]})}};
 const site=installSiteAssistant(api,{lookupPublicStatus:async()=>'RECRUITING'}),broker=installApplyBroker(api,site,{fetchStudyJson:options.fetchStudyJson??(async()=>rawStudy()),now:options.now??(()=>Date.UTC(2026,9,24,15,15))});
 const frame=(over:any={})=>({id:'test',tab:{id:1,url:tabUrl},frameId:2,documentId:'frame-doc',url:origin+'/overlay.html',...over});
 function port(name:string,sender:any){const p={name,sender,sent:[] as any[],closed:false,onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){this.sent.push(structuredClone(v))},disconnect(){if(this.closed)return;this.closed=true;this.onDisconnect.emit()}};connect.emit(p);return p}
 async function overlay(){await site.launch({id:1,url:tabUrl});const capability=scripts.at(-1).args[0].capability,p=port('treatable.site.overlay.v1',frame());p.onMessage.emit({type:'site.authenticate',capability});await flush();return p}
 async function apply(sender=frame()){const p=port(APPLY_PORT,sender);await flush();return p}
 const send=async(p:any,request:any)=>{p.onMessage.emit({kind:'applyNative',request});await flush()};
 const reply=async(n:any,v:any)=>{n.onMessage.emit(structuredClone(v));await flush()};
 return{api,site,broker,natives,overlay,apply,send,reply,frame,updates,removed,setUrl:(v:string)=>{tabUrl=v}};
}
const replies=(p:any)=>p.sent.filter((v:any)=>v.reply).map((v:any)=>v.reply);
test('site.ready carries the study ID from the validated tab URL, and SPA navigation updates it',async()=>{
 const h=harness(),o=await h.overlay(),ready=o.sent.find((v:any)=>v.type==='site.ready');assert.deepEqual(ready.study,{nctId:'NCT07254806'});
 h.setUrl('https://clinicaltrials.gov/search?cond=back+pain');h.updates.emit(1,{url:'https://clinicaltrials.gov/search?cond=back+pain'},{id:1});assert.deepEqual(o.sent.at(-1),{type:'site.study',study:null});
 const s=harness('https://clinicaltrials.gov/search?cond=pain'),so=await s.overlay();assert.equal(so.sent.find((v:any)=>v.type==='site.ready').study,null);
});
test('only the authenticated overlay frame on a study page may open the apply channel',async()=>{
 const h=harness();const before=await h.apply();assert.equal(before.closed,true,'no overlay registered yet');
 await h.overlay();for(const over of [{id:'other'},{frameId:0},{frameId:3},{documentId:'other-doc'},{url:'chrome-extension://test/panel.html'},{url:'https://clinicaltrials.gov/overlay.html'},{tab:{id:7,url:STUDY}}]){const p=await h.apply(h.frame(over));assert.equal(p.closed,true,JSON.stringify(over))}
 const ok=await h.apply();assert.equal(ok.closed,false);assert.equal(ok.sent[0].kind,'applyReady');assert.equal(ok.sent[0].nctId,'NCT07254806');assert.deepEqual(ok.sent[0].nctIds,['NCT07254806']);assert.equal(h.natives.length,0,'nothing reaches native on connect');
 const s=harness('https://clinicaltrials.gov/search?cond=pain');await s.overlay();const search=await s.apply();assert.equal(search.closed,true,'search pages have no apply channel');
 ok.onMessage.emit({kind:'applyNative',request:{id:'x',type:'prepareStudyBrief',payload:{nctIds:['NCT07254806'],name:'Morgan'}}});await flush();assert.equal(ok.closed,true,'invalid request shape ends the channel');assert.equal(h.natives.length,0);
});
test('built background routes the apply port to its broker',()=>{const bundle=readFileSync(new URL('../dist/background.js',import.meta.url),'utf8');assert.ok(bundle.includes('treatable-apply-v1'));assert.ok(bundle.includes('applyReady'))});

// Public-only brief authority uses the same real overlay registration harness as the existing apply tests.
import{normalizeApplyRecord,normalizeStudyBrief}from'../shared/apply-record.mjs';
const briefPrepared=(ids:string[])=>{const raws=ids.map(nctId=>{const raw=rawStudy();raw.protocolSection.identificationModule.nctId=nctId;return raw});return{kind:'preparedStudyBrief',token:TOKEN,digest:DIGEST,expiresAt:Date.UTC(2026,9,24,15,20),records:raws.map(r=>normalizeApplyRecord(r,1,16000)),briefs:raws.map(r=>normalizeStudyBrief(r,1))}};
test('brief fallback selects1–2 current resultIDs, uses no nativehost and refuses arbitrary IDs/patientfields',async()=>{const ids=['NCT07254806','NCT99999991'],h=harness('https://clinicaltrials.gov/search?cond=synthetic',{resultIds:ids,fetchStudyJson:async nctId=>{const r=rawStudy();r.protocolSection.identificationModule.nctId=nctId;return r}});await h.overlay();const p=await h.apply();assert.deepEqual(p.sent[0].nctIds,ids);p.onMessage.emit({kind:'studyBriefRecord',id:'r',nctIds:ids});await flush();const reply=replies(p).at(-1);assert.equal(reply.type,'briefRecords');assert.equal(reply.briefs.length,2);assert.equal(h.natives.length,0);p.onMessage.emit({kind:'studyBriefRecord',id:'bad',nctIds:['NCT00000001']});await flush();assert.equal(replies(p).at(-1).code,'NOT_STUDY_PAGE');p.onMessage.emit({kind:'studyBriefRecord',id:'private',nctIds:ids,patient:'PATIENT_CANARY'});await flush();assert.equal(p.closed,true);assert.equal(h.natives.length,0);});
test('brief native execution is sourcebound, oneuse and cannot forward genericliveexecute or replay',async()=>{const h=harness();await h.overlay();const p=await h.apply();await h.send(p,{id:'p',type:'prepareStudyBrief',payload:{nctIds:['NCT07254806']}});const n=h.natives[0];await h.reply(n,{id:'p',type:'result',ok:true,result:briefPrepared(['NCT07254806'])});await h.send(p,{id:'run',type:'executeStudyBrief',payload:{token:TOKEN,digest:DIGEST}});assert.equal(n.sent.at(-1).type,'executeStudyBrief');await h.send(p,{id:'replay',type:'executeStudyBrief',payload:{token:TOKEN,digest:DIGEST}});assert.equal(replies(p).at(-1).code,'BUSY');h.updates.emit(1,{url:'https://clinicaltrials.gov/study/NCT00000001'});assert.equal(p.closed,true);assert.equal(n.sent.at(-1).type,'revokeStudyBrief');const g=harness();await g.overlay();const q=await g.apply();await g.send(q,{id:'forged',type:'executeLive',payload:{token:TOKEN,digest:DIGEST,operation:'score'}});assert.equal(q.closed,true);assert.equal(g.natives.length,0);});
test('late public recordcompletion after sourcechange is discarded; originalsessionexpiry endslocaldraft authority',async()=>{let release!:(v:unknown)=>void;const h=harness(STUDY,{fetchStudyJson:()=>new Promise(r=>{release=r})});await h.overlay();const p=await h.apply();p.onMessage.emit({kind:'studyBriefRecord',id:'late',nctIds:['NCT07254806']});await flush();h.setUrl('https://clinicaltrials.gov/study/NCT00000001');h.updates.emit(1,{url:'https://clinicaltrials.gov/study/NCT00000001'});release(rawStudy());await flush();assert.equal(p.closed,true);assert.ok(!replies(p).some((r:any)=>r.id==='late'));let now=Date.UTC(2026,9,24,15,15);const g=harness(STUDY,{now:()=>now});await g.overlay();const q=await g.apply();const expiry=q.sent[0].expiresAt;now+=SESSION_TTL_MS+1;q.onMessage.emit({kind:'studyBriefRecord',id:'expired',nctIds:['NCT07254806']});await flush();assert.equal(q.closed,true);assert.equal(expiry,Date.UTC(2026,9,24,15,45),'the session lasts 30 minutes from connecting');assert.equal(g.natives.length,0);});

// Uses the real native host stdio decoder and installed temporary fake transport through this actual broker.
// @ts-expect-error test-only native module has no ambient declaration
import{installHost,writeHook,startHost,readLines,poll}from'../native/test/host-harness.mjs';
// @ts-expect-error test-only native decoder module has no ambient declaration
import{MessageDecoder}from'../native/core.mjs';
import{rm}from'node:fs/promises';
test('actual broker receives stdio progress, selected-study tools and final result without settling on traces',async()=>{const installed=await installHost('treatable-broker-stdio-');let host:any;try{const ids=['NCT99999990','NCT99999991'],raws=ids.map(nctId=>({protocolSection:{identificationModule:{nctId,briefTitle:'Synthetic public record'},descriptionModule:{briefSummary:'A public synthetic fixture.',detailedDescription:'Two treatments are spaced 4 weeks apart. Follow-up visits are at 3 and 12 months post injection. Participants can cross over after follow-up.'},statusModule:{overallStatus:'RECRUITING'},eligibilityModule:{}}})),briefs=raws.map(r=>normalizeStudyBrief(r,1)),plans=briefs.map(b=>{const e=b.items.find(x=>x.text==='Two treatments are spaced 4 weeks apart.')!;return{nctId:b.nctId,claims:[{category:e.category,text:e.text,evidenceIds:[e.id],sourceQuotes:[e.text]}],questionIds:['still_enrolling','visits','next_steps'],prescreenIds:['diagnosis_details','prior_treatments'],flagIds:[],questionEvidence:['still_enrolling','visits','next_steps'].map(questionId=>({questionId,evidenceIds:[]}))}});host=startHost(installed,{hook:await writeHook(installed.home,{log:installed.log,govRecords:Object.fromEntries(ids.map((id,i)=>[id,raws[i]])),briefOutput:JSON.stringify({studies:plans})})});const native={sent:[]as any[],closed:false,onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){this.sent.push(structuredClone(v));host.send(v)},disconnect(){if(this.closed)return;this.closed=true;host.child.stdin.end()}};const decoder=new MessageDecoder((v:any)=>native.onMessage.emit(v),()=>{throw Error('Invalid test frame')});host.child.stdout.on('data',(chunk:any)=>decoder.push(chunk));const h=harness('https://clinicaltrials.gov/search?cond=synthetic',{resultIds:ids,nativeFactory:()=>native,now:()=>Date.now()});await h.overlay();const p=await h.apply();await h.send(p,{id:'prep',type:'prepareStudyBrief',payload:{nctIds:ids}});const prepared=await poll(()=>replies(p).find((r:any)=>r.id==='prep'&&r.type==='result'));assert.equal(prepared.ok,true,prepared.code);await h.send(p,{id:'run',type:'executeStudyBrief',payload:{token:prepared.result.token,digest:prepared.result.digest}});const result=await poll(()=>replies(p).find((r:any)=>r.id==='run'&&r.type==='result'));assert.equal(result.ok,true,result.code);assert.equal(result.result.agentStatus,'complete');assert.equal(result.result.decisionStatus,'complete');assert.equal(result.result.apiTrace.toolCalls.length,2);assert.equal(result.result.apiTrace.decisions.length,6);assert.ok(result.result.apiTrace.agentsRequest.text.includes('get_public_selected_study'));assert.doesNotMatch(JSON.stringify(p.sent),/sk-test-not-a-real-credential|Authorization|Bearer|OpenAI-Beta/);const traces=replies(p).filter((r:any)=>r.id==='run'&&r.type==='trace');assert.ok(traces.length>=10);assert.equal(traces.filter((r:any)=>r.trace.stage==='agent.tool.request').length,2);assert.equal(traces.filter((r:any)=>r.trace.stage==='decisions.complete').length,1);assert.deepEqual(traces.map((r:any)=>r.trace.sequence),traces.map((_:any,i:number)=>i+1));assert.ok(traces.every((r:any)=>Object.keys(r.trace).every(k=>['sequence','stage','nctId','section'].includes(k))));assert.equal(replies(p).filter((r:any)=>r.id==='run'&&r.type==='result').length,1);assert.ok(!replies(p).some((r:any)=>r.code==='INVALID_NATIVE_REPLY'));const calls=(await readLines(installed.log)).filter((r:any)=>r.host==='api.openai.com');assert.equal(calls.filter((r:any)=>r.path==='/v1/decisions').length,1);p.disconnect();await host.exit;host=undefined;}finally{host?.child.kill('SIGKILL');await rm(installed.home,{recursive:true,force:true})}});
test('trace correlation rejects malformed, wrong-study and replay events and strips provider identifiers',async()=>{for(const invalid of[{sequence:2,stage:'agent.request'},{sequence:1,stage:'agent.tool.request',nctId:'NCT00000001'},{sequence:1,stage:'agent.request',patient:'PRIVATE_CANARY'}]){const h=harness();await h.overlay();const p=await h.apply();await h.send(p,{id:'prep',type:'prepareStudyBrief',payload:{nctIds:['NCT07254806']}});await h.reply(h.natives[0],{id:'prep',type:'result',ok:true,result:briefPrepared(['NCT07254806'])});await h.send(p,{id:'run',type:'executeStudyBrief',payload:{token:TOKEN,digest:DIGEST}});await h.reply(h.natives[0],{id:'run',type:'trace',ok:true,trace:invalid});assert.equal(replies(p).at(-1).code,'INVALID_NATIVE_REPLY');assert.equal(p.closed,true);assert.ok(!JSON.stringify(p.sent).includes('PRIVATE_CANARY'));}const h=harness();await h.overlay();const p=await h.apply();await h.send(p,{id:'prep',type:'prepareStudyBrief',payload:{nctIds:['NCT07254806']}});await h.reply(h.natives[0],{id:'prep',type:'result',ok:true,result:briefPrepared(['NCT07254806'])});await h.send(p,{id:'run',type:'executeStudyBrief',payload:{token:TOKEN,digest:DIGEST}});await h.reply(h.natives[0],{id:'run',type:'trace',ok:true,trace:{sequence:1,stage:'agent.session.created',sessionId:'provider_private_id'}});assert.deepEqual(replies(p).at(-1).trace,{sequence:1,stage:'agent.session.created'});const count=p.sent.length;p.disconnect();await h.reply(h.natives[0],{id:'run',type:'trace',ok:true,trace:{sequence:2,stage:'agent.complete'}});assert.equal(p.sent.length,count);});

test('brief records loaded for the local contact plan keep every listed site rather than the native prepare cap',async()=>{const many=rawStudy();many.protocolSection.contactsLocationsModule={...(many.protocolSection.contactsLocationsModule??{}),locations:Array.from({length:150},(_,i)=>({facility:`University Medical Center Research Site ${i}`,status:'RECRUITING',city:'Springfield',state:'Illinois',zip:'62701',country:'United States',geoPoint:{lat:39.78+i/100,lon:-89.65},contacts:[{name:'Jane Coordinator, RN',role:'CONTACT',phone:'217-555-0100',email:'jane.coordinator@example.org'}]}))};const h=harness(STUDY,{fetchStudyJson:async()=>many});await h.overlay();const p=await h.apply();p.onMessage.emit({kind:'studyBriefRecord',id:'sites',nctIds:['NCT07254806']});await flush();const reply=replies(p).at(-1);assert.equal(reply.type,'briefRecords');assert.equal(reply.records[0].sites.length,150);assert.equal(reply.records[0].sitesTruncated,false);assert.equal(h.natives.length,0);});

// Regression: "Generate study brief" showed INVALID_REQUEST when Chrome launched a helper installed before the study-brief protocol existed.
// The request is built by the real ApplyClient, routed through the actual broker and validated by a real installed helper over stdio.
import{ApplyClient}from'../src/apply-client';
import{readFile as readText,writeFile as writeText}from'node:fs/promises';import nodePath from'node:path';
// A helper from before the study-brief operations existed: its validateRequest knows other operations only, so it rejects prepareStudyBrief.
const PRE_APPLY_VALIDATE_REQUEST='export function validateRequest(v){if(RANK_REQUEST_TYPES.includes(v?.type))return parseRankRequest(v);throw new Error(\'Unsupported native operation\');}';
function stdioNative(host:any){
 const native={sent:[] as any[],closed:false,onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){this.sent.push(structuredClone(v));host.send(v)},disconnect(){if(this.closed)return;this.closed=true;host.child.stdin.end()}};
 const decoder=new MessageDecoder((v:any)=>native.onMessage.emit(v),()=>{throw Error('Invalid test frame')});host.child.stdout.on('data',(chunk:any)=>decoder.push(chunk));return native;
}
// Connects an ApplyClient to the broker through a paired in-memory port, as the overlay frame does through chrome.runtime.connect.
function clientThroughBroker(h:ReturnType<typeof harness>){
 const toClient=new Events(),clientEnded=new Events();
 const brokerPort={name:APPLY_PORT,sender:h.frame(),closed:false,onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){toClient.emit(structuredClone(v))},disconnect(){if(this.closed)return;this.closed=true;clientEnded.emit()}};
 const runtime={connect:()=>{h.api.runtime.onConnect.emit(brokerPort);return{postMessage:(v:unknown)=>brokerPort.onMessage.emit(structuredClone(v)),disconnect:()=>{if(brokerPort.closed)return;brokerPort.closed=true;brokerPort.onDisconnect.emit()},onMessage:toClient,onDisconnect:clientEnded}}};
 return new ApplyClient(runtime);
}
test('Generate study brief reaches the current helper, and a helper without the study-brief contract is reported as a version mismatch',async()=>{
 const nctId='NCT07254806';
 for(const stale of [false,true]){
  const installed=await installHost('treatable-brief-version-');let host:any;
  try{
   if(stale){const file=nodePath.join(installed.dir,'core.mjs'),current=await readText(file,'utf8'),old=current.replace(/^export function validateRequest\(v\)\{.*\}$/m,PRE_APPLY_VALIDATE_REQUEST);assert.notEqual(old,current,'the stale helper fixture must replace validateRequest');await writeText(file,old);}
   host=startHost(installed,{hook:await writeHook(installed.home,{log:installed.log,govRecords:{[nctId]:rawStudy()}})});
   const native=stdioNative(host),h=harness(STUDY,{nativeFactory:()=>native,now:()=>Date.now()});await h.overlay();
   const client=clientThroughBroker(h);assert.equal(await client.open(()=>{}),nctId);
   if(stale){
    await assert.rejects(client.prepareBrief([nctId]),(error:any)=>error.code==='HELPER_VERSION_MISMATCH'&&error.message===FAILURE_COPY.HELPER_VERSION_MISMATCH);
    const raw=await poll(()=>host.frames.find((f:any)=>f.id===native.sent[0]?.id));assert.equal(raw.code,'INVALID_REQUEST','the stale helper itself still answers INVALID_REQUEST');
   }else{
    const prepared=await client.prepareBrief([nctId]);assert.equal(prepared.kind,'preparedStudyBrief');assert.deepEqual(prepared.records.map(r=>r.nctId),[nctId]);
   }
   assert.equal(native.sent.length,1);assert.deepEqual(native.sent[0],{id:native.sent[0].id,type:'prepareStudyBrief',payload:{nctIds:[nctId]}});
   assert.equal((await readLines(installed.log)).filter((r:any)=>r.host==='api.openai.com').length,0,'preparing a brief never contacts OpenAI');
   client.disconnect();await host.exit;host=undefined;
  }finally{host?.child.kill('SIGKILL');await rm(installed.home,{recursive:true,force:true})}
 }
});
test('brief records carry the complete official study purpose for local display, separate from the bounded model excerpts',async()=>{const purpose=Array.from({length:230},(_,i)=>`Sentence ${i+1} of the synthetic purpose describes what participants will be asked to do.`).join(' ');assert.ok(purpose.length>16000);const long=rawStudy();(long.protocolSection as any).descriptionModule={briefSummary:purpose};const h=harness(STUDY,{fetchStudyJson:async()=>long});await h.overlay();const p=await h.apply();p.onMessage.emit({kind:'studyBriefRecord',id:'purpose',nctIds:['NCT07254806']});await flush();const reply=replies(p).at(-1);assert.equal(reply.type,'briefRecords');assert.deepEqual(reply.purposes,[purpose],'display text is whole, with no ellipsis');const excerpts=reply.briefs[0].items.filter((i:any)=>i.field==='protocolSection.descriptionModule.briefSummary');assert.equal(excerpts.length,4,'the model excerpts stay bounded');assert.ok(excerpts.every((i:any)=>purpose.includes(i.text)&&i.text.length<=1800));assert.equal(h.natives.length,0);p.onMessage.emit({kind:'studyBriefRecord',id:'plain',nctIds:['NCT07254806'],purposes:['injected']});await flush();assert.equal(p.closed,true,'the request shape is unchanged: extra fields still end the session');});

// The API trace travels in the study brief result: validated by the shared contract in the broker and again in the client.
const briefResult=(ids:string[],apiTrace?:unknown)=>({
 kind:'studyBrief',mode:'test',digest:DIGEST,briefs:briefPrepared(ids).briefs.map(b=>({...b,claims:[]})),
 studyPlans:ids.map(nctId=>({nctId,briefItemIds:[],questionIds:['visits','crossover','costs'],prescreenIds:['diagnosis_details','prior_treatments'],flagIds:[],routes:['visits','crossover','costs'].map(questionId=>({questionId,route:'ask_coordinator',evidenceIds:[]})),prioritizedQuestionIds:['visits','crossover','costs']})),
 agentStatus:'complete',decisionStatus:'complete',failureCodes:[],cleanup:'deleted',toolCalls:ids.length,...(apiTrace?{apiTrace}:{})});
async function executeBriefWith(result:unknown){
 const ids=['NCT07254806'],h=harness();await h.overlay();const client=clientThroughBroker(h);await client.open(()=>{});
 const prep=client.prepareBrief(ids);await flush();const n=h.natives[0];await h.reply(n,{id:n.sent[0].id,type:'result',ok:true,result:briefPrepared(ids)});const prepared=await prep;
 const run=client.executeBrief(prepared).then(value=>({value}),error=>({error}));await flush();await h.reply(n,{id:n.sent.at(-1).id,type:'result',ok:true,result});
 const outcome=await run;client.disconnect();if('error' in outcome)throw outcome.error;return outcome.value;
}
test('the study brief API trace reaches the client intact; a result without one is still accepted',async()=>{
 const ids=['NCT07254806'],trace=briefTraceFixture(ids);
 assert.deepEqual((await executeBriefWith(briefResult(ids,trace))).apiTrace,trace);
 assert.equal((await executeBriefWith(briefResult(ids))).apiTrace,undefined,'an older helper sends no trace');
});
test('a trace that breaks the contract is refused as an invalid helper reply and never reaches the client',async()=>{
 const ids=['NCT07254806'],good=briefTraceFixture(ids);
 const bad:Record<string,unknown>={
  'probabilities that do not sum to 1':{...good,decisions:good.decisions.map((d,i)=>i?d:{...d,probabilities:{...d.probabilities,ask_patient:.9}})},
  'decision for another study':{...good,decisions:good.decisions.map((d,i)=>i?d:{...d,nctId:'NCT00000001'})},
  'tool call for another study':{...good,toolCalls:[{...good.toolCalls[0],arguments:{nctId:'NCT00000001'}}]},
  'header or key text in a body':{...good,agentsRequest:traceBody({headers:{Authorization:'Bearer sk-CANARYabcdefghijklmnopqrstuvwxyz'}})},
  'unknown field':{...good,headers:{Authorization:'Bearer x'}},
 };
 for(const[name,trace]of Object.entries(bad))await assert.rejects(executeBriefWith(briefResult(ids,trace)),(error:any)=>error.code==='INVALID_NATIVE_REPLY',name);
});

test('applyRenew cannot revive an expired session, carry extra fields, or outlive navigation',async()=>{
 let now=Date.UTC(2026,9,24,15,15);const h=harness(STUDY,{now:()=>now});await h.overlay();
 const extra=await h.apply();extra.onMessage.emit({kind:'applyRenew',patient:'PATIENT_CANARY'});await flush();assert.equal(extra.closed,true,'a renewal carries nothing but its kind');assert.ok(!extra.sent.some((v:any)=>v.kind==='applyRenewed'));
 const late=await h.apply();now+=SESSION_TTL_MS+1;late.onMessage.emit({kind:'applyRenew'});await flush();assert.equal(late.closed,true);assert.ok(!late.sent.some((v:any)=>v.kind==='applyRenewed'),'expiry is final');
 now=Date.UTC(2026,9,24,15,15);const moved=await h.apply();h.setUrl('https://clinicaltrials.gov/study/NCT00000001');moved.onMessage.emit({kind:'applyRenew'});await flush();assert.equal(moved.closed,true,'another study never inherits the session');assert.ok(!moved.sent.some((v:any)=>v.kind==='applyRenewed'));
});

// The Help me apply agent (prepareApply, executeApply, revokeApply, applyRecord) was removed. The broker properties its tests asserted
// apply to the study brief, the operation that remains, and are asserted on it here.
const ONE=['NCT07254806'];
const briefRequest=(id:string,nctIds=ONE)=>({id,type:'prepareStudyBrief',payload:{nctIds}});
const briefExecute=(id:string,token=TOKEN)=>({id,type:'executeStudyBrief',payload:{token,digest:DIGEST}});
test('a brief preparation is bound to the tab study; execute needs the stored one-use receipt; replies are revalidated',async()=>{
 const h=harness();await h.overlay();const p=await h.apply();
 await h.send(p,briefRequest('w',['NCT00000001']));assert.deepEqual(replies(p).at(-1),{id:'w',type:'result',ok:false,code:'NOT_STUDY_PAGE',error:FAILURE_COPY.NOT_STUDY_PAGE});assert.equal(h.natives.length,0);
 await h.send(p,briefExecute('e0'));assert.equal(replies(p).at(-1).code,'INVALID_APPLY_RECEIPT','no receipt before prepare');assert.equal(h.natives.length,0);
 await h.send(p,briefRequest('p1'));const n=h.natives[0];assert.deepEqual(n.sent,[briefRequest('p1')]);
 await h.reply(n,{id:'p1',type:'result',ok:true,result:briefPrepared(ONE)});assert.equal(replies(p).at(-1).result.kind,'preparedStudyBrief');
 await h.send(p,briefExecute('e1','U'.repeat(43)));assert.equal(replies(p).at(-1).code,'INVALID_APPLY_RECEIPT');assert.equal(n.sent.length,1);
 await h.send(p,briefExecute('e2'));assert.deepEqual(n.sent.at(-1),briefExecute('e2'),'an OpenAI brief carries exactly the receipt, no budget');
 await h.reply(n,{id:'e2',type:'result',ok:true,result:{...briefResult(ONE),digest:'e'.repeat(64)}});assert.equal(replies(p).at(-1).code,'RESULT_MISMATCH');
 await h.send(p,briefExecute('e3'));assert.equal(replies(p).at(-1).code,'INVALID_APPLY_RECEIPT','receipt is one-use');assert.equal(n.sent.length,2);
 await h.send(p,briefRequest('p2'));await h.reply(n,{id:'p2',type:'result',ok:true,result:briefPrepared(ONE)});await h.send(p,briefExecute('e4'));await h.reply(n,{id:'e4',type:'result',ok:true,result:briefResult(ONE)});assert.equal(replies(p).at(-1).result.kind,'studyBrief');
 await h.send(p,briefRequest('p3'));await h.reply(n,{id:'p3',type:'result',ok:false,code:'API_ERROR',error:'PRIVATE_CANARY'.repeat(10)});assert.deepEqual(replies(p).at(-1),{id:'p3',type:'result',ok:false,code:'API_ERROR',error:FAILURE_COPY.API_ERROR});
 await h.send(p,briefRequest('p4'));await h.reply(n,{id:'p4',type:'result',ok:true,result:{...briefPrepared(ONE),extra:1}});assert.equal(replies(p).at(-1).code,'INVALID_NATIVE_REPLY');
 await h.reply(n,{id:'unsolicited',type:'result',ok:true});assert.ok(!replies(p).some((r:any)=>r.id==='unsolicited'));
 assert.ok(!JSON.stringify(p.sent).includes('PRIVATE_CANARY'),'transported error text never reaches the frame');
});
test('expired brief receipts are refused locally; a missing helper reports its specific code',async()=>{
 let now=Date.UTC(2026,9,24,15,15);const h=harness(STUDY,{now:()=>now});await h.overlay();const p=await h.apply();
 await h.send(p,briefRequest('p1'));await h.reply(h.natives[0],{id:'p1',type:'result',ok:true,result:{...briefPrepared(ONE),expiresAt:now+1000}});now+=2000;
 await h.send(p,briefExecute('e1'));assert.deepEqual(replies(p).at(-1),{id:'e1',type:'result',ok:false,code:'APPLY_EXPIRED',error:FAILURE_COPY.APPLY_EXPIRED});assert.equal(h.natives[0].sent.length,1);
 await h.send(p,briefRequest('p2'));h.api.runtime.lastError={message:'Specified native messaging host not found.'};h.natives[0].onDisconnect.emit();await flush();assert.equal(replies(p).at(-1).code,'NATIVE_HOST_MISSING');
});
test('official-record loading uses the background fetch; failures are specific; the retired applyRecord message ends the session',async()=>{
 const f=harness(STUDY,{fetchStudyJson:async()=>{throw Error('offline')}});await f.overlay();const q=await f.apply();q.onMessage.emit({kind:'studyBriefRecord',id:'r2',nctIds:ONE});await flush();assert.deepEqual(replies(q).at(-1),{id:'r2',type:'result',ok:false,code:'RECORD_UNAVAILABLE',error:FAILURE_COPY.RECORD_UNAVAILABLE});assert.equal(f.natives.length,0);
 const w=harness();await w.overlay();const x=await w.apply();w.setUrl('https://clinicaltrials.gov/study/NCT00000001');x.onMessage.emit({kind:'studyBriefRecord',id:'r3',nctIds:ONE});await flush();assert.equal(x.closed,true,'source change ends the old session');
 const r=harness();await r.overlay();const y=await r.apply();y.onMessage.emit({kind:'applyRecord',id:'r1'});await flush();assert.equal(y.closed,true,'applyRecord is no longer a broker message');assert.ok(!replies(y).length);assert.equal(r.natives.length,0);
});
test('closing the frame or navigating to another study revokes the brief receipt and ends the channel',async()=>{
 const h=harness();await h.overlay();const p=await h.apply();await h.send(p,briefRequest('p1'));const n=h.natives[0];await h.reply(n,{id:'p1',type:'result',ok:true,result:briefPrepared(ONE)});
 h.updates.emit(1,{url:'https://clinicaltrials.gov/study/NCT07254806#contacts'},{id:1});assert.equal(p.closed,false,'same study, different anchor');
 h.updates.emit(1,{url:'https://clinicaltrials.gov/study/NCT00000001'},{id:1});assert.equal(p.closed,true);assert.ok(p.sent.some((v:any)=>v.kind==='applyEnded'));assert.equal(n.sent.at(-1).type,'revokeStudyBrief');assert.deepEqual(n.sent.at(-1).payload,{token:TOKEN});
 const g=harness();await g.overlay();const q=await g.apply();await g.send(q,briefRequest('p1'));await g.reply(g.natives[0],{id:'p1',type:'result',ok:true,result:briefPrepared(ONE)});q.disconnect();assert.equal(g.natives[0].sent.at(-1).type,'revokeStudyBrief');assert.equal(g.broker.sessionCount(),0);
});
test('removed helper operations sent over the apply port end the session before any helper connection',async()=>{
 const requests=[{id:'a',type:'prepareApply',payload:{nctId:'NCT07254806'}},{id:'b',type:'executeApply',payload:{token:TOKEN,digest:DIGEST}},{id:'c',type:'revokeApply',payload:{}},{id:'d',type:'executeLive',payload:{token:TOKEN,digest:DIGEST,operation:'score'}},{id:'e',type:'scoreDemo',payload:{fixtureId:'fibromyalgia',consent:true}},{id:'f',type:'prepareReal',payload:{}},{id:'g',type:'status',payload:{}},{id:'h',type:'cancel',payload:{requestId:'a'}}];
 for(const request of requests){const h=harness();await h.overlay();const p=await h.apply();await h.send(p,request);assert.equal(p.closed,true,request.type);assert.equal(h.natives.length,0,request.type);assert.deepEqual(replies(p),[],request.type)}
});
test('applyRenew slides the 30-minute session forward from the moment of renewal and never touches the helper',async()=>{
 let now=Date.UTC(2026,9,24,15,15);const h=harness(STUDY,{now:()=>now});await h.overlay();const p=await h.apply();
 assert.equal(p.sent[0].expiresAt,now+SESSION_TTL_MS);
 now+=20*60*1000;p.onMessage.emit({kind:'applyRenew'});await flush();assert.deepEqual(p.sent.at(-1),{kind:'applyRenewed',expiresAt:now+SESSION_TTL_MS});
 now+=25*60*1000;p.onMessage.emit({kind:'studyBriefRecord',id:'r1',nctIds:ONE});await flush();assert.equal(replies(p).at(-1).type,'briefRecords','45 minutes after connecting is past the original deadline but inside the renewed one');assert.equal(p.closed,false);
 now+=5*60*1000+1;p.onMessage.emit({kind:'studyBriefRecord',id:'r2',nctIds:ONE});await flush();assert.equal(p.closed,true,'the renewed deadline ends the session');assert.ok(p.sent.some((v:any)=>v.kind==='applyEnded'));assert.equal(h.natives.length,0,'renewing never opens the helper');
});
test('prepared briefs keep their own five-minute one-use receipt even though the session lasts 30 minutes',async()=>{
 assert.equal(APPLY_TOKEN_TTL_MS,5*60*1000);
 let now=Date.UTC(2026,9,24,15,15);const h=harness(STUDY,{now:()=>now});await h.overlay();const p=await h.apply();
 await h.send(p,briefRequest('p1'));await h.reply(h.natives[0],{id:'p1',type:'result',ok:true,result:{...briefPrepared(ONE),expiresAt:now+SESSION_TTL_MS}});
 assert.equal(replies(p).at(-1).result.expiresAt,now+APPLY_TOKEN_TTL_MS,'a longer claim is cut back to five minutes');
 now+=4*60*1000;p.onMessage.emit({kind:'applyRenew'});await flush();assert.equal(p.sent.at(-1).kind,'applyRenewed');
 now+=60*1000+1;await h.send(p,briefExecute('e1'));assert.equal(replies(p).at(-1).code,'APPLY_EXPIRED','renewing the session does not renew the receipt');assert.equal(h.natives[0].sent.length,1);assert.equal(p.closed,false,'the session itself is still open');
});

// Transport hardening first asserted on the removed private-matching broker (tests/live-broker-transport.test.ts). The study brief broker is
// the frame-to-helper transport that remains, so the same properties are asserted on it.
function nativeTimers(){const list:{fn:()=>void;ms:number;handle:number}[]=[],cleared=new Set<unknown>(),realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout;
 globalThis.setTimeout=((fn:any,ms?:number,...a:any[])=>{if(ms===APPLY_NATIVE_TIMEOUT_MS){const handle=list.length+1000;list.push({fn:()=>fn(...a),ms,handle});return handle as any}return realSet(fn,ms,...a)}) as any;
 globalThis.clearTimeout=((handle:any)=>{if(typeof handle==='number'&&list.some(t=>t.handle===handle)){cleared.add(handle);return}realClear(handle)}) as any;
 return{list,cleared,restore:()=>{globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear}}}
test('a duplicate request ID while it is pending ends the session; another request while one is pending is BUSY and never reaches the helper',async()=>{
 const h=harness();await h.overlay();const p=await h.apply();await h.send(p,briefRequest('a'));assert.equal(h.natives[0].sent.length,1);
 await h.send(p,briefRequest('b'));assert.deepEqual(replies(p).at(-1),{id:'b',type:'result',ok:false,code:'BUSY',error:FAILURE_COPY.BUSY});assert.equal(h.natives[0].sent.length,1);
 await h.send(p,briefRequest('a'));assert.equal(p.closed,true,'reusing a pending ID ends the session');assert.equal(h.natives[0].sent.length,1);
});
test('each apply session owns its helper connection; ending one leaves the other connected',async()=>{
 const h=harness();await h.overlay();const a=await h.apply(),b=await h.apply();await h.send(a,briefRequest('a'));await h.send(b,briefRequest('b'));assert.equal(h.natives.length,2);
 a.disconnect();await new Promise(r=>setTimeout(r,10));assert.equal(h.natives[0].closed,true);assert.equal(h.natives[1].closed,false);b.disconnect();
});
test('a helper failure code reaches the frame with fixed copy only; an unknown code gets the generic copy',async()=>{
 const h=harness();await h.overlay();const p=await h.apply();await h.send(p,briefRequest('u'));await h.reply(h.natives[0],{id:'u',type:'result',ok:false,code:'SOME_NEW_CODE',error:'PRIVATE_CANARY'});
 assert.deepEqual(replies(p).at(-1),{id:'u',type:'result',ok:false,code:'SOME_NEW_CODE',error:GENERIC_FAILURE_COPY});assert.ok(!JSON.stringify(p.sent).includes('PRIVATE_CANARY'));
});
test('the helper timeout uses its own code, ends the session and closes the helper connection; a settled request clears its timer',async()=>{
 const t=nativeTimers();try{
  const h=harness();await h.overlay();const p=await h.apply();await h.send(p,briefRequest('t'));assert.equal(t.list.length,1);t.list[0].fn();await flush();
  assert.deepEqual(replies(p).at(-1),{id:'t',type:'result',ok:false,code:'NATIVE_TIMEOUT',error:FAILURE_COPY.NATIVE_TIMEOUT});assert.equal(p.closed,true);await new Promise(r=>setTimeout(r,10));assert.equal(h.natives[0].closed,true);
  const g=harness();await g.overlay();const q=await g.apply();await g.send(q,briefRequest('s'));const timer=t.list.at(-1)!;await g.reply(g.natives[0],{id:'s',type:'result',ok:true,result:briefPrepared(ONE)});
  assert.ok(t.cleared.has(timer.handle),'the settled request cleared its timer');assert.equal(q.closed,false);q.disconnect();
 }finally{t.restore()}
});
test('a helper port that throws on send fails that request with a specific code, and the next request opens a fresh connection',async()=>{
 let first=true;const h=harness(STUDY,{nativeFactory:()=>({sent:[] as any[],closed:false,onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){if(first){first=false;throw new Error('Attempting to use a disconnected port object')}this.sent.push(structuredClone(v))},disconnect(){this.closed=true}})});
 await h.overlay();const p=await h.apply();
 await h.send(p,briefRequest('a'));assert.deepEqual(replies(p).at(-1),{id:'a',type:'result',ok:false,code:'NATIVE_HOST_DISCONNECTED',error:FAILURE_COPY.NATIVE_HOST_DISCONNECTED});assert.equal(h.natives[0].closed,true);assert.equal(h.natives[0].sent.length,0);
 await h.send(p,briefRequest('b'));assert.equal(h.natives.length,2);assert.equal(h.natives[1].sent.length,1);p.disconnect();
});
test('successful helper replies are rebuilt from validated fields: error text or a code on an ok reply never reaches the frame',async()=>{
 const h=harness();await h.overlay();const p=await h.apply();await h.send(p,briefRequest('p'));await h.reply(h.natives[0],{id:'p',type:'result',ok:true,result:briefPrepared(ONE),error:'PRIVATE_CANARY'.repeat(5),code:'AGE_CANARY'});
 const r=replies(p).at(-1);assert.deepEqual(Object.keys(r).sort(),['id','ok','result','type']);assert.ok(!JSON.stringify(p.sent).includes('CANARY'));
});
