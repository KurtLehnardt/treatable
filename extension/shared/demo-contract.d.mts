import type{RealResult,PreparedReal}from './real-contract.mjs';
export type FixtureId='fibromyalgia'|'pancreatic'|'neuropathy';
export interface DemoRequest{id:string;type:'status'|'scoreDemo'|'agentDemo'|'cancel'|'prepareReal'|'executeReal'|'revokeReal';payload:Record<string,unknown>}
export interface DemoTrace{sequence:number;stage:string;nctId?:string;sessionId?:string;requestId?:string;httpStatus?:number}
export type ScoreResult={kind:'scoreDemo';fixtureId:FixtureId;mode:'live'|'test';scores:{nctId:string;index:number;confidence:number}[]};
export type AgentResult={kind:'agentDemo';fixtureId:FixtureId;mode:'live'|'test';comparisons:{nctId:string;questionIds:string[]}[];cautionIds:string[];toolCalls:number;cleanup:'deleted'|'failed'};
export type DemoResult=ScoreResult|AgentResult;
export interface DemoReply{id:string;type:'status'|'trace'|'result';ok:boolean;provider?:'openai';configured?:boolean;message?:string;trace?:DemoTrace;result?:DemoResult|RealResult|PreparedReal;error?:string;code?:string}
export const FIXTURE_IDS:readonly FixtureId[];
export const MAX_MESSAGE_BYTES:number;export const MAX_ID_LENGTH:number;
export const QUESTION_TEMPLATES:Readonly<Record<string,string>>;export const CAUTION_TEMPLATES:Readonly<Record<string,string>>;export const TRACE_STAGES:readonly string[];
export function isRecord(v:unknown):v is Record<string,unknown>;
export function exactKeys(v:unknown,keys:string[]):boolean;
export function validId(v:unknown):v is string;
export function utf8Bytes(v:unknown):number;
export function parseDemoRequest(v:unknown):DemoRequest;
export function parseDemoReply(v:unknown,expectedId:string):DemoReply;
export function parseDemoResult(v:unknown):DemoResult;

export const parseNativeRequest:typeof parseDemoRequest;
export const parseNativeReply:typeof parseDemoReply;
