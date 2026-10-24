import test from'node:test';import assert from'node:assert/strict';import React from'react';import{renderToStaticMarkup}from'react-dom/server';import TestRenderer,{act}from'react-test-renderer';
import{ApplyView}from'../src/apply-view';import{useApply,type ApplyController,type ApplyEnv}from'../src/use-apply';import{PageMatchingLease}from'../src/site-matching-lease';
import{SESSION_TTL_MS,SESSION_COUNTDOWN_MS,SESSION_KEEP_WORKING_MS,ACTIVITY_RENEW_MS,formatCountdown}from'../src/session-lease';
import{rawStudy}from'./apply-fixture';import{normalizeApplyRecord,normalizeStudyBrief,studyPurposeText}from'../shared/apply-record.mjs';
const NOW=Date.UTC(2026,9,24,15),ID='NCT07254806',raw=rawStudy(),rec=normalizeApplyRecord(raw,NOW),brief=normalizeStudyBrief(raw,NOW),TOKEN='t'.repeat(43),DIGEST='a'.repeat(64);
const flush=async()=>{for(let i=0;i<20;i++)await new Promise<void>(r=>queueMicrotask(r))};
class Events{listeners:((v:any)=>void)[]=[];addListener=(f:(v:any)=>void)=>this.listeners.push(f);emit=(v?:any)=>this.listeners.forEach(f=>f(v))}
/** A fake extension port whose background grants a fresh 30 minutes on each applyRenew. A study-brief execute request is never answered, so a run stays pending. */
function harness(t:any,receipt:'five minutes'|'already expired'='five minutes'){
 t.mock.timers.enable({apis:['setTimeout']});
 let clock=NOW;const ports:any[]=[];
 const prepared=()=>({kind:'preparedStudyBrief',token:TOKEN,digest:DIGEST,expiresAt:receipt==='five minutes'?clock+5*60*1000:clock-1000,records:[normalizeApplyRecord(raw,NOW,16000)],briefs:[brief]});
 const runtime={connect:()=>{const p:any={sent:[] as any[],closed:false,onMessage:new Events(),onDisconnect:new Events(),
  postMessage(v:any){p.sent.push(structuredClone(v));
   if(v.kind==='studyBriefRecord')p.reply({id:v.id,type:'briefRecords',ok:true,records:[rec],briefs:[brief],purposes:[studyPurposeText(raw)]});
   else if(v.kind==='applyRenew')queueMicrotask(()=>p.onMessage.emit({kind:'applyRenewed',expiresAt:clock+SESSION_TTL_MS}));
   else if(v.request?.type==='prepareStudyBrief')p.reply({id:v.request.id,type:'result',ok:true,result:prepared()})},
  reply(reply:any){queueMicrotask(()=>p.onMessage.emit({reply}))},disconnect(){p.closed=true}};
  queueMicrotask(()=>p.onMessage.emit({kind:'applyReady',nctId:ID,nctIds:[ID],expiresAt:clock+SESSION_TTL_MS,studies:[{nctId:ID,title:rec.title}]}));ports.push(p);return p}};
 const env:ApplyEnv={runtime,loadZips:async()=>({zips:{}}) as any,userActivated:()=>true,today:()=>new Date(NOW),now:()=>clock,copyText:async()=>{},download(){},openMailto(){}};
 /** Moves the injected clock and the fake timers forward together. */
 const advance=async(ms:number)=>{clock+=ms;await act(async()=>{t.mock.timers.tick(ms);await flush()})};
 const renews=()=>ports[0].sent.filter((v:any)=>v.kind==='applyRenew');
 return{env,ports,advance,renews,now:()=>clock};
}
function mount(h:ReturnType<typeof harness>){const ref:{vm?:ApplyController}={};function Probe(){const vm=useApply(ID,h.env);ref.vm=vm;return React.createElement(ApplyView,{vm})}let renderer!:TestRenderer.ReactTestRenderer;act(()=>{renderer=TestRenderer.create(React.createElement(Probe))});return{vm:()=>ref.vm!,renderer,unmount:()=>act(()=>renderer.unmount())}}
const html=(vm:ApplyController)=>renderToStaticMarkup(React.createElement(ApplyView,{vm}));
const textOf=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(textOf).join(''):node?.children?textOf(node.children):'';
function withDocument(body:(doc:any)=>Promise<void>){return async()=>{const doc:any=new EventTarget(),old=Object.getOwnPropertyDescriptor(globalThis,'document');doc.visibilityState='visible';Object.defineProperty(globalThis,'document',{configurable:true,value:doc});try{await body(doc)}finally{if(old)Object.defineProperty(globalThis,'document',old);else delete (globalThis as any).document}}}

test('the session lasts 30 minutes; no countdown before the last five minutes, then a quiet m:ss countdown without Keep working',async t=>{
 assert.equal(SESSION_TTL_MS,30*60*1000);assert.equal(SESSION_COUNTDOWN_MS,5*60*1000);assert.equal(SESSION_KEEP_WORKING_MS,60*1000);
 const h=harness(t),m=mount(h);try{await act(flush);assert.equal(m.vm().phase,'ready');assert.equal(m.vm().expiresAt,NOW+SESSION_TTL_MS);
  assert.equal(m.vm().countdown,undefined);assert.doesNotMatch(html(m.vm()),/Session ends in|Keep working|role="timer"/);
  await h.advance(SESSION_TTL_MS-SESSION_COUNTDOWN_MS-1000);assert.equal(m.vm().countdown,undefined,'five minutes and one second left');assert.doesNotMatch(html(m.vm()),/Session ends in/);
  await h.advance(1000);assert.deepEqual(m.vm().countdown,{secondsLeft:300,keepWorking:false},'the last five minutes begin');
  assert.match(html(m.vm()),/Session ends in <strong role="timer" aria-live="off">5:00<\/strong>/);assert.doesNotMatch(html(m.vm()),/Keep working/);
  await h.advance(1000);assert.equal(m.vm().countdown?.secondsLeft,299);assert.match(html(m.vm()),/4:59/);
  assert.match(html(m.vm()),/<p role="status"[^>]*><\/p>/,'the status line is already in place, empty, before the warning');
  assert.equal(h.renews().length,0,'a countdown on its own never renews the session');
 }finally{m.unmount()}});

test('Keep working appears for the last minute, is announced in the status line, and renews the session',async t=>{
 const h=harness(t),m=mount(h);try{await act(flush);
  await h.advance(SESSION_TTL_MS-SESSION_KEEP_WORKING_MS-1000);assert.equal(m.vm().countdown?.keepWorking,false,'61 seconds left');assert.doesNotMatch(html(m.vm()),/Keep working/);
  await act(async()=>{m.vm().edit('name','EXPIRY_CANARY');m.vm().editDraft('body','EXPIRING_DRAFT')});
  await h.advance(1000);assert.deepEqual(m.vm().countdown,{secondsLeft:60,keepWorking:true});
  const markup=html(m.vm());assert.match(markup,/<p role="status"[^>]*>Your session ends in about a minute\. Choose Keep working to keep your drafts and details\.<\/p>/);assert.match(markup,/<button[^>]*>Keep working<\/button>/);
  const button=m.renderer.root.findAllByType('button').find(b=>textOf(b.children)==='Keep working')!;
  await act(async()=>{button.props.onClick();await flush()});
  assert.deepEqual(h.renews(),[{kind:'applyRenew'}],'one bare renewal message');assert.equal(m.vm().expiresAt,h.now()+SESSION_TTL_MS);assert.equal(m.vm().countdown,undefined);assert.equal(m.vm().sessionExtended,true);
  assert.match(html(m.vm()),/<p role="status"[^>]*>Session extended by 30 minutes\.<\/p>/);assert.doesNotMatch(html(m.vm()),/Keep working|Session ends in/);
  await h.advance(61000);assert.equal(m.vm().phase,'ready','the old deadline passed and the session carried on');assert.equal(m.vm().patient.name,'EXPIRY_CANARY');assert.equal(m.vm().draft?.body,'EXPIRING_DRAFT');
  await h.advance(SESSION_TTL_MS-61000-1);assert.equal(m.vm().phase,'ready','one millisecond before the renewed deadline');
  await h.advance(1);assert.equal(m.vm().phase,'ended','expiry at the renewed deadline');assert.equal(m.vm().patient.name,'');assert.equal(m.vm().draft,undefined);assert.equal(m.vm().records.length,0);assert.equal(m.vm().countdown,undefined);assert.match(html(m.vm()),/Session ended/);
 }finally{m.unmount()}});

test('expiry without renewal clears drafts, scripts and follow-ups',async t=>{
 const h=harness(t),m=mount(h);try{await act(flush);
  await act(async()=>{m.vm().edit('name','CLEARED_NAME');m.vm().editDraft('body','CLEARED_DRAFT');m.vm().editCallScript('CLEARED_SCRIPT');m.vm().editFollowUp('CLEARED_FOLLOW_UP')});
  assert.equal(m.vm().callScript,'CLEARED_SCRIPT');assert.equal(m.vm().followUpMessage,'CLEARED_FOLLOW_UP');
  await h.advance(SESSION_TTL_MS);assert.equal(m.vm().phase,'ended');assert.equal(m.vm().draft,undefined);assert.equal(m.vm().patient.name,'');assert.doesNotMatch(m.vm().callScript,/CLEARED_SCRIPT/);assert.doesNotMatch(m.vm().followUpMessage,/CLEARED_FOLLOW_UP/);assert.equal(m.vm().callScriptEdited,false);assert.equal(m.vm().followUpEdited,false);
 }finally{m.unmount()}});

test('typing and clicking renew the study session at most once per interval, carry nothing typed, and stop after unmount',async t=>{
 await withDocument(async doc=>{
  const h=harness(t),m=mount(h);await act(flush);
  const fire=async(types:string[],times:number)=>act(async()=>{for(let i=0;i<times;i++)for(const type of types)doc.dispatchEvent(new Event(type));await flush()});
  await act(async()=>m.vm().edit('name','PRIVATE_TYPING_CANARY'));
  await fire(['keydown','input','pointerdown'],50);assert.equal(h.renews().length,0,'the session was just renewed when it opened, so a burst of typing sends nothing');
  await h.advance(ACTIVITY_RENEW_MS-1);await fire(['keydown'],5);assert.equal(h.renews().length,0,'still inside the interval');
  await h.advance(1);await fire(['keydown','input','pointerdown'],40);assert.equal(h.renews().length,1,'a burst after the interval sends one message');assert.equal(m.vm().expiresAt,h.now()+SESSION_TTL_MS,'the granted deadline is adopted');
  await h.advance(ACTIVITY_RENEW_MS);await fire(['pointerdown'],3);assert.equal(h.renews().length,2,'one more after the next interval');
  assert.deepEqual(h.renews(),[{kind:'applyRenew'},{kind:'applyRenew'}]);assert.doesNotMatch(JSON.stringify(h.ports[0].sent),/PRIVATE_TYPING_CANARY/);
  await act(async()=>{doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));await flush()});await h.advance(60*1000);assert.equal(m.vm().phase,'ready','hiding the tab does not end the study session');
  await act(async()=>{doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));await flush()});assert.equal(m.vm().phase,'ready');assert.equal(m.vm().patient.name,'PRIVATE_TYPING_CANARY');
  const before=h.renews().length;m.unmount();await h.advance(ACTIVITY_RENEW_MS*2);doc.dispatchEvent(new Event('keydown'));await flush();assert.equal(h.renews().length,before,'the listeners are removed with the component');
 })();
});

test('activity after the session ended renews nothing, and a countdown shown while idle disappears once the person types',async t=>{
 await withDocument(async doc=>{
  const h=harness(t),m=mount(h);try{await act(flush);
   await h.advance(SESSION_TTL_MS-SESSION_COUNTDOWN_MS);assert.equal(m.vm().countdown?.secondsLeft,300);
   await act(async()=>{doc.dispatchEvent(new Event('keydown'));await flush()});assert.equal(h.renews().length,1);assert.equal(m.vm().countdown,undefined,'typing slid the deadline out of the last five minutes');assert.doesNotMatch(html(m.vm()),/Session ends in/);
   await h.advance(SESSION_TTL_MS);assert.equal(m.vm().phase,'ended');
   await h.advance(ACTIVITY_RENEW_MS*2);await act(async()=>{doc.dispatchEvent(new Event('keydown'));await flush()});assert.equal(h.renews().length,1,'an ended session cannot be renewed');
  }finally{m.unmount()}
 })();
});

test('a prepared OpenAI request keeps its own five-minute receipt and does not shorten the session',async t=>{
 const h=harness(t),m=mount(h);try{await act(flush);
  await act(async()=>{m.vm().requestReview();await flush()});
  assert.ok(h.ports[0].sent.some((v:any)=>v.request?.type==='prepareStudyBrief'));assert.ok(h.ports[0].sent.some((v:any)=>v.request?.type==='executeStudyBrief'),'the run started with its receipt');
  assert.equal(m.vm().expiresAt,NOW+SESSION_TTL_MS,'the session deadline is not replaced by the receipt deadline');
  await h.advance(5*60*1000+1000);assert.equal(m.vm().phase,'ready','the receipt expiring does not end the session');assert.equal(m.vm().countdown,undefined);
 }finally{m.unmount()}});

test('a receipt that is already expired when it arrives is reported as expired, is never executed, and leaves the session open',async t=>{
 const h=harness(t,'already expired'),m=mount(h);try{await act(flush);
  await act(async()=>{m.vm().editDraft('body','KEPT_DRAFT');m.vm().requestReview();await flush()});
  assert.equal(m.vm().agentCode,'APPLY_EXPIRED');assert.equal(m.vm().phase,'ready');assert.equal(m.vm().draft?.body,'KEPT_DRAFT');assert.equal(m.vm().agentBusy,false);
  assert.ok(!h.ports[0].sent.some((v:any)=>v.request?.type==='executeStudyBrief'));
 }finally{m.unmount()}});

test('PageMatchingLease.extend slides the deadline but never shortens it, passes its bound, or revives a lease that stopped',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});let now=1000,cleared=0;
 const lease=new PageMatchingLease(async()=>true,()=>{cleared++},()=>now,SESSION_TTL_MS);
 lease.start('g',now+60000);
 assert.equal(lease.extend(now+SESSION_TTL_MS),true);assert.equal(lease.extend(now+120000),false,'a shorter deadline is ignored');assert.equal(lease.extend(now+SESSION_TTL_MS+2000),false,'beyond the lease bound is refused');
 now+=SESSION_TTL_MS-1;t.mock.timers.tick(SESSION_TTL_MS-1);assert.equal(cleared,0,'the original 60-second deadline no longer applies');
 now+=1;t.mock.timers.tick(1);assert.equal(cleared,1,'expiry at the slid deadline');assert.equal(lease.extend(now+SESSION_TTL_MS),false,'a stopped lease stays stopped');
 const page=new PageMatchingLease(async()=>true,()=>{},()=>now);assert.throws(()=>page.start('g',now+SESSION_TTL_MS),/Invalid page matching lease/,'the page matching lease keeps its five-minute bound');page.start('g',now+5*60*1000);page.stop(false);
});

test('countdown text is minutes and seconds',()=>{assert.equal(formatCountdown(300),'5:00');assert.equal(formatCountdown(61),'1:01');assert.equal(formatCountdown(59.2),'1:00');assert.equal(formatCountdown(9),'0:09');assert.equal(formatCountdown(-5),'0:00')});
