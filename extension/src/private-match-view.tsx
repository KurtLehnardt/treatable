import React,{useEffect,useRef} from 'react';
import {compatibilityBuckets} from './live-compatibility';
import {PrivacyNotice} from './privacy-notice';
import {PRIVATE_TEXT_FIELD} from './patient-form';
import type {SiteDistance} from './local-distance';
import {AGE_BANDS, US_STATES, type AgeBand} from '../shared/real-contract.mjs';
import {QUESTION_TEMPLATES, CAUTION_TEMPLATES, type DemoTrace} from '../shared/demo-contract.mjs';
import type {PrivateMatchingController} from './use-private-matching';

const ageLabel = (value: string) => value === '90_plus' ? '90+' : value.replaceAll('_', '–');
const sexLabels: Record<string,string> = {female: 'Female', male: 'Male', other: 'Other', prefer_not_to_say: 'Prefer not to say'};
const sexLabel = (value?: string) => sexLabels[value || ''] || 'Unknown / not shared';
const activityLabels: Record<string, string> = {
  'decisions.request': 'Sending the confirmed relevance request',
  'decisions.complete': 'Relevance scores received and validated',
  'agent.request': 'Starting the confirmed study review',
  'agent.session.created': 'Secure study-review session started',
  'agent.tool.request': 'Requesting the selected public study evidence',
  'agent.tool.result': 'Public study evidence received',
  'agent.complete': 'Study-team questions received and validated',
  'agent.cleanup.deleted': 'Provider session deletion acknowledged',
  'agent.cleanup.failed': 'Provider session deletion could not be confirmed',
  cancelled: 'Analysis stopped',
  failed: 'Analysis could not finish'
};
function Activity({trace, busy, prepared}: {trace: DemoTrace[]; busy: boolean; prepared: PrivateMatchingController['prepared']}) {
  const decisionsModel = prepared?.preview.decisionsRequest?.model;
  const agentConfig = prepared?.preview.agentsRequest?.agent;
  const agentModel = agentConfig && typeof agentConfig === 'object' && 'model' in agentConfig ? agentConfig.model : undefined;
  return <details className="surface analysis-activity">
    <summary>Analysis activity{trace.length > 0 && <span className="activity-count">{trace.length} updates</span>}</summary>
    {trace.length === 0 ? <p className="activity-empty" role="status">{busy ? 'Waiting for the first update from the secure analysis service.' : 'No analysis has run yet. After you confirm a request, its progress and cleanup status appear here.'}</p> : <ol className="activity-list">{trace.map((event, index) => <li key={`${index}-${event.stage}`}>
      <strong>{activityLabels[event.stage] || event.stage}</strong>
      {event.nctId && <span className="fine">Public record {event.nctId}</span>}
      {(event.cleanupCode || event.cleanupAttempts !== undefined || event.httpStatus) && <span className="fine">{[event.cleanupCode, event.cleanupAttempts !== undefined ? `Delete attempts ${event.cleanupAttempts}` : '', event.httpStatus ? `HTTP ${event.httpStatus}` : ''].filter(Boolean).join(' · ')}</span>}
      <code>{event.stage}</code>
    </li>)}</ol>}
    {(typeof decisionsModel === 'string' || typeof agentModel === 'string') && <p className="fine activity-models">{typeof decisionsModel === 'string' && <span>Relevance model: {decisionsModel}</span>}{typeof agentModel === 'string' && <span>Study-review model: {agentModel}</span>}</p>}
  </details>;
}

type MatchingPresentation = PrivateMatchingController & {findMatches?:()=>void|Promise<void>;localLocation?:{zip:string;radiusMiles:number};editLocalLocation?:(value:{zip:string;radiusMiles:number})=>void;localDistance?:SiteDistance};
export function PrivateMatchingView({vm, inline = false}: {vm: MatchingPresentation; inline?: boolean}) {
  const Root = inline ? 'section' : 'main';
  const Heading = inline ? 'h3' : 'h1';
  const SectionHeading = inline ? 'h4' : 'h2';
  const buckets = vm.catalog && vm.packet.ageBand ? compatibilityBuckets(vm.catalog, vm.packet) : {};
  const p = vm.packet, disabled = !vm.ready || vm.busy, localLocation=vm.localLocation||{zip:'',radiusMiles:0};
  const applyButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(vm.score?.mode==='live'&&!vm.applied){applyButton.current?.focus({preventScroll:true});applyButton.current?.scrollIntoView?.({block:'nearest',behavior:'auto'})}},[vm.score,vm.applied]);
  const titleFor = (id: string) => vm.catalog?.studies.find(study => study.id === id)?.title || 'Study title unavailable';
  const previewPacket = vm.prepared?.preview.packet;
  return <Root className={`private-match${inline ? ' is-inline' : ''}`} aria-label="Match the studies on this page">
    <header className="matching-header"><div><span className="eyebrow">Match the current results</span><Heading>Find my matches</Heading><p>Compare the {vm.total} studies currently visible on this page with the details you choose to share. To search for different studies, use Search ClinicalTrials.gov above.</p></div><button type="button" className="quiet" onClick={vm.end}>End matching</button></header>
    {vm.score?.mode==='live'&&<section className="scores-ready" role="status"><div><strong>{vm.applied?'Matches are on the website.':'Scores ready.'}</strong><p>{vm.applied?'The visible cards have been reordered and marked. Use Restore original order or End page matching to undo.':'Apply the scores to rearrange the visible website cards and show their match percentages.'}</p></div>{!vm.applied&&<button type="button" className="primary" ref={applyButton} disabled={disabled} onClick={()=>void vm.apply()}>Apply matches to this page</button>}</section>}
    {vm.ended ? <p role="status" className="notice">Matching ended. Start matching again to begin with a blank form.</p> : <>
      <ol className="matching-steps" aria-label="Matching steps"><li aria-current={!vm.prepared && !vm.score ? 'step' : undefined}><span>1</span>Choose details</li><li aria-current={vm.prepared && !vm.score ? 'step' : undefined}><span>2</span>Review and confirm</li><li aria-current={vm.score ? 'step' : undefined}><span>3</span>View matches</li></ol>
      <p className="fine">Your details stay in this extension area until you confirm the minimized request. Website search filters go to ClinicalTrials.gov and browser history; this matching form has no exact age, ZIP or notes fields.</p>
      {vm.error && <p role="alert" className="message error">{vm.error}</p>}
      <PrivacyNotice mode="live" key={vm.epoch} accepted={vm.accepted} disabled={disabled} onAccept={vm.accept}/>
      <section className="surface"><SectionHeading>Choose what you will share.</SectionHeading><fieldset disabled={disabled}>
        <label>Age band<select autoComplete="off" value={p.ageBand} onChange={event => vm.edit({...p, ageBand: event.target.value as AgeBand})}><option value="">Choose an age band</option>{AGE_BANDS.map(value => <option key={value} value={value}>{ageLabel(value)}</option>)}</select></label>
        <div className="field-grid"><label>State · optional<select autoComplete="off" value={p.state || ''} onChange={event => {const next = {...p}; if (event.target.value) next.state = event.target.value; else delete next.state; vm.edit(next);}}><option value="">Do not share</option>{US_STATES.map(value => <option key={value}>{value}</option>)}</select></label><label>Sex for study criteria · optional<select autoComplete="off" value={p.sex || ''} onChange={event => {const next = {...p}; if (event.target.value) next.sex = event.target.value as typeof next.sex; else delete next.sex; vm.edit(next);}}><option value="">Unknown / not shared</option>{['female', 'male', 'other', 'prefer_not_to_say'].map(value => <option key={value} value={value}>{sexLabel(value)}</option>)}</select></label></div>
        {vm.editLocalLocation&&<section className="local-distance-fields" aria-label="Local distance preferences"><h4>Distance · stays local</h4><div className="field-grid"><label>US ZIP · optional<input {...PRIVATE_TEXT_FIELD} value={localLocation.zip} maxLength={10} inputMode="numeric" placeholder="Five-digit ZIP" onChange={event=>vm.editLocalLocation?.({...localLocation,zip:event.target.value})}/></label><label>Travel distance<select autoComplete="off" value={localLocation.radiusMiles} onChange={event=>vm.editLocalLocation?.({...localLocation,radiusMiles:Number(event.target.value)})}><option value={0}>No distance preference</option>{[25,50,100,250,500].map(value=><option key={value} value={value}>{value} miles</option>)}</select></label></div><p className="fine">ZIP and coordinates stay in extension memory and are never sent to OpenAI. Without a ZIP, distance uses your search location when available. Distances are approximate straight-line miles, not driving distances. Missing location data stays unknown. Applying distance choices can hide or reorder website cards; that change is visible to the website, while the ZIP and coordinates stay in the extension.</p></section>}
        <h4>Conditions or symptoms</h4><p className="fine">Choose 1–6 labels from these public study records. These are study labels, not a diagnosis. Nothing is selected for you.</p>
        <div className="condition-options">{vm.catalog?.conditions.map(condition => <label className="check" key={condition.id}><input type="checkbox" checked={p.conditionIds.includes(condition.id)} disabled={!p.conditionIds.includes(condition.id) && p.conditionIds.length >= 6} onChange={event => vm.edit({...p, conditionIds: event.target.checked ? [...p.conditionIds, condition.id] : p.conditionIds.filter(id => id !== condition.id)})}/><span>{condition.label}</span></label>)}</div>
        {vm.catalog?.conditionsTruncated && <p className="fine">Only the first 120 public labels fit this preview.</p>}
        <details className="included-studies"><summary>Studies included in matching · {p.selectedNctIds.length}</summary>{vm.catalog?.studies.map(study => <article key={study.id}><strong>{study.title}</strong><span className="study-id">{study.id}</span><p className="fine">{study.status.replaceAll('_', ' ')} · Fetched {new Date(study.fetchedAt).toLocaleTimeString()}{study.missingFields.length ? ' · Some public facts are missing' : ''}{study.truncatedFields.length ? ' · Long evidence was bounded' : ''}</p></article>)}</details>
        <details className="optional-questions"><summary>Optional · choose studies for questions</summary><h4>Questions to ask the study team</h4><p id="agent-selection-help" className="fine">Choose up to 2 studies for questions. OpenAI Agents reviews their public evidence independently of the relevance scores. Select at least one study.</p>
        <div className="study-choice-list">{vm.catalog?.studies.map(study => <label className="check study-choice" key={study.id}><input type="checkbox" aria-describedby="agent-selection-help" checked={p.agentNctIds.includes(study.id)} disabled={!p.agentNctIds.includes(study.id) && p.agentNctIds.length >= 2} onChange={event => vm.edit({...p, agentNctIds: event.target.checked ? [...p.agentNctIds, study.id] : p.agentNctIds.filter(id => id !== study.id)})}/><span className="study-choice-copy"><strong title={study.title}>{study.title}</strong><span className="study-id">{study.id}</span></span></label>)}</div>
        </details><button type="button" className="primary full-width" disabled={!vm.accepted || disabled || !!vm.findMatches&&vm.used.includes('score')} onClick={() => void (vm.findMatches?vm.findMatches():vm.prepare())}>{vm.findMatches?vm.used.includes('score')?'Matches scored':'Find my matches':'Review what I’ll share'}</button><p className="fine">{vm.findMatches?'Review the exact minimized packet in a secure confirmation before analysis. No request is sent until you approve.':'This prepares a preview. It does not send an OpenAI request.'}</p>
      </fieldset></section>
      {vm.prepared && previewPacket && <section className="surface request-review"><SectionHeading>Review what you will share.</SectionHeading>
        <dl className="packet-summary"><div><dt>Age band</dt><dd>{ageLabel(previewPacket.ageBand)}</dd></div><div><dt>State</dt><dd>{previewPacket.state || 'Not shared'}</dd></div><div><dt>Sex</dt><dd>{sexLabel(previewPacket.sex)}</dd></div></dl>
        <p><strong>Conditions or symptoms:</strong> {vm.catalog?.conditions.filter(condition => previewPacket.conditionIds.includes(condition.id)).map(condition => condition.label).join(', ')}.</p>
        <p><strong>Relevance scoring:</strong> {previewPacket.selectedNctIds.length} public studies using OpenAI Decisions.</p><p><strong>Study-team questions:</strong> {previewPacket.agentNctIds.map(titleFor).join('; ')}.</p>
        <p className="fine">Credentials and local binding identifiers are excluded. This preview expires at {new Date(vm.prepared.expiresAt).toLocaleTimeString()}. Changing details discards consent and results.</p>
        <details><summary>Exact requests and public tool input</summary><pre className="private-preview">{JSON.stringify(vm.prepared.preview, null, 2)}</pre><p className="fine">Preview digest: <code>{vm.prepared.digest}</code></p></details>
        {!vm.findMatches&&<label className="check"><input type="checkbox" disabled={vm.busy} checked={vm.confirmed} onChange={event => vm.confirm(event.target.checked)}/><span>I confirm sending this exact minimized packet to OpenAI for the operation I choose.</span></label>}
        <p className="fine">A compact secure confirmation appears before anything is sent.</p>
        <div className="model-actions">{!vm.findMatches&&<button type="button" className="primary" disabled={disabled || !vm.confirmed || vm.used.includes('score')} onClick={() => void vm.run('score')}>Find my matches</button>}<button type="button" disabled={disabled || !vm.findMatches&&!vm.confirmed || vm.used.includes('agent')} onClick={() => void vm.run('agent')}>Get study questions</button></div>
        <button type="button" className="quiet" disabled={vm.busy} onClick={() => vm.invalidate()}>Discard preview</button>
      </section>}
      {vm.busy && <div className="analysis-progress"><p role="status">Preparing your request or waiting for secure confirmation…</p><button type="button" onClick={vm.stop}>Stop and discard analysis</button></div>}
      {vm.score && <section className="surface"><SectionHeading>Relevance on this page</SectionHeading><p>{vm.score.mode === 'live' ? 'Live OpenAI Decisions result' : 'Test adapter result · cannot apply'}. A normalized relevance index, not eligibility or enrollment probability.</p><ul className="match-results">{vm.score.scores.map(result => <li key={result.nctId}><strong>{titleFor(result.nctId)}</strong><span className="study-id">{result.nctId}</span><p><span className="relevance-index">{Math.round(result.index)}% match</span> · {buckets[result.nctId] === 'unlikely' ? 'Known structured-criteria mismatch' : 'Eligibility unknown'}</p></li>)}</ul><p className="fine">Apply reorders the visible website cards and adds private score frames. Card order is visible to the website. Only derived NCT IDs and scores remain in extension memory for up to five minutes; use End page matching to clear them.</p></section>}
      {vm.agent && <section className="surface"><SectionHeading>Questions for the study team</SectionHeading><p>{vm.agent.mode === 'live' ? 'Live OpenAI Agents result' : 'Test adapter result'}. Independent of relevance scores.</p>{vm.agent.comparisons.map(comparison => <article key={comparison.nctId}><h4>{titleFor(comparison.nctId)}</h4><span className="study-id">{comparison.nctId}</span><ul>{comparison.questionIds.map(id => <li key={id}>{QUESTION_TEMPLATES[id]}</li>)}</ul></article>)}<ul>{vm.agent.cautionIds.map(id => <li key={id}>{id === 'snapshot' ? 'Fetched public records may change. Confirm recruitment and study details with the study team.' : CAUTION_TEMPLATES[id]}</li>)}</ul><p className="fine">Provider cleanup: {vm.agent.cleanup === 'deleted' ? 'deletion acknowledged; physical cleanup is asynchronous' : 'deletion unconfirmed; provider state may remain'}.</p></section>}
      <Activity trace={vm.trace} busy={vm.busy} prepared={vm.prepared}/>
    </>}
  </Root>;
}
