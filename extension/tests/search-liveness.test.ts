import test from'node:test';import assert from'node:assert/strict';import React from'react';import TestRenderer,{act}from'react-test-renderer';import{useSiteController,SEARCH_SESSION_TTL_MS}from'../src/use-site-controller';import{captureSiteActivations}from'../src/overlay-port';import{OverlayView}from'../src/overlay-view';import{PrivateMatchingView}from'../src/private-match-view';import{SITE_FILTERS}from'../src/site-filter-catalog';
class E{l:((...v:any[])=>void)[]=[];addListener=(f:(...v:any[])=>void)=>this.l.push(f);emit=(...v:any[])=>this.l.forEach(f=>f(...v))}
const flush=async()=>{for(let i=0;i<5;i++)await new Promise<void>(r=>queueMicrotask(r))};
const STEP=10000;
/** Mounts the real overlay hook against a fake worker port that drops its connection after 30 idle seconds, as an idle MV3 worker does. */
async function setup(t:any){
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval']});
 const sent:any[]=[],parent={postMessage(){}},win:any=new EventTarget(),doc:any=new EventTarget(),onMessage=new E(),onDisconnect=new E();win.parent=parent;doc.visibilityState='visible';
 const state={closed:false};let idle:ReturnType<typeof setTimeout>|undefined;
 const port:any={onMessage,onDisconnect,postMessage(v:any){sent.push(v);clearTimeout(idle);idle=setTimeout(()=>{state.closed=true;onDisconnect.emit()},30000);if(v.type==='site.authenticate')onMessage.emit({type:'site.ready',snapshot:{generation:'document-1',url:'https://clinicaltrials.gov/search',nctIds:[],diagnostic:'No cards yet',supported:false},filters:SITE_FILTERS,search:{}});else onMessage.emit({id:v.id,ok:true,result:{active:true}})},disconnect(){state.closed=true;clearTimeout(idle)}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:win});Object.defineProperty(globalThis,'document',{configurable:true,value:doc});Object.defineProperty(globalThis,'chrome',{configurable:true,value:{runtime:{connect:(v:any)=>{assert.equal(v.name,'treatable.site.overlay.v1');return port}}}});captureSiteActivations(win);
 const ref:{vm?:any}={};let renderer:any;function Probe(){ref.vm=useSiteController();return null}
 await act(async()=>{renderer=TestRenderer.create(React.createElement(Probe));const event=new Event('message');Object.assign(event,{source:parent,origin:'https://clinicaltrials.gov',data:{type:'treatable.site.activate',purpose:'overlay',capability:'a'.repeat(64)}});win.dispatchEvent(event);await flush()});
 assert.equal(ref.vm.connected,true);
 const advance=async(ms:number)=>{for(let spent=0;spent<ms;spent+=STEP)await act(async()=>{t.mock.timers.tick(Math.min(STEP,ms-spent));await flush()})};
 const pings=()=>sent.filter(v=>v.type==='site.ping');
 return{ref,sent,doc,win,state,advance,pings,unmount:()=>act(()=>renderer.unmount())};
}
const press=(doc:any,type='keydown')=>doc.dispatchEvent(new Event(type));
test('the search session lasts 30 minutes, survives simulated MV3 idle while typing, and then clears',async(t)=>{
 assert.equal(SEARCH_SESSION_TTL_MS,30*60*1000);
 const s=await setup(t);act(()=>s.ref.vm.setField('cond','PRIVATE_SEARCH_CANARY'));
 await s.advance(4*STEP);assert.equal(s.state.closed,false);assert.equal(s.ref.vm.fields.cond,'PRIVATE_SEARCH_CANARY');
 assert.equal(s.pings().length,4);assert.ok(s.pings().every(v=>JSON.stringify(v.payload)==='{"generation":"document-1"}'));assert.doesNotMatch(JSON.stringify(s.pings()),/PRIVATE_SEARCH_CANARY|cond|profile|age|token|score/);
 await s.advance(SEARCH_SESSION_TTL_MS-4*STEP-STEP);assert.equal(s.ref.vm.connected,true,'still inside the 30 minutes');
 await s.advance(STEP);assert.equal(s.ref.vm.connected,false);assert.equal(s.ref.vm.ended,true);assert.deepEqual(s.ref.vm.fields,{});assert.equal(s.state.closed,true);
 const count=s.sent.length;await s.advance(4*STEP);assert.equal(s.sent.length,count,'heartbeat stops after expiry');s.unmount();
});
test('typing and clicking slide the search deadline forward; idle time after the last activity still ends it',async(t)=>{
 const s=await setup(t);
 await s.advance(29*60*1000);press(s.doc,'keydown');
 await s.advance(10*60*1000);assert.equal(s.ref.vm.connected,true,'39 minutes after connecting is past the original deadline but inside the renewed one');
 press(s.doc,'pointerdown');await s.advance(29*60*1000);assert.equal(s.ref.vm.connected,true,'a click renews from that moment');
 await s.advance(60*1000);assert.equal(s.ref.vm.connected,false,'30 idle minutes after the last click ends it');assert.equal(s.state.closed,true);s.unmount();
});
test('a hidden tab does not end the session: heartbeats continue, expiry still applies, and coming back resumes at once',async(t)=>{
 const s=await setup(t);act(()=>s.ref.vm.setField('cond','KEEP_WHILE_HIDDEN'));
 await s.advance(2*STEP);const before=s.pings().length;
 await act(async()=>{s.doc.visibilityState='hidden';s.doc.dispatchEvent(new Event('visibilitychange'));await flush()});
 assert.equal(s.ref.vm.connected,true,'hiding is not an end event');
 await s.advance(5*60*1000);assert.equal(s.ref.vm.connected,true);assert.equal(s.state.closed,false,'heartbeats keep the worker connection alive while hidden');assert.ok(s.pings().length>before+20);assert.equal(s.ref.vm.fields.cond,'KEEP_WHILE_HIDDEN');
 const hiddenPings=s.pings().length;
 await act(async()=>{s.doc.visibilityState='visible';s.doc.dispatchEvent(new Event('visibilitychange'));await flush()});
 assert.equal(s.pings().length,hiddenPings+1,'returning checks the page again immediately');assert.equal(s.ref.vm.connected,true);assert.equal(s.ref.vm.fields.cond,'KEEP_WHILE_HIDDEN');
 await act(async()=>{s.doc.visibilityState='hidden';s.doc.dispatchEvent(new Event('visibilitychange'));await flush()});
 await s.advance(SEARCH_SESSION_TTL_MS);assert.equal(s.ref.vm.connected,false,'a tab that stays hidden still ends at the 30-minute deadline');assert.deepEqual(s.ref.vm.fields,{});assert.equal(s.state.closed,true);s.unmount();
});
test('pagehide ends the search session immediately, even with time left',async(t)=>{
 const s=await setup(t);act(()=>s.ref.vm.setField('cond','CLEARED_ON_PAGEHIDE'));
 await act(async()=>{s.win.dispatchEvent(new Event('pagehide'));await flush()});
 assert.equal(s.ref.vm.connected,false);assert.equal(s.ref.vm.ended,true);assert.deepEqual(s.ref.vm.fields,{});assert.equal(s.state.closed,true);
 const count=s.sent.length;press(s.doc);await s.advance(3*STEP);assert.equal(s.sent.length,count);s.unmount();
});
