import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ensureRealRedirects,
  UTAH_SBA_PROGRAMS,
  MIN_REAL_REDIRECTS,
  MAX_REDIRECTS,
  type WeakFieldFinding,
} from "../utahSbaPrograms";

/**
 * F3 — hermetic, pure-function tests. No network, no LLM, no `lib/claude.ts`
 * import: `ensureRealRedirects` is exercised directly against hand-built
 * findings, exactly the shape `explainWeakField` returns.
 */

const curatedLabels = new Set(UTAH_SBA_PROGRAMS.map((p) => p.label));

function finding(redirects: WeakFieldFinding["redirects"]): WeakFieldFinding {
  return {
    headline: "No strong federal match yet",
    reasoning: "Early for the programs in scope.",
    redirects,
  };
}

test("UTAH_SBA_PROGRAMS: every curated entry is a real, non-empty label + why with an official URL", () => {
  assert.ok(UTAH_SBA_PROGRAMS.length >= MIN_REAL_REDIRECTS);
  for (const p of UTAH_SBA_PROGRAMS) {
    assert.ok(p.label.trim().length > 0, "label must not be empty");
    assert.ok(p.why.trim().length > 0, "why must not be empty");
    assert.match(p.why, /https:\/\//, `"${p.label}" why should cite an official URL`);
  }
  // Labels are unique — no duplicate program entries in the curated list.
  const labels = UTAH_SBA_PROGRAMS.map((p) => p.label);
  assert.equal(new Set(labels).size, labels.length);
});

test("injects >=2 real named programs when the model returned zero redirects", () => {
  const result = ensureRealRedirects(finding([]));
  const realCount = result.redirects.filter((r) => curatedLabels.has(r.label)).length;
  assert.ok(realCount >= MIN_REAL_REDIRECTS, `expected >=${MIN_REAL_REDIRECTS} real redirects, got ${realCount}`);
  assert.ok(result.redirects.length <= MAX_REDIRECTS);
});

test("injects >=2 real named programs on top of the model's own (category-shaped) redirects", () => {
  const result = ensureRealRedirects(
    finding([
      { label: "SBA programs", why: "General small-business support." },
      { label: "State economic development", why: "Worth exploring state-level incentives." },
    ]),
  );
  const realCount = result.redirects.filter((r) => curatedLabels.has(r.label)).length;
  assert.ok(realCount >= MIN_REAL_REDIRECTS);
  // The model's own suggestions are preserved (not silently dropped) when room allows.
  assert.ok(result.redirects.some((r) => r.label === "SBA programs"));
  assert.ok(result.redirects.some((r) => r.label === "State economic development"));
  assert.ok(result.redirects.length <= MAX_REDIRECTS);
});

test("dedupes: a curated program the model already named is not duplicated", () => {
  const already = UTAH_SBA_PROGRAMS[0];
  const result = ensureRealRedirects(
    finding([{ label: already.label, why: "The model's own phrasing of this program." }]),
  );
  const occurrences = result.redirects.filter((r) => r.label === already.label);
  assert.equal(occurrences.length, 1, "the curated program must appear exactly once, not duplicated");

  const realCount = result.redirects.filter((r) => curatedLabels.has(r.label)).length;
  assert.ok(realCount >= MIN_REAL_REDIRECTS, "still tops up to the real-redirect floor using OTHER curated programs");
});

test("dedupes case/whitespace-insensitively", () => {
  const already = UTAH_SBA_PROGRAMS[1];
  const noisyLabel = `  ${already.label.toUpperCase()}  `.replace(/\s+/g, " ");
  const result = ensureRealRedirects(finding([{ label: noisyLabel, why: "model phrasing" }]));
  const occurrences = result.redirects.filter((r) => r.label.trim().toLowerCase() === already.label.toLowerCase());
  assert.equal(occurrences.length, 1);
});

test("already >= MIN_REAL_REDIRECTS curated programs present: no extra ones are appended", () => {
  const [a, b] = UTAH_SBA_PROGRAMS;
  const result = ensureRealRedirects(
    finding([
      { label: a.label, why: "model phrasing a" },
      { label: b.label, why: "model phrasing b" },
    ]),
  );
  const realCount = result.redirects.filter((r) => curatedLabels.has(r.label)).length;
  assert.equal(realCount, 2);
  assert.equal(result.redirects.length, 2);
});

test("never exceeds MAX_REDIRECTS even when the model already sent a full 5", () => {
  const result = ensureRealRedirects(
    finding([
      { label: "Model redirect 1", why: "a" },
      { label: "Model redirect 2", why: "b" },
      { label: "Model redirect 3", why: "c" },
      { label: "Model redirect 4", why: "d" },
      { label: "Model redirect 5", why: "e" },
    ]),
  );
  assert.ok(result.redirects.length <= MAX_REDIRECTS);
  const realCount = result.redirects.filter((r) => curatedLabels.has(r.label)).length;
  assert.ok(realCount >= MIN_REAL_REDIRECTS, "the real-program guarantee must survive the cap trim");
});

test("guaranteed real programs are never trimmed to enforce the cap — the model's own entries are trimmed first", () => {
  const result = ensureRealRedirects(
    finding([
      { label: "Model redirect 1", why: "a" },
      { label: "Model redirect 2", why: "b" },
      { label: "Model redirect 3", why: "c" },
      { label: "Model redirect 4", why: "d" },
      { label: "Model redirect 5", why: "e" },
    ]),
  );
  assert.ok(result.redirects.some((r) => curatedLabels.has(r.label)));
  assert.equal(result.redirects.length, MAX_REDIRECTS);
});

test("is pure: does not mutate the input finding or its redirects array", () => {
  const input = finding([{ label: "SBA programs", why: "General support." }]);
  const inputSnapshot = JSON.parse(JSON.stringify(input));
  ensureRealRedirects(input);
  assert.deepEqual(input, inputSnapshot);
});

test("passes through headline/reasoning unchanged", () => {
  const input = finding([]);
  const result = ensureRealRedirects(input);
  assert.equal(result.headline, input.headline);
  assert.equal(result.reasoning, input.reasoning);
});

test("treats a missing/undefined redirects array as empty and still guarantees the floor", () => {
  const input = { headline: "h", reasoning: "r" } as unknown as WeakFieldFinding;
  const result = ensureRealRedirects(input);
  const realCount = result.redirects.filter((r) => curatedLabels.has(r.label)).length;
  assert.ok(realCount >= MIN_REAL_REDIRECTS);
});
