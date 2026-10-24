import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import TestRenderer,{act,type ReactTestRenderer} from 'react-test-renderer';
import {PanelB} from '../src/panel-b-view';
import type {PanelController} from '../src/use-panel-controller';
import {STORAGE_KEY,type StorageArea} from '../src/storage';

class Area implements StorageArea{
 data:Record<string,unknown>={};
 async get(key:string){return {[key]:this.data[key]}}
 async set(value:Record<string,unknown>){Object.assign(this.data,value)}
 async remove(key:string){delete this.data[key]}
 async setAccessLevel(){/* trusted-context behavior is covered by storage.test.ts */}
}
const studies=JSON.parse(readFileSync(new URL('../../scaffold/data/studies.json',import.meta.url),'utf8'));
const zips=JSON.parse(readFileSync(new URL('../../scaffold/data/us-zip-centroids.json',import.meta.url),'utf8'));
let session=new Area(),local=new Area(),messages:any[]=[],pendingGenerate:((v:any)=>void)|undefined,pendingPage:((v:any)=>void)|undefined;
const runtime={getURL:(path:string)=>path,sendMessage:async(message:any)=>{
 messages.push(message);
 if(message.kind==='readPage')return await new Promise(resolve=>{pendingPage=resolve});
 if(message.kind==='nativeDisconnect')return{ok:true};
 if(message.request?.type==='status')return{ok:true,models:[{name:'installed:local'}],message:'Local model available.'};
 if(message.request?.type==='generate')return await new Promise(resolve=>{pendingGenerate=resolve});
 return{ok:true};
}};
Object.defineProperty(globalThis,'chrome',{configurable:true,value:{runtime,storage:{get session(){return session},get local(){return local}}}});
Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(path:string)=>({json:async()=>path.endsWith('studies.json')?studies:zips})});
const {usePanelController}=await import('../src/use-panel-controller');
let vm:PanelController;
let focusEvents:string[]=[];
function Probe(){vm=usePanelController();return React.createElement(PanelB,{controller:vm})}
async function mount(){session=new Area();local=new Area();messages=[];pendingGenerate=undefined;pendingPage=undefined;focusEvents=[];let renderer!:ReactTestRenderer;await act(async()=>{renderer=TestRenderer.create(React.createElement(Probe),{createNodeMock:element=>({focus:()=>focusEvents.push(element.props.id)})});});assert.equal(vm.ready,true);return renderer}
function updateProfile(){act(()=>{vm.edit('condition','fibromyalgia');vm.edit('age','45');vm.edit('sex','female');vm.edit('zip','83702');});act(()=>{vm.applySearch()});assert.ok(vm.matches.length>0)}
function hash(path:string){return createHash('sha256').update(readFileSync(new URL(path,import.meta.url))).digest('hex')}

test('A and B retain identical extension identity, permissions, worker, and data provenance',()=>{
 const a=JSON.parse(readFileSync(new URL('../dist/manifest.json',import.meta.url),'utf8'));
 const b=JSON.parse(readFileSync(new URL('../dist-b/manifest.json',import.meta.url),'utf8'));
 assert.match(b.name,/Version B/);b.name=a.name;assert.deepEqual(a,b);
 for(const file of ['background.js','data/studies.json','data/us-zip-centroids.json','data/provenance.json'])assert.equal(hash('../dist/'+file),hash('../dist-b/'+file),file);
});

test('shared controller preserves search, save/remember, and clear behavior through the B view',async()=>{
 const renderer=await mount();updateProfile();const ids=vm.matches.map(m=>m.study.id);const first=ids[0];
 act(()=>{vm.toggleSave(first)});await act(async()=>{vm.updateRemember(true)});
 assert.deepEqual(vm.saved,[first]);assert.ok(local.data[STORAGE_KEY]);assert.equal(session.data[STORAGE_KEY],undefined);
 const nav=renderer.root.findByProps({'aria-label':'Panel sections'});
 act(()=>nav.findAllByType('button')[1].props.onClick());assert.equal(vm.tab,'results');
 assert.equal(renderer.root.findAllByType('article').length,ids.length);
 act(()=>nav.findAllByType('button')[2].props.onClick());assert.equal(vm.tab,'saved');assert.equal(renderer.root.findAllByType('article').length,1);
 await act(async()=>{await vm.clearEverything()});
 assert.equal(vm.form.condition,'');assert.deepEqual(vm.matches,[]);assert.deepEqual(vm.saved,[]);assert.equal(vm.profile,undefined);
 assert.deepEqual(local.data,{});assert.deepEqual(session.data,{});assert.ok(messages.some(m=>m.kind==='nativeDisconnect'));
 act(()=>renderer.unmount());
});

test('late local generation and page reads cannot restore patient analysis after clear or edit',async()=>{
 const renderer=await mount();updateProfile();await act(async()=>{await vm.checkModels()});
 let generation!:Promise<void>;act(()=>{generation=vm.explain()});assert.equal(vm.busy,true);assert.ok(pendingGenerate);
 await act(async()=>{await vm.clearEverything()});
 await act(async()=>{pendingGenerate!({ok:true,text:JSON.stringify({summary:'Ask the study team.',questions:[],cautions:[]})});await generation});
 assert.equal(vm.explanation,undefined);assert.deepEqual(vm.matches,[]);assert.equal(vm.busy,false);assert.ok(messages.some(m=>m.request?.type==='cancel'));
 updateProfile();let page!:Promise<void>;act(()=>{page=vm.analyzePage()});assert.ok(pendingPage);
 act(()=>{vm.edit('condition','neuropathy')});
 await act(async()=>{pendingPage!({ok:true,source:{kind:'clinicaltrials',url:'https://clinicaltrials.gov/study/'+studies[0].id,title:'Late study',text:'Study text',nctId:studies[0].id}});await page});
 assert.equal(vm.source,undefined);assert.deepEqual(vm.matches,[]);assert.equal(vm.form.condition,'neuropathy');
 act(()=>renderer.unmount());
});

test('B presents truthful unchecked status, labelled controls, and clear static navigation states',async()=>{
 const renderer=await mount();
 const html=renderToStaticMarkup(React.createElement(PanelB,{controller:vm}));
 assert.match(html,/Model not checked/);assert.match(html,/Local only/);assert.match(html,/aria-current="page"/);
 assert.match(html,/Medical condition or symptoms/);assert.match(html,/Sex for study criteria/);assert.match(html,/not encrypted/);
 assert.doesNotMatch(html,/Local model available/);assert.equal(renderer.root.findAllByType('nav').length,1);
 const nav=renderer.root.findByProps({'aria-label':'Panel sections'});assert.equal(nav.findAllByType('button').length,3);
 act(()=>renderer.unmount());
});

test('B keeps cancellation available after navigating away from an active local explanation',async()=>{
 const renderer=await mount();updateProfile();await act(async()=>{await vm.checkModels()});const ids=vm.matches.map(m=>m.study.id);
 let generation!:Promise<void>;act(()=>{generation=vm.explain()});assert.equal(vm.busy,true);
 const nav=renderer.root.findByProps({'aria-label':'Panel sections'});act(()=>nav.findAllByType('button')[2].props.onClick());
 assert.equal(vm.tab,'saved');act(()=>renderer.root.findByProps({'aria-label':'Stop local explanation'}).props.onClick());
 assert.equal(vm.busy,false);assert.deepEqual(vm.matches.map(m=>m.study.id),ids);
 await act(async()=>{pendingGenerate!({ok:true,text:JSON.stringify({summary:'Late draft',questions:[],cautions:[]})});await generation});
 assert.equal(vm.explanation,undefined);assert.ok(messages.some(m=>m.request?.type==='cancel'));
 act(()=>renderer.unmount());
});

test('B validation errors from Search expose an Edit profile action that focuses the profile heading',async()=>{
 for(const label of ['Search locally','Read ClinicalTrials.gov page']){
  const renderer=await mount();const nav=renderer.root.findByProps({'aria-label':'Panel sections'});act(()=>nav.findAllByType('button')[1].props.onClick());
  const button=renderer.root.findAllByType('button').find(node=>node.children.some(child=>child===label));assert.ok(button);
  await act(async()=>{await button.props.onClick()});assert.ok(vm.error);assert.equal(vm.profile,undefined);
  const edit=renderer.root.findAllByType('button').find(node=>node.children.includes('Edit profile'));assert.ok(edit);
  act(()=>edit.props.onClick());assert.equal(renderer.root.findAllByProps({id:'profile-heading'}).length,1);assert.deepEqual(focusEvents,['profile-heading']);
  act(()=>renderer.unmount());
 }
});
