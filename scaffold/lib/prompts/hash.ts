import { createHash } from "node:crypto";

/**
 * Deterministic content hash for prompt text (R10.2: "every prompt lives in a
 * registry with a version and a content hash"). sha256, hex-encoded.
 *
 * This is what makes the registry trustworthy: the hash is always derived
 * from `template` at definition time, never hand-typed, so a hash can never
 * silently drift out of sync with the text it describes.
 */
export function hashPrompt(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
