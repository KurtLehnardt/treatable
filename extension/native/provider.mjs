// Agents session loop for the study brief (study-brief.mjs): pinned tool outputs, strict tool-call validation, bounded output and
// provider-state cleanup. The fictional demo, bundled-catalog and private-matching runners that also used it were removed.
import {CLEANUP_FAILURE_CODES,exactKeys,isRecord} from '../shared/demo-contract.mjs';
import {STUDY_BRIEF_TOOL_NAME} from '../shared/apply-contract.mjs';
import {ApiError} from './transport.mjs';
const providerId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v);
export const MAX_TOOL_ARGUMENT_BYTES=4096;
const cleanupFailure=error=>({cleanupCode:CLEANUP_FAILURE_CODES.includes(error?.code)?error.code:'CLEANUP_ERROR',...(Number.isInteger(error?.status)&&error.status>=100&&error.status<=599?{httpStatus:error.status}:{})});
const FATAL_EVENTS=['error','agent.session.error','environment.failed','agent.session.environment.failed'];
// answer(arguments) maps one function call to a pinned output ({key,output,trace}) or undefined (the caller's fixed failed tool result,
// never echoed); finish(text,read) validates the completed turn given the keys read in first-read order. toolName and toolError are required.
// onToolCall (optional) receives one display record per completed tool call: {tool,accepted:false} for a rejected call (its arguments are never
// passed on), or {tool,accepted:true,arguments,summary} where arguments are the validated ones from answer() and summary describes the local output.
export async function runPinnedToolAgent(transport,requestBody,{answer,finish,wrapResult,toolError,toolName},{signal,onTrace=()=>{},onToolCall=()=>{}}={}){
 if(toolName!==STUDY_BRIEF_TOOL_NAME||typeof toolError!=='string'||!toolError)throw new ApiError('INVALID_TOOL_CALL');
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
     if(!hit){await transport.request('POST',`/v1/agents/sessions/${sessionId}/events`,{events:[{type:'agent.session.input.tool_result',turn_id:action.turn_id,call_id:action.call_id,success:false,error:toolError}]},{signal:combined});onToolCall({tool:toolName,accepted:false});continue;}
     onTrace({stage:'agent.tool.request',...hit.trace});await transport.request('POST',`/v1/agents/sessions/${sessionId}/events`,{events:[{type:'agent.session.input.tool_result',turn_id:action.turn_id,call_id:action.call_id,success:true,output:hit.output}]},{signal:combined});read.add(hit.key);onToolCall({tool:toolName,accepted:true,arguments:hit.arguments,summary:hit.summary??`Returned ${Buffer.byteLength(hit.output)} bytes of pinned public evidence.`});onTrace({stage:'agent.tool.result',...hit.trace});}
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
