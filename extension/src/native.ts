import {parseLocalRequest,parseNativeReply,parseStatus,type ValidatedStatus} from './validation';
export type NativeStatus=ValidatedStatus;
export interface RuntimeMessenger{sendMessage:(message:unknown)=>Promise<unknown>}
export class LocalModelClient{
 constructor(private runtime:RuntimeMessenger){}
 async status():Promise<NativeStatus>{const request=parseLocalRequest({id:crypto.randomUUID(),type:'status',payload:{}});const reply=parseNativeReply(await this.runtime.sendMessage({kind:'native',request}),request);return parseStatus(reply)}
 async generate(model:string,prompt:string,signal:AbortSignal):Promise<string>{
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');const request=parseLocalRequest({id:crypto.randomUUID(),type:'generate',payload:{model,prompt}});
  const abort=()=>{void this.runtime.sendMessage({kind:'native',request:{id:crypto.randomUUID(),type:'cancel',payload:{requestId:request.id}}}).catch(()=>{})};signal.addEventListener('abort',abort,{once:true});
  try{const value=await this.runtime.sendMessage({kind:'native',request});if(signal.aborted)throw new DOMException('Cancelled','AbortError');const reply=parseNativeReply(value,request);if(!reply.ok||typeof reply.text!=='string')throw new Error('Local model unavailable. Source checks are preserved.');return reply.text}finally{signal.removeEventListener('abort',abort)}
 }
}
export class LatestRun{private revision=0;start(){return ++this.revision}isCurrent(id:number){return this.revision===id}cancel(){this.revision++}}
