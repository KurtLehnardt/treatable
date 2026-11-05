import React from 'react';
/** The one statement about what match percentages mean. It appears in this notice only, not on cards or in the panel. */
export const MATCH_STATEMENT='Match percentages show how relevant a study looks to your search and details. They are not a medical opinion and do not decide eligibility; only the study team can.';
/** Privacy + health data notice for AI-matched results, in Settings, so it can be read at any time, before the switch is turned on too.
 * The line beside the switch is the short form; this is the full one. */
export function RankingNotice(){
 return <section className="ranking-notice" aria-labelledby="ranking-notice-title"><h3 id="ranking-notice-title">AI-matched results: privacy and health data notice</h3>
  <div className="notice-scroll" tabIndex={0} role="region" aria-label="Privacy and health data notice for AI-matched results">
   <h4>When anything is sent</h4><p>Only while the AI-matched results switch is on and OpenAI is the model provider. The switch is off unless you turn it on, and turning it on is your agreement to what this notice describes. With the local model, nothing is sent to OpenAI.</p>
   <h4>What is sent</h4><p>The condition you searched for on ClinicalTrials.gov and, only if you filled in a condition under Settings → Your details, a few short condition terms taken from it. With them go the public ClinicalTrials.gov records of the studies on the page. Your name, age band, exact age, sex, ZIP code, location, contact details and notes are never sent.</p>
   <h4>What stays on this device</h4><p>Recruiting status, the listed age range and the listed sex are checked inside Treatable, using the age band and sex you entered, if any. Studies that clearly do not fit move to the end with a short reason. Nothing is hidden unless you choose a filter yourself.</p>
   <h4>Who receives it</h4><p>OpenAI’s Decisions API scores how relevant each study is. API data is not used for model training by default. Abuse-monitoring logs may keep content for up to 30 days, with possible legal exceptions. <a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noopener noreferrer">OpenAI data controls</a>.</p>
   <h4>How long this lasts</h4><p>Treatable remembers the switch on this device. While it is on, each results page is ranked automatically, sending the same kinds of information each time. Turning it off stops any ranking in progress; a request already on its way to OpenAI can still arrive. With AI-matched results off, the website keeps its own order and no match percentages are shown.</p>
   <h4>What the percentages mean</h4><p>{MATCH_STATEMENT}</p>
   <h4>Limits</h4><p>Minimized information is not anonymous: a condition is still health information. Treatable does not claim HIPAA compliance. Card order on the page is visible to the website.</p>
   <h4>Operator and privacy contact</h4><p>Operator: Kurt Lehnardt - Developer of Treatable<br/>Privacy contact: <a href="mailto:privacy.6vpc5@mailer.me">privacy.6vpc5@mailer.me</a></p>
  </div></section>;
}
