/** Validation at browser/native boundaries. Errors never echo patient or model input. */
export const MAX_MESSAGE_BYTES = 96 * 1024;
export const MAX_PROMPT_CHARS = 24000;
export const MAX_MODEL_RESPONSE_CHARS = 40000;
export const REQUEST_ID = /^[A-Za-z0-9_-]{1,80}$/;
export const MODEL_NAME = /^[a-z0-9][a-z0-9._-]{0,100}(?::[A-Za-z0-9._-]{1,80})?$/;
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const SINGLE_LINE = /[\r\n\t]/u;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
export type FormInput = {condition:string;notes:string;age:string;sex:string;zip:string;radius:string};
export type LocalRequest = {id:string;type:'status';payload:Record<string,never>} | {id:string;type:'generate';payload:{model:string;prompt:string}} | {id:string;type:'cancel';payload:{requestId:string}};
export interface ValidatedStatus {ok:boolean;models:{name:string;size?:number}[];message?:string}
export function record(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&Object.prototype.toString.call(value)==='[object Object]';}
export function exactKeys(value:Record<string,unknown>,keys:string[]){if(Object.keys(value).some(key=>!keys.includes(key)))throw new Error('Unsupported input format.');}
export function boundedText(value:unknown,label:string,max:number,{multiline=false,empty=true}:{multiline?:boolean;empty?:boolean}={}):string{
 if(typeof value!=='string'||value.length>max||CONTROLS.test(value)||LONE_SURROGATE.test(value)||(!multiline&&SINGLE_LINE.test(value)))throw new Error(`${label} contains unsupported text or exceeds its limit.`);
 const text=value.normalize('NFC').trim();if(!empty&&!text)throw new Error(`${label} is required.`);return text;
}
export function withinMessageBudget(value:unknown):void{let body:string|undefined;try{body=JSON.stringify(value)}catch{throw new Error('Unsupported local message.')}if(!body||new TextEncoder().encode(body).byteLength>MAX_MESSAGE_BYTES)throw new Error('Local message exceeds its size limit.');}
export function parseFormInput(value:unknown):FormInput{
 if(!record(value))throw new Error('Check your profile fields.');const fields=['condition','notes','age','sex','zip','radius'];exactKeys(value,fields);if(fields.some(key=>!Object.prototype.hasOwnProperty.call(value,key)))throw new Error('Check your profile fields.');
 const condition=boundedText(value.condition,'Conditions',2400,{multiline:true});
 const diagnoses=condition.split(/[,;\n]/).map(v=>v.trim()).filter(Boolean);
 if(diagnoses.length>12||diagnoses.some(v=>v.length>200))throw new Error('Enter at most 12 conditions, each no longer than 200 characters.');
 const notes=boundedText(value.notes,'Notes',12000,{multiline:true});if(!diagnoses.length&&!notes)throw new Error('Describe at least one condition or symptom.');
 const age=boundedText(value.age,'Age',8,{empty:false});if(!/^\d{1,3}(?:\.\d{1,3})?$/.test(age)||!Number.isFinite(Number(age))||Number(age)<0||Number(age)>120)throw new Error('Enter an age from 0 to 120 years using decimal digits.');
 const sex=boundedText(value.sex,'Sex',24,{empty:false});if(!['female','male','prefer_not_to_say'].includes(sex))throw new Error('Choose one of the listed sex options.');
 const zip=boundedText(value.zip,'ZIP code',10);if(zip&&!/^\d{5}(?:-\d{4})?$/.test(zip))throw new Error('Enter a five-digit US ZIP code, optionally ZIP+4.');
 const radius=boundedText(value.radius,'Travel radius',8,{empty:false});if(!['25','50','100','250','anywhere'].includes(radius))throw new Error('Choose one of the listed travel distances.');
 return {condition,notes,age,sex,zip,radius};
}
export function validModel(value:unknown):value is string{return typeof value==='string'&&MODEL_NAME.test(value)&&!/cloud/i.test(value);}
export function parseLocalRequest(value:unknown):LocalRequest{
 if(!record(value))throw new Error('Invalid local request.');exactKeys(value,['id','type','payload']);if(['id','type','payload'].some(key=>!Object.prototype.hasOwnProperty.call(value,key)))throw new Error('Invalid local request.');
 if(typeof value.id!=='string'||!REQUEST_ID.test(value.id)||!record(value.payload))throw new Error('Invalid local request.');const p=value.payload;
 let result:LocalRequest;
 if(value.type==='status'){exactKeys(p,[]);result={id:value.id,type:'status',payload:{}}}
 else if(value.type==='cancel'){exactKeys(p,['requestId']);if(typeof p.requestId!=='string'||!REQUEST_ID.test(p.requestId))throw new Error('Invalid cancellation.');result={id:value.id,type:'cancel',payload:{requestId:p.requestId}}}
 else if(value.type==='generate'){exactKeys(p,['model','prompt']);if(!validModel(p.model))throw new Error('Choose a verified installed local model.');const prompt=boundedText(p.prompt,'Local prompt',MAX_PROMPT_CHARS,{multiline:true,empty:false});result={id:value.id,type:'generate',payload:{model:p.model,prompt}}}
 else throw new Error('Unsupported local operation.');withinMessageBudget(result);return result;
}
export function parseStatus(value:unknown):ValidatedStatus{
 if(!record(value)||typeof value.ok!=='boolean'||!Array.isArray(value.models)||value.models.length>100)throw new Error('Local helper returned an unsupported status.');
 const seen=new Set<string>();const models=value.models.map(model=>{if(!record(model)||!validModel(model.name)||seen.has(model.name)||model.size!==undefined&&(!Number.isSafeInteger(model.size)||Number(model.size)<=0))throw new Error('Local helper returned unsupported model information.');exactKeys(model,['name','size']);seen.add(model.name);return{name:model.name,...(model.size===undefined?{}:{size:Number(model.size)})}});
 if(!value.ok&&models.length)throw new Error('Local helper returned an inconsistent status.');return{ok:value.ok,models,message:value.ok?'Private local runtime ready.':'Local helper unavailable. Local study search still works.'};
}
export function parseNativeReply(value:unknown,request:Pick<LocalRequest,'id'|'type'>):Record<string,unknown>{
 withinMessageBudget(value);if(!record(value)||value.id!==request.id||typeof value.ok!=='boolean')throw new Error('Local helper returned an unsupported response.');
 if(!value.ok){if(value.type!=='result'&&value.type!=='status')throw new Error('Local helper returned an unsupported response.');return{id:request.id,type:request.type==='status'?'status':'result',ok:false,...(request.type==='status'?{models:[],message:'Local helper unavailable. Local study search still works.'}:{error:'Local analysis is unavailable. Source checks are preserved.'})}}
 if(request.type==='status'){if(value.type!=='status')throw new Error('Local helper returned an unsupported status.');exactKeys(value,['id','type','ok','models','message']);return{id:request.id,type:'status',...parseStatus(value)}}
 if(value.type!=='result')throw new Error('Local helper returned an unsupported response.');
 if(request.type==='generate'){exactKeys(value,['id','type','ok','text']);const text=boundedText(value.text,'Local response',MAX_MODEL_RESPONSE_CHARS,{multiline:true,empty:false});return{id:request.id,type:'result',ok:true,text}}
 exactKeys(value,['id','type','ok']);return{id:request.id,type:'result',ok:true};
}
export function parsePageReply(value:unknown):unknown{if(!record(value)||value.ok!==true||!record(value.source))throw new Error('The current page could not be read. Open a supported study page and retry.');return value.source;}
