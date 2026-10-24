import test from'node:test';import assert from'node:assert/strict';
import{buildApplyPlan,chooseSite,contactChain,deterministicFlags,mergeFlags,emailSubject,composeEmail,buildFollowUpIcs,mailtoUrl,telUrl,contactHref,addBusinessDays,localDay,missingInput,blankPatient,contactsInconsistent,MAILTO_BODY_LIMIT,MAILTO_URL_LIMIT,mailtoIssue,DEFAULT_QUESTION_IDS,DEFAULT_PRESCREEN_IDS}from'../src/apply-plan';
import{studyPageNctId}from'../src/apply-page';
import{APPLY_QUESTION_TEMPLATES,APPLY_PRESCREEN_TEMPLATES,type ApplyQuestionId}from'../shared/apply-contract.mjs';
import{record,SALT_LAKE,TODAY,patient}from'./apply-fixture';
test('study page ID comes only from a strict ClinicalTrials.gov study URL',()=>{
 assert.equal(studyPageNctId('https://clinicaltrials.gov/study/NCT07254806'),'NCT07254806');assert.equal(studyPageNctId('https://www.clinicaltrials.gov/study/NCT07254806/?tab=table#contacts'),'NCT07254806');
 for(const bad of ['https://clinicaltrials.gov/search?cond=NCT07254806','https://evil.example/study/NCT07254806','http://clinicaltrials.gov/study/NCT07254806','https://clinicaltrials.gov:8443/study/NCT07254806','https://clinicaltrials.gov/study/NCT07254806/results','https://clinicaltrials.gov/study/nct07254806','https://user@clinicaltrials.gov/study/NCT07254806',undefined,42])assert.equal(studyPageNctId(bad as any),undefined,String(bad))});
test('nearest recruiting site to the local ZIP origin; without ZIP the recruiting sites are listed and the central contact is used',()=>{
 const r=record(),near=chooseSite(r,SALT_LAKE);assert.equal(near.reason,'nearest');assert.equal(near.site?.facility,'Wasatch Spine Research');assert.ok(near.distanceMiles!<2);
 assert.deepEqual(near.options.map(o=>o.site.city),['Salt Lake City','Broomfield'],'only recruiting sites, nearest first');
 const none=chooseSite(r,undefined);assert.equal(none.reason,'none');assert.equal(none.site,undefined);assert.deepEqual(none.options.map(o=>o.site.city),['Broomfield','Salt Lake City']);
 const plan=buildApplyPlan({record:r,patient:{...patient(),zip:''},today:TODAY});assert.equal(plan.primary?.email,'trials@discgenics.com');assert.equal(plan.primary?.source,'central');
 const chosen=chooseSite(r,SALT_LAKE,'s1');assert.equal(chosen.reason,'chosen');assert.equal(chosen.site?.city,'Broomfield');assert.ok(chosen.distanceMiles!>300);
 const onlyOpening=record({sites:[{facility:'Soon Site',status:'NOT_YET_RECRUITING',city:'Provo',state:'Utah',country:'United States',contacts:[]}]});assert.equal(chooseSite(onlyOpening,undefined).reason,'only','a single not-yet-recruiting site is still offered when nothing recruits');
});
test('contact chain: site contact with email first, then other site contacts, central contacts, then the principal investigator',()=>{
 const r=record(),site=r.sites.find(s=>s.city==='Salt Lake City')!,chain=contactChain(r,site);
 assert.equal(chain.primary?.name,'Sam Lee');assert.equal(chain.primary?.source,'site');assert.deepEqual(chain.backups.map(c=>[c.name,c.source]),[['Pat Kim','site'],['Study Coordinator','central']]);
 assert.deepEqual(chain.investigator,{id:'o2',name:'Robin Park, MD',role:'PRINCIPAL_INVESTIGATOR',affiliation:'Wasatch Spine Research'});
 const closed=r.sites.find(s=>s.facility==='Closed Clinic')!,fallback=contactChain(r,closed);assert.equal(fallback.primary?.source,'central');assert.equal(fallback.backups.length,0);
 const bare=record({contacts:[],sites:[{facility:'Lonely',status:'RECRUITING',country:'United States',contacts:[]}]}),empty=contactChain(bare,bare.sites[0]);assert.equal(empty.primary,undefined);assert.equal(empty.investigator?.name,'Robin Park, MD');
});
test('deterministic flags: each rule from the record, including the centenoschultz.com vs centenschultz.com typo',()=>{
 const r=record(),slc=r.sites[1],lone=r.sites[2];
 assert.deepEqual(deterministicFlags(r,slc,TODAY),['contact_inconsistent','age_limit']);
 assert.ok(contactsInconsistent(r));const consistent=record({sites:[record().sites[0],record().sites[1]].map(s=>({facility:s.facility,status:s.status,city:s.city,state:s.state,country:s.country,geoPoint:{lat:s.lat,lon:s.lon},contacts:s.contacts}))});assert.equal(contactsInconsistent(consistent),false);
 const typoOnly=record({sites:[{facility:'Clinic A',status:'RECRUITING',country:'United States',contacts:[{name:'Ann',email:'a@centenoschultz.com'}]},{facility:'Clinic B',status:'RECRUITING',country:'United States',contacts:[{name:'Ben',email:'b@centenschultz.com'}]}]});assert.ok(contactsInconsistent(typoOnly),'near-duplicate domains across different names and facilities');
 assert.deepEqual(deterministicFlags(r,lone,TODAY),['status_mismatch','contact_inconsistent','not_yet_recruiting','age_limit']);
 assert.ok(deterministicFlags(record({status:{primaryCompletionDateStruct:{date:'2027-01-15',type:'ESTIMATED'}}}),slc,TODAY).includes('near_completion'));
 assert.ok(!deterministicFlags(record({status:{primaryCompletionDateStruct:{date:'2027-03-15',type:'ESTIMATED'}}}),slc,TODAY).includes('near_completion'));
 assert.ok(deterministicFlags(r,r.sites[3],TODAY).includes('no_site_contact'));
 assert.ok(deterministicFlags(record({status:{lastUpdatePostDateStruct:{date:'2025-10-01'}}}),slc,TODAY).includes('stale_record'));assert.ok(!deterministicFlags(record({status:{lastUpdatePostDateStruct:{date:'2025-11-01'}}}),slc,TODAY).includes('stale_record'));
 assert.ok(deterministicFlags(consistent,consistent.sites[0],TODAY).includes('limited_sites'));assert.ok(!deterministicFlags(r,slc,TODAY).includes('limited_sites'));
 assert.ok(deterministicFlags(record({status:{overallStatus:'NOT_YET_RECRUITING'}}),undefined,TODAY).includes('not_yet_recruiting'));
 assert.deepEqual(mergeFlags(['age_limit','contact_inconsistent'],['contact_inconsistent','near_completion','age_limit']),['near_completion','contact_inconsistent','age_limit'],'merged, de-duplicated, catalog order');
});
test('subject follows the site routing format and omits missing parts',()=>{
 const r=record();assert.equal(emailSubject(r),'NCT07254806, IDCT-001-US, A Prospective, Randomized, Double-Blinded, Sham-Controlled, Multicenter Study of IDCT');
 assert.equal(emailSubject({...r,orgStudyId:null}),'NCT07254806, IDCT, A Prospective, Randomized, Double-Blinded, Sham-Controlled, Multicenter Study of IDCT');
 assert.equal(emailSubject({...r,orgStudyId:null,acronym:null,officialTitle:null}),`NCT07254806, ${r.title}`);
});
test('email preserves the full local draft and only carries what the patient typed',()=>{
 const r=record(),plan=buildApplyPlan({record:r,patient:patient(),origin:SALT_LAKE,today:TODAY});
 assert.match(plan.body,/^Hello Sam Lee,\n/);assert.match(plan.body,/at Wasatch Spine Research in Salt Lake City, Utah/);assert.match(plan.body,/- My diagnosis and when it was made: Disc degeneration diagnosed 2024/);assert.match(plan.body,/- How long I have had symptoms: About two years/);
 assert.doesNotMatch(plan.body,/84101|imaging|medicines/i,'no ZIP and no unanswered health items');for(const id of DEFAULT_QUESTION_IDS)assert.ok(plan.body.includes(APPLY_QUESTION_TEMPLATES[id]),id);
 assert.deepEqual(plan.questionIds,[...DEFAULT_QUESTION_IDS]);assert.deepEqual(plan.prescreenIds,[...DEFAULT_PRESCREEN_IDS]);
 const many=Object.keys(APPLY_QUESTION_TEMPLATES).slice(0,8) as ApplyQuestionId[],long={...patient(),bestTimes:'x'.repeat(120),answers:Object.fromEntries(DEFAULT_PRESCREEN_IDS.map(id=>[id,'y'.repeat(400)]))};
 const body=composeEmail(r,r.sites[1],r.sites[1].contacts[0],long,many,DEFAULT_PRESCREEN_IDS);
 assert.ok(body.length>MAILTO_BODY_LIMIT,'full draft is preserved, not silently shortened');assert.match(body,/Thank you,\nMorgan Example$/);for(const id of many)assert.ok(body.includes(APPLY_QUESTION_TEMPLATES[id]));
 assert.equal(mailtoUrl('slee@wasatchspine.org','s',body),undefined);assert.match(mailtoIssue('slee@wasatchspine.org','s',body)!,/Copy the full email/);
 const short=mailtoUrl('slee@wasatchspine.org','Study enquiry','Hello\nThank you')!;assert.ok(short.length<=MAILTO_URL_LIMIT);assert.equal(decodeURIComponent(short.split('&body=')[1]),'Hello\r\nThank you');
 assert.equal(mailtoUrl('bad address@x',plan.subject,'b'),undefined);assert.equal(plan.mailto?.startsWith('mailto:slee@wasatchspine.org?'),true);assert.equal(plan.tel,'tel:8015550100');assert.equal(telUrl('12'),undefined);assert.equal(telUrl('+44 20 7946 0000'),'tel:+442079460000');
 assert.equal(contactHref('javascript:alert(1)','mailto:'),undefined);assert.equal(contactHref(plan.tel,'tel:'),plan.tel);
 assert.match(plan.phoneScript,/I am calling about the study NCT07254806/);assert.match(plan.phoneScript,/1\. Is the study still enrolling at this site\?/);for(const id of DEFAULT_PRESCREEN_IDS)assert.ok(plan.phoneScript.includes(APPLY_PRESCREEN_TEMPLATES[id]));
 const agentPlan=buildApplyPlan({record:r,patient:patient(),origin:SALT_LAKE,today:TODAY,agent:{nctId:'NCT07254806',questionIds:['placebo','crossover','next_steps'],prescreenIds:['affected_area','recent_imaging'],flagIds:['near_completion','age_limit']}});assert.deepEqual(agentPlan.questionIds,['placebo','crossover','next_steps']);assert.deepEqual(agentPlan.answerIds,['affected_area','recent_imaging','diagnosis_details','symptom_duration']);assert.match(agentPlan.body,/- My diagnosis and when it was made: Disc degeneration diagnosed 2024/,'answers typed before the agent ran stay in the email');assert.deepEqual(agentPlan.flagIds,['near_completion','contact_inconsistent','age_limit']);
 const otherStudy=buildApplyPlan({record:r,patient:patient(),today:TODAY,agent:{nctId:'NCT00000001',questionIds:['placebo','crossover','results'],prescreenIds:['insurance','availability'],flagIds:['stale_record']}});assert.deepEqual(otherStudy.questionIds,[...DEFAULT_QUESTION_IDS],'agent output for another study is ignored');
});
test('missing required input is reported in plain words',()=>{
 assert.deepEqual(missingInput(blankPatient()),['Enter your name.','Enter a phone number or an email address so the study team can reach you.']);
 assert.deepEqual(missingInput({...blankPatient(),name:'A',phone:'12',email:'nope'}),['Check the phone number. Use 7 to 15 digits.','Check the email address.']);assert.deepEqual(missingInput({...blankPatient(),name:'A',email:'a@b.co'}),[]);
});
test('follow-up plan is five business days out and the .ics carries no patient details',()=>{
 assert.equal(new Date(addBusinessDays(localDay(TODAY),5)).toISOString().slice(0,10),'2026-10-30','Saturday + 5 business days');assert.equal(new Date(addBusinessDays(Date.UTC(2026,9,23),5)).toISOString().slice(0,10),'2026-10-30','Friday + 5 business days');
 const p=patient(),plan=buildApplyPlan({record:record(),patient:p,origin:SALT_LAKE,today:TODAY});
 assert.equal(plan.followUpDate,'2026-10-30');assert.equal(plan.followUp,'If no reply by Friday, October 30, 2026: call Sam Lee at 801-555-0100; then email Study Coordinator at trials@discgenics.com; then contact Robin Park, MD at Wasatch Spine Research (the study\'s principal investigator).');
 const ics=buildFollowUpIcs(plan,Date.UTC(2026,9,24,15,15));assert.match(ics,/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);assert.match(ics,/\r\nDTSTART;VALUE=DATE:20261030\r\nDTEND;VALUE=DATE:20261031\r\n/);assert.match(ics,/\r\nDTSTAMP:20261024T151500Z\r\n/);assert.match(ics,/SUMMARY:Follow up on study NCT07254806/);assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
 const unfolded=ics.replace(/\r\n /g,'');assert.match(unfolded,/Study contact: Sam Lee\\, 801-555-0100\\, slee@wasatchspine\.org/);assert.match(unfolded,/https:\/\/clinicaltrials\.gov\/study\/NCT07254806/);
 for(const line of ics.split('\r\n'))assert.ok(new TextEncoder().encode(line).length<=75,line);
 for(const secret of [p.name,'Morgan',p.phone,'0142',p.email,p.zip,p.bestTimes,p.answers.diagnosis_details!,p.answers.symptom_duration!])assert.ok(!unfolded.includes(secret),`ics leaked ${secret}`);
});

test('mailto handoff encodes recipient percent signs once and rejects header injection or oversized URLs',()=>{
 const address='a%0d%0abcc%3ax@example.org',url=mailtoUrl(address,'Study enquiry','Hello')!;
 assert.ok(url.startsWith('mailto:a%250d%250abcc%253ax@example.org?'));assert.doesNotMatch(decodeURIComponent(url.split('?')[0]),/[\r\n]/);
 for(const address of ['a@example.org\r\nBcc:x@example.org','a@example.org?bcc=x@example.org','a@example.org,b@example.org'])assert.equal(mailtoUrl(address,'s','Hello'),undefined);
 for(const subject of ['s\rBcc: x@example.org','s\nBcc: x@example.org','s\u0000'])assert.equal(mailtoUrl('a@example.org',subject,'Hello'),undefined);
 assert.equal(mailtoUrl('a@example.org','s','中'.repeat(800)),undefined,'encoded UTF-8 length is bounded');
 assert.equal(mailtoUrl('a@example.org','','Hello'),undefined);assert.equal(mailtoUrl('a@example.org','s','  '),undefined);
});
