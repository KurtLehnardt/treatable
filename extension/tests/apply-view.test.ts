import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import TestRenderer,{act} from 'react-test-renderer';
import {ApplyView,probabilityShares} from '../src/apply-view';import {briefTraceFixture} from './apply-fixture';import {traceBody,STUDY_BRIEF_ROUTES} from '../shared/apply-contract.mjs';import {useApply,type ApplyController,type ApplyEnv} from '../src/use-apply';import {OverlayAssistant} from '../src/overlay-app';import {captureSiteActivations} from '../src/overlay-port';import {SITE_FILTERS} from '../src/site-filter-catalog';
import {normalizeApplyRecord,normalizeStudyBrief,studyPurposeText,PURPOSE_MAX_EXCERPTS} from '../shared/apply-record.mjs';import type {StudyBriefResult,PreparedStudyBrief} from '../shared/apply-contract.mjs';
const IDS=['NCT99999990','NCT99999991'],NOW=Date.UTC(2026,9,24,15),EXPIRES=NOW+300000,TOKEN='t'.repeat(43),DIGEST='a'.repeat(64);
let PURPOSE='A synthetic controlled study.',DETAIL='Two treatments are spaced 4 weeks apart. Follow-up visits occur at 3 and 12 months post injection. Randomization is 2:1 between treatment and sham. Control participants can cross over after 3-month follow-up.';
function raw(id:string){return{protocolSection:{identificationModule:{nctId:id,briefTitle:id===IDS[0]?'First synthetic study':'Second synthetic study',orgStudyIdInfo:{id:'SYNTHETIC-ONLY'}},descriptionModule:{briefSummary:PURPOSE,detailedDescription:DETAIL},designModule:{designInfo:{allocation:'RANDOMIZED',maskingInfo:{masking:'SINGLE'}}},statusModule:{overallStatus:'RECRUITING',primaryCompletionDateStruct:{date:'2026-12-31',type:'ESTIMATED'},startDateStruct:{date:'2026-01-01',type:'ACTUAL'}},eligibilityModule:{},contactsLocationsModule:{centralContacts:[{name:'Study coordinator',email:id===IDS[0]?'one@example.org':'two@example.org',phone:'303-555-0100'}],locations:[{facility:'Synthetic Clinic',city:'Example City',state:'Colorado',country:'United States',status:'RECRUITING',contacts:[]}]}}}}
const records=(ids=IDS)=>ids.map(id=>normalizeApplyRecord(raw(id),NOW));const briefs=(ids=IDS)=>ids.map(id=>normalizeStudyBrief(raw(id),NOW));
function prepared(ids=IDS):PreparedStudyBrief{return{kind:'preparedStudyBrief',token:TOKEN,digest:DIGEST,expiresAt:EXPIRES,records:records(ids),briefs:briefs(ids)}}
function result(ids=IDS,trace:{none?:boolean;live?:boolean;cut?:boolean}={}):StudyBriefResult{return{kind:'studyBrief',mode:trace.live?'live':'test',digest:DIGEST,briefs:briefs(ids).map(b=>{const item=b.items.find(i=>i.text==='Two treatments are spaced 4 weeks apart.')!;return{...b,claims:[{id:'claim1',category:'timeline',text:item.text,evidenceIds:[item.id],sourceQuotes:[item.text]}]}}),studyPlans:ids.map(nctId=>({nctId,briefItemIds:briefs([nctId])[0].items.slice(0,1).map(i=>i.id),questionIds:['visits','crossover','costs'],prescreenIds:['diagnosis_details','prior_treatments'],flagIds:[],routes:[{questionId:'visits',route:'ask_coordinator',evidenceIds:[]},{questionId:'crossover',route:'ask_coordinator',evidenceIds:[]},{questionId:'costs',route:'ask_coordinator',evidenceIds:[]}],prioritizedQuestionIds:['visits','crossover','costs']})),agentStatus:'complete',decisionStatus:'complete',failureCodes:[],cleanup:'deleted',toolCalls:ids.length,...(trace.none?{}:{apiTrace:briefTraceFixture(ids,trace.cut?{decisionsRequest:traceBody({questions:Array.from({length:40},(_,i)=>({name:`q${i}`,instructions:'x'.repeat(40)}))},300)}:{})})}}
const flush=async()=>{for(let i=0;i<20;i++)await new Promise<void>(r=>queueMicrotask(r))};
class Events{listeners:((v:any)=>void)[]=[];addListener=(f:(v:any)=>void)=>this.listeners.push(f);emit=(v?:any)=>this.listeners.forEach(f=>f(v))}
class Port{sent:any[]=[];closed=false;onMessage=new Events();onDisconnect=new Events();constructor(private handler:(v:any,p:Port)=>void){queueMicrotask(()=>this.onMessage.emit({kind:'applyReady',nctId:IDS[0],nctIds:IDS,expiresAt:EXPIRES,studies:records().map(r=>({nctId:r.nctId,title:r.title}))}))}postMessage(v:any){this.sent.push(structuredClone(v));this.handler(v,this)}reply(reply:any){queueMicrotask(()=>this.onMessage.emit({reply}))}disconnect(){this.closed=true}}
function harness(options:{holdExecute?:boolean;holdRecords?:boolean;failPrepare?:boolean;emitTrace?:boolean;truncatePrepared?:boolean;failCopy?:boolean;withoutPurposes?:boolean;purposes?:unknown;noTrace?:boolean;live?:boolean;cutTrace?:boolean}={}){const ports:Port[]=[],copies:string[]=[],attempts:string[]=[],opened:string[]=[],downloads:any[]=[],held:(()=>void)[]=[],heldRecords:(()=>void)[]=[];let clock=NOW,selected=IDS.slice(0,1),active=true;
 const runtime={connect:()=>{const p=new Port((v,p)=>{if(v.kind==='studyBriefRecord'){const ids=v.nctIds;const send=()=>p.reply({id:v.id,type:'briefRecords',ok:true,records:records(ids),briefs:briefs(ids),...(options.withoutPurposes?{}:{purposes:options.purposes??ids.map((id:string)=>studyPurposeText(raw(id)))})});if(options.holdRecords)heldRecords.push(send);else send();return}const request=v.request;if(request?.type==='revokeStudyBrief'){p.reply({id:request.id,type:'result',ok:true});return}if(request?.type==='prepareStudyBrief'){selected=request.payload.nctIds;p.reply(options.failPrepare?{id:request.id,type:'result',ok:false,code:'NATIVE_HOST_MISSING',error:'Helper unavailable'}:{id:request.id,type:'result',ok:true,result:options.truncatePrepared?{...prepared(selected),records:prepared(selected).records.map(r=>({...r,sites:[],sitesTruncated:true}))}:prepared(selected)});return}if(request?.type==='executeStudyBrief'){const ids=[...selected];if(options.emitTrace)p.reply({id:request.id,type:'trace',ok:true,trace:{sequence:1,stage:'agent.tool.request',nctId:ids[0],sessionId:'PROVIDER_ID_CANARY'}});const send=()=>p.reply({id:request.id,type:'result',ok:true,result:result(ids,{none:options.noTrace,live:options.live,cut:options.cutTrace})});if(options.holdExecute)held.push(send);else send();return}throw Error('Unexpected request')});ports.push(p);return p}};
 const env:ApplyEnv={runtime,loadZips:async()=>({zips:{'84101':{city:'Example',state:'UT',lat:40.7,lon:-111.9}}}),userActivated:()=>active,today:()=>new Date(NOW),now:()=>clock,copyText:value=>{attempts.push(value);if(options.failCopy)return Promise.reject(Error('clipboard denied'));copies.push(value);return Promise.resolve()},download:(name,text,type)=>downloads.push({name,text,type}),openMailto:url=>{opened.push(url)}};return{env,runtime,ports,copies,attempts,opened,downloads,held,heldRecords,setClock:(v:number)=>{clock=v},setActive:(v:boolean)=>{active=v}};
}
function mount(h:ReturnType<typeof harness>){const ref:{vm?:ApplyController}={};function Probe(){const vm=useApply(IDS[0],h.env);ref.vm=vm;return React.createElement(ApplyView,{vm})};let renderer!:TestRenderer.ReactTestRenderer;act(()=>{renderer=TestRenderer.create(React.createElement(Probe))});return{ref,renderer,unmount:()=>act(()=>renderer.unmount())}}
const renderedText=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(renderedText).join(' '):node?.children?renderedText(node.children):'';
const html=(vm:ApplyController)=>renderToStaticMarkup(React.createElement(ApplyView,{vm}));

test('source-linked brief renders readable participation, unknowns, three questions and editable email without duplicate consent',async()=>{const h=harness(),m=mount(h);try{await act(flush);assert.equal(m.ref.vm!.phase,'ready');assert.equal(h.ports[0].sent.some(v=>v.kind==='applyNative'),false,'initial load is public browser fetch only');await act(async()=>{m.ref.vm!.requestReview();await flush()});const text=html(m.ref.vm!);for(const phrase of ['Understand this study','Two treatments are spaced 4 weeks apart.','Read the supporting record text','Important unknowns','Ask the study team','Your email draft','Open draft in my email app','Copy full email','OpenAI reviews public study information only'])assert.ok(text.includes(phrase),phrase);assert.match(text,/textarea/);assert.match(text,/official record/);assert.doesNotMatch(text,/Confirm what you|Review what you will share|Exact API input/);assert.equal(m.ref.vm!.result?.studyPlans[0].prioritizedQuestionIds.length,3);}finally{m.unmount()}});

test('manual draft survives late public AI completion and local detail edits; private fields never cross the port',async()=>{const h=harness({holdExecute:true}),m=mount(h);try{await act(flush);await act(async()=>{m.ref.vm!.edit('name','LOCAL_NAME_CANARY');m.ref.vm!.edit('email','private@example.org');m.ref.vm!.answer('diagnosis_details','LOCAL_HEALTH_CANARY')});await act(async()=>{m.ref.vm!.editDraft('body','My carefully edited message');m.ref.vm!.requestReview();await flush()});assert.equal(h.held.length,1);await act(async()=>{m.ref.vm!.editDraft('body','The final manual draft');m.ref.vm!.edit('name','SECOND_LOCAL_NAME');h.held[0]();await flush()});assert.equal(m.ref.vm!.draft?.body,'The final manual draft');assert.equal(m.ref.vm!.draftOutdated,true);assert.ok(!JSON.stringify(h.ports[0].sent).match(/LOCAL_NAME|LOCAL_HEALTH|private@example|SECOND_LOCAL/));await act(async()=>m.ref.vm!.updateDraft());assert.match(m.ref.vm!.draft!.body,/SECOND_LOCAL_NAME/);assert.match(m.ref.vm!.draft!.body,/LOCAL_HEALTH_CANARY/);await act(async()=>{m.ref.vm!.copyEmail();await flush()});assert.match(h.copies[0],/LOCAL_HEALTH_CANARY/);}finally{m.unmount()}});

test('selected-study drafts stay independent; removal clears only that study draft',async()=>{const h=harness(),m=mount(h);try{await act(flush);await act(async()=>{m.ref.vm!.selectStudies(IDS);await flush()});await act(async()=>m.ref.vm!.editDraft('body','FIRST_ONLY'));await act(async()=>m.ref.vm!.viewStudy(IDS[1]));assert.doesNotMatch(m.ref.vm!.draft!.body,/FIRST_ONLY/);await act(async()=>m.ref.vm!.editDraft('body','SECOND_ONLY'));await act(async()=>m.ref.vm!.viewStudy(IDS[0]));assert.equal(m.ref.vm!.draft?.body,'FIRST_ONLY');await act(async()=>{m.ref.vm!.selectStudies([IDS[1]]);await flush()});assert.equal(m.ref.vm!.draft?.body,'SECOND_ONLY');await act(async()=>{m.ref.vm!.selectStudies(IDS);await flush();m.ref.vm!.viewStudy(IDS[0])});assert.doesNotMatch(m.ref.vm!.draft!.body,/FIRST_ONLY|SECOND_ONLY/);}finally{m.unmount()}});

test('drafts that fit the raised limit open directly with separate to, subject and body, plus a note that some apps shorten long links',async()=>{const h=harness(),m=mount(h);try{await act(flush);const vm=()=>m.ref.vm!;
 const mid='My full message. '.repeat(250);await act(async()=>vm().editDraft('body',mid));
 assert.ok(mid.length>1800&&vm().mailto!.length>2000&&vm().mailto!.length<=8000,'a draft past the old 2,000-character limit now opens directly');assert.equal(vm().handoff?.mode,'link');assert.equal(vm().draftIssue,undefined);
 const url=vm().mailto!,[target,query]=url.slice('mailto:'.length).split('?'),params=Object.fromEntries(query.split('&').map(kv=>{const at=kv.indexOf('=');return[kv.slice(0,at),decodeURIComponent(kv.slice(at+1))]}));
 assert.equal(decodeURIComponent(target),'one@example.org');assert.deepEqual(Object.keys(params),['subject','body']);assert.equal(params.subject,vm().draft!.subject);assert.equal(params.body,mid.replace(/\n/g,'\r\n'));assert.doesNotMatch(params.body,/^\s*(?:To|Subject)\s*:/im);
 const shown=html(vm());assert.match(shown,/Open draft in my email app/);assert.match(shown,/Some email apps, notably Outlook on Windows, may shorten very long links, so check the whole message before you send it\./);assert.doesNotMatch(shown,/Copy message and open email app/);assert.match(shown,/>Copy message</);
 assert.equal(h.attempts.length,0);assert.equal(h.opened.length,0);
}finally{m.unmount()}});
test('a draft above the mailto limit shows one combined button; clicking it copies only the message body, then opens mailto with only the recipient and subject',async()=>{const h=harness(),m=mount(h);try{await act(flush);const vm=()=>m.ref.vm!,to=vm().draft!.to,subject=vm().draft!.subject;
 const long='My full message. '.repeat(450),pasted=`To: ${to}\nSubject: ${subject}\n\n${long}`;await act(async()=>vm().editDraft('body',pasted));
 assert.equal(vm().handoff?.mode,'copy');assert.equal(vm().mailto,undefined);assert.equal(vm().draftIssue,undefined,'no too-long message replaces the button');
 const buttons=()=>m.renderer.root.findAllByType('button').map(n=>renderedText(n)),shown=html(vm());
 assert.ok(buttons().includes('Copy message and open email app'));assert.ok(!buttons().includes('Copy message'),'the plain Copy message button is hidden until copying fails');assert.doesNotMatch(shown,/Open draft in my email app|too long/i);assert.doesNotMatch(shown,/notably Outlook/);
 assert.equal(h.attempts.length,0,'nothing is copied before the click');assert.equal(h.opened.length,0,'nothing is opened before the click');
 act(()=>{m.renderer.root.findAllByType('button').find(n=>renderedText(n)==='Copy message and open email app')!.props.onClick()});
 assert.deepEqual(h.attempts,[long],'the clipboard write starts inside the click, with the message body only (pasted To and Subject lines left out)');assert.equal(h.opened.length,0,'the email app opens only after the copy succeeds');
 await act(flush);
 assert.deepEqual(h.copies,[long]);assert.deepEqual(h.opened,[`mailto:one@example.org?subject=${encodeURIComponent(subject)}`],'only the recipient and subject');assert.ok(!h.opened[0].includes('body='));assert.ok(!decodeURIComponent(h.opened[0]).includes('My full message'));
 assert.equal(vm().copied,'handoff');assert.match(renderedText(m.renderer.root),/Message copied: paste it into the email body/);
 await act(async()=>vm().editDraft('body',long+' More.'));assert.equal(vm().copied,'','editing the draft clears the copied notice');assert.equal(h.opened.length,1);
 await act(async()=>vm().editDraft('body','Short again.'));assert.equal(vm().handoff?.mode,'link');assert.ok(!buttons().includes('Copy message and open email app'));
 act(()=>vm().copyAndOpenEmail());await act(flush);assert.equal(h.attempts.length,1,'the combined action does nothing when the draft opens directly');
}finally{m.unmount()}});
test('if the clipboard write fails the email app is not opened and the Copy message button and instructions appear',async()=>{const h=harness({failCopy:true}),m=mount(h);try{await act(flush);const vm=()=>m.ref.vm!;
 await act(async()=>vm().editDraft('body','My full message. '.repeat(450)));const buttons=()=>m.renderer.root.findAllByType('button').map(n=>renderedText(n));
 assert.ok(!buttons().includes('Copy message'));
 act(()=>{m.renderer.root.findAllByType('button').find(n=>renderedText(n)==='Copy message and open email app')!.props.onClick()});await act(flush);
 assert.equal(h.attempts.length,1);assert.equal(h.copies.length,0);assert.equal(h.opened.length,0,'no empty email is opened when there is nothing to paste');assert.equal(vm().copied,'handoff-failed');
 assert.ok(buttons().includes('Copy message'),'the existing Copy message button is shown');assert.ok(buttons().includes('Copy message and open email app'));
 assert.match(renderedText(m.renderer.root),/Copying was unavailable, so your email app was not opened\. Use Copy message, or select the message above and copy it\. Then open your email app, put the recipient and subject in their own fields, and paste the message into the email body\./);
 assert.doesNotMatch(renderedText(m.renderer.root),/Message copied/);
 act(()=>{m.renderer.root.findAllByType('button').find(n=>renderedText(n)==='Copy message')!.props.onClick()});await act(flush);assert.equal(h.attempts.length,2);assert.equal(vm().copied,'failed');assert.equal(h.opened.length,0);
}finally{m.unmount()}});
test('the long-draft handoff keeps typed details local: only the clipboard gets them, never the mailto link or the helper port',async()=>{const h=harness(),m=mount(h);try{await act(flush);const vm=()=>m.ref.vm!,NAME='NAME_CANARY_91d3f',PHONE='(555) 010-4477';
 await act(async()=>{vm().edit('name',NAME);vm().edit('phone',PHONE)});await act(async()=>vm().editDraft('body',vm().draft!.body+'\n\n'+'More background that I would like to share. '.repeat(200)));assert.equal(vm().handoff?.mode,'copy');
 act(()=>vm().copyAndOpenEmail());await act(flush);
 assert.ok(h.copies[0].includes(NAME)&&h.copies[0].includes(PHONE));for(const secret of [NAME,PHONE,'More background']){assert.ok(!h.opened[0].includes(secret),`mailto leaked ${secret}`);assert.ok(!JSON.stringify(h.ports.flatMap(p=>p.sent)).includes(secret),`helper port leaked ${secret}`)}
}finally{m.unmount()}});

test('unavailable helper preserves official facts and local draft, with truthful failure status',async()=>{const h=harness({failPrepare:true}),m=mount(h);try{await act(flush);await act(async()=>{m.ref.vm!.requestReview();await flush()});assert.equal(m.ref.vm!.agentCode,'NATIVE_HOST_MISSING');assert.equal(m.ref.vm!.record?.nctId,IDS[0]);assert.ok(m.ref.vm!.draft?.body);assert.doesNotMatch(html(m.ref.vm!),/Agents: public study review complete/);}finally{m.unmount()}});

test('End rejects late AI output and clears all local fields and drafts',async()=>{const h=harness({holdExecute:true}),m=mount(h);try{await act(flush);await act(async()=>{m.ref.vm!.edit('name','PRIVATE_END_CANARY');m.ref.vm!.editDraft('body','PRIVATE_DRAFT_CANARY');m.ref.vm!.requestReview();await flush()});await act(async()=>{m.ref.vm!.end();h.held[0]();await flush()});assert.equal(m.ref.vm!.phase,'ended');assert.equal(m.ref.vm!.patient.name,'');assert.equal(m.ref.vm!.draft,undefined);assert.equal(m.ref.vm!.records.length,0);assert.equal(m.ref.vm!.result,undefined);}finally{m.unmount()}});

test('source-ended event and original fixed expiry clear private state without renewing a lease',async(t)=>{t.mock.timers.enable({apis:['setTimeout']});const h=harness(),m=mount(h);try{await act(flush);await act(async()=>{m.ref.vm!.edit('name','EXPIRY_CANARY');m.ref.vm!.editDraft('body','EXPIRING_DRAFT')});assert.equal(m.ref.vm!.expiresAt,EXPIRES);h.setClock(EXPIRES);await act(async()=>{t.mock.timers.tick(300001);await flush()});assert.equal(m.ref.vm!.phase,'ended');assert.equal(m.ref.vm!.draft,undefined);assert.equal(m.ref.vm!.patient.name,'');}finally{m.unmount();t.mock.timers.reset()}});

test('background source invalidation clears current local draft and ignores delayed records',async()=>{const h=harness({holdRecords:true}),m=mount(h);try{await act(flush);assert.equal(h.heldRecords.length,1);await act(async()=>{h.ports[0].onMessage.emit({kind:'applyEnded'});h.heldRecords[0]();await flush()});assert.equal(m.ref.vm!.phase,'ended');assert.equal(m.ref.vm!.record,undefined);assert.equal(m.ref.vm!.draft,undefined);}finally{m.unmount()}});

test('production overlay entry presents the public brief before search, never mounts private-health confirmation',async(t)=>{t.mock.method(Date,'now',()=>NOW);const old={window:(globalThis as any).window,document:(globalThis as any).document,chrome:(globalThis as any).chrome,navigator:(globalThis as any).navigator};const win:any=new EventTarget(),doc:any=new EventTarget(),parent={postMessage(){}};win.parent=parent;doc.visibilityState='visible';doc.hidden=false;const h=harness(),messages=new Events();let privatePorts=0;
 const snapshot={generation:'public-source',url:`https://clinicaltrials.gov/study/${IDS[0]}`,nctIds:[],diagnostic:'Study page',supported:true};
 const sitePort:any={onMessage:messages,onDisconnect:new Events(),disconnect(){},postMessage(v:any){if(v.type==='site.authenticate'){messages.emit({type:'site.ready',snapshot,filters:SITE_FILTERS,search:{},study:{nctId:IDS[0]}});messages.emit({type:'site.availability',options:{onlyAccepting:true,includeSoon:false,includeInvitation:false},loading:false})}else messages.emit({id:v.id,ok:true,result:{active:true}})}};
 const runtime={connect:({name}:{name:string})=>{if(name==='treatable.site.overlay.v1')return sitePort;if(name==='treatable-apply-v1')return h.runtime.connect();privatePorts++;throw Error('Private-health port must not open')},sendMessage:async()=>({ok:true}),getURL:(v:string)=>`chrome-extension://test/${v}`};
 for(const[key,value]of Object.entries({window:win,document:doc,chrome:{runtime},navigator:{userActivation:{isActive:true}}}))Object.defineProperty(globalThis,key,{configurable:true,value});captureSiteActivations(win);let renderer!:TestRenderer.ReactTestRenderer;
 try{await act(async()=>{renderer=TestRenderer.create(React.createElement(OverlayAssistant));const e=new Event('message');Object.assign(e,{source:parent,origin:'https://clinicaltrials.gov',data:{type:'treatable.site.activate',purpose:'overlay',capability:'a'.repeat(64)}});win.dispatchEvent(e);await flush()});const text=JSON.stringify(renderer.toJSON());assert.ok(text.includes('Understand this study'));assert.ok(text.indexOf('Understand this study')<text.indexOf('Search for other studies'));assert.doesNotMatch(text,/Find my matches|Confirm what you|Review what you will share/);assert.equal(privatePorts,0);assert.equal(h.ports[0].sent.some(v=>v.kind==='applyNative'),false);
 await act(async()=>{renderer.root.findAllByType('button').find(n=>renderedText(n)==='Generate study brief')!.props.onClick();await flush()});
 assert.match(renderedText(renderer.root),/public study review complete/);assert.match(renderedText(renderer.root),/questions classified/);
 const editor=()=>renderer.root.findAllByType('textarea').find(n=>n.props.className==='apply-email')!;
 await act(async()=>{editor().props.onChange({target:{value:'My reviewed enquiry from the production entry.'}});await flush()});
 assert.equal(editor().props.value,'My reviewed enquiry from the production entry.');
 const handoff=renderer.root.findAllByType('a').find(n=>renderedText(n)==='Open draft in my email app')!;
 assert.ok(handoff);assert.match(handoff.props.href,/^mailto:one@example\.org\?subject=/);assert.equal(decodeURIComponent(handoff.props.href.split('&body=')[1]),'My reviewed enquiry from the production entry.');
 assert.equal(privatePorts,0);assert.doesNotMatch(renderedText(renderer.root),/Session ended|Confirm what you|Review what you will share/);
 }finally{if(renderer)act(()=>renderer.unmount());for(const[key,value]of Object.entries(old))Object.defineProperty(globalThis,key,{configurable:true,value})}
});

test('real validated activity frames do not settle the result early or expose provider identifiers',async()=>{const h=harness({holdExecute:true,emitTrace:true}),m=mount(h);try{await act(flush);await act(async()=>{m.ref.vm!.requestReview();await flush()});assert.equal(m.ref.vm!.activity.length,1);assert.equal(m.ref.vm!.activity[0].stage,'agent.tool.request');assert.equal(m.ref.vm!.agentBusy,true);assert.equal(m.ref.vm!.result,undefined);assert.doesNotMatch(JSON.stringify(m.ref.vm!.activity),/PROVIDER_ID_CANARY/);await act(async()=>{h.held[0]();await flush()});assert.equal((m.ref.vm!.result as StudyBriefResult|undefined)?.agentStatus,'complete');assert.match(html(m.ref.vm!),/How this was generated/);assert.match(html(m.ref.vm!),/Reading selected public study evidence/);assert.doesNotMatch(html(m.ref.vm!),/PROVIDER_ID_CANARY/);}finally{m.unmount()}});

test('registry milestone estimates remain separate from a participant visit schedule',async()=>{const h=harness(),m=mount(h);try{await act(flush);const registry=m.renderer.root.findByProps({className:'brief-registry'});const shown=renderedText(registry);assert.match(shown,/Registry milestones/);assert.match(shown,/estimated/i);assert.match(shown,/2026-12-31/);for(const fact of m.renderer.root.findAllByProps({className:'brief-fact'}))assert.doesNotMatch(renderedText(fact),/2026-12-31/);}finally{m.unmount()}});

test('generating a brief keeps the full locally loaded record instead of the size-capped prepared copy',async()=>{const h=harness({truncatePrepared:true}),m=mount(h);try{await act(flush);assert.equal(m.ref.vm!.record?.sites.length,1);await act(async()=>{m.ref.vm!.requestReview();await flush()});assert.equal((m.ref.vm!.result as StudyBriefResult|undefined)?.agentStatus,'complete');assert.equal(m.ref.vm!.record?.sites.length,1);assert.equal(m.ref.vm!.record?.sitesTruncated,false);assert.equal(m.ref.vm!.plan?.site?.facility,'Synthetic Clinic');}finally{m.unmount()}});

test('Copy message copies only the body; Copy full email keeps labelled To and Subject lines for records; pasted headers never reach the handoff',async()=>{const h=harness(),m=mount(h);try{await act(flush);const vm=()=>m.ref.vm!,to=vm().draft!.to,subject=vm().draft!.subject;assert.equal(to,'one@example.org');
 for(const text of [vm().draft!.body,decodeURIComponent(vm().mailto!.split('&body=')[1])]){assert.doesNotMatch(text,/^\s*(?:To|Subject)\s*:/im);assert.ok(!text.includes(to));assert.ok(!text.includes(subject))}
 await act(async()=>{vm().copyMessage();await flush()});assert.equal(h.copies[0],vm().draft!.body);assert.equal(vm().copied,'message');
 await act(async()=>{vm().copyEmail();await flush()});assert.ok(h.copies[1].startsWith(`To: ${to}\nSubject: ${subject}\n\n`));assert.ok(h.copies[1].endsWith(vm().draft!.body));assert.equal(vm().copied,'full');
 await act(async()=>vm().editDraft('body',`To: ${to}\nSubject: ${subject}\n\nMy own message.`));assert.equal(vm().draftHeaders,true);assert.match(html(vm()),/left out when you open or copy the message/);
 assert.equal(decodeURIComponent(vm().mailto!.split('&body=')[1]),'My own message.');assert.ok(vm().mailto!.startsWith('mailto:one@example.org?subject='));
 await act(async()=>{vm().copyMessage();await flush()});assert.equal(h.copies[2],'My own message.');
 await act(async()=>{vm().copyEmail();await flush()});assert.equal(h.copies[3],`To: ${to}\nSubject: ${subject}\n\nMy own message.`,'full copy never doubles the header lines');
}finally{m.unmount()}});

/** A registry-style purpose of several thousand characters made of distinct sentences, so any dropped or repeated part is detected. */
const longPurpose=(sentences:number)=>Array.from({length:sentences},(_,i)=>`Sentence ${i+1} of the synthetic purpose describes what participants in group ${i%7} will be asked to do.`).join(' ');
async function purposeHtml(purpose:string,options:Parameters<typeof harness>[0]={}){PURPOSE=purpose;const h=harness(options),m=mount(h);try{await act(flush);assert.equal(m.ref.vm!.phase,'ready');return{html:html(m.ref.vm!),vm:m.ref.vm!}}finally{m.unmount();PURPOSE='A synthetic controlled study.'}}

test('a 6,000+ character study purpose is shown in full, with no ellipsis, before the brief is generated',async()=>{const purpose=longPurpose(65);assert.ok(purpose.length>6000);const{html:page,vm}=await purposeHtml(purpose);assert.ok(page.includes(purpose),'every character of the purpose is on the page');assert.ok(!page.includes('\u2026'),'no ellipsis character');assert.ok(!purpose.endsWith('...'));assert.match(page,/class="brief-scroll"[^>]*role="region"[^>]*aria-label="Study purpose, full text"/);assert.match(page,/tabindex="0"/);assert.equal(vm.purpose,purpose);});

test('a short study purpose stays a plain paragraph',async()=>{const{html:page}=await purposeHtml('A short purpose.');assert.match(page,/<h4>Study purpose<\/h4><p>A short purpose\.<\/p>/);assert.doesNotMatch(page,/brief-scroll/);});

test('the full purpose is rebuilt from the consecutive source excerpts when the record channel does not carry it',async()=>{const purpose=longPurpose(65);const{html:page,vm}=await purposeHtml(purpose,{withoutPurposes:true});assert.equal(vm.purpose,undefined);assert.ok(vm.brief!.items.filter(i=>i.field==='protocolSection.descriptionModule.briefSummary').length>1,'the payload excerpts are split');assert.ok(page.includes(purpose));assert.ok(!page.includes('\u2026'));assert.equal((page.match(/<h4>Study purpose<\/h4>/g)??[]).length,1,'one passage, not one card per excerpt');assert.match(page,/Participant schedule \(source wording\)/,'the split purpose does not push the other facts out of the first four cards');});

test('a purpose longer than the model payload allows is still displayed whole from the local record',async()=>{const purpose=longPurpose(230);assert.ok(purpose.length>20000);const{html:page,vm}=await purposeHtml(purpose);const excerpts=vm.brief!.items.filter(i=>i.field==='protocolSection.descriptionModule.briefSummary');assert.equal(excerpts.length,PURPOSE_MAX_EXCERPTS,'the payload stays bounded');assert.ok(excerpts.map(i=>i.text).join(' ').length<purpose.length);assert.ok(page.includes(purpose),'the page still shows every character');assert.ok(!page.includes('\u2026'));});

test('a malformed local purpose list is refused instead of shown',async()=>{for(const purposes of [['one','two'],[7],'text']){const{vm}=await purposeHtml('A synthetic controlled study.',{purposes});assert.equal(vm.record,undefined);assert.equal(vm.recordCode,'INVALID_NATIVE_REPLY');}});

test('a long study description is not shortened either',async()=>{const description=`Participants complete clinic visits every 4 weeks, ${'with assessments of symptoms and function '.repeat(30)}until week 52.`;assert.ok(description.length>1000&&description.length<1400);DETAIL=description;try{const h=harness(),m=mount(h);try{await act(flush);const page=html(m.ref.vm!);assert.ok(page.includes(description));assert.ok(!page.includes('\u2026'));}finally{m.unmount()}}finally{DETAIL='Two treatments are spaced 4 weeks apart. Follow-up visits occur at 3 and 12 months post injection. Randomization is 2:1 between treatment and sham. Control participants can cross over after 3-month follow-up.'}});

// --- API trace under "How this was generated" ---
const hostText=(m:ReturnType<typeof mount>)=>renderedText(m.renderer.root);
const res=(m:ReturnType<typeof mount>)=>m.ref.vm!.result as StudyBriefResult|undefined;
const nodesWith=(m:ReturnType<typeof mount>,className:string)=>m.renderer.root.findAllByProps({className});
async function generate(m:ReturnType<typeof mount>){await act(flush);await act(async()=>{m.ref.vm!.requestReview();await flush()})}

test('How this was generated shows both exact request bodies, the Agents tool calls and per-question Decisions probabilities',async()=>{
 const h=harness(),m=mount(h);
 try{
  await generate(m);const trace=res(m)!.apiTrace!;assert.ok(trace);
  const bodies=nodesWith(m,'trace-json');assert.equal(bodies.length,2);
  assert.equal(renderedText(bodies[0]),trace.agentsRequest.text);assert.equal(renderedText(bodies[1]),trace.decisionsRequest.text);
  assert.match(trace.agentsRequest.text,/"get_public_selected_study"/);assert.match(trace.decisionsRequest.text,/NCT99999990_visits/);
  const text=hostText(m);for(const phrase of['Agents API request body','Decisions API request body','Agents tool calls','Decisions output','Chosen route:'])assert.ok(text.includes(phrase),phrase);
  const tools=renderedText(nodesWith(m,'trace-tools')[0]);assert.match(tools,/get_public_selected_study\(\{"nctId":"NCT99999990"\}\)/);assert.match(tools,/Returned 12 public source items for NCT99999990/);
  const decisions=nodesWith(m,'trace-decision');assert.equal(decisions.length,3);
  const first=renderedText(decisions[0]);assert.match(first,/Chosen route:\s*Ask the study team/);assert.match(first,/confidence 83%/);
  for(const route of STUDY_BRIEF_ROUTES)assert.ok(first.includes(route),`${route} probability row`);
  assert.match(renderedText(decisions[1]),/Decisions chose “Answered in the record”, but no cited record text supports that, so it is shown as “Ask the study team”/);
  // the three displayed shares of every question add up to exactly 100%
  for(const d of decisions){const shares=nodesWith({renderer:{root:d}} as any,'trace-probability').map(row=>row.findByType('strong').children.join(''));assert.equal(shares.length,3);assert.ok(shares.every(v=>/^\d+\.\d%$/.test(v)));assert.equal(shares.reduce((n,v)=>n+Math.round(parseFloat(v)*10),0),1000)}
  assert.equal(renderedText(decisions[0]).includes('83.0%'),true);assert.equal(renderedText(decisions[1]).includes('60.0%'),true);
 }finally{m.unmount()}
});

test('displayed probability shares always add up to exactly 100% and follow the underlying values',()=>{
 const tenths=(p:Record<string,number>)=>Object.values(probabilityShares(p as any)).map(v=>Math.round(parseFloat(v)*10));
 assert.deepEqual(tenths({answered_by_record:.05,ask_patient:.12,ask_coordinator:.83}),[50,120,830]);
 assert.deepEqual(tenths({answered_by_record:1/3,ask_patient:1/3,ask_coordinator:1/3}).reduce((a,b)=>a+b,0),1000);
 assert.deepEqual(tenths({answered_by_record:.0004,ask_patient:.4998,ask_coordinator:.4998}),[0,500,500]);
 assert.deepEqual(tenths({answered_by_record:1,ask_patient:0,ask_coordinator:0}),[1000,0,0]);
 let seed=7;const random=()=>(seed=(seed*16807)%2147483647)/2147483647;
 for(let i=0;i<500;i++){const a=random(),b=random(),c=random(),sum=a+b+c;assert.equal(tenths({answered_by_record:a/sum,ask_patient:b/sum,ask_coordinator:c/sum}).reduce((n,v)=>n+v,0),1000)}
});

test('Copy JSON copies exactly the displayed body and reports the outcome',async()=>{
 const h=harness(),m=mount(h);
 try{
  await generate(m);const trace=res(m)!.apiTrace!;
  await act(async()=>{m.ref.vm!.copyTrace('agents');await flush()});assert.equal(h.copies[0],trace.agentsRequest.text);assert.equal(m.ref.vm!.traceCopy?.state,'copied');assert.match(hostText(m),/Copied\./);
  await act(async()=>{m.ref.vm!.copyTrace('decisions');await flush()});assert.equal(h.copies[1],trace.decisionsRequest.text);assert.equal(m.ref.vm!.traceCopy?.key,'decisions');
  await act(async()=>{m.renderer.root.findAllByType('button').find(n=>renderedText(n)==='Copy JSON')!.props.onClick();await flush()});assert.equal(h.copies.length,3);
 }finally{m.unmount()}
});

test('an oversized body is shown cut with a clear note, and the other body stays whole',async()=>{
 const h=harness({cutTrace:true}),m=mount(h);
 try{
  await generate(m);const trace=res(m)!.apiTrace!,shown=new TextEncoder().encode(trace.decisionsRequest.text).length;
  assert.equal(trace.decisionsRequest.truncated,true);assert.ok(shown<trace.decisionsRequest.bytes);
  const text=hostText(m);assert.ok(text.includes(`truncated for display (${shown} of ${trace.decisionsRequest.bytes} bytes)`));
  assert.equal((text.match(/truncated for display/g)??[]).length,1);assert.ok(text.includes('Copy the part shown'));
  assert.equal(m.ref.vm!.agentCode,undefined,'a cut display copy never fails the run');assert.equal(res(m)?.decisionStatus,'complete');
 }finally{m.unmount()}
});

test('test runs say nothing was sent to OpenAI; live runs say the bodies were sent',async()=>{
 const test1=harness(),a=mount(test1);
 try{await generate(a);const text=hostText(a);assert.match(text,/Test run\./);assert.match(text,/nothing below was sent to OpenAI/);assert.match(text,/test adapter, not a live API call/);assert.match(text,/the request bodies the helper built for a mocked adapter/)}finally{a.unmount()}
 const live=harness({live:true}),b=mount(live);
 try{await generate(b);const text=hostText(b);assert.doesNotMatch(text,/Test run\.|test adapter/);assert.match(text,/the request bodies the helper sent to OpenAI/);assert.match(text,/Request headers and credentials are not included/)}finally{b.unmount()}
});

test('a result from an older helper without request details explains the reinstall and keeps the route list',async()=>{
 const h=harness({noTrace:true}),m=mount(h);
 try{
  await generate(m);const text=hostText(m);
  assert.equal(res(m)?.apiTrace,undefined);assert.match(text,/reinstall it to see them/);assert.ok(!text.includes('Agents API request body'));assert.equal(nodesWith(m,'trace-json').length,0);
  assert.match(text,/Decisions output/);assert.match(text,/Ask the study team/);
  await act(async()=>{m.ref.vm!.copyTrace('agents');await flush()});assert.equal(h.copies.length,0,'nothing to copy without a trace');
 }finally{m.unmount()}
});

test('request details stay in memory only: ending, reselecting studies or a new run clears them, and no header or key text exists',async()=>{
 const h=harness(),m=mount(h);
 try{
  await generate(m);assert.ok(hostText(m).includes('Agents API request body'));
  const everything=JSON.stringify([res(m),h.ports[0].sent,hostText(m)]);
  assert.doesNotMatch(everything,/Authorization|Bearer|OpenAI-Beta|Content-Type|sk-[A-Za-z0-9_-]{10,}/);
  await act(async()=>{m.ref.vm!.selectStudies(IDS);await flush()});assert.equal(res(m),undefined);assert.ok(!hostText(m).includes('Agents API request body'));
  await generate2(m);assert.ok(res(m)?.apiTrace);
  await act(async()=>{m.ref.vm!.end();await flush()});assert.equal(res(m),undefined);assert.equal(m.ref.vm!.traceCopy,undefined);
  const after=hostText(m);assert.ok(!after.includes('get_public_selected_study')&&!after.includes('Agents API request body'));
 }finally{m.unmount()}
});
async function generate2(m:ReturnType<typeof mount>){await act(async()=>{m.ref.vm!.requestReview();await flush()})}
