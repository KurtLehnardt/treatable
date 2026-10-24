/**
 * Public surface of the runtime-neutral Treatable core.
 * Hosts create one core per process with createCore(ports, options) and send it protocol messages.
 */
export * from './protocol.ts';
export {
  createCore,
  type Core,
  type CoreOptions,
  type CredentialBroker,
  type ExecuteContext,
  type HandleOptions,
  type HandlerContext,
  type Pipelines,
  type PreparedBuild,
  type TraceInput,
} from './dispatcher.ts';
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
export { createSession, defineSlot, type Session, type SlotKey } from './session.ts';
export {
  CONSENT_OPERATIONS,
  TOKEN_BYTES,
  computeConsentDigest,
  createConsentStore,
  parsePolicyReceipt,
  type ConsentOperation,
  type ConsentStore,
  type PinnedConsent,
  type PreparedConsent,
} from './consent/index.ts';
export { loadJsonResource, loadResource, RESOURCE_ID_PATTERN, MAX_RESOURCE_BYTES, type ResourceSpec } from './resources.ts';
