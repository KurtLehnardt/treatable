import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import {
  BANNED_PHRASES,
  findBannedPhrases,
  checkBannedPhrasingsInSource,
  checkBannedPhrasingsInFile,
} from "../check-prompt-registry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(HERE, "..", "..", "lib", "prompts", "registry.ts");

/**
 * C2 — the banned-phrasings half of `check:prompts` (extends the existing
 * check-prompt-registry.mjs machinery rather than a parallel linter).
 * Proves both directions: PASSES on the real, current registry; FAILS on a
 * seeded bad phrase, so the check has actual teeth.
 */
describe("check-prompt-registry: banned-phrasings check", () => {
  test("findBannedPhrases: clean, hedged language (the wording the prompts actually use) has no hits", () => {
    const clean =
      'Use "appears to align", "you may qualify", "verify with the program officer".';
    assert.deepEqual(findBannedPhrases(clean), []);
  });

  test("findBannedPhrases: FAILS (returns hits) on each seeded bad phrase", () => {
    assert.deepEqual(findBannedPhrases("Great news — you are eligible for this program."), [
      "you are eligible",
    ]);
    assert.deepEqual(findBannedPhrases("You qualify for this grant."), ["you qualify"]);
    assert.deepEqual(findBannedPhrases("Funding is guaranteed once you apply."), [
      "guaranteed",
    ]);
    assert.deepEqual(findBannedPhrases("You will receive up to $500,000."), [
      "you will receive",
    ]);
  });

  test("findBannedPhrases: match is case-insensitive", () => {
    assert.deepEqual(findBannedPhrases("YOU ARE ELIGIBLE."), ["you are eligible"]);
  });

  test("checkBannedPhrasingsInSource: FAILS on a seeded bad phrase inside a *_TEMPLATE const", () => {
    const badSource = `
      const FOO_TEMPLATE = "Congratulations — you are eligible for this award.";
      export const PROMPT_REGISTRY = { foo: FOO_TEMPLATE };
    `;
    const violations = checkBannedPhrasingsInSource(badSource, "/fake/lib/prompts/registry.ts");
    assert.ok(violations.length > 0, "expected the seeded bad phrase to be flagged");
    assert.match(violations[0].reason, /you are eligible/);
    assert.match(violations[0].reason, /FOO_TEMPLATE/);
  });

  test("checkBannedPhrasingsInSource: a clean *_TEMPLATE const produces no violations", () => {
    const goodSource = `
      const FOO_TEMPLATE = "This program appears to align with your work; verify with the program officer.";
    `;
    assert.deepEqual(checkBannedPhrasingsInSource(goodSource, "/fake/lib/prompts/registry.ts"), []);
  });

  test("checkBannedPhrasingsInSource: only scans *_TEMPLATE-suffixed consts, not arbitrary strings", () => {
    const source = `const UNRELATED_CONST = "you are eligible for a discount";`;
    assert.deepEqual(checkBannedPhrasingsInSource(source, "/fake/file.ts"), []);
  });

  test("checkBannedPhrasingsInFile: the REAL, current lib/prompts/registry.ts is clean (the check PASSES on the current/updated prompts)", () => {
    const violations = checkBannedPhrasingsInFile(REGISTRY_PATH);
    assert.deepEqual(
      violations,
      [],
      `expected no banned phrasings in lib/prompts/registry.ts, found: ${JSON.stringify(violations)}`,
    );
  });

  test("BANNED_PHRASES includes the spec examples", () => {
    for (const phrase of ["you qualify", "you are eligible", "guaranteed", "you will receive"]) {
      assert.ok(BANNED_PHRASES.includes(phrase), `expected BANNED_PHRASES to include "${phrase}"`);
    }
  });
});
