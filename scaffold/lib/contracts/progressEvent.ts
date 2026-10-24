import { z } from "zod";

/**
 * §3.2 — ProgressEvent
 *
 * `{ stage, status, message, pct_hint?, partial_payload?, ts }`. One enum of
 * stage names shared by backend and frontend (R4). Adding a stage means adding
 * to `ProgressStageSchema`.
 *
 * `status` can express `failed` and `timed_out` — not just started/done — so a
 * stalled or errored stage renders as itself instead of a stuck "Almost there"
 * (R4: "Handle the failure paths visibly").
 */

/** The R4 pipeline stages, in nominal order. Copy is UI-side; these are ids. */
export const ProgressStageSchema = z.enum([
  "interview_generating", // "Working out what we need to know"
  "description_enriched", // "Locking in your profile"
  "search_dispatched", // "Searching federal opportunity databases"
  "api_returned", // "Data returned — analyzing results"
  "eligibility_screening", // "Checking what you qualify for"
  "analysis_streaming", // "Matching programs to your profile"
  "ranking", // "Ranking and optimizing results"
  "verification_triage", // "Checking what needs verification"
  "finalizing", // "Almost there"
]);
export type ProgressStage = z.infer<typeof ProgressStageSchema>;

/**
 * Stage lifecycle. `failed` and `timed_out` are required by §3.2; `skipped`
 * and `canceled` cover conditional stages and R4's real cancel button.
 */
export const ProgressStatusSchema = z.enum([
  "started",
  "in_progress",
  "done",
  "failed",
  "timed_out",
  "skipped",
  "canceled",
]);
export type ProgressStatus = z.infer<typeof ProgressStatusSchema>;

export const ProgressEventSchema = z.object({
  stage: ProgressStageSchema,
  status: ProgressStatusSchema,
  /** Human-readable message for the current stage/status. */
  message: z.string(),
  /**
   * Optional hint 0..100. A *hint*, never an authoritative percentage — R4
   * forbids interpolated percentages that lie.
   */
  pct_hint: z.number().min(0).max(100).optional(),
  /**
   * Partial results as they arrive (R4 "Show partial results as they arrive").
   * Deliberately unknown at the contract layer — each stage attaches its own
   * validated payload; consumers narrow it.
   */
  partial_payload: z.unknown().optional(),
  /** Epoch milliseconds when the event was emitted. */
  ts: z.number().int().nonnegative(),
});
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;
