import test from 'node:test';import assert from 'node:assert/strict';
import{parseDemoResult,parseDemoReply,templateIdList,QUESTION_TEMPLATES}from'../../shared/demo-contract.mjs';
import{parseRealResult}from'../../shared/real-contract.mjs';
import{parseLiveResult,parseLiveReply}from'../../shared/live-analysis-contract.mjs';
import{PUBLIC_STUDY_IDS}from'../../shared/public-catalog.mjs';
const cautions=['team_confirms','snapshot','no_benefit_promise'];
const demo=(comparisons,cautionIds=cautions)=>({kind:'agentDemo',fixtureId:'fibromyalgia',mode:'live',comparisons,cautionIds,toolCalls:2,cleanup:'deleted'});
const real=(comparisons,cautionIds=cautions)=>({kind:'agentReal',mode:'live',consentDigest:'a'.repeat(64),comparisons,cautionIds,toolCalls:2,cleanup:'deleted'});
const [n1,n2]=['NCT06567886','NCT05067998'],[r1,r2]=PUBLIC_STUDY_IDS;
// Pen-test L2: an array element ["eligibility"] coerces to the own key "eligibility", so Object.hasOwn alone accepted it.
const confused=[[['eligibility'],'eligibility','eligibility'],['eligibility','eligibility'],[['eligibility']],[{toString:()=>'eligibility'}],['__proto__'],['toString'],['constructor']];
test('templateIdList requires strings, own fixed-table keys and uniqueness',()=>{
 assert.equal(templateIdList(['eligibility','visits'],QUESTION_TEMPLATES,1,6),true);
 for(const v of [...confused,[],'eligibility',undefined,Array(7).fill(0).map((_,i)=>Object.keys(QUESTION_TEMPLATES)[i%6])])assert.equal(templateIdList(v,QUESTION_TEMPLATES,1,6),false,JSON.stringify(v));
});
test('demo agent results reject type-confused, inherited and duplicate question/caution/NCT IDs',()=>{
 assert.equal(parseDemoResult(demo([{nctId:n1,questionIds:['eligibility','costs']},{nctId:n2,questionIds:['visits']}])).kind,'agentDemo');
 for(const questionIds of confused)assert.throws(()=>parseDemoResult(demo([{nctId:n1,questionIds}])),JSON.stringify(questionIds));
 for(const cautionIds of [[['team_confirms'],'snapshot','no_benefit_promise'],['snapshot','snapshot'],['team_confirms','snapshot','snapshot'],['toString']])assert.throws(()=>parseDemoResult(demo([{nctId:n1,questionIds:['eligibility']}],cautionIds)),JSON.stringify(cautionIds));
 assert.throws(()=>parseDemoResult(demo([{nctId:n1,questionIds:['eligibility']},{nctId:n1,questionIds:['visits']}])));
 assert.throws(()=>parseDemoReply({id:'x',type:'result',ok:true,result:demo([{nctId:n1,questionIds:[['eligibility'],'eligibility','eligibility']}])},'x'));
 for(const nctId of [[n1],{toString:()=>n1}])assert.throws(()=>parseDemoResult({kind:'scoreDemo',fixtureId:'fibromyalgia',mode:'live',scores:[{nctId,index:50,confidence:.5}]}));
});
test('real agent and score results reject type-confused and duplicate IDs',()=>{
 assert.equal(parseRealResult(real([{nctId:r1,questionIds:['eligibility']},{nctId:r2,questionIds:['visits','costs']}])).kind,'agentReal');
 for(const questionIds of confused)assert.throws(()=>parseRealResult(real([{nctId:r1,questionIds}])),JSON.stringify(questionIds));
 for(const cautionIds of [[['team_confirms'],'snapshot','no_benefit_promise'],['team_confirms','snapshot','snapshot'],['team_confirms','snapshot',['no_benefit_promise']]])assert.throws(()=>parseRealResult(real([{nctId:r1,questionIds:['eligibility']}],cautionIds)),JSON.stringify(cautionIds));
 for(const comparisons of [[{nctId:r1,questionIds:['eligibility']},{nctId:r1,questionIds:['visits']}],[{nctId:[r1],questionIds:['eligibility']}]])assert.throws(()=>parseRealResult(real(comparisons)));
 const score=nctId=>({nctId,index:50,confidence:.5});
 assert.equal(parseRealResult({kind:'scoreReal',mode:'live',consentDigest:'a'.repeat(64),scores:[score(r1),score(r2)]}).kind,'scoreReal');
 for(const scores of [[score(r1),score(r1)],[score([r1])]])assert.throws(()=>parseRealResult({kind:'scoreReal',mode:'live',consentDigest:'a'.repeat(64),scores}));
});
test('live agent and score results reject type-confused, inherited and duplicate question/caution/NCT IDs',()=>{
 const [l1,l2]=['NCT99999920','NCT99999921'],bound={mode:'live',analysisId:'0b6f1c2e-6a1d-4c3b-9d2e-1f2a3b4c5d6e',snapshotId:'a'.repeat(64),source:{generation:'generation_ids',queryKey:'b'.repeat(64)},profileKey:'c'.repeat(64),consentDigest:'d'.repeat(64)};
 const live=(comparisons,cautionIds=cautions)=>({kind:'agentLive',...bound,comparisons,cautionIds,toolCalls:2,cleanup:'deleted'});
 assert.equal(parseLiveResult(live([{nctId:l1,questionIds:['eligibility','costs']},{nctId:l2,questionIds:['visits']}])).kind,'agentLive');
 for(const questionIds of confused)assert.throws(()=>parseLiveResult(live([{nctId:l1,questionIds}])),JSON.stringify(questionIds));
 for(const cautionIds of [[['team_confirms'],'snapshot','no_benefit_promise'],['team_confirms','snapshot','snapshot'],['team_confirms','snapshot',['no_benefit_promise']],['team_confirms','snapshot','toString'],['team_confirms','snapshot']])assert.throws(()=>parseLiveResult(live([{nctId:l1,questionIds:['eligibility']}],cautionIds)),JSON.stringify(cautionIds));
 for(const comparisons of [[{nctId:l1,questionIds:['eligibility']},{nctId:l1,questionIds:['visits']}],[{nctId:[l1],questionIds:['eligibility']}],[{nctId:{toString:()=>l1},questionIds:['eligibility']}]])assert.throws(()=>parseLiveResult(live(comparisons)));
 assert.throws(()=>parseLiveReply({id:'x',type:'result',ok:true,result:live([{nctId:l1,questionIds:[['eligibility'],'eligibility','eligibility']}])},'x'));
 const score=nctId=>({nctId,index:50,confidence:.5}),scored=scores=>({kind:'scoreLive',...bound,scores});
 assert.equal(parseLiveResult(scored([score(l1),score(l2)])).kind,'scoreLive');
 for(const scores of [[score(l1),score(l1)],[score([l1])],[score({toString:()=>l1})]])assert.throws(()=>parseLiveResult(scored(scores)));
});
