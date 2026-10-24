import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import{syncBuiltinESMExports}from'node:module';
import{loadPublicCorpus,PreparedRealStore,sameSecret}from'../real.mjs';
import{PUBLIC_CONDITIONS,PUBLIC_STUDY_IDS}from'../../shared/public-catalog.mjs';import{REAL_POLICY_VERSION}from'../../shared/real-contract.mjs';
const receipt={policyVersion:REAL_POLICY_VERSION,accepted:true};
const packet={ageBand:'30_44',conditionIds:[PUBLIC_CONDITIONS[1].id],selectedNctIds:[PUBLIC_STUDY_IDS[5]]};
const corpus=await loadPublicCorpus();

test('consent token and digest use timingSafeEqual on equal-length buffers; unequal lengths fail without comparing',()=>{
 const original=crypto.timingSafeEqual;let compared=[];crypto.timingSafeEqual=(a,b)=>{compared.push([a.length,b.length]);return original(a,b);};syncBuiltinESMExports();
 const store=new PreparedRealStore(corpus);try{
  assert.equal(sameSecret('abc','abc'),true);assert.equal(sameSecret('abc','abd'),false);compared=[];assert.equal(sameSecret('abc','abcd'),false);assert.equal(sameSecret(undefined,'abc'),false);assert.deepEqual(compared,[]);
  const p=store.prepare(packet,receipt),take=extra=>store.take({token:p.token,digest:p.digest,operation:'score',policyReceipt:receipt,...extra});
  compared=[];assert.throws(()=>take({token:p.token.slice(1)}),e=>e.code==='INVALID_CONSENT_RECEIPT');assert.deepEqual(compared,[[64,64]]);
  compared=[];assert.throws(()=>take({token:(p.token[0]==='A'?'B':'A')+p.token.slice(1)}),e=>e.code==='INVALID_CONSENT_RECEIPT');assert.deepEqual(compared,[[43,43],[64,64]]);
  compared=[];assert.throws(()=>take({digest:'0'.repeat(64)}),e=>e.code==='INVALID_CONSENT_RECEIPT');assert.equal(compared.length,2);
  compared=[];assert.throws(()=>store.revoke('x'.repeat(43)),e=>e.code==='INVALID_CONSENT_RECEIPT');assert.deepEqual(compared,[[43,43]]);
  compared=[];assert.equal(take().consentDigest,p.digest);assert.deepEqual(compared,[[43,43],[64,64]]);
 }finally{crypto.timingSafeEqual=original;syncBuiltinESMExports();store.clear();}
});
