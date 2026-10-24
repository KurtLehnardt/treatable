import test from'node:test';import assert from'node:assert/strict';
import{buildApplyPlan,chooseSite,contactChain,deterministicFlags,mergeFlags,emailSubject,composeEmail,buildFollowUpIcs,mailtoUrl,telUrl,contactHref,addBusinessDays,localDay,missingInput,blankPatient,contactsInconsistent,MAILTO_BODY_LIMIT,MAILTO_URL_LIMIT,mailtoIssue,messageBody,hasHeaderLines,emailHandoff,shortTitle,EMAIL_QUESTION_LIMIT,EMAIL_TITLE_LIMIT,DEFAULT_QUESTION_IDS,DEFAULT_PRESCREEN_IDS,defaultQuestionIds,hasSharedInfo,composePhoneScript,composeFollowUpMessage}from'../src/apply-plan';
import{studyPageNctId}from'../src/apply-page';
import{APPLY_QUESTION_TEMPLATES,APPLY_PRESCREEN_TEMPLATES,type ApplyQuestionId,type ApplyPrescreenId}from'../shared/apply-contract.mjs';
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
 assert.doesNotMatch(plan.body,/84101|imaging|medicines/i,'no ZIP and no unanswered health items');defaultQuestionIds(true).forEach((id,i)=>{assert.equal(plan.body.includes(APPLY_QUESTION_TEMPLATES[id]),i<EMAIL_QUESTION_LIMIT,`email carries only the first ${EMAIL_QUESTION_LIMIT} questions: ${id}`);assert.ok(plan.phoneScript.includes(APPLY_QUESTION_TEMPLATES[id]),`call script keeps ${id}`)});
 assert.deepEqual(plan.questionIds,defaultQuestionIds(true),'this patient typed answers, so "Based on what I have shared" is included');assert.deepEqual(plan.prescreenIds,[...DEFAULT_PRESCREEN_IDS]);
 const many=Object.keys(APPLY_QUESTION_TEMPLATES).slice(0,8) as ApplyQuestionId[],long={...patient(),bestTimes:'x'.repeat(120),answers:Object.fromEntries(DEFAULT_PRESCREEN_IDS.map(id=>[id,'y'.repeat(400)]))};
 const body=composeEmail(r,r.sites[1],r.sites[1].contacts[0],long,many,DEFAULT_PRESCREEN_IDS);
 assert.match(body,/Thank you,\nMorgan Example$/);many.forEach((id,i)=>assert.equal(body.includes(APPLY_QUESTION_TEMPLATES[id]),i<EMAIL_QUESTION_LIMIT,id));for(const id of DEFAULT_PRESCREEN_IDS)assert.ok(body.includes('y'.repeat(160)),'what the patient typed is kept as typed (to the per-answer limit)'+id);
 const typed='My full message. '.repeat(450),link=mailtoUrl('slee@wasatchspine.org','s','My full message. '.repeat(250))!;assert.ok(typed.length>MAILTO_BODY_LIMIT&&link.length>2000&&link.length<=MAILTO_URL_LIMIT,'a draft past the old limit now opens directly');
 assert.equal(mailtoUrl('slee@wasatchspine.org','s',typed),undefined);assert.equal(mailtoIssue('slee@wasatchspine.org','s',typed),undefined,'a long draft is not an error: it uses the copy handoff');
 const short=mailtoUrl('slee@wasatchspine.org','Study enquiry','Hello\nThank you')!;assert.ok(short.length<=MAILTO_URL_LIMIT);assert.equal(decodeURIComponent(short.split('&body=')[1]),'Hello\r\nThank you');
 assert.equal(mailtoUrl('bad address@x',plan.subject,'b'),undefined);assert.equal(plan.mailto?.startsWith('mailto:slee@wasatchspine.org?'),true);assert.equal(plan.tel,'tel:+18015550100');assert.equal(telUrl('12'),undefined);assert.equal(telUrl('+44 20 7946 0000'),'tel:+442079460000');
 assert.equal(contactHref('javascript:alert(1)','mailto:'),undefined);assert.equal(contactHref(plan.tel,'tel:'),plan.tel);
 assert.match(plan.phoneScript,/I am calling about the study NCT07254806/);assert.match(plan.phoneScript,/1\. Is the study still enrolling at this site\?/);for(const id of DEFAULT_PRESCREEN_IDS)assert.ok(plan.phoneScript.includes(APPLY_PRESCREEN_TEMPLATES[id]));
 const agentPlan=buildApplyPlan({record:r,patient:patient(),origin:SALT_LAKE,today:TODAY,agent:{nctId:'NCT07254806',questionIds:['placebo','crossover','next_steps'],prescreenIds:['affected_area','recent_imaging'],flagIds:['near_completion','age_limit']}});assert.deepEqual(agentPlan.questionIds,['placebo','crossover','next_steps']);assert.deepEqual(agentPlan.answerIds,['affected_area','recent_imaging','diagnosis_details','symptom_duration']);assert.match(agentPlan.body,/- My diagnosis and when it was made: Disc degeneration diagnosed 2024/,'answers typed before the agent ran stay in the email');assert.deepEqual(agentPlan.flagIds,['near_completion','contact_inconsistent','age_limit']);
 const otherStudy=buildApplyPlan({record:r,patient:patient(),today:TODAY,agent:{nctId:'NCT00000001',questionIds:['placebo','crossover','results'],prescreenIds:['insurance','availability'],flagIds:['stale_record']}});assert.deepEqual(otherStudy.questionIds,defaultQuestionIds(true),'agent output for another study is ignored');
});
test('missing required input is reported in plain words',()=>{
 assert.deepEqual(missingInput(blankPatient()),['Add your name to sign the email.','Enter a phone number or an email address so the study team can reach you.']);
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
 assert.equal(mailtoUrl('a@example.org','s','中'.repeat(1000)),undefined,'encoded UTF-8 length is bounded');
 assert.equal(mailtoUrl('a@example.org','s','\ud800'),undefined,'malformed Unicode does not crash rendering');
 assert.equal(mailtoUrl('a@example.org','','Hello'),undefined);assert.equal(mailtoUrl('a@example.org','s','  '),undefined);
});

const mailtoParts=(url:string)=>{const[target,query]=url.slice('mailto:'.length).split('?');const params=Object.fromEntries(query.split('&').map(kv=>{const at=kv.indexOf('=');return[kv.slice(0,at),decodeURIComponent(kv.slice(at+1))]}));return{to:decodeURIComponent(target),params}};
test('generated email body holds only the message; To and Subject travel as separate mailto parameters',()=>{
 for(const origin of [SALT_LAKE,undefined]){const plan=buildApplyPlan({record:record(),patient:patient(),origin,today:TODAY}),to=plan.primary!.email!;
  for(const body of [plan.body,mailtoParts(plan.mailto!).params.body]){assert.doesNotMatch(body,/^\s*(?:To|Subject|Cc|Bcc|From)\s*:/im,'no header lines');assert.ok(!body.includes(to),'recipient address is not repeated in the body');assert.ok(!body.includes(plan.subject),'subject line is not repeated in the body')}
  const parts=mailtoParts(plan.mailto!);assert.equal(parts.to,to);assert.equal(parts.params.subject,plan.subject);assert.deepEqual(Object.keys(parts.params),['subject','body']);assert.equal(parts.params.body,plan.body.replace(/\n/g,'\r\n'))}
});
test('header lines pasted at the top of a message are left out of the email-app handoff; later text is untouched',()=>{
 const pasted='To: trials@discgenics.com\nSubject: NCT07254806, IDCT-001-US, Study\n\nHello team,\nSubject: this line is part of my message.';
 assert.equal(hasHeaderLines(pasted),true);assert.equal(hasHeaderLines('\n  to:  x@example.org\nHi'),true);assert.equal(hasHeaderLines('Hello,\nTo: whom it may concern'),false);
 assert.equal(messageBody(pasted),'Hello team,\nSubject: this line is part of my message.');assert.equal(messageBody('Hello\r\nThanks'),'Hello\r\nThanks','bodies without header lines are returned unchanged');
 const parts=mailtoParts(mailtoUrl('trials@discgenics.com','Study enquiry',pasted)!);assert.equal(parts.params.body,'Hello team,\r\nSubject: this line is part of my message.');assert.doesNotMatch(parts.params.body,/^To:|trials@discgenics\.com/m);
 assert.equal(mailtoUrl('trials@discgenics.com','Study enquiry','To: trials@discgenics.com\nSubject: Study enquiry\n'),undefined,'a body with only header lines has no message to send');
});

test('mailto limits: up to 8,000 encoded characters open directly; above that only recipient and subject are linked and the body is returned to copy',()=>{
 assert.equal(MAILTO_URL_LIMIT,8000);assert.ok(MAILTO_BODY_LIMIT>1800&&MAILTO_BODY_LIMIT<MAILTO_URL_LIMIT);
 const head='mailto:a@example.org?subject=s&body=',fits='a'.repeat(MAILTO_URL_LIMIT-head.length);
 const at=emailHandoff('a@example.org','s',fits);assert.equal(at.mode,'link');assert.equal(at.mode==='link'&&at.url.length,MAILTO_URL_LIMIT,'exactly at the limit opens directly');
 const over=emailHandoff('a@example.org','s',fits+'a');assert.deepEqual(over,{mode:'copy',url:'mailto:a@example.org?subject=s',body:fits+'a'},'one character over: recipient and subject only, plus the body to copy');
 const typical=('Thank you for your time. '.repeat(7)+'\n').repeat(27),mid=emailHandoff('a@example.org','Study enquiry',typical);assert.ok(typical.length<=MAILTO_BODY_LIMIT&&typical.length>4500);assert.equal(mid.mode,'link','a plain-English body within MAILTO_BODY_LIMIT fits the URL limit once encoded');
 const pasted=emailHandoff('a@example.org','Study enquiry','To: a@example.org\nSubject: Study enquiry\n\n'+fits+'a');assert.equal(pasted.mode,'copy');assert.equal(pasted.mode==='copy'&&pasted.body,fits+'a','pasted header lines are not copied');
 const copy=over.mode==='copy'?over:undefined;assert.doesNotMatch(copy!.url,/body=|%0D|%0A/);
 const wide=emailHandoff('a%b@example.org','s'.repeat(30),fits);assert.equal(wide.mode,'copy');assert.ok(wide.mode==='copy'&&wide.url.startsWith('mailto:a%25b@example.org?subject='));
 assert.equal(emailHandoff('a@example.org','中'.repeat(1000),'Hello').mode,'blocked','a subject that cannot fit in a link is blocked, not silently cut');
 assert.equal(emailHandoff('a@example.org','中'.repeat(1000),fits+'a').mode,'blocked');
 assert.equal(emailHandoff('bad address@x','s',fits+'a').mode,'blocked','the copy handoff still needs a valid listed address');assert.equal(emailHandoff('a@example.org','s','x'.repeat(16001)).mode,'blocked');assert.equal(emailHandoff('a@example.org','s','\ud800'.repeat(10000)).mode,'blocked','malformed Unicode is blocked, not copied');
});
test('default email stays short: study title, NCT ID and link, three questions and a polite request; longer detail lives in the call script',()=>{
 const r=record(),agent={nctId:'NCT07254806',questionIds:['crossover','placebo','costs'] as ApplyQuestionId[],prescreenIds:['affected_area','recent_imaging'] as ApplyPrescreenId[],flagIds:[]};
 const blank=blankPatient(),named={...blank,name:'Morgan Example'};
 for(const [label,args] of Object.entries({'typed patient near me':{patient:patient(),origin:SALT_LAKE},'typed patient, no origin':{patient:patient()},'blank patient':{patient:blank},'name only':{patient:named},'agent questions':{patient:patient(),origin:SALT_LAKE,agent},'agent questions, blank':{patient:blank,agent}}) as [string,any][]){
  const plan=buildApplyPlan({record:r,today:TODAY,...args}),body=plan.body;
  assert.ok(body.length<=1800,`${label}: ${body.length} characters`);assert.ok(body.includes(r.title)&&body.includes('(NCT07254806)')&&body.includes('https://clinicaltrials.gov/study/NCT07254806'),`${label}: study title, NCT ID and link`);
  assert.equal(body.split('\n').filter(l=>/^- /.test(l)&&Object.values(APPLY_QUESTION_TEMPLATES).some(q=>l===`- ${q}`)).length,EMAIL_QUESTION_LIMIT,`${label}: three questions`);assert.match(body,/I would be grateful for a reply/);if(args.patient.name){assert.match(body,/Thank you,\n/);assert.match(body,/^Hello [^\n]+,\n\nMy name is /)}else{assert.match(body,/\n\nThank you\.$/,`${label}: no name, so a plain sign-off`);assert.match(body,/^Hello [^\n]+,\n\nI would like to learn/)}
  assert.ok(mailtoUrl(plan.primary!.email,plan.subject,body),`${label}: opens directly`);assert.ok(plan.mailto!.length<3000);
 }
 const agentPlan=buildApplyPlan({record:r,patient:patient(),origin:SALT_LAKE,today:TODAY,agent});for(const id of agent.questionIds)assert.ok(agentPlan.body.includes(APPLY_QUESTION_TEMPLATES[id]));
 const rich=buildApplyPlan({record:r,patient:{...patient(),answers:Object.fromEntries((['diagnosis_details','symptom_duration','prior_treatments'] as ApplyPrescreenId[]).map(id=>[id,'z'.repeat(100)]))},details:{name:'',condition:'c'.repeat(300),extra:'e'.repeat(150)},origin:SALT_LAKE,today:TODAY});
 assert.ok(rich.body.length<=1800,`a well-filled draft: ${rich.body.length} characters`);assert.ok(rich.body.includes('c'.repeat(300))&&rich.body.includes('e'.repeat(150)),'typed details are kept in full');
 assert.ok(buildApplyPlan({record:r,patient:named,today:TODAY}).body.length<=700,'the template itself, before anything the patient types, is well under the target');
 const longTitle=buildApplyPlan({record:{...r,title:'Randomized trial of a very long study title '.repeat(40)},patient:patient(),today:TODAY});assert.ok(longTitle.body.length<=1800);assert.match(longTitle.body,/\.\.\."\s\(NCT07254806\)/,'a very long title is cut at a word with an ellipsis; the NCT ID and link still identify the study');
 assert.equal(shortTitle(r.title),r.title);assert.ok(shortTitle('word '.repeat(200)).length<=EMAIL_TITLE_LIMIT);assert.equal(shortTitle('x'.repeat(500)).length,EMAIL_TITLE_LIMIT);assert.ok(!shortTitle('word '.repeat(200)).includes('  '));
});

test('a blank name is left out of every draft: no "[your name]", no bracketed placeholder, and the sign-off still reads naturally',()=>{
 const r=record(),strictlyNoPlaceholder=(where:string,text:string)=>{assert.doesNotMatch(text,/[\[\]]/,`${where} has a bracket`);assert.doesNotMatch(text,/your name/i,`${where} mentions a name placeholder`)};
 for(const[label,blankName,args]of [['no origin','',{}],['near me','',{origin:SALT_LAKE}],['spaces only','   \t ',{}]] as [string,string,any][]){
  const plan=buildApplyPlan({record:r,patient:{...patient(),name:blankName},today:TODAY,...args});
  const handed={'email body':plan.body,'email-app link':decodeURIComponent(plan.mailto!),'call script':plan.phoneScript,'follow-up message':plan.followUpMessage,'subject':plan.subject};
  for(const[where,text]of Object.entries(handed))strictlyNoPlaceholder(`${label} ${where}`,text);
  assert.match(plan.body,/^Hello [^\n]+,\n\nI would like to learn whether I could take part in this study/,'the opening sentence starts at "I would like", not at an empty name');
  assert.doesNotMatch(plan.body,/My name is/);assert.ok(plan.body.endsWith('\n\nThank you.'),'the email ends with "Thank you." and no empty signature line');assert.doesNotMatch(plan.body,/Thank you,/);
  assert.match(plan.phoneScript,/^Say: Hello, I am calling about the study NCT07254806, /);assert.doesNotMatch(plan.phoneScript,/my name is/i);
  assert.match(plan.followUpMessage,/^Hello [^\n]+,\n\nI am following up on my earlier message/);assert.ok(plan.followUpMessage.endsWith('\n\nThank you.'));
  for(const text of [plan.body,plan.phoneScript,plan.followUpMessage])assert.equal(text,text.trimEnd(),'no trailing blank lines');
  assert.deepEqual(plan.missing[0],'Add your name to sign the email.');
 }
 const direct=[composeEmail(r,r.sites[1],r.sites[1].contacts[0],blankPatient(),DEFAULT_QUESTION_IDS,DEFAULT_PRESCREEN_IDS),composePhoneScript(r,r.sites[1],blankPatient(),DEFAULT_QUESTION_IDS,DEFAULT_PRESCREEN_IDS),composeFollowUpMessage(r,r.sites[1],r.sites[1].contacts[0],blankPatient())];
 direct.forEach((text,i)=>strictlyNoPlaceholder(`direct ${i}`,text));
 const named=buildApplyPlan({record:r,patient:{...patient(),name:'  Morgan   Example '},today:TODAY});
 assert.match(named.body,/My name is Morgan Example\. I would like to learn/);assert.ok(named.body.endsWith('\n\nThank you,\nMorgan Example'));assert.match(named.phoneScript,/^Say: Hello, my name is Morgan Example\. I am calling/);assert.match(named.followUpMessage,/My name is Morgan Example\. I am following up/);assert.deepEqual(named.missing,[]);
 const fromDetails=buildApplyPlan({record:r,patient:{...patient(),name:''},details:{name:'Pat Doe',condition:'',extra:''},today:TODAY});
 assert.match(fromDetails.body,/My name is Pat Doe\./);assert.ok(fromDetails.body.endsWith('Thank you,\nPat Doe'));assert.deepEqual(fromDetails.missing,[]);
});
test('"Based on what I have shared" is a default question only once the patient has shared something',()=>{
 const r=record(),fit=APPLY_QUESTION_TEMPLATES.prescreen_fit;
 assert.ok(!DEFAULT_QUESTION_IDS.includes('prescreen_fit'),'not in the base default list');assert.deepEqual([...DEFAULT_QUESTION_IDS],['still_enrolling','visits','costs','next_steps']);
 const blank=buildApplyPlan({record:r,patient:blankPatient(),today:TODAY});
 assert.deepEqual(blank.questionIds,['still_enrolling','visits','costs','next_steps']);for(const[where,text]of [['email',blank.body],['call script',blank.phoneScript]])assert.ok(!text.includes(fit),`${where} must not claim something was shared`);
 for(const[label,args]of [['blank answers',{patient:{...blankPatient(),answers:{diagnosis_details:'   ',symptom_duration:''}}}],['only contact details',{patient:{...blankPatient(),name:'Morgan',phone:'208 555 0142'}}],['details name only',{patient:blankPatient(),details:{name:'Pat',condition:'',extra:''}}]] as [string,any][])assert.ok(!buildApplyPlan({record:r,today:TODAY,...args}).questionIds.includes('prescreen_fit'),label);
 const shared=['ids',buildApplyPlan({record:r,patient:{...blankPatient(),answers:{diagnosis_details:'Disc degeneration'}},today:TODAY})] as const;
 assert.deepEqual(shared[1].questionIds,['still_enrolling','prescreen_fit','visits','costs','next_steps']);assert.ok(shared[1].body.includes(fit)&&shared[1].phoneScript.includes(fit));
 for(const details of [{name:'',condition:'Back pain',extra:''},{name:'',condition:'',extra:'I use a cane'}])assert.ok(buildApplyPlan({record:r,patient:blankPatient(),details,today:TODAY}).questionIds.includes('prescreen_fit'),'a reason or note from Your details is also something shared');
 assert.equal(hasSharedInfo(blankPatient()),false);assert.equal(hasSharedInfo({...blankPatient(),answers:{recent_imaging:'MRI last year'}}),true);assert.deepEqual(defaultQuestionIds(false),[...DEFAULT_QUESTION_IDS]);assert.deepEqual(defaultQuestionIds(true).slice(0,3),['still_enrolling','prescreen_fit','visits']);
 const agent=buildApplyPlan({record:r,patient:blankPatient(),today:TODAY,agent:{nctId:'NCT07254806',questionIds:['placebo','crossover','next_steps'],prescreenIds:['affected_area'],flagIds:[]}});assert.deepEqual(agent.questionIds,['placebo','crossover','next_steps'],'the generated brief still decides its own list');
});
