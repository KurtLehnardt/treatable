export type ApplyQuestionId='still_enrolling'|'prescreen_fit'|'visits'|'duration'|'placebo'|'crossover'|'procedure'|'costs'|'imaging'|'medications'|'remote_visits'|'caregiver'|'next_steps'|'results';
export type ApplyPrescreenId='diagnosis_details'|'affected_area'|'symptom_duration'|'recent_imaging'|'prior_treatments'|'prior_surgery'|'medication_list'|'other_conditions'|'daily_impact'|'doctor_contact'|'insurance'|'availability'|'pregnancy_status';
export type ApplyFlagId='near_completion'|'status_mismatch'|'contact_inconsistent'|'no_site_contact'|'stale_record'|'not_yet_recruiting'|'limited_sites'|'age_limit';
export type ApplyToolSection='overview'|'eligibility'|'design'|'locations_contacts';
export interface ApplyContact{id:string;name:string|null;role:string|null;phone:string|null;phoneExt:string|null;email:string|null}
export interface ApplyOfficial{id:string;name:string|null;role:string|null;affiliation:string|null}
export interface ApplySite{id:string;facility:string|null;status:string|null;city:string|null;state:string|null;zip:string|null;country:string|null;lat:number|null;lon:number|null;contacts:ApplyContact[]}
export interface ApplyRecord{nctId:string;title:string;officialTitle:string|null;acronym:string|null;orgStudyId:string|null;overallStatus:string;primaryCompletionDate:string|null;primaryCompletionType:'ACTUAL'|'ESTIMATED'|null;lastUpdatePostDate:string|null;minimumAge:string|null;maximumAge:string|null;centralContacts:ApplyContact[];officials:ApplyOfficial[];sites:ApplySite[];sitesTruncated:boolean;sourceUrl:string;fetchedAt:number}
export interface PreparedApply{kind:'preparedApply';token:string;digest:string;expiresAt:number;nctId:string;record:ApplyRecord;preview:{agentsRequest:Record<string,unknown>;toolResults:{section:ApplyToolSection;output:string}[]}}
export interface ApplyResult{kind:'applyAgent';mode:'live'|'test';nctId:string;digest:string;questionIds:ApplyQuestionId[];prescreenIds:ApplyPrescreenId[];flagIds:ApplyFlagId[];sectionsRead:ApplyToolSection[];toolCalls:number;cleanup:'deleted'|'failed'}
export type ApplyRequest={id:string}&({type:'prepareApply';payload:{nctId:string}}|{type:'executeApply';payload:{token:string;digest:string}}|{type:'revokeApply';payload:{token?:string}});
export const APPLY_REQUEST_TYPES:readonly string[];export const APPLY_TOKEN_TTL_MS:number;export const APPLY_MAX_SITES:number;export const APPLY_MAX_SITE_CONTACTS:number;export const APPLY_MAX_CENTRAL_CONTACTS:number;export const APPLY_MAX_OFFICIALS:number;export const APPLY_RECORD_MAX_BYTES:number;export const APPLY_TOOL_SECTIONS:readonly ApplyToolSection[];
export const APPLY_QUESTION_TEMPLATES:Readonly<Record<ApplyQuestionId,string>>;export const APPLY_PRESCREEN_TEMPLATES:Readonly<Record<ApplyPrescreenId,string>>;export const APPLY_FLAG_TEMPLATES:Readonly<Record<ApplyFlagId,string>>;
export function applyNctId(v:unknown):string;
export function parseApplyRecord(v:unknown):ApplyRecord;
export function parseApplyRequest(v:unknown):ApplyRequest;
export function parsePreparedApply(v:unknown):PreparedApply;
export function parseApplyResult(v:unknown):ApplyResult;
export function parseApplyReply(v:unknown,expectedId:string):{id:string;type:'result';ok:boolean;result?:PreparedApply|ApplyResult;code?:string;error?:string};
