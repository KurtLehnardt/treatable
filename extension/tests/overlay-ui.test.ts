import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import TestRenderer,{act,type ReactTestRenderer} from 'react-test-renderer';
import {readFileSync} from 'node:fs';
import {OverlayView} from '../src/overlay-view';
import {PrivateMatchingView} from '../src/private-match-view';
import {ScoreBadge} from '../src/score-badge-view';
import {SiteClient,readActivation,captureSiteActivations,subscribeSiteActivation} from '../src/overlay-port';
import {useSiteController} from '../src/use-site-controller';
import type {OverlayViewModel} from '../src/overlay-types';
const snapshot={generation:'page-1',url:'https://clinicaltrials.gov/search?cond=Fibromyalgia',nctIds:['NCT00000001','NCT00000002'],diagnostic:'Two result cards found.',supported:true};
const cap='a'.repeat(43);
const initialWindow=new EventTarget() as any;initialWindow.parent={postMessage(){}};Object.defineProperty(globalThis,'window',{configurable:true,value:initialWindow});
class FakePort {messages:any[]=[];closed=false;listeners:Array<(m:any)=>void>=[];ends:Array<()=>void>=[];held?:any;holdFetch=false;onMessage={addListener:(f:(m:any)=>void)=>this.listeners.push(f)};onDisconnect={addListener:(f:()=>void)=>this.ends.push(f)};emit(v:any){for(const f of this.listeners)f(v)}postMessage(v:any){this.messages.push(structuredClone(v));if(v.type==='site.authenticate'){queueMicrotask(()=>this.emit({type:'site.ready',snapshot}));return}if(v.type==='site.fetch'&&this.holdFetch){this.held=v;return}queueMicrotask(()=>this.emit({id:v.id,ok:true,result:v.type==='site.snapshot'?snapshot:{}}))}disconnect(){if(this.closed)return;this.closed=true;for(const f of this.ends)f()}}
class FakeRuntime {ports:FakePort[]=[];names:string[]=[];connect({name}:{name:string}){const port=new FakePort();this.ports.push(port);this.names.push(name);return port}}
function eventFor(parent:any,origin='https://clinicaltrials.gov',data:any={type:'treatable.site.activate',purpose:'overlay',capability:cap}){const event=new Event('message');Object.defineProperties(event,{source:{value:parent},origin:{value:origin},data:{value:data}});return event as MessageEvent}
function view(overrides:Partial<OverlayViewModel>={}):OverlayViewModel{return{connected:true,ended:false,busy:false,error:'',snapshot,records:[],opacity:.9,collapsed:false,refresh(){},fetchRecords(){},setOpacity(){},setCollapsed(){},restore(){},openPrivate(){},close(){},...overrides}}
test('overlay renders no search form: no replica of the website search, but the private matching action and a truthful scope',()=>{
 const html=renderToStaticMarkup(React.createElement(OverlayView,{vm:view()}));
 for(const label of ['Find my matches','Only the visible cards loaded'])assert.ok(html.includes(label),label);
 for(const gone of ['Condition/disease','Other terms','Intervention/treatment','Location','More filters','Which studies to show','Search ClinicalTrials.gov','Search the live registry','Find studies for you','shared with ClinicalTrials.gov','No OpenAI request is made by this search','five minutes'])assert.ok(!html.includes(gone),gone);
 assert.doesNotMatch(html,/<form|<input|<select|<textarea|<details|Free-text notes|Remember|API demo|Preview the fictional/);
});
test('the search help button is the only search control: it appears when the guide offers it and runs the guide',()=>{
 let started=0;const guide:any={canSearchHelp:true,startSearchHelp:()=>started++,active:false};
 const renderer=TestRenderer.create(React.createElement(OverlayView,{vm:view({guide})}));
 const button=renderer.root.findAllByType('button').find(node=>node.children.includes('Show me how to search'))!;
 assert.equal(button.props['data-treatable-guide'],'search-help');button.props.onClick();assert.equal(started,1);renderer.unmount();
 const hidden=renderToStaticMarkup(React.createElement(OverlayView,{vm:view({guide:{...guide,canSearchHelp:false}})}));
 assert.doesNotMatch(hidden,/Show me how to search/);
 assert.doesNotMatch(renderToStaticMarkup(React.createElement(OverlayView,{vm:view()})),/Show me how to search/,'no guide, no button');
});
test('overlay defaults to the popup display and exposes session display settings',()=>{
 let privateOpen=0,collapsed:any,mode:any,theme:any;
 const vm=view({openPrivate:()=>privateOpen++,setCollapsed:value=>collapsed=value,setDisplayMode:value=>mode=value,setTheme:value=>theme=value});
 const renderer=TestRenderer.create(React.createElement(OverlayView,{vm}));
 renderer.root.findAllByType('button').find(button=>button.children.includes('Find my matches'))!.props.onClick();assert.equal(privateOpen,1);
 renderer.root.findByProps({'aria-label':'Collapse search assistant'}).props.onClick();assert.equal(collapsed,true);
 assert.equal(renderer.root.findByType('main').props['data-display-mode'],'popup','Popup is the default display mode');assert.equal(renderer.root.findByType('main').props['aria-modal'],true);
 act(()=>renderer.root.findByProps({'aria-label':'Treatable settings'}).props.onClick());
 const selects=renderer.root.findByProps({'aria-label':'Treatable display settings'}).findAllByType('select');
 act(()=>selects[0].props.onChange({target:{value:'sidebar'}}));act(()=>selects[1].props.onChange({target:{value:'dark'}}));
 assert.equal(mode,'sidebar');assert.equal(theme,'dark');assert.equal(renderer.root.findAllByProps({'aria-label':'Overlay background opacity'}).length,0);
 renderer.unmount();const css=readFileSync(new URL('../src/overlay.css',import.meta.url),'utf8');assert.match(css,/prefers-reduced-motion/);assert.doesNotMatch(css,/transition:\s*all|https?:\/\//);assert.match(css,/min-height:44px/);assert.doesNotMatch(css,/opacity-control|data-background-opacity|backdrop/);
});
test('the display choices are Popup and Sidebar only, and the sidebar is no modal dialog',()=>{
 const renderer=TestRenderer.create(React.createElement(OverlayView,{vm:view()}));
 act(()=>renderer.root.findByProps({'aria-label':'Treatable settings'}).props.onClick());
 const display=renderer.root.findByProps({'aria-label':'Treatable display settings'}).findAllByType('select')[0];
 assert.deepEqual(display.findAllByType('option').map(option=>option.props.value),['popup','sidebar'],'the retired corner card is not offered');
 assert.doesNotMatch(JSON.stringify(renderer.toJSON()),/Overlay keeps|>Overlay</);renderer.unmount();
 const sidebar=TestRenderer.create(React.createElement(OverlayView,{vm:view({displayMode:'sidebar'})}));
 const main=sidebar.root.findByType('main');assert.equal(main.props['data-display-mode'],'sidebar');assert.equal(main.props['aria-modal'],undefined);assert.equal(main.props.role,undefined);sidebar.unmount();
});
test('opaque iframe activation rejects page commands, wrong origin/source and extra medical fields',()=>{const parent={}as Window;assert.ok(readActivation(eventFor(parent),parent,'overlay'));assert.equal(readActivation(eventFor({},'https://clinicaltrials.gov'),parent,'overlay'),undefined);assert.equal(readActivation(eventFor(parent,'https://clinicaltrials.gov.evil.example'),parent,'overlay'),undefined);assert.equal(readActivation(eventFor(parent,'http://clinicaltrials.gov'),parent,'overlay'),undefined);assert.equal(readActivation(eventFor(parent,'https://clinicaltrials.gov',{type:'treatable.site.activate',purpose:'overlay',capability:cap,profile:'PRIVATE'}),parent,'overlay'),undefined)});
test('module-level activation capture preserves parent load handshake before React effect subscription',async()=>{const target=new EventTarget()as any;target.parent={};captureSiteActivations(target);target.dispatchEvent(eventFor(target.parent));let received=0;const off=subscribeSiteActivation(target,'overlay',()=>received++);await new Promise<void>(resolve=>queueMicrotask(()=>resolve()));assert.equal(received,1);off();target.dispatchEvent(eventFor(target.parent,'https://evil.example'));let forged=0;const stop=subscribeSiteActivation(target,'overlay',()=>forged++);await new Promise<void>(resolve=>queueMicrotask(()=>resolve()));assert.equal(forged,0);stop()});
test('site port carries only explicit query commands and rejects stale/foreign snapshots',async()=>{const runtime=new FakeRuntime(),client=new SiteClient(runtime);let snapshots=0;client.onEvent(v=>{if(v.type==='site.snapshot')snapshots++});await client.authenticate(cap);assert.deepEqual(runtime.names,['treatable.site.overlay.v1']);await client.request('site.fetch',{nctIds:['NCT00000001']});assert.equal(runtime.ports[0].messages[1].type,'site.fetch');assert.deepEqual(runtime.ports[0].messages[1].payload,{nctIds:['NCT00000001']});runtime.ports[0].emit({type:'site.snapshot',snapshot:{...snapshot,url:'https://unrelated.example/search'}});assert.equal(snapshots,0);client.disconnect();await assert.rejects(()=>client.request('site.snapshot',{}));assert.ok(runtime.ports[0].closed)});
test('score presentation shows the match percent only inside its private frame, with no per-card disclaimer or unknown label text',()=>{const html=renderToStaticMarkup(React.createElement(ScoreBadge,{score:82,label:'Review requirements'}));assert.match(html,/82%/);assert.match(html,/match/);assert.doesNotMatch(html,/Review requirements/,'only fixed reason ids are shown');assert.doesNotMatch(html,/eligib|enrollment probability|Normalized relevance/i);const mismatch=renderToStaticMarkup(React.createElement(ScoreBadge,{score:4,label:'outside_age_range'}));assert.match(mismatch,/4% match\. Outside the listed age range/);assert.match(mismatch,/data-tone="low"/);const missing=renderToStaticMarkup(React.createElement(ScoreBadge,{score:Infinity,label:'not_scored'}));assert.match(missing,/Not scored/);assert.doesNotMatch(missing,/Infinity/);const document=readFileSync(new URL('../public/score-badge.html',import.meta.url),'utf8');assert.doesNotMatch(document,/82|score=|Relevance/)});
let vm:OverlayViewModel;
function Probe(){vm=useSiteController();return React.createElement(OverlayView,{vm})}
async function mount(){const parent={postMessage(){}},windowEvents=new EventTarget()as any;windowEvents.parent=parent;const documentEvents=new EventTarget()as any;documentEvents.visibilityState='visible';const runtime=new FakeRuntime();Object.defineProperty(globalThis,'window',{configurable:true,value:windowEvents});Object.defineProperty(globalThis,'document',{configurable:true,value:documentEvents});Object.defineProperty(globalThis,'chrome',{configurable:true,value:{runtime}});captureSiteActivations(windowEvents);let renderer!:ReactTestRenderer;await act(async()=>{renderer=TestRenderer.create(React.createElement(Probe),{createNodeMock:()=>({focus(){}})});windowEvents.dispatchEvent(eventFor(parent))});return{runtime,renderer,windowEvents,documentEvents}}
test('actual overlay hook sends nothing beyond authentication on its own and ends on close and pagehide',async()=>{for(const reason of ['close','pagehide']){const {renderer,runtime,windowEvents}=await mount();assert.equal(vm.connected,true);assert.equal(runtime.ports[0].messages.length,1);assert.equal(runtime.ports[0].messages[0].type,'site.authenticate');assert.ok(!('setField' in vm)&&!('search' in vm)&&!('fields' in vm),'the controller has no search form state or search action');await act(async()=>{if(reason==='close')vm.close();else windowEvents.dispatchEvent(new Event('pagehide'))});assert.equal(vm.connected,false);assert.equal(vm.ended,true);assert.ok(runtime.ports[0].closed);act(()=>renderer.unmount())}});
test('hiding the tab does not end the overlay session ; only close, pagehide or expiry do',async()=>{const {renderer,runtime,documentEvents}=await mount();assert.equal(vm.connected,true);const port=runtime.ports[0],post=port.postMessage.bind(port);port.postMessage=(v:any)=>{if(v.type==='site.ping'){port.messages.push(structuredClone(v));queueMicrotask(()=>port.emit({id:v.id,ok:true,result:{active:true}}));return}post(v)};await act(async()=>{documentEvents.visibilityState='hidden';documentEvents.dispatchEvent(new Event('visibilitychange'))});assert.equal(vm.connected,true);assert.equal(vm.ended,false);assert.equal(port.closed,false);await act(async()=>{documentEvents.visibilityState='visible';documentEvents.dispatchEvent(new Event('visibilitychange'))});assert.ok(port.messages.some((m:any)=>m.type==='site.ping'),'coming back checks the page at once');assert.equal(vm.connected,true);act(()=>renderer.unmount())});
test('late public record response cannot restore a stale query or ended session',async()=>{const {renderer,runtime}=await mount();const port=runtime.ports[0];port.holdFetch=true;act(()=>vm.fetchRecords());assert.ok(port.held);await act(async()=>{port.emit({type:'site.snapshot',snapshot:{...snapshot,generation:'page-2',nctIds:[]}});port.emit({id:port.held.id,ok:true,result:{records:[{id:'NCT00000001',title:'Late',status:'RECRUITING',conditions:[]}]}})});assert.deepEqual(vm.records,[]);assert.equal(vm.snapshot?.generation,'page-2');act(()=>renderer.unmount())});

test('ending during activation rejects immediately and cannot reactivate from a late ready event',async()=>{const port=new FakePort();port.postMessage=v=>{port.messages.push(v)};const client=new SiteClient({connect:()=>port});const opening=client.authenticate(cap);client.disconnect();await assert.rejects(opening,/ended/);port.emit({type:'site.ready',snapshot});await assert.rejects(()=>client.request('site.snapshot',{}));assert.ok(port.closed)});


test('private matching is blocked up front above the page limit and remains available for ten cards',()=>{for(const count of [10,11]){let opened=0;const nctIds=Array.from({length:count},(_,index)=>`NCT${String(index+1).padStart(8,'0')}`);const model=view({snapshot:{...snapshot,nctIds},openPrivate:()=>opened++});const renderer=TestRenderer.create(React.createElement(OverlayView,{vm:model}));const button=renderer.root.findAllByType('button').find(node=>node.children.includes('Find my matches'))!;assert.equal(button.props.disabled,count>10);button.props.onClick();assert.equal(opened,count>10?0:1);const html=renderToStaticMarkup(React.createElement(OverlayView,{vm:model}));if(count>10)assert.match(html,/set ClinicalTrials.gov to 10 studies per page/);else assert.doesNotMatch(html,/set ClinicalTrials.gov to 10 studies per page/);renderer.unmount()}});


test('the status summary, inline content and a wide selectable diagnostic are visible, and there are no status checkboxes',()=>{
 const model=view({diagnostics:'{"supported":true}',availability:{onlyAccepting:true,includeSoon:false,includeInvitation:false,loading:false,hidden:2,unverified:1,total:5}});
 const renderer=TestRenderer.create(React.createElement(OverlayView,{vm:model,inlineMatching:React.createElement('p',null,'Inline protected form')}));
 const html=renderToStaticMarkup(React.createElement(OverlayView,{vm:model,inlineMatching:React.createElement('p',null,'Inline protected form')}));
 for(const text of ['unverified status remain visible','Inline protected form'])assert.ok(html.includes(text),text);for(const gone of ['Only studies accepting participants','Include opening soon','Include invitation-only studies','Which studies to show'])assert.ok(!html.includes(gone),gone);assert.doesNotMatch(html,/type="checkbox"/);
 const diagnostic=renderer.root.findByProps({'aria-label':'Copyable diagnostic report'});assert.equal(diagnostic.props.readOnly,true);assert.equal(diagnostic.props.rows,12);assert.equal(diagnostic.props.wrap,'soft');
 let selected=false;diagnostic.props.onFocus({currentTarget:{select(){selected=true}}});assert.ok(selected);renderer.unmount();
 const css=readFileSync(new URL('../src/overlay.css',import.meta.url),'utf8');assert.match(css,/diagnostic-report textarea\{[^}]*width:100%[^}]*min-height:14rem[^}]*resize:vertical/);
});

test('System theme follows operating-system changes while explicit Light overrides them',()=>{
 const previous=(globalThis as any).window;const events=new EventTarget();let dark=true;
 const media:any={get matches(){return dark},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)};
 const target:any=new EventTarget();target.matchMedia=()=>media;Object.defineProperty(globalThis,'window',{configurable:true,value:target});
 let renderer!:TestRenderer.ReactTestRenderer;act(()=>{renderer=TestRenderer.create(React.createElement(OverlayView,{vm:view({theme:'system'})}))});
 assert.equal(renderer.root.findByType('main').props['data-theme'],'dark');act(()=>{dark=false;events.dispatchEvent(new Event('change'))});assert.equal(renderer.root.findByType('main').props['data-theme'],'light');
 act(()=>renderer.update(React.createElement(OverlayView,{vm:view({theme:'light'})})));act(()=>{dark=true;events.dispatchEvent(new Event('change'))});assert.equal(renderer.root.findByType('main').props['data-theme'],'light');
 act(()=>renderer.unmount());Object.defineProperty(globalThis,'window',{configurable:true,value:previous});
});


test('inline private fields are not inside any form, so an implicit Enter cannot submit them',()=>{const privateVm:any={ready:false,busy:false,ended:false,total:2,packet:{ageBand:'',conditionIds:[],selectedNctIds:[],agentNctIds:[]},accepted:false,trace:[],used:[],end(){},accept(){},edit(){},prepare(){}};const html=renderToStaticMarkup(React.createElement(OverlayView,{vm:view(),inlineMatching:React.createElement(PrivateMatchingView,{vm:privateVm,inline:true})}));assert.ok(html.includes('private-match is-inline'));assert.equal((html.match(/<form/g)||[]).length,0);assert.doesNotMatch(html,/<form[^>]*action=|name="zip"/)});
test('SiteClient hands the overlay only the generic rejection, whatever text a failed reply carries',async()=>{const runtime=new FakeRuntime(),client=new SiteClient(runtime);await client.authenticate(cap);const port=runtime.ports[0],generic='The site action did not complete. Your local inputs were not sent.';const fail=async(error:unknown)=>{port.postMessage=(v:any)=>{queueMicrotask(()=>port.emit({id:v.id,ok:false,error}))};return client.request('site.snapshot',{}).then(()=>undefined,(e:any)=>e)};for(const other of ['TypeError: INTERNAL_CANARY at /secret','Unsupported website','Offline postal data unavailable',"Enter a 5-digit US ZIP code. For other places, use the website's Location box.",{message:'INTERNAL_CANARY'},undefined]){const e=await fail(other);assert.ok(e instanceof Error);assert.equal(e.name,'Error');assert.equal(e.message,generic)}client.disconnect()});
test('overlay shows only the generic message for any site failure and never the reply text',async()=>{const {renderer,runtime}=await mount();const port=runtime.ports[0];let reply:unknown='x';port.postMessage=(v:any)=>{port.messages.push(structuredClone(v));queueMicrotask(()=>port.emit({id:v.id,ok:false,error:reply}))};const generic='This site action could not complete. Nothing was sent to OpenAI.';for(const internal of ['ZodError: INTERNAL_CANARY at /secret','Unsupported website','Offline postal data unavailable',"Enter a 5-digit US ZIP code. For other places, use the website's Location box."]){reply=internal;await act(async()=>vm.refresh());assert.equal(port.messages.at(-1).type,'site.snapshot');assert.equal(vm.error,generic)}assert.doesNotMatch(JSON.stringify(renderer.toJSON()),/INTERNAL_CANARY|Unsupported website|Offline postal|5-digit/);act(()=>renderer.unmount())});
