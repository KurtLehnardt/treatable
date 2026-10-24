// Test-only fake OpenAI for spawned native hosts, loaded through a per-test --import hook (see host-harness.mjs) that sets
// globalThis.__FAKE_OPENAI after this module patches https.request. Config is read lazily at call time. Never touches the network.
// Logs one JSON line per request: pid, method, path, whether a Bearer sk- header was present (never its value), argv, env keys, body.
import https from 'node:https';import{EventEmitter}from'node:events';import{PassThrough}from'node:stream';import{appendFileSync}from'node:fs';
const cfg=()=>({delay:5,agent:'normal',session:'sess_fake',eventsDelay:0,...globalThis.__FAKE_OPENAI});
// Optionally shortens only the 5-minute consent timer, so expiry can be observed while a request is in flight.
const originalSetTimeout=globalThis.setTimeout;globalThis.setTimeout=(f,d,...a)=>originalSetTimeout(f,d===300000&&cfg().ttl?cfg().ttl:d,...a);
const wait=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted)return reject(new Error('aborted'));const t=originalSetTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(t);reject(new Error('aborted'));},{once:true});});
let ids=[],posted=0,release=()=>{};
https.request=(options,callback)=>{const req=new EventEmitter(),signal=options.signal;let raw='',response;req.write=c=>{raw+=c;};
 signal?.addEventListener('abort',()=>{req.emit('error',new Error('aborted'));response?.destroy(new Error('aborted'));},{once:true});
 req.end=()=>setImmediate(async()=>{const c=cfg(),{method,path}=options,body=raw?JSON.parse(raw):undefined;
  if(c.log)appendFileSync(c.log,JSON.stringify({pid:process.pid,t:Date.now(),method,path,auth:String(options.headers?.Authorization).startsWith('Bearer sk-'),argv:process.argv.slice(1),envKeys:Object.keys(process.env).sort(),body})+'\n');
  const reply=(status,data)=>{response=new PassThrough();response.statusCode=status;response.headers={'content-type':'application/json'};callback(response);response.end(JSON.stringify(data));};
  try{await wait(method==='POST'&&path.endsWith('/events')?c.eventsDelay:c.delay,signal);
   if(path==='/v1/decisions')return reply(200,{answers:body.questions.map(q=>({type:'score',name:q.name,score:2,confidence:.8,probabilities:q.levels.map((l,i)=>({value:i,label:l.label,probability:i===2?1:0}))}))});
   if(method==='POST'&&path==='/v1/agents/sessions'){ids=JSON.parse(body.input).nctIds;posted=0;const all=new Promise(r=>release=r);response=new PassThrough();response.statusCode=200;response.headers={'content-type':'text/event-stream'};callback(response);
    const sse=e=>response.write(`data: ${JSON.stringify(e)}\n\n`);sse({type:'agent.session.created',session:{id:c.session}});if(c.agent==='hang')return;
    sse({type:'agent.session.requires_action',session:{id:c.session}});await all;sse({type:'agent.session.turn.output_text.done',text:JSON.stringify({comparisons:ids.map(nctId=>({nctId,questionIds:['eligibility']})),cautionIds:['team_confirms','snapshot','no_benefit_promise']})});sse({type:'agent.session.turn.completed'});response.end();return;}
   const id=path.split('/')[4];
   if(method==='GET')return reply(200,{id,required_actions:ids.map((nctId,i)=>({type:'function_call',turn_id:'turn_fake',call_id:`call_${i}`,name:'get_public_trial_evidence',arguments:{nctId}}))});
   if(method==='POST'&&path.endsWith('/events')){if(body.events[0].type==='agent.session.input.tool_result'&&++posted>=ids.length)release();return reply(200,{});}
   // Deterministic DELETE outcomes by session-ID content: "gone" -> 404, "fail" -> 500, otherwise the documented deletion ack.
   if(method==='DELETE')return id.includes('gone')?reply(404,{error:{}}):id.includes('fail')?reply(500,{error:{}}):reply(200,{id,deleted:true,object:'agent.session.deleted'});
   reply(404,{});
  }catch{/* aborted: the abort listener already reported it */}
 });
 return req;};
