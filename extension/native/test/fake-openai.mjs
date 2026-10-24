// Test-only fake OpenAI for spawned native hosts, loaded through a per-test --import hook (see host-harness.mjs) that sets
// globalThis.__FAKE_OPENAI after this module patches https.request. Config is read lazily at call time. Never touches the network.
// Also answers ClinicalTrials.gov record GETs (liveCatalog) with a small fictional public record; govSummary overrides its summary text.
// govStatus answers every record GET with that HTTP status; govRecord replaces the fictional record for its own NCT ID (Help me apply tests).
// A Help me apply Agents request (its tool has a section argument) gets two tool calls, eligibility (object) and locations_contacts (JSON string),
// then applyOutput (default: a valid catalog selection).
// Logs one JSON line per request: pid, host, method, path, whether a Bearer sk- header was present (never its value), argv, env keys, body.
import https from 'node:https';import{EventEmitter}from'node:events';import{PassThrough}from'node:stream';import{appendFileSync}from'node:fs';
const cfg=()=>({delay:5,agent:'normal',session:'sess_fake',eventsDelay:0,...globalThis.__FAKE_OPENAI});
// Optionally shortens only the 5-minute consent/snapshot timers (the live token's is the rest of its snapshot's window), so expiry can be
// observed while a request is in flight.
const originalSetTimeout=globalThis.setTimeout;globalThis.setTimeout=(f,d,...a)=>originalSetTimeout(f,d>=290000&&d<=300000&&cfg().ttl?cfg().ttl:d,...a);
const wait=(ms,signal)=>new Promise((resolve,reject)=>{if(signal?.aborted)return reject(new Error('aborted'));const t=originalSetTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(t);reject(new Error('aborted'));},{once:true});});
let actions=[],posted=0,release=()=>{};
const govRecord=(nctId,summary='Public summary of a fictional study.')=>({hasResults:false,protocolSection:{identificationModule:{nctId,briefTitle:`Fictional public study ${nctId}`},statusModule:{overallStatus:'RECRUITING',lastUpdatePostDateStruct:{date:'2026-10-01'}},conditionsModule:{conditions:['Fictional condition']},descriptionModule:{briefSummary:summary},eligibilityModule:{eligibilityCriteria:'Public criteria',minimumAge:'18 Years',maximumAge:'N/A',sex:'ALL',healthyVolunteers:false},contactsLocationsModule:{locations:[{country:'United States'}]}}});
https.request=(options,callback)=>{const req=new EventEmitter(),signal=options.signal;let raw='',response;req.write=c=>{raw+=c;};
 signal?.addEventListener('abort',()=>{req.emit('error',new Error('aborted'));response?.destroy(new Error('aborted'));},{once:true});
 req.end=()=>setImmediate(async()=>{const c=cfg(),{method,path}=options,body=raw?JSON.parse(raw):undefined;
  if(c.log)appendFileSync(c.log,JSON.stringify({pid:process.pid,t:Date.now(),host:options.hostname,method,path,auth:String(options.headers?.Authorization).startsWith('Bearer sk-'),argv:process.argv.slice(1),envKeys:Object.keys(process.env).sort(),body})+'\n');
  const reply=(status,data)=>{response=new PassThrough();response.statusCode=status;response.headers={'content-type':'application/json'};callback(response);response.end(JSON.stringify(data));};
  try{if(options.hostname==='clinicaltrials.gov'){await wait(c.govDelay??0,signal);const nctId=path.split('/').at(-1);if(c.govStatus)return reply(c.govStatus,{error:{}});return reply(200,c.govRecord?.protocolSection?.identificationModule?.nctId===nctId?c.govRecord:govRecord(nctId,c.govSummary));}
   await wait(method==='POST'&&path.endsWith('/events')?c.eventsDelay:c.delay,signal);
   if(path==='/v1/decisions')return reply(200,{answers:body.questions.map(q=>({type:'score',name:q.name,score:2,confidence:.8,probabilities:q.levels.map((l,i)=>({value:i,label:l.label,probability:i===2?1:0}))}))});
   if(method==='POST'&&path==='/v1/agents/sessions'){const tool=body.agent.tools[0].parameters.properties,apply=tool.section?tool.nctId.enum[0]:undefined,ids=apply?[]:JSON.parse(body.input).nctIds;posted=0;
    actions=apply?[{nctId:apply,section:'eligibility'},JSON.stringify({nctId:apply,section:'locations_contacts'})]:ids.map(nctId=>({nctId}));
    const final=apply?(c.applyOutput??JSON.stringify({questionIds:['still_enrolling','prescreen_fit','next_steps'],prescreenIds:['diagnosis_details','medication_list'],flagIds:[]})):JSON.stringify({comparisons:ids.map(nctId=>({nctId,questionIds:['eligibility']})),cautionIds:['team_confirms','snapshot','no_benefit_promise']});const all=new Promise(r=>release=r);response=new PassThrough();response.statusCode=200;response.headers={'content-type':'text/event-stream'};callback(response);
    const sse=e=>response.write(`data: ${JSON.stringify(e)}\n\n`);sse({type:'agent.session.created',session:{id:c.session}});if(c.agent==='hang')return;
    sse({type:'agent.session.requires_action',session:{id:c.session}});await all;sse({type:'agent.session.turn.output_text.done',text:final});sse({type:'agent.session.turn.completed'});response.end();return;}
   const id=path.split('/')[4];
   if(method==='GET')return reply(200,{id,required_actions:actions.map((args,i)=>({type:'function_call',turn_id:'turn_fake',call_id:`call_${i}`,name:'get_public_trial_evidence',arguments:args}))});
   if(method==='POST'&&path.endsWith('/events')){if(body.events[0].type==='agent.session.input.tool_result'&&++posted>=actions.length)release();return reply(200,{});}
   // Deterministic DELETE outcomes by session-ID content: "gone" -> 404, "fail" -> 500, otherwise the documented deletion ack.
   if(method==='DELETE')return id.includes('gone')?reply(404,{error:{}}):id.includes('fail')?reply(500,{error:{}}):reply(200,{id,deleted:true,object:'agent.session.deleted'});
   reply(404,{});
  }catch{/* aborted: the abort listener already reported it */}
 });
 return req;};
