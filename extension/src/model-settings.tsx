import React,{useEffect} from 'react';
import {failureCopy} from './failures';
import {useLocalModels} from './local-models';
import type {LocalModelInfo,LocalModelsResult} from '../shared/apply-contract.mjs';
import type {ModelProvider} from './ui-prefs';
/** Decimal gigabytes, as Ollama lists model sizes. */
export const gigabytes=(bytes:number)=>{const v=bytes/1e9;return v>=10?String(Math.round(v)):v.toFixed(1).replace(/\.0$/,'')};
const memory=(bytes:number)=>String(Math.max(1,Math.round(bytes/1024**3)));
function modelLabel(m:LocalModelInfo){return [m.name,`${gigabytes(m.sizeBytes)} GB`,m.recommended?'Recommended':'',m.fit==='too_large'?'may not fit in memory':m.fit==='tight'?'tight fit':''].filter(Boolean).join(' · ')}
function machineLine(r:LocalModelsResult){const m=r.machine;return [m.cpu,`${memory(m.memoryBytes)} GB ${m.unifiedMemory?'unified memory':'memory'}`,m.freeDiskBytes!==null?`${gigabytes(m.freeDiskBytes)} GB free disk`:'',r.ollama.version?`Ollama ${r.ollama.version}`:''].filter(Boolean).join(' · ')}
/** Settings → Model provider. Stores only the provider enum and a validated model name (see ui-prefs.ts); never health data. */
export function ModelProviderSettings({provider,localModel,setProvider,setLocalModel,ended=false}:{provider:ModelProvider;localModel:string|null;setProvider:(value:ModelProvider)=>void;setLocalModel:(value:string|null)=>void;ended?:boolean}){
 const {store,state}=useLocalModels(),result=state.status==='ready'?state.result:undefined,recommendation=result?.recommendation;
 const installed=result?.ollama.status==='ready'?result.models:[],known=!localModel||installed.some(m=>m.name===localModel);
 useEffect(()=>{if(provider==='local'&&!ended&&store&&state.status==='idle')store.check()},[provider,ended,store,state.status]);
 // A first choice of Local model starts with the recommended installed model; a saved choice is never replaced.
 useEffect(()=>{if(provider==='local'&&!localModel&&recommendation?.kind==='installed')setLocalModel(recommendation.model)},[provider,localModel,recommendation]);
 return <section className="model-settings" aria-labelledby="model-settings-heading">
  <h3 id="model-settings-heading">Study brief model</h3>
  <label>Model provider<select value={provider} disabled={ended} onChange={event=>setProvider(event.target.value as ModelProvider)}><option value="openai">OpenAI (default)</option><option value="local">Local model (Ollama on this device)</option></select></label>
  {provider==='openai'?<p className="fine">Study briefs use the OpenAI Agents and Decisions APIs and send only the selected public study records.</p>:<>
   <p className="fine">Runs on this device through Ollama. Nothing is sent to OpenAI. Quality and speed depend on this computer and the model; a brief can take a minute or two.</p>
   {state.status==='checking'&&<p role="status">Checking Ollama on this device…</p>}
   {state.status==='unavailable'&&<p role="status">Open a ClinicalTrials.gov study or results page to check the local models on this device.</p>}
   {state.status==='failed'&&<p role="status" className="notice">{failureCopy(state.code)} <code>{state.code}</code></p>}
   {result&&<p className="fine">This device: {machineLine(result)}</p>}
   {result?.ollama.status==='not_installed'&&<p role="status" className="notice">Ollama is not installed on this device. <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">Download Ollama</a>, then choose Check again.</p>}
   {result?.ollama.status==='runtime_failed'&&<p role="status" className="notice">Ollama is installed, but Treatable could not start its own private Ollama runtime.</p>}
   {result?.ollama.status==='ready'&&(installed.length?<label>Local model<select value={localModel??''} disabled={ended} onChange={event=>setLocalModel(event.target.value||null)}>{!localModel&&<option value="">Choose a model</option>}{!known&&localModel&&<option value={localModel}>{localModel} · not installed</option>}{installed.map(m=><option key={m.name} value={m.name}>{modelLabel(m)}</option>)}</select></label>:<p role="status">No installed model can write text.</p>)}
   {!known&&localModel&&result?.ollama.status==='ready'&&<p role="status" className="notice">{localModel} is not installed on this device. Choose another model.</p>}
   {recommendation&&(recommendation.kind==='installed'?<p className="fine"><strong>Recommended:</strong> {recommendation.reason}</p>:recommendation.kind==='pull'?<div className="model-pull"><p>{recommendation.reason}</p><p>Run this in Terminal (Treatable never downloads models): <code>{recommendation.command}</code></p></div>:<p className="notice">{recommendation.reason}</p>)}
   {store&&state.status!=='checking'&&<button type="button" className="quiet" disabled={ended} onClick={()=>store.check()}>Check again</button>}
  </>}
 </section>;
}
