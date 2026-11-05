import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedText} from '../src/validation';
import {resolveZip} from '../src/core';
import {parseDemoReply} from '../shared/demo-contract.mjs';
import {parseApplyRequest} from '../shared/apply-contract.mjs';
const revokeRequest={id:'request_1',type:'revokeStudyBrief',payload:{}};

/* The patient form and page-source parsers these tests first covered were removed with the private-matching form. boundedText remains for
 * the offline ZIP lookup, and the helper request and reply contracts remain for the study brief. */
test('bounded text rejects dangerous controls, lone surrogates, line breaks and overlong values, and never echoes the input in errors',()=>{
 for(const value of ['SyntheticPrivateName\u0000','SyntheticPrivateName‮','SyntheticPrivateName\uD800','SyntheticPrivateName\nsecond line','x'.repeat(11)])
  assert.throws(()=>boundedText(value,'ZIP code',10),error=>error instanceof Error&&!error.message.includes('SyntheticPrivateName'));
 for(const value of [undefined,12345,{},['01001']])assert.throws(()=>boundedText(value,'ZIP code',10));
 assert.equal(boundedText(' 01001 ','ZIP code',10),'01001');assert.equal(boundedText('Line one\nLine two','Notes',40,{multiline:true}),'Line one\nLine two');
 assert.throws(()=>boundedText('   ','City',10,{empty:false}),/required/);
});
test('the offline ZIP lookup refuses malformed codes and invalid coordinates',()=>{
 const zips={zips:{'01001':{city:'Agawam',state:'MA',lat:42.06,lon:-72.61}}};
 assert.equal(resolveZip('01001-1234',zips).zip,'01001');
 for(const zip of ['1001','010011','01001-123','01001-12345','0x1001'])assert.throws(()=>resolveZip(zip,zips),zip);
 assert.throws(()=>resolveZip('01001',{zips:{'01001':{city:'Agawam',state:'MA',lat:NaN,lon:-72}}}));
 assert.throws(()=>resolveZip('01001',{zips:{'01001':{city:'Agawam',state:'Massachusetts',lat:42,lon:-72}}}));
});

test('cross-context helper requests require exact schemas, real string IDs and known operations',()=>{
 assert.deepEqual(parseApplyRequest(revokeRequest),revokeRequest);assert.throws(()=>parseApplyRequest(Object.create(revokeRequest)));
 for(const id of ['',123,'a'.repeat(81),'space id','../path'])assert.throws(()=>parseApplyRequest({...revokeRequest,id}),String(id));
 for(const payload of [[],new Date(),null,'payload'])assert.throws(()=>parseApplyRequest({...revokeRequest,payload}));
 assert.throws(()=>parseApplyRequest({...revokeRequest,extra:'not accepted'}));
 assert.throws(()=>parseApplyRequest({id:'x',type:'localModels',payload:{model:'installed:local'}}),'the local model check takes no input');
 for(const type of ['generate','prompt','fetch','status','cancel','scoreDemo','prepareReal','liveCatalog','prepareApply','executeApply','revokeApply'])
  assert.throws(()=>parseApplyRequest({id:'x',type,payload:{}}),type);
 assert.throws(()=>parseApplyRequest({id:'big',type:'prepareStudyBrief',payload:{nctIds:['NCT12345678'],pad:'￿'.repeat(40000)}}));
});

test('helper replies are correlated, bounded and exact-keyed; a successful result is never accepted without its own contract',()=>{
 const failure={id:'request_1',type:'result',ok:false,code:'API_ERROR',error:'Fixed text.'};assert.equal(parseDemoReply(failure,'request_1').code,'API_ERROR');
 for(const bad of [{...failure,id:'other'},{...failure,error:'x'.repeat(301)},{...failure,code:'lower'},{...failure,code:'A'.repeat(41)},{...failure,code:undefined},{...failure,detail:'SyntheticPrivateName'}])assert.throws(()=>parseDemoReply(bad,'request_1'));
 assert.equal(parseDemoReply({id:'request_1',type:'result',ok:true},'request_1').ok,true,'a bare acknowledgement');
 assert.throws(()=>parseDemoReply({id:'request_1',type:'result',ok:true,result:{kind:'scoreDemo',fixtureId:'fibromyalgia',mode:'test',scores:[]}},'request_1'),'results go through their own operation contract');
 assert.throws(()=>parseDemoReply({id:'request_1',type:'status',ok:true,provider:'openai',configured:true,message:'ready'},'request_1'),'the status operation was removed');
 const trace={id:'request_1',type:'trace',ok:true,trace:{sequence:1,stage:'agent.tool.request',nctId:'NCT12345678'}};assert.equal(parseDemoReply(trace,'request_1').trace?.nctId,'NCT12345678');
 for(const bad of [{...trace,trace:{...trace.trace,section:'eligibility'}},{...trace,trace:{...trace.trace,stage:'invented'}},{...trace,trace:{...trace.trace,sessionId:'bad id!'}},{...trace,extra:'SyntheticPrivateName'}])assert.throws(()=>parseDemoReply(bad,'request_1'));
});
