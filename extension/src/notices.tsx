import React from 'react';

export const NOT_PHI_READY = 'Not PHI-ready: use synthetic or non-identifying information only';
export const BAA_ATTESTED_NOTE = 'You are responsible for confirming your own BAA and that the Decisions and Agents endpoints are covered by it. Treatable does not check this.';
export const BAA_ATTESTATION_LABEL = 'My organization has an executed OpenAI BAA with Modified Retention, and this API key belongs to that organization.';

/**
 * Persistent PHI notice for OpenAI mode. Without the user's attestation it is a warning banner;
 * with it, a softer reminder. Neither makes a compliance claim for the extension.
 */
export function PhiNotice({openaiActive, baaAttested}: {openaiActive: boolean; baaAttested: boolean}) {
  if (!openaiActive) return null;
  return baaAttested
    ? <div className="message phi-note" role="note">{BAA_ATTESTED_NOTE}</div>
    : <div className="message error phi-banner" role="alert"><strong>{NOT_PHI_READY}</strong></div>;
}
