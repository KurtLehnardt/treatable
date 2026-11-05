import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {OverlayAssistant} from '../src/overlay-app';
import {captureSiteActivations} from '../src/overlay-port';
import {ONBOARDING_FLAG_KEY} from '../src/guide-state';
import {ONBOARDING_VERSION} from '../src/guide-steps';
import {DEFAULT_UI_PREFS} from '../src/ui-prefs';
import {RankingSection} from '../src/ranking-view';
import {MATCH_STATEMENT,RankingNotice} from '../src/ranking-notice';
import {AI_SWITCH_DISCLOSURE,type AiConsent} from '../src/ai-switch';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import type {RankingState} from '../src/rank-state';

/* The shipped overlay entry on a ClinicalTrials.gov results page, driven through a fake site port. */
class Events{listeners:((...v:any[])=>void)[]=[];addListener=(f:(...v:any[])=>void)=>{this.listeners.push(f)};removeListener=(f:(...v:any[])=>void)=>{this.listeners=this.listeners.filter(x=>x!==f)};emit=(...v:any[])=>{for(const f of [...this.listeners])f(...v)}}
const settle=async(ms=0)=>{await act(async()=>{await new Promise(r=>setTimeout(r,ms));for(let i=0;i<20;i++)await new Promise<void>(r=>queueMicrotask(r))})};
const text=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.children?text(node.children):'';
const [A,B]=['NCT00000001','NCT00000002'];
const NAME='NAME_CANARY_Quill',CONDITION=`asthma, ${NAME} wheezing since 1999, ZIP 90210`,EXTRA='EXTRA_CANARY_notes';
/* `consent` is what the background tells the overlay about the switch on connecting (null: off, the default). `active` is whether the
 * frame has transient user activation, as after a real click or key press. */
function mount({study,prefs=DEFAULT_UI_PREFS,consent=null}:{study?:string;prefs?:any;consent?:AiConsent|null}={}){
 const old={window:(globalThis as any).window,document:(globalThis as any).document,chrome:(globalThis as any).chrome},oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const win:any=new EventTarget(),doc:any=new EventTarget(),parent={postMessage(){}};win.parent=parent;doc.visibilityState='visible';doc.hidden=false;
 const messages=new Events(),sent:any[]=[],url=study?`https://clinicaltrials.gov/study/${study}`:'https://clinicaltrials.gov/search?cond=Asthma',activation={isActive:false};
 const snapshot={generation:'g1',url,nctIds:study?[]:[A,B],diagnostic:'Two cards',supported:!study};
 const sitePort:any={onMessage:messages,onDisconnect:new Events(),disconnect(){},postMessage(v:any){sent.push(structuredClone(v));if(v.type==='site.authenticate'){queueMicrotask(()=>{messages.emit({type:'site.ready',snapshot,aiConsent:consent,...(study?{study:{nctId:study}}:{})})})}else queueMicrotask(()=>messages.emit({id:v.id,ok:true,result:v.type==='site.aiRank'?{started:true}:v.type==='site.aiSwitch'?{consent:v.payload.on?v.payload.disclosure:null}:{active:true}}))}};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userActivation:activation}});
 /* The browser's visibility reports for the switch row (IntersectionObserver with trackVisibility). */
 const observers:any[]=[],oldObserver=Object.getOwnPropertyDescriptor(globalThis,'IntersectionObserver');
 class FakeObserver{target:any;disconnected=false;constructor(public callback:(entries:any[])=>void,public options:any){observers.push(this)}observe(target:any){this.target=target}disconnect(){this.disconnected=true}}
 Object.defineProperty(globalThis,'IntersectionObserver',{configurable:true,writable:true,value:FakeObserver});
 /** Reports the switch row visible (or not) since `ms` ago to every live observer. */
 const report=(isVisible:boolean,ms=1000,ratio=1)=>{for(const o of observers)if(!o.disconnected&&o.target)o.callback([{isVisible,isIntersecting:ratio>0,time:performance.now()-ms,intersectionRatio:ratio}])};
 const applyPort:any={onMessage:new Events(),onDisconnect:new Events(),postMessage(){},disconnect(){}};
 const local={get:async(key:string)=>key===ONBOARDING_FLAG_KEY?{[key]:ONBOARDING_VERSION}:{},set:async()=>{},remove:async()=>{}},storageWrites:any[]=[];
 const runtime={connect:({name}:{name:string})=>{if(name==='treatable.site.overlay.v1')return sitePort;if(name==='treatable-apply-v1')return applyPort;throw Error('unexpected port '+name)},sendMessage:async()=>({ok:true}),getURL:(v:string)=>`chrome-extension://test/${v}`};
 for(const[key,value]of Object.entries({window:win,document:doc,chrome:{runtime,storage:{local:{...local,set:async(v:any)=>{storageWrites.push(v)}},session:local}}}))Object.defineProperty(globalThis,key,{configurable:true,value});
 captureSiteActivations(win);let renderer!:TestRenderer.ReactTestRenderer;
 const start=async()=>{await act(async()=>{renderer=TestRenderer.create(React.createElement(OverlayAssistant,{initialPrefs:prefs}),{createNodeMock:()=>({focus(){},scrollIntoView(){}})});const e=new Event('message');Object.assign(e,{source:parent,origin:'https://clinicaltrials.gov',data:{type:'treatable.site.activate',purpose:'overlay',capability:'a'.repeat(64)}});win.dispatchEvent(e)});await settle(5)};
 const restore=()=>{act(()=>renderer?.unmount());for(const[key,value]of Object.entries(old))Object.defineProperty(globalThis,key,{configurable:true,value});if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);if(oldObserver)Object.defineProperty(globalThis,'IntersectionObserver',oldObserver);else delete (globalThis as any).IntersectionObserver};
 const requests=(type:string)=>sent.filter(v=>v.type===type);
 const emitRanking=async(state:RankingState)=>{await act(async()=>{messages.emit({type:'site.ranking',state})});await settle()};
 const emit=async(v:any)=>{await act(async()=>{messages.emit(v)});await settle()};
 const toggle=()=>renderer.root.findAll(n=>n.type==='input'&&n.props.role==='switch')[0];
 /** A pointer or focus event that happened `ms` ago, as the browser would deliver it for the frame boundary (no related target). */
 const past=(target:EventTarget,type:string,ms:number)=>{const e=new Event(type);Object.defineProperty(e,'timeStamp',{value:performance.now()-ms});Object.defineProperty(e,'relatedTarget',{value:null});target.dispatchEvent(e)};
 /** Flips the switch as React would report it: `trusted` is the browser's isTrusted on the event; `active` the frame's user activation;
  * `visible` whether the browser reports the switch row fully visible, and for how long (`visibleMs`); `pointerMs` since when the pointer
  * has been inside the frame (null: it is not). */
 const flip=async(checked:boolean,{trusted=true,active=true,visible=true,visibleMs=1000,ratio=1,pointerMs=1000}:{trusted?:boolean;active?:boolean;visible?:boolean;visibleMs?:number;ratio?:number;pointerMs?:number|null}={})=>{report(visible,visibleMs,ratio);past(doc,'pointerout',0);if(pointerMs!==null)past(doc,'pointerover',pointerMs);activation.isActive=active;await act(async()=>toggle().props.onChange({target:{checked},nativeEvent:{isTrusted:trusted}}));activation.isActive=false;await settle()};
 return{start,restore,requests,emitRanking,emit,storageWrites,toggle,flip,observers,past,win,doc,messages,root:()=>renderer.root,shown:()=>text(renderer.toJSON())};
}

test('default off: the switch is off on first open with its disclosure beside it, and nothing ranks; only the person’s own click turns it on',async()=>{
 const m=mount();try{await m.start();await settle(1000);
  assert.equal(m.toggle().props.checked,false,'off unless the person turns it on');assert.equal(m.requests('site.aiRank').length,0,'nothing is ranked or sent');
  const disclosure=m.root().find(n=>n.props.id==='ai-switch-disclosure');assert.equal(text(disclosure.children),AI_SWITCH_DISCLOSURE.openai);assert.equal(m.toggle().props['aria-describedby'],'ai-switch-disclosure','the switch is described by its disclosure');
  assert.equal(AI_SWITCH_DISCLOSURE.openai,'Sends short condition words and the page’s public study records to OpenAI to sort results. Off unless you turn it on.');
  assert.match(m.shown(),/AI-matched results are off, so the website keeps its own order/);
  /* A script, a synthetic event or a click the browser did not attribute to the person is not consent. */
  await m.flip(true,{trusted:false});await m.flip(true,{active:false});await act(async()=>m.toggle().props.onChange({target:{checked:true}}));await settle(1000);
  assert.equal(m.requests('site.aiSwitch').length,0,'nothing asked the background to turn it on');assert.equal(m.toggle().props.checked,false);assert.equal(m.requests('site.aiRank').length,0);
  await m.flip(true);await settle(1000);
  assert.deepEqual(m.requests('site.aiSwitch').map(v=>v.payload),[{on:true,disclosure:'openai'}],'the disclosure that was beside the switch is what the background records');
  assert.equal(m.toggle().props.checked,true);assert.equal(m.requests('site.aiRank').length,1,'ranking starts once it is on');
  assert.deepEqual(m.storageWrites,[],'the overlay never stores the switch itself');
 }finally{m.restore()}
});

test('a click on a switch the page has covered, faded or only just shown is not consent',async()=>{
 const m=mount();try{await m.start();
  const observer=m.observers.find((o:any)=>!o.disconnected);assert.ok(observer,'the switch row is watched');assert.equal(observer.options.trackVisibility,true,'with the browser visibility check');assert.ok(observer.options.delay>=100);
  await m.flip(true,{visible:false});assert.match(m.shown(),/AI-matched results was not turned on\. Close anything that covers Treatable/);
  await m.flip(true,{visible:false});await m.flip(true,{visibleMs:100});
  await m.flip(true,{visible:false});await m.flip(true,{ratio:0.5});
  await m.flip(true,{visible:false});await m.flip(true,{pointerMs:100});
  await m.flip(true,{pointerMs:null});
  assert.equal(m.requests('site.aiSwitch').length,0,'covered, faded, clipped to the bare switch, shown for less than half a second, moved under the pointer or clicked straight from the website: nothing is turned on');assert.equal(m.toggle().props.checked,false);
  /* The browser reports it hidden, then fully visible again a second ago, with the pointer resting on the frame: it turns on. */
  await m.flip(true,{visible:false});
  let release!:()=>void;const held=new Promise<void>(r=>{release=r});const answer=m.messages.emit.bind(m.messages);m.messages.emit=(v:any)=>{if(v?.result?.consent==='openai')void held.then(()=>answer(v));else answer(v)};
  await m.flip(true);assert.deepEqual(m.requests('site.aiSwitch').map(v=>v.payload),[{on:true,disclosure:'openai'}]);
  assert.equal(m.toggle().props['aria-busy'],true,'while the background records it, the switch is marked busy');assert.equal(m.toggle().props.disabled,false,'and never disabled, so keyboard focus stays on it');
  await m.flip(true);assert.equal(m.requests('site.aiSwitch').length,1,'a second press while busy asks nothing');
  await act(async()=>{release();await held});await settle();assert.equal(m.toggle().props.checked,true);assert.equal(m.toggle().props['aria-busy'],undefined);
 }finally{m.restore()}
 /* Keyboard and assistive technology: no pointer in the frame, but the frame has had focus for a moment. */
 const k=mount();try{await k.start();k.past(k.win,'blur',0);k.past(k.win,'focus',1000);await k.flip(true,{pointerMs:null});assert.deepEqual(k.requests('site.aiSwitch').map(v=>v.payload),[{on:true,disclosure:'openai'}])}finally{k.restore()}
 const q=mount();try{await q.start();q.past(q.win,'blur',0);q.past(q.win,'focus',100);await q.flip(true,{pointerMs:null});assert.equal(q.requests('site.aiSwitch').length,0,'focus that only just arrived does not count')}finally{q.restore()}
});

test('a turn-off is never held back by other pending site actions, on either side of the port',async()=>{
 const {SiteClient}=await import('../src/overlay-port');
 const messages=new Events(),sent:any[]=[];const port:any={onMessage:messages,onDisconnect:new Events(),disconnect(){},postMessage(v:any){sent.push(v);if(v.type==='site.authenticate')queueMicrotask(()=>messages.emit({type:'site.ready',snapshot:{generation:'g1',url:'https://clinicaltrials.gov/search?cond=Asthma',nctIds:[],diagnostic:'',supported:false}}))}};
 const client=new SiteClient({connect:()=>port});await client.authenticate('a'.repeat(64));
 for(let i=0;i<4;i++)void client.request('site.ping',{generation:'g1'}).catch(()=>{});
 await assert.rejects(client.request('site.aiSwitch',{on:true,disclosure:'openai'}),'a turn-on waits like any other action');
 void client.request('site.aiSwitch',{on:false}).catch(()=>{});
 assert.deepEqual(sent.filter(v=>v.type==='site.aiSwitch').map(v=>v.payload),[{on:false}],'the turn-off is sent');
 client.disconnect();
 assert.match(readFileSync(new URL('../src/site-background.ts',import.meta.url),'utf8'),/pending\.size>=\(req\.type==='site\.aiSwitch'&&req\.payload\?\.on===false\?8:4\)/,'the background makes the same room for it');
});

test('a turn-off the background never confirms shows the switch on again, and one it could not save says so',async()=>{
 const n=mount({consent:'openai'});try{await n.start();const emit=n.messages.emit.bind(n.messages);
  n.messages.emit=(v:any)=>emit(v?.result&&v.result.consent===null?{id:v.id,ok:false}:v);
  await act(async()=>n.toggle().props.onChange({target:{checked:false}}));await settle();
  assert.equal(n.toggle().props.checked,true,'nothing was stopped, so the switch does not claim it is off');assert.match(n.shown(),/Treatable could not turn off AI-matched results\. Try the switch again\./);
  n.messages.emit=(v:any)=>emit(v?.result&&v.result.consent===null?{...v,result:{consent:null,saved:false}}:v);
  await act(async()=>n.toggle().props.onChange({target:{checked:false}}));await settle();
  assert.equal(n.toggle().props.checked,false);assert.match(n.shown(),/AI-matched results is off now, but Treatable could not save that\./);
 }finally{n.restore()}
});

test('with the local model chosen, the disclosure says nothing is sent to OpenAI, and turning the switch on records the local model disclosure',async()=>{
 const m=mount({prefs:{...DEFAULT_UI_PREFS,provider:'local',localModel:'qwen3.5:9b'}});try{await m.start();
  assert.equal(text(m.root().find(n=>n.props.id==='ai-switch-disclosure').children),AI_SWITCH_DISCLOSURE.local);assert.match(AI_SWITCH_DISCLOSURE.local,/Nothing is sent to OpenAI\./);
  await m.flip(true);assert.deepEqual(m.requests('site.aiSwitch').map(v=>v.payload),[{on:true,disclosure:'local'}]);
 }finally{m.restore()}
 /* Turned on beside the local model disclosure only: with OpenAI chosen it reads as off and nothing ranks. */
 const o=mount({consent:'local'});try{await o.start();await settle(1000);assert.equal(o.toggle().props.checked,false);assert.equal(o.requests('site.aiRank').length,0)}finally{o.restore()}
});

test('the switch is shown only with its disclosure: collapsed, neither is shown',async()=>{
 const m=mount();try{await m.start();
  await act(async()=>m.root().find(n=>n.type==='button'&&n.props['aria-label']==='Collapse search assistant').props.onClick());
  assert.equal(m.root().findAll(n=>n.type==='input'&&n.props.role==='switch').length,0);assert.equal(m.root().findAll(n=>n.props.id==='ai-switch-disclosure').length,0);
 }finally{m.restore()}
});

test('the shipped overlay ranks a results page on its own, with Your details limited to age band, sex and short condition terms',async()=>{
 const m=mount({consent:'openai'});try{await m.start();
  assert.match(m.shown(),/AI-matched results/);assert.doesNotMatch(m.shown(),/Understand this study|Choose up to two studies/,'a results page does not mount the study brief chooser');
  assert.ok(m.root().findAll(n=>n.props['data-treatable-guide']==='ai-ranking').length>=1,'the setting the intro points at is on screen');
  await settle(1000);
  assert.deepEqual(m.requests('site.aiRank').map(v=>v.payload),[{details:{}}],'one automatic ranking request, with no details yet');
  await act(async()=>m.root().findByProps({'aria-label':'Treatable settings'}).props.onClick());
  const field=(label:RegExp)=>m.root().findAll(n=>['input','textarea','select'].includes(n.type as string)&&n.parent?.type==='label'&&label.test(String([n.parent.props.children].flat()[0])))[0];
  await act(async()=>field(/Your name/).props.onChange({target:{value:NAME}}));
  await act(async()=>field(/illness, condition/).props.onChange({target:{value:CONDITION}}));
  await act(async()=>field(/Anything else/).props.onChange({target:{value:EXTRA}}));
  await act(async()=>field(/Age band/).props.onChange({target:{value:'45_59'}}));
  await act(async()=>field(/Sex listed/).props.onChange({target:{value:'female'}}));
  await settle(1000);
  const last=m.requests('site.aiRank').at(-1);assert.deepEqual(last.payload,{details:{ageBand:'45_59',sex:'female',terms:['asthma']}});
  assert.doesNotMatch(JSON.stringify(m.requests('site.aiRank')),/NAME_CANARY|Quill|EXTRA_CANARY|1999|90210|wheezing since/,'no name, notes, year or ZIP leaves the overlay');
  assert.match(m.shown(),/Condition terms for AI-matched results: asthma\./);
 }finally{m.restore()}
});

test('the overlay shows labels, reasons, the failure fallback and How this was ranked, and never predicts eligibility',async()=>{
 const m=mount({consent:'openai'});try{await m.start();
  await m.emitRanking({phase:'done',total:2,applied:true,provider:'openai',mode:'test',studies:[{nctId:A,title:'Study A',percent:91,reasonId:'strong_match',checks:[],score:91,probabilities:[0,0,.27,.73]},{nctId:B,title:'Study B',percent:4,reasonId:'not_recruiting',checks:['not_recruiting','outside_age_range'],score:40,probabilities:[.1,.4,.4,.1]}],request:{text:'{\n  "model": "gpt-6-luna"\n}',bytes:24,truncated:false},profile:{conditions:['Asthma'],ageBand:'45_59'}});
  const shown=m.shown();
  for(const expected of ['Ranked 2 studies','91%','Strong match for your condition','4%','Not recruiting · Outside the listed age range','Technical details','Test run','gpt-6-luna','Relevance score 91 of 100','Strongly related','73.0%','condition terms Asthma','Show the website’s order'])assert.ok(shown.includes(expected),expected);
  const section=text(m.root().find(n=>n.type==='section'&&n.props['aria-labelledby']==='ai-ranking-heading').children);assert.doesNotMatch(section,/eligib/i,'the ranking section never predicts eligibility');
  await m.emitRanking({phase:'done',total:2,applied:true,provider:'none',failure:'HELPER_VERSION_MISMATCH',studies:[{nctId:A,title:'Study A',percent:null,reasonId:'not_scored',checks:[]},{nctId:B,title:'Study B',percent:0,reasonId:'not_recruiting',checks:['not_recruiting']}]});
  assert.match(m.shown(),/AI scoring did not run, so record checks set the order/);assert.match(m.shown(),/Reinstall the helper/);assert.match(m.shown(),/HELPER_VERSION_MISMATCH/);assert.match(m.shown(),/No AI scoring ran for this page/);const statusLine=m.root().findAll(n=>n.type==='p'&&n.props.role==='status'&&/AI scoring did not run/.test(text(n.children)))[0];assert.ok(statusLine,'the status line is there');assert.doesNotMatch(text(statusLine.children),/HELPER_VERSION_MISMATCH/,'the raw code is not in the patient-facing status line, only in How this was ranked');assert.doesNotMatch(m.shown(),/Live OpenAI Decisions result|Sent for scoring/);
  await m.emitRanking({phase:'done',total:2,applied:true,provider:'openai',failure:'RATE_LIMITED',request:{text:'{}',bytes:2,truncated:false},profile:{conditions:['Asthma']},studies:[]});assert.match(m.shown(),/The request below was sent or may have been sent, but no valid scores came back/);
  await m.emitRanking({phase:'scoring',total:2});assert.match(m.shown(),/Scoring how relevant each study is/);assert.doesNotMatch(m.shown(),/confirmation window|allow it/);
  const restore=m.root().findAll(n=>n.type==='button'&&text(n.children)==='Show the website’s order');assert.equal(restore.length,0,'no restore while a ranking is pending');
 }finally{m.restore()}
});

test('turning AI-matched results off takes effect at once, needs no gesture check and asks the background to stop and forget the switch',async()=>{
 const m=mount({consent:'openai'});try{await m.start();await settle(1000);assert.equal(m.requests('site.aiRank').length,1);
  assert.equal(m.toggle().props.checked,true);
  await act(async()=>m.toggle().props.onChange({target:{checked:false}}));
  assert.equal(m.toggle().props.checked,false,'shown off at once');assert.deepEqual(m.requests('site.aiSwitch').map(v=>v.payload),[{on:false}]);
  await settle(1000);assert.equal(m.requests('site.aiRank').length,1,'no new ranking while off');
  assert.deepEqual(m.storageWrites,[],'nothing about the switch is written by the overlay');assert.match(m.shown(),/AI-matched results are off/);
  /* Turned off in another tab: the background tells every overlay. */
  await m.flip(true);await settle(1000);assert.equal(m.toggle().props.checked,true);
  await m.emit({type:'site.aiConsent',consent:null});assert.equal(m.toggle().props.checked,false);
  for(const bad of [{type:'site.aiConsent',consent:'anthropic'},{type:'site.aiConsent',consent:'openai',extra:1},{type:'site.aiConsent'}])await m.emit(bad);
  assert.equal(m.toggle().props.checked,false,'malformed reports change nothing');
 }finally{m.restore()}
 /* Migration: preferences an earlier version saved with the switch on, and no switch record in the background, open with it off. */
 const old=mount({prefs:{...DEFAULT_UI_PREFS,aiRanking:'on'},consent:null});try{await old.start();await settle(1000);assert.equal(old.toggle().props.checked,false);assert.equal(old.requests('site.aiRank').length,0);assert.match(old.shown(),/AI-matched results are off/)}finally{old.restore()}
});

test('a study page keeps the brief as the main action and never ranks',async()=>{
 const m=mount({study:A});try{await m.start();await settle(1000);assert.equal(m.requests('site.aiRank').length,0);assert.doesNotMatch(m.shown(),/Studies on this page, best matches first|Find my matches/);assert.match(m.shown(),/Understand this study/)}finally{m.restore()}
});

test('one disclaimer: the notice in Settings holds the single statement; the panel, cards and footer repeat none',async()=>{
 const notice=renderToStaticMarkup(React.createElement(RankingNotice));assert.equal(notice.split(MATCH_STATEMENT).length,2,'exactly once in the notice');
 for(const expected of ['Only while the AI-matched results switch is on and OpenAI is the model provider','The switch is off unless you turn it on','With the local model, nothing is sent to OpenAI','never sent','Turning it off stops any ranking in progress','OpenAI data controls','privacy.6vpc5@mailer.me'])assert.ok(notice.includes(expected),expected);
 assert.doesNotMatch(notice,/browser session|asks once|confirmation window|token|digest/i,'nothing about the removed window or the receipt');
 const m=mount();try{await m.start();await act(async()=>m.root().findByProps({'aria-label':'Treatable settings'}).props.onClick());assert.match(m.shown(),/AI-matched results: privacy and health data notice/,'the notice can be read in Settings before the switch is turned on')}finally{m.restore()}
 const panel=renderToStaticMarkup(React.createElement(RankingSection,{vm:{aiRanking:'on',connected:true,busy:false,restore:()=>{},again:()=>{},ranking:{phase:'done',total:1,applied:true,provider:'openai',mode:'live',studies:[{nctId:A,title:'Study A',percent:80,reasonId:'strong_match',checks:[]}]}}}));
 assert.doesNotMatch(panel,/eligib|medical opinion/i);
 const off=renderToStaticMarkup(React.createElement(RankingSection,{vm:{aiRanking:'off',connected:true,busy:false,restore:()=>{},again:()=>{}}}));assert.doesNotMatch(off,/<button/,'only the switch, beside its disclosure, turns AI-matched results on');
 const waiting=renderToStaticMarkup(React.createElement(RankingSection,{vm:{aiRanking:'on',connected:true,busy:false,restore:()=>{},again:()=>{},waiting:'intro'}}));assert.match(waiting,/Ranking starts once the intro tour is finished or skipped/);
 const overlay=readFileSync(new URL('../src/overlay-view.tsx',import.meta.url),'utf8');assert.doesNotMatch(overlay,/Match scores express relevance/);
 const badgeBundle=readFileSync(new URL('../dist/score-badge.js',import.meta.url),'utf8');assert.doesNotMatch(badgeBundle,/Normalized relevance|not eligibility odds|Eligibility unknown/);
});

test('while the popup is hidden AI-matched results pause, even when the page changes; shown again from the toolbar, it ranks the page then shown',async()=>{
 const m=mount({consent:'openai'});try{await m.start();await settle(1000);
  assert.equal(m.requests('site.aiRank').length,1);
  await m.emit({type:'site.view',hidden:true,collapsed:false});
  await m.emit({type:'site.snapshot',snapshot:{generation:'g2',url:'https://clinicaltrials.gov/search?cond=Asthma&page=2',nctIds:[B,A],diagnostic:'Two cards',supported:true}});
  await settle(1000);
  assert.equal(m.requests('site.aiRank').length,1,'nothing is ranked or sent while hidden');
  await m.emit({type:'site.view',hidden:false,collapsed:false});await settle(1000);
  assert.equal(m.requests('site.aiRank').length,2,'ranking resumes once it is shown');
 }finally{m.restore()}
});

test('a toolbar press that expands a compact popup expands its view too, and malformed reports change nothing',async()=>{
 const m=mount();try{await m.start();
  const labelled=(label:string)=>m.root().findAll(n=>n.type==='button'&&n.props['aria-label']===label).length;
  await act(async()=>m.root().find(n=>n.type==='button'&&n.props['aria-label']==='Collapse search assistant').props.onClick());
  assert.equal(labelled('Expand search assistant'),1,'collapsed by the person');
  for(const bad of [{type:'site.view',hidden:'no',collapsed:false},{type:'site.view',hidden:false,collapsed:false,extra:1},{type:'site.view',collapsed:false}])await m.emit(bad);
  assert.equal(labelled('Expand search assistant'),1,'malformed reports change nothing');
  await m.emit({type:'site.view',hidden:false,collapsed:false});
  assert.equal(labelled('Collapse search assistant'),1,'the view agrees with the expanded frame');assert.ok(m.root().findAll(n=>n.type==='section'&&n.props['aria-labelledby']==='ai-ranking-heading').length===1,'the ranking section is visible once expanded');assert.doesNotMatch(m.shown(),/Replay intro/,'Replay intro now lives in Settings, closed here');assert.doesNotMatch(m.shown(),/Search ClinicalTrials\.gov|More filters|Search the live registry/);
 }finally{m.restore()}
});

test('badged is dropped when the page moves to a new snapshot generation: the full list returns',async()=>{
 const m=mount({consent:'openai'});try{await m.start();
  const studies=[{nctId:A,title:'Study A',percent:91,reasonId:'strong_match',checks:[],score:91},{nctId:B,title:'Study B',percent:4,reasonId:'not_recruiting',checks:['not_recruiting','outside_age_range'],score:40}] as any;
  await m.emitRanking({phase:'done',total:2,applied:true,provider:'openai',mode:'live',badged:true,studies});
  assert.match(m.shown(),/Match % is on each card/);const lists=()=>m.root().findAll(n=>n.type==='ol'&&String(n.props.className).startsWith('ranking-list')&&n.props.className!=='ranking-list moved-list'&&n.parent?.type!=='details');assert.equal(lists().length,0,'no duplicate list while the badges are on the cards (the full list is inside the closed disclosure)');assert.match(m.shown(),/Not recruiting · Outside the listed age range/);
  await m.emit({type:'site.snapshot',snapshot:{generation:'g2',url:'https://clinicaltrials.gov/search?cond=Asthma',nctIds:[A,B],diagnostic:'Two cards',supported:true}});
  assert.doesNotMatch(m.shown(),/Match % is on each card/,'the badged claim ended with the generation');assert.equal(lists().length,1,'the list is back');
  await m.emitRanking({phase:'done',total:2,applied:true,provider:'openai',mode:'live',badged:true,studies});
  assert.match(m.shown(),/Match % is on each card/,'a ranking that arrives for the current generation is badged again');
 }finally{m.restore()}
});

test('the sharpen link shows while a condition or an age band is missing, and opens Your details',async()=>{
 const m=mount({consent:'openai'});try{await m.start();
  await m.emitRanking({phase:'done',total:2,applied:true,provider:'openai',mode:'live',badged:true,studies:[{nctId:A,title:'Study A',percent:91,reasonId:'strong_match',checks:[],score:91}]} as any);
  const link=()=>m.root().findAll(n=>n.type==='button'&&text(n.children)==='Add your condition and age for better matches ›');
  assert.equal(link().length,1,'nothing entered');
  await act(async()=>link()[0].props.onClick());
  assert.ok(m.root().findAll(n=>n.props.id==='treatable-settings').length>=1,'Settings opened');
  const field=(label:RegExp)=>m.root().findAll(n=>['input','textarea','select'].includes(n.type as string)&&n.parent?.type==='label'&&label.test(String([n.parent.props.children].flat()[0])))[0];
  await act(async()=>field(/illness, condition/).props.onChange({target:{value:'asthma'}}));assert.equal(link().length,1,'a condition alone: age is still missing');
  await act(async()=>field(/Age band/).props.onChange({target:{value:'45_59'}}));assert.equal(link().length,0,'condition and age: nothing left to add');
  await act(async()=>field(/illness, condition/).props.onChange({target:{value:''}}));assert.equal(link().length,1,'an age alone: the condition is missing');
 }finally{m.restore()}
});
