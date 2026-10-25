/** AI-matched results: deterministic record checks plus provider relevance scores, merged into one card order.
 * Known mismatches from structured record fields (recruiting status, listed age range, listed sex) always sort last with a short
 * factual reason. Missing data is never a mismatch. Everything else sorts by the provider's 0-100 relevance score. */
import type{RankScore}from'../shared/rank-contract.mjs';
import{AGE_BANDS,type AgeBand}from'../shared/real-contract.mjs';
import{rankTerm,RANK_MAX_TERMS}from'../shared/rank-contract.mjs';
import{type CheckReason,type RankReasonId}from'./rank-labels';
export{REASON_TEXT,isReasonId,CHECK_REASONS,type CheckReason,type RankReasonId}from'./rank-labels';
/** The highest percentage a known mismatch can show. */
export const MISMATCH_PERCENT_CAP=10;
export interface StudyFacts{status?:string|null;minimumAge?:string|null;maximumAge?:string|null;sex?:string|null}
export interface CheckProfile{ageBand?:AgeBand;sex?:'female'|'male'}
// Statuses that mean the study is not taking participants. Recruiting, opening soon, by invitation, expanded access and unknown are not mismatches.
const NOT_RECRUITING=new Set(['ACTIVE_NOT_RECRUITING','COMPLETED','SUSPENDED','TERMINATED','WITHDRAWN','NO_LONGER_AVAILABLE','TEMPORARILY_NOT_AVAILABLE','APPROVED_FOR_MARKETING','WITHHELD']);
const BAND_YEARS:Record<AgeBand,[number,number]>={under_18:[0,17.999],'18_29':[18,29.999],'30_44':[30,44.999],'45_59':[45,59.999],'60_74':[60,74.999],'75_89':[75,89.999],'90_plus':[90,Infinity]};
const UNIT_PER_YEAR:Record<string,number>={Year:1,Years:1,Month:12,Months:12,Week:52.1775,Weeks:52.1775,Day:365.2425,Days:365.2425,Hour:8765.82,Hours:8765.82,Minute:525949.2,Minutes:525949.2};
/** A listed record age such as "18 Years" in years, or undefined when it is missing or not a recognised age. */
export function ageInYears(v:unknown){const m=typeof v==='string'?/^\s*([0-9]+(?:\.[0-9]+)?)\s+([A-Za-z]+)\s*$/.exec(v):null;if(!m||!UNIT_PER_YEAR[m[2]])return undefined;return Number(m[1])/UNIT_PER_YEAR[m[2]]}
/** Deterministic checks from structured record fields. Only a whole age band outside the listed range counts as outside it. */
export function recordChecks(facts:StudyFacts|undefined,profile:CheckProfile):CheckReason[]{
 if(!facts)return[];const out:CheckReason[]=[],status=typeof facts.status==='string'?facts.status.trim().toUpperCase():'';
 if(NOT_RECRUITING.has(status))out.push('not_recruiting');
 if(profile.ageBand&&AGE_BANDS.includes(profile.ageBand)){const[low,high]=BAND_YEARS[profile.ageBand],min=ageInYears(facts.minimumAge),max=ageInYears(facts.maximumAge);if(min!==undefined&&high<min||max!==undefined&&low>max)out.push('outside_age_range')}
 const listed=typeof facts.sex==='string'?facts.sex.trim().toUpperCase():'';if(profile.sex==='female'&&listed==='MALE'||profile.sex==='male'&&listed==='FEMALE')out.push('sex_mismatch');
 return out;
}
export interface RankedStudy{nctId:string;percent:number|null;reasonId:RankReasonId;checks:CheckReason[];score?:number;probabilities?:number[]}
/** Ranked order: known mismatches last, then higher relevance first, then the website's own order. A known mismatch shows a low
 * percentage: its relevance divided by ten, at most MISMATCH_PERCENT_CAP and never above the lowest scored study above it. */
export function mergeRanking(nctIds:readonly string[],checks:Readonly<Record<string,readonly CheckReason[]>>,scores?:readonly RankScore[]):RankedStudy[]{
 const byId=new Map((scores??[]).map(s=>[s.nctId,s]));
 const fits=nctIds.filter(id=>!(checks[id]?.length)).flatMap(id=>{const s=byId.get(id);return s?[s.score]:[]}),floor=fits.length?Math.min(...fits):MISMATCH_PERCENT_CAP;
 const rows=nctIds.map((nctId,index)=>{const found=checks[nctId]??[],s=byId.get(nctId),mismatch=found.length>0;
  const percent=mismatch?Math.min(MISMATCH_PERCENT_CAP,floor,Math.round((s?.score??0)/10)):s?s.score:null;
  const row:RankedStudy={nctId,percent,reasonId:mismatch?found[0]:s?s.reasonId:'not_scored',checks:[...found],...(s?{score:s.score}:{}),...(s?.probabilities?{probabilities:[...s.probabilities]}:{})};
  return{row,index,mismatch}});
 return rows.sort((a,b)=>Number(a.mismatch)-Number(b.mismatch)||(b.row.percent??-1)-(a.row.percent??-1)||a.index-b.index).map(x=>x.row);
}
/** The search condition box may hold several conditions separated by commas, semicolons or OR. */
export function searchConditionTerms(cond:unknown):string[]{return typeof cond==='string'?cond.split(/[,;]|\s+OR\s+/).flatMap(part=>{const t=rankTerm(part);return t?[t]:[]}):[]}
/** Short condition terms from the free-text "Your details" condition: comma, semicolon, line or "and" separated phrases of at most
 * six words. Phrases with long digit groups, age phrases, sentence words (I, my, have, since, call...) or any word of the person's
 * name are dropped, so narrative notes, dates, ZIP codes and names stay out. */
export function detailConditionTerms(condition:string,name=''):string[]{
 const split=(v:string)=>v.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean),letters=(v:string)=>v.toLocaleLowerCase('en-US').split(/[^\p{L}\p{M}]+/u).filter(w=>w.length>=2);
 const words=(v:string)=>[...split(v.toLocaleLowerCase('en-US')),...letters(v)].filter(w=>w.length>=2),nameWords=new Set(letters(name));
 // Sentence words (pronouns, common verbs, question words, contact, care-place and family words) mark narrative or personal text
 // rather than a condition name. ME, DID and WHO in capitals are abbreviations ("ME/CFS", "WHO grade 2 glioma"), unless the whole
 // phrase is shouted text. Titled names ("Dr Smith", "mr jones", "Ms Lee") are dropped; "relapsing MS" and "hospital-acquired" are not.
 const NARRATIVE=/^(?:i|me|my|mine|im|ive|we|us|our|he|him|his|she|her|they|them|their|you|your|am|is|are|was|were|be|been|being|have|has|had|do|does|did|feel|feeling|felt|since|because|why|what|when|where|who|how|nobody|someone|call|phone|email|mail|zip|address|born|age|aged|old|years?|months?|doctor|patient|clinic|hospital|husband|wife|son|daughter|mother|father|mom|dad)$/;
 const CAPS_ABBREVIATIONS=new Set(['ME','DID','WHO']),TITLED=/\b(?:dr|mr|mrs|miss|prof)\.?\s+\p{L}/iu,MS_TITLE=/\bMs\.?\s+\p{Lu}\p{Ll}/u;
 const narrative=(t:string)=>{const checked=t.replace(/hospital[-\s]acquired/giu,' '),list=split(checked),shouted=list.length>=3&&t===t.toLocaleUpperCase('en-US');return TITLED.test(t)||MS_TITLE.test(t)||list.some(w=>w==='I'||w.length>1&&!(!shouted&&CAPS_ABBREVIATIONS.has(w))&&NARRATIVE.test(w.toLocaleLowerCase('en-US')))};
 const out:string[]=[];for(const part of condition.split(/[,;\n\r]|\s+and\s+|\s+or\s+/i)){const t=rankTerm(part);if(!t||t.split(' ').length>6)continue;if(narrative(t)||words(t).some(w=>nameWords.has(w)))continue;if(!out.some(x=>x.toLocaleLowerCase('en-US')===t.toLocaleLowerCase('en-US')))out.push(t);if(out.length>=RANK_MAX_TERMS)break}
 return out;
}
/** The condition terms sent for ranking: the page's search condition first, then terms from Your details, at most six, no repeats. */
export function rankConditions(searchCond:unknown,detailTerms:readonly string[]=[]):string[]{
 const out:string[]=[];for(const t of [...searchConditionTerms(searchCond),...detailTerms.flatMap(x=>{const v=rankTerm(x);return v?[v]:[]})])if(!out.some(x=>x.toLocaleLowerCase('en-US')===t.toLocaleLowerCase('en-US'))&&out.length<RANK_MAX_TERMS)out.push(t);
 return out;
}
