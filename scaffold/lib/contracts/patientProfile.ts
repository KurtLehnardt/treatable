import { z } from "zod";
export const PatientProfileSchema=z.object({
 fillingOutAs:z.enum(["patient","caregiver","clinician"]).default("patient"),ageYears:z.number().min(0).max(120),sex:z.enum(["female","male","prefer_not_to_say"]).default("prefer_not_to_say"),
 primaryDiagnoses:z.array(z.string()).default([]),symptoms:z.array(z.string()).default([]),symptomNarrative:z.string().max(12000).default(""),treatmentsTried:z.array(z.string()).default([]),
 performanceStatus:z.enum(["ambulatory_full","ambulatory_limited","in_bed_half_day","in_bed_most","bedbound"]).optional(),
 location:z.object({zip:z.string().trim().regex(/^\d{5}(?:-\d{4})?$/).transform(v=>v.slice(0,5)).optional(),city:z.string().optional(),state:z.string().optional(),lat:z.number().min(-90).max(90).optional(),lon:z.number().min(-180).max(180).optional()}).refine(v=>Boolean(v.zip||v.city||v.state||(v.lat!==undefined&&v.lon!==undefined)),"Enter a US ZIP, city/state, or coordinates"),
 travelRadiusMiles:z.union([z.literal(25),z.literal(50),z.literal(100),z.literal(250),z.literal("anywhere")]).default(100),
 openTo:z.object({phase1:z.boolean().default(true),placebo:z.boolean().default(true),inpatient:z.boolean().default(true),expandedAccess:z.boolean().default(true)}).default({phase1:true,placebo:true,inpatient:true,expandedAccess:true})
}).refine(v=>v.primaryDiagnoses.some(s=>s.trim())||v.symptoms.some(s=>s.trim())||v.symptomNarrative.trim().length>0,"Describe one diagnosis or symptom");
export type PatientProfile=z.infer<typeof PatientProfileSchema>;
