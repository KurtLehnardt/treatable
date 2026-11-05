// Fixed-catalog ID lists in model output (the study brief's question, pre-screen and flag IDs) accept only own string keys, once each.
import test from 'node:test';import assert from 'node:assert/strict';
import{templateIdList,parseDemoReply}from'../../shared/demo-contract.mjs';
import{APPLY_QUESTION_TEMPLATES,APPLY_PRESCREEN_TEMPLATES}from'../../shared/apply-contract.mjs';
import{normalizeStudyBrief}from'../../shared/apply-record.mjs';
import{parseBriefAgentOutput}from'../study-brief.mjs';
// Pen-test L2: an array element ["visits"] coerces to the own key "visits", so Object.hasOwn alone accepted it.
const confused=[[['visits'],'visits','next_steps'],['visits','visits','next_steps'],[['visits']],[{toString:()=>'visits'}],['__proto__'],['toString'],['constructor']];
test('templateIdList requires strings, own fixed-table keys and uniqueness',()=>{
 assert.equal(templateIdList(['still_enrolling','visits'],APPLY_QUESTION_TEMPLATES,1,6),true);
 for(const v of [...confused,[],'visits',undefined,Array(7).fill(0).map((_,i)=>Object.keys(APPLY_QUESTION_TEMPLATES)[i%6])])assert.equal(templateIdList(v,APPLY_QUESTION_TEMPLATES,1,6),false,JSON.stringify(v));
 assert.equal(templateIdList(['diagnosis_details','prior_treatments'],APPLY_PRESCREEN_TEMPLATES,2,8),true);assert.equal(templateIdList(['diagnosis_details',['prior_treatments']],APPLY_PRESCREEN_TEMPLATES,2,8),false);
});
test('study brief agent output rejects type-confused, inherited and duplicate question, pre-screen and study IDs',()=>{
 const raw={protocolSection:{identificationModule:{nctId:'NCT99999990',briefTitle:'Synthetic record'},descriptionModule:{briefSummary:'A synthetic summary.'},statusModule:{overallStatus:'RECRUITING'},eligibilityModule:{},contactsLocationsModule:{}}},brief=normalizeStudyBrief(raw,1);
 const plan=extra=>({nctId:brief.nctId,claims:[],questionIds:['still_enrolling','visits','next_steps'],prescreenIds:['diagnosis_details','prior_treatments'],flagIds:[],questionEvidence:['still_enrolling','visits','next_steps'].map(questionId=>({questionId,evidenceIds:[]})),...extra});
 const parse=studies=>parseBriefAgentOutput(JSON.stringify({studies}),[brief]);
 assert.equal(parse([plan()])[0].nctId,brief.nctId);
 // JSON round-trips drop functions, so only the confusions that survive serialization are tried here; templateIdList covers the rest.
 for(const questionIds of [[['visits'],'still_enrolling','next_steps'],['visits','visits','next_steps'],['__proto__','visits','next_steps'],['toString','visits','next_steps']])assert.throws(()=>parse([plan({questionIds})]),JSON.stringify(questionIds));
 for(const prescreenIds of [[['diagnosis_details'],'prior_treatments'],['diagnosis_details','diagnosis_details'],['constructor','prior_treatments']])assert.throws(()=>parse([plan({prescreenIds})]),JSON.stringify(prescreenIds));
 for(const flagIds of [[['age_limit']],['age_limit','age_limit'],['hasOwnProperty']])assert.throws(()=>parse([plan({flagIds})]),JSON.stringify(flagIds));
 for(const studies of [[plan(),plan()],[plan({nctId:'NCT99999991'})],[plan({nctId:[brief.nctId]})]])assert.throws(()=>parse(studies));
 assert.throws(()=>parseDemoReply({id:'x',type:'result',ok:true,result:{kind:'studyBrief',studyPlans:[plan({questionIds:[['visits'],'visits','next_steps']})]}},'x'),'a successful result never passes the base reply contract on its own');
});
