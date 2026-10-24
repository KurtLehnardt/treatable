import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StudySchema, profileFromForm, nearestSite, sourceExcerpts, safeWebUrl, type Study, type PatientProfile, type ZipData, type PageSource} from './core';
import {restrictStorageAccess, loadState, saveState, clearState, loadSettings, saveSettings, loadApiKey, saveApiKey, clearApiKey, DEFAULT_SETTINGS, type Settings, type ProviderChoice} from './storage';
import {LocalModelClient, LatestRun, type NativeStatus} from './native';
import {redact} from './openai';
import {CONFIG} from './config';
import {evaluateGate, resolveProvider, GATE_NAME, type GateResult} from './hipaaGate';
import {runPipeline, visibleAt, countLine, emptyMessage, type PipelineResult, type ScoredStudy, type MinMatch} from './pipeline';
import {TIER_LABELS, type ProviderChecklistResult, type ScoringProvider} from './scoring';
import {PhiNotice, BAA_ATTESTATION_LABEL} from './notices';
import './panel.css';

const emptyForm = {condition: '', notes: '', age: '', sex: 'prefer_not_to_say', zip: '', radius: '100'};
/** Synthetic demo profile. Not a real patient. */
const SYNTHETIC_EXAMPLE = {condition: 'thoracic degenerative disc disease', notes: '', age: '40', sex: 'male', zip: '', radius: 'anywhere'};
const client = new LocalModelClient(chrome.runtime);
const UNREFINED_LABEL = 'Unrefined: keyword screening only';

type ChecklistState = {state: 'running'} | {state: 'done'; result: ProviderChecklistResult} | {state: 'error'; message: string};

function errorText(e: unknown, fallback: string): string {
  return redact(e instanceof Error ? e.message : fallback);
}

function App() {
  const [form, setForm] = useState(emptyForm);
  const [studies, setStudies] = useState<Study[]>([]);
  const [zips, setZips] = useState<ZipData>({zips: {}});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [profile, setProfile] = useState<PatientProfile>();
  const [source, setSource] = useState<PageSource>();
  const [saved, setSaved] = useState<string[]>([]);
  const [remember, setRemember] = useState(false);
  const [tab, setTab] = useState<'results' | 'saved'>('results');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [apiKey, setApiKey] = useState('');
  const [baaAttested, setBaaAttested] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [native, setNative] = useState<NativeStatus>({ok: false, models: [], message: 'Local helper not checked yet.'});
  const [nativeBusy, setNativeBusy] = useState(false);
  const [result, setResult] = useState<PipelineResult>();
  const [running, setRunning] = useState(false);
  const [checklists, setChecklists] = useState<Record<string, ChecklistState>>({});
  const [synthetic, setSynthetic] = useState(false);
  const [gate, setGate] = useState<GateResult>();
  const [gateBusy, setGateBusy] = useState(false);
  const gateGeneration = useRef(0);
  const active = useRef<AbortController>();
  const runs = useRef(new LatestRun());
  const searchToken = useRef(0);
  const storageQueue = useRef(Promise.resolve());
  const queue = (fn: () => Promise<void>) => { storageQueue.current = storageQueue.current.catch(() => {}).then(fn); return storageQueue.current; };
  const cancel = () => { active.current?.abort(); active.current = undefined; runs.current.cancel(); setRunning(false); };

  async function checkNative(): Promise<NativeStatus> {
    setNativeBusy(true);
    try {
      const status = await client.status();
      setNative(status);
      return status;
    } catch {
      const status = {ok: false, models: [], message: 'Local helper not detected. See extension/NATIVE_SETUP.md. Keyword screening still works.'};
      setNative(status);
      return status;
    } finally { setNativeBusy(false); }
  }

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await restrictStorageAccess(chrome.storage.session, chrome.storage.local);
        const [records, postal, stored, prefs, key] = await Promise.all([
          fetch(chrome.runtime.getURL('data/studies.json')).then(r => r.json()),
          fetch(chrome.runtime.getURL('data/us-zip-centroids.json')).then(r => r.json()),
          loadState(chrome.storage.session, chrome.storage.local),
          loadSettings(chrome.storage.local),
          loadApiKey(chrome.storage.session, chrome.storage.local),
        ]);
        if (!mounted) return;
        setStudies(records.map((v: unknown) => StudySchema.parse(v)));
        setZips(postal);
        setSaved(stored.state.savedIds);
        setRemember(stored.remember);
        setApiKey(key.key);
        setBaaAttested(key.baaAttested);
        // Phase default (config.ts): OpenAI in the demo phase, Local LLM in the HIPAA phase.
        const nextSettings = prefs.provider ? prefs : {...prefs, provider: CONFIG.defaultProvider};
        if (nextSettings.provider === 'local' || CONFIG.hipaaGateEnabled) void checkNative();
        if (!mounted) return;
        setSettings(nextSettings);
        const p = stored.state.profile;
        if (p) setForm({condition: p.primaryDiagnoses.join(', '), notes: p.symptomNarrative, age: String(p.ageYears), sex: p.sex, zip: p.location.zip || '', radius: String(p.travelRadiusMiles)});
        setReady(true);
      } catch {
        if (mounted) setError('Offline data or extension storage could not be loaded. Reload the extension.');
      }
    })();
    return () => { mounted = false; active.current?.abort(); };
  }, []);

  useEffect(() => {
    // An admin policy change invalidates any earlier gate result.
    const onChanged = (_changes: unknown, area: string) => { if (area === 'managed') { gateGeneration.current++; setGate(undefined); } };
    chrome.storage.onChanged?.addListener(onChanged);
    return () => chrome.storage.onChanged?.removeListener(onChanged);
  }, []);

  function resetGate() { gateGeneration.current++; setGate(undefined); }

  function updateSettings(patch: Partial<Settings>) {
    setSettings(prev => {
      const next = {...prev, ...patch};
      void queue(() => saveSettings(chrome.storage.local, next)).catch(() => setError('Could not save settings.'));
      return next;
    });
  }

  function edit(key: keyof typeof emptyForm, value: string) {
    cancel();
    setForm(v => ({...v, [key]: value}));
    setSynthetic(false);
    setResult(undefined);
    setChecklists({});
    setSource(undefined);
    setNotice('Search again to apply your changes.');
    setError('');
  }

  /** Build the provider for the current settings, or explain why results stay unrefined. */
  function makeProvider(gateNow = gate): {provider?: ScoringProvider; reason?: string} {
    const model = native.ok ? (settings.localModel && native.models?.some(m => m.name === settings.localModel) ? settings.localModel : native.models?.[0]?.name) : undefined;
    return resolveProvider({config: CONFIG, choice: settings.provider, consented: settings.openaiConsent, apiKey, attested: baaAttested, gate: gateNow, local: {generator: client, model}});
  }

  /** Phase 2 only. Cached in memory for this panel session; never written to storage. */
  async function checkGate(): Promise<GateResult> {
    const generation = ++gateGeneration.current;
    if (!settings.openaiConsent) {
      const locked: GateResult = {open: false, reason: 'Accept the OpenAI consent screen before the organization check runs.'};
      setGate(locked);
      return locked;
    }
    setGateBusy(true);
    try {
      let policyRaw: unknown = undefined;
      try { policyRaw = await chrome.storage.managed?.get(null); } catch { policyRaw = undefined; }
      const result = await evaluateGate({policyRaw, attested: baaAttested, apiKey});
      // Drop a stale result if the key, attestation, or policy changed while checking.
      if (generation !== gateGeneration.current) return {open: false, reason: 'Settings changed during the organization check. Check again.'};
      setGate(result);
      return result;
    } finally { if (generation === gateGeneration.current) setGateBusy(false); }
  }

  async function runChecklist(provider: ScoringProvider, item: ScoredStudy, token: number, signal: AbortSignal) {
    const id = item.screen.study.id;
    setChecklists(prev => ({...prev, [id]: {state: 'running'}}));
    try {
      const out = await provider.checklist(item.evidence, signal);
      if (runs.current.isCurrent(token)) setChecklists(prev => ({...prev, [id]: {state: 'done', result: out}}));
    } catch (e) {
      if (runs.current.isCurrent(token) && !signal.aborted) setChecklists(prev => ({...prev, [id]: {state: 'error', message: `Checklist task failed: ${errorText(e, 'unknown error')}`}}));
    }
  }

  async function search(p: PatientProfile, forced?: Study[]) {
    cancel();
    const token = runs.current.start();
    searchToken.current = token;
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    setResult(undefined);
    setChecklists({});
    const gateNow = CONFIG.hipaaGateEnabled && settings.provider === 'openai' ? (gate?.open ? gate : await checkGate()) : gate;
    if (!runs.current.isCurrent(token)) return;
    const {provider, reason} = makeProvider(gateNow);
    setNotice(provider ? `Scoring the shortlist with ${provider.label}…` : 'Screening locally…');
    try {
      const out = await runPipeline({studies, profile: p, provider, forced, signal: controller.signal, unrefinedReason: reason});
      if (!runs.current.isCurrent(token)) return;
      setResult(out);
      setNotice(out.mode === 'refined' ? `Scored by ${out.providerLabel}. Scores never change when you change Minimum match.` : '');
      setRunning(false);
      // Agent task: auto-run for the top Strong/Possible OpenAI results; Local runs on click (slow).
      if (out.mode === 'refined' && provider?.id === 'openai') {
        const top = out.studies.filter(s => s.refined && s.breakdown.final >= 65).slice(0, 3);
        await Promise.all(top.map(item => runChecklist(provider, item, token, controller.signal)));
      }
    } catch (e) {
      if (runs.current.isCurrent(token) && !controller.signal.aborted) { setError(errorText(e, 'Search failed.')); setRunning(false); }
    }
  }

  function applySearch(values = form) {
    try {
      const p = profileFromForm(values, zips);
      setProfile(p);
      setSource(undefined);
      setError('');
      setTab('results');
      void queue(() => saveState(chrome.storage.session, chrome.storage.local, {profile: p, savedIds: saved}, remember)).catch(() => setError('Could not save this session. Your results remain visible.'));
      void search(p);
      return p;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check your details.');
      return undefined;
    }
  }

  function loadSynthetic() {
    cancel();
    setForm(SYNTHETIC_EXAMPLE);
    setSynthetic(true);
    applySearch(SYNTHETIC_EXAMPLE);
  }

  async function analyzePage() {
    const p = profile || applySearch();
    if (!p) return;
    cancel();
    const token = runs.current.start();
    setError('');
    setNotice('Reading the current page…');
    try {
      const reply = await chrome.runtime.sendMessage({kind: 'readPage'});
      if (!runs.current.isCurrent(token)) return;
      if (!reply?.ok) throw new Error(reply?.error || 'Page could not be read');
      const s = reply.source as PageSource;
      setSource(s);
      const record = s.nctId ? studies.find(v => v.id === s.nctId) : undefined;
      if (record) await search(p, [record]);
      else { setResult(undefined); setNotice('Page text captured. This source has no verified structured record in the offline snapshot. Eligibility remains unknown.'); }
      setTab('results');
    } catch (e) {
      if (runs.current.isCurrent(token)) { setError(e instanceof Error ? e.message : 'Page could not be read'); setNotice(''); }
    }
  }

  function toggleSave(id: string) {
    const next = saved.includes(id) ? saved.filter(x => x !== id) : [...saved, id].slice(-200);
    setSaved(next);
    void queue(() => saveState(chrome.storage.session, chrome.storage.local, {profile, savedIds: next}, remember)).catch(() => setError('Could not save this session.'));
  }

  async function storeKey() {
    const key = keyDraft.trim();
    if (!key) { setError('Paste an OpenAI API key first.'); return; }
    try {
      await queue(() => saveApiKey(chrome.storage.session, chrome.storage.local, key, settings.rememberKey, baaAttested));
      setApiKey(key);
      resetGate();
      setKeyDraft('');
      setNotice(settings.rememberKey ? 'OpenAI key saved on this computer.' : 'OpenAI key saved for this browser session.');
    } catch { setError('Could not save the key.'); }
  }

  async function forgetKey() {
    try { await queue(() => clearApiKey(chrome.storage.session, chrome.storage.local)); setApiKey(''); setBaaAttested(false); resetGate(); setNotice('OpenAI key and BAA attestation removed.'); } catch { setError('Could not remove the key.'); }
  }

  async function clearEverything() {
    cancel();
    setForm(emptyForm); setProfile(undefined); setResult(undefined); setChecklists({}); setSource(undefined); setSaved([]); setRemember(false); setApiKey(''); setBaaAttested(false); setSynthetic(false);
    setError(''); setNotice('Patient details, saved studies, results, and the OpenAI key were cleared.');
    void chrome.runtime.sendMessage({kind: 'nativeDisconnect'}).catch(() => {});
    try { await queue(async () => { await clearState(chrome.storage.session, chrome.storage.local); await clearApiKey(chrome.storage.session, chrome.storage.local); }); } catch { setError('Storage could not be cleared. Retry before closing the panel.'); }
  }

  const providerForChecklist = (): ScoringProvider | undefined => makeProvider().provider;
  const min = settings.minMatch as MinMatch;
  const visible = result ? visibleAt(result, min) : undefined;
  const cloud = settings.provider === 'openai' && settings.openaiConsent && (!CONFIG.hipaaGateEnabled || gate?.open === true);

  function renderScoring(item: ScoredStudy) {
    const b = item.breakdown, s = item.screen, pr = item.providerResult;
    return <details className="how"><summary>How this was scored</summary>
      <p><strong>Provider:</strong> {item.refined ? `${result?.providerLabel} · model ${pr?.model}` : `${UNREFINED_LABEL} (no model call for this study)`}</p>
      {item.note && <p className="warning">{item.note}</p>}
      <p><strong>Stage 1, local retrieval:</strong> BM25 {s.bm25.toFixed(2)}. Distinctive terms in title/conditions: {s.distinctiveHits.join(', ')}.</p>
      <p><strong>Stage 2, deterministic screen:</strong> spine region you: {s.region.patient}; study: {s.region.study.join('/') || 'none named'} ({s.region.status.replace('_', ' ')}). {s.screen.criteria.map(c => `${c.label} ${c.status}`).join('; ')}.</p>
      {pr && <>
        <p><strong>Stage 3, request sent ({result?.providerId === 'openai' ? 'Decisions API' : 'local helper'}):</strong></p>
        <pre>{JSON.stringify(pr.requestShown, null, 2)}</pre>
        <p><strong>Decision returned:</strong></p>
        <ul>
          <li>condition_match: <b>{pr.answers.condition_match.choice}</b> · confidence {pr.answers.condition_match.confidence.toFixed(2)} · {pr.answers.condition_match.probabilities.map(p => `${p.value} ${p.probability.toFixed(2)}`).join(', ')}</li>
          <li>site_match: <b>{pr.answers.site_match.choice}</b> · confidence {pr.answers.site_match.confidence.toFixed(2)} · {pr.answers.site_match.probabilities.map(p => `${p.value} ${p.probability.toFixed(2)}`).join(', ')}</li>
          <li>fit_score: <b>{pr.answers.fit_score.score}/100</b> (level {pr.answers.fit_score.level.toFixed(2)} of 4) · confidence {pr.answers.fit_score.confidence.toFixed(2)} · {pr.answers.fit_score.probabilities.map(p => `${p.label} ${p.probability.toFixed(2)}`).join(', ')}</li>
          <li>age_sex_compatible: probability <b>{pr.answers.age_sex_compatible.probability.toFixed(2)}</b></li>
        </ul>
      </>}
      <p><strong>Final:</strong> {b.final} = min({[b.modelScore !== undefined ? `model ${b.modelScore}` : `keyword ${s.keywordScore}`, ...b.caps.map(c => `${c.source} cap ${c.value}`)].join(', ')}). Models can lower a cap, never lift past one.</p>
      {b.caps.length > 0 && <ul>{b.caps.map((c, i) => <li key={i}>{c.reason}</li>)}</ul>}
    </details>;
  }

  function renderChecklist(item: ScoredStudy) {
    const id = item.screen.study.id, state = checklists[id];
    const provider = result?.mode === 'refined' ? providerForChecklist() : undefined;
    return <div className="agent">
      <div className="section-heading"><h3>Eligibility checklist {result?.providerId === 'openai' ? '(Agents API task)' : result?.providerId === 'local' ? '(local model task)' : ''}</h3>
        {provider && state?.state !== 'running' && state?.state !== 'done' && <button className="text-button" onClick={() => void runChecklist(provider, item, searchToken.current, active.current?.signal ?? new AbortController().signal)}>Run checklist task</button>}</div>
      {!provider && !state && <p className="fine">Available after refined scoring (OpenAI or Local LLM).</p>}
      {state?.state === 'running' && <p className="matching" role="status">Agent is reading the eligibility criteria…</p>}
      {state?.state === 'error' && <p className="message error" role="alert">{state.message}</p>}
      {state?.state === 'done' && <>
        <table><thead><tr><th>Criterion</th><th>You</th><th>Source line</th></tr></thead><tbody>
          {state.result.checklist.items.map((row, i) => <tr key={i}><td>{row.criterion}</td><td className={`status ${row.patient_status}`}>{row.patient_status.replace('_', ' ')}</td><td><q>{row.source_quote}</q></td></tr>)}
        </tbody></table>
        {state.result.checklist.items.length === 0 && <p className="fine">No verifiable criteria returned.</p>}
        {state.result.checklist.droppedCitations > 0 && <p className="warning">{state.result.checklist.droppedCitations} item(s) dropped: their quoted line was not found in the source text.</p>}
        {state.result.checklist.questions_for_study_team.length > 0 && <><h3>Questions to ask the study team</h3><ul>{state.result.checklist.questions_for_study_team.map((q, i) => <li key={i}>{q}</li>)}</ul></>}
        <details><summary>Agent task sent ({state.result.model}{state.result.sessionId ? (state.result.sessionDeleted ? ', session deleted' : ', session deletion requested but not confirmed') : ''})</summary><p><strong>Instructions:</strong> {state.result.taskShown.instructions}</p><pre>{state.result.taskShown.input}</pre></details>
      </>}
    </div>;
  }

  function renderStudy(item: ScoredStudy) {
    const study = item.screen.study, b = item.breakdown;
    const site = profile ? nearestSite(study, profile) : study.locations[0];
    return <article className="study" key={study.id}>
      <div className="study-top"><span className="eyebrow">{study.id} · {study.studyType === 'EXPANDED_ACCESS' ? 'Expanded access' : study.overallStatus.replaceAll('_', ' ').toLowerCase()}</span><button className="save" aria-label={`${saved.includes(study.id) ? 'Unsave' : 'Save'} ${study.id}`} onClick={() => toggleSave(study.id)}>{saved.includes(study.id) ? 'Saved ✓' : 'Save +'}</button></div>
      <h2><a href={safeWebUrl(study.sourceUrl)} target="_blank" rel="noreferrer">{study.briefTitle}</a></h2>
      <div className="scoreline"><span className={`bucket tier-${b.tier}`}>{b.final} · {TIER_LABELS[b.tier]}</span>{b.tier === 'strong' && <span className="bucket eligible">Matches what you told us</span>}{!item.refined && <span className="bucket unknown">{UNREFINED_LABEL}</span>}{b.lowConfidence && <span className="bucket unknown">Low model confidence</span>}</div>
      <div className="reasons"><div><h3>For</h3><ul>{b.reasonsFor.map((r, i) => <li key={i}>{r}</li>)}</ul></div><div><h3>Against</h3><ul>{b.reasonsAgainst.length ? b.reasonsAgainst.map((r, i) => <li key={i}>{r}</li>) : <li>Nothing found in the evidence. Free-text criteria remain unverified.</li>}</ul></div></div>
      {site && <p className="location">{[site.facility, site.city, site.state].filter(Boolean).join(' · ')}{item.screen.screen.distanceMiles !== undefined ? ` · ~${Math.round(item.screen.screen.distanceMiles)} mi` : ''}</p>}
      {renderChecklist(item)}
      {renderScoring(item)}
      <details><summary>Source eligibility text & contacts</summary><pre>{study.eligibility.criteriaText || 'No criteria text available.'}</pre>{study.contacts.length ? study.contacts.map((c, i) => <p key={i}>{c.name}{c.phone && <> · {c.phone}</>}{c.email && <> · {c.email}</>}</p>) : <p>Contact details not in the snapshot. Open the source record.</p>}</details>
      <p className="fine">Snapshot fetched {study.fetchedAt.slice(0, 10)} · source updated {study.lastUpdatePostDate || 'not stated'}</p>
    </article>;
  }

  const savedRows = studies.filter(s => saved.includes(s.id));

  return <main>
    <header><div className="brand"><span className="mark" aria-hidden="true">t</span><div><h1>Treatable</h1><p>Studies worth asking about.</p></div></div><span className={cloud ? 'private cloud' : 'private'}><span aria-hidden="true">●</span> {cloud ? 'OpenAI scoring on' : settings.provider === 'local' ? 'Local LLM mode' : 'No model requests'}</span></header>
    <div className="privacy-note">{cloud ? 'OpenAI mode: your condition, age band, sex, spine region, and the public study text are sent to OpenAI. ZIP, notes, and saved studies are not included in requests. Not set up for protected health information.' : settings.provider === 'local' ? 'Local LLM mode: requests are sent to the local helper on this device. Browsing a website still makes normal website requests.' : 'In this mode the extension makes no model requests. Browsing a website still makes normal website requests.'}</div>

    {CONFIG.syntheticDemoBanner && <div className="message error demo-banner" role="alert"><strong>Synthetic demo.</strong> Enter synthetic example data only. Do not enter real health details in this build.</div>}
    {CONFIG.hipaaGateEnabled && !settings.firstRunSeen && <section className="consent" aria-label="Welcome"><h3>Local LLM is the default</h3><p>Treatable scores studies with a model through the local helper on this device. OpenAI mode is available only if your organization's IT admin has deployed a Treatable policy that allows it, your API key belongs to an allowed OpenAI organization, and you confirm the BAA attestation. That check is an organization-policy check plus your confirmation; it does not verify a BAA.</p><div className="actions"><button className="primary" onClick={() => updateSettings({firstRunSeen: true})}>Got it</button></div></section>}
    <PhiNotice openaiActive={cloud} baaAttested={baaAttested}/>

    <section className="intake"><div className="section-heading"><h2>Your starting point</h2><button className="text-button" disabled={!ready} onClick={loadSynthetic}>Load synthetic example</button></div>
      {synthetic && <p className="message">Synthetic example: a made-up profile for demonstration, not a real patient.</p>}
      <label>Medical condition<input value={form.condition} onChange={e => edit('condition', e.target.value)} placeholder="e.g. lumbar degenerative disc disease" maxLength={500}/></label>
      <label>Notes for yourself (not included in any request)<textarea value={form.notes} onChange={e => edit('notes', e.target.value)} placeholder="Optional" maxLength={6000} rows={2}/></label>
      <div className="grid"><label>Age<input type="number" min="0" max="120" value={form.age} onChange={e => edit('age', e.target.value)} placeholder="Years"/></label><label>Sex for study criteria<select value={form.sex} onChange={e => edit('sex', e.target.value)}><option value="prefer_not_to_say">Not provided</option><option value="female">Female</option><option value="male">Male</option></select></label></div>
      <div className="grid"><label>US ZIP (optional, not included in any request)<input value={form.zip} onChange={e => edit('zip', e.target.value)} placeholder="83702" maxLength={10} inputMode="numeric"/></label><label>Travel preference<select value={form.radius} onChange={e => edit('radius', e.target.value)}>{['25', '50', '100', '250', 'anywhere'].map(v => <option key={v} value={v}>{v === 'anywhere' ? 'Anywhere' : `${v} miles`}</option>)}</select></label></div>
      <label className="check"><input type="checkbox" checked={remember} onChange={e => { const value = e.target.checked; setRemember(value); void queue(() => saveState(chrome.storage.session, chrome.storage.local, {profile, savedIds: saved}, value)).catch(() => setError('Could not update storage preference.')); }}/>Remember my profile on this computer after Chrome closes</label>
      <div className="actions"><button className="primary" disabled={!ready || running} onClick={() => applySearch()}>{running ? 'Scoring…' : 'Find studies'} <span aria-hidden="true">→</span></button><button disabled={!ready || running} onClick={() => void analyzePage()}>Analyze ClinicalTrials.gov page</button>{running && <button onClick={() => { cancel(); setNotice('Stopped.'); }}>Stop</button>}</div>
    </section>

    <section className="model-box"><div className="section-heading"><h2>Settings: how results are refined</h2></div>
      <div className="provider-choice" role="radiogroup" aria-label="Scoring provider">
        {([['openai', 'OpenAI', 'Decisions API scores each shortlisted study; Agents API builds the checklist. Needs your API key and consent.'], ['local', 'Local LLM', 'Same questions answered by a model through the local helper on this device. Recommended for real health details.'], ['none', 'Send nothing', `Stages 1-2 only. ${UNREFINED_LABEL}; nothing can show as Strong.`]] as Array<[ProviderChoice, string, string]>).map(([value, label, help]) =>
          <label key={value} className="check"><input type="radio" name="provider" checked={settings.provider === value} onChange={() => { cancel(); setResult(undefined); updateSettings({provider: value}); if (value === 'local' && !native.ok) void checkNative(); }}/><span><strong>{label}</strong> · {help}</span></label>)}
        {!settings.provider && <p className="message" role="status">Choose a provider. Until you do, results are unrefined and nothing is sent anywhere.</p>}
      </div>
      {CONFIG.hipaaGateEnabled && settings.provider === 'openai' && <div className={gate?.open ? 'message' : 'message error'} role="status"><strong>{GATE_NAME}:</strong> {gate ? (gate.open ? `Unlocked for ${gate.organizationId}. Requests are pinned to that organization.` : gate.reason) : 'Not checked yet.'} <button className="text-button" disabled={gateBusy || !settings.openaiConsent} onClick={() => void checkGate()}>{gateBusy ? 'Checking…' : 'Check organization gate'}</button></div>}
      {settings.provider === 'openai' && !settings.openaiConsent && <div className="consent" role="dialog" aria-label="OpenAI consent">
        <h3>Before anything is sent to OpenAI</h3>
        <p>If you accept, Treatable sends the following to OpenAI (api.openai.com, Decisions API and Agents API) for each shortlisted study:</p>
        <ul><li>Your condition as typed</li><li>Your age as a five-year band (for example 40-44), not your exact age</li><li>Your sex for study criteria</li><li>Your spine region, if your condition names one</li><li>The public ClinicalTrials.gov text of the study</li></ul>
        <p>Your ZIP code, notes, and saved studies are not included in requests, and Treatable does not ask for your name.</p>
        <p className="warning"><strong>OpenAI mode is not set up for protected health information.</strong> HIPAA use of the OpenAI API requires an executed BAA and Modified Retention on your organization, and endpoint coverage must be confirmed with OpenAI. Without those, use only synthetic or non-identifying information, or use Local LLM mode. You are responsible for confirming your own BAA and endpoint coverage before entering real health details. In Local LLM mode, requests are sent to the local helper on this device.</p>
        <p>Treatable asks OpenAI to delete each agent session after the checklist is read, and shows whether the deletion was confirmed. OpenAI's own data retention terms still apply to your API key's account.</p>
        <label className="check attest"><input type="checkbox" checked={baaAttested} onChange={e => { const value = e.target.checked; setBaaAttested(value); resetGate(); if (apiKey) void queue(() => saveApiKey(chrome.storage.session, chrome.storage.local, apiKey, settings.rememberKey, value)).catch(() => setError('Could not save the attestation.')); }}/>{BAA_ATTESTATION_LABEL}</label>
        <p className="fine">Optional. Leave it unchecked unless it is true. It is stored only with your key and is forgotten when the key is.</p>
        <div className="actions"><button className="primary" onClick={() => updateSettings({openaiConsent: true})}>I understand and accept</button><button onClick={() => updateSettings({provider: 'none'})}>Send nothing instead</button></div>
      </div>}
      {settings.provider === 'openai' && settings.openaiConsent && <>
        <p className="fine">Consent accepted. <button className="text-button" onClick={() => { cancel(); setResult(undefined); updateSettings({openaiConsent: false}); }}>Withdraw consent</button></p>
        <label>OpenAI API key {apiKey ? '(a key is set)' : '(none set)'}<input type="password" autoComplete="off" value={keyDraft} onChange={e => setKeyDraft(e.target.value)} placeholder={apiKey ? 'Paste to replace' : 'sk-…'}/></label>
        <label className="check"><input type="checkbox" checked={settings.rememberKey} onChange={e => { updateSettings({rememberKey: e.target.checked}); if (apiKey) void queue(() => saveApiKey(chrome.storage.session, chrome.storage.local, apiKey, e.target.checked, baaAttested)); }}/>Remember the key on this computer (otherwise kept for this browser session only)</label>
        <label className="check attest"><input type="checkbox" checked={baaAttested} onChange={e => { const value = e.target.checked; setBaaAttested(value); setGate(undefined); if (apiKey) void queue(() => saveApiKey(chrome.storage.session, chrome.storage.local, apiKey, settings.rememberKey, value)).catch(() => setError('Could not save the attestation.')); }}/>{BAA_ATTESTATION_LABEL}</label>
        <div className="actions"><button onClick={() => void storeKey()}>Save key</button>{apiKey && <button onClick={() => void forgetKey()}>Forget key</button>}</div>
      </>}
      {settings.provider === 'local' && <>
        <p className="fine">{native.ok ? `Local helper detected.` : native.message || 'Local helper not detected.'} <button className="text-button" disabled={nativeBusy} onClick={() => void checkNative()}>{nativeBusy ? 'Checking…' : 'Check local helper'}</button></p>
        {native.models?.length > 0 && <label>Local model<select value={settings.localModel || native.models[0].name} onChange={e => updateSettings({localModel: e.target.value})}>{native.models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}</select></label>}
      </>}
      <label>Minimum match<select value={settings.minMatch} onChange={e => updateSettings({minMatch: Number(e.target.value) as MinMatch})}><option value={80}>80% · Strong only</option><option value={65}>65% · Possible and up</option><option value={50}>50% · Weak and up</option></select></label>
      <p className="fine">Changing Minimum match only changes what is shown. Scores do not change.</p>
    </section>

    {error && <div className="message error" role="alert">{error}</div>}
    {notice && <div className="message" role="status">{notice}</div>}
    {result?.failure && <div className="message error" role="alert">{result.failure}</div>}

    {source && <section className="source"><span className="eyebrow">{source.nctId ? 'ClinicalTrials.gov study page' : 'ClinicalTrials.gov · unverified page excerpts'}</span><h2>{source.title}</h2><a href={safeWebUrl(source.url)} target="_blank" rel="noreferrer">Open source ↗</a>{sourceExcerpts(source).map((text, i) => <blockquote key={i}>{text}</blockquote>)}</section>}

    <div className="tabs"><button className={tab === 'results' ? 'selected' : ''} onClick={() => setTab('results')}>Studies {visible ? `(${visible.shown.length})` : ''}</button><button className={tab === 'saved' ? 'selected' : ''} onClick={() => setTab('saved')}>Saved ({saved.length})</button></div>

    <section aria-label="Study results">
      {tab === 'saved' ? (savedRows.length ? savedRows.map(s => <p key={s.id}><a href={safeWebUrl(s.sourceUrl)} target="_blank" rel="noreferrer">{s.id}</a> · {s.briefTitle}</p>) : <div className="empty"><h2>Keep promising studies here</h2><p>Save a study to discuss with your care team.</p></div>) : <>
        {running && <p className="matching" role="status">Scoring…</p>}
        {result && <>
          <p className="countline"><span className={`mode ${result.mode}`}>{result.mode === 'refined' ? `Refined by ${result.providerLabel}` : UNREFINED_LABEL}</span> {countLine(result, min)}</p>
          {visible!.shown.map(renderStudy)}
          {emptyMessage(result, min) && <div className="empty"><span aria-hidden="true">✦</span><h2>{emptyMessage(result, min)}</h2><p>{result.mode === 'unrefined' && min === 80 ? 'Unrefined keyword screening never shows Strong. Lower Minimum match to see keyword candidates, or choose a provider.' : 'This snapshot is incomplete. Ask your care team about other registries.'}</p></div>}
          {result.nearMiss.length > 0 && <details className="near-miss"><summary>Related research you likely don't qualify for ({result.nearMiss.length})</summary>
            {result.nearMiss.map(item => <div className="near" key={item.screen.study.id}><a href={safeWebUrl(item.screen.study.sourceUrl)} target="_blank" rel="noreferrer">{item.screen.study.briefTitle}</a><p>{item.screen.study.id} · score {item.breakdown.final}. {item.breakdown.reasonsAgainst[0] || item.breakdown.caps[0]?.reason || 'Same condition family, weak fit.'}</p><p className="fine">The technology studied here may become relevant to you later. Mention it to your care team.</p>{renderScoring(item)}</div>)}
          </details>}
        </>}
        {!result && !running && <div className="empty"><span aria-hidden="true">✦</span><h2>{profile ? 'Search again to see results' : 'Start with what you know'}</h2><p>Add a condition and age, then search the offline snapshot of {studies.length.toLocaleString('en-US') || '2,000'} studies.</p></div>}
      </>}
    </section>

    <footer><p><strong>Research information, not medical advice.</strong> A match score does not establish eligibility or predict benefit. Confirm details with the study team and your clinician.</p><p>{ready ? `${studies.length.toLocaleString('en-US')} studies in an offline snapshot` : 'Loading offline snapshot…'} · ZIP data © GeoNames, CC BY 4.0</p><button className="text-button danger" disabled={!ready} onClick={() => void clearEverything()}>Clear all patient data and the OpenAI key</button></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
