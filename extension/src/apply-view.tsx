import React from 'react';
import {PRIVATE_TEXT_FIELD} from './patient-form';
import {failureCopy} from './failures';
import {trialUrl} from './core';
import {siteLocationStatus} from './local-distance';
import {APPLY_FLAG_TEMPLATES,APPLY_PRESCREEN_TEMPLATES,APPLY_QUESTION_TEMPLATES,STUDY_BRIEF_ROUTES,type PublicStudyBrief,type StudySourceItem,type ApplySite,type StudyBriefResult,type StudyBriefRoute,type StudyBriefTraceBody,type StudyBriefDecisionTrace,type LocalTraceBody} from '../shared/apply-contract.mjs';
import type {ApplyController,StudyStep} from './use-apply';
import {hasDetails,useYourDetails} from './your-details';
import {contactHref,validEmail,type PlanContact,type CallContact} from './apply-plan';
import {formatCountdown} from './session-lease';
const STATUS_LABELS={accepting:'Recruiting',opening_soon:'Not yet recruiting',invitation:'By invitation only',not_accepting:'Not recruiting',unverified:'Status not confirmed'} as const;
const statusLabel=(s?:string|null)=>STATUS_LABELS[siteLocationStatus(s??undefined)];
const siteName=(s:ApplySite)=>s.facility||'Study site';
const siteWhere=(s:ApplySite)=>[s.city,s.state,s.country&&!/^united states/i.test(s.country)?s.country:''].filter(Boolean).join(', ');
const miles=(d?:number)=>d===undefined?'':d<1?'less than 1 mile away':`about ${Math.round(d)} miles away`;
const ACTIVITY_LABELS:Record<string,string>={'agent.request':'Agent request sent','agent.session.created':'Agent session started','agent.tool.request':'Reading selected public study evidence','agent.tool.result':'Public study evidence returned','agent.complete':'Agent review completed','agent.cleanup.deleted':'OpenAI confirmed it deleted the session','agent.cleanup.failed':'Deleting the session at OpenAI could not be confirmed','decisions.request':'Question classification requested','decisions.complete':'Question classification completed','local.runtime.start':'Starting the private Ollama runtime on this device','local.runtime.ready':'Local runtime and model ready','local.brief.request':'Local model reading the public study excerpts','local.brief.complete':'Local study summary completed','local.routing.request':'Local model sorting the questions','local.routing.complete':'Local question sorting completed',cancelled:'Analysis cancelled',failed:'Analysis failed'};
const MOCK_LABELS:Record<string,string>={'agent.cleanup.deleted':'The mocked session was deleted','agent.cleanup.failed':'Deleting the mocked session could not be confirmed'};
const context=(item?:StudySourceItem)=>item?(item as StudySourceItem&{context?:string}).context:undefined;
const ROUTE_LABELS={answered_by_record:'Answered in the record',ask_patient:'Your input may help',ask_coordinator:'Ask the study team'};
/** Percentages in tenths that add up to exactly 100 (largest remainder), so the three displayed shares always sum to 100%. */
export function probabilityShares(p:Record<StudyBriefRoute,number>):Record<StudyBriefRoute,string>{
 const total=STUDY_BRIEF_ROUTES.reduce((n,r)=>n+p[r],0)||1,raw=STUDY_BRIEF_ROUTES.map(r=>p[r]/total*1000),tenths=raw.map(Math.floor);
 let left=1000-tenths.reduce((n,v)=>n+v,0);
 for(const i of raw.map((v,i)=>i).sort((a,b)=>(raw[b]-Math.floor(raw[b]))-(raw[a]-Math.floor(raw[a]))||a-b)){if(left<=0)break;tenths[i]++;left--}
 return Object.fromEntries(STUDY_BRIEF_ROUTES.map((r,i)=>[r,`${(tenths[i]/10).toFixed(1)}%`])) as Record<StudyBriefRoute,string>;
}
const utf8Length=(text:string)=>new TextEncoder().encode(text).length;
/** One exact request body: collapsible, scrollable and copyable. A body cut to fit the reply says so; the API call itself was not shortened. */
function ApiBody({title,body,which,note,vm}:{title:string;body:StudyBriefTraceBody;which:'agents'|'decisions';note?:string;vm:ApplyController}){
 const copy=vm.traceCopy?.key===which?vm.traceCopy.state:undefined;
 return <details className="trace-body"><summary>{title} <span className="fine">{`(${body.bytes} bytes)`}</span></summary>
  {note&&<p className="fine">{note}</p>}
  {body.truncated&&<p className="notice" role="note">{`truncated for display (${utf8Length(body.text)} of ${body.bytes} bytes)`}. The request itself was not shortened.</p>}
  <pre className="trace-json" tabIndex={0} role="region" aria-label={title}>{body.text}</pre>
  <div className="apply-actions"><button type="button" onClick={()=>vm.copyTrace(which)}>{body.truncated?'Copy the part shown':'Copy JSON'}</button></div>
  {copy==='copied'&&<p role="status" className="fine">Copied.</p>}{copy==='failed'&&<p role="status" className="fine">Copying was unavailable. Select the text and copy it.</p>}
 </details>;
}
function Decision({d}:{d:StudyBriefDecisionTrace}){
 const shares=probabilityShares(d.probabilities);
 return <li className="trace-decision"><p><span className="study-id">{d.nctId}</span> {APPLY_QUESTION_TEMPLATES[d.questionId]}</p>
  <p>Chosen route: <strong>{ROUTE_LABELS[d.route]}</strong> <code>{d.route}</code> {`· confidence ${Math.round(d.confidence*100)}%`}</p>
  {d.choice!==d.route&&<p className="fine">{`Decisions chose “${ROUTE_LABELS[d.choice]}”, but no cited record text supports that, so it is shown as “${ROUTE_LABELS[d.route]}”.`}</p>}
  <ul className="trace-probabilities" aria-label="Probability of each choice">{STUDY_BRIEF_ROUTES.map(route=><li key={route} className="trace-probability"><span>{ROUTE_LABELS[route]} <code>{route}</code></span><span className="trace-bar" aria-hidden="true"><span style={{width:shares[route]}}/></span><strong>{shares[route]}</strong></li>)}</ul></li>;
}
/** What was sent to OpenAI and what came back, for the generated brief: both request bodies, the Agents tool calls and the Decisions output. */
function ApiTrace({result,vm}:{result:StudyBriefResult;vm:ApplyController}){
 const trace=result.apiTrace;
 return <>{result.mode==='test'&&<p className="notice" role="note"><strong>Test run.</strong> A mocked adapter produced this result; nothing below was sent to OpenAI.</p>}
  <p>{result.toolCalls} {result.toolCalls===1?'lookup':'lookups'} in the public record. {result.agentStatus==='complete'?'The AI read every selected study in the public record.':'The AI review did not complete.'}</p>
  {trace?<>
   <p className="fine">{`These are the request bodies the helper ${result.mode==='test'?'built for a mocked adapter':'sent to OpenAI'}, formatted with line breaks for reading. They hold public study data only. Request headers and credentials are not included and never leave the helper.`}</p>
   <h4>Agents API</h4>
   <ApiBody title="Agents API request body" body={trace.agentsRequest} which="agents" vm={vm} note={result.agentStatus==='failed'?'The Agents call did not complete; see the failure code at the top of this section.':undefined}/>
   <h5>Agents tool calls</h5>
   {trace.toolCalls.length?<ol className="trace-tools">{trace.toolCalls.map((call,i)=><li key={i}><code>{`${call.tool}(${call.arguments?JSON.stringify(call.arguments):'arguments not shown'})`}</code><span>{call.summary}</span></li>)}</ol>:<p>The Agent made no tool calls.</p>}
   <h4>Decisions API</h4>
   <ApiBody title="Decisions API request body" body={trace.decisionsRequest} which="decisions" vm={vm} note={result.decisionStatus==='failed'?'The Decisions call did not complete; see the failure code at the top of this section.':undefined}/>
  </>:<p className="fine">The request bodies were not returned. The installed native helper is older than this extension; reinstall it to see them.</p>}
  <h4>Decisions output</h4>
  {trace?.decisions.length?<ol className="trace-decisions">{trace.decisions.map(d=><Decision key={d.nctId+d.questionId} d={d}/>)}</ol>:<ul>{result.studyPlans.flatMap(p=>p.routes.map(route=><li key={p.nctId+route.questionId}>{p.nctId} · {APPLY_QUESTION_TEMPLATES[route.questionId]} — {ROUTE_LABELS[route.route]}</li>))}</ul>}
  <p>{result.mode==='test'?(result.cleanup==='deleted'?'The mocked session was deleted.':result.cleanup==='failed'?'Deleting the mocked session could not be confirmed.':'No mocked session was started.'):result.cleanup==='deleted'?'OpenAI confirmed it deleted the session.':result.cleanup==='failed'?'Deleting the session at OpenAI could not be confirmed.':'No session was started at OpenAI.'}</p></>;
}
/** Patient-facing line: fixed plain copy only. The raw code is shown only in Technical details at the bottom of the study section.
 * `still` adds the reassurance only where it is true: a plan with questions and a draft is on screen. */
function Failure({code,still}:{code:string;still?:boolean}){const copy=failureCopy(code);return <p className="notice apply-failure" role="status">{copy}{still&&!/still (work|uses)/.test(copy)?' Your questions and email draft still work.':''}</p>}
/** Shown with the summary button and with the gaps the record leaves open. */
const ELIGIBILITY='This record cannot tell you whether you qualify or whether the treatment will help.';
function Contact({c,label}:{c:PlanContact;label:string}){return <div className="apply-contact"><span className="eyebrow">{label}</span><strong>{c.name||'Study contact'}</strong>{c.phone&&<span>Phone: {c.phone}{c.phoneExt?` ext. ${c.phoneExt}`:''}</span>}{c.email&&<span>Email: {c.email}</span>}</div>}
/** Visible number plus a Call link (tel:) and a Copy number fallback, only when the record's number checks out. */
function CallNumber({entry,where,vm}:{entry:CallContact;where:string;vm:ApplyController}){
 const c=entry.contact,d=entry.dial,name=c.name||'Study contact',key=`${where}:${c.id}`,copy=vm.numberCopy?.key===key?vm.numberCopy.state:undefined;
 return <div className="apply-call"><span><strong>{name}</strong> <span className="fine">{c.source==='site'?'Site contact':'Central contact'}</span></span><span>Phone: {c.phone}{c.phoneExt?` ext. ${c.phoneExt}`:''}</span>
  {d&&contactHref(d.href,'tel:')?<><span className="fine">Dials {d.display}</span><div className="apply-actions"><a className="button primary" href={contactHref(d.href,'tel:')} aria-label={`Call ${name} at ${d.display}`}>Call</a><button type="button" onClick={()=>vm.copyNumber(key,d.display)}>Copy number</button></div>{copy==='copied'&&<p role="status" className="fine">Number copied.</p>}{copy==='failed'&&<p role="status" className="fine">Copying was unavailable. Select the number and copy it.</p>}</>:<span className="fine">No Call button: this could not be checked as a complete phone number. Check it in the official record.</span>}
 </div>;
}
const CALL_HELP='Call opens your default calling app, such as the Phone app, FaceTime or iPhone calling on a Mac, Phone Link on Windows, or your mobile dialer. Nothing dials until you confirm there. If nothing happens, your computer may have no calling app set up; use Copy number instead.';
function Evidence({items,nctId}:{items:StudySourceItem[];nctId:string}){return <details className="brief-evidence"><summary>Read the supporting record text</summary>{items.map(item=><blockquote key={item.id}><p>{item.text}</p><a href={trialUrl('https://clinicaltrials.gov/study/'+nctId)} target="_blank" rel="noopener noreferrer">{item.label} · official record</a></blockquote>)}</details>}
const PURPOSE_FIELD='protocolSection.descriptionModule.briefSummary';
const isPurpose=(item:StudySourceItem)=>item.category==='overview'&&item.field===PURPOSE_FIELD;
/** Text longer than this is shown in a scrollable region so it stays complete without pushing the rest of the page away. */
const LONG_PASSAGE_CHARS=900;
interface Passage{key:string;label:string;text:string;items:StudySourceItem[]}
/** A long study purpose is cut into consecutive excerpts for the model; it is read here as the single passage it came from. */
function passages(items:StudySourceItem[],purpose?:string):Passage[]{
 const out:Passage[]=[];
 for(const item of items){const last=out[out.length-1];if(isPurpose(item)&&last&&isPurpose(last.items[0])){last.items.push(item);last.text=`${last.text} ${item.text}`;continue}out.push({key:item.id,label:item.label,text:item.text,items:[item]})}
 return out.map(p=>isPurpose(p.items[0])&&purpose&&purpose.length>=p.text.length?{...p,text:purpose}:p);
}
function Prose({text,label}:{text:string;label:string}){return text.length>LONG_PASSAGE_CHARS?<div className="brief-scroll" tabIndex={0} role="region" aria-label={`${label}, full text`}>{text}</div>:<p>{text}</p>}
function StudyFacts({brief,purpose}:{brief:PublicStudyBrief;purpose?:string}){
 const claims=(brief.claims??[]).filter(c=>!c.evidenceIds.some(id=>context(brief.items.find(i=>i.id===id)!)==='registry_milestone')),registry=brief.items.filter(i=>context(i)==='registry_milestone'),items=brief.items.filter(i=>['timeline','design','overview'].includes(i.category)&&context(i)!=='registry_milestone'),text=items.map(i=>i.text).join(' ');
 return <><section className="apply-step" aria-labelledby="brief-participation"><h3 id="brief-participation">What participation could involve</h3>
  {claims.length?<ol className="brief-timeline">{claims.map(claim=><li key={claim.id}><p>{claim.text}</p><Evidence nctId={brief.nctId} items={claim.evidenceIds.flatMap(id=>{const item=brief.items.find(i=>i.id===id);return item?[item]:[]})}/></li>)}</ol>:<><p className="fine">Official record excerpts. Get the study summary again to organize them and prioritize questions.</p>{passages(items,purpose).slice(0,4).map(p=><article key={p.key} className="brief-fact"><h4>{p.label}</h4><Prose text={p.text} label={p.label}/><Evidence nctId={brief.nctId} items={p.items}/></article>)}{!items.length&&<p>No participation schedule or design description was available in the fetched record.</p>}</>}
  {/randomiz/i.test(text)&&<p className="brief-definition"><strong>Randomized</strong> means group assignment happens by chance. <a href="https://clinicaltrials.gov/study-basics" target="_blank" rel="noopener noreferrer">Study terminology</a></p>}
  {/sham|placebo/i.test(text)&&<p className="brief-definition"><strong>A comparison group is described.</strong> Ask what the sham or placebo involves and whether active treatment is guaranteed.</p>}
  {/cross.?over/i.test(text)&&<p className="brief-definition"><strong>The record mentions crossover.</strong> Ask whether it is optional, when it may happen, and what conditions apply.</p>}
  {registry.length>0&&<details className="brief-registry"><summary>Registry milestones — not your visit schedule</summary>{registry.map(i=><p key={i.id}><strong>{i.label}:</strong> {i.text}</p>)}</details>}
 </section><details className="apply-step brief-unknown"><summary>Not in the record</summary><ul>{brief.unknowns.length?brief.unknowns.map((item,i)=><li key={i}>{item}</li>):<li>No additional gaps were flagged. Confirm current requirements and screening with the study team.</li>}</ul><p className="fine">{ELIGIBILITY}</p></details></>;
}
const STEP_LABELS={brief:'Step 1 · study summary (local equivalent of the Agents step)',routing:'Step 2 · sorting the questions (local equivalent of Decisions)'} as const;
const seconds=(ms:number)=>`${(ms/1000).toFixed(ms<10000?1:0)} s`;
function TraceText({label,body}:{label:string;body:LocalTraceBody}){return <details className="trace-body"><summary>{label} <span className="fine">{`(${body.bytes} bytes)`}</span></summary>{body.truncated&&<p className="notice" role="note">{`truncated for display (${utf8Length(body.text)} of ${body.bytes} bytes)`}. Only this display copy is shortened.</p>}<pre className="trace-json" tabIndex={0} role="region" aria-label={label}>{body.text}</pre></details>}
/** Local runs: which model ran, each local request body and output, and any confidence the model reported. Nothing here went to OpenAI. */
function LocalTrace({result}:{result:StudyBriefResult}){
 const local=result.local!;
 return <><p><strong>Local model: {local.model} via Ollama{local.version?` ${local.version}`:''} on this device; nothing was sent to OpenAI.</strong> No provider session was created and no API key was used.</p>
  {local.steps.length?<ol className="brief-local-steps">{local.steps.map(step=><li key={step.step}><p>{STEP_LABELS[step.step]} — {step.status==='complete'?'validated':'failed validation or did not finish'} · {seconds(step.durationMs)}</p><TraceText label="Local request body" body={step.request}/>{step.output?<TraceText label="Model output" body={step.output}/>:<p className="fine">No model output was received.</p>}</li>)}</ol>:<p>The local model did not run.</p>}
  {local.confidences.length>0&&<><h4>Confidence reported by the model</h4><p className="fine">Model-reported, not calibrated. These are not probabilities and do not change the routes.</p><ul>{local.confidences.map(c=><li key={c.nctId+c.questionId}>{c.nctId} · {APPLY_QUESTION_TEMPLATES[c.questionId]} — {c.confidence.toFixed(2)}</li>)}</ul></>}
 </>;
}
/** Last five minutes of the session: a small countdown, then Keep working for the final minute. The status line is always present while this shows,
 * so a screen reader announces the one-minute warning and the confirmation. The ticking time itself is a timer role that is not announced. */
function SessionClock({vm}:{vm:ApplyController}){
 const c=vm.countdown;
 if(!c&&!vm.sessionExtended)return null;
 const note=c?.keepWorking?'Your session ends in about a minute. Choose Keep working to keep your drafts and details.':c?'':'Session extended by 30 minutes.';
 return <div className="apply-session">
  {c&&<p className="fine">Session ends in <strong role="timer" aria-live="off">{formatCountdown(c.secondsLeft)}</strong></p>}
  <p role="status" className="fine">{note}</p>
  {c?.keepWorking&&<div className="apply-actions"><button type="button" className="primary" onClick={vm.keepWorking}>Keep working</button></div>}
 </div>;
}
/** The three study steps, in order. The heading of the step on screen is the section heading, so focus lands on it. */
const FLOW:readonly {id:StudyStep;label:string;title:string}[]=[{id:'understand',label:'Understand',title:'Understand this study'},{id:'contact',label:'Contact',title:'Questions and contact'},{id:'email',label:'Email',title:'Write your email'}];
export function ApplyView({vm}:{vm:ApplyController}){
 const section=React.useRef<HTMLElement>(null),heading=React.useRef<HTMLHeadingElement>(null),you=React.useRef<HTMLElement>(null),attempted=React.useRef(false),moveFocus=React.useRef(false);
 const local=vm.engine?.provider==='local',localName=vm.engine?.localModel??'(not chosen yet)',resultLocal=vm.result?.mode==='local';
 const {details}=useYourDetails(),plan=vm.plan,record=vm.record,draft=vm.draft,f=PRIVATE_TEXT_FIELD,studyPlan=vm.result?.studyPlans.find(p=>p.nctId===vm.nctId),questions=(studyPlan?.prioritizedQuestionIds.length?studyPlan.prioritizedQuestionIds:plan?.questionIds??[]).slice(0,3);
 const step=FLOW.some(s=>s.id===vm.step)?vm.step:'understand',at=FLOW.findIndex(s=>s.id===step);
 /* Once a generation has been tried, the excerpts and unknowns stay, so a retry does not hide and re-show them. */
 if(vm.result||vm.agentCode)attempted.current=true;
 const still=!!(plan&&draft&&questions.length>0);
 /* Raw failure codes are shown only in Technical details at the bottom of this section. */
 const codes=[...new Set([vm.recordCode,vm.agentCode,...(vm.result?.failureCodes??[])].filter((c):c is string=>!!c))],generated=!!(vm.analysisInput||vm.activity.length>0||vm.result||vm.agentCode);
 /* A step change started from this section moves focus to the new step's heading. Focus held anywhere else, such as a dialog, stays there. */
 const go=(next:StudyStep)=>{if(next===step)return;const active=typeof document==='undefined'?null:document.activeElement,root=section.current;moveFocus.current=!active||active===document.body||typeof root?.contains!=='function'||root.contains(active);vm.goStep(next)};
 React.useEffect(()=>{if(!moveFocus.current)return;moveFocus.current=false;heading.current?.focus()},[step]);
 /* A missing item moves to the field that fixes it. */
 const fixMissing=(item:string)=>{const field=/name/i.test(item)?'name':/phone/i.test(item)?'phone':'email';(you.current?.querySelector(`[data-apply-field="${field}"]`) as HTMLElement|null)?.focus()};
 const selectedExtra=draft?.to?record?.centralContacts.concat(...record.sites.map(s=>s.contacts)).find(c=>c.email===draft.to):undefined;
 const contacts=plan?[...(plan.primary?[plan.primary]:[]),...plan.backups,...(selectedExtra?[{...selectedExtra,source:'site' as const}]:[])].filter((c,i,all)=>c.email&&validEmail(c.email)&&all.findIndex(a=>a.email===c.email)===i):[];
 /* Earlier steps keep a one-line summary in the step list, where they can be reopened. */
 const summaries:Record<StudyStep,string>={understand:vm.result?.agentStatus==='complete'?'Summary ready':'Standard questions',contact:plan?.primary?plan.primary.name||'Study contact':'No listed contact',email:''};
 const steps=record&&plan&&<ol className="study-steps" aria-label="Steps">{FLOW.map((s,i)=><li key={s.id} className={i===at?'is-current':i<at?'is-done':undefined}><button type="button" aria-current={i===at?'step':undefined} onClick={()=>go(s.id)}><span className="step-name"><span className="step-num" aria-hidden="true">{i+1}</span>{s.label}</span>{i<at&&summaries[s.id]&&<span className="step-summary"><span className="sr-only">Done: </span>{summaries[s.id]}</span>}</button></li>)}</ol>;
 const understand=()=>record&&plan&&<>
  <div className="apply-study"><h3>{record.title}</h3><span className="study-id">{record.nctId}</span><p className="fine">{statusLabel(record.overallStatus)}{trialUrl(record.sourceUrl)&&<> · <a href={trialUrl(record.sourceUrl)} target="_blank" rel="noopener noreferrer">Open the official record</a></>}</p></div>
  <section className="brief-generate" aria-label="Get a study summary">{local?<p>The local model <strong>{localName}</strong> via Ollama on this device reads this study’s public record and prepares your questions and a study summary. Nothing you type is included, and nothing is sent to OpenAI.</p>:<p>Treatable sends this study’s public record to OpenAI. OpenAI prepares your questions and a study summary. Nothing you type is included.</p>}<button type="button" className={vm.result?'apply-big':'primary apply-big'} data-treatable-guide="brief" disabled={vm.agentBusy||!vm.selectedIds.length} onClick={vm.requestReview}>{vm.agentBusy?'Getting your study summary…':vm.result?'Get the study summary again':'Get my study summary'}</button><p className="fine">{ELIGIBILITY}</p>{vm.agentCode&&<Failure code={vm.agentCode} still={still}/>}
  {vm.result&&<div role="status" className="brief-status"><p>{resultLocal?<>Local model {vm.result.local?.model}: study summary {vm.result.agentStatus==='complete'?'ready':'unavailable'} · questions {vm.result.decisionStatus==='complete'?'sorted':'not sorted'} · nothing sent to OpenAI</>:<>{vm.result.agentStatus==='complete'?'Study summary ready':'Study summary unavailable'} · {vm.result.decisionStatus==='complete'?'Questions sorted':'Question sorting unavailable'}</>}.</p>{vm.result.failureCodes.map(code=><Failure key={code} code={code} still={still}/>)}</div>}
  </section>
  {attempted.current&&!vm.agentBusy&&<div className="apply-actions"><button type="button" className="primary apply-big" onClick={()=>go('contact')}>Next: who to contact <span aria-hidden="true">→</span></button></div>}
 </>;
 const contact=()=>record&&plan&&<>
  {vm.brief&&attempted.current&&<StudyFacts brief={vm.brief} purpose={vm.purpose}/>}
  <section className="apply-step" aria-labelledby="brief-questions"><h3 id="brief-questions">Three questions to start with</h3><p className="fine">{studyPlan?'Prioritized from the public record.':'Standard questions while a study summary is unavailable.'}</p><ol className="apply-questions">{questions.map(id=>{const route=studyPlan?.routes.find(r=>r.questionId===id),items=route?.evidenceIds.flatMap(key=>{const item=vm.brief?.items.find(i=>i.id===key);return item?[item]:[]})??[];return <li key={id}><p>{APPLY_QUESTION_TEMPLATES[id]}</p>{route&&<span className="brief-route">{ROUTE_LABELS[route.route]}</span>}{items.length>0&&<Evidence nctId={vm.nctId} items={items}/>}</li>})}</ol></section>
  <section className="apply-step" aria-labelledby="apply-who"><h3 id="apply-who">Who to contact</h3>
  {plan.site?<div className="apply-site"><strong>{siteName(plan.site)}</strong><span>{siteWhere(plan.site)}</span><span className="fine">{statusLabel(plan.site.status)}{plan.distanceMiles!==undefined?` · ${miles(plan.distanceMiles)} (straight line)`:''}</span></div>:<p>Choose a study site, or use the study’s central contact.</p>}
  {plan.primary?<Contact c={plan.primary} label={plan.primary.source==='site'?'Listed site contact':'Listed central contact'}/>:<p className="notice">No email or phone contact was available in the fetched record. Open the official record to check for another contact route.</p>}
  {record.sitesTruncated&&<p className="fine">Only the first {record.sites.length} listed sites are included here. Check the official record for other locations.</p>}{plan.siteOptions.length>1&&<label>Study site<select value={vm.siteId??''} onChange={e=>vm.chooseSite(e.target.value||undefined)}><option value="">Nearest site, or the central contact</option>{plan.siteOptions.map(o=><option key={o.site.id} value={o.site.id}>{siteName(o.site)} · {siteWhere(o.site)}{o.distanceMiles!==undefined?` · ${miles(o.distanceMiles)}`:''}</option>)}</select></label>}
  {plan.flagIds.length>0&&<div className="apply-flags"><ul>{plan.flagIds.map(id=><li key={id}>{APPLY_FLAG_TEMPLATES[id]}</li>)}</ul></div>}
  <p className="fine">These contacts come from the official record and have not been checked. If an address looks wrong, confirm it before you share details.</p></section>
  <div className="apply-actions"><button type="button" className="primary apply-big" onClick={()=>go('email')}>Write my email <span aria-hidden="true">→</span></button></div>
 </>;
 const email=()=>record&&plan&&<>
  <section className="apply-step apply-local-details" ref={you} aria-labelledby="apply-you"><h3 id="apply-you" data-treatable-guide="personalize">Personalize your email <span className="optional">Optional · local only</span></h3><p>Add your name and contact details to this study’s draft. A name typed here takes priority over Settings → Your details.</p><form autoComplete="off" onSubmit={e=>e.preventDefault()}><label>Your name<input {...f} data-apply-field="name" value={vm.patient.name} maxLength={120} onChange={e=>vm.edit('name',e.target.value)}/></label><div className="field-grid"><label>Phone<input {...f} data-apply-field="phone" type="tel" inputMode="tel" value={vm.patient.phone} maxLength={40} onChange={e=>vm.edit('phone',e.target.value)}/></label><label>Reply email<input {...f} data-apply-field="email" type="email" inputMode="email" value={vm.patient.email} maxLength={254} onChange={e=>vm.edit('email',e.target.value)}/></label></div>
  <details className="apply-more"><summary>More details (optional)</summary><label>Best times to reach you<input {...f} value={vm.patient.bestTimes} maxLength={120} onChange={e=>vm.edit('bestTimes',e.target.value)}/></label><label>ZIP code <span className="optional">Used locally to find a nearby site; excluded from your email</span><input {...f} inputMode="numeric" value={vm.patient.zip} maxLength={10} onChange={e=>vm.edit('zip',e.target.value)}/></label>{vm.zipNote&&<p role="status" className="fine">{vm.zipNote}</p>}<fieldset className="apply-answers"><legend>Background you choose to include</legend>{plan.answerIds.map(id=><label key={id}>{APPLY_PRESCREEN_TEMPLATES[id]}<input {...f} value={vm.patient.answers[id]??''} maxLength={160} onChange={e=>vm.answer(id,e.target.value)}/></label>)}</fieldset></details></form></section>
  {draft&&<section className="apply-step" aria-labelledby="apply-send" data-treatable-guide="draft"><h3 id="apply-send">Your email draft</h3><p>Review the recipient and edit the message.</p><label>To<select value={draft.to} onChange={e=>vm.editDraft('to',e.target.value)}><option value="">Choose a listed contact</option>{contacts.map(c=><option key={c.id} value={c.email!}>{c.name||'Study contact'} · {c.email}</option>)}</select></label><label>Subject<input {...f} value={draft.subject} maxLength={2200} onChange={e=>vm.editDraft('subject',e.target.value)}/></label><label>Message<textarea {...f} className="apply-email" rows={14} maxLength={16000} value={draft.body} onChange={e=>vm.editDraft('body',e.target.value)}/></label>{vm.draftEdited&&<p className="fine">Your edited draft is kept as written. New summary results and personal-detail changes do not overwrite it.</p>}{vm.draftOutdated&&<p role="status" className="notice">Study questions, site, or local details changed after you edited this draft. Review it, or update it from the current details.</p>}{vm.draftEdited&&<button type="button" className="quiet" onClick={vm.updateDraft}>Update draft from current details</button>}{vm.draftIssue&&<p role="status" className="fine">{vm.draftIssue}</p>}
  {vm.draftHeaders&&<p role="status" className="notice">The message starts with To or Subject lines. They are left out when you open or copy the message, because the recipient and subject have their own fields.</p>}
  {plan.missing.length>0&&<div className="notice apply-missing"><p><strong>Before you send</strong></p><ul>{plan.missing.map(item=><li key={item}><button type="button" className="quiet missing-fix" onClick={()=>fixMissing(item)}>{item}</button></li>)}</ul></div>}
  <div className="apply-actions" data-treatable-guide="send">{vm.handoff?.mode==='copy'?<button type="button" className="primary apply-big" onClick={vm.copyAndOpenEmail}>Copy message and open email app</button>:vm.mailto?<a className="button primary apply-big" href={contactHref(vm.mailto,'mailto:')}>Open in my email app</a>:<button type="button" className="primary apply-big" disabled>Open in my email app</button>}{(vm.handoff?.mode!=='copy'||vm.copied==='handoff-failed')&&<button type="button" className="apply-big" onClick={vm.copyMessage}>Copy message</button>}</div>
  <p className="apply-send-note"><strong>You press Send yourself.</strong></p>
  {vm.mailto&&<p className="fine">Some email apps, notably Outlook on Windows, may shorten very long links, so check the whole message before you send it.</p>}{vm.copied==='message'&&<p role="status">Copied the message only. Paste it into the message area of a new email, and put the recipient and subject in their own fields.</p>}{vm.copied==='handoff'&&<p role="status">Message copied: paste it into the email body.</p>}{vm.copied==='handoff-failed'&&<p role="status">Copying was unavailable, so your email app was not opened. Use Copy message, or select the message above and copy it. Then open your email app, put the recipient and subject in their own fields, and paste the message into the email body.</p>}{vm.copied==='failed'&&<p role="status">Copying was unavailable. Select the message and copy it.</p>}<p className="fine">Opening a draft puts the recipient, subject and message into your email app. Treatable has not sent anything. Once copied or opened, these details are outside Treatable.</p></section>}
  <details className="apply-step apply-after"><summary>After you send <span className="optional">Call script, follow-up and reminder</span></summary>{contactHref(plan.tel,'tel:')&&<div className="apply-actions"><a className="button apply-big" href={contactHref(plan.tel,'tel:')}>Call the listed contact</a></div>}<h4>Numbers to call</h4>{plan.callContacts.length?<>{plan.callContacts.map(entry=><CallNumber key={entry.contact.id} entry={entry} where="script" vm={vm}/>)}<p className="fine">{CALL_HELP}</p></>:<p className="fine">No phone number is listed for this site or the central study contacts. Check the official record.</p>}<label>Your call script<textarea {...f} className="apply-email apply-script" rows={12} maxLength={16000} value={vm.callScript} onChange={e=>vm.editCallScript(e.target.value)}/></label>{vm.callScriptOutdated&&<p role="status" className="notice">Study questions, site, or your details changed after you edited this script.</p>}{vm.callScriptEdited&&<button type="button" className="quiet" onClick={vm.resetCallScript}>Update script from current details</button>}
  <h4>Follow-up</h4><p>{plan.followUp}</p>{plan.followUpCall&&<CallNumber entry={plan.followUpCall} where="follow-up" vm={vm}/>}<label>Follow-up message<textarea {...f} className="apply-email apply-script" rows={10} maxLength={16000} value={vm.followUpMessage} onChange={e=>vm.editFollowUp(e.target.value)}/></label>{vm.followUpOutdated&&<p role="status" className="notice">The study site or your details changed after you edited this message.</p>}<div className="apply-actions"><button type="button" onClick={vm.copyFollowUp}>Copy follow-up message</button>{vm.followUpEdited&&<button type="button" className="quiet" onClick={vm.resetFollowUp}>Update message from current details</button>}</div>{vm.copied==='follow-up'&&<p role="status">Follow-up message copied.</p>}<button type="button" onClick={vm.saveReminder}>Download follow-up reminder</button>{vm.reminder==='saved'&&<p role="status">Reminder file downloaded. Open it to add it to your calendar.</p>}<p className="fine">The reminder contains public study/contact information, not your personal answers.</p></details>
 </>;
 return <section ref={section} className="apply-section" aria-labelledby="apply-heading">
 <SessionClock vm={vm}/>
 {vm.phase!=='ended'&&steps}
 <div className="section-intro" data-treatable-guide={step==='understand'?'understand':undefined}><h2 id="apply-heading" ref={heading} tabIndex={-1}>{FLOW[at].title}</h2></div>
 {vm.phase==='ended'?<p role="status" className="notice">Session ended. This section's email drafts, call scripts and the details typed here were cleared. Reopen Treatable to start again.{hasDetails(details)?' Your details in Settings stay until you clear them or end the Treatable session.':''}</p>:<>
 {(vm.phase==='connecting'||vm.phase==='loading')&&<p role="status" className="notice">Loading the official study information…</p>}
 {!vm.candidates.length&&vm.phase!=='connecting'&&<p className="notice">Open a study on ClinicalTrials.gov to get its summary and draft an email.</p>}
 {vm.recordCode&&<Failure code={vm.recordCode}/>}
 {step==='understand'?understand():step==='contact'?contact():email()}
 {(codes.length>0||generated)&&<details className="brief-how"><summary>Technical details</summary>{codes.length>0&&<p className="fine">Failure code{codes.length>1?'s':''}: {codes.map((code,i)=><React.Fragment key={code}>{i>0&&', '}<code>{code}</code></React.Fragment>)}</p>}{generated&&<><h4>How this was generated</h4><p>Requested task: read the selected official study records, organize participation facts with their sources, and sort and prioritize questions. Personal details and email drafts are excluded.{local&&!vm.result?` Running on this device with ${localName} via Ollama; nothing is sent to OpenAI.`:''}</p>{vm.analysisInput&&<><h4>Public input</h4><p>Study IDs: {vm.analysisInput.nctIds.join(', ')}</p><p className="fine">Source item IDs: {vm.analysisInput.sourceItemIds.join(', ')}</p></>}{vm.activity.length>0?<ol>{vm.activity.map((event,i)=><li key={i}>{(vm.result?.mode==='test'?MOCK_LABELS[event.stage]:undefined)??ACTIVITY_LABELS[event.stage]??event.stage}{event.nctId?` · ${event.nctId}`:''}</li>)}</ol>:<p>No streamed activity events were received.</p>}{vm.result&&(resultLocal?<><LocalTrace result={vm.result}/><h4>Question routes</h4><ul>{vm.result.studyPlans.flatMap(p=>p.routes.map(route=><li key={p.nctId+route.questionId}>{p.nctId} · {APPLY_QUESTION_TEMPLATES[route.questionId]} — {ROUTE_LABELS[route.route]}</li>))}</ul></>:<ApiTrace result={vm.result} vm={vm}/>)}</>}</details>}
 </>}
 </section>;
}
