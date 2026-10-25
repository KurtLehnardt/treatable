import React from 'react';
import {RankingNotice} from './ranking-notice';
/** The first AI ranking of a browser session: the notice, what this request sends, the exact request behind a disclosure, one choice. */
export function RankConfirm({summary,busy,choose}:{summary:any;busy:boolean;choose:(accepted:boolean)=>void}){
 return <><h1>Turn on AI-matched results?</h1><p>Treatable can sort the studies on this results page so the ones most worth contacting come first, with a match percentage on each card. To do that, it sends a small amount of information to OpenAI.</p>
  <RankingNotice/>
  <h2>This ranking sends</h2><dl><dt>Condition terms</dt><dd>{(summary.conditions as string[]).join(', ')}</dd><dt>Public studies</dt><dd>{summary.studies.length} ClinicalTrials.gov records from this page</dd></dl>
  <ul>{(summary.studies as {nctId:string;title:string}[]).map(s=><li key={s.nctId}>{s.title}<small>{s.nctId}</small></li>)}</ul>
  <details><summary>See what is sent</summary><p className="note">The exact OpenAI Decisions request body for this ranking. Request headers and the API key stay in the Treatable helper.</p><pre>{JSON.stringify(summary.exactPayload,null,2)}</pre></details>
  <p className="note">Any age band and sex you entered under Your details are used only on this device, to move studies that clearly do not fit to the end. If you allow this, later results pages are ranked automatically until you close the browser or turn off AI-matched results. Each ranking sends the same kinds of information.</p>
  <div className="actions"><button disabled={busy} onClick={()=>choose(false)}>Not now</button><button className="primary" disabled={busy} onClick={()=>choose(true)}>Allow for this browser session</button></div></>;
}
