/** "Help me apply" broker. Only the authenticated overlay frame on a ClinicalTrials.gov study page may connect. The study
 * ID comes from the validated tab URL, never from the page DOM; only that public NCT ID and a prepared receipt reach the
 * native helper. Patient fields never arrive here. */
import{parseApplyRequest,parseApplyReply,type ApplyRequest}from'../shared/apply-contract.mjs';
import{normalizeApplyRecord}from'../shared/apply-record.mjs';
import{FAILURE_CODE,failureCopy,nativeDisconnectCode}from'./failures';
import{studyPageNctId}from'./apply-page';
import{fetchPublicStudyJson}from'./site-background';
export const APPLY_PORT='treatable-apply-v1';
export const APPLY_NATIVE_TIMEOUT_MS=150000;
const ID=/^[A-Za-z0-9_-]{1,80}$/;
type Prepared={token:string;digest:string;expiresAt:number;nctId:string};
export interface ApplySiteAccess{overlaySender:(sender:any)=>boolean}
export function installApplyBroker(api:any,site:ApplySiteAccess,options:{fetchStudyJson?:(nctId:string)=>Promise<unknown>;now?:()=>number}={}){
 const now=options.now??(()=>Date.now()),sessions=new Map<any,{tabId:number;nctId:string;end:(notify?:boolean)=>void}>();
 const failure=(id:string,code:string)=>{const safe=FAILURE_CODE.test(code)?code:'UNEXPECTED_FAILURE';return{id,type:'result',ok:false,code:safe,error:failureCopy(safe)}};
 async function currentStudy(sender:any){if(!site.overlaySender(sender))return;const tab=await api.tabs.get(sender.tab.id).catch(()=>undefined);return studyPageNctId(tab?.url)}
 function endTab(tabId:number,keepStudy?:string){for(const s of [...sessions.values()])if(s.tabId===tabId&&s.nctId!==keepStudy)s.end(true)}
 api.runtime.onConnect.addListener((port:any)=>{
  if(port.name!==APPLY_PORT)return;const sender=port.sender;
  if(!site.overlaySender(sender)){try{port.disconnect()}catch{}return}
  const tabId:number=sender.tab.id;let initial:string|undefined;
  let native:any,closed=false,prepared:Prepared|undefined;const pending=new Map<string,{request:ApplyRequest;nctId:string;timer:ReturnType<typeof setTimeout>}>();
  const post=(v:unknown)=>{if(!closed)try{port.postMessage(v)}catch{end()}};
  const settle=(id:string,reply:unknown)=>{const item=pending.get(id);if(!item)return;clearTimeout(item.timer);pending.delete(id);post({reply})};
  function end(notify=false){if(closed)return;if(notify)try{port.postMessage({kind:'applyEnded'})}catch{}closed=true;sessions.delete(port);for(const p of pending.values())clearTimeout(p.timer);pending.clear();const n=native,token=prepared?.token;native=undefined;prepared=undefined;
   // Revoke the one-use receipt, then let the helper read it before closing its stdio.
   if(n){if(token)try{n.postMessage({id:`revoke-${tabId}-${Math.floor(now())}`,type:'revokeApply',payload:{token}})}catch{}setTimeout(()=>{try{n.disconnect()}catch{}},token?500:0)}
   try{port.disconnect()}catch{}}
  function connection(){if(native)return native;const n=api.runtime.connectNative('com.treatable.local');native=n;
   n.onMessage.addListener((value:any)=>{if(closed||native!==n)return;const id=value?.id,item=typeof id==='string'?pending.get(id):undefined;if(!item)return;
    let reply:any;try{reply=parseApplyReply(value,id)}catch{settle(id,failure(id,'INVALID_NATIVE_REPLY'));return}
    if(!reply.ok){if(item.request.type==='executeApply'||reply.code==='APPLY_EXPIRED')prepared=undefined;settle(id,failure(id,reply.code));return}
    const r=reply.result;
    if(item.request.type==='prepareApply'){if(r?.kind!=='preparedApply'||r.nctId!==item.nctId||r.record.nctId!==item.nctId){settle(id,failure(id,'RESULT_MISMATCH'));return}prepared={token:r.token,digest:r.digest,expiresAt:r.expiresAt,nctId:r.nctId}}
    else if(item.request.type==='executeApply'){const p=prepared;prepared=undefined;if(r?.kind!=='applyAgent'||!p||r.nctId!==p.nctId||r.digest!==p.digest){settle(id,failure(id,'RESULT_MISMATCH'));return}}
    else if(r!==undefined){settle(id,failure(id,'INVALID_NATIVE_REPLY'));return}
    settle(id,r===undefined?{id,type:'result',ok:true}:{id,type:'result',ok:true,result:r});
   });
   n.onDisconnect.addListener(()=>{const code=nativeDisconnectCode(api.runtime.lastError?.message);if(native!==n)return;native=undefined;prepared=undefined;for(const id of [...pending.keys()])settle(id,failure(id,code))});
   return n}
  async function record(id:string){const nctId=await currentStudy(sender);if(closed)return;if(!nctId||nctId!==initial){post({reply:failure(id,'NOT_STUDY_PAGE')});return}
   try{const raw=options.fetchStudyJson?await options.fetchStudyJson(nctId):await fetchPublicStudyJson(nctId,4*1024*1024,8000);const value=normalizeApplyRecord(raw,now());if(closed)return;if(value.nctId!==nctId)throw Error();post({reply:{id,type:'record',ok:true,record:value}})}catch{post({reply:failure(id,'RECORD_UNAVAILABLE')})}}
    // The session binds to the study shown in the validated tab URL when the frame connects.
  const ready=currentStudy(sender).then(id=>{if(closed)return;if(!id){end();return}initial=id;sessions.set(port,{tabId,nctId:id,end});post({kind:'applyReady',nctId:id})},()=>end());
  port.onMessage.addListener((message:any)=>{if(closed)return;void(async()=>{await ready;if(closed||!initial)return;
   if(message?.kind==='applyRecord'){if(Object.keys(message).some(k=>!['kind','id'].includes(k))||typeof message.id!=='string'||!ID.test(message.id)){end();return}await record(message.id);return}
   if(message?.kind!=='applyNative'||Object.keys(message).some(k=>!['kind','request'].includes(k))){end();return}
   let request:ApplyRequest;try{request=parseApplyRequest(message.request)}catch{end();return}
   const nctId=await currentStudy(sender);if(closed)return;
   if(pending.has(request.id)){end();return}if(pending.size){post({reply:failure(request.id,'BUSY')});return}
   if(!nctId||nctId!==initial){post({reply:failure(request.id,'NOT_STUDY_PAGE')});return}
   if(request.type==='prepareApply'&&request.payload.nctId!==nctId){post({reply:failure(request.id,'NOT_STUDY_PAGE')});return}
   if(request.type==='executeApply'){const p=prepared;if(!p||p.token!==request.payload.token||p.digest!==request.payload.digest||p.nctId!==nctId){post({reply:failure(request.id,'INVALID_APPLY_RECEIPT')});return}if(p.expiresAt<=now()){prepared=undefined;post({reply:failure(request.id,'APPLY_EXPIRED')});return}}
   if(request.type==='revokeApply'){const token=prepared?.token;prepared=undefined;if(!token||!native){post({reply:{id:request.id,type:'result',ok:true}});return}request={id:request.id,type:'revokeApply',payload:{token}}}
   const timer=setTimeout(()=>{settle(request.id,failure(request.id,'NATIVE_TIMEOUT'));end()},APPLY_NATIVE_TIMEOUT_MS);pending.set(request.id,{request,nctId,timer});
   let n:any;try{n=connection();n.postMessage(request)}catch(error){if(n&&native===n){native=undefined;try{n.disconnect()}catch{}}settle(request.id,failure(request.id,nativeDisconnectCode(error instanceof Error?error.message:'')))}
  })()});
  port.onDisconnect.addListener(()=>end());
 });
 api.tabs.onUpdated.addListener((tabId:number,change:any)=>{if(change?.url)endTab(tabId,studyPageNctId(change.url))});
 api.tabs.onRemoved.addListener((tabId:number)=>endTab(tabId));
 return{endTab,sessionCount:()=>sessions.size};
}
