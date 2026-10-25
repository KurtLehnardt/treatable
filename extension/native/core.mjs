import {parseDemoRequest,MAX_MESSAGE_BYTES,validId} from '../shared/demo-contract.mjs';
export {MAX_MESSAGE_BYTES};
export const HOST_NAME='com.treatable.local';
export const EXTENSION_ID='lmgmjeabbalehlcakdbolielnfgchojf';
export const ID_PATTERN=/^[A-Za-z0-9_-]{1,80}$/;
import {parseLiveRequest,LIVE_REQUEST_TYPES} from '../shared/live-analysis-contract.mjs';
import {parseApplyRequest,APPLY_REQUEST_TYPES} from '../shared/apply-contract.mjs';
import {parseRankRequest,RANK_REQUEST_TYPES} from '../shared/rank-contract.mjs';
export function validateRequest(v){return LIVE_REQUEST_TYPES.includes(v?.type)?parseLiveRequest(v):APPLY_REQUEST_TYPES.includes(v?.type)?parseApplyRequest(v):RANK_REQUEST_TYPES.includes(v?.type)?parseRankRequest(v):parseDemoRequest(v);}
export function validateOrigin(origin,extensionId=EXTENSION_ID){return typeof extensionId==='string'&&/^[a-p]{32}$/.test(extensionId)&&origin===`chrome-extension://${extensionId}/`;}
export function encodeMessage(message){const body=Buffer.from(JSON.stringify(message),'utf8');if(!body.length||body.length>MAX_MESSAGE_BYTES)throw new Error('Invalid frame size');const header=Buffer.alloc(4);header.writeUInt32LE(body.length);return Buffer.concat([header,body]);}
export class MessageDecoder{
 constructor(onMessage,onError){this.buffer=Buffer.alloc(0);this.onMessage=onMessage;this.onError=onError;this.failed=false;}
 push(chunk){if(this.failed)return;try{this.buffer=Buffer.concat([this.buffer,chunk]);while(this.buffer.length>=4){const length=this.buffer.readUInt32LE(0);if(!length||length>MAX_MESSAGE_BYTES)throw new Error();if(this.buffer.length<length+4)return;const body=this.buffer.subarray(4,length+4);this.buffer=this.buffer.subarray(length+4);const text=new TextDecoder('utf-8',{fatal:true}).decode(body);this.onMessage(JSON.parse(text));}}catch{this.failed=true;this.buffer=Buffer.alloc(0);this.onError(new Error('Invalid native message'));}}
 end(){if(this.buffer.length&&!this.failed){this.failed=true;this.buffer=Buffer.alloc(0);this.onError(new Error('Incomplete native message'));}}
}
// Chrome native-messaging host manifest: fixed keys, one exact extension origin, absolute stdio launcher path.
export function validateHostManifest(m){return!!m&&typeof m==='object'&&!Array.isArray(m)&&Object.keys(m).sort().join()==='allowed_origins,description,name,path,type'&&m.name===HOST_NAME&&m.type==='stdio'&&typeof m.description==='string'&&typeof m.path==='string'&&/^\/[^\u0000-\u001f]*$/.test(m.path)&&Array.isArray(m.allowed_origins)&&m.allowed_origins.length===1&&typeof m.allowed_origins[0]==='string'&&/^chrome-extension:\/\/[a-p]{32}\/$/.test(m.allowed_origins[0]);}
export function replyId(raw){return validId(raw?.id)?raw.id:'invalid';}
// A reply that cannot be framed (too large, unserializable) is replaced by a small fixed error that never echoes the original value.
export function encodeReply(value,error='The native helper could not complete this request.'){try{return{frame:encodeMessage(value),ok:true};}catch{return{frame:encodeMessage({id:replyId(value),type:'result',ok:false,code:'INTERNAL_ERROR',error}),ok:false};}}
