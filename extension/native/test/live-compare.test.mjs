import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import{syncBuiltinESMExports}from'node:module';
import{LiveEvidenceStore}from'../live-evidence.mjs';import{PreparedLiveStore}from'../live.mjs';import{REAL_POLICY_VERSION}from'../../shared/real-contract.mjs';
const ids=['NCT99999910'],source={generation:'generation_compare',queryKey:'c'.repeat(64)},receipt={accepted:true,policyVersion:REAL_POLICY_VERSION};
const record=nctId=>({protocolSection:{identificationModule:{nctId,briefTitle:'Fictional public study'},conditionsModule:{conditions:['Fictional condition']},eligibilityModule:{}}});
// Pen-test parity: live tokens, consent digests and snapshot digests use the same constant-time comparison as the snapshot path (real.mjs).
test('live token, consent digest and snapshot digest use timingSafeEqual on equal-length buffers; unequal lengths never compare',async()=>{
 const original=crypto.timingSafeEqual;let compared=[];crypto.timingSafeEqual=(a,b)=>{compared.push([a.length,b.length]);return original(a,b);};syncBuiltinESMExports();
 const evidence=new LiveEvidenceStore({fetchRecord:async id=>record(id)}),store=new PreparedLiveStore(evidence);try{
  const c=await evidence.catalog(ids,source);const packet={ageBand:'30_44',conditionIds:[c.conditions[0].id],selectedNctIds:ids,agentNctIds:ids};
  compared=[];const p=store.prepare({snapshotId:c.snapshotId,source,packet,policyReceipt:receipt});assert.deepEqual(compared,[[64,64]]);
  const take=extra=>store.take({token:p.token,digest:p.digest,operation:'score',policyReceipt:receipt,...extra});
  compared=[];assert.throws(()=>take({token:(p.token[0]==='A'?'B':'A')+p.token.slice(1)}),{code:'INVALID_CONSENT_RECEIPT'});assert.deepEqual(compared,[[64,64],[43,43],[64,64]]);
  compared=[];assert.throws(()=>take({digest:'0'.repeat(64)}),{code:'INVALID_CONSENT_RECEIPT'});assert.deepEqual(compared,[[64,64],[43,43],[64,64]]);
  compared=[];assert.throws(()=>evidence.get('0'.repeat(64),source),{code:'LIVE_SOURCE_CHANGED'});assert.deepEqual(compared,[[64,64]]);
  compared=[];assert.throws(()=>evidence.get(c.snapshotId.slice(1),source),{code:'LIVE_SOURCE_CHANGED'});assert.deepEqual(compared,[]);
  compared=[];assert.throws(()=>store.revoke('x'.repeat(43)),{code:'INVALID_CONSENT_RECEIPT'});assert.deepEqual(compared,[[43,43]]);
  compared=[];assert.equal(take().consentDigest,p.digest);assert.deepEqual(compared,[[64,64],[43,43],[64,64]]);
 }finally{crypto.timingSafeEqual=original;syncBuiltinESMExports();store.discard();evidence.discard();}
});
