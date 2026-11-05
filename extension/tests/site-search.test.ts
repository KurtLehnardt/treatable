import test from'node:test';import assert from'node:assert/strict';
import{readSiteCondition}from'../src/site-search';import{parseSiteRequest}from'../src/site-contract';
test('cross-context request rejects unknown keys, oversized values and coercible IDs',()=>{assert.equal(parseSiteRequest({id:'abc',type:'site.snapshot',payload:{}}).id,'abc');for(const input of [{id:123,type:'site.snapshot',payload:{}},{id:'abc',type:'site.snapshot',payload:{},secret:'bad'},{id:'abc',type:'site.snapshot',payload:{x:'a'.repeat(140000)}}])assert.throws(()=>parseSiteRequest(input));});
test('the removed in-overlay search messages are rejected, not silently accepted',()=>{
 for(const type of ['site.search','site.availability'])assert.throws(()=>parseSiteRequest({id:'abc',type,payload:{}}),/Invalid site operation/,type);
 assert.throws(()=>parseSiteRequest({id:'abc',type:'site.search',payload:{filters:{cond:'asthma'}}}));
});
test('the site request allow-list still carries every message the remaining features send',()=>{
 for(const type of ['site.snapshot','site.layout','site.restore','site.close','site.fetch','site.rank','site.openPrivate','site.diagnostics','site.endMatching','site.ping','site.guide','site.openSearch','site.aiRank','site.aiRankStop','site.hide'])assert.equal(parseSiteRequest({id:'abc',type,payload:{}}).type,type);
});
test('readSiteCondition reads only the website cond parameter and ignores every other filter',()=>{
 assert.equal(readSiteCondition('https://clinicaltrials.gov/search?cond=asthma&term=x&locStr=83702&lat=1&lng=2&aggFilters=status:rec'),'asthma');
 assert.equal(readSiteCondition('https://clinicaltrials.gov/search?cond=%E7%B7%9A%E7%B6%AD%E7%AD%8B%E7%97%9B%E7%97%87'),'線維筋痛症');
 assert.equal(readSiteCondition('https://clinicaltrials.gov/search?cond=%20%20'),undefined);
 assert.equal(readSiteCondition('https://clinicaltrials.gov/search?term=pain'),undefined);
 assert.equal(readSiteCondition('https://clinicaltrials.gov/'),undefined);
});
test('readSiteCondition fails on control characters, bidirectional overrides and oversized text without echoing them',()=>{
 for(const bad of ['private%00','a%E2%80%AEb','%E2%81%A6x','a'.repeat(501)])assert.throws(()=>readSiteCondition('https://clinicaltrials.gov/search?cond='+bad),(e:any)=>e.message==='Invalid search text');
});
