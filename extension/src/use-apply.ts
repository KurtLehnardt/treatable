import{useEffect,useMemo,useRef,useState}from'react';
import{ApplyClient,type ApplyRuntime}from'./apply-client';
import{buildApplyPlan,buildFollowUpIcs,blankPatient,type ApplyPatient,type ApplyPlan}from'./apply-plan';
import{resolveLocalZip,type LocalOrigin}from'./local-distance';
import{failureCodeOf}from'./failures';
import type{ZipData}from'./core';
import{copyText,downloadText}from'./apply-io';
import type{PreparedApply,ApplyResult,ApplyRecord,ApplyPrescreenId}from'../shared/apply-contract.mjs';
export interface ApplyEnv{runtime:ApplyRuntime;loadZips:()=>Promise<ZipData>;userActivated:()=>boolean;today:()=>Date;now:()=>number;copyText:(text:string)=>Promise<void>;download:(name:string,text:string,type:string)=>void}
export function browserApplyEnv():ApplyEnv{return{runtime:chrome.runtime,
 loadZips:async()=>{const r=await fetch(chrome.runtime.getURL('data/us-zip-centroids.json'));if(!r.ok)throw Error();return r.json()},
 // Transient activation cannot be granted by page scripts: they cannot dispatch trusted input into this extension frame.
 userActivated:()=>typeof navigator!=='undefined'&&navigator.userActivation?.isActive===true,
 today:()=>new Date(),now:()=>Date.now(),
 copyText,download:downloadText}}
export type ApplyPhase='connecting'|'loading'|'ready'|'ended';
export interface ApplyController{phase:ApplyPhase;nctId:string;record?:ApplyRecord;recordSource?:'helper'|'official';prepared?:PreparedApply;preview?:PreparedApply['preview'];prepareCode?:string;recordCode?:string;agent?:ApplyResult;agentBusy:boolean;agentCode?:string;patient:ApplyPatient;zipNote:string;siteId?:string;plan?:ApplyPlan;copied:''|'copied'|'failed';reminder:''|'saved'|'failed';
 edit:(field:keyof Omit<ApplyPatient,'answers'>,value:string)=>void;answer:(id:ApplyPrescreenId,value:string)=>void;chooseSite:(id?:string)=>void;requestReview:()=>void;prepareAgain:()=>void;copyEmail:()=>void;saveReminder:()=>void;end:()=>void}
export function useApply(nctId:string,env:ApplyEnv=browserApplyEnv(),onEnded?:()=>void):ApplyController{
 const client=useRef<ApplyClient>(),alive=useRef(true),zips=useRef<Promise<ZipData>>(),preparedRef=useRef<PreparedApply>(),zipRev=useRef(0);
 const[phase,setPhase]=useState<ApplyPhase>('connecting'),[record,setRecord]=useState<ApplyRecord>(),[recordSource,setRecordSource]=useState<'helper'|'official'>(),[prepared,setPreparedState]=useState<PreparedApply>(),[prepareCode,setPrepareCode]=useState<string>(),[recordCode,setRecordCode]=useState<string>(),[agent,setAgent]=useState<ApplyResult>(),[agentBusy,setAgentBusy]=useState(false),[agentCode,setAgentCode]=useState<string>(),[patient,setPatient]=useState<ApplyPatient>(blankPatient),[origin,setOrigin]=useState<LocalOrigin>(),[zipNote,setZipNote]=useState(''),[siteId,setSiteId]=useState<string>(),[copied,setCopied]=useState<''|'copied'|'failed'>(''),[reminder,setReminder]=useState<''|'saved'|'failed'>(''),[preview,setPreview]=useState<PreparedApply['preview']>();
 const setPrepared=(v?:PreparedApply)=>{preparedRef.current=v;setPreparedState(v);if(v)setPreview(v.preview)};
 function clearAll(){preparedRef.current=undefined;setPreparedState(undefined);setPreview(undefined);setRecord(undefined);setRecordSource(undefined);setAgent(undefined);setAgentBusy(false);setAgentCode(undefined);setPrepareCode(undefined);setRecordCode(undefined);setPatient(blankPatient());setOrigin(undefined);setZipNote('');setSiteId(undefined);setCopied('');setReminder('')}
 function shutdown(){const c=client.current;client.current=undefined;if(c){if(preparedRef.current)void c.revoke().catch(()=>{});c.disconnect()}preparedRef.current=undefined}
 async function load(c:ApplyClient){
  try{const p=await c.prepare(nctId);if(!alive.current||client.current!==c)return;setPrepared(p);setRecord(p.record);setRecordSource('helper');setPrepareCode(undefined)}
  catch(error){if(!alive.current||client.current!==c)return;setPrepareCode(failureCodeOf(error));
   // Native helper missing or failed: the background's own official-API fetch still gives a full local contact plan.
   try{const r=await c.record(nctId);if(!alive.current||client.current!==c)return;setRecord(r);setRecordSource('official')}catch(e){if(alive.current&&client.current===c)setRecordCode(failureCodeOf(e))}}
  if(alive.current&&client.current===c)setPhase('ready')}
 useEffect(()=>{alive.current=true;const c=new ApplyClient(env.runtime);client.current=c;
  void c.open(()=>{if(!alive.current||client.current!==c)return;client.current=undefined;preparedRef.current=undefined;clearAll();setPhase('ended');onEnded?.()}).then(id=>{if(!alive.current||client.current!==c)return;if(id!==nctId){setPrepareCode('NOT_STUDY_PAGE');setPhase('ready');return}setPhase('loading');return load(c)}).catch(e=>{if(!alive.current||client.current!==c)return;setPrepareCode(failureCodeOf(e));setPhase('ready')});
  return()=>{alive.current=false;shutdown()}},[nctId]);
 // ZIP stays in this frame: resolved against the bundled offline centroids, never sent anywhere.
 useEffect(()=>{const zip=patient.zip.trim(),rev=++zipRev.current;if(!zip){setOrigin(undefined);setZipNote('');return}if(!/^[0-9]{5}(?:-[0-9]{4})?$/.test(zip)){setOrigin(undefined);setZipNote(zip.length>=5?'Enter a 5-digit US ZIP code.':'');return}
  zips.current??=env.loadZips();zips.current.then(data=>{if(!alive.current||zipRev.current!==rev)return;try{setOrigin(resolveLocalZip(zip,data));setZipNote('')}catch{setOrigin(undefined);setZipNote('That ZIP code is not in Treatable’s offline list. Choose a site below instead.')}},()=>{zips.current=undefined;if(alive.current&&zipRev.current===rev){setOrigin(undefined);setZipNote('Offline ZIP data is unavailable. Choose a site below instead.')}})},[patient.zip]);
 const plan=useMemo(()=>record?buildApplyPlan({record,patient,origin,siteId,agent,today:env.today()}):undefined,[record,patient,origin,siteId,agent]);
 const reset=()=>{setCopied('');setReminder('')};
 return{phase,nctId,record,recordSource,prepared,preview,prepareCode,recordCode,agent,agentBusy,agentCode,patient,zipNote,siteId,plan,copied,reminder,
  edit:(field,value)=>{reset();setPatient(old=>({...old,[field]:value}))},
  answer:(id,value)=>{reset();setPatient(old=>({...old,answers:{...old.answers,[id]:value}}))},
  chooseSite:id=>{reset();setSiteId(id)},
  requestReview:()=>{const c=client.current,p=preparedRef.current;if(!c||!p||agentBusy)return;
   // Explicit user action only: the click must carry transient user activation inside this extension frame.
   if(!env.userActivated()){setAgentCode('USER_ACTIVATION_REQUIRED');return}
   if(p.expiresAt<=env.now()){setPrepared(undefined);setAgentCode('APPLY_EXPIRED');return}
   setAgentBusy(true);setAgentCode(undefined);preparedRef.current=undefined;
   void c.execute(p).then(result=>{if(!alive.current||client.current!==c)return;setAgent(result);setPreparedState(undefined)}).catch(e=>{if(!alive.current||client.current!==c)return;setPreparedState(undefined);setAgentCode(failureCodeOf(e))}).finally(()=>{if(alive.current&&client.current===c)setAgentBusy(false)})},
  prepareAgain:()=>{const c=client.current;if(!c||agentBusy)return;setAgentBusy(true);setAgentCode(undefined);void c.prepare(nctId).then(p=>{if(!alive.current||client.current!==c)return;setPrepared(p);setRecord(p.record);setRecordSource('helper');setPrepareCode(undefined)}).catch(e=>{if(alive.current&&client.current===c)setAgentCode(failureCodeOf(e))}).finally(()=>{if(alive.current&&client.current===c)setAgentBusy(false)})},
  copyEmail:()=>{if(!plan||plan.missing.length)return;const text=[plan.primary?.email?`To: ${plan.primary.email}`:'',`Subject: ${plan.subject}`,'',plan.body].filter((v,i)=>v||i>1).join('\n');void env.copyText(text).then(()=>{if(alive.current)setCopied('copied')},()=>{if(alive.current)setCopied('failed')})},
  saveReminder:()=>{if(!plan)return;try{env.download(`treatable-follow-up-${plan.nctId}.ics`,buildFollowUpIcs(plan,env.now()),'text/calendar');setReminder('saved')}catch{setReminder('failed')}},
  end:()=>{shutdown();clearAll();setPhase('ended');onEnded?.()}};
}
