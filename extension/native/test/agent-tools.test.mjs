// The Agents session loop (provider.mjs runPinnedToolAgent) as the study brief drives it: get_public_selected_study calls are answered
// only from pinned outputs, anything else gets the caller's fixed failed tool result, and provider state is always deleted.
import test from 'node:test';import assert from 'node:assert/strict';
import {runPinnedToolAgent,MAX_TOOL_ARGUMENT_BYTES} from '../provider.mjs';
import {selectedStudyArgument,STUDY_BRIEF_TOOL} from '../study-brief.mjs';
const ids=['NCT99999980','NCT99999981'],TOOL_ERROR='Rejected: fixed test tool error. No evidence was returned.';
const outputs=new Map(ids.map(nctId=>[nctId,JSON.stringify({public:true,nctId,evidence:`Pinned public evidence for ${nctId}`})]));
const plan=JSON.stringify({studies:ids.map(nctId=>({nctId}))});
const action=(i,args,name=STUDY_BRIEF_TOOL)=>({type:'function_call',turn_id:'turn_t',call_id:`call_${i}`,name,arguments:args});
// The study brief's own argument check and finish rule: every selected study must be read before the final JSON is accepted.
const pinned={toolName:STUDY_BRIEF_TOOL,toolError:TOOL_ERROR,answer:raw=>{const nctId=selectedStudyArgument(raw,ids);return nctId?{key:nctId,output:outputs.get(nctId),trace:{nctId}}:undefined},finish:(text,read)=>{if(ids.some(id=>!read.has(id))){const e=new Error('incomplete');e.code='INCOMPLETE_AGENT_TURN';throw e}return JSON.parse(text)},wrapResult:v=>v};
const run=(api,options={},overrides={})=>runPinnedToolAgent(api,{agent:'pinned body'},{...pinned,...overrides},options);
// Documented flow: stream -> agent.session.requires_action -> GET session.required_actions -> POST tool_result events -> completion -> DELETE.
function scripted({rounds,text=plan,fatal,terminal='agent.session.turn.completed'}){
 const calls=[];let round=0;
 return{mode:'test',calls,async request(method,url,body){calls.push({method,url,body});
  if(method==='DELETE')return{id:'sess_t',deleted:true,object:'agent.session.deleted'};
  if(method==='GET')return{id:'sess_t',required_actions:rounds[round++]??[]};
  if(url.endsWith('/events'))return{};
  return(async function*(){yield{type:'agent.session.created',session:{id:'sess_t'}};if(fatal)yield{type:fatal,session_id:'sess_t',error:{message:'SENSITIVE_SENTINEL'}};for(const _ of rounds)yield{type:'agent.session.requires_action',session:{id:'sess_t'}};yield{type:'agent.session.turn.output_text.done',text};if(terminal)yield{type:terminal,turn:{subagent_id:null}};})();}};
}
const toolEvents=api=>api.calls.filter(x=>x.url.endsWith('/events')&&x.body?.events?.[0]?.type==='agent.session.input.tool_result').map(x=>x.body.events[0]);
test('tool arguments accept a parsed object or a small JSON string with exactly the schema keys and a selected NCT ID',()=>{
 assert.equal(selectedStudyArgument({nctId:ids[0]},ids),ids[0]);assert.equal(selectedStudyArgument(JSON.stringify({nctId:ids[1]}),ids),ids[1]);
 const padded=`{"nctId":"${ids[0]}"${' '.repeat(MAX_TOOL_ARGUMENT_BYTES)}}`;assert.equal(selectedStudyArgument(padded,ids),undefined);
 for(const bad of [undefined,null,'',ids[0],'{"nctId":',[ids[0]],{},{nctId:'NCT99999999'},JSON.stringify({nctId:'NCT99999999'}),{nctId:ids[0],extra:true},{nctId:ids[0],__proto__:{x:1}},JSON.parse(`{"nctId":"${ids[0]}","__proto__":{}}`),{nctId:[ids[0]]},JSON.stringify(JSON.stringify({nctId:ids[0]})),Object.assign(Object.create(null),{nctId:ids[0]})])assert.equal(selectedStudyArgument(bad,ids),undefined);
});
test('the loop runs only the study brief tool with an explicit fixed error: any other tool name or a missing error is refused before any request',async()=>{
 for(const overrides of [{toolName:'get_public_trial_evidence'},{toolName:'run_shell'},{toolName:undefined},{toolError:undefined},{toolError:''}]){const api=scripted({rounds:[]});await assert.rejects(run(api,{},overrides),e=>e.code==='INVALID_TOOL_CALL',JSON.stringify(overrides));assert.equal(api.calls.length,0);}
});
test('JSON-string function_call arguments run the documented tool_result flow and send exactly the pinned evidence',async()=>{
 const api=scripted({rounds:[ids.map((id,i)=>action(i,JSON.stringify({nctId:id})))]}),trace=[];const result=await run(api,{onTrace:x=>trace.push(x)});
 assert.equal(result.cleanup,'deleted');assert.equal(result.toolCalls,2);const events=toolEvents(api);assert.deepEqual(events.map(x=>[x.turn_id,x.call_id,x.success]),[['turn_t','call_0',true],['turn_t','call_1',true]]);
 assert.deepEqual(events.map(x=>x.output),ids.map(id=>outputs.get(id)));assert.deepEqual(trace.filter(x=>x.stage==='agent.tool.result').map(x=>x.nctId),ids);
});
test('invalid or non-selected arguments get a fixed failed tool_result without echo, then valid calls can still complete',async()=>{
 const hostile=JSON.stringify({nctId:'NCT99999999',note:'SENSITIVE_SENTINEL'});
 for(const bad of [hostile,JSON.stringify({nctId:'NCT99999999'}),'{not json SENSITIVE_SENTINEL','x'.repeat(MAX_TOOL_ARGUMENT_BYTES+1),{nctId:ids[0],extra:'SENSITIVE_SENTINEL'},{}]){
  const api=scripted({rounds:[[action(9,bad)],ids.map((id,i)=>action(i,{nctId:id}))]}),trace=[],calls=[];const result=await run(api,{onTrace:x=>trace.push(x),onToolCall:x=>calls.push(x)});
  assert.equal(result.cleanup,'deleted');assert.equal(result.toolCalls,3);const [rejected,...accepted]=toolEvents(api);
  assert.deepEqual(rejected,{type:'agent.session.input.tool_result',turn_id:'turn_t',call_id:'call_9',success:false,error:TOOL_ERROR});
  assert.ok(!JSON.stringify(rejected).includes('SENSITIVE_SENTINEL')&&!JSON.stringify(rejected).includes('NCT99999999'));assert.ok(!JSON.stringify([trace,calls]).includes('NCT99999999')&&!JSON.stringify([trace,calls]).includes('SENSITIVE_SENTINEL'));
  assert.deepEqual(calls[0],{tool:STUDY_BRIEF_TOOL,accepted:false},'a rejected call is reported without its arguments');assert.deepEqual(accepted.map(x=>x.success),[true,true]);
 }
});
test('a run whose tool calls are all rejected ends as INCOMPLETE_AGENT_TURN and still deletes the session',async()=>{
 const api=scripted({rounds:[ids.map((_,i)=>action(i,JSON.stringify({nctId:'NCT99999999'})))]});
 await assert.rejects(run(api),e=>e.code==='INCOMPLETE_AGENT_TURN');assert.ok(toolEvents(api).every(x=>x.success===false&&x.output===undefined));assert.equal(api.calls.at(-1).method,'DELETE');
});
test('malformed function_call actions and the documented agent.session.error event fail without posting evidence',async()=>{
 for(const bad of [action(0,{nctId:ids[0]},'run_shell'),action(0,{nctId:ids[0]},'get_public_trial_evidence'),{...action(0,{nctId:ids[0]}),call_id:'bad id'},{...action(0,{nctId:ids[0]}),extra:1},{type:'computer_use_approval_request',turn_id:'turn_t',request_id:'r'}]){const api=scripted({rounds:[[bad]]});await assert.rejects(run(api));assert.equal(toolEvents(api).length,0);assert.ok(api.calls.some(x=>x.method==='DELETE'));}
 const api=scripted({rounds:[ids.map((id,i)=>action(i,{nctId:id}))],fatal:'agent.session.error'});await assert.rejects(run(api),e=>e.code==='AGENT_FAILED'&&!String(e).includes('SENSITIVE_SENTINEL'));assert.equal(toolEvents(api).length,0);assert.ok(api.calls.some(x=>x.method==='DELETE'));
});
