/** The AI-matched results status the background posts to the overlay. Built by the background and validated again on arrival. */
import{isReasonId,CHECK_REASONS,type CheckReason,type RankReasonId}from'./rank-merge';
import{AGE_BANDS}from'../shared/real-contract.mjs';
export type RankingPhase='checking'|'preparing'|'confirming'|'scoring'|'done'|'off'|'unavailable';
/** Why ranking used record checks only, or could not run at all. */
export type RankingNote='no_condition'|'too_many'|'no_cards'|'declined';
export interface RankingStudyView{nctId:string;title:string;percent:number|null;reasonId:RankReasonId;checks:CheckReason[];score?:number;probabilities?:number[]}
export interface RankingTraceBody{text:string;bytes:number;truncated:boolean}
export interface RankingState{phase:RankingPhase;total?:number;studies?:RankingStudyView[];applied?:boolean;provider?:'openai'|'local'|'none';mode?:'live'|'test';failure?:string;note?:RankingNote;request?:RankingTraceBody;profile?:{conditions:string[];ageBand?:string;sex?:string}}
const PHASES:readonly RankingPhase[]=['checking','preparing','confirming','scoring','done','off','unavailable'];
const NOTES:readonly RankingNote[]=['no_condition','too_many','no_cards','declined'];
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const only=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).every(k=>keys.includes(k));
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max;
function study(v:unknown):RankingStudyView|undefined{
 if(!record(v)||!only(v,['nctId','title','percent','reasonId','checks','score','probabilities'])||typeof v.nctId!=='string'||!/^NCT[0-9]{8}$/.test(v.nctId)||!text(v.title,1000)||!(v.percent===null||Number.isInteger(v.percent)&&(v.percent as number)>=0&&(v.percent as number)<=100)||!isReasonId(v.reasonId)||!Array.isArray(v.checks)||v.checks.some(c=>!CHECK_REASONS.includes(c as CheckReason)))return;
 if(v.score!==undefined&&!(Number.isInteger(v.score)&&(v.score as number)>=0&&(v.score as number)<=100))return;
 if(v.probabilities!==undefined&&!(Array.isArray(v.probabilities)&&v.probabilities.length===4&&v.probabilities.every(p=>typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1)))return;
 return{nctId:v.nctId,title:v.title as string,percent:v.percent as number|null,reasonId:v.reasonId,checks:[...v.checks as CheckReason[]],...(v.score!==undefined?{score:v.score as number}:{}),...(v.probabilities?{probabilities:[...v.probabilities as number[]]}:{})};
}
/** Strict parse of a posted status; anything unexpected is dropped as a whole. */
export function parseRankingState(v:unknown):RankingState|undefined{
 if(!record(v)||!only(v,['phase','total','studies','applied','provider','mode','failure','note','request','profile'])||!PHASES.includes(v.phase as RankingPhase))return;
 const out:RankingState={phase:v.phase as RankingPhase};
 if(v.total!==undefined){if(!Number.isInteger(v.total)||(v.total as number)<0||(v.total as number)>100)return;out.total=v.total as number}
 if(v.studies!==undefined){if(!Array.isArray(v.studies)||v.studies.length>10)return;const list=v.studies.map(study);if(list.some(x=>!x)||new Set(list.map(x=>x!.nctId)).size!==list.length)return;out.studies=list as RankingStudyView[]}
 if(v.applied!==undefined){if(typeof v.applied!=='boolean')return;out.applied=v.applied}
 if(v.provider!==undefined){if(!['openai','local','none'].includes(v.provider as string))return;out.provider=v.provider as RankingState['provider']}
 if(v.mode!==undefined){if(!['live','test'].includes(v.mode as string))return;out.mode=v.mode as 'live'|'test'}
 if(v.failure!==undefined){if(typeof v.failure!=='string'||!/^[A-Z_]{1,40}$/.test(v.failure))return;out.failure=v.failure}
 if(v.note!==undefined){if(!NOTES.includes(v.note as RankingNote))return;out.note=v.note as RankingNote}
 if(v.request!==undefined){const r=v.request;if(!record(r)||!only(r,['text','bytes','truncated'])||!text(r.text,100_000)||!Number.isSafeInteger(r.bytes)||typeof r.truncated!=='boolean')return;out.request={text:r.text as string,bytes:r.bytes as number,truncated:r.truncated}}
 if(v.profile!==undefined){const p=v.profile;if(!record(p)||!only(p,['conditions','ageBand','sex'])||!Array.isArray(p.conditions)||p.conditions.length>6||p.conditions.some(c=>!text(c,80))||p.ageBand!==undefined&&!AGE_BANDS.includes(p.ageBand as never)||p.sex!==undefined&&!['female','male'].includes(p.sex as string))return;out.profile={conditions:[...p.conditions as string[]],...(p.ageBand?{ageBand:p.ageBand as string}:{}),...(p.sex?{sex:p.sex as string}:{})}}
 return out;
}
