import { z } from "zod";
export const StudySchema = z.object({
 id:z.string().regex(/^NCT\d{8}$/),briefTitle:z.string().min(1),officialTitle:z.string().default(""),briefSummary:z.string().default(""),detailedDescription:z.string().default(""),
 conditions:z.array(z.string()).default([]),keywords:z.array(z.string()).default([]),interventions:z.array(z.object({type:z.string(),name:z.string()})).default([]),
 studyType:z.enum(["INTERVENTIONAL","OBSERVATIONAL","EXPANDED_ACCESS"]),phase:z.array(z.string()).default([]),overallStatus:z.string(),startDate:z.string().optional(),primaryCompletionDate:z.string().optional(),lastUpdatePostDate:z.string().optional(),
 eligibility:z.object({criteriaText:z.string().default(""),minimumAge:z.string().optional(),maximumAge:z.string().optional(),sex:z.enum(["ALL","FEMALE","MALE"]).optional(),healthyVolunteers:z.boolean().optional(),stdAges:z.array(z.string()).default([])}),
 locations:z.array(z.object({facility:z.string().default(""),city:z.string().optional(),state:z.string().optional(),zip:z.string().optional(),country:z.string().optional(),lat:z.number().optional(),lon:z.number().optional(),status:z.string().optional()})).default([]),
 contacts:z.array(z.object({name:z.string().default("Study team"),role:z.string().optional(),phone:z.string().optional(),email:z.string().optional()})).default([]),
 sponsor:z.string().default(""),sourceUrl:z.string().url(),provenance:z.literal("ctgov_api_v2"),fetchedAt:z.string(),hasPlacebo:z.boolean().optional(),requiresInpatient:z.boolean().optional()
});
export type Study=z.infer<typeof StudySchema>;
