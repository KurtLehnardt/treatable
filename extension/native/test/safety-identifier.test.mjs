import test from 'node:test';import assert from 'node:assert/strict';import{spawnSync}from'node:child_process';
import{SAFETY_IDENTIFIER,PreparedRankStore,buildOpenAiRankRequest}from'../rank.mjs';import{normalizeLiveRecord}from'../live-evidence.mjs';
import{PreparedStudyBriefStore}from'../study-brief.mjs';
const record=nctId=>({hasResults:false,protocolSection:{identificationModule:{nctId,briefTitle:'Fictional public study'},statusModule:{overallStatus:'RECRUITING'},conditionsModule:{conditions:['Fictional condition']},descriptionModule:{briefSummary:'Public summary.'},eligibilityModule:{eligibilityCriteria:'Public criteria',minimumAge:'18 Years',sex:'ALL',healthyVolunteers:false},contactsLocationsModule:{}}});
const ids=['NCT99999950','NCT99999951'],UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
test('the ranking Decisions body carries the documented safety_identifier: one random UUID per host process, never user data; study brief bodies do not',async()=>{
 const studies=ids.map(id=>normalizeLiveRecord(record(id),id,1)),a=buildOpenAiRankRequest({conditions:['Asthma']},studies),b=buildOpenAiRankRequest({conditions:['Type 2 diabetes','COVID-19']},studies.slice(0,1));
 assert.match(SAFETY_IDENTIFIER,UUID);assert.equal(a.safety_identifier,SAFETY_IDENTIFIER);assert.equal(b.safety_identifier,SAFETY_IDENTIFIER,'the same identifier for every profile in one process');
 const rank=new PreparedRankStore({fetchRecord:async id=>record(id)});try{assert.equal((await rank.prepare({nctIds:ids,profile:{conditions:['Asthma']}})).preview.request.safety_identifier,SAFETY_IDENTIFIER);}finally{rank.discard();}
 const brief=new PreparedStudyBriefStore({fetchRecord:async id=>record(id)});try{const p=await brief.prepare(ids);assert.ok(!JSON.stringify(p).includes(SAFETY_IDENTIFIER));assert.ok(!JSON.stringify(brief.take({token:p.token,digest:p.digest})).includes(SAFETY_IDENTIFIER));}finally{brief.discard();}
 // A new process draws a new identifier; it is never derived from the profile, the records or the machine.
 const other=spawnSync(process.execPath,['--input-type=module','-e',`import{SAFETY_IDENTIFIER}from${JSON.stringify(new URL('../rank.mjs',import.meta.url).href)};process.stdout.write(SAFETY_IDENTIFIER)`],{encoding:'utf8'});
 assert.equal(other.status,0,other.stderr);assert.match(other.stdout,UUID);assert.notEqual(other.stdout,SAFETY_IDENTIFIER);
});
