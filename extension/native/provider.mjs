import {getDemoFixture,decisionsPayload,agentPayload,demoToolResults,SCORING_LEVELS as LEVELS} from '../shared/demo-fixtures.mjs';
export {decisionsPayload,agentPayload} from '../shared/demo-fixtures.mjs';
import {QUESTION_TEMPLATES,CAUTION_TEMPLATES,CLEANUP_FAILURE_CODES,exactKeys,isRecord,parseDemoResult} from '../shared/demo-contract.mjs';
import {ApiError} from './transport.mjs';
import{parseRealResult}from '../shared/real-contract.mjs';
const providerId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v);
export const MAX_TOOL_ARGUMENT_BYTES=4096;
// Fixed text only: rejected tool arguments are never echoed back to the model, trace or logs.
export const TOOL_ARGUMENT_ERROR='Rejected: get_public_trial_evidence accepts exactly one argument, nctId, set to one of the NCT IDs supplied for this task. No evidence was returned.';
// The Agents API types function_call arguments as `unknown`: accept a parsed object or a small JSON string, with exactly the schema's keys.
export function toolArgumentNctId(raw,allowedIds){let value=raw;if(typeof raw==='string'){if(Buffer.byteLength(raw)>MAX_TOOL_ARGUMENT_BYTES)return undefined;try{value=JSON.parse(raw);}catch{return undefined;}}if(!isRecord(value))return undefined;const keys=Object.keys(value);if(keys.length!==1||keys[0]!=='nctId'||typeof value.nctId!=='string'||!allowedIds.includes(value.nctId))return undefined;return value.nctId;}
const cleanupFailure=error=>({cleanupCode:CLEANUP_FAILURE_CODES.includes(error?.code)?error.code:'CLEANUP_ERROR',...(Number.isInteger(error?.status)&&error.status>=100&&error.status<=599?{httpStatus:error.status}:{})});
const FATAL_EVENTS=['error','agent.session.error','environment.failed','agent.session.environment.failed'];
export function fixtureFor(payload){const fixture=getDemoFixture(payload.fixtureId);const selected=payload.studyIds??fixture.studies.map(x=>x.id);if(selected.some(id=>!fixture.studies.some(s=>s.id===id)))throw new ApiError('INVALID_FIXTURE_STUDIES');return{...fixture,studies:fixture.studies.filter(s=>selected.includes(s.id))};}
export function scoreValues(raw,fixture){if(!Array.isArray(raw?.answers)||raw.answers.length!==fixture.studies.length)throw new ApiError('INVALID_DECISIONS_OUTPUT');const used=new Set();const scores=raw.answers.map(a=>{if(!a||a.type!=='score'||!fixture.studies.some(s=>s.id===a.name)||used.has(a.name)||!Number.isFinite(a.score)||a.score<0||a.score>3||!Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1||!Array.isArray(a.probabilities)||a.probabilities.length!==4)throw new ApiError('INVALID_DECISIONS_OUTPUT');used.add(a.name);let sum=0,mean=0;const seen=new Set();for(const p of a.probabilities){if(!Number.isInteger(p.value)||p.value<0||p.value>3||seen.has(p.value)||p.label!==LEVELS[p.value].label||!Number.isFinite(p.probability)||p.probability<0||p.probability>1)throw new ApiError('INVALID_DECISIONS_OUTPUT');seen.add(p.value);sum+=p.probability;mean+=p.value*p.probability;}if(Math.abs(sum-1)>0.002||Math.abs(mean-a.score)>0.02)throw new ApiError('INVALID_DECISIONS_OUTPUT');return{nctId:a.name,index:Math.round(a.score/3*100),confidence:a.confidence};});return scores;}
export function parseScores(raw,fixture,mode){return parseDemoResult({kind:'scoreDemo',fixtureId:fixture.id,mode,scores:scoreValues(raw,fixture)});}
function parsePlan(text,fixture){if(typeof text!=='string'||Buffer.byteLength(text)>16000)throw new ApiError('INVALID_AGENT_OUTPUT');let v;try{v=JSON.parse(text);}catch{throw new ApiError('INVALID_AGENT_OUTPUT');}if(!exactKeys(v,['comparisons','cautionIds'])||!Array.isArray(v.comparisons)||v.comparisons.length!==fixture.studies.length||new Set(v.comparisons.map(x=>x.nctId)).size!==fixture.studies.length||v.comparisons.some(x=>!fixture.studies.some(s=>s.id===x.nctId))||!Array.isArray(v.cautionIds)||Object.keys(CAUTION_TEMPLATES).some(x=>!v.cautionIds.includes(x)))throw new ApiError('INVALID_AGENT_OUTPUT');return v;}
export async function runScore(transport,payload,{signal,onTrace=()=>{}}={}){const fixture=fixtureFor(payload);onTrace({stage:'decisions.request'});const raw=await transport.request('POST','/v1/decisions',decisionsPayload(fixture),{signal,timeout:25000});const result=parseScores(raw,fixture,transport.mode);onTrace({stage:'decisions.complete'});return result;}
export async function runAgentContext(transport,fixture,requestBody,toolResults,wrapResult,options){
 const allowedIds=fixture.studies.map(x=>x.id);
 if(!Array.isArray(toolResults)||toolResults.length!==allowedIds.length||toolResults.some(x=>!allowedIds.includes(x?.study?.id)))throw new ApiError('INVALID_TOOL_EVIDENCE');
 const answer=raw=>{const nctId=toolArgumentNctId(raw,allowedIds),evidence=nctId===undefined?undefined:toolResults.find(x=>x.study.id===nctId);return evidence?{key:nctId,output:JSON.stringify(evidence),trace:{nctId}}:undefined;};
 const finish=(text,read)=>{if(fixture.studies.some(x=>!read.has(x.id)))throw new ApiError('INCOMPLETE_AGENT_TURN');return parsePlan(text,fixture);};
 return runPinnedToolAgent(transport,requestBody,{answer,finish,wrapResult},options);
}
// Shared Agents session loop for every agent path. answer(arguments) maps one function call to a pinned output ({key,output,trace}) or
// undefined (the fixed failed tool result, never echoed); finish(text,read) validates the completed turn given the keys read in first-read order.
export async function runPinnedToolAgent(transport,requestBody,{answer,finish,wrapResult,toolError=TOOL_ARGUMENT_ERROR,toolName='get_public_trial_evidence'},{signal,onTrace=()=>{}}={}){
 if(!['get_public_trial_evidence','get_public_selected_study'].includes(toolName))throw new ApiError('INVALID_TOOL_CALL');
 let sessionId,completed=false,text='',toolCalls=0,cleanup='failed',plan;const handled=new Set(),read=new Set();
 const remember=event=>{const id=event?.session?.id??event?.session_id;if(id!==undefined){if(!providerId(id)||sessionId&&sessionId!==id)throw new ApiError('INVALID_SESSION_ID');if(!sessionId){sessionId=id;onTrace({stage:'agent.session.created',sessionId});}}};
 const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000);
 onTrace({stage:'agent.request'});
 try{
  const events=await transport.request('POST','/v1/agents/sessions',requestBody,{signal:combined,stream:true,timeout:90000});
  for await(const event of events){if(!isRecord(event)||typeof event.type!=='string')throw new ApiError('INVALID_STREAM');remember(event);if(FATAL_EVENTS.includes(event.type))throw new ApiError('AGENT_FAILED');if(event.subagent_id||event.turn?.subagent_id)throw new ApiError('UNEXPECTED_SUBAGENT');
   if(event.type==='agent.session.requires_action'){
    if(!sessionId)throw new ApiError('MISSING_SESSION_ID');const session=await transport.request('GET',`/v1/agents/sessions/${sessionId}`,undefined,{signal:combined});if(session.id!==sessionId||!Array.isArray(session.required_actions)||!session.required_actions.length||session.required_actions.length>6)throw new ApiError('INVALID_REQUIRED_ACTION');
    for(const action of session.required_actions){if(!exactKeys(action,['type','turn_id','call_id','name','arguments'])||action.type!=='function_call'||action.name!==toolName||!providerId(action.turn_id)||!providerId(action.call_id))throw new ApiError('INVALID_TOOL_CALL');const key=`${action.turn_id}:${action.call_id}`;if(handled.has(key))throw new ApiError('DUPLICATE_TOOL_CALL');if(++toolCalls>6)throw new ApiError('TOOL_LIMIT');handled.add(key);
     const hit=answer(action.arguments);
     // Invalid or non-selected arguments get the documented failed tool result (success:false + fixed error), never evidence.
     if(!hit){await transport.request('POST',`/v1/agents/sessions/${sessionId}/events`,{events:[{type:'agent.session.input.tool_result',turn_id:action.turn_id,call_id:action.call_id,success:false,error:toolError}]},{signal:combined});continue;}
     onTrace({stage:'agent.tool.request',...hit.trace});await transport.request('POST',`/v1/agents/sessions/${sessionId}/events`,{events:[{type:'agent.session.input.tool_result',turn_id:action.turn_id,call_id:action.call_id,success:true,output:hit.output}]},{signal:combined});read.add(hit.key);onTrace({stage:'agent.tool.result',...hit.trace});}
   }else if(event.type==='agent.session.turn.output_text.delta'){if(typeof event.delta!=='string')throw new ApiError('INVALID_STREAM');text+=event.delta;if(Buffer.byteLength(text)>16000)throw new ApiError('OUTPUT_TOO_LARGE');}
   else if(event.type==='agent.session.turn.output_text.done'){if(typeof event.text!=='string'||Buffer.byteLength(event.text)>16000)throw new ApiError('INVALID_STREAM');text=event.text;}
   else if(event.type==='agent.session.turn.completed'){completed=true;break;}
   else if(['agent.session.turn.failed','agent.session.turn.cancelled','agent.session.failed'].includes(event.type))throw new ApiError(event.type.includes('cancelled')?'CANCELLED':'AGENT_FAILED');
  }
  if(!completed||!sessionId||!toolCalls)throw new ApiError('INCOMPLETE_AGENT_TURN');plan=finish(text,read);wrapResult({mode:transport.mode,...plan,toolCalls,cleanup:'failed'});onTrace({stage:'agent.complete'});
 }finally{
  if(sessionId){const budget=AbortSignal.timeout(5500),deadline=Date.now()+5500;const options=limit=>({signal:budget,timeout:Math.max(1,Math.min(limit,deadline-Date.now()))});
   // Acceptance of cancellation is not terminal completion. Never reuse the aborted work signal.
   if(!completed){try{await transport.request('POST',`/v1/agents/sessions/${sessionId}/events`,{events:[{type:'agent.session.input.cancel'}]},options(1000));}catch{}}
   let cleanupAttempts=0,lastCleanupFailure;
   for(let attempt=0;attempt<2&&Date.now()<deadline;attempt++){try{cleanupAttempts++;const ack=await transport.request('DELETE',`/v1/agents/sessions/${sessionId}`,undefined,options(1500));if(!exactKeys(ack,['id','deleted','object'])||ack.id!==sessionId||ack.deleted!==true||ack.object!=='agent.session.deleted')throw new ApiError('INVALID_DELETE_ACK');cleanup='deleted';break;}catch(error){lastCleanupFailure=cleanupFailure(error);if(attempt===0&&Date.now()<deadline){try{await transport.request('GET',`/v1/agents/sessions/${sessionId}`,undefined,options(500));}catch{}}}}
   onTrace({stage:cleanup==='deleted'?'agent.cleanup.deleted':'agent.cleanup.failed',cleanupAttempts,...(cleanup==='failed'?(lastCleanupFailure??{cleanupCode:'CLEANUP_ERROR'}):{})});}else{onTrace({stage:'agent.cleanup.failed',cleanupCode:'MISSING_SESSION_ID',cleanupAttempts:0});}
 }
 return wrapResult({mode:transport.mode,...plan,toolCalls,cleanup});
}

export function runAgent(transport,payload,options){const fixture=fixtureFor(payload);return runAgentContext(transport,fixture,agentPayload(fixture),demoToolResults(fixture),v=>parseDemoResult({kind:'agentDemo',fixtureId:fixture.id,...v}),options);}
export async function runPreparedScore(transport,prepared,{signal,onTrace=()=>{}}={}){onTrace({stage:'decisions.request'});const raw=await transport.request('POST','/v1/decisions',prepared.preview.decisionsRequest,{signal,timeout:25000});const result=parseRealResult({kind:'scoreReal',mode:transport.mode,consentDigest:prepared.consentDigest,scores:scoreValues(raw,prepared.context)});onTrace({stage:'decisions.complete'});return result;}
export function runPreparedAgent(transport,prepared,options){return runAgentContext(transport,prepared.context,prepared.preview.agentsRequest,prepared.preview.toolResults,v=>parseRealResult({kind:'agentReal',consentDigest:prepared.consentDigest,...v}),options);}

// New path has independent dynamic-ID result validation; legacy contracts remain strict.
export async function runPreparedLiveScore(transport,prepared,{signal,onTrace=()=>{}}={}){const{parseLiveResult}=await import('../shared/live-analysis-contract.mjs');onTrace({stage:'decisions.request'});const raw=await transport.request('POST','/v1/decisions',prepared.preview.decisionsRequest,{signal,timeout:25000});const result=parseLiveResult({kind:'scoreLive',mode:transport.mode,analysisId:prepared.analysisId,snapshotId:prepared.snapshotId,source:prepared.source,profileKey:prepared.profileKey,consentDigest:prepared.consentDigest,scores:scoreValues(raw,prepared.context)});onTrace({stage:'decisions.complete'});return result;}
export async function runPreparedLiveAgent(transport,prepared,options){const{parseLiveResult}=await import('../shared/live-analysis-contract.mjs');return runAgentContext(transport,prepared.agentContext,prepared.preview.agentsRequest,prepared.preview.toolResults,v=>parseLiveResult({kind:'agentLive',analysisId:prepared.analysisId,snapshotId:prepared.snapshotId,source:prepared.source,profileKey:prepared.profileKey,consentDigest:prepared.consentDigest,...v}),options);}
