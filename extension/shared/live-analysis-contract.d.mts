import type {AgeBand,PolicyReceipt} from './real-contract.mjs';
export interface LiveSource{generation:string;queryKey:string}
export interface LivePacket{ageBand:AgeBand;state?:string;sex?:'female'|'male'|'other'|'prefer_not_to_say';conditionIds:string[];selectedNctIds:string[];agentNctIds:string[]}
export interface LiveStudy{id:string;title:string;status:string;conditions:string[];criteria:string;summary:string;minimumAge:string|null;maximumAge:string|null;sex:string|null;healthyVolunteers:boolean|null;hasResults:boolean|null;countries:string[];sourceUrl:string;fetchedAt:number;lastUpdatePostDate:string|null;truncatedFields:string[];missingFields:string[]}
export interface LiveCatalog{kind:'liveCatalog';snapshotId:string;source:LiveSource;fetchedAt:number;expiresAt:number;conditions:{id:string;label:string}[];studies:LiveStudy[];conditionsTruncated:boolean}
export interface LivePreview{packet:LivePacket;decisionsRequest:Record<string,unknown>;agentsRequest:Record<string,unknown>;toolResults:unknown[]}
export interface LiveBinding{analysisId:string;snapshotId:string;source:LiveSource;profileKey:string;consentDigest:string}
export interface PreparedLive extends Omit<LiveBinding,'consentDigest'>{kind:'preparedLive';token:string;digest:string;expiresAt:number;policyVersion:string;preview:LivePreview}
export type LiveResult=LiveBinding&({kind:'scoreLive';mode:'live'|'test';scores:{nctId:string;index:number;confidence:number}[]}|{kind:'agentLive';mode:'live'|'test';comparisons:{nctId:string;questionIds:string[]}[];cautionIds:string[];toolCalls:number;cleanup:'deleted'|'failed'});
export type LiveRequest={id:string}&({type:'liveCatalog';payload:{nctIds:string[];source:LiveSource}}|{type:'prepareLive';payload:{snapshotId:string;source:LiveSource;packet:LivePacket;policyReceipt:PolicyReceipt}}|{type:'executeLive';payload:{token:string;digest:string;operation:'score'|'agent';policyReceipt:PolicyReceipt}}|{type:'revokeLive';payload:{token?:string}});
export const LIVE_MAX_STUDIES:10;export const LIVE_MAX_AGENT_STUDIES:2;export const LIVE_SNAPSHOT_TTL_MS:number;export const LIVE_CATALOG_MAX_CONDITIONS:120;export const LIVE_POLICY_VERSION:string;export const LIVE_REQUEST_TYPES:readonly string[];
export function liveNctIds(v:unknown,max?:number):string[];
export function parseLiveSource(v:unknown):LiveSource;
export function parseLivePacket(v:unknown):LivePacket;
export function parseLiveRequest(v:unknown):LiveRequest;
export function parseLiveCatalog(v:unknown):LiveCatalog;
export function parsePreparedLive(v:unknown):PreparedLive;
export function parseLiveResult(v:unknown):LiveResult;
export function parseLiveReply(v:unknown,expectedId:string):{id:string;type:'result';ok:boolean;result?:LiveCatalog|PreparedLive|LiveResult;code?:string;error?:string};
