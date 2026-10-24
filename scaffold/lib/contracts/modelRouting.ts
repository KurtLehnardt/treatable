import { z } from "zod";

/**
 * §3.9 — Model routing table
 *
 * Which task uses which model, with a cost/latency budget per task (R4b:
 * "Route by task, not by habit"). Interview generation, triage, and extraction
 * are cheap-model jobs; analysis is not. Every call declares its budget.
 *
 * CON-01 owns the TYPE. The actual model ids / tuning are Team Perf's — the
 * default table below is a documented starting point (v1 runs everything on
 * `claude-sonnet-4-6`; the analysis pass is the only call that genuinely needs
 * the expensive model).
 */

/** The distinct pipeline tasks that route to a model. */
export const ModelTaskSchema = z.enum([
  "interview_generation", // R1 — small/fast, target < 5s
  "profile_extraction", // R1/intake — cheap
  "description_enhancement", // R3 — cheap
  "eligibility_screening", // R8 — mostly rules; model only to extract/normalize
  "candidate_analysis", // the expensive synthesis/scoring pass
  "ranking_synthesis", // expensive
  "weak_field_explanation", // cheap-to-mid
  "verification_triage", // R2 classifier — cheap, conservative
  "competitor_analysis", // R5 — mid
]);
export type ModelTask = z.infer<typeof ModelTaskSchema>;

/** The cost/latency budget + chosen model for one task. */
export const TaskRoutingSchema = z.object({
  /** Model id (e.g. "claude-sonnet-4-6", a cheaper Haiku-class model). */
  model: z.string(),
  max_input_tokens: z.number().int().positive().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  /** Soft latency target for this task in ms (R1 interview: < 5000). */
  target_latency_ms: z.number().int().positive().optional(),
  /** Soft per-call cost budget in USD. */
  max_cost_usd: z.number().positive().optional(),
  /** Why this task routes where it does. */
  rationale: z.string().optional(),
});
export type TaskRouting = z.infer<typeof TaskRoutingSchema>;

/** The full routing table: one entry per task. */
export const ModelRoutingTableSchema = z.record(
  ModelTaskSchema,
  TaskRoutingSchema,
);
export type ModelRoutingTable = z.infer<typeof ModelRoutingTableSchema>;

/**
 * Default routing table — a documented starting point, NOT final tuning.
 * Model ids are placeholders Team Perf replaces; the shape is the contract.
 * `analysis`/`ranking` intentionally stay on the expensive model; everything
 * else is cheap-model work (R4b).
 */
export const DEFAULT_MODEL_ROUTING: ModelRoutingTable = {
  interview_generation: {
    model: "claude-haiku",
    target_latency_ms: 5_000,
    rationale: "R1 — small/fast; must return questions in < 5s.",
  },
  profile_extraction: {
    model: "claude-haiku",
    rationale: "Structured extraction is cheap-model work.",
  },
  description_enhancement: {
    model: "claude-haiku",
    rationale: "R3 guided rewrite — cheap.",
  },
  eligibility_screening: {
    model: "claude-haiku",
    rationale: "Mostly Canon rules; model only normalizes/extracts.",
  },
  candidate_analysis: {
    model: "claude-sonnet-4-6",
    rationale: "The synthesis/scoring pass — the one call that needs the expensive model.",
  },
  ranking_synthesis: {
    model: "claude-sonnet-4-6",
    rationale: "Ranking + narrative synthesis.",
  },
  weak_field_explanation: {
    model: "claude-sonnet-4-6",
    rationale: "High-value 'honest no' — quality-sensitive.",
  },
  verification_triage: {
    model: "claude-haiku",
    rationale: "R2 conservative classifier — cheap.",
  },
  competitor_analysis: {
    model: "claude-sonnet-4-6",
    rationale: "R5 — grounded analysis over public award data.",
  },
};
