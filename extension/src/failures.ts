/** Typed failure codes and the fixed copy shown for them. Codes come from the native helper (validated by the shared
 * contract) or from the background/panel themselves. Transported error text is never rendered; only this table is. */
export const FAILURE_CODE=/^[A-Z_]{1,40}$/;
export const GENERIC_FAILURE_COPY='The operation did not complete, so no result is shown in its place. Local search still works. The failure code is listed in the trace.';
export const FAILURE_COPY:Readonly<Record<string,string>>=Object.freeze({
 NATIVE_HOST_MISSING:'Install the Treatable helper, then reload the extension. Nothing was sent to OpenAI. Local search still works.',
 NATIVE_HOST_FORBIDDEN:'Chrome blocked this extension from using the Treatable helper. Reinstall the helper for this extension, then reload it. Nothing was sent to OpenAI. Local search still works.',
 NATIVE_HOST_DISCONNECTED:'The Treatable helper stopped or could not start. Reinstall or restart it, then retry. Local search still works.',
 NATIVE_TIMEOUT:'The helper did not answer within 150 seconds (270 for a local model), so Treatable closed the connection and ended this session. Click the Treatable button in the toolbar to start again; local search works again.',
 INVALID_NATIVE_REPLY:'The helper reply failed validation and was discarded, so no result is shown. Local search still works.',
 RESULT_MISMATCH:'Mismatched result rejected: it did not match the studies you selected, so it is not shown. Local search still works.',
 SESSION_ENDED:'The session ended before the operation finished. Click the Treatable button in the toolbar to start again; local search works again.',
 KEY_MISSING:'No dedicated API key is set up for the Treatable helper. Run its Keychain setup in Terminal; never paste a key into Chrome. Nothing was sent to OpenAI. Local search still works.',
 KEY_REJECTED:'OpenAI rejected the configured API key. Replace it with the helper Keychain setup, then retry. Local search and earlier results still work.',
 API_PERMISSION:'This API key or project lacks access to the required OpenAI API or model. Check the account permissions, then retry. Local search still works.',
 RATE_LIMITED:'The OpenAI rate limit or quota was reached. Wait a minute, then retry. Local search and earlier results still work.',
 CONFIRMATION_CANCELLED:'You cancelled the secure confirmation. Nothing was sent to OpenAI. Your form is still available to review.',
 CANCELLED:'The operation stopped before finishing. Provider cleanup is attempted; check the trace. Local search and earlier results are unchanged.',
 API_ERROR:'OpenAI returned an unsuccessful response, so no result is shown in its place. Retry later. Local search still works.',
 NETWORK_ERROR:'The helper could not reach OpenAI. Check the network connection, then retry. Local search works offline.',
 INVALID_API_RESPONSE:'The OpenAI response did not match the expected format and was discarded; no partial result is shown. Local search still works.',
 INVALID_REQUEST:'The helper rejected this request as invalid, so nothing was sent to OpenAI. Check that the helper matches this extension version. Local search still works.',
 HELPER_VERSION_MISMATCH:'The installed Treatable helper does not match this extension version and refused the request, so nothing was sent to OpenAI. Reinstall the helper with extension/native/install.mjs, then reload the extension. Local search still works.',
 BUSY:'Another API operation is still running, so nothing new was sent. Wait for it or stop it, then retry. Local search still works.',
 CONSENT_EXPIRED:'The prepared preview expired before sending, so nothing was sent to OpenAI. Prepare and review a fresh preview.',
 INVALID_CONSENT_RECEIPT:'The preview receipt was stale, changed or already used, so nothing was sent to OpenAI. Prepare and review a fresh preview.',
 PREVIEW_TOO_LARGE:'The selected records exceed the preview size limit, so nothing was sent to OpenAI. Choose fewer labels or studies and prepare again.',
 INVALID_FIXTURE_STUDIES:'Only the test sample studies are allowed, so nothing was sent to OpenAI. Reselect the sample and retry.',
 INTERNAL_ERROR:'The helper hit an internal error and returned no result. Retry once; if it repeats, restart Chrome. Local search still works.',
 INCOMPLETE_AGENT_TURN:'The Agents stream ended without a completed, tool-verified answer, so no result is shown. Check the trace for cleanup, then retry.',
 // Help me apply (study page). The local contact plan keeps working when any of these occur.
 RECORD_UNAVAILABLE:'The official study record could not be loaded from ClinicalTrials.gov. Check your connection and refresh the study page, then open Treatable again.',
 RECORD_MISMATCH:'The study record did not match this page, so it was discarded. Refresh the study page and open Treatable again.',
 APPLY_EXPIRED:'The prepared study review expired before it was sent, so nothing was sent to OpenAI. Choose Prepare again, then ask for the review.',
 INVALID_APPLY_RECEIPT:'The prepared study review was stale or already used, so nothing was sent to OpenAI. Choose Prepare again, then ask for the review.',
 NOT_STUDY_PAGE:'This tab is no longer showing the same ClinicalTrials.gov study page, so nothing was sent. Open the study page and start again.',
 USER_ACTIVATION_REQUIRED:'The review starts only from your own click or key press on the button, so nothing was sent. Press the button again.',
 GOV_NETWORK_ERROR:'The Treatable helper could not reach ClinicalTrials.gov, so nothing was sent to OpenAI. Your contact plan still uses the record loaded here.',
 GOV_HTTP_ERROR:'ClinicalTrials.gov did not return this study record to the helper, so nothing was sent to OpenAI. Your contact plan still works.',
 GOV_INVALID_RECORD:'The official record failed validation in the helper, so nothing was sent to OpenAI. Your contact plan still uses the record loaded here.',
 GOV_ID_MISMATCH:'The official record did not match the requested study, so it was discarded and nothing was sent to OpenAI.',
 GOV_RECORD_TOO_LARGE:'This study record is larger than the helper accepts, so nothing was sent to OpenAI. Your contact plan still works.',
 AGENT_FAILED:'The study review did not finish, so no agent result is shown. Your contact plan still uses the default questions and checklist.',
 INVALID_AGENT_OUTPUT:'The study review returned output outside the fixed lists, so it was discarded. Your contact plan still uses the default questions.',
 TOOL_LIMIT:'The study review used more record lookups than allowed, so it was stopped and discarded. Your contact plan still works.',
 INVALID_TOOL_CALL:'The study review asked for something outside the public record, so it was stopped and discarded. Your contact plan still works.',
 DUPLICATE_TOOL_CALL:'The study review repeated a record lookup, so it was stopped and discarded. Your contact plan still works.',
 OUTPUT_TOO_LARGE:'The response was larger than allowed, so it was discarded and no result is shown. Local features still work.',
 INVALID_STREAM:'The OpenAI response stream was malformed, so it was discarded and no result is shown. Local features still work.',
 INCOMPLETE_STREAM:'The OpenAI response stream ended early, so no result is shown. Check the cleanup status, then retry.',
 // Local model (Ollama on this device). None of these sends anything to OpenAI; the official record excerpts stay available.
 LOCAL_NOT_INSTALLED:'Ollama is not installed on this device, so the local model could not run. Install it from ollama.com/download, or switch Settings → Model provider back to OpenAI. Nothing was sent to OpenAI.',
 LOCAL_RUNTIME_FAILED:'Treatable could not start its own private Ollama runtime on this device. Restart the computer or reinstall Ollama, then retry, or switch to OpenAI in Settings. Nothing was sent to OpenAI.',
 LOCAL_MODEL_UNAVAILABLE:'The chosen local model is not installed or cannot write text. Choose another one in Settings → Model provider, where the recommendation shows the exact ollama pull command. Nothing was sent to OpenAI.',
 LOCAL_MODEL_FAILED:'The local model could not run on this device, for example because there is not enough free memory. Close other apps or choose a smaller model in Settings, then retry. Nothing was sent to OpenAI.',
 LOCAL_OLLAMA_OUTDATED:'Ollama on this device is too old for the structured output Treatable needs (0.5 or later). Update it from ollama.com/download, then retry. Nothing was sent to OpenAI.',
 LOCAL_SESSION_TOO_SHORT:'Too little time is left in this study session for the local model. Choose Keep working, or close and reopen Treatable on this page, then generate the brief again. Nothing was sent.',
 LOCAL_MODEL_NOT_CHOSEN:'Choose a local model in Settings → Model provider first, or switch back to OpenAI. Nothing was sent.',
 LOCAL_TIMEOUT:'The local model took too long on this device and was stopped. Try a smaller model, select one study instead of two, or use OpenAI. Nothing was sent to OpenAI; the official excerpts are still shown.',
 LOCAL_INVALID_OUTPUT:'The local model returned output that failed validation, so it was discarded. The official record excerpts and standard questions are shown instead. Nothing was sent to OpenAI.',
 CLEANUP_ERROR:'The provider session could not be confirmed as deleted. The result, if shown, is still valid; deletion may need a retry later.',
});
/** Failures known to happen before any request body reaches the provider. */
export const NOT_SENT_CODES:ReadonlySet<string>=new Set(['LOCAL_NOT_INSTALLED','LOCAL_RUNTIME_FAILED','LOCAL_MODEL_FAILED','LOCAL_OLLAMA_OUTDATED','LOCAL_SESSION_TOO_SHORT','LOCAL_MODEL_UNAVAILABLE','LOCAL_MODEL_NOT_CHOSEN','LOCAL_TIMEOUT','LOCAL_INVALID_OUTPUT','CONFIRMATION_CANCELLED','NATIVE_HOST_MISSING','NATIVE_HOST_FORBIDDEN','KEY_MISSING','INVALID_REQUEST','HELPER_VERSION_MISMATCH','BUSY','CONSENT_EXPIRED','INVALID_CONSENT_RECEIPT','PREVIEW_TOO_LARGE','INVALID_FIXTURE_STUDIES','APPLY_EXPIRED','INVALID_APPLY_RECEIPT','NOT_STUDY_PAGE','USER_ACTIVATION_REQUIRED','RECORD_UNAVAILABLE','RECORD_MISMATCH','GOV_NETWORK_ERROR','GOV_HTTP_ERROR','GOV_INVALID_RECORD','GOV_ID_MISMATCH','GOV_RECORD_TOO_LARGE']);
export function failureCopy(code:unknown):string{return typeof code==='string'&&Object.hasOwn(FAILURE_COPY,code)?FAILURE_COPY[code]:GENERIC_FAILURE_COPY}
/** Chrome reports native-host launch failures only as runtime.lastError text on the native port's disconnect. */
export function nativeDisconnectCode(message:unknown):'NATIVE_HOST_MISSING'|'NATIVE_HOST_FORBIDDEN'|'NATIVE_HOST_DISCONNECTED'{
 const text=typeof message==='string'?message.toLowerCase():'';
 if(text.includes('specified native messaging host not found'))return 'NATIVE_HOST_MISSING';
 if(text.includes('access to the specified native messaging host is forbidden'))return 'NATIVE_HOST_FORBIDDEN';
 return 'NATIVE_HOST_DISCONNECTED';
}
/** Error carrying only a validated code; its message is always fixed copy. */
export class NativeOperationError extends Error{
 readonly code:string;
 constructor(code:string){const safe=typeof code==='string'&&FAILURE_CODE.test(code)?code:'UNEXPECTED_FAILURE';super(failureCopy(safe));this.name='NativeOperationError';this.code=safe}
}
export function failureCodeOf(error:unknown):string{return error instanceof NativeOperationError?error.code:'UNEXPECTED_FAILURE'}
