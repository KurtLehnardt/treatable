// One-use receipts of the two shipped paths (AI ranking, study brief) compare token and digest in constant time.
import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import{syncBuiltinESMExports}from'node:module';
import{sameSecret}from'../live-evidence.mjs';import{PreparedRankStore}from'../rank.mjs';import{PreparedStudyBriefStore}from'../study-brief.mjs';
const record=nctId=>({hasResults:false,protocolSection:{identificationModule:{nctId,briefTitle:'Fictional public study'},statusModule:{overallStatus:'RECRUITING'},conditionsModule:{conditions:['Fictional condition']},descriptionModule:{briefSummary:'Public summary.'},eligibilityModule:{eligibilityCriteria:'Public criteria',minimumAge:'18 Years',sex:'ALL',healthyVolunteers:false},contactsLocationsModule:{}}});
const ids=['NCT99999950','NCT99999951'];
async function spy(body){const original=crypto.timingSafeEqual;const compared=[];crypto.timingSafeEqual=(a,b)=>{compared.push([a.length,b.length]);return original(a,b);};syncBuiltinESMExports();try{await body(compared);}finally{crypto.timingSafeEqual=original;syncBuiltinESMExports();}}
test('sameSecret uses timingSafeEqual on equal-length buffers; unequal lengths and non-strings fail without comparing',async()=>{
 await spy(compared=>{assert.equal(sameSecret('abc','abc'),true);assert.equal(sameSecret('abc','abd'),false);compared.length=0;assert.equal(sameSecret('abc','abcd'),false);assert.equal(sameSecret(undefined,'abc'),false);assert.equal(sameSecret('abc',['abc']),false);assert.deepEqual(compared,[]);});
});
for(const [name,make,prepare,wrong] of [
 ['AI ranking',()=>new PreparedRankStore({fetchRecord:async id=>record(id)}),s=>s.prepare({nctIds:ids,profile:{conditions:['Asthma']}}),'INVALID_CONSENT_RECEIPT'],
 ['study brief',()=>new PreparedStudyBriefStore({fetchRecord:async id=>record(id)}),s=>s.prepare(ids),'INVALID_APPLY_RECEIPT']])
 test(`${name} token and digest are both compared in constant time on every take, and revoke compares the token`,async()=>{
  const store=make();try{const p=await prepare(store),take=extra=>store.take({token:p.token,digest:p.digest,...extra});
   await spy(compared=>{
    compared.length=0;assert.throws(()=>take({token:p.token.slice(1)}),/receipt/i);assert.deepEqual(compared,[],'a malformed receipt fails the contract before any comparison');
    compared.length=0;assert.throws(()=>take({token:(p.token[0]==='A'?'B':'A')+p.token.slice(1)}),{code:wrong});assert.deepEqual(compared,[[43,43],[64,64]],'a wrong token never short-circuits the digest comparison');
    compared.length=0;assert.throws(()=>take({digest:'0'.repeat(64)}),{code:wrong});assert.deepEqual(compared,[[43,43],[64,64]]);
    compared.length=0;assert.throws(()=>store.revoke('x'.repeat(43)),{code:wrong});assert.deepEqual(compared,[[43,43]]);
    compared.length=0;assert.ok(take());assert.deepEqual(compared,[[43,43],[64,64]]);
    assert.throws(()=>take(),{code:wrong},'one use');
   });
  }finally{store.discard();}
 });
