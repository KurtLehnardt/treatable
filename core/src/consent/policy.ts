/**
 * Consent policy constants and the policy receipt check.
 *
 * Ported from extension/shared/real-contract.mjs at commit 48c569e (REAL_POLICY_VERSION,
 * PREPARED_TTL_MS, parsePolicyReceipt). The policy version names the notice text that the user
 * acknowledged; the apps use their own notice, so the identifier differs from the extension's.
 */
import { CoreError } from '../errors.ts';

/** Identifier of the health-data notice the user must acknowledge before any real-data preparation. */
export const CONSENT_POLICY_VERSION = 'treatable-apps-health-api-2026-10-24-v1';

/** A prepared preview, its token, and its digest are valid for five minutes. */
export const PREPARED_TTL_MS = 5 * 60 * 1000;

/** Operations a preparation can authorize. Each one may run at most once per prepared token. */
export const CONSENT_OPERATIONS = ['score', 'agent'] as const;
export type ConsentOperation = (typeof CONSENT_OPERATIONS)[number];

export interface PolicyReceipt {
  readonly policyVersion: typeof CONSENT_POLICY_VERSION;
  readonly accepted: true;
}

export function isConsentOperation(value: unknown): value is ConsentOperation {
  return value === 'score' || value === 'agent';
}

/**
 * Accepts exactly `{ policyVersion: CONSENT_POLICY_VERSION, accepted: true }` with no other keys and
 * returns a fresh copy. Anything else throws a CoreError with the given code.
 */
export function parsePolicyReceipt(value: unknown, code: 'INVALID_REQUEST' | 'INVALID_CONSENT_RECEIPT'): PolicyReceipt {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 2 ||
    (value as Record<string, unknown>).policyVersion !== CONSENT_POLICY_VERSION ||
    (value as Record<string, unknown>).accepted !== true
  ) {
    throw new CoreError(code);
  }
  return { policyVersion: CONSENT_POLICY_VERSION, accepted: true };
}
