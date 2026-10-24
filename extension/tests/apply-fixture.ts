import{normalizeApplyRecord}from'../shared/apply-record.mjs';
import{traceBody,STUDY_BRIEF_TOOL_NAME,type StudyBriefTrace,type StudyBriefDecisionTrace}from'../shared/apply-contract.mjs';
/** API v2-shaped public record modeled on NCT07254806 (lumbar disc study), with one deliberately mistyped site email domain. */
export function rawStudy(overrides:{status?:any;contacts?:any;sites?:any[]}={}){
 const sites=overrides.sites??[
  {facility:'Centeno-Schultz Clinic',status:'RECRUITING',city:'Broomfield',state:'Colorado',zip:'80020',country:'United States',geoPoint:{lat:39.9205,lon:-105.0867},contacts:[{name:'Jane Doe, RN',role:'CONTACT',phone:'303-429-6448',email:'jdoe@centenoschultz.com'}]},
  {facility:'Wasatch Spine Research',status:'RECRUITING',city:'Salt Lake City',state:'Utah',zip:'84102',country:'United States',geoPoint:{lat:40.7608,lon:-111.891},contacts:[{name:'Sam Lee',role:'CONTACT',phone:'801-555-0100',email:'slee@wasatchspine.org'},{name:'Pat Kim',role:'CONTACT',phone:'801-555-0101',phoneExt:'22'}]},
  {facility:'Centeno-Schultz Clinic',status:'NOT_YET_RECRUITING',city:'Lone Tree',state:'Colorado',zip:'80124',country:'United States',geoPoint:{lat:39.5372,lon:-104.8971},contacts:[{name:'Jane Doe',role:'CONTACT',phone:'303-429-6448',email:'jdoe@centenschultz.com'}]},
  {facility:'Closed Clinic',status:'COMPLETED',city:'Boise',state:'Idaho',country:'United States',geoPoint:{lat:43.615,lon:-116.2023},contacts:[]}];
 return{protocolSection:{identificationModule:{nctId:'NCT07254806',orgStudyIdInfo:{id:'IDCT-001-US'},briefTitle:'A Study to Evaluate the Effectiveness of IDCT in Lumbar Degenerative Disc Disease',officialTitle:'A Prospective, Randomized, Double-Blinded, Sham-Controlled, Multicenter Study of IDCT',acronym:'IDCT'},
  statusModule:{overallStatus:'RECRUITING',primaryCompletionDateStruct:{date:'2027-11-24',type:'ESTIMATED'},lastUpdatePostDateStruct:{date:'2026-10-15',type:'ACTUAL'},...overrides.status},
  eligibilityModule:{minimumAge:'18 Years',maximumAge:'75 Years'},
  contactsLocationsModule:{centralContacts:overrides.contacts??[{name:'Study Coordinator',role:'CONTACT',phone:'801-555-0199',email:'trials@discgenics.com'}],overallOfficials:[{name:'Alex Smith, MD',affiliation:'DiscGenics, Inc.',role:'STUDY_DIRECTOR'},{name:'Robin Park, MD',affiliation:'Wasatch Spine Research',role:'PRINCIPAL_INVESTIGATOR'}],locations:sites}}};
}
export const record=(overrides?:Parameters<typeof rawStudy>[0])=>normalizeApplyRecord(rawStudy(overrides),Date.UTC(2026,9,24,15));
export const SALT_LAKE={lat:40.7563,lon:-111.8985};
export const TODAY=new Date(2026,9,24,9,15);
export const patient=():import('../src/apply-plan').ApplyPatient=>({name:'Morgan Example',phone:'(208) 555-0142',email:'morgan@example.org',bestTimes:'weekday mornings',zip:'84101',answers:{diagnosis_details:'Disc degeneration diagnosed 2024',symptom_duration:'About two years'}});
export const TOKEN='T'.repeat(43),DIGEST='d'.repeat(64);
export function preparedFixture(expiresAt=Date.UTC(2026,9,24,15,20)){return{kind:'preparedApply' as const,token:TOKEN,digest:DIGEST,expiresAt,nctId:'NCT07254806',record:record(),preview:{agentsRequest:{model:'gpt-test',input:[{role:'user',content:'Review public study NCT07254806 using get_public_trial_evidence.'}],tools:[{type:'function',name:'get_public_trial_evidence'}]},toolResults:(['overview','eligibility','design','locations_contacts'] as const).map(section=>({section,output:`Public ${section} text for NCT07254806`}))}}}
export function agentFixture(overrides:Record<string,unknown>={}){return{kind:'applyAgent' as const,mode:'live' as const,nctId:'NCT07254806',digest:DIGEST,questionIds:['placebo','crossover','imaging','next_steps'] as any,prescreenIds:['affected_area','recent_imaging','prior_treatments'] as any,flagIds:['near_completion'] as any,sectionsRead:['overview','eligibility','locations_contacts'] as any,toolCalls:3,cleanup:'deleted' as const,...overrides}}
/** Display trace of a study brief run: both request bodies, one tool call per study and three Decisions answers per study (all routed to the study team). */
export function briefTraceFixture(ids:string[],over:Partial<StudyBriefTrace>={}):StudyBriefTrace{
 const decisions:StudyBriefDecisionTrace[]=ids.flatMap(nctId=>[
  {nctId,questionId:'visits' as const,choice:'ask_coordinator' as const,route:'ask_coordinator' as const,confidence:.83,probabilities:{answered_by_record:.05,ask_patient:.12,ask_coordinator:.83}},
  {nctId,questionId:'crossover' as const,choice:'answered_by_record' as const,route:'ask_coordinator' as const,confidence:.55,probabilities:{answered_by_record:.6,ask_patient:.1,ask_coordinator:.3}},
  {nctId,questionId:'costs' as const,choice:'ask_coordinator' as const,route:'ask_coordinator' as const,confidence:.4,probabilities:{answered_by_record:.0004,ask_patient:.4998,ask_coordinator:.4998}}]);
 return{
  agentsRequest:traceBody({environment:{type:'none'},agent:{model:'gpt-6-astra',tools:[{type:'function',name:STUDY_BRIEF_TOOL_NAME}]},input:JSON.stringify({publicOnly:true,selectedStudyIds:ids}),stream:true}),
  decisionsRequest:traceBody({model:'gpt-6-luna',questions:decisions.map(d=>({type:'choice',name:`${d.nctId}_${d.questionId}`}))}),
  toolCalls:ids.map(nctId=>({tool:STUDY_BRIEF_TOOL_NAME,outcome:'returned' as const,arguments:{nctId},summary:`Returned 12 public source items for ${nctId} (overview 2, timeline 4, design 6), 3100 bytes from the pinned ClinicalTrials.gov record.`})),
  decisions,...over};
}
