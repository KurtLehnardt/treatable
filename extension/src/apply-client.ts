/** Validated extension-frame client. Patient fields and email drafts are never accepted by this protocol. */
import {parseApplyReply,parsePreparedApply,parseApplyResult,parseApplyRecord,parseApplyRequest,parsePublicStudyBrief,parsePreparedStudyBrief,parseStudyBriefResult,parseLocalModelsResult,briefNctIds,PURPOSE_DISPLAY_MAX_CHARS,type PreparedApply,type ApplyResult,type ApplyRecord,type PublicStudyBrief,type PreparedStudyBrief,type StudyBriefResult,type StudyBriefEngine,type LocalModelsResult} from '../shared/apply-contract.mjs';
import {NativeOperationError,FAILURE_CODE} from './failures';
import {parseDemoReply,type DemoTrace} from '../shared/demo-contract.mjs';
export const APPLY_CLIENT_PORT='treatable-apply-v1';
/** A local brief may take several minutes on a slower machine; the background allows it LOCAL_NATIVE_TIMEOUT_MS. */
export const LOCAL_CLIENT_TIMEOUT_MS=275000;
export interface ApplyPort{postMessage:(v:unknown)=>void;disconnect:()=>void;onMessage:{addListener:(f:(v:any)=>void)=>void};onDisconnect:{addListener:(f:()=>void)=>void}}
export interface ApplyRuntime{connect:(options:{name:string})=>ApplyPort}
export interface StudyCandidate{nctId:string;title?:string}
/** purposes[i] is the complete official brief summary of records[i], kept for display only and never sent to a model. */
export interface BriefRecords{records:ApplyRecord[];briefs:PublicStudyBrief[];purposes?:string[]}
type Pending={resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;kind:'native'|'record'|'briefRecords';allowTrace?:boolean;trace?:(value:DemoTrace)=>void};
const NCT=/^NCT[0-9]{8}$/;
export class ApplyClient{
 private port?:ApplyPort;private pending=new Map<string,Pending>();nctId?:string;nctIds:string[]=[];candidates:StudyCandidate[]=[];expiresAt?:number;
 constructor(private runtime:ApplyRuntime,private newId:()=>string=()=>crypto.randomUUID()){}
 /** onRenew receives each new session deadline the background grants after renew(). */
 open(onEnd:()=>void,onRenew?:(expiresAt:number)=>void):Promise<string>{const p=this.runtime.connect({name:APPLY_CLIENT_PORT});this.port=p;return new Promise((resolve,reject)=>{let ready=false;const timer=setTimeout(()=>{if(!ready){this.disconnect();reject(new NativeOperationError('SESSION_ENDED'))}},5000);
  p.onMessage.addListener((v:any)=>{if(this.port!==p||!v||typeof v!=='object')return;
   if(v.kind==='applyReady'){
    if(ready)return;const ids=Array.isArray(v.nctIds)?v.nctIds:typeof v.nctId==='string'?[v.nctId]:[];
    if(ids.length>100||ids.some((id:unknown)=>typeof id!=='string'||!NCT.test(id))||new Set(ids).size!==ids.length)return;
    if(v.nctId!==undefined&&(typeof v.nctId!=='string'||!ids.includes(v.nctId)))return;
    if(v.expiresAt!==undefined&&(!Number.isFinite(v.expiresAt)||v.expiresAt<=0))return;
    ready=true;clearTimeout(timer);this.nctIds=[...ids];this.nctId=v.nctId??ids[0];this.expiresAt=v.expiresAt;
    const titles=new Map<string,string>();for(const item of Array.isArray(v.studies)?v.studies:[])if(ids.includes(item?.nctId)&&typeof item.title==='string')titles.set(item.nctId,item.title.slice(0,1000));
    this.candidates=ids.map((nctId:string)=>({nctId,...(titles.has(nctId)?{title:titles.get(nctId)}:{})}));resolve(this.nctId??'');return;
   }
   if(v.kind==='applyRenewed'){if(ready&&Number.isFinite(v.expiresAt)&&v.expiresAt>=(this.expiresAt??0)){this.expiresAt=v.expiresAt;onRenew?.(v.expiresAt)}return}
   if(v.kind==='applyEnded'){this.disconnect();onEnd();return}
   const reply=v.reply,id=reply?.id,item=typeof id==='string'?this.pending.get(id):undefined;if(!item)return;
   try{
    if(reply.type==='trace'){if(!item.allowTrace)throw Error();const value=parseDemoReply(reply,id);if(!value.trace)throw Error();item.trace?.(value.trace);return}
    clearTimeout(item.timer);this.pending.delete(id);
    if(item.kind==='record'){if(reply.type==='record'&&reply.ok===true){item.resolve(parseApplyRecord(reply.record));return}if(reply.ok===false&&typeof reply.code==='string'&&FAILURE_CODE.test(reply.code)){item.reject(new NativeOperationError(reply.code));return}throw Error()}
    if(item.kind==='briefRecords'){
     if(reply.ok===false&&typeof reply.code==='string'&&FAILURE_CODE.test(reply.code)){item.reject(new NativeOperationError(reply.code));return}
     if(reply.type!=='briefRecords'||reply.ok!==true||!Array.isArray(reply.records)||!Array.isArray(reply.briefs))throw Error();
     if(reply.purposes!==undefined&&(!Array.isArray(reply.purposes)||reply.purposes.length!==reply.records.length||reply.purposes.some((v:unknown)=>typeof v!=='string'||v.length>PURPOSE_DISPLAY_MAX_CHARS)))throw Error();
     item.resolve({records:reply.records.map(parseApplyRecord),briefs:reply.briefs.map(parsePublicStudyBrief),...(reply.purposes?{purposes:[...reply.purposes]}:{})});return;
    }
    const parsed=parseApplyReply(reply,id);if(!parsed.ok)item.reject(new NativeOperationError(parsed.code!));else item.resolve(parsed.result);
   }catch{clearTimeout(item.timer);this.pending.delete(id);item.reject(new NativeOperationError('INVALID_NATIVE_REPLY'))}
  });
  p.onDisconnect.addListener(()=>{clearTimeout(timer);if(this.port===p){this.port=undefined;this.rejectAll();onEnd()}if(!ready)reject(new NativeOperationError('SESSION_ENDED'))});
 })}
 private send(message:Record<string,unknown>,id:string,kind:Pending['kind'],allowTrace=false,trace?:(value:DemoTrace)=>void,timeout=155000){if(!this.port)return Promise.reject(new NativeOperationError('SESSION_ENDED'));return new Promise<any>((resolve,reject)=>{if(this.pending.size>=4){reject(new NativeOperationError('BUSY'));return}const timer=setTimeout(()=>{this.pending.delete(id);reject(new NativeOperationError('NATIVE_TIMEOUT'))},timeout);this.pending.set(id,{resolve,reject,timer,kind,allowTrace,trace});try{this.port!.postMessage(message)}catch{clearTimeout(timer);this.pending.delete(id);reject(new NativeOperationError('SESSION_ENDED'))}})}
 private native(type:string,payload:unknown,trace?:(value:DemoTrace)=>void,timeout?:number){let request;try{request=parseApplyRequest({id:this.newId(),type,payload})}catch{return Promise.reject(new NativeOperationError('INVALID_REQUEST'))}return this.send({kind:'applyNative',request},request.id,'native',type==='executeApply'||type==='executeStudyBrief',trace,timeout)}
 renew(){if(this.port&&this.expiresAt!==undefined)try{this.port.postMessage({kind:'applyRenew'})}catch{}}

 async prepare(nctId:string):Promise<PreparedApply>{const v=parsePreparedApply(await this.native('prepareApply',{nctId}));if(v.nctId!==nctId)throw new NativeOperationError('RESULT_MISMATCH');return v}
 async execute(prepared:PreparedApply):Promise<ApplyResult>{const v=parseApplyResult(await this.native('executeApply',{token:prepared.token,digest:prepared.digest}));if(v.nctId!==prepared.nctId||v.digest!==prepared.digest)throw new NativeOperationError('RESULT_MISMATCH');return v}
 async revoke(){await this.native('revokeApply',{})}
 async record(nctId:string):Promise<ApplyRecord>{const id=this.newId();const v:ApplyRecord=await this.send({kind:'applyRecord',id},id,'record');if(v.nctId!==nctId)throw new NativeOperationError('RECORD_MISMATCH');return v}
 async recordBrief(nctIds:string[]):Promise<BriefRecords>{const ids=briefNctIds(nctIds),id=this.newId(),v:BriefRecords=await this.send({kind:'studyBriefRecord',id,nctIds:ids},id,'briefRecords');this.sameStudies(ids,v.records.map(r=>r.nctId));this.sameStudies(ids,v.briefs.map(b=>b.nctId));return v}
 /** engine undefined means OpenAI (the default). A local engine names only an installed model; the prepared reply must echo it exactly. */
 async prepareBrief(nctIds:string[],engine?:StudyBriefEngine):Promise<PreparedStudyBrief>{const ids=briefNctIds(nctIds),v=parsePreparedStudyBrief(await this.native('prepareStudyBrief',{nctIds:ids,...(engine?{provider:'local',model:engine.model}:{})}));this.sameStudies(ids,v.records.map(r=>r.nctId));this.sameStudies(ids,v.briefs.map(b=>b.nctId));if(JSON.stringify(v.engine??null)!==JSON.stringify(engine?{provider:'local',model:engine.model}:null))throw new NativeOperationError('RESULT_MISMATCH');return v}
 /** Ollama, machine profile, installed generation models and one recommendation. Sends no input at all. */
 async localModels():Promise<LocalModelsResult>{return parseLocalModelsResult(await this.native('localModels',{}))}
 async executeBrief(prepared:PreparedStudyBrief,trace?:(value:DemoTrace)=>void):Promise<StudyBriefResult>{const v=parseStudyBriefResult(await this.native('executeStudyBrief',{token:prepared.token,digest:prepared.digest},trace,prepared.engine?LOCAL_CLIENT_TIMEOUT_MS:undefined));if(v.digest!==prepared.digest||(v.mode==='local')!==!!prepared.engine||v.local&&v.local.model!==prepared.engine?.model)throw new NativeOperationError('RESULT_MISMATCH');this.sameStudies(prepared.records.map(r=>r.nctId),v.briefs.map(b=>b.nctId));this.sameStudies(prepared.records.map(r=>r.nctId),v.studyPlans.map(p=>p.nctId));return v}
 async revokeBrief(){await this.native('revokeStudyBrief',{})}
 private sameStudies(expected:string[],actual:string[]){if(expected.length!==actual.length||actual.some((id,i)=>id!==expected[i]))throw new NativeOperationError('RESULT_MISMATCH')}
 private rejectAll(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new NativeOperationError('SESSION_ENDED'))}this.pending.clear()}
 disconnect(){const p=this.port;this.port=undefined;this.rejectAll();try{p?.disconnect()}catch{}}
}
