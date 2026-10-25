import React from 'react';
import {PRIVATE_TEXT_FIELD} from './patient-form';
import {hasDetails,useYourDetails,YOUR_DETAILS_LIMITS,type YourDetails} from './your-details';
import {detailConditionTerms} from './rank-merge';
import {AGE_BANDS} from '../shared/real-contract.mjs';
const ageLabel=(v:string)=>v==='90_plus'?'90 or older':v==='under_18'?'Under 18':v.replace('_','–');
/** Settings fields for "Your details". Values go only to the session store; see your-details.ts for the boundaries. */
export function YourDetailsSettings({ended=false}:{ended?:boolean}){
 const {details,store}=useYourDetails(),f=PRIVATE_TEXT_FIELD;if(!store)return null;const terms=detailConditionTerms(details.condition,details.name);
 return <section className="your-details" aria-labelledby="your-details-heading">
  <h3 id="your-details-heading">Your details <span className="optional">Optional · this session only</span></h3>
  <p>These fill only your own email draft, call script and follow-up message on this device, and you can edit those drafts before using them. Your name and anything else you add are never sent anywhere. When AI-matched results are on, the age band and sex help Treatable move studies that clearly do not fit to the end, on this device only, and the short condition terms below are sent for ranking after the confirmation shown before the first ranking. Everything stays in memory until you clear it or end the session, and is not saved on this device.</p>
  {ended&&<p role="status">The session has ended, so your details were cleared. Reopen Treatable to enter them again.</p>}
  <form autoComplete="off" onSubmit={e=>e.preventDefault()}><fieldset disabled={ended}>
   <label>Your name<input {...f} value={details.name} maxLength={YOUR_DETAILS_LIMITS.name} onChange={e=>store.set({name:e.target.value})}/></label>
   <label>Your illness, condition, symptoms or reason for seeking treatment<textarea {...f} rows={4} value={details.condition} maxLength={YOUR_DETAILS_LIMITS.condition} onChange={e=>store.set({condition:e.target.value})}/></label>
   <label>Anything else to include<textarea {...f} rows={3} value={details.extra} maxLength={YOUR_DETAILS_LIMITS.extra} onChange={e=>store.set({extra:e.target.value})}/></label>
   <div className="field-grid"><label>Age band<select autoComplete="off" value={details.ageBand??''} onChange={e=>store.set({ageBand:e.target.value as YourDetails['ageBand']})}><option value="">Not shared</option>{AGE_BANDS.map(v=><option key={v} value={v}>{ageLabel(v)}</option>)}</select></label><label>Sex listed in study criteria<select autoComplete="off" value={details.sex??''} onChange={e=>store.set({sex:e.target.value as YourDetails['sex']})}><option value="">Not shared</option><option value="female">Female</option><option value="male">Male</option></select></label></div>
   <p className="fine">{terms.length?`Condition terms for AI-matched results: ${terms.join(', ')}.`:'No condition terms from here. AI-matched results use the condition you searched for.'}</p>
   <button type="button" className="quiet" disabled={!hasDetails(details)} onClick={()=>store.clear()}>Clear my details</button>
  </fieldset></form>
 </section>;
}
