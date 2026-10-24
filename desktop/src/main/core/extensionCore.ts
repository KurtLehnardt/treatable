/**
 * The only module in desktop/ that imports the extension (and, through it, the
 * scaffold). Everything else reaches the scoring pipeline through this adapter.
 * It deliberately avoids panel.tsx, storage.ts, background.ts, native.ts, and
 * hipaaGate.ts, which depend on browser extension APIs.
 */
export { runPipeline, visibleAt, countLine, emptyMessage } from "../../../../extension/src/pipeline";
export type { PipelineResult, PipelineInput, ScoredStudy, MinMatch } from "../../../../extension/src/pipeline";
export { profileFromForm, nearestSite } from "../../../../extension/src/core";
export type { PatientProfile, Study, ZipData } from "../../../../extension/src/core";
export { OpenAIProvider, ProviderError, redact } from "../../../../extension/src/openai";
export type { OpenAIOptions, FailureKind } from "../../../../extension/src/openai";
export { LocalProvider } from "../../../../extension/src/localProvider";
export type { LocalGenerator } from "../../../../extension/src/localProvider";
export { buildEvidence, TIER_LABELS, tierOf } from "../../../../extension/src/scoring";
export type { ScoringProvider, ScoreBreakdown, SharedEvidence, ProviderScoreResult, Tier } from "../../../../extension/src/scoring";
export type { LocalScreen } from "../../../../extension/src/match";
export { hasLocalWeights, localModels, MODEL_PATTERN } from "../../../../extension/native/core.mjs";
