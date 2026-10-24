import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFormInput,parseLocalRequest,parseNativeReply,parseStatus,parsePageReply,withinMessageBudget} from '../src/validation';
import {profileFromForm,parsePageSource,parseExplanation,resolveZip} from '../src/core';
import {LocalModelClient} from '../src/native';
const form={condition:"Sjo\u0308gren’s syndrome; ألم مزمن",notes:'Symptoms on multiple days.',age:'0.5',sex:'prefer_not_to_say',zip:'01001-1234',radius:'100'};
const zips={zips:{'01001':{city:'Agawam',state:'MA',lat:42.06,lon:-72.61}}};
const statusRequest={id:'request_1',type:'status',payload:{}} as const;

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

test('cross-context requests require exact schemas, real string IDs, model names and UTF-8 bounds',()=>{
 assert.deepEqual(parseLocalRequest(statusRequest),statusRequest);assert.throws(()=>parseLocalRequest(Object.create(statusRequest)));
 for(const id of ['',123,'a'.repeat(81),'space id','../path'])assert.throws(()=>parseLocalRequest({...statusRequest,id}));
 for(const payload of [[],new Date(),{unexpected:'value'}])assert.throws(()=>parseLocalRequest({...statusRequest,payload}));
 assert.throws(()=>parseLocalRequest({...statusRequest,extra:'not accepted'}));
 assert.throws(()=>parseLocalRequest({id:'cancel',type:'cancel',payload:{requestId:123}}));
 for(const model of ['remote:cloud','../model','https://provider.example/model'])assert.throws(()=>parseLocalRequest({id:'generate',type:'generate',payload:{model,prompt:'Question'}}));
 assert.throws(()=>parseLocalRequest({id:'generate',type:'generate',payload:{model:'installed:local',prompt:'x'.repeat(24001)}}));
 assert.throws(()=>withinMessageBudget({text:'\uffff'.repeat(40000)}),/size limit/);
 assert.doesNotThrow(()=>parseLocalRequest({id:'generate',type:'generate',payload:{model:'installed:local',prompt:'é'.repeat(20000)}}));
});

test('native replies are correlated, bounded and sanitized before the panel sees them',()=>{
 const reply={id:'request_1',type:'status',ok:true,models:[{name:'installed:local',size:123}]};assert.equal(parseNativeReply(reply,statusRequest).ok,true);
 for(const bad of [{...reply,id:'other'},{...reply,models:[{name:'model:cloud'}]},{...reply,models:[{name:'installed:local',size:Infinity}]},{...reply,models:[{name:'installed:local'},{name:'installed:local'}]}])assert.throws(()=>parseNativeReply(bad,statusRequest));
 const failure=parseNativeReply({id:'request_1',type:'status',ok:false,models:[],message:'SyntheticPrivateName'},statusRequest);assert.doesNotMatch(JSON.stringify(failure),/SyntheticPrivateName/);
 assert.throws(()=>parseStatus({ok:true,models:Array(101).fill({name:'installed:local'})}));
 assert.throws(()=>parseNativeReply({id:'request_1',type:'result',ok:true,text:'x'.repeat(100000)}, {id:'request_1',type:'generate'}));
});

test('page source is revalidated and canonicalized without private query/hash data',()=>{
 const source=parsePageSource(parsePageReply({ok:true,source:{url:'https://www.clinicaltrials.gov/study/NCT12345678?cond=SyntheticPrivateName#details',title:'Study',text:'Study criteria to confirm.'}}));
 assert.equal(source.url,'https://clinicaltrials.gov/study/NCT12345678');assert.doesNotMatch(source.url,/SyntheticPrivateName/);
 assert.equal(parsePageSource({url:'https://clinicaltrials.gov/search?cond=condition',title:'Search',text:'Public study listings'}).url,'https://clinicaltrials.gov/search');
 assert.throws(()=>parsePageReply({ok:true,source:[]}));assert.throws(()=>parsePageSource({...source,nctId:'NCT87654321'}));
 assert.throws(()=>parsePageSource({...source,text:'SyntheticPrivateName\u0000'}));
});

test('model JSON is bounded before parsing and does not silently truncate unsafe output',()=>{
 const valid={summary:'Ask the study team.',questions:['What criteria need confirmation?'],cautions:['Eligibility remains unknown.']};assert.deepEqual(parseExplanation(JSON.stringify(valid)),valid);
 for(const value of [{...valid,summary:'x'.repeat(1801)},{...valid,questions:Array(9).fill('Question?')},{...valid,cautions:Array(7).fill('Unknown')},{...valid,tools:[{url:'https://example.org'}]},{...valid,summary:'SyntheticPrivateName\u202e'}])assert.throws(()=>parseExplanation(JSON.stringify(value)));
 assert.throws(()=>parseExplanation(' '.repeat(16001)));assert.throws(()=>parseExplanation('{SyntheticPrivateName'),error=>error instanceof Error&&!error.message.includes('SyntheticPrivateName'));
});

test('local client validates status and successful generation through the message boundary',async()=>{
 const client=new LocalModelClient({sendMessage:async(message:any)=>message.request.type==='status'?{id:message.request.id,type:'status',ok:true,models:[{name:'installed:local'}]}:{id:message.request.id,type:'result',ok:true,text:'A valid local response'}});
 assert.equal((await client.status()).models[0].name,'installed:local');assert.equal(await client.generate('installed:local','A question',new AbortController().signal),'A valid local response');
 const bad=new LocalModelClient({sendMessage:async()=>({ok:true,text:'SyntheticPrivateName'})});await assert.rejects(bad.generate('installed:local','A question',new AbortController().signal),error=>error instanceof Error&&!error.message.includes('SyntheticPrivateName'));
});
