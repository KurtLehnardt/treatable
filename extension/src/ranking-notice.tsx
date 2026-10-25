import React from 'react';
/** The one statement about what match percentages mean. It appears in this notice only, not on cards or in the panel. */
export const MATCH_STATEMENT='Match percentages show how relevant a study looks to your search and details. They are not a medical opinion and do not decide eligibility; only the study team can.';
/** Privacy + health data notice for AI-matched results, shown in the confirmation window before the first OpenAI ranking. */
export function RankingNotice(){
 return <section className="ranking-notice" aria-labelledby="ranking-notice-title"><h2 id="ranking-notice-title">Privacy + Health Data Notice</h2>
  <div className="notice-scroll" tabIndex={0} role="region" aria-label="Privacy and health data notice for AI-matched results">
   <h3>What is sent</h3><p>The condition you searched for on ClinicalTrials.gov and, only if you filled them in under Settings → Your details, your age band, sex and short condition terms. With them go the public ClinicalTrials.gov records of the studies on the page. Your name, exact age, ZIP code, location, contact details and notes are never sent.</p>
   <h3>What stays on this device</h3><p>Recruiting status, the listed age range and the listed sex are checked inside Treatable. Studies that clearly do not fit move to the end with a short reason. Nothing is hidden unless you choose a filter yourself.</p>
   <h3>Who receives it</h3><p>OpenAI’s Decisions API scores how relevant each study is. API data is not used for model training by default. Abuse-monitoring logs may keep content for up to 30 days, with possible legal exceptions. <a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noopener noreferrer">OpenAI data controls</a>.</p>
   <h3>How long this lasts</h3><p>If you allow it, Treatable ranks results pages automatically for the rest of this browser session without asking again, sending the same kinds of information each time. Closing the browser or turning off AI-matched results ends it. With AI-matched results off, the website keeps its own order and no match percentages are shown.</p>
   <h3>What the percentages mean</h3><p>{MATCH_STATEMENT}</p>
   <h3>Limits</h3><p>Minimized information is not anonymous: a condition, age band and sex can still describe someone. Treatable does not claim HIPAA compliance. Card order on the page is visible to the website.</p>
   <h3>Operator and privacy contact</h3><p>Operator: Kurt Lehnardt - Developer of Treatable<br/>Privacy contact: <a href="mailto:privacy.6vpc5@mailer.me">privacy.6vpc5@mailer.me</a></p>
  </div></section>;
}
