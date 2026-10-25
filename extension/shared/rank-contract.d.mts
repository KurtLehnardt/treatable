export type RankProvider='openai'|'local';
export type RankSex='female'|'male';
import type {RankReasonId as LocalRankReason} from './local-ranking.mjs';
export type RankReason='strong_match'|'possible_match'|'unclear'|'unrelated'|LocalRankReason;
export interface RankProfile{conditions:string[]}
export interface PreparedRank{kind:'preparedRank';token:string;digest:string;expiresAt:number;provider:RankProvider;nctIds:string[];preview:{profile:RankProfile;request:Record<string,unknown>}}
export interface RankScore{nctId:string;score:number;reasonId:RankReason;probabilities?:number[]}
export interface RankFailureEntry{nctId:string;failure:string}
export interface RankResult{kind:'rankResult';mode:'live'|'test';provider:RankProvider;digest:string;scores:(RankScore|RankFailureEntry)[]}
export type RankRequest={id:string}&({type:'prepareRank';payload:{nctIds:string[];profile:RankProfile;provider?:RankProvider;model?:string}}|{type:'executeRank';payload:{token:string;digest:string}}|{type:'revokeRank';payload:{token?:string}});
export const RANK_REQUEST_TYPES:readonly string[];
export const RANK_MAX_STUDIES:10;
export const RANK_MAX_TERMS:6;
export const RANK_TERM_MAX_CHARS:80;
export const RANK_TTL_MS:number;
export const RANK_PROVIDERS:readonly RankProvider[];
export const RANK_SEXES:readonly RankSex[];
export const RANK_REASONS:readonly RankReason[];
export const RANK_LEVELS:readonly string[];
export function rankTerm(v:unknown):string|undefined;
export function rankReasonForScore(score:number):RankReason;
export function rankNctIds(v:unknown):string[];
export function parseRankProfile(v:unknown):RankProfile;
export function parseRankRequest(v:unknown):RankRequest;
export function parsePreparedRank(v:unknown):PreparedRank;
export function parseRankResult(v:unknown):RankResult;
export function parseRankReply(v:unknown,expectedId:string):{id:string;type:'result';ok:boolean;result?:PreparedRank|RankResult;code?:string;error?:string};
