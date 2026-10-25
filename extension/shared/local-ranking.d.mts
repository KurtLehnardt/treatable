export type RankReasonId='condition_match'|'related_condition'|'symptom_focus'|'broad_population'|'different_condition'|'healthy_volunteers'|'insufficient_information';
export type RankFailure='LOCAL_NOT_INSTALLED'|'LOCAL_RUNTIME_FAILED'|'LOCAL_MODEL_UNAVAILABLE'|'LOCAL_MODEL_FAILED'|'LOCAL_OLLAMA_OUTDATED'|'LOCAL_TIMEOUT'|'LOCAL_INVALID_OUTPUT';
/** Minimized ranking profile: condition terms only. Age, sex and state checks stay on the device, outside this contract. */
export interface RankingProfile{conditions:string[]}
export interface RankingStudy{nctId:string;title:string;conditions:string[];summary?:string|null;criteria?:string|null}
export type LocalStudyRank={nctId:string;score:number;reasonId:RankReasonId}|{nctId:string;failure:RankFailure};
export interface LocalRankingResult{provider:'local';model:string;version:string|null;durationMs:number;studies:LocalStudyRank[]}
export const RANK_MAX_STUDIES:number;export const RANK_REASONS:Readonly<Record<RankReasonId,string>>;export const RANK_REASON_SCORE_BOUNDS:Readonly<Record<RankReasonId,readonly [number,number]>>;export const RANK_FAILURES:readonly RankFailure[];
export function parseRankingProfile(v:unknown):RankingProfile;
export function parseRankingStudies(v:unknown):RankingStudy[];
export function parseLocalRankingResult(v:unknown,nctIds:string[]):LocalRankingResult;
