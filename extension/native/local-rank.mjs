// Local backend for AI result ranking. One small structured request per public study record (bounded batch, concurrency 1–2) asks the
// model on this device for a 0–100 topical relevance score and one reason ID from the fixed catalog. Only the searched condition terms and
// the public record text reach the model; age, sex, state and recruitment checks stay deterministic and outside the model. Nothing here
// reads a credential or contacts OpenAI. Wired to the ranking operation once that operation exists.
import{ApiError}from'./transport.mjs';
import{versionAtLeast}from'./local-runtime.mjs';
import{RANK_REASONS,RANK_REASON_SCORE_BOUNDS,RANK_FAILURES,parseRankingProfile,parseRankingStudies,parseLocalRankingResult}from'../shared/local-ranking.mjs';
import{isLocalModelName}from'../shared/local-model.mjs';
import{isRecord,utf8Bytes}from'../shared/demo-contract.mjs';
import{sanitizeUntrustedText,UNTRUSTED_TEXT_RULE,UNTRUSTED_FIELD}from'../shared/untrusted-text.mjs';
export const RANK_STUDY_TIMEOUT_MS=60000,RANK_TOTAL_TIMEOUT_MS=240000;
const RANK_NUM_PREDICT=64,RANK_NUM_CTX=8192;
const SYSTEM='You score how relevant ONE public ClinicalTrials.gov study is to the condition terms a patient searched for. Judge topical relevance only: never eligibility, safety, benefit or the chance of being enrolled. You have no other patient information. score is an integer from 0 to 100: 85-100 the study is about a searched condition; 60-84 a closely related condition or its symptoms; 30-59 a broad group that may include the condition; 0-29 a different condition or healthy volunteers. reasonId is the one catalog ID that best explains the score. Return only compact JSON that matches the required output format. Reason catalog: '+JSON.stringify(RANK_REASONS)+' '+UNTRUSTED_TEXT_RULE;
const FORMAT={type:'object',additionalProperties:false,properties:{score:{type:'integer',minimum:0,maximum:100},reasonId:{type:'string',enum:Object.keys(RANK_REASONS)}},required:['score','reasonId']};
// The system message and the searched terms are the same for every study, so the runtime reuses that prefix across the batch.
export function buildLocalRankRequest(profile,study,model){
 const record={title:sanitizeUntrustedText(study.title,300),conditions:study.conditions.map(c=>sanitizeUntrustedText(c,120)).filter(Boolean).slice(0,10),summary:sanitizeUntrustedText(study.summary??'',1200),criteria:sanitizeUntrustedText(study.criteria??'',1600)};
 return{model,stream:false,format:FORMAT,options:{temperature:0,seed:7,num_ctx:RANK_NUM_CTX,num_predict:RANK_NUM_PREDICT},keep_alive:'2m',messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify({searchedConditions:profile.conditions})},{role:'user',content:JSON.stringify({publicOnly:true,nctId:study.nctId,[UNTRUSTED_FIELD]:record})}]};
}
/** Strict: exactly {score, reasonId}, an integer score in range, a catalog reason, and a score consistent with that reason. */
export function parseLocalRankOutput(text){
 if(typeof text!=='string'||utf8Bytes(text)>1024)throw new ApiError('LOCAL_INVALID_OUTPUT');let v;try{v=JSON.parse(text)}catch{throw new ApiError('LOCAL_INVALID_OUTPUT')}
 const bounds=isRecord(v)&&typeof v.reasonId==='string'&&Object.hasOwn(RANK_REASONS,v.reasonId)?RANK_REASON_SCORE_BOUNDS[v.reasonId]:undefined;
 if(!isRecord(v)||Object.keys(v).sort().join()!=='reasonId,score'||!Number.isInteger(v.score)||v.score<0||v.score>100||!bounds||v.score<bounds[0]||v.score>bounds[1])throw new ApiError('LOCAL_INVALID_OUTPUT');
 return{score:v.score,reasonId:v.reasonId};
}
const STOP=['LOCAL_NOT_INSTALLED','LOCAL_RUNTIME_FAILED','LOCAL_MODEL_UNAVAILABLE','LOCAL_MODEL_FAILED','LOCAL_OLLAMA_OUTDATED','LOCAL_TIMEOUT'];
/** Ranks 1–10 public studies with the local model. Per-study output failures are reported per study; a runtime-level failure (missing
 * Ollama, runtime or model, or a model too slow for the per-study timeout) stops the batch and marks the remaining studies with it. */
export async function runLocalRanking(runtime,{profile,studies,model},{signal,concurrency=1,studyTimeout=RANK_STUDY_TIMEOUT_MS,totalTimeout=RANK_TOTAL_TIMEOUT_MS,now=()=>performance.now(),onStudy=()=>{}}={}){
 parseRankingProfile(profile);parseRankingStudies(studies);if(!isLocalModelName(model))throw new ApiError('LOCAL_MODEL_UNAVAILABLE');
 const started=now(),deadline=AbortSignal.timeout(totalTimeout),combined=signal?AbortSignal.any([signal,deadline]):deadline,results=new Array(studies.length);let stop,next=0,thinking=false;
 try{await runtime.ensure(combined);if(!versionAtLeast(runtime.version))throw new ApiError('LOCAL_OLLAMA_OUTDATED');const info=await runtime.describe(model,combined);if(!info.completion)throw new ApiError('LOCAL_MODEL_UNAVAILABLE');thinking=info.thinking===true;}
 catch(e){if(signal?.aborted)throw new ApiError('CANCELLED');stop=deadline.aborted?'LOCAL_TIMEOUT':STOP.includes(e?.code)?e.code:'LOCAL_RUNTIME_FAILED';}
 async function worker(){
  while(next<studies.length){const i=next++,study=studies[i];
   if(stop){results[i]={nctId:study.nctId,failure:stop};continue;}
   const body=buildLocalRankRequest(profile,study,model);
   try{const reply=await runtime.chat(thinking?{...body,think:false}:body,{signal:combined,timeout:studyTimeout});if(!isRecord(reply?.message)||typeof reply.message.content!=='string')throw new ApiError('LOCAL_INVALID_OUTPUT');results[i]={nctId:study.nctId,...parseLocalRankOutput(reply.message.content)};}
   catch(e){if(signal?.aborted)throw new ApiError('CANCELLED');const code=deadline.aborted?'LOCAL_TIMEOUT':RANK_FAILURES.includes(e?.code)?e.code:'LOCAL_INVALID_OUTPUT';if(STOP.includes(code))stop=code;results[i]={nctId:study.nctId,failure:code};}
   onStudy(results[i]);
  }
 }
 await Promise.all(Array.from({length:Math.max(1,Math.min(2,concurrency))},worker));
 return parseLocalRankingResult({provider:'local',model,version:runtime.version??null,durationMs:Math.round(now()-started),studies:results},studies.map(s=>s.nctId));
}
