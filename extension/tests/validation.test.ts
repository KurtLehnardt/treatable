import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFormInput,parsePageReply,withinMessageBudget} from '../src/validation';
import {profileFromForm,parsePageSource,resolveZip} from '../src/core';
import {parseDemoRequest,parseDemoReply} from '../shared/demo-contract.mjs';
import {DemoClient} from '../src/native';
import {FakeRuntime} from './fake-panel-runtime';
const form={condition:"Sjo\u0308gren’s syndrome; ألم مزمن",notes:'Symptoms on multiple days.',age:'0.5',sex:'prefer_not_to_say',zip:'01001-1234',radius:'100'};
const zips={zips:{'01001':{city:'Agawam',state:'MA',lat:42.06,lon:-72.61}}};
const statusRequest={id:'request_1',type:'status',payload:{}};

test('profile validation preserves genuine Unicode, fractional ages and ZIP leading zeros',()=>{
 const input=parseFormInput(form);assert.match(input.condition,/Sjögren/);assert.match(input.condition,/ألم مزمن/);
 const profile=profileFromForm(input,zips);assert.equal(profile.ageYears,.5);assert.equal(profile.location.zip,'01001');assert.equal(profile.primaryDiagnoses.length,2);
 assert.equal(profileFromForm({...form,condition:'',notes:'Undiagnosed symptoms',zip:''},zips).location.lat,undefined);
 for(const age of ['0','120','0.001','001.5'])assert.doesNotThrow(()=>parseFormInput({...form,age}));
});

test('malformed numeric/enumerated form inputs fail without becoming eligibility decisions',()=>{
 for(const age of ['0x20','1e1','Infinity','NaN','-1','120.001','1,5','.5','1.0001'])assert.throws(()=>parseFormInput({...form,age}),/Age|age/);
 for(const radius of ['1e2','0x64','100.0','Infinity','-1'])assert.throws(()=>parseFormInput({...form,radius}),/distance/);
 for(const sex of ['unknown','<script>','MALE'])assert.throws(()=>parseFormInput({...form,sex}));
 for(const zip of ['1001','010011','01001-123','01001-12345'])assert.throws(()=>parseFormInput({...form,zip}));
 assert.throws(()=>resolveZip('01001',{zips:{'01001':{city:'Agawam',state:'MA',lat:NaN,lon:-72}}}));
});

test('patient text is bounded, rejects dangerous controls, and never appears in errors',()=>{
 for(const condition of ['SyntheticPrivateName\u0000','SyntheticPrivateName\u202E','SyntheticPrivateName\uD800','x'.repeat(201),Array(13).fill('condition').join(';')]){
  assert.throws(()=>parseFormInput({...form,condition}),error=>error instanceof Error&&!error.message.includes('SyntheticPrivateName'));
 }
 assert.throws(()=>parseFormInput({...form,notes:'x'.repeat(12001)}));
 assert.doesNotThrow(()=>parseFormInput({...form,notes:'Line one\nLine two\twith spacing'}));
 assert.throws(()=>parseFormInput({...form,condition:'',notes:''}));
 assert.throws(()=>parseFormInput({...form,hiddenHealthField:'not accepted'}));
});

test('cross-context demo requests require exact schemas, real string IDs and UTF-8 bounds',()=>{
 assert.deepEqual(parseDemoRequest(statusRequest),statusRequest);assert.throws(()=>parseDemoRequest(Object.create(statusRequest)));
 for(const id of ['',123,'a'.repeat(81),'space id','../path'])assert.throws(()=>parseDemoRequest({...statusRequest,id}));
 for(const payload of [[],new Date(),{unexpected:'value'}])assert.throws(()=>parseDemoRequest({...statusRequest,payload}));
 assert.throws(()=>parseDemoRequest({...statusRequest,extra:'not accepted'}));
 assert.throws(()=>parseDemoRequest({id:'cancel',type:'cancel',payload:{requestId:123}}));
 for(const type of ['generate','prompt','fetch'])assert.throws(()=>parseDemoRequest({id:'x',type,payload:{model:'installed:local',prompt:'Question'}}));
 assert.throws(()=>parseDemoRequest({id:'big',type:'scoreDemo',payload:{fixtureId:'fibromyalgia',consent:true,studyIds:['NCT12345678'],pad:'\uffff'.repeat(40000)}}));
 assert.throws(()=>withinMessageBudget({text:'\uffff'.repeat(40000)}),/size limit/);
});

test('native replies are correlated, bounded and exact-keyed before the panel sees them',()=>{
 const reply={id:'request_1',type:'status',ok:true,provider:'openai',configured:true,message:'ready'};assert.equal(parseDemoReply(reply,'request_1').ok,true);
 for(const bad of [{...reply,id:'other'},{...reply,provider:'evil'},{...reply,configured:'yes'},{...reply,message:'x'.repeat(301)},{...reply,extra:'SyntheticPrivateName'}])assert.throws(()=>parseDemoReply(bad,'request_1'));
 const failure={id:'request_1',type:'result',ok:false,code:'API_ERROR',error:'Fixed text.'};assert.equal(parseDemoReply(failure,'request_1').code,'API_ERROR');
 for(const bad of [{...failure,error:'x'.repeat(301)},{...failure,code:'lower'},{...failure,code:'A'.repeat(41)},{...failure,code:undefined},{...failure,detail:'SyntheticPrivateName'}])assert.throws(()=>parseDemoReply(bad,'request_1'));
 assert.throws(()=>parseDemoReply({id:'request_1',type:'result',ok:true,result:{kind:'scoreDemo',fixtureId:'fibromyalgia',mode:'test',scores:[{nctId:'NCT12345678',index:50,confidence:.5,note:'free text'}]}},'request_1'));
});

test('page source is revalidated and canonicalized without private query/hash data',()=>{
 const source=parsePageSource(parsePageReply({ok:true,source:{url:'https://www.clinicaltrials.gov/study/NCT12345678?cond=SyntheticPrivateName#details',title:'Study',text:'Study criteria to confirm.'}}));
 assert.equal(source.url,'https://clinicaltrials.gov/study/NCT12345678');assert.doesNotMatch(source.url,/SyntheticPrivateName/);
 assert.equal(parsePageSource({url:'https://clinicaltrials.gov/search?cond=condition',title:'Search',text:'Public study listings'}).url,'https://clinicaltrials.gov/search');
 assert.throws(()=>parsePageReply({ok:true,source:[]}));assert.throws(()=>parsePageSource({...source,nctId:'NCT87654321'}));
 assert.throws(()=>parsePageSource({...source,text:'SyntheticPrivateName\u0000'}));
});

test('current demo client validates correlated status through the per-panel message boundary',async()=>{const runtime=new FakeRuntime(),client=new DemoClient(runtime);await client.open(()=>{});assert.equal((await client.status()).configured,true);const task=client.run('scoreDemo','fibromyalgia',true,()=>{},new AbortController().signal);const operation=runtime.operations[0];operation.port.reply({id:operation.request.id,type:'result',ok:true,result:{kind:'scoreDemo',fixtureId:'pancreatic',mode:'test',scores:[{nctId:'NCT12345678',index:50,confidence:.5}]}});await assert.rejects(task,/Mismatched/);client.disconnect()});
