export type AgeBand='under_18'|'18_29'|'30_44'|'45_59'|'60_74'|'75_89'|'90_plus';
export interface RealPacket{ageBand:AgeBand;state?:string;sex?:'female'|'male'|'other'|'prefer_not_to_say';conditionIds:string[];selectedNctIds:string[]}
export interface PolicyReceipt{policyVersion:string;accepted:true}
export type RealOperation='score'|'agent';
export interface RealRequest{id:string;type:'prepareReal'|'executeReal'|'revokeReal';payload:Record<string,unknown>}
export interface RealPreview{packet:RealPacket;decisionsRequest:Record<string,unknown>;agentsRequest:Record<string,unknown>;toolResults:unknown[]}
export interface PreparedReal{kind:'preparedReal';token:string;digest:string;expiresAt:number;policyVersion:string;catalogMetadata:Readonly<{version:string;vocabulary:string;studyCount:number;conditionCount:number;corpusSha256:string;catalogSha256:string}>;preview:RealPreview}
export type RealResult={kind:'scoreReal';mode:'live'|'test';consentDigest:string;scores:{nctId:string;index:number;confidence:number}[]}|{kind:'agentReal';mode:'live'|'test';consentDigest:string;comparisons:{nctId:string;questionIds:string[]}[];cautionIds:string[];toolCalls:number;cleanup:'deleted'|'failed'};
export const REAL_POLICY_VERSION:string;export const PREPARED_TTL_MS:number;export const AGE_BANDS:readonly AgeBand[];export const US_STATES:readonly string[];
export function parsePolicyReceipt(v:unknown):PolicyReceipt;
export function parseRealPacket(v:unknown):RealPacket;
export function parseRealRequest(v:unknown):RealRequest;
export function parseRealResult(v:unknown):RealResult;
export function parsePreparedResult(v:unknown):PreparedReal;
