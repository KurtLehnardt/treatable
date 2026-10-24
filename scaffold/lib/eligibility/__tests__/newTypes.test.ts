import { test } from "node:test";
import assert from "node:assert/strict";
import { screen, type ScreenableOpportunity } from "../screen";
import { EligibilityDeterminationSchema } from "../../contracts/eligibilityDetermination";
import type { CompanyProfile } from "../../contracts/companyProfile";
import type { Provenance } from "../../contracts/primitives";

/**
 * ELG — the kind-scoped universal overlay for the loan / scholarship /
 * procurement instrument types (C3). Each new kind must BUCKET CORRECTLY and,
 * because the kind gates are authoritative-CITED but UNREVIEWED, must NEVER land
 * a v1-corpus opportunity in `excluded` (R8.4). Pure logic, no LLM/DB.
 */

function pf<T>(value: T, provenance: Provenance = "user_stated", confidence = 1) {
  return { value, provenance, confidence };
}

function profile(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    id: "profile-1",
    raw_text: pf("We build software.", "user_stated"),
    interview_answers: [],
    ...overrides,
  };
}

let n = 0;
function opp(kind: ScreenableOpportunity["kind"], over: Partial<ScreenableOpportunity> = {}): ScreenableOpportunity {
  n += 1;
  return { id: `opp-${n}`, program: "Test Program", title: "Test Program", kind, ...over };
}

/** Schema-valid AND never a false/model_inferred-only exclusion (R8.4). */
function assertSafe(d: ReturnType<typeof screen>) {
  assert.doesNotThrow(() => EligibilityDeterminationSchema.parse(d));
  if (d.bucket === "excluded") {
    assert.ok(d.failed_rules.length > 0, "excluded must cite a failed rule");
    assert.ok(d.failed_rules.some((r) => r.provenance !== "model_inferred"), "excluded not solely model_inferred");
  }
  return d;
}

// --- LOAN (SBA "organized for profit", 13 CFR 120.100) ---------------------

test("[loan] a for-profit small business, SAM-registered → eligible (for-profit gate satisfied)", () => {
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      opp("loan"),
    ),
  );
  assert.equal(d.bucket, "eligible");
  assert.ok(d.satisfied_rules.some((r) => r.rule_id === "universal-loan-for-profit"));
});

test("[loan] a for-profit business without SAM → conditionally_eligible (a SAM step, never excluded)", () => {
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_other", "user_stated"),
        sam_registered: pf(false, "user_stated"),
      }),
      opp("loan"),
    ),
  );
  assert.equal(d.bucket, "conditionally_eligible");
  assert.ok(d.required_steps.some((s) => /SAM\.gov/.test(s.step)));
  assert.equal(d.failed_rules.length, 0);
});

test("[loan] a NONPROFIT (would fail the for-profit gate) → unknown, NEVER excluded (unreviewed gate, R8.4)", () => {
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("nonprofit", "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      opp("loan"),
    ),
  );
  assert.notEqual(d.bucket, "excluded");
  assert.equal(d.bucket, "unknown");
  assert.equal(d.failed_rules.length, 0);
  assert.ok(d.unknown_rules.some((r) => r.rule_id === "universal-loan-for-profit"));
});

test("[loan] entity_type unset → unknown (a hard gate the profile doesn't settle — never guessed)", () => {
  const d = assertSafe(
    screen(profile({ sam_registered: pf(true, "user_stated") }), opp("loan")),
  );
  assert.equal(d.bucket, "unknown");
  assert.equal(d.failed_rules.length, 0);
});

// --- SCHOLARSHIP (individual award, 34 CFR 75.62) --------------------------

test("[scholarship] an individual applicant, SAM-registered → eligible", () => {
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("individual", "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      opp("scholarship"),
    ),
  );
  assert.equal(d.bucket, "eligible");
  assert.ok(d.satisfied_rules.some((r) => r.rule_id === "universal-scholarship-individual"));
});

test("[scholarship] a COMPANY (not an individual) → unknown, NEVER excluded (unreviewed gate, R8.4)", () => {
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      opp("scholarship"),
    ),
  );
  assert.notEqual(d.bucket, "excluded");
  assert.equal(d.bucket, "unknown");
  assert.equal(d.failed_rules.length, 0);
  assert.ok(d.unknown_rules.some((r) => r.rule_id === "universal-scholarship-individual"));
});

// --- PROCUREMENT (federal contract, FAR 52.204-7) --------------------------

test("[procurement] no SAM → conditionally_eligible with the FAR-cited SAM step (never excluded)", () => {
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        sam_registered: pf(false, "user_stated"),
      }),
      opp("procurement"),
    ),
  );
  assert.equal(d.bucket, "conditionally_eligible");
  assert.ok(d.required_steps.some((s) => /SAM\.gov/.test(s.step)));
  assert.equal(d.failed_rules.length, 0);
});

test("[procurement] SAM-registered → eligible; and it never picks up the loan/scholarship/SBIR gates", () => {
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      opp("procurement"),
    ),
  );
  assert.equal(d.bucket, "eligible");
  const seen = [...d.satisfied_rules, ...d.unknown_rules, ...d.failed_rules].map((r) => r.rule_id);
  assert.ok(!seen.some((id) => id === "universal-loan-for-profit"));
  assert.ok(!seen.some((id) => id === "universal-scholarship-individual"));
  assert.ok(!seen.some((id) => id.startsWith("universal-sbir")));
  // It carries the FAR (contract) SAM gate, not the 2 CFR financial-assistance one.
  assert.ok(d.satisfied_rules.some((r) => r.rule_id === "universal-procurement-registration"));
  assert.ok(!seen.some((id) => id === "universal-sam-registration"));
});
