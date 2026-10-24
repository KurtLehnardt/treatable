import React,{useEffect,useRef,useState} from 'react';
import {sourceExcerpts,safeWebUrl} from './core';
import {StudyResults} from './panel-results';
import type {PanelController} from './use-panel-controller';

type Section='profile'|'search'|'saved';
type IconName='person'|'search'|'bookmark'|'shield'|'arrow'|'check'|'stop';
function Icon({name}:{name:IconName}){
 const paths:Record<IconName,React.ReactNode>={
  person:<><circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></>,
  search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  bookmark:<path d="M6 3h12v18l-6-4-6 4z"/>,
  shield:<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></>,
  arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,
  check:<path d="m5 12 4 4L19 6"/>,
  stop:<rect x="6" y="6" width="12" height="12" rx="2"/>,
 };
 return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

export function PanelB({controller:vm}:{controller:PanelController}){
 const[section,setSection]=useState<Section>('profile');
 const[focusProfile,setFocusProfile]=useState(false);
 const profileHeading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(section==='profile'&&focusProfile){profileHeading.current?.focus();setFocusProfile(false)}},[section,focusProfile]);
 function navigate(next:Section){setSection(next);if(next!=='profile')vm.setTab(next==='saved'?'saved':'results')}
 function search(){if(vm.applySearch())navigate('search')}
 const modelLabel=vm.statusBusy?'Checking model…':vm.busy?'Reading locally…':vm.models.ok&&vm.models.models.length?'Local model available':vm.models.message==='Local explanations need the native helper and an installed model.'?'Model not checked':'Setup required';
 return <main className="version-b">
  <header className="brand-header"><div className="brand"><span className="brand-mark" aria-hidden="true">t</span><div><p className="kicker">Your study companion</p><h1>Treatable</h1></div></div><span className="privacy-badge"><Icon name="shield"/>Local only</span></header>
  <div className="runtime-strip"><div><span className={`status-dot ${vm.models.ok&&vm.models.models.length?'available':''}`} aria-hidden="true"/><span role="status">{modelLabel}</span></div><div className="runtime-actions">{vm.busy&&<button className="stop quiet" aria-label="Stop local explanation" onClick={()=>{vm.cancel();vm.setNotice('Explanation stopped. Source results are preserved.')}}><Icon name="stop"/>Stop</button>}<button className="quiet" disabled={vm.statusBusy} aria-busy={vm.statusBusy} onClick={()=>void vm.checkModels()}>{vm.statusBusy?'Checking…':'Check model'}</button></div></div>
  <nav className="section-nav" aria-label="Panel sections">{([{key:'profile',label:'Profile',icon:'person'},{key:'search',label:'Search',icon:'search'},{key:'saved',label:'Saved',icon:'bookmark'}]as const).map(item=><button key={item.key} aria-current={section===item.key?'page':undefined} onClick={()=>navigate(item.key)}><Icon name={item.icon}/><span>{item.label}</span>{item.key==='saved'&&<span className="count">{vm.saved.length}</span>}</button>)}</nav>
  {vm.error&&<div className="message error" role="alert">{vm.error}{!vm.profile&&section!=='profile'&&<button className="quiet" onClick={()=>{navigate('profile');setFocusProfile(true)}}>Edit profile</button>}</div>}{vm.notice&&<div className="message" role="status">{vm.notice}</div>}
  {section==='profile'&&<section className="profile-section" aria-labelledby="profile-heading"><div className="section-title"><span className="eyebrow">01 · Your starting point</span><h2 id="profile-heading" ref={profileHeading} tabIndex={-1}>Start with what you know.</h2><p>A condition and your age are enough to begin. You can leave the rest blank.</p></div><div className="surface profile-fields">
   <label>Medical condition or symptoms<input value={vm.form.condition} onChange={e=>vm.edit('condition',e.target.value)} placeholder="e.g. fibromyalgia" maxLength={500}/></label>
   <label>Anything else to share with the study team?<span className="optional">Optional</span><textarea value={vm.form.notes} onChange={e=>vm.edit('notes',e.target.value)} placeholder="Symptoms, treatments tried, or questions" maxLength={6000} rows={3}/></label>
   <div className="field-grid"><label>Age<input type="number" min="0" max="120" value={vm.form.age} onChange={e=>vm.edit('age',e.target.value)} placeholder="Years"/></label><label>Sex for study criteria<select value={vm.form.sex} onChange={e=>vm.edit('sex',e.target.value)}><option value="prefer_not_to_say">Not provided</option><option value="female">Female</option><option value="male">Male</option></select></label></div>
   <div className="field-grid"><label>US ZIP<span className="optional">Optional</span><input value={vm.form.zip} onChange={e=>vm.edit('zip',e.target.value)} placeholder="83702" maxLength={10} inputMode="numeric"/></label><label>Travel preference<select value={vm.form.radius} onChange={e=>vm.edit('radius',e.target.value)}>{['25','50','100','250','anywhere'].map(v=><option key={v} value={v}>{v==='anywhere'?'Anywhere':`${v} miles`}</option>)}</select></label></div>
   <div className="storage-choice"><label className="check"><input type="checkbox" checked={vm.remember} onChange={e=>vm.updateRemember(e.target.checked)}/><span>Remember on this computer after Chrome closes</span></label><p className="fine">Otherwise kept for this browser session. Local storage is not encrypted by Treatable.</p></div>
   <button className="primary full-width" disabled={!vm.ready} onClick={search}>Find studies locally<Icon name="arrow"/></button>
  </div><div className="privacy-copy"><Icon name="shield"/><p>Your profile and analysis stay on this computer. No cloud AI or patient-data requests. Browsing a website still makes normal website requests.</p></div></section>}
  {section!=='profile'&&<><section className="results-heading"><div><span className="eyebrow">{section==='saved'?'Keep the conversation going':'02 · Explore your options'}</span><h2>{section==='saved'?'Your saved studies':'Studies worth asking about.'}</h2><p>{section==='saved'?'A shortlist to discuss with your care team.':`${vm.matches.length} results from the offline snapshot. Matching does not establish eligibility.`}</p></div>{section==='search'&&<div className="search-actions"><button className="primary" disabled={!vm.ready} onClick={search}><Icon name="search"/>Search locally</button><button disabled={!vm.ready} onClick={()=>void vm.analyzePage()}>Read ClinicalTrials.gov page</button></div>}</section>
   {section==='search'&&<LocalExplanation controller={vm}/>}
   {section==='search'&&vm.explanation&&<section className="surface explanation"><span className="eyebrow">Local model draft · verify with the team</span><p>{vm.explanation.summary}</p><h3>Questions to ask</h3><ul>{vm.explanation.questions.map((q,i)=><li key={i}>{q}</li>)}</ul>{vm.explanation.cautions.length>0&&<><h3>Still uncertain</h3><ul>{vm.explanation.cautions.map((q,i)=><li key={i}>{q}</li>)}</ul></>}</section>}
   {section==='search'&&vm.source&&<section className="surface source"><span className="eyebrow">{vm.source.nctId?'ClinicalTrials.gov study page':'ClinicalTrials.gov · unverified page excerpts'}</span><h2>{vm.source.title}</h2><a className="source-link" href={safeWebUrl(vm.source.url)} target="_blank" rel="noreferrer">Open source ↗</a>{sourceExcerpts(vm.source).map((text,i)=><blockquote key={i}>{text}</blockquote>)}{!vm.matches.length&&<p>Eligibility, recruitment, locations, and treatment benefit cannot be determined from these excerpts. Ask the study team to confirm.</p>}</section>}
   <StudyResults controller={vm}/>
  </>}
  <footer className="panel-footer"><p><strong>Research information, not medical advice.</strong> Matching does not establish eligibility or predict benefit. Confirm details with the study team and your clinician.</p><p className="snapshot-count">{vm.ready?`${vm.studies.length.toLocaleString()} studies in an offline snapshot`:'Loading offline snapshot…'} · ZIP data © GeoNames, CC BY 4.0</p><button className="danger quiet" disabled={!vm.ready} onClick={()=>void vm.clearEverything()}>Clear all patient data</button></footer>
 </main>;
}
function LocalExplanation({controller:vm}:{controller:PanelController}){
 return <section className="surface model-box" aria-labelledby="model-heading"><div className="model-heading"><Icon name="shield"/><div><h3 id="model-heading">Private local explanation</h3><p className="fine">{vm.models.message||'Runs through the local helper. A model explanation never changes structured checks.'}</p></div></div>{vm.models.models?.length>0?<><label>Installed local model<select value={vm.model} onChange={e=>{vm.cancel();vm.setModel(e.target.value);vm.setExplanation(undefined)}}>{vm.models.models.map(m=><option key={m.name} value={m.name}>{m.name}</option>)}</select></label><div className="model-actions"><button disabled={!vm.profile||(!vm.matches.length&&!vm.source)||vm.busy||!vm.model} onClick={()=>void vm.explain()}>Explain locally</button>{vm.busy&&<button className="stop" onClick={()=>{vm.cancel();vm.setNotice('Explanation stopped. Source results are preserved.')}}><Icon name="stop"/>Stop</button>}</div></>:<p className="fine">Setup: see <code>extension/NATIVE_SETUP.md</code> in the project. Local search works without the helper.</p>}</section>;
}
