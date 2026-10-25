import React from 'react';
import {trialUrl} from './core';
import {failureCopy} from './failures';
import {REASON_TEXT} from './rank-merge';
import {RANK_LEVELS} from '../shared/rank-contract.mjs';
import type {RankingState,RankingStudyView} from './rank-state';
import type {AiRanking} from './ui-prefs';
const ageText=(v:string)=>v==='90_plus'?'90 or older':v==='under_18'?'Under 18':v.replace('_','–');
/** Shares in tenths of a percent that add up to exactly 100 (largest remainder). */
export function levelShares(p:readonly number[]):string[]{
 const total=p.reduce((a,b)=>a+b,0)||1,raw=p.map(v=>v/total*1000),tenths=raw.map(Math.floor);let left=1000-tenths.reduce((a,b)=>a+b,0);
 for(const i of raw.map((_,i)=>i).sort((a,b)=>(raw[b]-Math.floor(raw[b]))-(raw[a]-Math.floor(raw[a]))||a-b)){if(left<=0)break;tenths[i]++;left--}
 return tenths.map(t=>`${(t/10).toFixed(1)}%`);
}
function Progress({state,waiting}:{state?:RankingState;waiting?:'intro'|'page'}){
 const n=state?.total;
 const text=!state?waiting==='intro'?'Ranking starts once the intro tour is finished or skipped.':waiting==='page'?'Open ClinicalTrials.gov search results in card view to rank them.':'Getting ready to rank the studies on this page.':state.phase==='checking'?(n?`Checking the ${n} studies on this page.`:'Checking the studies on this page.'):state.phase==='preparing'?'Loading the public study records.':state.phase==='confirming'?'Waiting for your answer in the Treatable confirmation window.':state.phase==='scoring'?'Scoring how relevant each study is.':'';
 return text?<p role="status" className="notice">{text}</p>:null;
}
function Summary({state,again}:{state:RankingState;again:(force:boolean)=>void}){
 const n=state.studies?.length??0;
 if(state.phase==='unavailable')return <p role="status" className="notice">{state.note==='too_many'?`This page shows ${state.total} studies. Set ClinicalTrials.gov to show 10 studies per page to rank them.`:state.note==='no_cards'?'There are no result cards to rank on this page.':'Ranking could not run on this page. The website keeps its own order.'}</p>;
 if(state.applied===false)return <><p role="status" className="notice">The website’s original order is shown.</p><div className="button-row"><button type="button" onClick={()=>again(false)}>Apply the ranking again</button></div></>;
 if(state.failure&&state.failure!=='CONFIRMATION_CANCELLED')return <><p role="status" className="notice">AI scoring did not run, so record checks set the order: studies that clearly do not fit moved to the end. <span className="fine">{failureCopy(state.failure)} <code>{state.failure}</code></span></p><div className="button-row"><button type="button" onClick={()=>again(true)}>Try AI ranking again</button></div></>;
 if(state.note==='declined')return <><p role="status" className="notice">AI ranking is paused until you allow it. Record checks moved studies that clearly do not fit to the end.</p><div className="button-row"><button type="button" onClick={()=>again(true)}>Review and allow AI ranking</button></div></>;
 if(state.note==='no_condition')return <p role="status" className="notice">Search for a condition, or add condition terms in Settings → Your details, to rank by relevance. Record checks moved studies that clearly do not fit to the end.</p>;
 return <p role="status" className="ranking-summary">{`Ranked ${n} ${n===1?'study':'studies'}: best matches first, studies that clearly do not fit last.`}</p>;
}
function Study({study}:{study:RankingStudyView}){
 const extra=study.checks.slice(1).map(c=>REASON_TEXT[c]);
 return <li className={study.checks.length?'is-mismatch':undefined}><span className="rank-percent"><span aria-hidden="true">{study.percent===null?'–':`${study.percent}%`}</span><span className="sr-only">{study.percent===null?'Not scored':`${study.percent}% match`}</span></span><div><a href={trialUrl(`https://clinicaltrials.gov/study/${study.nctId}`)} target="_blank" rel="noopener noreferrer">{study.title||study.nctId}</a><span className="study-id">{study.nctId}</span><span className="rank-reason">{[REASON_TEXT[study.reasonId],...extra].join(' · ')}</span></div></li>;
}
/** How the ranking was produced: provider and test or live label, what was sent, the exact request body and each study's score. */
function HowRanked({state}:{state:RankingState}){
 const studies=state.studies??[];
 return <details className="brief-how ranking-how"><summary>How this was ranked</summary>
  <p>{state.provider==='none'||!state.provider?'No AI scoring ran for this page.':!state.mode?'The request below was sent or may have been sent, but no valid scores came back.':state.provider==='local'?'Scored by a local model on this device. Nothing was sent to OpenAI.':state.mode==='test'?'Test run: a mocked adapter produced these scores. Nothing was sent to OpenAI.':'Live OpenAI Decisions result.'}</p>
  <p>Recruiting status, the listed age range and the listed sex were checked inside Treatable from the public records.</p>
  {state.profile&&(state.provider==='local'?<p>{`Given to the local model on this device: condition terms ${state.profile.conditions.join(', ')}, and the public records of these studies. Age band and sex were used only for the record checks.`}</p>:<p>{`Sent for scoring: condition terms ${state.profile.conditions.join(', ')}`}{state.profile.ageBand?`; age band ${ageText(state.profile.ageBand)}`:''}{state.profile.sex?`; sex ${state.profile.sex}`:''}{'; and the public records of these studies.'}</p>)}
  {state.request&&<details className="trace-body"><summary>{state.provider==='local'?'Local model request body':'Decisions API request body'} <span className="fine">{`(${state.request.bytes} bytes)`}</span></summary>{state.request.truncated&&<p className="notice" role="note">Shortened for display. The request itself was not shortened.</p>}<pre className="trace-json" tabIndex={0} role="region" aria-label="Ranking request body">{state.request.text}</pre></details>}
  {studies.some(s=>s.score!==undefined)&&<><h4>Scores returned</h4><ol className="trace-decisions">{studies.map(s=><li key={s.nctId} className="trace-decision"><p><span className="study-id">{s.nctId}</span> {s.score===undefined?'Not scored':`Relevance score ${s.score} of 100`}{s.checks.length?` · shown as ${s.percent}% because: ${s.checks.map(c=>REASON_TEXT[c]).join(', ')}`:''}</p>
   {s.probabilities&&<ul className="trace-probabilities" aria-label="Probability of each relevance level">{levelShares(s.probabilities).map((share,i)=><li key={i} className="trace-probability"><span>{RANK_LEVELS[i]}</span><span className="trace-bar" aria-hidden="true"><span style={{width:share}}/></span><strong>{share}</strong></li>)}</ul>}</li>)}</ol></>}
 </details>;
}
export interface RankingSectionModel{aiRanking:AiRanking;ranking?:RankingState;waiting?:'intro'|'page';connected:boolean;busy:boolean;setAiRanking:(value:AiRanking)=>void;restore:()=>void;again:(force:boolean)=>void}
/** AI-matched results on a ClinicalTrials.gov results page. The cards on the page are reordered and badged by the background. */
export function RankingSection({vm}:{vm:RankingSectionModel}){
 const state=vm.ranking,busy=!!state&&['checking','preparing','confirming','scoring'].includes(state.phase);
 return <section className="page-results ai-ranking" aria-labelledby="ai-ranking-heading"><div className="section-intro"><span className="eyebrow">AI-matched results</span><h2 id="ai-ranking-heading">Studies on this page, best matches first</h2></div>
  {!vm.connected?<p className="notice">AI-matched results start once Treatable is connected to a ClinicalTrials.gov results page.</p>:vm.aiRanking==='off'?<><p className="notice">AI-matched results are off, so the website keeps its own order and no match percentages are shown.</p><div className="button-row"><button type="button" disabled={!vm.connected} onClick={()=>vm.setAiRanking('on')}>Turn on AI-matched results</button></div></>:<>
   {(busy||!state)&&<Progress state={state} waiting={vm.waiting}/>}
   {state&&!busy&&state.phase!=='off'&&<Summary state={state} again={vm.again}/>}
   {state?.phase==='done'&&state.applied!==false&&!!state.studies?.length&&<><ol className="ranking-list">{state.studies.map(s=><Study key={s.nctId} study={s}/>)}</ol><div className="button-row"><button type="button" className="quiet" disabled={!vm.connected||vm.busy} onClick={vm.restore}>Restore original order</button></div></>}
   {state?.phase==='done'&&<HowRanked state={state}/>}
  </>}
 </section>;
}
