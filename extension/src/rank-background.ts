/** AI-matched results in the background. One run ranks the visible cards of one results page:
 * 1. local record checks (recruiting status, listed age range, listed sex) from public records the extension fetches itself;
 * 2. when the page has condition terms, one pinned helper ranking of those terms alone (prepareRank, then executeRank with its one-use receipt);
 *    with the OpenAI provider the first ranking in a browser session waits for the person's confirmation;
 * 3. the merged order and match percentages are applied to the page.
 * If the helper or the provider fails, the record checks still order the page and the overlay is told what failed. */
import{parseRankReply,parsePreparedRank,parseRankResult,rankTerm,RANK_MAX_STUDIES,RANK_MAX_TERMS,RANK_SEXES,type RankProfile,type RankScore,type RankSex}from'../shared/rank-contract.mjs';
import{isLocalModelName}from'../shared/local-model.mjs';
import{AGE_BANDS,type AgeBand}from'../shared/real-contract.mjs';
import{traceBody}from'../shared/apply-contract.mjs';
import{NOT_SENT_CODES,NativeOperationError,failureCodeOf,nativeDisconnectCode}from'./failures';
import{mergeRanking,rankConditions,recordChecks,type RankedStudy,type StudyFacts}from'./rank-merge';
import type{RankingNote,RankingState}from'./rank-state';
import type{RankingConsent}from'./ranking-consent';
import type{SiteSnapshot}from'./site-contract';
import{readSiteSearchUrl}from'./site-search';
import type{UiPrefs}from'./ui-prefs';
export const RANK_NATIVE_HOST='com.treatable.local';
/** Ranked results stay in extension memory for the length of a Treatable session, so the page order can be put back without asking a model again. */
export const RANK_CACHE_TTL_MS=30*60*1000;
const PREPARE_TIMEOUT_MS=60000,EXECUTE_TIMEOUT_MS=150000,TRACE_ROOM=90_000;
/** What the overlay may add from "Your details": a coarse age band, sex and short condition terms. Nothing else is accepted. */
export interface RankDetails{ageBand?:AgeBand;sex?:RankSex;terms?:string[]}
export function parseRankDetails(v:unknown):RankDetails{
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['ageBand','sex','terms'].includes(k)))throw Error('Invalid ranking details');const d=v as Record<string,unknown>;
 if(d.ageBand!==undefined&&!AGE_BANDS.includes(d.ageBand as AgeBand))throw Error('Invalid age band');if(d.sex!==undefined&&!RANK_SEXES.includes(d.sex as RankSex))throw Error('Invalid sex');
 if(d.terms!==undefined&&(!Array.isArray(d.terms)||d.terms.length>RANK_MAX_TERMS||d.terms.some(t=>rankTerm(t)!==t)))throw Error('Invalid condition terms');
 return{...(d.ageBand!==undefined?{ageBand:d.ageBand as AgeBand}:{}),...(d.sex!==undefined?{sex:d.sex as RankSex}:{}),...(d.terms!==undefined?{terms:[...d.terms as string[]]}:{})};
}
export interface RankFacts extends StudyFacts{title?:string}
/** What the confirmation window shows: the minimized profile, the public studies and the exact provider request body. */
export interface RankConfirmSummary{provider:'openai';conditions:string[];ageBand?:string;sex?:string;studies:{nctId:string;title:string}[];exactPayload:Record<string,unknown>}
/** 'declined' is the person's choice (Not now, closing the window or letting it time out); 'aborted' means the page changed or Treatable closed. */
export type RankConfirmOutcome='accepted'|'declined'|'aborted';
export interface RankHost{
 snapshot(tabId:number):Promise<SiteSnapshot>;
 facts(nctId:string):Promise<RankFacts>;
 post(tabId:number,state:RankingState):void;
 /** Applies the order and match percentages when the page still shows exactly the ranked cards. Resolves whether it did. */
 apply(tabId:number,snapshot:SiteSnapshot,ranked:RankedStudy[]):Promise<boolean>;
 confirm(tabId:number,summary:RankConfirmSummary):Promise<RankConfirmOutcome>;
 prefs():Promise<UiPrefs>;
 consent:RankingConsent;
 connectNative():any;
 lastError():unknown;
}
/** One native helper connection for one run. Trace frames are ignored; every reply is checked against the shared contract. */
class NativeRankSession{
 private port:any;private closed=false;private pending=new Map<string,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 constructor(private host:RankHost){}
 private connect(){
  if(this.port)return this.port;const p=this.host.connectNative();this.port=p;
  p.onMessage.addListener((value:any)=>{if(this.port!==p)return;const id=value?.id,item=typeof id==='string'?this.pending.get(id):undefined;if(!item||value?.type==='trace')return;let reply;
   try{reply=parseRankReply(value,id)}catch{this.settle(id,new NativeOperationError('INVALID_NATIVE_REPLY'));return}
   // Requests reaching the helper already passed the shared contract, so an INVALID_REQUEST answer means an older or newer helper.
   if(!reply.ok)this.settle(id,new NativeOperationError(reply.code==='INVALID_REQUEST'?'HELPER_VERSION_MISMATCH':reply.code!));else this.settle(id,undefined,reply.result)});
  p.onDisconnect.addListener(()=>{if(this.port!==p)return;const code=nativeDisconnectCode(this.host.lastError());this.port=undefined;for(const id of [...this.pending.keys()])this.settle(id,new NativeOperationError(code))});
  return p;
 }
 private settle(id:string,error?:Error,value?:unknown){const item=this.pending.get(id);if(!item)return;clearTimeout(item.timer);this.pending.delete(id);if(error)item.reject(error);else item.resolve(value)}
 request(type:string,payload:Record<string,unknown>,timeout:number){
  if(this.closed)return Promise.reject(new NativeOperationError('SESSION_ENDED'));const id=`rank-${crypto.randomUUID()}`;
  return new Promise<unknown>((resolve,reject)=>{const timer=setTimeout(()=>{this.settle(id,new NativeOperationError('NATIVE_TIMEOUT'));this.close()},timeout);this.pending.set(id,{resolve,reject,timer});try{this.connect().postMessage({id,type,payload})}catch{this.settle(id,new NativeOperationError('NATIVE_HOST_DISCONNECTED'))}});
 }
 /** Disconnecting stops the helper process, which clears its pinned ranking and aborts any request still running. */
 close(){if(this.closed)return;this.closed=true;const p=this.port;this.port=undefined;for(const id of [...this.pending.keys()])this.settle(id,new NativeOperationError('SESSION_ENDED'));try{p?.disconnect()}catch{}}
}
type Run={token:number;phase:RankingState['phase'];session?:NativeRankSession;queued?:{details:RankDetails;force:boolean}};
export function createRankService(host:RankHost,{now=()=>Date.now()}:{now?:()=>number}={}){
 const runs=new Map<number,Run>(),cache=new Map<number,{key:string;state:RankingState;ranked:RankedStudy[];expires:number}>(),declined=new Set<number>(),last=new Map<number,{state:RankingState;url:string;ids:string}>();let sequence=0;
 /** Starts ranking the current page. While a confirmation window is open the newest request waits for it instead. */
 function start(tabId:number,details:RankDetails,force=false){
  const current=runs.get(tabId);if(current?.phase==='confirming'){current.queued={details,force};return{started:false,queued:true}}
  cancel(tabId);if(force)declined.delete(tabId);const token=++sequence,entry:Run={token,phase:'checking'};runs.set(tabId,entry);
  void run(tabId,entry,details,force).catch(()=>{if(runs.get(tabId)===entry)host.post(tabId,{phase:'unavailable',failure:'UNEXPECTED_FAILURE'})}).finally(()=>{if(runs.get(tabId)!==entry)return;runs.delete(tabId);if(entry.queued)start(tabId,entry.queued.details,entry.queued.force)});
  return{started:true,queued:false};
 }
 function cancel(tabId:number){const r=runs.get(tabId);if(!r)return;runs.delete(tabId);r.session?.close()}
 /** Turning AI-matched results off, closing Treatable or leaving the tab: stop, forget cached results and any "Not now". */
 function stop(tabId:number){cancel(tabId);cache.delete(tabId);declined.delete(tabId);last.delete(tabId)}
 /** The page dropped an applied ranking on its own (its five-minute lease ended): tell the overlay so it offers to apply it again. */
 function lapsed(tabId:number,current?:SiteSnapshot){const entry=last.get(tabId);if(!entry?.state.applied||runs.has(tabId)||current&&(current.url!==entry.url||current.nctIds.join()!==entry.ids))return;
  // Put a still-valid ranking straight back (no model call); otherwise let the overlay offer to apply it again.
  const cached=cache.get(tabId);if(current&&cached&&cached.expires>now()&&cached.ranked.map(r=>r.nctId).sort().join()===[...current.nctIds].sort().join()){void host.apply(tabId,current,cached.ranked).then(ok=>{if(ok||last.get(tabId)!==entry)return;const next={...entry.state,applied:false};last.set(tabId,{...entry,state:next});host.post(tabId,next)}).catch(()=>{});return}
  const next={...entry.state,applied:false};last.set(tabId,{...entry,state:next});host.post(tabId,next)}
 async function run(tabId:number,entry:Run,details:RankDetails,force:boolean){
  const alive=()=>runs.get(tabId)===entry,post=(state:RankingState)=>{if(alive())host.post(tabId,state)},phase=(p:RankingState['phase'],total:number)=>{entry.phase=p;post({phase:p,total})};
  const prefs=await host.prefs().catch(()=>undefined);if(!alive())return;if(prefs?.aiRanking!=='on'){post({phase:'off'});return}
  const s=await host.snapshot(tabId);if(!alive())return;
  if(!s.supported||!s.nctIds.length){post({phase:'unavailable',note:'no_cards',total:0});return}
  if(s.nctIds.length>RANK_MAX_STUDIES){post({phase:'unavailable',note:'too_many',total:s.nctIds.length});return}
  let cond:unknown;try{cond=readSiteSearchUrl(s.url).cond}catch{}
  // Relevance needs only the condition terms. The age band and sex stay on this device and feed the record checks alone.
  const conditions=rankConditions(cond,details.terms??[]),profile:RankProfile|undefined=conditions.length?{conditions}:undefined;
  const key=JSON.stringify({url:s.url,ids:s.nctIds,conditions,ageBand:details.ageBand??null,sex:details.sex??null}),cached=cache.get(tabId);
  if(!force&&cached&&cached.key===key&&cached.expires>now()){const applied=await host.apply(tabId,s,cached.ranked);if(alive())last.set(tabId,{state:{...cached.state,applied},url:s.url,ids:s.nctIds.join()});post({...cached.state,applied});return}
  const total=s.nctIds.length;phase('checking',total);
  const facts=await Promise.all(s.nctIds.map(id=>host.facts(id).catch(()=>undefined)));if(!alive())return;
  const checks=Object.fromEntries(s.nctIds.map((id,i)=>[id,recordChecks(facts[i],details)]));
  let attempted=false,scores:RankScore[]|undefined,failure:string|undefined,note:RankingNote|undefined,provider:'openai'|'local'|'none'='none',mode:'live'|'test'|undefined,request:RankingState['request'],sent:RankProfile|undefined;
  if(!profile)note='no_condition';
  else if(declined.has(tabId))note='declined';
  else{
   const session=new NativeRankSession(host);entry.session=session;
   // The model provider setting also chooses who ranks: OpenAI, or the local model on this device (nothing leaves it).
   const local=prefs.provider==='local',model=local?prefs.localModel:undefined;
   try{
    if(local&&!isLocalModelName(model))throw new NativeOperationError('LOCAL_MODEL_NOT_CHOSEN');
    phase('preparing',total);
    const prepared=parsePreparedRank(await session.request('prepareRank',{nctIds:s.nctIds,profile,...(local?{provider:'local',model}:{})},PREPARE_TIMEOUT_MS));if(!alive())return;
    if(prepared.provider!==(local?'local':'openai')||JSON.stringify(prepared.nctIds)!==JSON.stringify(s.nctIds)||JSON.stringify(prepared.preview.profile)!==JSON.stringify(profile))throw new NativeOperationError('RESULT_MISMATCH');
    provider=prepared.provider;request=traceBody(prepared.preview.request,TRACE_ROOM);sent=prepared.preview.profile;
    // A local model keeps everything on this device, so only the OpenAI provider needs the browser-session confirmation.
    if(prepared.provider==='openai'&&!await host.consent.has()){
     if(!alive())return;phase('confirming',total);
     const outcome=await host.confirm(tabId,{provider:'openai',conditions:[...profile.conditions],studies:s.nctIds.map((nctId,i)=>({nctId,title:facts[i]?.title||nctId})),exactPayload:prepared.preview.request});
     if(!alive())return;if(outcome==='accepted')await host.consent.grant();else{if(outcome==='declined')declined.add(tabId);note='declined';failure='CONFIRMATION_CANCELLED'}
    }
    if(!failure){
     phase('scoring',total);attempted=true;const result=parseRankResult(await session.request('executeRank',{token:prepared.token,digest:prepared.digest},EXECUTE_TIMEOUT_MS));if(!alive())return;
     if(result.digest!==prepared.digest||result.provider!==prepared.provider||result.scores.length!==s.nctIds.length||result.scores.some(x=>!s.nctIds.includes(x.nctId)))throw new NativeOperationError('RESULT_MISMATCH');
     // A local model can fail for single studies; those stay unscored. If none was scored, the first failure explains why.
     const scored=result.scores.filter((x):x is RankScore=>'score' in x),failed=result.scores.find(x=>'failure' in x) as {failure:string}|undefined;
     if(scored.length){scores=scored;mode=result.mode}else failure=failed?.failure??'INVALID_NATIVE_REPLY';
    }
   }catch(e){if(!alive())return;failure=failureCodeOf(e)}
   finally{session.close();if(entry.session===session)entry.session=undefined}
  }
  if(!alive())return;
  const ranked=mergeRanking(s.nctIds,checks,scores),titles=new Map(s.nctIds.map((id,i)=>[id,facts[i]?.title??'']));
  // The trace names a provider and shows what was sent only when the scoring request actually went out.
  const went=attempted&&(scores!==undefined||!NOT_SENT_CODES.has(failure??''));
  const state:RankingState={phase:'done',total,studies:ranked.map(r=>({...r,title:(titles.get(r.nctId)??'').slice(0,1000)})),provider:went?provider:'none',...(mode&&scores?{mode}:{}),...(failure?{failure}:{}),...(note?{note}:{}),...(went&&request?{request}:{}),...(went&&sent?{profile:{...sent,conditions:[...sent.conditions]}}:{})};
  entry.phase='done';const applied=await host.apply(tabId,s,ranked);if(!alive())return;
  if(applied&&scores)cache.set(tabId,{key,state,ranked,expires:now()+RANK_CACHE_TTL_MS});
  if(alive())last.set(tabId,{state:{...state,applied},url:s.url,ids:s.nctIds.join()});post({...state,applied});
 }
 return{start,cancel,stop,lapsed,endTab:stop,stopAll:()=>{for(const tabId of new Set([...runs.keys(),...cache.keys(),...last.keys(),...declined]))stop(tabId)},isRunning:(tabId:number)=>runs.has(tabId)};
}
