import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat,access} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';
import {validateOrigin,validateRequest,encodeMessage,MessageDecoder,MAX_MESSAGE_BYTES} from '../core.mjs';
import {getDemoFixture,getDemoPreview,SCORING_LEVELS} from '../../shared/demo-fixtures.mjs';
import {parseDemoReply} from '../../shared/demo-contract.mjs';
import {runScore,runAgent,fixtureFor,parseScores,agentPayload} from '../provider.mjs';
import {ApiError} from '../transport.mjs';
const origin='chrome-extension://lmgmjeabbalehlcakdbolielnfgchojf/';
const payload={fixtureId:'fibromyalgia',consent:true};
function scoreAnswer(id){return{type:'score',name:id,score:2,confidence:.8,probabilities:SCORING_LEVELS.map((x,i)=>({value:i,label:x.label,probability:i===2?1:0}))};}
class FakeAPI{
 constructor({noTool=false,noTerminal=false,badTool=false,deleteFails=false,abort=false,fatalEvent}={}){Object.assign(this,{noTool,noTerminal,badTool,deleteFails,abort,fatalEvent});this.mode='test';this.calls=[];this.fixture=getDemoFixture('fibromyalgia');}
 async request(method,url,body,options={}){this.calls.push({method,url,body});if(method==='DELETE'){if(this.deleteFails)throw Error('unavailable');return{id:'sess_test',deleted:true,object:'agent.session.deleted'};}
  if(url==='/v1/decisions')return{answers:this.fixture.studies.map(x=>scoreAnswer(x.id))};
  if(method==='GET')return{id:'sess_test',required_actions:this.fixture.studies.map((s,i)=>({type:'function_call',turn_id:'turn_test',call_id:`call_${i}`,name:this.badTool?'run_shell':'get_public_trial_evidence',arguments:{nctId:s.id}}))};
  if(url.endsWith('/events'))return{};
  const self=this;return(async function*(){yield{type:'agent.session.created',session:{id:'sess_test'}};if(self.fatalEvent)yield{type:self.fatalEvent,error:{code:'internal_server_error',message:'SENSITIVE_SENTINEL'}};if(self.abort){await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});return;}
   if(!self.noTool)yield{type:'agent.session.requires_action',session:{id:'sess_test'}};
   yield{type:'agent.session.turn.output_text.done',text:JSON.stringify({comparisons:self.fixture.studies.map(x=>({nctId:x.id,questionIds:['eligibility','visits']})),cautionIds:['team_confirms','snapshot','no_benefit_promise']})};
   if(!self.noTerminal)yield{type:'agent.session.turn.completed',turn:{subagent_id:null}};
  })();
 }
}
test('exact caller and typed fictional operations reject PHI, numeric IDs, arbitrary endpoints and byte overflow',()=>{
 assert.equal(validateOrigin(origin),true);for(const x of [origin+'x',origin.slice(0,-1),'https://clinicaltrials.gov',undefined])assert.equal(validateOrigin(x),false);
 assert.equal(validateRequest({id:'x',type:'scoreDemo',payload}).payload.fixtureId,'fibromyalgia');
 for(const request of [{id:5,type:'status',payload:{}},{id:'x',type:'generate',payload:{prompt:'SENSITIVE_SENTINEL'}},{id:'x',type:'scoreDemo',payload:{...payload,profile:{notes:'SENSITIVE_SENTINEL'}}},{id:'x',type:'agentDemo',payload:{...payload,endpoint:'https://evil.invalid'}},{id:'x',type:'agentDemo',payload:{...payload,consent:false}},{id:'x',type:'cancel',payload:{requestId:1}},{id:'x',type:'status',payload:{x:'🔐'.repeat(30000)}}])assert.throws(()=>validateRequest(request));
 assert.throws(()=>fixtureFor({...payload,studyIds:['NCT00000000']}));
});
test('framing fragments, batches and rejects malformed/oversized/incomplete UTF8 frames without echo',()=>{
 const received=[],errors=[];const d=new MessageDecoder(x=>received.push(x),e=>errors.push(e));const frames=Buffer.concat([encodeMessage({id:'a',type:'status',payload:{}}),encodeMessage({id:'b',type:'cancel',payload:{requestId:'a'}})]);for(let n=0;n<frames.length;n+=3)d.push(frames.subarray(n,n+3));d.end();assert.deepEqual(received.map(x=>x.id),['a','b']);assert.equal(errors.length,0);
 for(const length of [0,MAX_MESSAGE_BYTES+1]){const errors=[];const d=new MessageDecoder(()=>assert.fail(),e=>errors.push(e));const h=Buffer.alloc(4);h.writeUInt32LE(length);d.push(h);assert.equal(errors[0].message,'Invalid native message');}
 const errors2=[];const bad=new MessageDecoder(()=>assert.fail(),e=>errors2.push(e));bad.push(Buffer.from([2,0,0,0,0xff,0xff]));assert.equal(errors2.length,1);
});
test('exact preview equals actual request bodies and uses only native-owned fictional/public fixture evidence',async()=>{
 const f=getDemoFixture('fibromyalgia'),preview=getDemoPreview('fibromyalgia'),api=new FakeAPI();const score=await runScore(api,payload);assert.equal(score.mode,'test');assert.equal(score.scores[0].index,67);assert.deepEqual(api.calls[0].body,preview.decisionsRequest);assert.deepEqual(agentPayload(f),preview.agentsRequest);assert.deepEqual(preview.toolResults.map(x=>x.study.id),f.studies.map(x=>x.id));assert.ok(!JSON.stringify(preview).includes('SENSITIVE_SENTINEL'));
 assert.throws(()=>getDemoPreview('fibromyalgia',['NCT00000000']));assert.throws(()=>parseScores({answers:[scoreAnswer(f.studies[0].id),scoreAnswer(f.studies[0].id)]},f,'test'));
});
test('real Agents protocol requires valid pending tool actions, posts matching results, validates completion and deletes state',async()=>{
 const api=new FakeAPI(),trace=[];const result=await runAgent(api,payload,{onTrace:x=>trace.push(x)});assert.equal(result.mode,'test');assert.equal(result.toolCalls,2);assert.equal(result.cleanup,'deleted');assert.equal(api.calls.filter(x=>x.url.endsWith('/events')).length,2);const event=api.calls.find(x=>x.url.endsWith('/events')).body.events[0];assert.deepEqual([event.type,event.turn_id,event.call_id,event.success],['agent.session.input.tool_result','turn_test','call_0',true]);assert.equal(JSON.parse(event.output).public,true);assert.equal(api.calls.at(-1).method,'DELETE');assert.ok(trace.some(x=>x.stage==='agent.tool.result'));assert.ok(trace.some(x=>x.stage==='agent.cleanup.deleted'));
});
test('EOF, missing tool use, arbitrary tools and deletion failure never masquerade as verified success',async()=>{
 for(const opts of [{noTerminal:true},{noTool:true},{badTool:true}]){const api=new FakeAPI(opts);await assert.rejects(runAgent(api,payload));assert.ok(api.calls.some(x=>x.method==='DELETE'));}
 const api=new FakeAPI({deleteFails:true}),trace=[];const result=await runAgent(api,payload,{onTrace:x=>trace.push(x)});assert.equal(result.cleanup,'failed');assert.equal(api.calls.filter(x=>x.method==='DELETE').length,2);assert.ok(trace.some(x=>x.stage==='agent.cleanup.failed'));
});
test('cancellation still attempts provider-state deletion before original operation rejects',async()=>{
 const api=new FakeAPI({abort:true}),controller=new AbortController(),run=runAgent(api,payload,{signal:controller.signal});setTimeout(()=>controller.abort(),10);await assert.rejects(run);assert.ok(api.calls.some(x=>x.method==='DELETE'));
});
test('reply schemas reject invented template IDs, arbitrary score fields and mismatched reply IDs',()=>{
 assert.throws(()=>parseDemoReply({id:'other',type:'status',ok:true,provider:'openai',configured:true,message:'ready'},'x'));
 assert.throws(()=>parseDemoReply({id:'x',type:'result',ok:true,result:{kind:'scoreDemo',fixtureId:'fibromyalgia',mode:'live',scores:[{nctId:'NCT06567886',index:50,confidence:.5,url:'https://evil.invalid'}]}},'x'));
 assert.throws(()=>parseDemoReply({id:'x',type:'result',ok:true,result:{kind:'agentDemo',fixtureId:'fibromyalgia',mode:'live',comparisons:[{nctId:'NCT06567886',questionIds:['send_secrets']}],cautionIds:['team_confirms'],toolCalls:1,cleanup:'deleted'}},'x'));
});
test('isolated-home installer is durable, strips inherited networking flags, and never requires or accesses a user key',async()=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'treatable-api-install-')),fake=path.join(home,'fake-keychain');try{
  await writeFile(fake,`#!${process.execPath}\nif(process.argv[2]==='status')process.stdout.write('{"configured":false}');else process.exit(2);`,{mode:0o700});const installer=new URL('../install.mjs',import.meta.url).pathname;
  for(let n=0;n<2;n++){const r=spawnSync(process.execPath,[installer,'--home',home,'--credential-helper',fake],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
  const manifest=JSON.parse(await readFile(path.join(home,'Library','Application Support','Google','Chrome','NativeMessagingHosts','com.treatable.local.json'),'utf8'));assert.deepEqual(manifest.allowed_origins,[origin]);assert.ok(!manifest.path.includes('.Codex'));
  assert.equal((await stat(path.dirname(manifest.path))).mode&0o777,0o700);const launch=await readFile(manifest.path,'utf8');assert.ok(launch.includes('/usr/bin/env -i'));assert.ok(!launch.includes('OPENAI_API_KEY'));
  const wrong=spawnSync(process.execPath,[path.join(path.dirname(manifest.path),'native','host.mjs'),'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'],{encoding:'utf8'});assert.equal(wrong.status,1);assert.equal(wrong.stdout,'');
  const uninstall=spawnSync(process.execPath,[installer,'--home',home,'--uninstall'],{encoding:'utf8'});assert.equal(uninstall.status,0);await assert.rejects(access(manifest.path));
 }finally{await rm(home,{recursive:true,force:true});}
});
test('actual framed helper rejects PHI and duplicate IDs before any credential read; status never exposes secrets',async()=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'treatable-api-stdio-')),fake=path.join(home,'keychain'),readMarker=path.join(home,'credential-read');let child;
 try{await writeFile(fake,`#!${process.execPath}\nimport fs from 'node:fs';if(process.argv[2]==='status')process.stdout.write('{"configured":false}');else{fs.writeFileSync(${JSON.stringify(readMarker)},'read');process.stdout.write('sk-test-not-a-real-key');}`,{mode:0o700});
  const r=spawnSync(process.execPath,[new URL('../install.mjs',import.meta.url).pathname,'--home',home,'--credential-helper',fake],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const host=path.join(home,'Library','Application Support','Treatable','native-host','native','host.mjs');child=spawn(process.execPath,[host,origin],{stdio:['pipe','pipe','pipe']});const pending=new Map();let stderr='';child.stderr.on('data',x=>stderr+=x);const decoder=new MessageDecoder(x=>pending.get(x.id)?.(x),assert.fail);child.stdout.on('data',x=>decoder.push(x));
  const rpc=m=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout, child='+child.exitCode+', stderr='+stderr)),7000);pending.set(m.id,x=>{clearTimeout(timer);pending.delete(m.id);resolve(x)});child.stdin.write(encodeMessage(m));});
  const status=await rpc({id:'status',type:'status',payload:{}});assert.equal(status.configured,false);assert.equal(status.provider,'openai');
  const bad=await rpc({id:'bad',type:'scoreDemo',payload:{...payload,notes:'SENSITIVE_SENTINEL'}});assert.equal(bad.ok,false);assert.ok(!JSON.stringify(bad).includes('SENSITIVE_SENTINEL'));
  const duplicate=await rpc({id:'status',type:'status',payload:{}});assert.equal(duplicate.code,'INVALID_REQUEST');await assert.rejects(access(readMarker));assert.equal(stderr,'');
  child.stdin.end();await new Promise(r=>child.once('exit',r));child=undefined;
 }finally{child?.kill();await rm(home,{recursive:true,force:true});}
});

test('create disconnect before a session ID reports unconfirmed cleanup instead of fabricated deletion',async()=>{const trace=[];const api={mode:'test',async request(){return(async function*(){yield{type:'agent.session.status.changed',status:'in_progress'};})();}};await assert.rejects(runAgent(api,payload,{onTrace:x=>trace.push(x)}));assert.ok(trace.some(x=>x.stage==='agent.cleanup.failed'&&!x.sessionId));assert.ok(!trace.some(x=>x.stage==='agent.cleanup.deleted'));});

test('generic provider/environment error events cannot be followed by a fabricated successful turn',async()=>{for(const fatalEvent of ['error','environment.failed','agent.session.environment.failed']){const api=new FakeAPI({fatalEvent});await assert.rejects(runAgent(api,payload),error=>!String(error).includes('SENSITIVE_SENTINEL'));assert.ok(api.calls.some(x=>x.method==='DELETE'));assert.equal(api.calls.filter(x=>x.url.endsWith('/events')&&x.body?.events?.[0]?.type==='agent.session.input.tool_result').length,0)}});

test('incomplete active turns receive cancellation before deletion; cancellation acceptance is not treated as completion',async()=>{const api=new FakeAPI({noTerminal:true}),trace=[];await assert.rejects(runAgent(api,payload,{onTrace:x=>trace.push(x)}));const cancel=api.calls.findIndex(x=>x.body?.events?.[0]?.type==='agent.session.input.cancel'),deleted=api.calls.findIndex(x=>x.method==='DELETE');assert.ok(cancel>=0&&cancel<deleted);assert.ok(trace.some(x=>x.stage==='agent.cleanup.deleted'))});

test('malformed successful DELETE bodies never claim deleted and retries remain bounded',async()=>{const api=new FakeAPI(),original=api.request.bind(api),trace=[];api.request=async function(method,url,body,options){if(method==='DELETE'){this.calls.push({method,url,body});return{deleted:true}}return original(method,url,body,options)};const result=await runAgent(api,payload,{onTrace:x=>trace.push(x)});assert.equal(result.cleanup,'failed');assert.equal(api.calls.filter(x=>x.method==='DELETE').length,2);assert.ok(trace.some(x=>x.stage==='agent.cleanup.failed'));assert.ok(!trace.some(x=>x.stage==='agent.cleanup.deleted'))});

test('active deletion conflict polls and retries instead of treating accepted cancel as a deletion',async()=>{const api=new FakeAPI({noTerminal:true}),original=api.request.bind(api);let attempts=0;api.request=async function(method,url,body,options){if(method==='DELETE'&&++attempts===1){this.calls.push({method,url,body});throw Error('active conflict')}return original(method,url,body,options)};const trace=[];await assert.rejects(runAgent(api,payload,{onTrace:x=>trace.push(x)}));assert.equal(attempts,2);assert.ok(api.calls.some((x,i)=>x.method==='GET'&&api.calls.slice(0,i).some(y=>y.method==='DELETE')));assert.ok(trace.some(x=>x.stage==='agent.cleanup.deleted'))});


test('cleanup failures expose only a bounded reason, HTTP status and delete-attempt count',async()=>{
 for(const entry of [
  {error:new ApiError('API_ERROR',409),code:'API_ERROR',status:409},
  {error:new ApiError('CANCELLED'),code:'CANCELLED'},
  {error:Object.assign(Error('PRIVATE_RAW_BODY'),{code:'PRIVATE_CODE',status:'PRIVATE_STATUS',headers:{Authorization:'PRIVATE_KEY'}}),code:'CLEANUP_ERROR'},
  {ack:{deleted:true,body:'PRIVATE_RAW_BODY'},code:'INVALID_DELETE_ACK'}
 ]){
  const api=new FakeAPI(),original=api.request.bind(api),trace=[];
  api.request=async function(method,url,body,options){if(method==='DELETE'){this.calls.push({method,url});if(entry.error)throw entry.error;return entry.ack;}return original(method,url,body,options)};
  const result=await runAgent(api,payload,{onTrace:value=>trace.push(value)});
  assert.equal(result.cleanup,'failed');
  const diagnostic=trace.find(value=>value.stage==='agent.cleanup.failed');
  assert.deepEqual(diagnostic,{stage:'agent.cleanup.failed',cleanupAttempts:2,cleanupCode:entry.code,...(entry.status?{httpStatus:entry.status}:{})});
  assert.equal(api.calls.filter(value=>value.method==='DELETE').length,2);
  assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE_|sess_test|Authorization|https:|token/);
  parseDemoReply({id:'cleanup',type:'trace',ok:true,trace:{sequence:1,...diagnostic}},'cleanup');
 }
});

test('successful retry reports attempts without stale failure status or reason',async()=>{
 const api=new FakeAPI(),original=api.request.bind(api),trace=[];let deletes=0;
 api.request=async function(method,url,body,options){if(method==='DELETE'&&++deletes===1)throw new ApiError('API_ERROR',409);return original(method,url,body,options)};
 const result=await runAgent(api,payload,{onTrace:value=>trace.push(value)});
 assert.equal(result.cleanup,'deleted');
 assert.deepEqual(trace.find(value=>value.stage==='agent.cleanup.deleted'),{stage:'agent.cleanup.deleted',cleanupAttempts:2});
});

test('cleanup trace validation rejects invented reasons, counts, stages and raw diagnostic detail',()=>{
 const reply=trace=>({id:'cleanup',type:'trace',ok:true,trace:{sequence:1,stage:'agent.cleanup.failed',cleanupCode:'CLEANUP_ERROR',cleanupAttempts:2,...trace}});
 for(const trace of [{cleanupCode:'PRIVATE_RAW_BODY'},{cleanupAttempts:3},{cleanupAttempts:-1},{cleanupAttempts:1.5},{cleanupAttempts:'2'},{stage:'agent.complete'},{stage:'agent.cleanup.deleted'},{httpStatus:600},{body:'PRIVATE_RAW_BODY'},{headers:{Authorization:'PRIVATE_KEY'}},{url:'https://evil.invalid'}])assert.throws(()=>parseDemoReply(reply(trace),'cleanup'));
 const missing=reply({});delete missing.trace.cleanupAttempts;assert.throws(()=>parseDemoReply(missing,'cleanup'));
});
