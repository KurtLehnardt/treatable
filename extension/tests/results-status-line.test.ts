import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import React,{act as reactAct,useContext} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import TestRenderer,{act} from 'react-test-renderer';
import {readFileSync} from 'node:fs';
import {RankingSection} from '../src/ranking-view';
import {OverlayView} from '../src/overlay-view';
import {collapsedStatus,parseRankingState} from '../src/rank-state';
import {installDom} from './dom-harness';

const study=(i:number,percent:number|null,checks:string[]=[])=>({nctId:`NCT0000000${i}`,title:`Study ${i}`,percent,reasonId:checks[0]??'strong_match',checks,score:percent??0});
const TWO=['not_recruiting','outside_age_range'];
const done=(extra:any={})=>({phase:'done',total:2,applied:true,provider:'openai',mode:'live',studies:[study(1,91),study(2,4,TWO)],request:{text:'{"model":"m"}',bytes:13,truncated:false},profile:{conditions:['Asthma']},...extra});
const model=(ranking:any,extra:any={})=>({aiRanking:'on',connected:true,busy:false,setAiRanking(){},restore(){},again(){},ranking,...extra}) as any;
const html=(ranking:any,extra:any={})=>renderToStaticMarkup(React.createElement(RankingSection,{vm:model(ranking,extra)}));
const visible=(h:string)=>h.replace(/<details[^>]*>[\s\S]*?<\/details>/g,'').replace(/<h2[^>]*sr-only[^>]*>.*?<\/h2>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
const buttons=(h:string)=>[...h.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(m=>m[1]);

test('badges placed: one status line, an extension-owned list of the moved studies with every reason, and the full list behind a closed disclosure',()=>{
 const h=html(done({badged:true}),{searchHelp:()=>{}});
 assert.match(h,/Ranked 2 studies, best matches first\. Match % is on each card\./);
 assert.equal((visible(h).match(/best matches first/g)||[]).length,1,'said once');
 assert.doesNotMatch(h,/hover/i,'no hover instruction: the page is inert in the popup');
 const moved=h.slice(h.indexOf('moved-list'),h.indexOf('<details class="ranking-all"'));
 assert.match(moved,/Study 2/);assert.doesNotMatch(moved,/Study 1/,'only studies moved to the end are listed outside the disclosure');
 assert.match(moved,/Not recruiting · Outside the listed age range/,'all check reasons, not only the first');
 assert.match(h,/<details class="ranking-all"><summary>Show all ranked studies<\/summary>/,'closed by default');
 assert.ok(h.slice(h.indexOf('ranking-all')).includes('Study 1'),'the full ranked list is page-independent');
 assert.deepEqual(buttons(h),['Show the website’s order','Show me the website’s filters']);
 assert.doesNotMatch(html(done({badged:true,studies:[study(1,91),study(2,80)]})),/moved-list|Moved to the end/,'nothing moved, no moved list');
});
test('badges not placed or not known: the full list is shown and there is no extra disclosure',()=>{
 for(const badged of [false,undefined]){
  const h=html(done(badged===undefined?{}:{badged}));
  assert.match(h,/class="ranking-list"/);assert.match(h,/Study 1/);assert.match(h,/Not recruiting · Outside the listed age range/);
  assert.doesNotMatch(h,/Match % is on each card|ranking-all|moved-list/);
 }
});
test('failure, declined and no-condition states: both check reasons stay visible, and badged never hides the failure notice or its retry',()=>{
 const base={badged:true,provider:'none',studies:[study(1,null),study(2,0,TWO)]};
 const f=html(done({...base,failure:'API_ERROR'}));
 assert.match(f,/AI scoring did not run, so record checks set the order/);assert.ok(buttons(f).includes('Try AI ranking again'));
 assert.match(f.slice(f.indexOf('moved-list')),/Not recruiting · Outside the listed age range/);
 const d=html(done({...base,note:'declined',failure:'CONFIRMATION_CANCELLED'}));
 assert.match(d,/paused until you allow it/);assert.ok(buttons(d).includes('Review and allow AI ranking'));assert.match(d.slice(d.indexOf('moved-list')),/Outside the listed age range/);
 const n=html(done({...base,note:'no_condition'}));
 assert.match(n,/Search for a condition on ClinicalTrials\.gov to rank by relevance/);assert.doesNotMatch(n,/Settings → Your details/);assert.match(n.slice(n.indexOf('moved-list')),/Outside the listed age range/);
});
test('one Technical details disclosure holds the code, request body and probabilities, under a heading that does not skip levels',()=>{
 const h=html(done({badged:true,failure:'RATE_LIMITED',studies:[{...study(1,91),probabilities:[0,0,.27,.73]},study(2,4,TWO)]}));
 assert.equal((h.match(/<details class="brief-how ranking-how"/g)||[]).length,1);
 const inside=h.slice(h.indexOf('ranking-how'));
 assert.match(inside,/<summary>Technical details<\/summary>/);assert.match(inside,/<code>RATE_LIMITED<\/code>/);assert.match(inside,/Ranking request body/);assert.match(inside,/73\.0%/);
 assert.doesNotMatch(h.slice(0,h.indexOf('ranking-how')),/RATE_LIMITED|73\.0%/,'nothing technical outside it');
 assert.doesNotMatch(h,/<h4/,'no jump from h2 to h4');assert.doesNotMatch(h,/How this was ranked/);
});
test('the results section has one visually hidden heading, no eyebrow and no second headline',()=>{
 const h=html(done({badged:true}));
 assert.match(h,/<h2 id="ai-ranking-heading" class="sr-only">AI-matched results<\/h2>/);assert.doesNotMatch(h,/eyebrow|Studies on this page/);
 assert.match(readFileSync(new URL('../src/overlay.css',import.meta.url),'utf8'),/\.ai-ranking \.ranking-summary\{font-size:15px/);
});
test('the website-filters help stays reachable when AI-matched results are off',()=>{
 const h=html(undefined,{aiRanking:'off',searchHelp:()=>{}});
 assert.match(h,/Turn on AI-matched results/);assert.match(h,/Show me the website’s filters/);
 assert.doesNotMatch(html(undefined,{aiRanking:'off'}),/website’s filters/,'only when the guide can run');
});
test('sharpen link: offered only when passed and only once a ranking is done; opens Your details',()=>{
 let opened=0;
 const r=TestRenderer.create(React.createElement(RankingSection,{vm:model(done({badged:true}),{sharpen:()=>opened++})}));
 const b=r.root.findAllByType('button').find(x=>x.children.join('')==='Add your condition and age for better matches ›')!;
 b.props.onClick();assert.equal(opened,1);r.unmount();
 assert.doesNotMatch(html(done({badged:true})),/better matches/);
 for(const ranking of [{phase:'scoring',total:2},{phase:'unavailable',note:'too_many',total:12},undefined])assert.doesNotMatch(html(ranking,{sharpen:()=>{}}),/better matches/,'not in '+ranking?.phase);
});
const overlayVm=(extra:any={})=>({connected:true,ended:false,busy:false,error:'',collapsed:true,setCollapsed(){},restore(){},close(){},aiRanking:'on',setAiRanking(){},ranking:done({badged:true}),...extra}) as any;
async function shown(vm:any){let r!:TestRenderer.ReactTestRenderer;await act(async()=>{r=TestRenderer.create(React.createElement(OverlayView,{vm}))});const json=JSON.stringify(r.toJSON());const status=r.root.findAll(n=>n.type==='p'&&n.props.className==='collapsed-status')[0];const text=status?status.children.join(''):undefined;const switchRow=r.root.findAll(n=>n.props.className==='ai-switch-row').length;r.unmount();return{text,switchRow,json}}
test('collapsed status text, and what the collapsed frame hides',async()=>{
 assert.equal(collapsedStatus(done({badged:true}) as any),'Ranked 2 · top match 91%');
 assert.equal(collapsedStatus({phase:'scoring'}),'Ranking…');
 assert.equal(collapsedStatus({phase:'confirming'}),'Waiting for your answer in the Treatable window');
 assert.equal(collapsedStatus(done({provider:'none',failure:'KEY_MISSING'}) as any),'Ranked 2 · no AI score');
 assert.equal(collapsedStatus(done({applied:false}) as any),undefined);assert.equal(collapsedStatus(undefined),undefined);
 const c=await shown(overlayVm());assert.equal(c.text,'Ranked 2 · top match 91%');assert.equal(c.switchRow,0,'the AI switch row does not clip the 104px frame');
 assert.equal((await shown(overlayVm({study:{nctId:'NCT00000001'}}))).text,'','no results status on a study page');
 assert.equal((await shown(overlayVm({aiRanking:'off'}))).text,'','no status while AI-matched results are off');
 const open=await shown(overlayVm({collapsed:false}));assert.equal(open.text,undefined);assert.equal(open.switchRow,1,'the switch is back when expanded');
});
test('the collapsed status is a live region that is mounted empty and filled after',()=>{
 const markup=renderToStaticMarkup(React.createElement(OverlayView,{vm:overlayVm()}));
 assert.match(markup,/<p role="status" class="collapsed-status"><\/p>/,'first render is empty; the effect fills it');
 const css=readFileSync(new URL('../src/overlay.css',import.meta.url),'utf8');
 assert.match(css,/\.overlay-brand>div\{min-width:0\}/,'lets the ellipsis work');
});
test('badged is validated on arrival',()=>{
 assert.equal(parseRankingState({phase:'done',badged:true})?.badged,true);
 assert.equal(parseRankingState({phase:'done',badged:'yes'}),undefined);assert.equal(parseRankingState({phase:'done',badged:1}),undefined);
});
test('badge geometry: 13px below 100, 12px for 100%, thin ring on a larger radius',()=>{
 const css=readFileSync(new URL('../src/score-badge.css',import.meta.url),'utf8'),view=readFileSync(new URL('../src/score-badge-view.tsx',import.meta.url),'utf8');
 assert.match(css,/\.badge-ring strong\{[^}]*font-size:13px/);assert.match(css,/\.badge-ring strong\.full\{font-size:12px;letter-spacing:-\.1em\}/);
 assert.equal((css.match(/stroke-width:3[;}]/g)||[]).length,2,'both ring strokes are 3');assert.doesNotMatch(css,/stroke-width:3\.5/);
 assert.equal((view.match(/r="18"/g)||[]).length,2,'both circles use r=18');assert.doesNotMatch(view,/r="17"/);
});

/* "Add your condition and age" opens Settings at Your details and focus follows, every time; Done or Escape give it back. */
let createRoot:any,Overlay:any,OpenSettingsContext:any;
before(async()=>{installDom();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;({createRoot}=await import('react-dom/client'));({OverlayView:Overlay}=await import('../src/overlay-view'));({OpenSettingsContext}=await import('../src/settings-context'))});
function Sharpen(){const open=useContext(OpenSettingsContext) as any;return React.createElement('button',{id:'sharpen',onClick:open},'Add')}
test('sharpen focus: lands on Your details, also with Settings already open, and returns on Escape',async()=>{
 const c=document.createElement('div');document.body.appendChild(c);const root=createRoot(c);
 const vm={connected:true,ended:false,busy:false,error:'',collapsed:false,setCollapsed(){},restore(){},close(){},aiRanking:'on',setAiRanking(){}};
 await reactAct(async()=>{root.render(React.createElement(Overlay,{vm,settings:React.createElement('h3',{id:'your-details-heading',tabIndex:-1},'Your details'),ranking:React.createElement(Sharpen)}))});
 const id=()=>document.activeElement?.id||document.activeElement?.getAttribute('aria-label');const sharpen=()=>document.getElementById('sharpen') as HTMLButtonElement,gear=()=>document.querySelector('[aria-label="Treatable settings"]') as HTMLButtonElement;
 sharpen().focus();await reactAct(async()=>{sharpen().click()});assert.equal(id(),'your-details-heading','closed: opens and focuses');
 sharpen().focus();await reactAct(async()=>{sharpen().click()});assert.equal(id(),'your-details-heading','already open: focus still moves');
 await reactAct(async()=>{window.dispatchEvent(new (window as any).KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))});assert.equal(id(),'sharpen','Escape returns focus to the link');
 await reactAct(async()=>{gear().click()});assert.notEqual(id(),'your-details-heading','opening with the gear does not jump to Your details');
 await reactAct(async()=>{gear().focus();gear().click()});assert.equal(id(),'Treatable settings','closing with the gear keeps focus on the gear');
 await reactAct(async()=>{root.unmount()});
});
