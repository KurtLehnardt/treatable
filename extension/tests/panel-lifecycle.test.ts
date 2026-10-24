// Pen-test regressions for the side-panel lifecycle: L4 (independent Agents), M3 (expiry never aborts a send),
// M2 (End session waits, bounded, for provider cleanup) and L7 (hidden-panel grace period).
import {PUBLIC_CONDITIONS,PUBLIC_STUDY_IDS} from '../shared/public-catalog.mjs';
import {getDemoFixture} from '../shared/demo-fixtures.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import React from 'react';import TestRenderer,{act,type ReactTestRenderer} from 'react-test-renderer';
import {PanelB} from '../src/panel-b-view';import type {PanelController} from '../src/use-panel-controller';import {FakeRuntime} from './fake-panel-runtime';
const studies=JSON.parse(readFileSync(new URL('../../scaffold/data/studies.json',import.meta.url),'utf8')),zips=JSON.parse(readFileSync(new URL('../../scaffold/data/us-zip-centroids.json',import.meta.url),'utf8'));
let runtime:FakeRuntime,vm:PanelController;
const documentEvents=new EventTarget() as EventTarget&{visibilityState:string};documentEvents.visibilityState='visible';const windowEvents=new EventTarget();
Object.defineProperty(globalThis,'document',{configurable:true,value:documentEvents});Object.defineProperty(globalThis,'window',{configurable:true,value:windowEvents});
Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(path:string)=>({json:async()=>path.endsWith('studies.json')?studies:zips})});
const {usePanelController}=await import('../src/use-panel-controller');
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
