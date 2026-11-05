export interface DemoTrace{sequence:number;stage:string;nctId?:string;sessionId?:string;requestId?:string;httpStatus?:number;cleanupCode?:string;cleanupAttempts?:number}
export interface DemoReply{id:string;type:'trace'|'result';ok:boolean;trace?:DemoTrace;result?:undefined;error?:string;code?:string}
export const MAX_MESSAGE_BYTES:number;export const MAX_ID_LENGTH:number;
export const TRACE_STAGES:readonly string[];export const CLEANUP_FAILURE_CODES:readonly string[];
export function isRecord(v:unknown):v is Record<string,unknown>;
export function exactKeys(v:unknown,keys:string[]):boolean;
export function validId(v:unknown):v is string;
export function templateIdList(v:unknown,table:Readonly<Record<string,string>>,min:number,max:number):v is string[];
export function utf8Bytes(v:unknown):number;
export function parseDemoReply(v:unknown,expectedId:string):DemoReply;
