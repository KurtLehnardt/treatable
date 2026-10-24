import React from 'react';
import {PRIVATE_TEXT_FIELD} from './patient-form';
import {hasDetails,useYourDetails,YOUR_DETAILS_LIMITS} from './your-details';
/** Settings fields for "Your details". Values go only to the session store; see your-details.ts for the boundaries. */
export function YourDetailsSettings({ended=false}:{ended?:boolean}){
 const {details,store}=useYourDetails(),f=PRIVATE_TEXT_FIELD;if(!store)return null;
 return <section className="your-details" aria-labelledby="your-details-heading">
  <h3 id="your-details-heading">Your details <span className="optional">Optional · this session only</span></h3>
  <p>These fill only your own email draft, call script and follow-up message on this device, and you can edit those drafts before using them. They are never sent to OpenAI, the Treatable helper or ClinicalTrials.gov. They stay in memory until you clear them or end the session, and are not saved on this device.</p>
  {ended&&<p role="status">The session has ended, so your details were cleared. Reopen Treatable to enter them again.</p>}
  <form autoComplete="off" onSubmit={e=>e.preventDefault()}><fieldset disabled={ended}>
   <label>Your name<input {...f} value={details.name} maxLength={YOUR_DETAILS_LIMITS.name} onChange={e=>store.set({name:e.target.value})}/></label>
   <label>Your illness, condition, symptoms or reason for seeking treatment<textarea {...f} rows={4} value={details.condition} maxLength={YOUR_DETAILS_LIMITS.condition} onChange={e=>store.set({condition:e.target.value})}/></label>
   <label>Anything else to include<textarea {...f} rows={3} value={details.extra} maxLength={YOUR_DETAILS_LIMITS.extra} onChange={e=>store.set({extra:e.target.value})}/></label>
   <button type="button" className="quiet" disabled={!hasDetails(details)} onClick={()=>store.clear()}>Clear my details</button>
  </fieldset></form>
 </section>;
}
