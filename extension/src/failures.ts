/** Typed failure codes and the fixed copy shown for them. Codes come from the native helper (validated by the shared
 * contract) or from the background/panel themselves. Transported error text is never rendered; only this table is. */
export const FAILURE_CODE=/^[A-Z_]{1,40}$/;
export const GENERIC_FAILURE_COPY='The operation did not complete, so no result is shown in its place. Local search and the offline study snapshot still work. The failure code is listed in the trace.';
export const FAILURE_COPY:Readonly<Record<string,string>>=Object.freeze({
 NATIVE_HOST_MISSING:'Install the Treatable helper, then reload the extension. Nothing was sent to OpenAI. Local search and the offline study snapshot still work.',
 NATIVE_HOST_FORBIDDEN:'Chrome blocked this extension from using the Treatable helper. Reinstall the helper for this extension, then reload it. Nothing was sent to OpenAI. Local search still works.',
 NATIVE_HOST_DISCONNECTED:'The Treatable helper stopped or could not start. Reinstall or restart it, then retry. Local search and the offline study snapshot still work.',
 NATIVE_TIMEOUT:'The helper did not answer within 150 seconds, so Treatable closed the connection and ended this session. Start a blank session to retry; local search works again after restart.',
 INVALID_NATIVE_REPLY:'The helper reply failed validation and was discarded, so no result is shown. Local search and the offline study snapshot still work.',
 RESULT_MISMATCH:'Mismatched result rejected: it did not match the fixture or studies you selected, so it is not shown. Local search still works.',
 SESSION_ENDED:'The session ended before the operation finished. Start a blank session to continue; local search is available again after restart.',
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
 BUSY:'Another API operation is still running, so nothing new was sent. Wait for it or stop it, then retry. Local search still works.',
 CONSENT_EXPIRED:'The prepared preview expired before sending, so nothing was sent to OpenAI. Prepare and review a fresh preview.',
 INVALID_CONSENT_RECEIPT:'The preview receipt was stale, changed or already used, so nothing was sent to OpenAI. Prepare and review a fresh preview.',
 PREVIEW_TOO_LARGE:'The selected records exceed the preview size limit, so nothing was sent to OpenAI. Choose fewer labels or studies and prepare again.',
 INVALID_FIXTURE_STUDIES:'Only the fictional fixture’s own public studies are allowed, so nothing was sent to OpenAI. Reselect the fixture and retry.',
 INTERNAL_ERROR:'The helper hit an internal error and returned no result. Retry once; if it repeats, restart Chrome. Local search and the offline study snapshot still work.',
 INCOMPLETE_AGENT_TURN:'The Agents stream ended without a completed, tool-verified answer, so no result is shown. Check the trace for cleanup, then retry.',
});
/** Failures known to happen before any request body reaches the provider. */
export const NOT_SENT_CODES:ReadonlySet<string>=new Set(['CONFIRMATION_CANCELLED','NATIVE_HOST_MISSING','NATIVE_HOST_FORBIDDEN','KEY_MISSING','INVALID_REQUEST','BUSY','CONSENT_EXPIRED','INVALID_CONSENT_RECEIPT','PREVIEW_TOO_LARGE','INVALID_FIXTURE_STUDIES']);
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
