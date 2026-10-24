import type { Study } from "./study";
import type { PatientProfile } from "./patientProfile";
export type EligibilityBucket="eligible"|"conditionally_eligible"|"unknown"|"excluded";
export interface StudyCheck { label:string;status:"met"|"unmet"|"unknown";note:string;source?:string;provenance?:"structured"|"model_inferred" }
export interface StudyMatch { id:string;study:Study;score:number;bucket:EligibilityBucket;reasons:string[];criteria:StudyCheck[];distanceMiles?:number;outOfRadius:boolean;stale:boolean;provisional:boolean;final:boolean;whyCare:string;whyFit:string;likelyBarriers:string;whatToVerify:string;whatToDoNext:string;callScript:string;warnings:string[] }
export interface StudySearchResult {profile:PatientProfile;matches:StudyMatch[];corpusCount:number;fetchedAt:string;embeddingMode:"builtin"|"keyword";notices:string[]}
export type StudyStreamEvent={type:"provisional"|"passA"|"passB"|"complete";result:StudySearchResult}|{type:"error";message:string};
export const BUCKET_LABELS:Record<EligibilityBucket,string>={eligible:"Matches what you told us",conditionally_eligible:"Ask the study team",unknown:"Can't tell yet",excluded:"Unlikely"};
