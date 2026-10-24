import test from 'node:test';import assert from 'node:assert/strict';
import{loadPublicCorpus,PreparedRealStore,SAFETY_IDENTIFIER}from'../real.mjs';import{getDemoPreview}from'../../shared/demo-fixtures.mjs';
import{PUBLIC_CONDITIONS,PUBLIC_STUDY_IDS}from'../../shared/public-catalog.mjs';import{REAL_POLICY_VERSION}from'../../shared/real-contract.mjs';
const receipt={policyVersion:REAL_POLICY_VERSION,accepted:true};
const packet={ageBand:'30_44',conditionIds:[PUBLIC_CONDITIONS[1].id],selectedNctIds:[PUBLIC_STUDY_IDS[5]]};
const corpus=await loadPublicCorpus();

test('real Decisions body carries the documented safety_identifier: one random UUID per host process, never user data; Agents and fictional bodies do not',()=>{
 const store=new PreparedRealStore(corpus);try{const a=store.prepare(packet,receipt).preview,b=store.prepare({...packet,ageBand:'60_74',sex:'male',state:'WA'},receipt).preview;
  assert.match(SAFETY_IDENTIFIER,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.equal(a.decisionsRequest.safety_identifier,SAFETY_IDENTIFIER);assert.equal(b.decisionsRequest.safety_identifier,SAFETY_IDENTIFIER);
  assert.ok(!JSON.stringify(a.agentsRequest).includes(SAFETY_IDENTIFIER));assert.equal(getDemoPreview('fibromyalgia').decisionsRequest.safety_identifier,undefined);assert.ok(!JSON.stringify(getDemoPreview('fibromyalgia')).includes(SAFETY_IDENTIFIER));
 }finally{store.clear();}
});
