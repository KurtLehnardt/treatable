import React from'react';
import{PRIVATE_TEXT_FIELD}from'./patient-form';
import{failureCopy}from'./failures';
import{trialUrl}from'./core';
import{siteLocationStatus}from'./local-distance';
import{APPLY_FLAG_TEMPLATES,APPLY_PRESCREEN_TEMPLATES,APPLY_QUESTION_TEMPLATES,type ApplyToolSection,type ApplySite}from'../shared/apply-contract.mjs';
import type{ApplyController}from'./use-apply';
import{contactHref,type PlanContact}from'./apply-plan';
const SECTION_LABELS:Record<ApplyToolSection,string>={overview:'Overview',eligibility:'Eligibility',design:'Study design',locations_contacts:'Locations and contacts'};
const STATUS_LABELS={accepting:'Recruiting',opening_soon:'Not yet recruiting',invitation:'By invitation only',not_accepting:'Not recruiting',unverified:'Status not confirmed'} as const;
const statusLabel=(s?:string|null)=>STATUS_LABELS[siteLocationStatus(s??undefined)];
const siteName=(s:ApplySite)=>s.facility||'Study site';
const siteWhere=(s:ApplySite)=>[s.city,s.state,s.country&&!/^united states/i.test(s.country)?s.country:''].filter(Boolean).join(', ');
const miles=(d?:number)=>d===undefined?'':d<1?'less than 1 mile away':`about ${Math.round(d)} miles away`;
function Failure({code,lead}:{code:string;lead?:string}){return <p className="notice apply-failure" role="status">{lead&&<strong>{lead} </strong>}{failureCopy(code)} <code>{code}</code></p>}
function Contact({c,label}:{c:PlanContact;label:string}){return <div className="apply-contact"><span className="eyebrow">{label}</span><strong>{c.name||'Study contact'}</strong>{c.phone&&<span>Phone: {c.phone}{c.phoneExt?` ext. ${c.phoneExt}`:''}</span>}{c.email&&<span>Email: {c.email}</span>}</div>}
export function ApplyView({vm}:{vm:ApplyController}){
 const plan=vm.plan,record=vm.record,blocked=!plan||plan.missing.length>0,f=PRIVATE_TEXT_FIELD;
 return <section className="apply-section" aria-labelledby="apply-heading">
  <div className="section-intro"><span className="eyebrow">This study · {vm.nctId}</span><h2 id="apply-heading">Help me apply</h2><p>Get a contact plan for this study: who to contact, what to have ready, what to ask, and a message you can send. Your details stay on this device until you open the email in your own mail app.</p></div>
  {vm.phase==='ended'?<p role="status" className="notice">Help me apply ended. Your details and the plan were cleared.</p>:<>
  {(vm.phase==='connecting'||vm.phase==='loading')&&<p role="status" className="notice">Loading the official study record…</p>}
  {vm.recordSource==='official'&&vm.prepareCode&&<Failure lead="The agent review is not available, but your contact plan is." code={vm.prepareCode}/>}
  {vm.recordCode&&<><p role="alert" className="notice error">The study record could not be loaded, so no plan is shown. {failureCopy(vm.recordCode)} <code>{vm.recordCode}</code></p>{vm.prepareCode&&<p className="fine">Helper status: <code>{vm.prepareCode}</code></p>}</>}
  {record&&plan&&<>
   <div className="apply-study"><h3>{record.title}</h3><p className="fine">{vm.recordSource==='helper'?'Official record, read by the Treatable helper':'Official record, loaded directly from ClinicalTrials.gov'}{trialUrl(record.sourceUrl)&&<> · <a href={trialUrl(record.sourceUrl)} target="_blank" rel="noopener noreferrer">Open the record</a></>}</p></div>

   <section className="apply-step" aria-labelledby="apply-you"><h3 id="apply-you"><span className="apply-num">1</span>About you</h3><p className="fine">Only used to write your message. Not saved, and never sent to OpenAI.</p>
    <form autoComplete="off" onSubmit={e=>e.preventDefault()}>
     <label>Your full name <span className="required">Required</span><input {...f} value={vm.patient.name} maxLength={120} onChange={e=>vm.edit('name',e.target.value)}/></label>
     <div className="field-grid"><label>Phone<input {...f} type="tel" inputMode="tel" value={vm.patient.phone} maxLength={40} onChange={e=>vm.edit('phone',e.target.value)}/></label><label>Email<input {...f} type="email" inputMode="email" value={vm.patient.email} maxLength={254} onChange={e=>vm.edit('email',e.target.value)}/></label></div>
     <p className="fine">Give a phone number, an email, or both.</p>
     <label>Best times to reach you <span className="optional">Optional</span><input {...f} value={vm.patient.bestTimes} maxLength={120} placeholder="For example: weekday mornings" onChange={e=>vm.edit('bestTimes',e.target.value)}/></label>
     <label>Your ZIP code <span className="optional">Optional · finds the nearest site</span><input {...f} inputMode="numeric" value={vm.patient.zip} maxLength={10} placeholder="Five digits" onChange={e=>vm.edit('zip',e.target.value)}/></label>
     {vm.zipNote&&<p className="fine" role="status">{vm.zipNote}</p>}
     <fieldset className="apply-answers"><legend>Short answers for the study team <span className="optional">Optional</span></legend><p className="fine">Only what you type here goes in the email. Leave anything blank that you would rather discuss on the phone.</p>
      {plan.answerIds.map(id=><label key={id}>{APPLY_PRESCREEN_TEMPLATES[id]}<input {...f} value={vm.patient.answers[id]??''} maxLength={160} onChange={e=>vm.answer(id,e.target.value)}/></label>)}</fieldset>
    </form>
    {plan.missing.length>0&&<ul className="apply-missing" role="status" aria-label="Still needed">{plan.missing.map(m=><li key={m}>{m}</li>)}</ul>}
   </section>

   <section className="apply-step" aria-labelledby="apply-who"><h3 id="apply-who"><span className="apply-num">2</span>Who to contact</h3>
    {plan.site?<div className="apply-site"><strong>{siteName(plan.site)}</strong><span>{siteWhere(plan.site)}</span><span className="fine">{statusLabel(plan.site.status)}{plan.distanceMiles!==undefined?` · ${miles(plan.distanceMiles)} (straight line)`:''}{plan.siteReason==='nearest'?' · nearest to your ZIP code':plan.siteReason==='chosen'?' · the site you chose':''}</span></div>
     :<p>{plan.siteOptions.length?'Enter your ZIP code to find the nearest site, or choose a site below. Until then, the plan uses the study’s central contact.':'No open sites are listed. The plan uses the study’s central contact.'}</p>}
    {plan.primary?<Contact c={plan.primary} label={plan.primary.source==='site'?'Contact first · at this site':'Contact first · the study’s central contact'}/>:<p className="notice">No phone number or email is listed for this study. Use the record’s page to find another way to reach the team.</p>}
    {plan.backups.length>0&&<details className="apply-backups"><summary>Backup contacts ({plan.backups.length})</summary>{plan.backups.map(c=><Contact key={c.id} c={c} label={c.source==='site'?'At this site':'Central contact'}/>)}</details>}
    {plan.investigator&&<p className="fine">Principal investigator: {plan.investigator.name}{plan.investigator.affiliation?`, ${plan.investigator.affiliation}`:''}</p>}
    {plan.siteOptions.length>1&&<details className="apply-sites" open={plan.siteReason==='none'}><summary>{plan.siteReason==='none'?`Choose a site (${plan.siteOptions.length})`:`Choose a different site (${plan.siteOptions.length})`}</summary><ul>{plan.siteOptions.slice(0,25).map(o=><li key={o.site.id}><span><strong>{siteName(o.site)}</strong> {siteWhere(o.site)}{o.distanceMiles!==undefined?` · ${miles(o.distanceMiles)}`:''}</span><button type="button" aria-pressed={plan.site?.id===o.site.id} onClick={()=>vm.chooseSite(o.site.id)}>{plan.site?.id===o.site.id?'Chosen':'Use this site'}</button></li>)}</ul>{plan.siteOptions.length>25&&<p className="fine">Showing the first 25. Enter your ZIP code to find the nearest one.</p>}{vm.siteId&&<button type="button" className="quiet" onClick={()=>vm.chooseSite(undefined)}>Go back to the automatic choice</button>}</details>}
    {plan.flagIds.length>0&&<div className="apply-flags" role="note"><h4>Before you contact the team</h4><ul>{plan.flagIds.map(id=><li key={id}>{APPLY_FLAG_TEMPLATES[id]}</li>)}</ul></div>}
   </section>

   <section className="apply-step" aria-labelledby="apply-agent"><h3 id="apply-agent"><span className="apply-num">3</span>Ask the agent to review this study <span className="optional">Optional</span></h3>
    <p>An OpenAI agent reads only the public study record and picks questions, a checklist and warnings from Treatable’s fixed lists. None of your details are sent.</p>
    {vm.preview&&<details className="apply-exact"><summary>Exact API input (no personal information)</summary><pre>{JSON.stringify({agentsRequest:vm.preview.agentsRequest,toolResults:vm.preview.toolResults},null,2)}</pre></details>}
    {vm.agent?null:vm.prepared?<button type="button" className="primary apply-big" disabled={vm.agentBusy} onClick={vm.requestReview}>{vm.agentBusy?'The agent is reviewing…':'Ask the agent to review this study'}</button>
     :vm.recordSource==='helper'&&!vm.agentBusy?<button type="button" className="apply-big" onClick={vm.prepareAgain}>Prepare the review again</button>:vm.recordSource==='official'?<p className="fine">The review needs the Treatable helper. Your plan below uses Treatable’s standard questions and checklist.</p>:null}
    {vm.agentCode&&<Failure code={vm.agentCode}/>}
    {(vm.agentBusy||vm.agent)&&<ol className="apply-trace" aria-label="Agent activity" aria-live="polite">
     <li className="done">Sent the public study ID and pinned record sections only</li>
     {vm.agent?<><li className="done">Record lookups: {vm.agent.toolCalls} · sections read: {vm.agent.sectionsRead.map(s=>SECTION_LABELS[s]).join(', ')}</li><li className="done">Review finished and checked against Treatable’s lists{vm.agent.mode==='test'?' (test mode, not a live API call)':''}</li><li className={vm.agent.cleanup==='deleted'?'done':'warn'}>{vm.agent.cleanup==='deleted'?'Provider session deleted':'Provider session deletion could not be confirmed'}</li></>:<li className="working">The agent is reading the record…</li>}
    </ol>}
   </section>

   <section className="apply-step" aria-labelledby="apply-ask"><h3 id="apply-ask"><span className="apply-num">4</span>What to ask</h3><p className="fine">{vm.agent?'Chosen by the agent from Treatable’s list.':'Treatable’s standard questions.'}</p><ol className="apply-questions">{plan.questionIds.map(id=><li key={id}>{APPLY_QUESTION_TEMPLATES[id]}</li>)}</ol>
    <h4>Have these ready</h4><ul className="apply-checklist">{plan.prescreenIds.map(id=><li key={id}><label className="check-option"><input type="checkbox"/><span>{APPLY_PRESCREEN_TEMPLATES[id]}</span></label></li>)}</ul></section>

   <section className="apply-step" aria-labelledby="apply-send"><h3 id="apply-send"><span className="apply-num">5</span>Your message</h3>
    <dl className="apply-email-meta"><dt>To</dt><dd>{plan.primary?.email||'No email listed. Call instead.'}</dd><dt>Subject</dt><dd>{plan.subject}</dd></dl>
    <pre className="apply-email" aria-label="Email message">{plan.body}</pre>
    {blocked&&<p className="apply-missing-inline" role="status">Fill in step 1 to send: {plan.missing.join(' ')}</p>}
    <div className="apply-actions">
     {plan.mailto&&!blocked?<a className="button primary apply-big" href={contactHref(plan.mailto,'mailto:')}>Open in my email app</a>:<button type="button" className="primary apply-big" disabled>Open in my email app</button>}
     <button type="button" className="apply-big" disabled={blocked} onClick={vm.copyEmail}>Copy email</button>
     {plan.tel?(blocked?<button type="button" className="apply-big" disabled>Call {plan.primary?.phone}</button>:<a className="button apply-big" href={contactHref(plan.tel,'tel:')}>Call {plan.primary?.phone}</a>):null}
    </div>
    {vm.copied==='copied'&&<p role="status" className="fine">Copied. Paste it into a new email.</p>}{vm.copied==='failed'&&<p role="status" className="fine">Copying did not work here. Select the message above and copy it.</p>}
    {!plan.mailto&&<p className="fine">No email address is listed for this contact, so use Call or Copy email.</p>}
    <p className="fine">Opening your email app hands this message to your own mail program. Nothing is sent until you press Send there.</p>
    <details className="apply-script"><summary>Phone script</summary><pre>{plan.phoneScript}</pre></details>
   </section>

   <section className="apply-step" aria-labelledby="apply-follow"><h3 id="apply-follow"><span className="apply-num">6</span>If you don’t hear back</h3><p>{plan.followUp}</p>
    <button type="button" className="apply-big" onClick={vm.saveReminder}>Add follow-up reminder</button>{vm.reminder==='saved'&&<p role="status" className="fine">Reminder file saved. Open it to add it to your calendar.</p>}{vm.reminder==='failed'&&<p role="status" className="fine">The reminder file could not be saved here.</p>}
    <p className="fine">The reminder has the study, its public contacts and this plan only. None of your details are in it.</p></section>
  </>}
  <button type="button" className="quiet apply-end" onClick={vm.end}>End and clear my details</button></>}
 </section>;
}
