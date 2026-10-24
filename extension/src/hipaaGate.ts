/**
 * Phase 2 organization-policy gate for OpenAI mode. Fails closed.
 *
 * Honest scope: this is an organization-policy gate plus a user attestation. It is NOT
 * verification of a BAA. OpenAI documents no API that tells a client whether the key's
 * organization has an executed BAA, Modified Retention, or endpoint coverage. What it does:
 *   1. An IT admin must deploy a managed policy (chrome.storage.managed, managed_schema.json)
 *      with hipaaOpenAIEnabled: true and allowedOpenAIOrgIds.
 *   2. The user must tick the BAA attestation checkbox.
 *   3. The key must belong to an allowed organization. OpenAI enforces this server-side
 *      when a request carries the OpenAI-Organization header; every later request is pinned.
 * Missing, malformed, or mismatched input locks OpenAI mode.
 */
import type {PhaseConfig} from './config';
import {OpenAIProvider, verifyOrganization, type OrgCheck} from './openai';
import {LocalProvider, type LocalGenerator} from './localProvider';
import type {ScoringProvider} from './scoring';

export interface ManagedPolicy {hipaaOpenAIEnabled: boolean; allowedOpenAIOrgIds: string[]}
export const GATE_NAME = 'Organization policy gate plus attestation (not BAA verification)';
const ORG_ID = /^org-[A-Za-z0-9]{6,64}$/;

export function parsePolicy(raw: unknown): {ok: true; policy: ManagedPolicy} | {ok: false; reason: string} {
  if (!raw || typeof raw !== 'object' || !Object.keys(raw).length) return {ok: false, reason: 'No organization policy is installed. An IT admin must deploy the Treatable managed policy to enable OpenAI mode.'};
  const v = raw as Record<string, unknown>;
  if (typeof v.hipaaOpenAIEnabled !== 'boolean' || !Array.isArray(v.allowedOpenAIOrgIds)) return {ok: false, reason: 'The organization policy is malformed. OpenAI mode stays locked.'};
  if (!v.hipaaOpenAIEnabled) return {ok: false, reason: 'Your organization policy does not enable OpenAI mode.'};
  const ids = v.allowedOpenAIOrgIds;
  if (!ids.length || ids.length > 20 || !ids.every(id => typeof id === 'string' && ORG_ID.test(id))) return {ok: false, reason: 'The organization policy has no valid OpenAI organization IDs (org-...). OpenAI mode stays locked.'};
  return {ok: true, policy: {hipaaOpenAIEnabled: true, allowedOpenAIOrgIds: ids as string[]}};
}

/** forKey binds an open result to the key it was checked with; a different key needs a new check. */
export type GateResult = {open: true; organizationId: string; forKey: string} | {open: false; reason: string};

export interface GateInput {
  policyRaw: unknown;
  attested: boolean;
  apiKey: string;
  /** Injected for tests; defaults to the real organization check. */
  verify?: (apiKey: string, organizationId: string) => Promise<OrgCheck>;
}

/** Evaluate the gate. No network request is made unless policy and attestation both pass. */
export async function evaluateGate(input: GateInput): Promise<GateResult> {
  const parsed = parsePolicy(input.policyRaw);
  if (!parsed.ok) return {open: false, reason: parsed.reason};
  if (!input.attested) return {open: false, reason: 'Tick the BAA attestation to use OpenAI mode under your organization policy.'};
  if (!input.apiKey.trim()) return {open: false, reason: 'Add an API key from an allowed OpenAI organization.'};
  const verify = input.verify || ((key: string, org: string) => verifyOrganization(key, org));
  try {
    for (const organizationId of parsed.policy.allowedOpenAIOrgIds) {
      if (await verify(input.apiKey, organizationId) === 'match') return {open: true, organizationId, forKey: input.apiKey.trim()};
    }
    return {open: false, reason: 'This API key does not belong to an OpenAI organization allowed by your organization policy.'};
  } catch {
    return {open: false, reason: 'Could not confirm the API key organization (network or API error). OpenAI mode stays locked.'};
  }
}

export interface ResolveInput {
  config: PhaseConfig;
  choice?: 'openai' | 'local' | 'none';
  consented: boolean;
  apiKey: string;
  attested: boolean;
  /** Required when config.hipaaGateEnabled; ignored otherwise. */
  gate?: GateResult;
  local?: {generator: LocalGenerator; model?: string};
  fetch?: typeof fetch;
}

export interface Resolved {provider?: ScoringProvider; reason?: string}

/** Pick the provider for the current phase and settings. Never returns OpenAI when the gate is locked. */
export function resolveProvider(input: ResolveInput): Resolved {
  const choice = input.choice ?? input.config.defaultProvider;
  const localFallback = (reason: string): Resolved => input.local?.model
    ? {provider: new LocalProvider(input.local.generator, input.local.model), reason}
    : {reason: `${reason} Local LLM is not available either, so results are unrefined.`};
  if (choice === 'none') return {reason: 'Send nothing mode: no data leaves this computer.'};
  if (choice === 'local') return input.local?.model ? {provider: new LocalProvider(input.local.generator, input.local.model)} : {reason: 'Local LLM selected, but the local helper or a model was not detected. See extension/NATIVE_SETUP.md.'};
  if (input.config.hipaaGateEnabled) {
    if (!input.gate || !input.gate.open) return localFallback(`OpenAI mode is locked. ${input.gate && !input.gate.open ? input.gate.reason : 'The organization gate has not been checked.'} Using Local LLM.`);
    if (!input.attested) return localFallback('OpenAI mode is locked. Tick the BAA attestation. Using Local LLM.');
    if (input.gate.forKey !== input.apiKey.trim()) return localFallback('OpenAI mode is locked. The API key changed since the organization check. Check the gate again. Using Local LLM.');
  }
  try {
    return {provider: new OpenAIProvider({
      apiKey: input.apiKey,
      consented: input.consented,
      fetch: input.fetch,
      organizationId: input.config.hipaaGateEnabled && input.gate?.open ? input.gate.organizationId : undefined,
      agentsAllowed: !input.config.hipaaGateEnabled,
    })};
  } catch (e) {
    return {reason: e instanceof Error ? e.message : 'OpenAI is not available.'};
  }
}
