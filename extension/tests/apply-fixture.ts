import{normalizeApplyRecord}from'../shared/apply-record.mjs';
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
export const patient=()=>({name:'Morgan Example',phone:'(208) 555-0142',email:'morgan@example.org',bestTimes:'weekday mornings',zip:'84101',answers:{diagnosis_details:'Disc degeneration diagnosed 2024',symptom_duration:'About two years'}});
