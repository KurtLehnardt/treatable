import test from'node:test';import assert from'node:assert/strict';import React from'react';import{readFileSync}from'node:fs';
import{renderToStaticMarkup}from'react-dom/server';import TestRenderer,{act}from'react-test-renderer';
import{ApplyView}from'../src/apply-view';import{useApply,type ApplyController,type ApplyEnv}from'../src/use-apply';import{buildApplyPlan,blankPatient}from'../src/apply-plan';
import{OverlayView}from'../src/overlay-view';import{SITE_FILTERS}from'../src/site-filter-catalog';import{FAILURE_COPY}from'../src/failures';
import{APPLY_QUESTION_TEMPLATES,APPLY_FLAG_TEMPLATES,APPLY_PRESCREEN_TEMPLATES}from'../shared/apply-contract.mjs';
import{record,patient,preparedFixture,agentFixture,TODAY,SALT_LAKE,TOKEN,DIGEST}from'./apply-fixture';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const noop=()=>{};
function controller(over:Partial<ApplyController>={},p=patient(),agent?:any):ApplyController{const r=record();return{phase:'ready',nctId:'NCT07254806',record:r,recordSource:'helper',agentBusy:false,patient:p,zipNote:'',copied:'',reminder:'',plan:buildApplyPlan({record:r,patient:p,origin:SALT_LAKE,agent,today:TODAY}),edit:noop,answer:noop,chooseSite:noop,requestReview:noop,prepareAgain:noop,copyEmail:noop,saveReminder:noop,end:noop,...(agent?{agent}:{}),...over}}
const decode=(html:string)=>html.replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
test('section with a prepared review and an agent result: exact input collapsed, trace, catalog-only questions, flags and actions',()=>{
 const prepared=preparedFixture(),agent=agentFixture(),html=decode(renderToStaticMarkup(React.createElement(ApplyView,{vm:controller({preview:prepared.preview},patient(),agent)})));
 for(const text of ['Help me apply','Exact API input (no personal information)','"get_public_trial_evidence"','Public eligibility text for NCT07254806','Record lookups: 3 · sections read: Overview, Eligibility, Locations and contacts','Provider session deleted','Chosen by the agent from Treatable’s list.','Wasatch Spine Research','Sam Lee','Open in my email app','Copy email','Call 801-555-0100','Add follow-up reminder','If no reply by Friday, October 30, 2026'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/<details[^>]*class="apply-exact"[^>]* open/);for(const id of agent.questionIds)assert.ok(html.includes(APPLY_QUESTION_TEMPLATES[id as keyof typeof APPLY_QUESTION_TEMPLATES]),id);for(const id of agent.prescreenIds)assert.ok(html.includes(APPLY_PRESCREEN_TEMPLATES[id as keyof typeof APPLY_PRESCREEN_TEMPLATES]),id);
 for(const id of ['near_completion','contact_inconsistent','age_limit'] as const)assert.ok(html.includes(APPLY_FLAG_TEMPLATES[id]),id);
 assert.match(html,/href="mailto:slee@wasatchspine\.org\?subject=NCT07254806%2C%20IDCT-001-US/);assert.match(html,/href="tel:8015550100"/);assert.doesNotMatch(html,/Ask the agent to review this study<\/button>/,'one review per receipt');
 const test=decode(renderToStaticMarkup(React.createElement(ApplyView,{vm:controller({},patient(),agentFixture({mode:'test',cleanup:'failed'}))})));assert.match(test,/test mode, not a live API call/);assert.match(test,/Provider session deletion could not be confirmed/);
 const ready=decode(renderToStaticMarkup(React.createElement(ApplyView,{vm:controller({prepared,preview:prepared.preview})})));assert.match(ready,/<button type="button" class="primary apply-big">Ask the agent to review this study<\/button>/);assert.match(ready,/Treatable’s standard questions/);
});
test('native failure fallback still renders the full local plan, with the failure code shown honestly',()=>{
 const html=decode(renderToStaticMarkup(React.createElement(ApplyView,{vm:controller({recordSource:'official',prepareCode:'NATIVE_HOST_MISSING'})})));
 assert.ok(html.includes('The agent review is not available, but your contact plan is.'));assert.ok(html.includes(FAILURE_COPY.NATIVE_HOST_MISSING));assert.ok(html.includes('<code>NATIVE_HOST_MISSING</code>'));assert.ok(html.includes('loaded directly from ClinicalTrials.gov'));
 assert.ok(html.includes('The review needs the Treatable helper.'));assert.doesNotMatch(html,/Exact API input/);assert.ok(html.includes(APPLY_QUESTION_TEMPLATES.still_enrolling));assert.match(html,/href="mailto:/);
 const none=decode(renderToStaticMarkup(React.createElement(ApplyView,{vm:controller({record:undefined,plan:undefined,recordSource:undefined,prepareCode:'NATIVE_HOST_MISSING',recordCode:'RECORD_UNAVAILABLE'})})));assert.ok(none.includes(FAILURE_COPY.RECORD_UNAVAILABLE));assert.ok(none.includes('<code>RECORD_UNAVAILABLE</code>'));assert.doesNotMatch(none,/Open in my email app/);
});
test('missing required input shows inline messages and disables every send action; health fields are private inputs',()=>{
 const vm=controller({},blankPatient()),renderer=TestRenderer.create(React.createElement(ApplyView,{vm})),html=renderToStaticMarkup(React.createElement(ApplyView,{vm}));
 assert.match(html,/Enter your name\./);assert.match(html,/Enter a phone number or an email address/);assert.doesNotMatch(html,/href="mailto:|href="tel:/);
 const buttons=renderer.root.findAllByType('button');for(const label of ['Open in my email app','Copy email'])assert.equal(buttons.find(b=>b.children.join('')===label)!.props.disabled,true,label);
 const inputs=renderer.root.findAllByType('input').filter(i=>i.props.type!=='checkbox');assert.ok(inputs.length>=10);for(const input of inputs){assert.equal(input.props.autoComplete,'off');assert.equal(input.props.spellCheck,false);assert.equal(input.props['data-1p-ignore'],'true')}renderer.unmount();
});
test('overlay shows Help me apply first on a study page and keeps the search-page UI unchanged elsewhere',()=>{
 const vm:any={connected:true,ended:false,busy:false,error:'',fields:{},catalog:SITE_FILTERS,snapshot:{generation:'1',url:'https://clinicaltrials.gov/study/NCT07254806',nctIds:[],diagnostic:'',supported:false},records:[],collapsed:false,setField:noop,search:noop,refresh:noop,fetchRecords:noop,setCollapsed:noop,restore:noop,openPrivate:noop,close:noop};
 const withApply=renderToStaticMarkup(React.createElement(OverlayView,{vm,apply:React.createElement(ApplyView,{vm:controller()})}));assert.ok(withApply.indexOf('Help me apply')<withApply.indexOf('Search for other studies'));assert.doesNotMatch(withApply,/Find my matches/);assert.match(withApply,/This study page/);
 const plain=renderToStaticMarkup(React.createElement(OverlayView,{vm}));assert.doesNotMatch(plain,/Help me apply/);assert.match(plain,/Find my matches/);assert.match(plain,/Find studies for you\./);
 const content=readFileSync(new URL('../src/site-content.ts',import.meta.url),'utf8');assert.match(content,/value\.purpose==='overlay'\?"camera 'none'; microphone 'none'; geolocation 'none'; clipboard-write 'src'":"camera 'none'; microphone 'none'; geolocation 'none'"/);
});
class FakePort{sent:any[]=[];closed=false;l:((v:any)=>void)[]=[];d:(()=>void)[]=[];onMessage={addListener:(f:(v:any)=>void)=>this.l.push(f)};onDisconnect={addListener:(f:()=>void)=>this.d.push(f)};constructor(private respond:(v:any,p:FakePort)=>any){queueMicrotask(()=>this.emit({kind:'applyReady',nctId:'NCT07254806'}))}emit(v:any){for(const f of this.l)f(structuredClone(v))}postMessage(v:any){this.sent.push(structuredClone(v));const r=this.respond(v,this);if(r)queueMicrotask(()=>this.emit({reply:r}))}disconnect(){this.closed=true}}
function env(respond:(v:any,p:FakePort)=>any,over:Partial<ApplyEnv>={}){const ports:FakePort[]=[],copies:string[]=[],files:any[]=[];const e:ApplyEnv={runtime:{connect:()=>{const p=new FakePort(respond);ports.push(p);return p}},loadZips:async()=>({zips:{'84101':{city:'Salt Lake City',state:'UT',lat:SALT_LAKE.lat,lon:SALT_LAKE.lon}}}),userActivated:()=>true,today:()=>TODAY,now:()=>Date.UTC(2026,9,24,15,15),copyText:async t=>{copies.push(t)},download:(name,text,type)=>files.push({name,text,type}),...over};return{e,ports,copies,files}}
const settle=async()=>{for(let i=0;i<8;i++)await act(async()=>{await new Promise(r=>setImmediate(r))})};
function mount(e:ApplyEnv){const ref:{vm?:ApplyController}={};function Probe(){ref.vm=useApply('NCT07254806',e);return null}let r:any;act(()=>{r=TestRenderer.create(React.createElement(Probe))});return{ref,unmount:()=>act(()=>r.unmount())}}
test('hook: helper missing falls back to the official record; the plan works without any agent output',async()=>{
 const{e,ports}=env(v=>v.kind==='applyNative'?{id:v.request.id,type:'result',ok:false,code:'NATIVE_HOST_MISSING',error:'x'}:v.kind==='applyRecord'?{id:v.id,type:'record',ok:true,record:record()}:undefined);
 const{ref,unmount}=mount(e);await settle();const vm=ref.vm!;assert.equal(vm.phase,'ready');assert.equal(vm.recordSource,'official');assert.equal(vm.prepareCode,'NATIVE_HOST_MISSING');assert.equal(vm.plan?.questionIds.length,5);
 assert.deepEqual(ports[0].sent.map(v=>v.kind),['applyNative','applyRecord']);assert.deepEqual(ports[0].sent[0].request.payload,{nctId:'NCT07254806'});
 await act(async()=>{vm.edit('zip','84101')});await settle();assert.equal(ref.vm!.plan?.site?.city,'Salt Lake City');assert.ok(!JSON.stringify(ports[0].sent).includes('84101'),'ZIP never leaves the frame');unmount();
});
test('hook: review needs user activation, sends only the receipt, renders agent IDs; End revokes and clears everything',async()=>{
 let active=false;const{e,ports,copies,files}=env(v=>{if(v.kind!=='applyNative')return;const r=v.request;if(r.type==='prepareApply')return{id:r.id,type:'result',ok:true,result:preparedFixture()};if(r.type==='executeApply')return{id:r.id,type:'result',ok:true,result:agentFixture()};return{id:r.id,type:'result',ok:true}},{userActivated:()=>active});
 const{ref}=mount(e);await settle();assert.equal(ref.vm!.recordSource,'helper');assert.ok(ref.vm!.preview);
 await act(async()=>{ref.vm!.requestReview()});assert.equal(ref.vm!.agentCode,'USER_ACTIVATION_REQUIRED');assert.equal(ports[0].sent.length,1,'nothing sent without activation');
 for(const[k,v]of Object.entries({name:'Morgan Example',email:'morgan@example.org',phone:'2085550142'}))await act(async()=>{ref.vm!.edit(k as any,v)});await act(async()=>{ref.vm!.answer('diagnosis_details','Lumbar disc degeneration')});
 active=true;await act(async()=>{ref.vm!.requestReview()});await settle();const exec=ports[0].sent[1];assert.deepEqual(exec.request.payload,{token:TOKEN,digest:DIGEST});assert.ok(!JSON.stringify(ports[0].sent).match(/Morgan|example\.org|2085550142|Lumbar/),'patient fields never cross the port');
 assert.equal(ref.vm!.agent?.toolCalls,3);assert.deepEqual(ref.vm!.plan?.questionIds,['placebo','crossover','imaging','next_steps']);assert.equal(ref.vm!.prepared,undefined,'receipt used');
 await act(async()=>{ref.vm!.copyEmail()});await settle();assert.equal(ref.vm!.copied,'copied');assert.match(copies[0],/^To: trials@discgenics\.com\nSubject: NCT07254806, IDCT-001-US, /);
 await act(async()=>{ref.vm!.saveReminder()});assert.equal(files[0].name,'treatable-follow-up-NCT07254806.ics');assert.equal(files[0].type,'text/calendar');assert.ok(!files[0].text.includes('Morgan'));
 await act(async()=>{ref.vm!.prepareAgain()});await settle();assert.ok(ref.vm!.prepared);
 await act(async()=>{ref.vm!.end()});assert.equal(ref.vm!.phase,'ended');assert.equal(ref.vm!.record,undefined);assert.equal(ref.vm!.plan,undefined);assert.equal(ref.vm!.patient.name,'');assert.equal(ref.vm!.agent,undefined);
 assert.equal(ports[0].sent.at(-1).request.type,'revokeApply');assert.equal(ports[0].closed,true);
});
test('hook: an expired receipt is never sent; background end clears the section',async()=>{
 const{e,ports}=env(v=>v.kind==='applyNative'&&v.request.type==='prepareApply'?{id:v.request.id,type:'result',ok:true,result:preparedFixture(Date.UTC(2026,9,24,15,0))}:undefined);
 const{ref}=mount(e);await settle();await act(async()=>{ref.vm!.requestReview()});assert.equal(ref.vm!.agentCode,'APPLY_EXPIRED');assert.equal(ports[0].sent.length,1);
 await act(async()=>{ports[0].emit({kind:'applyEnded'})});assert.equal(ref.vm!.phase,'ended');assert.equal(ref.vm!.record,undefined);
});
