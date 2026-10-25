import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeRanking,recordChecks,detailConditionTerms,rankConditions,searchConditionTerms,REASON_TEXT,MISMATCH_PERCENT_CAP} from '../src/rank-merge';
import {createRankService,parseRankDetails,type RankHost,type RankConfirmOutcome,type RankConfirmSummary} from '../src/rank-background';
import {parseRankingState,type RankingState} from '../src/rank-state';
import {RANK_LEVELS,rankReasonForScore,type RankScore} from '../shared/rank-contract.mjs';

const [A,B,C,D,E]=['NCT00000001','NCT00000002','NCT00000003','NCT00000004','NCT00000005'];
const facts:Record<string,any>={
 [A]:{status:'RECRUITING',minimumAge:'18 Years',maximumAge:'65 Years',sex:'ALL',title:'Study A'},
 [B]:{status:'COMPLETED',minimumAge:'18 Years',maximumAge:null,sex:'ALL',title:'Study B'},
 [C]:{status:'RECRUITING',minimumAge:'65 Years',maximumAge:null,sex:'ALL',title:'Study C'},
 /* D has no fetchable record: missing data stays unknown, never a mismatch. */
 [E]:{status:'NOT_YET_RECRUITING',minimumAge:null,maximumAge:null,sex:'FEMALE',title:'Study E'},
};
const ids=[A,B,C,D,E];
const score=(nctId:string,value:number,level=Math.round(value/100*3)):RankScore=>({nctId,score:value,reasonId:rankReasonForScore(value),probabilities:RANK_LEVELS.map((_,i)=>i===level?1:0)});

test('record checks find only clear mismatches: not recruiting, a whole age band outside the listed range, a listed sex; missing data is unknown',()=>{
 const profile={ageBand:'30_44' as const,sex:'male' as const};
 assert.deepEqual(recordChecks(facts[A],profile),[]);
 assert.deepEqual(recordChecks(facts[B],profile),['not_recruiting']);
 assert.deepEqual(recordChecks(facts[C],profile),['outside_age_range']);
 assert.deepEqual(recordChecks(undefined,profile),[],'no record, no mismatch');
 assert.deepEqual(recordChecks(facts[E],profile),['sex_mismatch'],'opening soon is not a mismatch; the listed sex is');
 assert.deepEqual(recordChecks(facts[E],{}),[],'without a shared sex nothing about sex is checked');
 assert.deepEqual(recordChecks({status:'UNKNOWN',minimumAge:'garbled',maximumAge:'',sex:null},profile),[],'unknown status and unreadable ages stay unknown');
 assert.deepEqual(recordChecks({minimumAge:'40 Years'},{ageBand:'30_44'}),[],'a band that overlaps the range is not outside it');
 assert.deepEqual(recordChecks({maximumAge:'17 Years'},{ageBand:'18_29'}),['outside_age_range']);
 assert.deepEqual(recordChecks({status:'ENROLLING_BY_INVITATION'},{}),[]);
 for(const status of ['ACTIVE_NOT_RECRUITING','TERMINATED','WITHDRAWN','SUSPENDED'])assert.deepEqual(recordChecks({status},{}),['not_recruiting'],status);
});

test('merged order: relevance first, known mismatches last with a low capped percentage and a factual reason; ties keep the website order',()=>{
 const checks={[A]:[],[B]:['not_recruiting' as const],[C]:['outside_age_range' as const],[D]:[],[E]:['sex_mismatch' as const]};
 const ranked=mergeRanking(ids,checks,[score(A,33),score(B,100),score(C,67),score(D,67),score(E,0)]);
 assert.deepEqual(ranked.map(r=>[r.nctId,r.percent,r.reasonId]),[[D,67,'possible_match'],[A,33,'unclear'],[B,10,'not_recruiting'],[C,7,'outside_age_range'],[E,0,'sex_mismatch']]);
 assert.ok(ranked.every(r=>r.percent===null||r.percent<=100));assert.ok(ranked.filter(r=>r.checks.length).every(r=>r.percent!<=MISMATCH_PERCENT_CAP));
 assert.deepEqual(ranked[0].probabilities,[0,0,1,0],'Decisions probabilities travel with the study');
 const fallback=mergeRanking(ids,checks);
 assert.deepEqual(fallback.map(r=>[r.nctId,r.percent,r.reasonId]),[[A,null,'not_scored'],[D,null,'not_scored'],[B,0,'not_recruiting'],[C,0,'outside_age_range'],[E,0,'sex_mismatch']],'without scores the record checks still move known mismatches last');
 const tie=mergeRanking([B,A],{},[score(B,50),score(A,50)]);assert.deepEqual(tie.map(r=>r.nctId),[B,A]);
 const low=mergeRanking([A,B],{[B]:['not_recruiting']},[score(A,3),score(B,90)]);assert.deepEqual(low.map(r=>[r.nctId,r.percent]),[[A,3],[B,3]],'a mismatch never shows a higher percentage than a study ranked above it');
});

test('labels are short and factual and never predict eligibility',()=>{
 for(const text of Object.values(REASON_TEXT)){assert.doesNotMatch(text,/eligib|qualif|chance|likely to be accepted/i,text);assert.ok(text.length<=40,text)}
 assert.equal(REASON_TEXT.not_recruiting,'Not recruiting');assert.equal(REASON_TEXT.outside_age_range,'Outside the listed age range');assert.equal(REASON_TEXT.strong_match,'Strong match for your condition');assert.equal(REASON_TEXT.possible_match,'Possible match');
});

test('condition terms come from the page search and short Your details phrases; names, digit groups, ages and narrative stay out',()=>{
 assert.deepEqual(searchConditionTerms('Asthma OR COPD, Type 2 diabetes'),['Asthma','COPD','Type 2 diabetes']);
 assert.deepEqual(searchConditionTerms('asthma 90210'),[]);
 for(const refused of ['45 female','female 45','52 M COPD','asthma 12/03','COPD 52M','45M asthma','asthma 45F','45yoF asthma','45 y/o F asthma','asthma 12-03','asthma (12-03)','45-year-old asthma','aged 52 asthma','1.5 asthma','Type 450'])assert.deepEqual(searchConditionTerms(refused),[],refused);
 for(const kept of ['Type 1 diabetes','Type 1.5 diabetes','COVID 19','Covid 19 pneumonia','HIV 1','HIV-1','HPV 16','CKD 3','MODY 3','MEN 2','Monosomy 7','EGFR exon 19 deletion','Neurofibromatosis 1','Stage IV','BRCA1','11q deletion','CIN 3','IL-6','Stage 3 yolk sac tumor'])assert.deepEqual(searchConditionTerms(kept),[kept],kept);
 assert.deepEqual(searchConditionTerms('Stage 4 lung cancer, trisomy 21, HER2-positive, COVID-19'),['Stage 4 lung cancer','trisomy 21','HER2-positive','COVID-19']);
 assert.deepEqual(detailConditionTerms('asthma, Dr Smith asthma, Mayo Clinic patient',''),['asthma'],'third-party names in phrases with titles or care words stay out');
 assert.deepEqual(detailConditionTerms('MS, relapsing MS, Hospital-acquired pneumonia, HER2-positive breast cancer, ME/CFS',''),['MS','relapsing MS','Hospital-acquired pneumonia','HER2-positive breast cancer','ME/CFS'],'abbreviations are not sentence words');
 assert.deepEqual(detailConditionTerms('I HAVE ASTHMA, COPD 52M, asthma',''),['asthma'],'shouted sentences and age-and-sex tokens stay out');
 assert.deepEqual(detailConditionTerms('dr smith asthma, mr jones copd, Ms Lee asthma, asthma at Mayo Clinic, MY ASTHMA, HER COPD, SON ADHD, Canary2 asthma, WHO grade 2 glioma, DID','Pat Canary'),['WHO grade 2 glioma','DID'],'titles in any case, care places, capitalised narrative and name variants stay out');
 for(const refused of ['COPD 52/M','COPD (52/M)','COPD f/52','COPD 52.M','COPD 52male','45female asthma','asthma March 12th','asthma 3rd March','men 52','asthma in men 45'])assert.deepEqual(searchConditionTerms(refused),[],refused);
 for(const kept of ['MEN 2','BRCA 2','GOLD 3','Chiari 1','BI-RADS 4','Gleason score 7','genotype 1','Grade 1-2','AML M3','4th ventricle tumor'])assert.deepEqual(searchConditionTerms(kept),[kept],kept);
 assert.deepEqual(detailConditionTerms('Pat has asthma since 1999, call 555-0100, ZIP 90210','Pat Canary'),[]);
 assert.deepEqual(detailConditionTerms("Long COVID; Pat's migraine\nchronic fatigue and joint pain",'Pat Canary'),['Long COVID','chronic fatigue','joint pain']);
 assert.deepEqual(detailConditionTerms('I have been feeling very tired for many months now and nobody knows why',''),[],'narrative sentences are not condition terms');
 assert.deepEqual(detailConditionTerms('45 years old, asthma',''),['asthma']);
 assert.deepEqual(rankConditions('asthma',['Asthma','wheezing']),['asthma','wheezing'],'no repeats, search condition first');
 assert.equal(rankConditions(undefined,['a','b','c','d','e','f','g'].map(x=>'term '+x)).length,6);
 assert.throws(()=>parseRankDetails({name:'Pat'}));assert.throws(()=>parseRankDetails({terms:['asthma 90210']}));assert.throws(()=>parseRankDetails({ageBand:'44'}));assert.throws(()=>parseRankDetails({sex:'other'}));
 assert.deepEqual(parseRankDetails({ageBand:'30_44',sex:'female',terms:['asthma']}),{ageBand:'30_44',sex:'female',terms:['asthma']});
});

/* Rank service with a fake helper port and fake host. */
class Events{listeners:((...v:any[])=>void)[]=[];addListener=(f:(...v:any[])=>void)=>{this.listeners.push(f)};emit=(...v:any[])=>{for(const f of [...this.listeners])f(...v)}}
type Reply=(m:any)=>any;
function nativeFake(reply:Reply){const sent:any[]=[],ports:any[]=[];return{sent,ports,connect(){const onMessage=new Events(),onDisconnect=new Events();const port={onMessage,onDisconnect,disconnected:false,postMessage(m:any){sent.push(structuredClone(m));setTimeout(()=>{const r=reply(m);if(r==='disconnect')onDisconnect.emit();else if(r)onMessage.emit(r)},1)},disconnect(){port.disconnected=true}};ports.push(port);return port}}}
const TOKEN='t'.repeat(43),DIGEST='a'.repeat(64);
function prepared(m:any,provider='openai'){return{id:m.id,type:'result',ok:true,result:{kind:'preparedRank',token:TOKEN,digest:DIGEST,expiresAt:Date.now()+300000,provider,nctIds:m.payload.nctIds,preview:{profile:m.payload.profile,request:{model:'gpt-6-luna',input:[{role:'user',content:[{type:'input_json',data:{profile:m.payload.profile}}]}],questions:m.payload.nctIds.map((name:string)=>({type:'score',name}))}}}}}
const ranked=(m:any,provider='openai')=>({id:m.id,type:'result',ok:true,result:{kind:'rankResult',mode:'test',provider,digest:DIGEST,scores:[score(A,33),score(B,100),score(C,67),score(D,67),score(E,0)]}});
const fail=(m:any,code:string)=>({id:m.id,type:'result',ok:false,code,error:'fixed'});
function hostFake({reply,confirm='accepted',off=false,lastError,url='https://clinicaltrials.gov/search?cond=Asthma'}:{reply:Reply;confirm?:RankConfirmOutcome;off?:boolean;lastError?:string;url?:string}){
 const native=nativeFake(reply),posts:RankingState[]=[],applied:any[]=[],confirms:RankConfirmSummary[]=[];let consent=false;
 const host:RankHost={snapshot:async()=>({generation:'g1',url,nctIds:[...ids],diagnostic:'',supported:true}),facts:async(id:string)=>{if(!facts[id])throw Error('unavailable');return facts[id]},post:(_tab,state)=>{posts.push(parseRankingState(structuredClone(state))!)},apply:async(_tab,_s,list)=>{applied.push(list.map(r=>r.nctId));return true},confirm:async(_tab,summary)=>{confirms.push(structuredClone(summary));return confirm},prefs:async()=>({displayMode:'popup',theme:'system',provider:'openai',localModel:null,aiRanking:off?'off':'on'}),consent:{has:async()=>consent,grant:async()=>{consent=true},clear:async()=>{consent=false}},connectNative:()=>native.connect(),lastError:()=>lastError};
 return{host,native,posts,applied,confirms,consented:()=>consent,setConsent:(v:boolean)=>{consent=v}};
}
const until=async(check:()=>boolean,ms=3000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw Error('timeout');await new Promise(r=>setTimeout(r,5))}};
const done=(posts:RankingState[])=>posts.find(p=>['done','off','unavailable'].includes(p.phase));
const details={ageBand:'30_44' as const,sex:'male' as const,terms:['wheezing']};

test('first OpenAI ranking: nothing is scored before the confirmation; accepting it ranks, applies and records the session confirmation',async()=>{
 const h=hostFake({reply:m=>m.type==='prepareRank'?prepared(m):m.type==='executeRank'?ranked(m):undefined});const service=createRankService(h.host);
 service.start(1,details);await until(()=>!!done(h.posts));
 assert.deepEqual(h.native.sent.map(m=>m.type),['prepareRank','executeRank']);
 assert.equal(h.confirms.length,1,'the first ranking asks once');assert.deepEqual(h.confirms[0].conditions,['Asthma','wheezing']);assert.equal(h.confirms[0].ageBand,undefined,'age band and sex are not part of what is sent');assert.ok(h.confirms[0].exactPayload.questions,'the exact request body is offered in the confirmation');
 assert.equal(h.consented(),true);
 const state=done(h.posts)!;assert.equal(state.phase,'done');assert.equal(state.applied,true);assert.equal(state.provider,'openai');assert.equal(state.mode,'test');
 assert.deepEqual(state.studies!.map(s=>[s.nctId,s.percent,s.reasonId]),[[D,67,'possible_match'],[A,33,'unclear'],[B,10,'not_recruiting'],[C,7,'outside_age_range'],[E,0,'sex_mismatch']]);
 assert.deepEqual(h.applied,[[D,A,B,C,E]]);assert.ok(state.request&&state.request.text.includes('gpt-6-luna'),'the request body is available for How this was ranked');
 assert.deepEqual(h.posts.map(p=>p.phase).filter((p,i,a)=>a.indexOf(p)===i),['checking','preparing','confirming','scoring','done']);
 /* A later page in the same browser session ranks without asking. */
 h.posts.length=0;service.start(1,{...details,terms:['cough']});await until(()=>!!done(h.posts));
 assert.equal(h.confirms.length,1,'no second confirmation');assert.deepEqual(h.native.sent.map(m=>m.type),['prepareRank','executeRank','prepareRank','executeRank']);
});

test('the helper payload holds only condition terms: no name, age band, exact age, sex, ZIP, coordinates or notes',async()=>{
 const h=hostFake({reply:m=>m.type==='prepareRank'?prepared(m):m.type==='executeRank'?ranked(m):undefined,url:'https://clinicaltrials.gov/search?cond=Asthma&locStr=Boise&lat=43.6&lng=-116.2&distance=50'});h.setConsent(true);
 createRankService(h.host).start(1,details);await until(()=>!!done(h.posts));
 const prepare=h.native.sent.find(m=>m.type==='prepareRank');assert.deepEqual(Object.keys(prepare.payload).sort(),['nctIds','profile']);assert.deepEqual(prepare.payload.profile,{conditions:['Asthma','wheezing']},'only condition terms are sent; age band and sex stay on this device');
 assert.doesNotMatch(JSON.stringify(h.native.sent),/Boise|43\.6|116\.2|lat|lng|zip|name|notes|PRIVATE/i);
 assert.throws(()=>parseRankDetails({ageBand:'30_44',name:'Pat Canary'}),'the background refuses any extra detail field');
});

test('declining keeps the page usable with record checks only and does not ask again until the person chooses to',async()=>{
 const h=hostFake({reply:m=>m.type==='prepareRank'?prepared(m):undefined,confirm:'declined'});const service=createRankService(h.host);
 service.start(1,details);await until(()=>!!done(h.posts));
 assert.deepEqual(h.native.sent.map(m=>m.type),['prepareRank'],'no executeRank without the confirmation');assert.equal(h.consented(),false);
 const state=done(h.posts)!;assert.equal(state.note,'declined');assert.equal(state.applied,true);assert.equal(state.provider,'none','nothing was sent, so How this was ranked names no provider');assert.equal(state.request,undefined);assert.equal(state.profile,undefined);assert.deepEqual(state.studies!.map(s=>s.nctId),[A,D,B,C,E],'known mismatches still move last');
 h.posts.length=0;service.start(1,{...details,terms:['cough']});await until(()=>!!done(h.posts));
 assert.equal(h.confirms.length,1,'an automatic re-run does not reopen the window');assert.deepEqual(h.native.sent.map(m=>m.type),['prepareRank'],'and sends nothing to the helper');
 h.posts.length=0;service.start(1,details,true);await until(()=>!!done(h.posts));assert.equal(h.confirms.length,2,'asking again is the person’s explicit choice');
});

test('a Decisions failure, an outdated helper or a missing helper keeps record-check ordering and says what failed',async()=>{
 for(const[reply,code,lastError]of [[(m:any)=>m.type==='prepareRank'?prepared(m):fail(m,'RATE_LIMITED'),'RATE_LIMITED'],[(m:any)=>fail(m,'INVALID_REQUEST'),'HELPER_VERSION_MISMATCH'],[()=>'disconnect','NATIVE_HOST_MISSING','Specified native messaging host not found.'],[(m:any)=>m.type==='prepareRank'?prepared(m):{id:m.id,type:'result',ok:true,result:{kind:'rankResult',mode:'live',provider:'openai',digest:'b'.repeat(64),scores:[]}},'INVALID_NATIVE_REPLY']] as const){
  const h=hostFake({reply:reply as Reply,lastError:lastError as string|undefined});h.setConsent(true);createRankService(h.host).start(1,details);await until(()=>!!done(h.posts));
  const state=done(h.posts)!;assert.equal(state.phase,'done',code);assert.equal(state.failure,code);assert.equal(state.applied,true,code);assert.equal(state.mode,undefined,code);
  const sent=code==='RATE_LIMITED'||code==='INVALID_NATIVE_REPLY';assert.equal(state.provider,sent?'openai':'none',code);assert.equal(!!state.request,sent,code);
  assert.deepEqual(state.studies!.map(s=>[s.nctId,s.percent]),[[A,null],[D,null],[B,0],[C,0],[E,0]],code);
 }
});

test('a mismatched result is rejected rather than applied',async()=>{
 const h=hostFake({reply:m=>m.type==='prepareRank'?prepared(m):{id:m.id,type:'result',ok:true,result:{kind:'rankResult',mode:'live',provider:'openai',digest:'b'.repeat(64),scores:[score(A,10),score(B,10),score(C,10),score(D,10),score(E,10)]}}});h.setConsent(true);
 createRankService(h.host).start(1,details);await until(()=>!!done(h.posts));assert.equal(done(h.posts)!.failure,'RESULT_MISMATCH');assert.ok(done(h.posts)!.studies!.every(s=>s.score===undefined));
});

test('AI-matched results off: nothing is fetched, sent or applied',async()=>{
 const h=hostFake({reply:()=>{throw Error('no native call expected')},off:true});createRankService(h.host).start(1,details);await until(()=>!!done(h.posts));
 assert.equal(done(h.posts)!.phase,'off');assert.equal(h.native.sent.length,0);assert.equal(h.applied.length,0);
});

test('no condition means record checks only, with nothing sent',async()=>{
 const none=hostFake({reply:()=>{throw Error('no native call expected')},url:'https://clinicaltrials.gov/search?locStr=Boise'});createRankService(none.host).start(1,{});await until(()=>!!done(none.posts));
 assert.equal(done(none.posts)!.note,'no_condition');assert.equal(none.native.sent.length,0);assert.equal(done(none.posts)!.applied,true);
});

test('a newer request supersedes a running one; one that arrives during the confirmation waits for it',async()=>{
 let release!:(v:RankConfirmOutcome)=>void;const h=hostFake({reply:m=>m.type==='prepareRank'?prepared(m):ranked(m)});h.host.confirm=async()=>new Promise(r=>{release=r});
 const service=createRankService(h.host);service.start(1,details);await until(()=>h.posts.some(p=>p.phase==='confirming'));
 assert.deepEqual(service.start(1,{...details,terms:['cough']}),{started:false,queued:true});
 release('accepted');await until(()=>h.posts.filter(p=>p.phase==='done').length===2);
 assert.deepEqual(h.native.sent.filter(m=>m.type==='prepareRank').map(m=>m.payload.profile.conditions),[['Asthma','wheezing'],['Asthma','cough']]);
 service.stop(1);assert.equal(service.isRunning(1),false);
});

test('when the page drops an applied ranking on its own, a cached ranking goes straight back; otherwise the overlay is told',async()=>{
 const h=hostFake({reply:m=>m.type==='prepareRank'?prepared(m):ranked(m)});h.setConsent(true);const service=createRankService(h.host);
 service.start(1,details);await until(()=>!!done(h.posts));assert.equal(done(h.posts)!.applied,true);assert.equal(h.applied.length,1);
 const page={generation:'g1',url:'https://clinicaltrials.gov/search?cond=Asthma',nctIds:[...ids],diagnostic:'',supported:true};
 service.lapsed(1,{...page,url:'https://clinicaltrials.gov/search?cond=Other'});await until(()=>true);assert.equal(h.applied.length,1,'a different page never gets the old ranking');
 const posts=h.posts.length;service.lapsed(1,page);await until(()=>h.applied.length===2);assert.equal(h.posts.length,posts,'re-applied from memory, with no new model call and nothing to report');
 assert.equal(h.native.sent.filter(m=>m.type==='executeRank').length,1);
 const failing=hostFake({reply:m=>m.type==='prepareRank'?prepared(m):fail(m,'RATE_LIMITED')});failing.setConsent(true);const other=createRankService(failing.host);
 other.start(1,details);await until(()=>!!done(failing.posts));other.lapsed(1,page);const last=failing.posts.at(-1)!;assert.equal(last.applied,false,'without a cached ranking the overlay offers to apply again');
 const count=failing.posts.length;other.lapsed(1,page);assert.equal(failing.posts.length,count,'only once');other.stopAll();other.lapsed(1,page);assert.equal(failing.posts.length,count);
 /* An older cached ranking never comes back over a newer run that failed, and a hidden tab is not re-ranked behind the person's back. */
 let mode:'ok'|'fail'='ok';const both=hostFake({reply:m=>m.type==='prepareRank'?prepared(m):mode==='ok'?ranked(m):fail(m,'RATE_LIMITED')});both.setConsent(true);const svc=createRankService(both.host);
 svc.start(1,details);await until(()=>!!done(both.posts));mode='fail';both.posts.length=0;svc.start(1,{...details,ageBand:'45_59'});await until(()=>!!done(both.posts));
 const applied=both.applied.length;svc.lapsed(1,page);await new Promise(r=>setTimeout(r,10));assert.equal(both.applied.length,applied,'the failed newer run is not replaced by the older ranking');assert.equal(both.posts.at(-1)!.applied,false);
 const hidden=hostFake({reply:m=>m.type==='prepareRank'?prepared(m):ranked(m)});hidden.setConsent(true);const hsvc=createRankService(hidden.host);hsvc.start(1,details);await until(()=>!!done(hidden.posts));
 hsvc.lapsed(1,page,false);await new Promise(r=>setTimeout(r,10));assert.equal(hidden.applied.length,1,'no re-apply on a hidden tab');assert.equal(hidden.posts.at(-1)!.applied,false);
});

test('with the local model provider the ranking runs on this device: no confirmation, a model name, unscored studies stay unscored',async()=>{
 const local=(m:any)=>m.type==='prepareRank'?prepared(m,'local'):{id:m.id,type:'result',ok:true,result:{kind:'rankResult',mode:'live',provider:'local',digest:DIGEST,scores:[{nctId:A,score:90,reasonId:'condition_match'},{nctId:B,failure:'LOCAL_INVALID_OUTPUT'},{nctId:C,score:40,reasonId:'broad_population'},{nctId:D,score:20,reasonId:'different_condition'},{nctId:E,score:95,reasonId:'condition_match'}]}};
 const h=hostFake({reply:local});h.host.prefs=async()=>({displayMode:'popup',theme:'system',provider:'local',localModel:'qwen3.5:9b',aiRanking:'on'});
 createRankService(h.host).start(1,details);await until(()=>!!done(h.posts));
 assert.equal(h.confirms.length,0,'nothing leaves the device, so nothing to confirm');
 const prepare=h.native.sent.find(m=>m.type==='prepareRank');assert.equal(prepare.payload.provider,'local');assert.equal(prepare.payload.model,'qwen3.5:9b');
 const state=done(h.posts)!;assert.equal(state.provider,'local');assert.equal(state.failure,undefined);
 assert.deepEqual(state.studies!.map(s=>[s.nctId,s.percent,s.reasonId]),[[A,90,'condition_match'],[D,20,'different_condition'],[E,10,'sex_mismatch'],[C,4,'outside_age_range'],[B,0,'not_recruiting']]);
 const none=hostFake({reply:()=>{throw Error('no native call expected')}});none.host.prefs=async()=>({displayMode:'popup',theme:'system',provider:'local',localModel:null,aiRanking:'on'});
 createRankService(none.host).start(1,details);await until(()=>!!done(none.posts));assert.equal(done(none.posts)!.failure,'LOCAL_MODEL_NOT_CHOSEN');assert.equal(none.native.sent.length,0);assert.equal(done(none.posts)!.applied,true);
 const allFailed=hostFake({reply:m=>m.type==='prepareRank'?prepared(m,'local'):{id:m.id,type:'result',ok:true,result:{kind:'rankResult',mode:'live',provider:'local',digest:DIGEST,scores:ids.map(nctId=>({nctId,failure:'LOCAL_NOT_INSTALLED'}))}}});allFailed.host.prefs=h.host.prefs;
 createRankService(allFailed.host).start(1,details);await until(()=>!!done(allFailed.posts));assert.equal(done(allFailed.posts)!.failure,'LOCAL_NOT_INSTALLED');
});

test('the ranking trace redacts key-shaped text from public records in its display copy',async()=>{
 const KEY='sk-'+'A'.repeat(30);
 const h=hostFake({reply:m=>{if(m.type!=='prepareRank')return ranked(m);const r:any=prepared(m);r.result.preview.request.input[0].content[0].data.note=`Sponsor ref ${KEY}`;return r}});h.setConsent(true);
 createRankService(h.host).start(1,details);await until(()=>!!done(h.posts));
 const state=done(h.posts)!;assert.ok(state.request);assert.doesNotMatch(state.request!.text,new RegExp(KEY));assert.match(state.request!.text,/redacted key-like text/);
});
