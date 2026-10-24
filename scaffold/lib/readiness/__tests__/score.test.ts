import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scoreReadiness,
  DIMENSION_META,
  IDEAL_ANSWERS,
  MAX_GRADE,
  type ReadinessAnswers,
} from "../score";

/**
 * Grant Readiness Score — pure scoring core. The function is total and
 * deterministic, so these assert the grade math, the verdict thresholds
 * (which are blocker-driven, not purely numeric), and the highest-leverage
 * fix selection (prerequisite order).
 */

function answers(overrides: Partial<ReadinessAnswers> = {}): ReadinessAnswers {
  return { ...IDEAL_ANSWERS, ...overrides };
}

test("dimension weights sum to exactly the max grade (100)", () => {
  const total = Object.values(DIMENSION_META).reduce((s, d) => s + d.weight, 0);
  assert.equal(total, MAX_GRADE);
  assert.equal(total, 100);
});

test("fully-ready answers score 100, verdict ready, no top fix", () => {
  const r = scoreReadiness(IDEAL_ANSWERS);
  assert.equal(r.grade, 100);
  assert.equal(r.verdict.level, "ready");
  assert.equal(r.topFix, null);
  assert.ok(r.dimensions.every((d) => d.status === "ready"));
});

test("grade never exceeds 100 and never drops below 0", () => {
  const worst = scoreReadiness(
    answers({
      entityFormed: "no",
      usSmallBusiness: "no",
      samStatus: "not_started",
      hasUei: "no",
      rdComponent: "no",
      commercialization: "no",
      fundingTarget: "unsure",
    }),
  );
  // Only the "no"/"unsure" partials contribute: commercialization no = 0,
  // funding unsure = round(5*0.4)=2. Everything else zero.
  assert.equal(worst.grade, 2);
  assert.ok(worst.grade >= 0 && worst.grade <= 100);
});

test("a hard-gate blocker caps the verdict at 'blocked' even with an otherwise strong profile", () => {
  // Everything ideal EXCEPT SAM not started — a guaranteed rejection.
  const r = scoreReadiness(answers({ samStatus: "not_started" }));
  assert.equal(r.verdict.level, "blocked");
  // Grade is still high (only the 25-pt SAM gate is lost) — proving the verdict
  // is blocker-driven, not a naive numeric threshold.
  assert.equal(r.grade, 75);
  assert.match(r.verdict.headline, /registration-ready/i);
});

test("verdict prerequisite chain: entity outranks eligibility outranks SAM", () => {
  // All three hard gates fail — the banner must speak to the earliest one.
  const r = scoreReadiness(
    answers({ entityFormed: "no", usSmallBusiness: "no", samStatus: "not_started" }),
  );
  assert.equal(r.verdict.level, "blocked");
  assert.match(r.verdict.headline, /legally formed entity/i);
  // ...and the highest-leverage fix is the entity, not SAM (higher weight) —
  // because fixing prerequisites first is the real leverage.
  assert.equal(r.topFix?.label, DIMENSION_META.entityFormed.label);
});

test("SAM in progress -> in_progress verdict and ~40% partial credit", () => {
  const r = scoreReadiness(answers({ samStatus: "in_progress" }));
  assert.equal(r.verdict.level, "in_progress");
  const sam = r.dimensions.find((d) => d.key === "samStatus")!;
  assert.equal(sam.status, "in_progress");
  assert.equal(sam.earned, Math.round(DIMENSION_META.samStatus.weight * 0.4)); // 10
  assert.equal(r.grade, 100 - DIMENSION_META.samStatus.weight + sam.earned); // 85
});

test("missing UEI (registration otherwise clear) -> in_progress verdict, UEI top fix", () => {
  const r = scoreReadiness(answers({ hasUei: "no" }));
  assert.equal(r.verdict.level, "in_progress");
  assert.equal(r.topFix?.label, DIMENSION_META.hasUei.label);
  assert.equal(r.grade, 90);
});

test("registration fully clear but no R&D -> still 'ready' (R&D only gates SBIR/STTR)", () => {
  const r = scoreReadiness(answers({ rdComponent: "no" }));
  assert.equal(r.verdict.level, "ready");
  const rd = r.dimensions.find((d) => d.key === "rdComponent")!;
  assert.equal(rd.status, "blocker");
  // The top fix nudges the R&D story since registration is already clear.
  assert.equal(r.topFix?.label, DIMENSION_META.rdComponent.label);
});

test("every not-ready dimension carries a non-empty fix action; ready ones are empty", () => {
  const r = scoreReadiness(
    answers({ samStatus: "in_progress", rdComponent: "somewhat", commercialization: "no" }),
  );
  for (const d of r.dimensions) {
    if (d.status === "ready") assert.equal(d.fixAction, "");
    else assert.ok(d.fixAction.length > 0, `${d.key} should have a fix action`);
  }
});

test("the three hard gates are exactly entity, small business, and SAM", () => {
  const r = scoreReadiness(IDEAL_ANSWERS);
  const hard = r.dimensions.filter((d) => d.hardGate).map((d) => d.key).sort();
  assert.deepEqual(hard, ["entityFormed", "samStatus", "usSmallBusiness"]);
  // ...and they carry the majority of the grade (rejection-causing weightiest).
  const hardWeight = r.dimensions.filter((d) => d.hardGate).reduce((s, d) => s + d.weight, 0);
  assert.ok(hardWeight > 50, "hard gates should weigh more than half the grade");
});
