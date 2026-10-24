// Local-model backend for AI result ranking: the input and output shapes the ranking operation uses, validated strictly.
// Input: a minimized profile (public condition terms from the page search, optional age band, sex and US state) and 1–10 public study
// records. Only the condition terms and the public records reach the local model; age, sex, state and recruitment checks are deterministic
// and stay outside the model. Output per study: a 0–100 relevance score and one reason ID from the fixed catalog below, or a failure
// code. A local model reports no probabilities, so none are returned or invented.
import{exactKeys,isRecord,utf8Bytes}from'./demo-contract.mjs';
import{AGE_BANDS,US_STATES}from'./real-contract.mjs';
import{isLocalModelName}from'./local-model.mjs';
export const RANK_MAX_STUDIES=10;
// Why a study got its score. Rendered only from this table; the model returns the ID.
export const RANK_REASONS=Object.freeze({
 condition_match:'The study is about the condition you searched for.',
 related_condition:'The study is about a closely related condition.',
 symptom_focus:'The study targets symptoms or effects of the condition you searched for.',
 broad_population:'The study enrolls a broad group that may include people with your condition.',
 different_condition:'The study is mainly about a different condition.',
 healthy_volunteers:'The study is looking for healthy volunteers.',
 insufficient_information:'The public record has too little information to judge relevance.'});
// Deterministic plausibility: a reason that says the study is about the searched condition cannot carry a low score, and a reason that
// says it is not cannot carry a high one. Anything else is refused as inconsistent output.
export const RANK_REASON_SCORE_BOUNDS=Object.freeze({condition_match:[50,100],related_condition:[25,95],symptom_focus:[25,95],broad_population:[10,80],different_condition:[0,45],healthy_volunteers:[0,45],insufficient_information:[0,60]});
const NCT=/^NCT[0-9]{8}$/;
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v);
export function parseRankingProfile(v){
 if(!exactKeys(v,['conditions','ageBand','sex','state'])||!Array.isArray(v.conditions)||!v.conditions.length||v.conditions.length>6||v.conditions.some(c=>!text(c,120)||!c.trim())||new Set(v.conditions).size!==v.conditions.length)throw Error('Invalid ranking profile');
 if(v.ageBand!==undefined&&!AGE_BANDS.includes(v.ageBand)||v.sex!==undefined&&!['female','male','other','prefer_not_to_say'].includes(v.sex)||v.state!==undefined&&!US_STATES.includes(v.state))throw Error('Invalid optional ranking profile field');
 return v;
}
export function parseRankingStudies(v){
 if(!Array.isArray(v)||!v.length||v.length>RANK_MAX_STUDIES)throw Error('Rank one to ten public studies');
 for(const s of v)if(!exactKeys(s,['nctId','title','conditions','summary','criteria'])||typeof s.nctId!=='string'||!NCT.test(s.nctId)||!text(s.title,1000)||!Array.isArray(s.conditions)||s.conditions.length>10||s.conditions.some(c=>!text(c,200))||s.summary!==undefined&&s.summary!==null&&!text(s.summary,6000)||s.criteria!==undefined&&s.criteria!==null&&!text(s.criteria,6000))throw Error('Invalid public study record');
 if(new Set(v.map(s=>s.nctId)).size!==v.length)throw Error('Duplicate study');return v;
}
export const RANK_FAILURES=Object.freeze(['LOCAL_NOT_INSTALLED','LOCAL_RUNTIME_FAILED','LOCAL_MODEL_UNAVAILABLE','LOCAL_MODEL_FAILED','LOCAL_OLLAMA_OUTDATED','LOCAL_TIMEOUT','LOCAL_INVALID_OUTPUT']);
/** One entry per input study, in input order. A scored entry has score and reasonId; a failed entry has only its failure code. */
export function parseLocalRankingResult(v,nctIds){
 if(!exactKeys(v,['provider','model','version','durationMs','studies'])||v.provider!=='local'||!isLocalModelName(v.model)||v.version!==null&&(typeof v.version!=='string'||!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(v.version))||!Number.isSafeInteger(v.durationMs)||v.durationMs<0||!Array.isArray(v.studies)||v.studies.length!==nctIds.length)throw Error('Invalid local ranking');
 for(const [i,s] of v.studies.entries()){
  if(!isRecord(s)||s.nctId!==nctIds[i])throw Error('Mismatched local ranking');
  if(s.failure!==undefined){if(!exactKeys(s,['nctId','failure'])||!RANK_FAILURES.includes(s.failure))throw Error('Invalid ranking failure');continue;}
  const bounds=typeof s.reasonId==='string'&&Object.hasOwn(RANK_REASONS,s.reasonId)?RANK_REASON_SCORE_BOUNDS[s.reasonId]:undefined;if(!exactKeys(s,['nctId','score','reasonId'])||!Number.isInteger(s.score)||s.score<0||s.score>100||!bounds||s.score<bounds[0]||s.score>bounds[1])throw Error('Invalid local score');
 }
 if(utf8Bytes(v)>16*1024)throw Error('Local ranking too large');return v;
}
