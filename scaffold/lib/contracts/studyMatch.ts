import { z } from "zod";
import { StudySchema } from "./study";
import { PatientProfileSchema } from "./patientProfile";
import type { Study } from "./study";
import type { PatientProfile } from "./patientProfile";
export type EligibilityBucket="eligible"|"conditionally_eligible"|"unknown"|"excluded";
export interface StudyCheck { label:string;status:"met"|"unmet"|"unknown";note:string;source?:string;provenance?:"structured"|"model_inferred" }
export interface StudyMatch { id:string;study:Study;score:number;bucket:EligibilityBucket;reasons:string[];criteria:StudyCheck[];distanceMiles?:number;outOfRadius:boolean;stale:boolean;provisional:boolean;final:boolean;whyCare:string;whyFit:string;likelyBarriers:string;whatToVerify:string;whatToDoNext:string;callScript:string;warnings:string[] }
export interface StudySearchResult {profile:PatientProfile;matches:StudyMatch[];corpusCount:number;fetchedAt:string;embeddingMode:"builtin"|"keyword";notices:string[]}
export type StudyStreamEvent={type:"provisional"|"passA"|"passB"|"complete";result:StudySearchResult}|{type:"error";message:string};
export const BUCKET_LABELS:Record<EligibilityBucket,string>={eligible:"Matches what you told us",conditionally_eligible:"Ask the study team",unknown:"Can't tell yet",excluded:"Unlikely"};

export const StudyCheckSchema=z.object({label:z.string(),status:z.enum(["met","unmet","unknown"]),note:z.string(),source:z.string().optional(),provenance:z.enum(["structured","model_inferred"]).optional()});
export const StudyMatchSchema=z.object({id:z.string().regex(/^NCT\d{8}$/),study:StudySchema,score:z.number().min(0).max(100),bucket:z.enum(["eligible","conditionally_eligible","unknown","excluded"]),reasons:z.array(z.string()),criteria:z.array(StudyCheckSchema),distanceMiles:z.number().nonnegative().optional(),outOfRadius:z.boolean(),stale:z.boolean(),provisional:z.boolean(),final:z.boolean(),whyCare:z.string().default(""),whyFit:z.string().default(""),likelyBarriers:z.string().default(""),whatToVerify:z.string().default(""),whatToDoNext:z.string().default(""),callScript:z.string().default(""),warnings:z.array(z.string())}).superRefine((value,ctx)=>{if(value.bucket==="excluded"&&!value.criteria.some(c=>c.status==="unmet"&&c.provenance==="structured"))ctx.addIssue({code:"custom",message:"Unlikely requires a structured unmet fact; model-inferred criteria cannot exclude."});});
export const StudySearchResultSchema=z.object({version:z.string().optional(),profile:PatientProfileSchema,matches:z.array(StudyMatchSchema),corpusCount:z.number().nonnegative(),fetchedAt:z.string(),embeddingMode:z.enum(["builtin","keyword"]),notices:z.array(z.string())});
