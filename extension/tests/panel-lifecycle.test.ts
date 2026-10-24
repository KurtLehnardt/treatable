// Pen-test regressions for the side-panel lifecycle: L4 (independent Agents), M3 (expiry never aborts a send),
// M2 (End session waits, bounded, for provider cleanup) and L7 (hidden-panel grace period).
import {PUBLIC_CONDITIONS,PUBLIC_STUDY_IDS} from '../shared/public-catalog.mjs';
import {getDemoFixture} from '../shared/demo-fixtures.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import React from 'react';import TestRenderer,{act,type ReactTestRenderer} from 'react-test-renderer';
import {PanelB} from '../src/panel-b-view';import type {PanelController} from '../src/use-panel-controller';import {FakeRuntime,manualTimers} from './fake-panel-runtime';import {DemoClient} from '../src/native';
const studies=JSON.parse(readFileSync(new URL('../../scaffold/data/studies.json',import.meta.url),'utf8')),zips=JSON.parse(readFileSync(new URL('../../scaffold/data/us-zip-centroids.json',import.meta.url),'utf8'));
let runtime:FakeRuntime,vm:PanelController;
const documentEvents=new EventTarget() as EventTarget&{visibilityState:string};documentEvents.visibilityState='visible';const windowEvents=new EventTarget();
Object.defineProperty(globalThis,'document',{configurable:true,value:documentEvents});Object.defineProperty(globalThis,'window',{configurable:true,value:windowEvents});
Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(path:string)=>({json:async()=>path.endsWith('studies.json')?studies:zips})});
const {usePanelController,HIDDEN_GRACE_MS,END_CLEANUP_MS}=await import('../src/use-panel-controller');
function Probe(){vm=usePanelController();return React.createElement(PanelB,{controller:vm})}
async function mount(){runtime=new FakeRuntime();documentEvents.visibilityState='visible';const area={async remove(){}};Object.defineProperty(globalThis,'chrome',{configurable:true,value:{runtime,storage:{session:area,local:area}}});let renderer!:ReactTestRenderer;await act(async()=>{renderer=TestRenderer.create(React.createElement(Probe),{createNodeMock:()=>({focus:()=>{}})})});assert.equal(vm.ready,true);return renderer}
function profile(){act(()=>{vm.edit('condition','fibromyalgia');vm.edit('age','45');vm.edit('notes','REAL_PATIENT_CANARY_7149')});act(()=>{vm.applySearch()});assert.ok(vm.matches.length)}
const button=(renderer:ReactTestRenderer,label:string)=>renderer.root.findAllByType('button').find(b=>b.children.includes(label))!;
const last=()=>runtime.operations.at(-1)!;
function agentReply(operation=last(),cleanup:'deleted'|'failed'='deleted'){const f=getDemoFixture(operation.request.payload.fixtureId);operation.port.reply({id:operation.request.id,type:'result',ok:true,result:{kind:'agentDemo',fixtureId:f.id,mode:'test',comparisons:f.studies.map(s=>({nctId:s.id,questionIds:['eligibility']})),cautionIds:['team_confirms','snapshot','no_benefit_promise'],toolCalls:2,cleanup}})}
const trace=(stage:string,operation=last())=>operation.port.reply({id:operation.request.id,type:'trace',ok:true,trace:{sequence:1,stage}});
const cancels=()=>runtime.sent.filter(m=>m.request?.type==='cancel');

test('L4: Agents runs once consent is given, without and after a failed Decisions run, and keeps its result when Decisions reruns',async()=>{
 const renderer=await mount();act(()=>button(renderer,'API demo').props.onClick());
 assert.equal(button(renderer,'2. Run Agents task').props.disabled,true,'consent still gates Agents');
 act(()=>vm.approveDemo(true));assert.equal(button(renderer,'2. Run Agents task').props.disabled,false,'no Decisions result needed');
 let task!:Promise<void>;act(()=>{task=vm.runDemo('scoreDemo')});assert.equal(button(renderer,'2. Run Agents task').props.disabled,true,'busy still gates Agents');runtime.fail('API_ERROR');await act(async()=>{await task});
 assert.equal(vm.scores,undefined);assert.equal(button(renderer,'2. Run Agents task').props.disabled,false,'a failed Decisions run leaves Agents reachable');
 act(()=>{task=vm.runDemo('agentDemo')});assert.equal(last().request.type,'agentDemo');assert.deepEqual(last().request.payload,{fixtureId:'fibromyalgia',consent:true});trace('agent.request');agentReply();await act(async()=>{await task});assert.equal(vm.agent?.cleanup,'deleted');
 act(()=>{task=vm.runDemo('scoreDemo')});runtime.score();await act(async()=>{await task});assert.ok(vm.scores);assert.ok(vm.agent,'Decisions rerun does not discard the independent Agents result');assert.ok(vm.trace.some(t=>t.stage==='agent.request'));
 act(()=>vm.approveDemo(false));assert.equal(button(renderer,'2. Run Agents task').props.disabled,true);
 act(()=>renderer.unmount());
});

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
function realPacket(){return {ageBand:'45_59' as const,state:'ID',conditionIds:[PUBLIC_CONDITIONS[0].id],selectedNctIds:[PUBLIC_STUDY_IDS[0]]}}
async function prepareReal(expiresIn:number){act(()=>{vm.real.edit(realPacket());vm.real.acceptPolicy()});let task!:Promise<void>;act(()=>{task=vm.real.prepare()});runtime.prepared(undefined,Date.now()+expiresIn);await act(async()=>{await task});assert.ok(vm.real.prepared);act(()=>vm.real.confirm(true));assert.equal(vm.real.confirmed,true)}
const revokes=()=>runtime.sent.filter(m=>m.request?.type==='revokeReal').length;
const executes=()=>runtime.operations.filter(o=>o.request.type==='executeReal').length;
test('M3: preview expiry during an in-flight real send neither aborts nor discards it; it only blocks further sends',async()=>{
 const renderer=await mount();await prepareReal(250);let task!:Promise<void>;act(()=>{task=vm.real.run('score')});const sent=last();assert.equal(sent.request.type,'executeReal');const revokedBefore=revokes();
 await act(async()=>{await sleep(400)});
 assert.equal(vm.real.busy,true,'still running after expiry');assert.equal(cancels().length,0,'no cancel was sent');assert.equal(revokes(),revokedBefore,'token not revoked while its send runs');assert.equal(vm.real.error,'');
 runtime.realScore(sent,realPacket().selectedNctIds);await act(async()=>{await task});
 assert.equal(vm.real.score?.mode,'test','result of the running send is kept');assert.equal(vm.real.prepared,undefined,'expired preview retired after settling');assert.equal(vm.real.confirmed,false);assert.equal(revokes(),revokedBefore+1);assert.match(vm.real.error,/expired while the sent operation finished; its result is kept/);
 act(()=>vm.real.confirm(true));await act(async()=>{await vm.real.run('agent')});assert.equal(executes(),1,'expiry blocks starting another send');
 act(()=>renderer.unmount());
});
test('M3: idle expiry after one completed send keeps that result and still blocks the other operation',async()=>{
 const renderer=await mount();await prepareReal(250);let task!:Promise<void>;act(()=>{task=vm.real.run('score')});runtime.realScore(last(),realPacket().selectedNctIds);await act(async()=>{await task});assert.ok(vm.real.score);act(()=>vm.real.confirm(true));
 await act(async()=>{await sleep(400)});
 assert.ok(vm.real.score,'completed result kept');assert.equal(vm.real.prepared,undefined);assert.equal(vm.real.confirmed,false);assert.match(vm.real.error,/^Prepared preview expired/);
 await act(async()=>{await vm.real.run('agent')});assert.equal(executes(),1);
 act(()=>renderer.unmount());
});

const setVisibility=(state:'hidden'|'visible',dispatch=true)=>{documentEvents.visibilityState=state;if(dispatch)documentEvents.dispatchEvent(new Event('visibilitychange'))};
async function withTimers(body:(timers:ReturnType<typeof manualTimers>)=>Promise<void>){const timers=manualTimers([HIDDEN_GRACE_MS,END_CLEANUP_MS]);try{await body(timers)}finally{timers.restore();documentEvents.visibilityState='visible'}}
function demoState(){return {condition:vm.form.condition,ready:vm.ready,consent:vm.consent,scores:!!vm.scores,matches:vm.matches.length>0}}
async function scoredSession(){const renderer=await mount();profile();act(()=>vm.approveDemo(true));let task!:Promise<void>;act(()=>{task=vm.runDemo('scoreDemo')});runtime.score();await act(async()=>{await task});assert.ok(vm.scores);return renderer}
const live={condition:'fibromyalgia',ready:true,consent:true,scores:true,matches:true};

test('L7: hiding the panel (e.g. opening a study link) keeps the session; returning cancels the grace timer',async()=>withTimers(async timers=>{
 const renderer=await scoredSession();
 act(()=>setVisibility('hidden'));assert.deepEqual(demoState(),live,'hide alone clears nothing');assert.equal(runtime.ports[0].closed,false);assert.equal(timers.pending(HIDDEN_GRACE_MS),1);
 act(()=>setVisibility('hidden'));assert.equal(timers.pending(HIDDEN_GRACE_MS),1,'repeated hide events do not stack timers');
 act(()=>setVisibility('visible'));assert.equal(timers.pending(HIDDEN_GRACE_MS),0,'visible cancels the timer');assert.deepEqual(demoState(),live);
 act(()=>setVisibility('hidden'));act(()=>{setVisibility('visible',false);timers.fire(HIDDEN_GRACE_MS)});assert.deepEqual(demoState(),live,'a timer firing while visible clears nothing');
 act(()=>setVisibility('hidden'));assert.equal(timers.pending(HIDDEN_GRACE_MS),1);act(()=>{timers.fire(HIDDEN_GRACE_MS)});
 assert.deepEqual(demoState(),{condition:'',ready:false,consent:false,scores:false,matches:false},'still hidden after the grace period: cleared');assert.equal(runtime.ports[0].closed,true);assert.match(vm.notice,/^Session ended\. Panel inputs/);
 act(()=>setVisibility('visible'));act(()=>setVisibility('hidden'));assert.equal(timers.pending(HIDDEN_GRACE_MS),0,'an ended session arms no further timer');
 act(()=>renderer.unmount());setVisibility('hidden');assert.equal(timers.pending(HIDDEN_GRACE_MS),0,'listeners removed on unmount');
}));
test('L7: hiding never aborts an in-flight operation; an expired grace period clears only after it settles, unless the panel returns',async()=>withTimers(async timers=>{
 for(const back of [false,true]){const renderer=await mount();profile();act(()=>vm.approveDemo(true));let task!:Promise<void>;act(()=>{task=vm.runDemo('agentDemo')});const operation=last();
  act(()=>setVisibility('hidden'));act(()=>{timers.fire(HIDDEN_GRACE_MS)});
  assert.equal(cancels().length,0,'no cancel on hide');assert.equal(runtime.ports[0].closed,false);assert.equal(vm.demoBusy,true);assert.equal(vm.form.condition,'fibromyalgia');
  if(back)act(()=>setVisibility('visible'));
  trace('agent.cleanup.deleted',operation);agentReply(operation);await act(async()=>{await task});
  if(back){assert.equal(vm.agent?.cleanup,'deleted','returned in time: result kept');assert.equal(vm.ready,true)}
  else{assert.equal(vm.agent,undefined,'still hidden: cleared after the operation finished');assert.equal(vm.ready,false);assert.equal(vm.form.condition,'');assert.equal(runtime.ports[0].closed,true)}
  act(()=>renderer.unmount());documentEvents.visibilityState='visible'}
}));
test('L7/M2: pagehide still clears and disconnects immediately, even during an operation or while End session is waiting',async()=>withTimers(async timers=>{
 for(const during of ['operation','ending']){const renderer=await mount();profile();act(()=>vm.approveDemo(true));let task!:Promise<void>;act(()=>{task=vm.runDemo('agentDemo')});
  if(during==='ending'){act(()=>vm.endSession());assert.equal(vm.ending,true);assert.equal(runtime.ports[0].closed,false)}
  await act(async()=>{windowEvents.dispatchEvent(new Event('pagehide'));await task});
  assert.equal(runtime.ports[0].closed,true);assert.equal(vm.ready,false);assert.equal(vm.ending,false);assert.equal(vm.form.condition,'');assert.match(vm.notice,/^Session ended\. Panel inputs/);
  act(()=>renderer.unmount())}
}));

async function endDuring(type:'scoreDemo'|'agentDemo'){const renderer=await mount();profile();act(()=>vm.approveDemo(true));let task!:Promise<void>;act(()=>{task=vm.runDemo(type)});const operation=last();
 act(()=>button(renderer,'End session').props.onClick({type:'click'}));
 assert.deepEqual([vm.form.condition,vm.profile,vm.consent,vm.ready,vm.matches.length],['',undefined,false,false,0],'panel data clears at once');
 assert.equal(vm.ending,true);assert.match(vm.notice,/^Ending… cleaning up provider session/);assert.equal(runtime.ports[0].closed,false,'transport kept for cleanup');
 assert.deepEqual(cancels().map(m=>m.request.payload.requestId),[operation.request.id],'exactly one cancel for the running operation');
 assert.equal(button(renderer,'Start blank session / retry cleanup').props.disabled,true);
 return{renderer,operation,task}}
test('M2: End session during an Agents run cancels, waits for the cleanup reply, then disconnects and reports the outcome',async()=>withTimers(async timers=>{
 for(const[stage,expected]of [['agent.cleanup.deleted',/^Session ended\. Provider session cleanup: delete request accepted/],['agent.cleanup.failed',/^Session ended\. Provider session cleanup failed—provider state may remain/]]as const){
  const{renderer,operation,task}=await endDuring('agentDemo');assert.equal(timers.pending(END_CLEANUP_MS),1);
  await act(async()=>{trace(stage,operation);runtime.fail('CANCELLED',operation);await task});
  assert.equal(runtime.ports[0].closed,true);assert.equal(vm.ending,false);assert.match(vm.notice,expected);assert.match(vm.notice,/Panel inputs and results were cleared/);assert.equal(timers.pending(END_CLEANUP_MS),0);
  assert.deepEqual([vm.agent,vm.trace.length,vm.demoError,vm.demoFailure],[undefined,0,'',''],'late cleanup replies restore nothing');
  act(()=>renderer.unmount())}
}));
test('M2: a completed reply after End session is not shown; a Decisions stop and a missing reply are reported honestly',async()=>withTimers(async timers=>{
 {const{renderer,operation,task}=await endDuring('agentDemo');await act(async()=>{agentReply(operation,'deleted');await task});assert.equal(vm.agent,undefined);assert.match(vm.notice,/delete request accepted/);assert.equal(runtime.ports[0].closed,true);act(()=>renderer.unmount())}
 {const{renderer,operation,task}=await endDuring('scoreDemo');await act(async()=>{runtime.fail('CANCELLED',operation);await task});assert.match(vm.notice,/^Session ended\. The helper confirmed the in-flight Decisions request stopped/);assert.equal(vm.scores,undefined);act(()=>renderer.unmount())}
 {const{renderer,operation,task}=await endDuring('agentDemo');assert.equal(runtime.ports[0].closed,false);await act(async()=>{timers.fire(END_CLEANUP_MS);await task});
  assert.equal(runtime.ports[0].closed,true,'bounded: disconnects after END_CLEANUP_MS');assert.match(vm.notice,/^Session ended\. Provider session cleanup not confirmed/);assert.equal(vm.ending,false);
  trace('agent.cleanup.deleted',operation);runtime.fail('CANCELLED',operation);assert.match(vm.notice,/not confirmed/,'a reply after disconnect changes nothing');act(()=>renderer.unmount())}
}));
test('M2: End session during a real Agents send waits for its cleanup too; with nothing in flight it disconnects at once',async()=>withTimers(async timers=>{
 const renderer=await mount();await prepareReal(300000);let task!:Promise<void>;act(()=>{task=vm.real.run('agent')});const sent=last();assert.equal(sent.request.payload.operation,'agent');
 act(()=>vm.endSession());assert.equal(vm.ending,true);assert.equal(vm.real.accepted,false);assert.equal(vm.real.prepared,undefined);assert.ok(cancels().some(m=>m.request.payload.requestId===sent.request.id));assert.equal(runtime.ports[0].closed,false);
 await act(async()=>{trace('agent.cleanup.deleted',sent);runtime.fail('CANCELLED',sent);await task});assert.equal(runtime.ports[0].closed,true);assert.match(vm.notice,/delete request accepted/);assert.equal(vm.real.agent,undefined);assert.deepEqual(vm.real.trace,[]);act(()=>renderer.unmount());
 const idle=await scoredSession();act(()=>vm.endSession());assert.equal(vm.ending,false);assert.equal(runtime.ports[0].closed,true);assert.equal(timers.pending(END_CLEANUP_MS),0);assert.match(vm.notice,/^Session ended\. Panel inputs and results were cleared/);act(()=>idle.unmount());
}));
test('M2: DemoClient.drain is bounded, sends one cancel per provider operation and never closes a newer port',async()=>withTimers(async timers=>{
 const runtime=new FakeRuntime(),client=new DemoClient(runtime);await client.open(()=>{});assert.equal(client.hasProviderOperation(),false);
 const controller=new AbortController(),task=client.run('agentDemo','fibromyalgia',true,()=>{},controller.signal);const status=client.status().catch(()=>'rejected');assert.equal(client.hasProviderOperation(),true);controller.abort();
 const outcome=client.drain(END_CLEANUP_MS);assert.equal(runtime.sent.filter(m=>m.request?.type==='cancel').length,1,'abort and drain share one cancel');
 client.disconnect();await assert.rejects(task);await client.open(()=>{});assert.equal(runtime.ports.length,2);assert.equal(await outcome,'unconfirmed');assert.equal(await status,'rejected','non-provider requests are rejected on disconnect');
 timers.fire(END_CLEANUP_MS);assert.equal(runtime.ports[1].closed,false,'the newer session port stays open');assert.equal(await client.drain(END_CLEANUP_MS),'none');assert.equal(runtime.ports[1].closed,true);
}));
