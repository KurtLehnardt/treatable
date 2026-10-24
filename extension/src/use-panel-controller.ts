import {useRealAnalysis} from './use-real-analysis';
import {useEffect,useRef,useState} from 'react';
import {StudySchema,profileFromForm,searchStudies,parsePageSource,type Study,type PatientProfile,type ZipData,type PageSource,type Match} from './core';
import {parsePageReply} from './validation';
import {clearLegacyPatientData} from './storage';
import {LatestRun,DemoClient,type CleanupOutcome} from './native';
import {FAILURE_CODE,failureCodeOf,failureCopy} from './failures';
import {getDemoFixture} from '../shared/demo-fixtures.mjs';
import type {FixtureId,DemoTrace,ScoreResult,AgentResult} from '../shared/demo-contract.mjs';
const blankForm=()=>({condition:'',notes:'',age:'',sex:'prefer_not_to_say',zip:'',radius:'100'});
/** L7: how long a hidden panel keeps its session before clearing (see the visibility effect below). */
export const HIDDEN_GRACE_MS=120_000;
/** M2: how long End session keeps the transport open for a cancelled provider operation's result and cleanup reply. */
export const END_CLEANUP_MS=6_000;
/** Fixed copy for what the helper confirmed about provider cleanup when End session interrupted an operation. */
export const CLEANUP_COPY:Readonly<Record<CleanupOutcome,string>>=Object.freeze({
 none:'',
 deleted:'Provider session cleanup: delete request accepted; physical cleanup may continue asynchronously.',
 failed:'Provider session cleanup failed—provider state may remain.',
 stopped:'The helper confirmed the in-flight Decisions request stopped; it has no provider session to delete. Provider retention may still apply.',
 unconfirmed:'Provider session cleanup not confirmed—the helper did not report a deletion before the connection closed, so provider state may remain.',
});
/** Patient state lives only in this mounted panel. It is never handed to the demo bridge. */
export function usePanelController(){
 const[form,setForm]=useState(blankForm),[studies,setStudies]=useState<Study[]>([]),[zips,setZips]=useState<ZipData>({zips:{}}),[ready,setReady]=useState(false),[cleanupState,setCleanupState]=useState<'pending'|'ready'|'failed'>('pending'),[error,setError]=useState(''),[profile,setProfile]=useState<PatientProfile>(),[matches,setMatches]=useState<Match[]>([]),[source,setSource]=useState<PageSource>(),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[restart,setRestart]=useState(0),[ending,setEnding]=useState(false);
 const runs=useRef(new LatestRun()),alive=useRef(true),sessionRevision=useRef(0),demoRuns=useRef(new LatestRun()),client=useRef<DemoClient>(),demoAbort=useRef<AbortController>(),hiddenTimer=useRef<ReturnType<typeof setTimeout>>(),hiddenEndDue=useRef(false),sessionEnded=useRef(false),endNow=useRef<()=>void>(()=>{});
 if(!client.current)client.current=new DemoClient(chrome.runtime);
 const real=useRealAnalysis(client.current,ready);
 const[fixtureId,setFixtureId]=useState<FixtureId>('fibromyalgia'),[consent,setConsent]=useState(false),[demoBusy,setDemoBusy]=useState(false),[demoStatus,setDemoStatus]=useState('API setup not checked.'),[trace,setTrace]=useState<DemoTrace[]>([]),[scores,setScores]=useState<ScoreResult>(),[agent,setAgent]=useState<AgentResult>(),[demoError,setDemoError]=useState(''),[demoFailure,setDemoFailure]=useState('');
 const cancel=()=>{runs.current.cancel();setBusy(false)};
 useEffect(()=>{let mounted=true;sessionEnded.current=false;const bootstrapRevision=++sessionRevision.current;const current=()=>mounted&&sessionRevision.current===bootstrapRevision;alive.current=true;setReady(false);setCleanupState('pending');void(async()=>{try{await clearLegacyPatientData(chrome.storage?.session,chrome.storage?.local);if(!current())return;setCleanupState('ready');await client.current!.open(code=>clearEverything(code));if(!current())return;const[records,postal]=await Promise.all([fetch(chrome.runtime.getURL('data/studies.json')).then(r=>r.json()),fetch(chrome.runtime.getURL('data/us-zip-centroids.json')).then(r=>r.json())]);if(!current())return;setStudies(records.map((v:unknown)=>StudySchema.parse(v)));setZips(postal);setReady(true);setError('')}catch{if(current()){setCleanupState('failed');setError('Cleanup or offline data loading did not finish. Patient entry remains blocked. Retry below.')}}})();return()=>{mounted=false;++sessionRevision.current;alive.current=false;runs.current.cancel();demoRuns.current.cancel();demoAbort.current?.abort();client.current?.disconnect()};},[restart]);
 endNow.current=()=>clearEverything();
 function stopHiddenTimer(){if(hiddenTimer.current!==undefined)clearTimeout(hiddenTimer.current);hiddenTimer.current=undefined;hiddenEndDue.current=false}
 /* L7 trade-off. Every panel link (Open source ↗, NCT links in results, privacy-notice links) opens a tab and hides this
  * panel; clearing on every hide wiped profile, consent and results mid-task. pagehide, End session, Chrome panel close and
  * the background's endSession still clear immediately. A hidden panel instead gets HIDDEN_GRACE_MS: becoming visible again
  * cancels the timer, and it clears only if the panel is still hidden when it fires. Hiding never aborts an operation: if
  * one is still in flight when the timer fires, clearing waits until it settles (each is bounded by the 150 s native
  * timeout, which itself ends the session). Cost: a hidden panel keeps this session's inputs in memory for up to two
  * minutes, longer only while an API operation finishes. */
 useEffect(()=>{const doc=typeof document!=='undefined'?document:undefined,win=typeof window!=='undefined'?window:undefined;
  const pagehide=()=>{stopHiddenTimer();endNow.current()};
  const visibility=()=>{if(doc?.visibilityState!=='hidden'){stopHiddenTimer();return}if(hiddenTimer.current!==undefined||hiddenEndDue.current||sessionEnded.current)return;hiddenTimer.current=setTimeout(()=>{hiddenTimer.current=undefined;if(doc?.visibilityState!=='hidden'||sessionEnded.current)return;if(client.current?.hasProviderOperation()){hiddenEndDue.current=true;return}endNow.current()},HIDDEN_GRACE_MS)};
  win?.addEventListener('pagehide',pagehide);doc?.addEventListener('visibilitychange',visibility);
  return()=>{stopHiddenTimer();win?.removeEventListener('pagehide',pagehide);doc?.removeEventListener('visibilitychange',visibility)}},[]);
 // A grace period that expired during an API operation clears once that operation settles, if the panel is still hidden.
 useEffect(()=>{if(!hiddenEndDue.current||demoBusy||real.busy||client.current?.hasProviderOperation())return;hiddenEndDue.current=false;if(typeof document!=='undefined'&&document.visibilityState==='hidden')clearEverything()},[demoBusy,real.busy]);
 function edit(key:keyof ReturnType<typeof blankForm>,value:string){if(!ready)return;real.invalidate();cancel();setForm(v=>({...v,[key]:value}));setProfile(undefined);setMatches([]);setSource(undefined);setNotice('Search again to apply your changes.');setError('')}
 function applySearch(){if(!ready){setError('Finish legacy data cleanup before entering patient details.');return undefined}try{cancel();const p=profileFromForm(form,zips);setProfile(p);setMatches(searchStudies(studies,p));setSource(undefined);setError('');setNotice('Screened locally against the shipped study snapshot. Nothing from this profile was sent to an API.');return p}catch{setError('Check the condition or symptoms, age (0–120), ZIP, and listed options. No patient details were sent.');return undefined}}
 async function analyzePage(){if(!ready)return;const p=profile||applySearch();if(!p)return;cancel();const token=runs.current.start();setBusy(true);setError('');setNotice('Reading the current ClinicalTrials.gov page locally…');try{const reply=await chrome.runtime.sendMessage({kind:'readPage'});if(!alive.current||!runs.current.isCurrent(token))return;const s=parsePageSource(parsePageReply(reply));setSource(s);const record=s.nctId?studies.find(v=>v.id===s.nctId):undefined;if(record){const hit=searchStudies([record],p,1)[0]||{study:record,relevance:0,screen:(await import('../../scaffold/lib/eligibility/hardFilters')).screenStudy(record,p)};if(!alive.current||!runs.current.isCurrent(token))return;setMatches([hit]);setNotice('NCT ID found in the offline snapshot. Confirm current details with the study team.')}else{setMatches([]);setNotice('Page captured locally. Eligibility remains unknown because this record is outside the shipped snapshot.')}}catch{if(alive.current&&runs.current.isCurrent(token)){setError('The page could not be safely read. Open a supported ClinicalTrials.gov study page and retry.');setNotice('')}}finally{if(alive.current&&runs.current.isCurrent(token))setBusy(false)}}
 function clearEverything(reason?:unknown){resetSession(reason,false)}
 /** Clears all panel state at once. Aborting signals asks the helper to cancel; keepTransport (End session only) leaves the
  * port open so the caller can wait, bounded, for cleanup replies before disconnecting. */
 function resetSession(reason:unknown,keepTransport:boolean){const code=typeof reason==='string'&&FAILURE_CODE.test(reason)?reason:undefined;sessionEnded.current=true;stopHiddenTimer();real.clear();++sessionRevision.current;cancel();demoRuns.current.cancel();demoAbort.current?.abort();demoAbort.current=undefined;if(!keepTransport)client.current?.disconnect();setEnding(false);setReady(false);setFixtureId('fibromyalgia');setConsent(false);setTrace([]);setScores(undefined);setAgent(undefined);setDemoBusy(false);setDemoError('');setDemoFailure('');setDemoStatus('API setup not checked.');setForm(blankForm());setProfile(undefined);setMatches([]);setSource(undefined);setError('');setNotice(`${code?`Session ended (${code}). ${failureCopy(code)} `:'Session ended. '}Panel inputs and results were cleared. Start a blank session to continue. This does not guarantee forensic memory erasure.`)}
 /** M2: End session. Panel data clears immediately either way. If a provider operation is in flight, the helper is asked to
  * cancel and the port stays open, at most END_CLEANUP_MS, for that operation's result reply so the helper is not killed
  * before deleting a provider Agents session; the notice then reports the confirmed cleanup outcome or that it was not
  * confirmed. pagehide cannot wait and stays immediate (clearEverything). */
 function endSession(){const c=client.current;if(!c?.hasProviderOperation()){clearEverything();return}resetSession(undefined,true);const revision=sessionRevision.current;setEnding(true);setNotice('Ending… cleaning up provider session. Panel inputs and results were already cleared.');void c.drain(END_CLEANUP_MS).then(outcome=>{if(!alive.current||revision!==sessionRevision.current)return;setEnding(false);setNotice(`Session ended. ${CLEANUP_COPY[outcome]?CLEANUP_COPY[outcome]+' ':''}Panel inputs and results were cleared. Start a blank session to continue. This does not guarantee forensic memory erasure.`)})}
 function retryCleanup(){if(ending)return;clearEverything();setRestart(v=>v+1)}
 async function checkApi(){if(!ready)return;const revision=sessionRevision.current;setDemoFailure('');try{const status=await client.current!.status();if(alive.current&&revision===sessionRevision.current)setDemoStatus(status.message)}catch(failure){if(alive.current&&revision===sessionRevision.current){const code=failureCodeOf(failure);setDemoFailure(code);setDemoStatus(failureCopy(code))}}}
 function selectFixture(id:FixtureId){if(!ready||demoBusy)return;getDemoFixture(id);setFixtureId(id);setConsent(false);setTrace([]);setScores(undefined);setAgent(undefined);setDemoError('');setDemoFailure('')}
 function approveDemo(value:boolean){if(ready&&!demoBusy)setConsent(value)}
 async function runDemo(type:'scoreDemo'|'agentDemo'){if(!ready||!consent||demoBusy||real.busy)return;const chosen=fixtureId;getDemoFixture(chosen);const token=demoRuns.current.start(),controller=new AbortController();demoAbort.current=controller;setDemoBusy(true);setDemoError('');setDemoFailure('');// Independent operations: each run replaces only its own result; the bounded trace keeps both runs' stages.
 if(type==='scoreDemo')setScores(undefined);else setAgent(undefined);try{const result=await client.current!.run(type,chosen,true,item=>{if(alive.current&&demoRuns.current.isCurrent(token))setTrace(previous=>[...previous,item].slice(-100))},controller.signal);if(!alive.current||!demoRuns.current.isCurrent(token))return;if(result.kind==='scoreDemo')setScores(result);else setAgent(result)}catch(failure){if(alive.current&&demoRuns.current.isCurrent(token)){const code=failureCodeOf(failure);setDemoFailure(code);setDemoError(controller.signal.aborted?'Cancellation was requested. Provider cleanup may be incomplete; inspect the trace.':failureCopy(code))}}finally{if(alive.current&&demoRuns.current.isCurrent(token)){demoAbort.current=undefined;setDemoBusy(false)}}}
 function cancelDemo(){demoAbort.current?.abort();setDemoError('Cancellation requested; waiting for the native cleanup attempt. End session waits up to 6 seconds for that cleanup, then disconnects.')}
 return{real,fixtureId,consent,demoBusy,demoStatus,trace,scores,agent,demoError,demoFailure,checkApi,selectFixture,approveDemo,runDemo,cancelDemo,form,studies,ready,cleanupState,error,profile,matches,source,busy,notice,rows:matches,edit,applySearch,analyzePage,clearEverything,endSession,ending,cancel,retryCleanup,setNotice};
}
export type PanelController=ReturnType<typeof usePanelController>;
