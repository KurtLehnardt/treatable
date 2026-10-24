/**
 * Error codes and the single error class used inside the shared core.
 *
 * Errors are constant-shape: a CoreError carries only a code from ERROR_CODES. Its message is the
 * code itself, so an error can never echo request content, provider text, tokens, or digests.
 */

export const ERROR_CODES = [
  // Request and session handling.
  'INVALID_REQUEST',
  'CONTRACT_MISMATCH',
  'NOT_IMPLEMENTED',
  'BUSY',
  'SESSION_LIMIT',
  'RECORD_NOT_IN_SESSION',
  // Consent receipts.
  'CONSENT_EXPIRED',
  'INVALID_CONSENT_RECEIPT',
  'PREVIEW_TOO_LARGE',
  // Credentials supplied by the host.
  'KEY_MISSING',
  'CREDENTIAL_UNAVAILABLE',
  // Remote services (ClinicalTrials.gov or OpenAI; the operation tells them apart).
  'KEY_REJECTED',
  'API_PERMISSION',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'NETWORK_ERROR',
  'API_ERROR',
  'INVALID_API_RESPONSE',
  'INCOMPLETE_AGENT_TURN',
  'INVALID_ENDPOINT',
  'INPUT_TOO_LARGE',
  'OUTPUT_TOO_LARGE',
  // Lifecycle and integrity.
  'CANCELLED',
  'RESOURCE_INVALID',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const KNOWN_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && KNOWN_CODES.has(value);
}

export class CoreError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(code);
    this.name = 'CoreError';
    this.code = isErrorCode(code) ? code : 'INTERNAL_ERROR';
  }
}

export function isCoreError(error: unknown): error is CoreError {
  return error instanceof CoreError && isErrorCode(error.code);
}

/** Maps any thrown value to a public code without reading its message. */
export function errorCodeOf(error: unknown, fallback: ErrorCode = 'INTERNAL_ERROR'): ErrorCode {
  return isCoreError(error) ? error.code : fallback;
}
