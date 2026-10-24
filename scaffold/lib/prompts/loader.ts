import { PROMPT_REGISTRY } from "./registry";
import type { PromptEntry, PromptUsage } from "./types";

export class PromptNotFoundError extends Error {
  constructor(id: string) {
    super(`Prompt "${id}" is not registered in lib/prompts/registry.ts`);
    this.name = "PromptNotFoundError";
  }
}

/**
 * Look up a registered prompt by id. Throws if it isn't registered — every
 * prompt used at runtime must live in the registry (R10.2), so a missing id
 * is a bug at the call site, not something to silently fall back from.
 */
export function loadPrompt(id: string): PromptEntry {
  const entry = PROMPT_REGISTRY[id];
  if (!entry) throw new PromptNotFoundError(id);
  return entry;
}

/**
 * Reduce a loaded prompt to the `{ id, version, contentHash }` a run should
 * attach to its trace, per R10.2 ("every run records the prompt version(s)
 * it used"). Callers in `lib/claude.ts` can thread this through once traces
 * exist (R10.3); for now it exists so the loader already surfaces the shape.
 */
export function recordUsage(entry: PromptEntry): PromptUsage {
  return { id: entry.id, version: entry.version, contentHash: entry.contentHash };
}

/** All registered prompts' usage records — useful for a run-level manifest. */
export function listRegisteredPrompts(): PromptUsage[] {
  return Object.values(PROMPT_REGISTRY).map(recordUsage);
}
