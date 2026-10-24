/**
 * A single versioned, content-hashed prompt (R10.2).
 *
 * Prompts are not edited inline in application code — every prompt sent to a
 * model lives here as a `PromptEntry`, looked up by `id` through the loader
 * (`./loader`). This is what lets a run record exactly which prompt
 * version(s) produced a given output (R10.2, R10.3).
 */
export interface PromptEntry {
  /** Stable identifier. Call sites look prompts up by this. */
  id: string;
  /**
   * Human-assigned version string. Bump this whenever `template` changes.
   * `contentHash` is the source of truth for "did the text actually
   * change" — `version` is the human-readable label for that change.
   */
  version: string;
  /** sha256 of `template`, computed automatically via `hashPrompt` — never hand-typed. */
  contentHash: string;
  /** The exact text sent to the model for this prompt. */
  template: string;
}

/**
 * What a run should record per prompt it used (R10.2: "every run records
 * the prompt version(s) it used"). Deliberately a subset of `PromptEntry` —
 * everything needed to reconstruct exactly what produced an output, nothing
 * more.
 */
export interface PromptUsage {
  id: string;
  version: string;
  contentHash: string;
}
