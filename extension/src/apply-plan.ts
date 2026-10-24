/** "Help me apply" contact plan. Pure and deterministic: built on this device from the public record, the patient's
 * local fields and fixed catalog IDs. No text here comes from a model; patient details never enter the .ics reminder. */
import{haversineMiles}from'../../scaffold/lib/eligibility/hardFilters';
import{siteLocationStatus,validLocalOrigin,type LocalOrigin}from'./local-distance';
import{dialNumber,isNanpCountry,TEL_HREF,type DialNumber}from'./phone';
import{YOUR_DETAILS_LIMITS,type YourDetails}from'./your-details';
import{APPLY_FLAG_TEMPLATES,APPLY_PRESCREEN_TEMPLATES,APPLY_QUESTION_TEMPLATES,type ApplyContact,type ApplyFlagId,type ApplyOfficial,type ApplyPrescreenId,type ApplyQuestionId,type ApplyRecord,type ApplyResult,type ApplySite}from'../shared/apply-contract.mjs';
export const DEFAULT_QUESTION_IDS:readonly ApplyQuestionId[]=Object.freeze(['still_enrolling','prescreen_fit','visits','costs','next_steps']);
export const DEFAULT_PRESCREEN_IDS:readonly ApplyPrescreenId[]=Object.freeze(['diagnosis_details','symptom_duration','recent_imaging','prior_treatments','medication_list']);
/** An encoded mailto URL up to MAILTO_URL_LIMIT characters opens directly. MAILTO_BODY_LIMIT is the plain-English message
 * length that normally fits inside that once percent-encoded (spaces and line breaks grow); the encoded URL length is what is checked. */
export const MAILTO_BODY_LIMIT=5000,MAILTO_URL_LIMIT=8000,DRAFT_BODY_LIMIT=16000,ANSWER_LIMIT=160,EMAIL_QUESTION_LIMIT=3,EMAIL_TITLE_LIMIT=240,NEAR_COMPLETION_DAYS=120,STALE_DAYS=365,FOLLOW_UP_BUSINESS_DAYS=5;
const DAY=86400000;
export interface ApplyPatient{name:string;phone:string;email:string;bestTimes:string;zip:string;answers:Partial<Record<ApplyPrescreenId,string>>}
export const blankPatient=():ApplyPatient=>({name:'',phone:'',email:'',bestTimes:'',zip:'',answers:{}});
export type PlanContact=ApplyContact&{source:'site'|'central'};
export interface SiteOption{site:ApplySite;distanceMiles?:number}
/** A listed contact with a phone number, and its dial link when the number is a complete, checkable phone number. */
export interface CallContact{contact:PlanContact;dial?:DialNumber}
export interface ApplyPlan{nctId:string;title:string;sourceUrl:string;site?:ApplySite;distanceMiles?:number;siteReason:'chosen'|'nearest'|'only'|'none';siteOptions:SiteOption[];primary?:PlanContact;backups:PlanContact[];investigator?:ApplyOfficial;flagIds:ApplyFlagId[];questionIds:ApplyQuestionId[];prescreenIds:ApplyPrescreenId[];answerIds:ApplyPrescreenId[];subject:string;body:string;phoneScript:string;callContacts:CallContact[];followUpMessage:string;followUpDate:string;followUpLabel:string;followUpSteps:string[];followUp:string;followUpCall?:CallContact;mailto?:string;tel?:string;missing:string[]}
const clean=(v:unknown,max=200)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const norm=(v:string|null|undefined)=>(v||'').trim().toUpperCase().replace(/[\s-]+/g,'_');
const reachable=(c:ApplyContact)=>!!(c.email||c.phone);
const EMAIL=/^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/;
export function validEmail(v:string){return v.length<=254&&EMAIL.test(v)}
export function phoneDigits(v:string|null|undefined){const s=(v||'').trim(),digits=s.replace(/\D/g,'');return digits.length>=7&&digits.length<=15?(s.startsWith('+')?'+':'')+digits:undefined}
/** Calendar date (UTC midnight) of the caller's local "today". */
export function localDay(today:Date){return Date.UTC(today.getFullYear(),today.getMonth(),today.getDate())}
export function recordDay(v:string|null):number|undefined{const m=v&&/^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v);return m?Date.UTC(+m[1],+m[2]-1,m[3]?+m[3]:1):undefined}
export function addBusinessDays(day:number,count:number){let t=day,left=count;while(left>0){t+=DAY;const w=new Date(t).getUTCDay();if(w!==0&&w!==6)left--}return t}
const isoDay=(t:number)=>new Date(t).toISOString().slice(0,10);
const longDay=(t:number)=>new Date(t).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});
/** Recruiting sites first; if none recruit, sites that may open or are unverified. Sorted by distance when a local origin exists. */
export function siteOptions(record:ApplyRecord,origin?:LocalOrigin|null):SiteOption[]{
 const status=(s:ApplySite)=>siteLocationStatus(s.status??undefined);let pool=record.sites.filter(s=>status(s)==='accepting');
 if(!pool.length)pool=record.sites.filter(s=>status(s)!=='not_accepting');
 const options=pool.map(site=>({site,...(validLocalOrigin(origin)&&site.lat!==null&&site.lon!==null?{distanceMiles:haversineMiles(origin,{lat:site.lat,lon:site.lon})}:{})}));
 return validLocalOrigin(origin)?options.map((o,i)=>({o,i})).sort((a,b)=>(a.o.distanceMiles??Infinity)-(b.o.distanceMiles??Infinity)||a.i-b.i).map(x=>x.o):options;
}
export function chooseSite(record:ApplyRecord,origin?:LocalOrigin|null,siteId?:string):{site?:ApplySite;distanceMiles?:number;reason:ApplyPlan['siteReason'];options:SiteOption[]}{
 const options=siteOptions(record,origin),picked=siteId?record.sites.find(s=>s.id===siteId):undefined;
 if(picked){const d=validLocalOrigin(origin)&&picked.lat!==null&&picked.lon!==null?haversineMiles(origin,{lat:picked.lat,lon:picked.lon}):undefined;return{site:picked,...(d!==undefined?{distanceMiles:d}:{}),reason:'chosen',options}}
 if(validLocalOrigin(origin)&&options[0]?.distanceMiles!==undefined)return{site:options[0].site,distanceMiles:options[0].distanceMiles,reason:'nearest',options};
 if(options.length===1)return{site:options[0].site,...(options[0].distanceMiles!==undefined?{distanceMiles:options[0].distanceMiles}:{}),reason:'only',options};
 return{reason:'none',options};
}
const sameContact=(a:ApplyContact,b:ApplyContact)=>(a.email||'').toLowerCase()===(b.email||'').toLowerCase()&&(a.phone||'')===(b.phone||'')&&(a.name||'')===(b.name||'');
/** Primary = the chosen site's reachable contact (email preferred), else a central contact. Backups: other site contacts,
 * central contacts, then the principal investigator (name and affiliation only). */
export function contactChain(record:ApplyRecord,site?:ApplySite){
 const pick=(list:ApplyContact[])=>list.find(c=>c.email&&validEmail(c.email))??list.find(reachable);
 const siteList=(site?.contacts??[]).filter(reachable),central=record.centralContacts.filter(reachable);
 const fromSite=pick(siteList),primaryRaw=fromSite??pick(central);
 const primary:PlanContact|undefined=primaryRaw?{...primaryRaw,source:fromSite?'site':'central'}:undefined;
 const backups:PlanContact[]=[];for(const[c,source]of [...siteList.map(c=>[c,'site'] as const),...central.map(c=>[c,'central'] as const)]){if(c.id===primary?.id||primary&&sameContact(c,primary)||backups.some(b=>sameContact(b,c)))continue;backups.push({...c,source})}
 const investigator=record.officials.find(o=>norm(o.role)==='PRINCIPAL_INVESTIGATOR'&&o.name)??record.officials.find(o=>o.name);
 return{primary,backups,...(investigator?{investigator:{id:investigator.id,name:investigator.name,role:investigator.role,affiliation:investigator.affiliation}}:{})};
}
const domain=(email:string|null)=>email&&email.includes('@')?email.slice(email.lastIndexOf('@')+1).toLowerCase():undefined;
function distance(a:string,b:string){if(Math.abs(a.length-b.length)>2)return 3;const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const next=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=next}}return row[b.length]}
const nameKey=(v:string|null)=>(v||'').toLowerCase().replace(/,.*$/,'').replace(/[^a-z]/g,'');
const facilityKey=(v:string|null)=>(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
/** Same contact name (or same facility) listed with different email domains, or near-duplicate domains anywhere
 * (for example centenoschultz.com vs centenschultz.com): a likely typo the patient should double-check. */
export function contactsInconsistent(record:ApplyRecord){
 const rows=[...record.centralContacts.map(c=>({c,facility:''})),...record.sites.flatMap(s=>s.contacts.map(c=>({c,facility:facilityKey(s.facility)})))].filter(r=>domain(r.c.email));
 const differs=(key:(r:typeof rows[number])=>string)=>{const seen=new Map<string,Set<string>>();for(const r of rows){const k=key(r);if(!k)continue;const set=seen.get(k)??new Set();set.add(domain(r.c.email)!);seen.set(k,set)}return [...seen.values()].some(s=>s.size>1)};
 if(differs(r=>nameKey(r.c.name))||differs(r=>r.facility))return true;
 const domains=[...new Set(rows.map(r=>domain(r.c.email)!))];
 return domains.some((a,i)=>domains.slice(i+1).some(b=>a!==b&&distance(a,b)<=2));
}
export function deterministicFlags(record:ApplyRecord,site:ApplySite|undefined,today:Date):ApplyFlagId[]{
 const day=localDay(today),flags=new Set<ApplyFlagId>(),pc=recordDay(record.primaryCompletionDate),updated=recordDay(record.lastUpdatePostDate);
 if(pc!==undefined&&pc-day<=NEAR_COMPLETION_DAYS*DAY)flags.add('near_completion');
 if(site?.status&&norm(site.status)!==norm(record.overallStatus))flags.add('status_mismatch');
 if(contactsInconsistent(record))flags.add('contact_inconsistent');
 if(site&&!site.contacts.some(reachable))flags.add('no_site_contact');
 if(updated!==undefined&&day-updated>STALE_DAYS*DAY)flags.add('stale_record');
 if(norm(site?site.status:record.overallStatus)==='NOT_YET_RECRUITING')flags.add('not_yet_recruiting');
 if(record.sites.length<=2&&!record.sitesTruncated)flags.add('limited_sites');
 if(record.maximumAge)flags.add('age_limit');
 return [...flags];
}
/** Agent and deterministic flags, de-duplicated, in the fixed catalog order. */
export function mergeFlags(...lists:readonly ApplyFlagId[][]):ApplyFlagId[]{const all=new Set(lists.flat());return(Object.keys(APPLY_FLAG_TEMPLATES) as ApplyFlagId[]).filter(id=>all.has(id))}
/** The site's own routing format: "NCT ID, org study ID (or acronym), official title (or brief title)". */
export function emailSubject(record:ApplyRecord){return[record.nctId,record.orgStudyId??record.acronym,record.officialTitle??record.title].filter((v):v is string=>!!v).map(v=>clean(v,2000)).join(', ')}
/** Fixed pronoun swap so catalog pre-screen labels read in the patient's voice. */
export function firstPerson(text:string){return text.replace(/\bto you\b/g,'to me').replace(/\bYour\b/g,'My').replace(/\byour\b/g,'my').replace(/\byou\b/g,'I')}
const place=(s?:ApplySite)=>s?[s.facility,[s.city,s.state].filter(Boolean).join(', ')].filter(Boolean).join(' in '):'';
/** Multi-line patient text for a local draft: control characters removed, at most one blank line in a row, bounded. */
export function cleanBlock(v:unknown,max:number){return typeof v==='string'?v.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g,' ').split('\n').map(line=>line.replace(/[ \t]+/g,' ').trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim().slice(0,max).trim():''}
/** Name for a draft: this study's own field first, then the session-wide "Your details" name. */
const patientName=(patient:ApplyPatient,details?:YourDetails)=>clean(patient.name,120)||clean(details?.name,YOUR_DETAILS_LIMITS.name)||'[your name]';
const reasonText=(details?:YourDetails)=>cleanBlock(details?.condition,YOUR_DETAILS_LIMITS.condition);
const extraText=(details?:YourDetails)=>cleanBlock(details?.extra,YOUR_DETAILS_LIMITS.extra);
const greetingName=(c?:ApplyContact)=>{const n=clean(c?.name,160).replace(/,.*$/,'').trim();return n||'study team'};
function reachLine(p:ApplyPatient){const phone=clean(p.phone,40),email=clean(p.email,254),times=clean(p.bestTimes,120);const ways=[phone&&`by phone at ${phone}`,email&&`by email at ${email}`].filter(Boolean).join(' or ');return `You can reach me ${ways||'by reply to this email'}.${times?` The best times to reach me are ${times}.`:''}`}
/** Pre-screen items to ask about: the selected ones, plus anything the patient already answered (so a later agent
 * selection never silently drops what they typed). */
export function answerIds(prescreenIds:readonly ApplyPrescreenId[],patient:ApplyPatient):ApplyPrescreenId[]{return[...prescreenIds,...(Object.keys(APPLY_PRESCREEN_TEMPLATES) as ApplyPrescreenId[]).filter(id=>!prescreenIds.includes(id)&&clean(patient.answers[id],ANSWER_LIMIT))]}
/** Study title for the short email: whole words, at most EMAIL_TITLE_LIMIT characters. The NCT ID and link identify the study exactly. */
export function shortTitle(v:unknown){const t=clean(v,1000);if(t.length<=EMAIL_TITLE_LIMIT)return t;const cut=t.slice(0,EMAIL_TITLE_LIMIT-3),space=cut.lastIndexOf(' ');return `${(space>EMAIL_TITLE_LIMIT/2?cut.slice(0,space):cut).replace(/[\s,;:.-]+$/,'')}...`}
/** The short email: who is writing, which study (title, NCT ID and link), the first three questions and a polite request.
 * The call script keeps every question and the full pre-screen list. Anything the patient typed is kept as typed. */
export function composeEmail(record:ApplyRecord,site:ApplySite|undefined,primary:ApplyContact|undefined,patient:ApplyPatient,questionIds:readonly ApplyQuestionId[],prescreenIds:readonly ApplyPrescreenId[],details?:YourDetails){
 const name=patientName(patient,details),where=place(site),reason=reasonText(details),extra=extraText(details),asked=questionIds.slice(0,EMAIL_QUESTION_LIMIT);
 const answered=answerIds(prescreenIds,patient).flatMap(id=>{const a=clean(patient.answers[id],ANSWER_LIMIT);return a?[{label:firstPerson(APPLY_PRESCREEN_TEMPLATES[id]),answer:a}]:[]});
 return[`Hello ${greetingName(primary)},`,'',`My name is ${name}. I would like to learn whether I could take part in this study${where?` at ${where}`:''}:`,`"${shortTitle(record.title)}" (${record.nctId})`,clean(record.sourceUrl,300),...(reason?['','Why I am reaching out:',reason]:[]),...(answered.length?['','A little about me:',...answered.map(a=>`- ${a.label}: ${a.answer}`)]:[]),...(extra?['','Something else I would like you to know:',extra]:[]),...(asked.length?['','My questions:',...asked.map(id=>`- ${APPLY_QUESTION_TEMPLATES[id]}`)]:[]),'',`I would be grateful for a reply when you have a moment. ${reachLine(patient)}`,'','Thank you,',name].join('\n');
}
export function composePhoneScript(record:ApplyRecord,site:ApplySite|undefined,patient:ApplyPatient,questionIds:readonly ApplyQuestionId[],prescreenIds:readonly ApplyPrescreenId[],details?:YourDetails){
 const name=patientName(patient,details),where=place(site),reason=reasonText(details),extra=extraText(details);
 return[`Say: Hello, my name is ${name}. I am calling about the study ${record.nctId}, ${clean(record.title,300)}${where?`, at ${where}`:''}. I found it on ClinicalTrials.gov and would like to know if I could take part.`,...(reason?['','If they ask why you are interested, you can say:',reason]:[]),'','Questions to ask:',...questionIds.map((id,i)=>`${i+1}. ${APPLY_QUESTION_TEMPLATES[id]}`),'','If they ask, have this ready:',...prescreenIds.map(id=>`- ${APPLY_PRESCREEN_TEMPLATES[id]}`),...(extra?['','Also mention:',extra]:[]),'',`Before you hang up: ${reachLine(patient).replace(/^You can reach me/,'tell them they can reach you').replace(/\bme\b/g,'you')}`,'Write down the name of the person you spoke with and the date.'].join('\n');
}
const contactName=(c:{name:string|null}|undefined,fallback:string)=>clean(c?.name,160)||fallback;
/** Short follow-up message for when the study team has not replied. Built locally like the email; editable before use. */
export function composeFollowUpMessage(record:ApplyRecord,site:ApplySite|undefined,primary:ApplyContact|undefined,patient:ApplyPatient,details?:YourDetails){
 const name=patientName(patient,details),where=place(site),reason=reasonText(details),extra=extraText(details);
 return[`Hello ${greetingName(primary)},`,'',`My name is ${name}. I am following up on my earlier message about the study "${clean(record.title,1000)}" (${record.nctId})${where?` at ${where}`:''}. I am still interested and would like to learn whether I could take part, and what the next steps would be.`,...(reason?['','As a reminder, this is why I am reaching out:',reason]:[]),...(extra?['','Something else I would like you to know:',extra]:[]),'',reachLine(patient),'','Thank you,',name].join('\n');
}
/** First listed contact with a phone number, in contact-chain order: the one the follow-up plan suggests calling. */
export const followUpCallable=(primary:PlanContact|undefined,backups:PlanContact[])=>[primary,...backups].find((c):c is PlanContact=>!!c?.phone);
export function followUpSteps(primary:PlanContact|undefined,backups:PlanContact[],investigator:ApplyOfficial|undefined){
 const steps:string[]=[],callable=followUpCallable(primary,backups),emailable=backups.find(c=>c.email&&c.email.toLowerCase()!==(primary?.email||'').toLowerCase());
 if(callable)steps.push(`call ${contactName(callable,'the study contact')} at ${callable.phone}${callable.phoneExt?` ext. ${callable.phoneExt}`:''}`);
 if(emailable)steps.push(`email ${contactName(emailable,'the backup contact')} at ${emailable.email}`);
 if(investigator?.name)steps.push(`contact ${investigator.name}${investigator.affiliation?` at ${investigator.affiliation}`:''} (the study's principal investigator)`);
 return steps;
}
const icsText=(v:string)=>v.replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
function fold(line:string){const out:string[]=[];let rest=line;while(new TextEncoder().encode(rest).length>75){let cut=Math.min(rest.length,74);while(new TextEncoder().encode(rest.slice(0,cut)).length>74)cut--;out.push(rest.slice(0,cut));rest=' '+rest.slice(cut)}out.push(rest);return out.join('\r\n')}
const stamp=(t:number)=>new Date(t).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
/** Local reminder with the study, its public contacts and the follow-up plan only: no patient name, contact details or answers. */
export function buildFollowUpIcs(plan:Pick<ApplyPlan,'nctId'|'title'|'sourceUrl'|'followUpDate'|'followUp'|'primary'|'site'>,now:number){
 const day=plan.followUpDate.replace(/-/g,''),next=isoDay(Date.parse(plan.followUpDate+'T00:00:00Z')+DAY).replace(/-/g,'');
 const who=plan.primary?`Study contact: ${[contactName(plan.primary,'Study contact'),plan.primary.phone,plan.primary.email].filter(Boolean).join(', ')}`:'';
 const description=[`Study ${plan.nctId}: ${clean(plan.title,300)}`,plan.site?`Site: ${place(plan.site)}`:'',who,plan.followUp,plan.sourceUrl].filter(Boolean).join('\n');
 return['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Treatable//Help me apply//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:${plan.nctId}-${day}-follow-up@treatable.invalid`,`DTSTAMP:${stamp(now)}`,`DTSTART;VALUE=DATE:${day}`,`DTEND;VALUE=DATE:${next}`,`SUMMARY:${icsText(`Follow up on study ${plan.nctId}`)}`,`DESCRIPTION:${icsText(description)}`,`URL:${plan.sourceUrl}`,'BEGIN:VALARM','TRIGGER:PT9H','ACTION:DISPLAY',`DESCRIPTION:${icsText(`Follow up on study ${plan.nctId}`)}`,'END:VALARM','END:VEVENT','END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';
}
/** Email header lines (To, Subject, Cc, Bcc, From) at the very top of a message. The recipient and subject have their own
 * fields, so these lines never belong in the message body. */
const HEADER_LINE=/^[ \t]*(?:to|subject|cc|bcc|from)[ \t]*:.*$/i;
export function hasHeaderLines(body:string){const first=body.replace(/^(?:[ \t]*\r?\n)+/,'').split(/\r?\n/,1)[0]??'';return HEADER_LINE.test(first)}
/** The message body only: removes any To/Subject/Cc/Bcc/From lines at the top (for example a pasted "Copy full email"),
 * plus the blank lines that follow them. Text after the first non-header line is never changed. */
export function messageBody(body:string){
 if(!hasHeaderLines(body))return body;
 const lines=body.split(/\r?\n/);let i=0;
 while(i<lines.length&&(!lines[i].trim()||HEADER_LINE.test(lines[i])))i++;
 return lines.slice(i).join('\n');
}
/** How the draft can reach the patient's email app. The recipient, subject and body are separate mailto parameters and the
 * body carries no header lines. The full editable draft is never shortened.
 * - link: the whole draft fits in one mailto URL of at most MAILTO_URL_LIMIT characters and opens directly.
 * - copy: the draft is too long for that. `url` carries only the recipient and subject; `body` is the message to copy first.
 * - blocked: something must be fixed before any handoff (`issue` says what). */
export type EmailHandoff={mode:'link';url:string}|{mode:'copy';url:string;body:string}|{mode:'blocked';issue:string};
const blocked=(issue:string):EmailHandoff=>({mode:'blocked',issue});
export function emailHandoff(email:string|null|undefined,subject:string,draftBody:string):EmailHandoff{
 const body=messageBody(draftBody);
 if(!email||!validEmail(email))return blocked('Choose a valid email address listed in the official record.');
 if(/[\r\n\u0000]/.test(subject)||subject.length>2200)return blocked('Use a single-line subject of no more than 2,200 characters.');
 if(!subject.trim()||!body.trim())return blocked('Add a subject and message before opening your email app.');
 if(body.length>DRAFT_BODY_LIMIT)return blocked('Keep the message within 16,000 characters.');
 let head:string;try{const at=email.lastIndexOf('@');head=`mailto:${encodeURIComponent(email.slice(0,at))}@${email.slice(at+1)}?subject=${encodeURIComponent(subject)}`}catch{return blocked('Check the email address and subject for unsupported characters.')}
 let url:string;try{url=`${head}&body=${encodeURIComponent(body.replace(/\r?\n/g,'\r\n'))}`}catch{return blocked('Check the subject and message for unsupported characters.')}
 if(url.length<=MAILTO_URL_LIMIT)return{mode:'link',url};
 return head.length<=MAILTO_URL_LIMIT?{mode:'copy',url:head,body}:blocked('Shorten the subject so it fits in an email-app link.');
}
/** Why no email-app handoff is possible, if that is the case. A draft that is only long is not an issue: it uses the copy handoff. */
export function mailtoIssue(email:string|null|undefined,subject:string,draftBody:string):string|undefined{const h=emailHandoff(email,subject,draftBody);return h.mode==='blocked'?h.issue:undefined}
/** The mailto URL that opens the whole draft directly, or undefined when the draft needs the copy handoff or is blocked. */
export function mailtoUrl(email:string|null|undefined,subject:string,draftBody:string){const h=emailHandoff(email,subject,draftBody);return h.mode==='link'?h.url:undefined}
/** Link target for a contact action: only a mailto: or tel: URL built above, never any other scheme. */
export function contactHref(value:string|undefined,scheme:'mailto:'|'tel:'){return typeof value==='string'&&value.startsWith(scheme)&&!/[\s<>"]/.test(value)&&(scheme!=='tel:'||TEL_HREF.test(value))?value:undefined}
/** tel: link for a structured record phone field; undefined unless the number checks out (see phone.ts). */
export function telUrl(phone:string|null|undefined,phoneExt?:string|null,country?:string|null){return dialNumber(phone,phoneExt,country)?.href}
/** Country used for a record's central contacts: NANP when every listed site is in a +1 country (US default for US
 * records), the single listed country when all sites share one, otherwise unknown (only +-prefixed numbers dial). */
export function recordCountry(record:ApplyRecord):string|undefined{
 const countries=record.sites.map(s=>s.country).filter((c):c is string=>!!c);if(!countries.length)return;
 if(countries.every(isNanpCountry))return 'United States';
 const first=countries[0].trim().toLowerCase();return countries.every(c=>c.trim().toLowerCase()===first)?countries[0]:undefined;
}
/** Phone contacts in contact-chain order, each with a dial link only from its own structured fields and listing country. */
export function callContacts(record:ApplyRecord,site:ApplySite|undefined,contacts:PlanContact[]):CallContact[]{
 const central=recordCountry(record);
 return contacts.filter(c=>c.phone).map(contact=>{const dial=dialNumber(contact.phone,contact.phoneExt,contact.source==='site'?site?.country??central:central);return{contact,...(dial?{dial}:{})}});
}
export function missingInput(patient:ApplyPatient){const out:string[]=[],phone=clean(patient.phone,40),email=clean(patient.email,254);
 if(!clean(patient.name,120))out.push('Enter your name.');
 if(!phone&&!email)out.push('Enter a phone number or an email address so the study team can reach you.');
 if(phone&&!phoneDigits(phone))out.push('Check the phone number. Use 7 to 15 digits.');
 if(email&&!validEmail(email))out.push('Check the email address.');return out}
/** `details` (the session-only "Your details") only fills the local drafts below; it never leaves this function in any other form. */
export function buildApplyPlan({record,patient,details,origin,siteId,agent,today}:{record:ApplyRecord;patient:ApplyPatient;details?:YourDetails;origin?:LocalOrigin|null;siteId?:string;agent?:Pick<ApplyResult,'nctId'|'questionIds'|'prescreenIds'|'flagIds'>;today:Date}):ApplyPlan{
 const useAgent=agent&&agent.nctId===record.nctId?agent:undefined,choice=chooseSite(record,origin,siteId),chain=contactChain(record,choice.site);
 const questionIds=[...(useAgent?.questionIds??DEFAULT_QUESTION_IDS)],prescreenIds=[...(useAgent?.prescreenIds??DEFAULT_PRESCREEN_IDS)];
 const flagIds=mergeFlags(deterministicFlags(record,choice.site,today),useAgent?.flagIds??[]);
 const subject=emailSubject(record),body=composeEmail(record,choice.site,chain.primary,patient,questionIds,prescreenIds,details);
 const due=addBusinessDays(localDay(today),FOLLOW_UP_BUSINESS_DAYS),steps=followUpSteps(chain.primary,chain.backups,chain.investigator),label=longDay(due);
 const followUp=steps.length?`If no reply by ${label}: ${steps.map((s,i)=>i?`then ${s}`:s).join('; ')}.`:`If no reply by ${label}: contact the study again using the details on its ClinicalTrials.gov page.`;
 const calls=callContacts(record,choice.site,[...(chain.primary?[chain.primary]:[]),...chain.backups]),callable=followUpCallable(chain.primary,chain.backups),followUpCall=calls.find(c=>c.contact===callable);
 const mailto=mailtoUrl(chain.primary?.email,subject,body),tel=calls.find(c=>c.contact===chain.primary)?.dial?.href;
 return{nctId:record.nctId,title:record.title,sourceUrl:record.sourceUrl,...(choice.site?{site:choice.site}:{}),...(choice.distanceMiles!==undefined?{distanceMiles:choice.distanceMiles}:{}),siteReason:choice.reason,siteOptions:choice.options,...(chain.primary?{primary:chain.primary}:{}),backups:chain.backups,...(chain.investigator?{investigator:chain.investigator}:{}),flagIds,questionIds,prescreenIds,answerIds:answerIds(prescreenIds,patient),subject,body,phoneScript:composePhoneScript(record,choice.site,patient,questionIds,prescreenIds,details),callContacts:calls,followUpMessage:composeFollowUpMessage(record,choice.site,chain.primary,patient,details),followUpDate:isoDay(due),followUpLabel:label,followUpSteps:steps,followUp,...(followUpCall?{followUpCall}:{}),...(mailto?{mailto}:{}),...(tel?{tel}:{}),missing:missingInput({...patient,name:clean(patient.name,120)||clean(details?.name,YOUR_DETAILS_LIMITS.name)})};
}
