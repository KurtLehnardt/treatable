import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {OverlayAssistant} from '../src/overlay-app';
import {captureSiteActivations} from '../src/overlay-port';
import {SITE_FILTERS} from '../src/site-filter-catalog';
import {ONBOARDING_FLAG_KEY} from '../src/guide-state';
import {ONBOARDING_VERSION} from '../src/guide-steps';
import {UI_PREFS_KEY,DEFAULT_UI_PREFS} from '../src/ui-prefs';
import {RankingSection} from '../src/ranking-view';
import {RankConfirm} from '../src/rank-confirm-view';
import {MATCH_STATEMENT,RankingNotice} from '../src/ranking-notice';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import type {RankingState} from '../src/rank-state';

/* The shipped overlay entry on a ClinicalTrials.gov results page, driven through a fake site port. */
class Events{listeners:((...v:any[])=>void)[]=[];addListener=(f:(...v:any[])=>void)=>{this.listeners.push(f)};removeListener=(f:(...v:any[])=>void)=>{this.listeners=this.listeners.filter(x=>x!==f)};emit=(...v:any[])=>{for(const f of [...this.listeners])f(...v)}}
const settle=async(ms=0)=>{await act(async()=>{await new Promise(r=>setTimeout(r,ms));for(let i=0;i<20;i++)await new Promise<void>(r=>queueMicrotask(r))})};
const text=(node:any):string=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.children?text(node.children):'';
const [A,B]=['NCT00000001','NCT00000002'];
const NAME='NAME_CANARY_Quill',CONDITION=`asthma, ${NAME} wheezing since 1999, ZIP 90210`,EXTRA='EXTRA_CANARY_notes';
function mount({study,prefs=DEFAULT_UI_PREFS}:{study?:string;prefs?:any}={}){
 const old={window:(globalThis as any).window,document:(globalThis as any).document,chrome:(globalThis as any).chrome};
 const win:any=new EventTarget(),doc:any=new EventTarget(),parent={postMessage(){}};win.parent=parent;doc.visibilityState='visible';doc.hidden=false;
 const messages=new Events(),sent:any[]=[],url=study?`https://clinicaltrials.gov/study/${study}`:'https://clinicaltrials.gov/search?cond=Asthma';
 const snapshot={generation:'g1',url,nctIds:study?[]:[A,B],diagnostic:'Two cards',supported:!study};
 const sitePort:any={onMessage:messages,onDisconnect:new Events(),disconnect(){},postMessage(v:any){sent.push(structuredClone(v));if(v.type==='site.authenticate'){queueMicrotask(()=>{messages.emit({type:'site.ready',snapshot,filters:SITE_FILTERS,search:{},...(study?{study:{nctId:study}}:{})});messages.emit({type:'site.availability',options:{onlyAccepting:true,includeSoon:false,includeInvitation:false},loading:false})})}else queueMicrotask(()=>messages.emit({id:v.id,ok:true,result:v.type==='site.aiRank'?{started:true}:{active:true}}))}};
 const applyPort:any={onMessage:new Events(),onDisconnect:new Events(),postMessage(){},disconnect(){}};
 const local={get:async(key:string)=>key===ONBOARDING_FLAG_KEY?{[key]:ONBOARDING_VERSION}:{},set:async()=>{},remove:async()=>{}},storageWrites:any[]=[];
 const runtime={connect:({name}:{name:string})=>{if(name==='treatable.site.overlay.v1')return sitePort;if(name==='treatable-apply-v1')return applyPort;throw Error('unexpected port '+name)},sendMessage:async()=>({ok:true}),getURL:(v:string)=>`chrome-extension://test/${v}`};
 for(const[key,value]of Object.entries({window:win,document:doc,chrome:{runtime,storage:{local:{...local,set:async(v:any)=>{storageWrites.push(v)}},session:local}}}))Object.defineProperty(globalThis,key,{configurable:true,value});
 captureSiteActivations(win);let renderer!:TestRenderer.ReactTestRenderer;
 const start=async()=>{await act(async()=>{renderer=TestRenderer.create(React.createElement(OverlayAssistant,{initialPrefs:prefs}),{createNodeMock:()=>({focus(){},scrollIntoView(){}})});const e=new Event('message');Object.assign(e,{source:parent,origin:'https://clinicaltrials.gov',data:{type:'treatable.site.activate',purpose:'overlay',capability:'a'.repeat(64)}});win.dispatchEvent(e)});await settle(5)};
 const restore=()=>{act(()=>renderer?.unmount());for(const[key,value]of Object.entries(old))Object.defineProperty(globalThis,key,{configurable:true,value})};
 const requests=(type:string)=>sent.filter(v=>v.type===type);
 const emitRanking=async(state:RankingState)=>{await act(async()=>{messages.emit({type:'site.ranking',state})});await settle()};
 return{start,restore,requests,emitRanking,storageWrites,root:()=>renderer.root,shown:()=>text(renderer.toJSON())};
}

test('the shipped overlay ranks a results page on its own, with Your details limited to age band, sex and short condition terms',async()=>{
 const m=mount();try{await m.start();
  assert.match(m.shown(),/AI-matched results/);assert.match(m.shown(),/Studies on this page, best matches first/);assert.match(m.shown(),/Understand this study/,'the study brief stays alongside');
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
 const m=mount();try{await m.start();
  await m.emitRanking({phase:'done',total:2,applied:true,provider:'openai',mode:'test',studies:[{nctId:A,title:'Study A',percent:91,reasonId:'strong_match',checks:[],score:91,probabilities:[0,0,.27,.73]},{nctId:B,title:'Study B',percent:4,reasonId:'not_recruiting',checks:['not_recruiting','outside_age_range'],score:40,probabilities:[.1,.4,.4,.1]}],request:{text:'{\n  "model": "gpt-6-luna"\n}',bytes:24,truncated:false},profile:{conditions:['Asthma'],ageBand:'45_59'}});
  const shown=m.shown();
  for(const expected of ['Ranked 2 studies','91%','Strong match for your condition','4%','Not recruiting · Outside the listed age range','How this was ranked','Test run','gpt-6-luna','Relevance score 91 of 100','Strongly related','73.0%','condition terms Asthma','Restore original order'])assert.ok(shown.includes(expected),expected);
  const section=text(m.root().find(n=>n.type==='section'&&n.props['aria-labelledby']==='ai-ranking-heading').children);assert.doesNotMatch(section,/eligib/i,'the ranking section never predicts eligibility');
  await m.emitRanking({phase:'done',total:2,applied:true,provider:'none',failure:'HELPER_VERSION_MISMATCH',studies:[{nctId:A,title:'Study A',percent:null,reasonId:'not_scored',checks:[]},{nctId:B,title:'Study B',percent:0,reasonId:'not_recruiting',checks:['not_recruiting']}]});
  assert.match(m.shown(),/AI scoring did not run, so record checks set the order/);assert.match(m.shown(),/Reinstall the helper/);assert.match(m.shown(),/HELPER_VERSION_MISMATCH/);assert.match(m.shown(),/No AI scoring ran for this page/);assert.doesNotMatch(m.shown(),/Live OpenAI Decisions result|Sent for scoring/);
  await m.emitRanking({phase:'done',total:2,applied:true,provider:'openai',failure:'RATE_LIMITED',request:{text:'{}',bytes:2,truncated:false},profile:{conditions:['Asthma']},studies:[]});assert.match(m.shown(),/The request below was sent or may have been sent, but no valid scores came back/);
  await m.emitRanking({phase:'done',total:2,applied:true,provider:'none',note:'declined',failure:'CONFIRMATION_CANCELLED',studies:[]});assert.match(m.shown(),/paused until you allow it/);
  await m.emitRanking({phase:'confirming',total:2});assert.match(m.shown(),/Waiting for your answer in the Treatable confirmation window/);
  const restore=m.root().findAll(n=>n.type==='button'&&text(n.children)==='Restore original order');assert.equal(restore.length,0,'no restore while a ranking is pending');
 }finally{m.restore()}
});

test('turning AI-matched results off stops ranking and saves the choice; off from the start sends no ranking request',async()=>{
 const m=mount();try{await m.start();await settle(1000);assert.equal(m.requests('site.aiRank').length,1);
  const toggle=m.root().findAll(n=>n.type==='input'&&n.props.role==='switch')[0];assert.equal(toggle.props.checked,true);
  await act(async()=>toggle.props.onChange({target:{checked:false}}));await settle(1000);
  assert.equal(m.requests('site.aiRankStop').length,1);assert.equal(m.requests('site.aiRank').length,1,'no new ranking while off');
  assert.deepEqual(m.storageWrites.at(-1),{[UI_PREFS_KEY]:{displayMode:'popup',theme:'system',provider:'openai',localModel:null,aiRanking:'off'}});assert.match(m.shown(),/AI-matched results are off/);
 }finally{m.restore()}
 const off=mount({prefs:{...DEFAULT_UI_PREFS,aiRanking:'off'}});try{await off.start();await settle(1000);assert.equal(off.requests('site.aiRank').length,0);assert.match(off.shown(),/AI-matched results are off/)}finally{off.restore()}
});

test('a study page keeps the brief as the main action and never ranks',async()=>{
 const m=mount({study:A});try{await m.start();await settle(1000);assert.equal(m.requests('site.aiRank').length,0);assert.doesNotMatch(m.shown(),/Studies on this page, best matches first|Find my matches/);assert.match(m.shown(),/Understand this study/)}finally{m.restore()}
});

test('one disclaimer: the notice holds the single statement; the panel, cards and footer repeat none',()=>{
 const notice=renderToStaticMarkup(React.createElement(RankingNotice));assert.equal(notice.split(MATCH_STATEMENT).length,2,'exactly once in the notice');
 const confirm=renderToStaticMarkup(React.createElement(RankConfirm,{summary:{conditions:['Asthma'],ageBand:'45_59',sex:'female',studies:[{nctId:A,title:'Study A'}],exactPayload:{model:'gpt-6-luna'}},busy:false,choose:()=>{}}));
 for(const expected of ['Turn on AI-matched results?','See what is sent','gpt-6-luna','Allow for this browser session','Not now','Never sent','Privacy + Health Data Notice'])assert.ok(confirm.toLowerCase().includes(expected.toLowerCase()),expected);
 assert.doesNotMatch(confirm,/token|digest/i);
 const panel=renderToStaticMarkup(React.createElement(RankingSection,{vm:{aiRanking:'on',connected:true,busy:false,setAiRanking:()=>{},restore:()=>{},again:()=>{},ranking:{phase:'done',total:1,applied:true,provider:'openai',mode:'live',studies:[{nctId:A,title:'Study A',percent:80,reasonId:'strong_match',checks:[]}]}}}));
 assert.doesNotMatch(panel,/eligib|medical opinion/i);
 const waiting=renderToStaticMarkup(React.createElement(RankingSection,{vm:{aiRanking:'on',connected:true,busy:false,setAiRanking:()=>{},restore:()=>{},again:()=>{},waiting:'intro'}}));assert.match(waiting,/Ranking starts once the intro tour is finished or skipped/);
 const overlay=readFileSync(new URL('../src/overlay-view.tsx',import.meta.url),'utf8');assert.doesNotMatch(overlay,/Match scores express relevance/);
 const badgeBundle=readFileSync(new URL('../dist/score-badge.js',import.meta.url),'utf8');assert.doesNotMatch(badgeBundle,/Normalized relevance|not eligibility odds|Eligibility unknown/);
});
