/**
 * Public surface of the runtime-neutral Treatable core.
 * Hosts create one core per process with createCore(ports, options) and send it protocol messages.
 */
export * from './protocol.ts';
export {
  createCore,
  ctgovOnlyTransport,
  CTGOV_API_PREFIX,
  type Core,
  type CoreOptions,
  type CredentialBroker,
  type ExecuteContext,
  type HandleOptions,
  type LocalPorts,
  type PipelineContext,
  type Pipelines,
  type ScreenContext,
  type SearchContext,
  type TraceInput,
} from './dispatcher.ts';
export {
  AGENTS_BETA_HEADER_VALUE,
  AGENTS_CANCEL_BODY,
  AGENTS_CLEANUP_LIMITS,
  AGENTS_SESSIONS_PATH,
  BASE_RETRY_DELAY_MS,
  DECISIONS_PATH,
  MAX_JSON_RESPONSE_BYTES,
  MAX_OBSERVED_PROVIDER_BYTES,
  MAX_PIPELINE_WAIT_MS,
  MAX_RETRY_AFTER_MS,
  MAX_RETRY_JITTER_MS,
  MAX_STREAM_RESPONSE_BYTES,
  NON_RETRYABLE_429_CODES,
  OPENAI_ORIGIN,
  SEND_TIMEOUT_MS,
  agentsCreateText,
  computeRequestPins,
  createOpenAISender,
  decisionsRequestText,
  isAllowedOpenAIRequest,
  toolResultEventText,
  toolResultOutputText,
  type OpenAIRequestRef,
  type OpenAIResponse,
  type OpenAISender,
  type SenderHandle,
  type SenderOptions,
  type SenderRecord,
} from './outbound.ts';
export {
  MAX_RECORDS_PER_MERGE,
  MAX_SESSION_RECORDS,
  RECORD_SET_FORMAT,
  assertRecordsFresh,
  createRecordIndex,
  recordDigest,
  recordSetDigest,
  type PinnedRecord,
  type PreparedMerge,
  type RecordIndex,
  type RecordIndexView,
} from './records.ts';
export {
  MAX_MODEL_CONDITIONS,
  assertPacketInRecords,
  buildAgentsBody,
  buildDecisionsBody,
  buildPreview,
  buildRecordPreview,
  buildToolResult,
  projectModelStudy,
  verifyPreviewAgainstRecords,
} from './preview.ts';
export type { CancelSignal, Clock, CorePorts, HttpMethod, Loader, Sha256, TokenSource, Transport, TransportRequest, TransportResponse } from './ports.ts';
export { assertPorts } from './ports.ts';
export { createCancelSource, type CancelSource } from './cancel.ts';
export { CoreError, isCoreError, isErrorCode } from './errors.ts';
export {
  base64UrlEncode,
  isHex64,
  jsonByteLength,
  readBounded,
  truncateUtf8,
  utf8ByteLength,
  utf8Decode,
  utf8Encode,
  Utf8Error,
} from './bytes.ts';
export { canonicalJson, deepFreeze, isJsonObject, isJsonValue, jsonClone, jsonEqual, type JsonObject, type JsonValue } from './json.ts';
export { createSession, defineSlot, type Session, type SessionSlots, type SlotKey } from './session.ts';
export {
  CONSENT_OPERATIONS,
  TOKEN_BYTES,
  computeConsentDigest,
  createConsentStore,
  parsePolicyReceipt,
  type ConsentOperation,
  type ConsentPins,
  type ConsentStore,
  type PinnedConsent,
  type PreparedConsent,
} from './consent/index.ts';
export { loadJsonResource, loadResource, RESOURCE_ID_PATTERN, MAX_RESOURCE_BYTES, type ResourceSpec } from './resources.ts';
export * from './ctgov/index.ts';
export { assertAgentsBound, assertR4Packet, assertR4Preview, decisionsSendPlan, type DecisionsSendEntry } from './r4.ts';
export { INVISIBLE_OR_FORMAT, isCleanUntrustedText, replaceLoneSurrogates, sanitizeUntrustedText } from './untrusted-text.ts';
