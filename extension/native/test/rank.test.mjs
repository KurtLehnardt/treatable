// AI ranking (prepareRank/executeRank/revokeRank): provider request shape, Decisions validation, one-use pinned receipts and host routing.
import test,{mock}from'node:test';import assert from'node:assert/strict';import{rm}from'node:fs/promises';
import{PreparedRankStore,runPreparedRank,buildOpenAiRankRequest,openAiRankScores,RANK_TERM_RULE}from'../rank.mjs';
import{normalizeLiveRecord}from'../live-evidence.mjs';import{ApiError}from'../transport.mjs';
import{parseRankRequest,parsePreparedRank,parseRankResult,RANK_LEVELS,RANK_TTL_MS}from'../../shared/rank-contract.mjs';
import{installHost,writeHook,startHost,readLines}from'./host-harness.mjs';
const ids=['NCT99999910','NCT99999911'];
const record=(nctId,status='RECRUITING')=>({hasResults:false,protocolSection:{identificationModule:{nctId,briefTitle:`Fictional public study ${nctId}`},statusModule:{overallStatus:status},conditionsModule:{conditions:['Fictional asthma']},descriptionModule:{briefSummary:'Public summary'},eligibilityModule:{eligibilityCriteria:'Public criteria',minimumAge:'18 Years',maximumAge:'65 Years',sex:'ALL',healthyVolunteers:false}}});
const profile={conditions:['Asthma'],ageBand:'30_44',sex:'female'};
const answer=(name,level)=>({type:'score',name,score:level,confidence:.9,probabilities:RANK_LEVELS.map((label,value)=>({value,label,probability:value===level?1:0}))});
const scripted=(answers,{fail}={})=>{const calls=[];return{mode:'test',calls,async request(method,path,body){calls.push({method,path,body:structuredClone(body)});if(fail)throw new ApiError(fail);return{answers:answers(body)}}}};

test('the OpenAI ranking request carries only the minimized profile, one relevance question per study and the literal-term rule',()=>{
 const studies=ids.map(id=>normalizeLiveRecord(record(id),id,1));const request=buildOpenAiRankRequest(profile,studies);
 assert.equal(request.model,'gpt-6-luna');assert.deepEqual(request.questions.map(q=>q.name),ids);assert.ok(request.questions.every(q=>q.type==='score'&&q.levels.length===4));
 assert.deepEqual(request.input[0].content[1].data.profile,profile);assert.match(request.input[0].content[0].text,new RegExp(RANK_TERM_RULE.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.match(request.input[0].content[0].text,/never eligibility/);
 for(const banned of [/zip/i,/latitude|longitude/i,/notes?"/i,/"name"/i,/"age"/])assert.doesNotMatch(JSON.stringify(request.input[0].content[1].data.profile),banned);
});

test('Decisions answers become 0-100 scores with level probabilities; malformed answers are refused',()=>{
 const scores=openAiRankScores({answers:[answer(ids[1],0),answer(ids[0],3)]},ids);
 assert.deepEqual(scores,[{nctId:ids[0],score:100,reasonId:'strong_match',probabilities:[0,0,0,1]},{nctId:ids[1],score:0,reasonId:'unrelated',probabilities:[1,0,0,0]}]);
 const mixed={...answer(ids[0],2),score:1.5,probabilities:RANK_LEVELS.map((label,value)=>({value,label,probability:value===1||value===2?.5:0}))};
 assert.deepEqual(openAiRankScores({answers:[mixed,answer(ids[1],1)]},ids)[0],{nctId:ids[0],score:50,reasonId:'possible_match',probabilities:[0,.5,.5,0]});
 const bad=[{answers:[answer(ids[0],2)]},{answers:[answer(ids[0],2),answer(ids[0],1)]},{answers:[answer(ids[0],2),{...answer(ids[1],2),score:0}]},{answers:[answer(ids[0],2),{...answer(ids[1],2),probabilities:answer(ids[1],2).probabilities.map(p=>({...p,probability:.5}))}]},{answers:[answer(ids[0],2),{...answer(ids[1],2),name:'NCT00000000'}]},{answers:[answer(ids[0],2),{...answer(ids[1],2),probabilities:answer(ids[1],2).probabilities.map(p=>({...p,label:'Other'}))}]}];
 for(const raw of bad)assert.throws(()=>openAiRankScores(raw,ids),{code:'INVALID_DECISIONS_OUTPUT'});
});

test('the contract refuses names, ZIP codes, exact ages, extra profile fields and unpinned results',()=>{
 const prepare=p=>parseRankRequest({id:'r1',type:'prepareRank',payload:{nctIds:ids,profile:p}});
 assert.equal(prepare(profile).type,'prepareRank');
 for(const p of [{...profile,name:'Pat Example'},{...profile,zip:'90210'},{...profile,age:45},{...profile,notes:'x'},{conditions:['asthma 90210']},{conditions:['45 years old']},{conditions:[]},{conditions:['a','b','c','d','e','f','g']},{...profile,ageBand:'45'},{...profile,sex:'other'},{conditions:['Asthma','asthma']}])assert.throws(()=>prepare(p),JSON.stringify(p));
 assert.throws(()=>parseRankRequest({id:'r2',type:'executeRank',payload:{token:'x'.repeat(43),digest:'a'.repeat(64),extra:1}}));
 assert.throws(()=>parseRankResult({kind:'rankResult',mode:'live',provider:'openai',digest:'a'.repeat(64),scores:[{nctId:ids[0],score:101,reasonId:'strong_match'}]}));
 assert.throws(()=>parseRankResult({kind:'rankResult',mode:'live',provider:'openai',digest:'a'.repeat(64),scores:[{nctId:ids[0],score:50,reasonId:'eligible'}]}));
 assert.equal(parseRankResult({kind:'rankResult',mode:'live',provider:'local',digest:'a'.repeat(64),scores:[{nctId:ids[0],score:50,reasonId:'possible_match'}]}).provider,'local');
 assert.throws(()=>parseRankResult({kind:'rankResult',mode:'live',provider:'openai',digest:'a'.repeat(64),scores:[{nctId:ids[0],score:50,reasonId:'possible_match'}]}),'OpenAI results carry the Decisions probabilities');
 for(const term of ['45 female','52 M COPD','asthma 12/03','45-year-old asthma','COPD 52M','asthma 45F','45yoF asthma','asthma 12-03'])assert.throws(()=>prepare({conditions:[term]}),term);
 assert.equal(prepare({conditions:['Type 2 diabetes','COVID-19','Stage 4 lung cancer']}).type,'prepareRank');
});

test('a prepared ranking is pinned: one use, exact receipt, fixed expiry, revocable; the sent body is the previewed body',async()=>{
 let time=0,invalidations=0;const fetched=[];const store=new PreparedRankStore({fetchRecord:async id=>{fetched.push(id);return record(id)},now:()=>time,wallNow:()=>1000+time,onInvalidate:()=>invalidations++});
 try{
  const p=await store.prepare({nctIds:ids,profile});parsePreparedRank(p);assert.deepEqual(fetched,ids);assert.equal(p.provider,'openai');assert.equal(p.expiresAt,1000+RANK_TTL_MS);assert.deepEqual(p.preview.profile,profile);
  assert.throws(()=>store.take({token:p.token,digest:'0'.repeat(64)}),{code:'INVALID_CONSENT_RECEIPT'});
  const pinned=store.take({token:p.token,digest:p.digest});assert.deepEqual(pinned.request,p.preview.request);assert.throws(()=>store.take({token:p.token,digest:p.digest}),{code:'INVALID_CONSENT_RECEIPT'},'one use');
  const transport=scripted(body=>body.questions.map((q,i)=>answer(q.name,i?1:3)));const result=await runPreparedRank(transport,pinned,{});
  assert.deepEqual(transport.calls.map(c=>c.method+' '+c.path),['POST /v1/decisions']);assert.deepEqual(transport.calls[0].body,p.preview.request,'the exact previewed body is sent');
  assert.equal(result.kind,'rankResult');assert.equal(result.mode,'test');assert.equal(result.digest,p.digest);assert.deepEqual(result.scores.map(s=>[s.nctId,s.score,s.reasonId]),[[ids[0],100,'strong_match'],[ids[1],33,'unclear']]);
  const again=await store.prepare({nctIds:ids,profile});time+=RANK_TTL_MS+1;assert.throws(()=>store.take({token:again.token,digest:again.digest}),{code:'CONSENT_EXPIRED'});
  const revoked=await store.prepare({nctIds:ids,profile});const before=invalidations;assert.throws(()=>store.revoke('y'.repeat(43)),{code:'INVALID_CONSENT_RECEIPT'});store.revoke(revoked.token);assert.equal(invalidations,before+1);assert.throws(()=>store.take({token:revoked.token,digest:revoked.digest}),{code:'CONSENT_EXPIRED'});
  await assert.rejects(runPreparedRank(scripted(()=>[],{fail:'RATE_LIMITED'}),pinned,{}),{code:'RATE_LIMITED'});
  const failing=new PreparedRankStore({fetchRecord:async()=>{throw new ApiError('GOV_NETWORK_ERROR')}});await assert.rejects(failing.prepare({nctIds:ids,profile}),{code:'RECORD_UNAVAILABLE'});
 }finally{store.discard();}
});

test('stdio: prepareRank then executeRank ranks through Decisions once; the receipt is one-use and older contracts stay separate',async()=>{
 const installed=await installHost('treatable-rank-');let host;
 try{host=startHost(installed,{hook:await writeHook(installed.home,{log:installed.log})});
  const prepared=await host.call({id:'rankPrep',type:'prepareRank',payload:{nctIds:ids,profile}});assert.equal(prepared.ok,true,prepared.code);assert.equal(prepared.result.kind,'preparedRank');
  const openai=async()=>(await readLines(installed.log)).filter(x=>x.host==='api.openai.com');assert.equal((await openai()).length,0,'preparing sends nothing to OpenAI');
  const ranked=await host.call({id:'rankRun',type:'executeRank',payload:{token:prepared.result.token,digest:prepared.result.digest}});assert.equal(ranked.ok,true,ranked.code);
  assert.deepEqual(ranked.result.scores.map(s=>[s.nctId,s.score,s.reasonId,s.probabilities]),ids.map(id=>[id,67,'possible_match',[0,0,1,0]]));
  const sent=await openai();assert.deepEqual(sent.map(x=>x.method+' '+x.path),['POST /v1/decisions']);assert.deepEqual(sent[0].body,prepared.result.preview.request);
  assert.equal((await host.call({id:'rankReplay',type:'executeRank',payload:{token:prepared.result.token,digest:prepared.result.digest}})).code,'INVALID_CONSENT_RECEIPT');
  assert.equal((await host.call({id:'rankBad',type:'prepareRank',payload:{nctIds:ids,profile:{...profile,zip:'90210'}}})).code,'INVALID_REQUEST');
  host.child.stdin.end();await host.exit;host=undefined;
 }finally{host?.child.kill('SIGKILL');await rm(installed.home,{recursive:true,force:true});}
});
