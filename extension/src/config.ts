/**
 * Release phase. This is the one-line switch between the two product phases.
 *
 * - 'demo'  (Phase 1, hackathon demo): OpenAI is the default provider, synthetic data only,
 *            a persistent synthetic-demo banner, and no organization policy gate.
 * - 'hipaa' (Phase 2): Local LLM is the default. OpenAI unlocks only through the
 *            organization-policy gate plus attestation (see hipaaGate.ts).
 */
export type Phase = 'demo' | 'hipaa';
export const PHASE: Phase = 'demo';

export interface PhaseConfig {
  phase: Phase;
  /** Provider used until the user chooses another one. */
  defaultProvider: 'openai' | 'local';
  /** When true, OpenAI requires the managed org policy, a verified org, and the attestation. */
  hipaaGateEnabled: boolean;
  /** Persistent banner telling the user to enter synthetic data only. */
  syntheticDemoBanner: boolean;
}

export function phaseConfig(phase: Phase): PhaseConfig {
  return phase === 'hipaa'
    ? {phase, defaultProvider: 'local', hipaaGateEnabled: true, syntheticDemoBanner: false}
    : {phase, defaultProvider: 'openai', hipaaGateEnabled: false, syntheticDemoBanner: true};
}

export const CONFIG = phaseConfig(PHASE);
export const DEFAULT_PROVIDER = CONFIG.defaultProvider;
export const HIPAA_GATE_ENABLED = CONFIG.hipaaGateEnabled;
