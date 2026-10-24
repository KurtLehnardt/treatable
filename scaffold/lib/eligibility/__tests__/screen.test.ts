import { test } from "node:test";
import assert from "node:assert/strict";
import {
  screen,
  fromEligibilityRule,
  safeCategoryPredicate,
  type ScreeningRule,
  type ScreenableOpportunity,
} from "../screen";
import { EligibilityDeterminationSchema } from "../../contracts/eligibilityDetermination";
import type { CompanyProfile } from "../../contracts/companyProfile";
import type { EligibilityRule, EligibilityRuleCategory } from "../../contracts/opportunity";
import type { Provenance } from "../../contracts/primitives";

/**
 * ELG-01 unit tests — pure logic over the frozen golden set's eligibility cases
 * (orchestrator §5.4). The primary metric is ZERO FALSE EXCLUSIONS (EVL-03):
 * every scenario that is not a legitimate, reviewed-rule exclusion must land in
 * some bucket OTHER than `excluded`.
 *
 * Fixtures only — no live DB, no LLM.
 */

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** A provenanced profile field. */
function pf<T>(value: T, provenance: Provenance = "user_stated", confidence = 1) {
  return { value, provenance, confidence };
}

/** Build a valid CompanyProfile with sensible defaults + overrides. */
function profile(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    id: "profile-1",
    raw_text: pf("We build software.", "user_stated"),
    interview_answers: [],
    ...overrides,
  };
}

let oppCounter = 0;
function opp(over: Partial<ScreenableOpportunity> = {}): ScreenableOpportunity {
  oppCounter += 1;
  return {
    id: `opp-${oppCounter}`,
    program: "Test Grant Program",
    title: "Test Grant Program",
    ...over,
  };
}

/** A reviewed (human-verified) rule — the only kind that may drive exclusion. */
function verifiedRule(over: Partial<ScreeningRule> & Pick<ScreeningRule, "id" | "category" | "description" | "predicate">): ScreeningRule {
  return {
    provenance: "verified",
    citation: {
      source_url: "https://www.grants.gov/example",
      source_name: "Example NOFO",
      quote: "Eligibility is limited as stated.",
    },
    ...over,
  };
}

/** A model_inferred rule (what CAN-04 writes) — must NEVER drive exclusion. */
function inferredRule(over: Partial<ScreeningRule> & Pick<ScreeningRule, "id" | "category" | "description" | "predicate">): ScreeningRule {
  return {
    provenance: "model_inferred",
    citation: {
      source_url: "https://www.grants.gov/example",
      source_name: "Example NOFO (model-extracted)",
      quote: "some inferred clause",
    },
    ...over,
  };
}

/** Assert a determination is schema-valid AND never a bad exclusion (R8.4). */
function assertSafe(d: ReturnType<typeof screen>) {
  // Round-trips through the CON-01 schema (screen() already parses, belt-and-braces).
  assert.doesNotThrow(() => EligibilityDeterminationSchema.parse(d));
  if (d.bucket === "excluded") {
    assert.ok(d.failed_rules.length > 0, "excluded must cite a failed rule (R8.2)");
    assert.ok(
      d.failed_rules.some((r) => r.provenance !== "model_inferred"),
      "excluded must not rest solely on model_inferred rules (R8.4)",
    );
  }
  return d;
}

// ---------------------------------------------------------------------------
// GOLDEN CASE 1 — nonprofit → excluded (cited, reviewed rule)
// ---------------------------------------------------------------------------

test("nonprofit against a higher-ed-only NOFO → excluded, with the cited rule", () => {
  const rule = verifiedRule({
    id: "rule-highered-only",
    category: "entity_type",
    description: "This program is limited to institutions of higher education.",
    predicate: { kind: "entity_type_in", allowed: ["higher_education"] },
  });
  const d = assertSafe(
    screen(profile({ entity_type: pf("nonprofit", "user_stated") }), opp(), [rule]),
  );
  assert.equal(d.bucket, "excluded");
  assert.equal(d.failed_rules.length, 1);
  assert.equal(d.failed_rules[0].rule_id, "rule-highered-only");
  // Reason + citation are always shown (never a silent/opaque exclusion).
  assert.ok(d.failed_rules[0].citation?.source_url, "exclusion cites its source");
  assert.notEqual(d.failed_rules[0].provenance, "model_inferred");
});

// ---------------------------------------------------------------------------
// GOLDEN CASE 2 — foreign-owned → excluded (reviewed US-ownership rule)
// ---------------------------------------------------------------------------

test("foreign-owned against a reviewed US-ownership NOFO → excluded", () => {
  const rule = verifiedRule({
    id: "rule-us-owned",
    category: "size_ownership",
    description: "Applicants must be majority owned by U.S. citizens or permanent residents.",
    predicate: { kind: "us_ownership_required" },
  });
  const d = assertSafe(
    screen(profile({ us_owned: pf(false, "user_stated") }), opp(), [rule]),
  );
  assert.equal(d.bucket, "excluded");
  assert.equal(d.failed_rules[0].rule_id, "rule-us-owned");
});

// ---------------------------------------------------------------------------
// GOLDEN CASE 3 — no SAM registration → conditionally_eligible (a step)
// ---------------------------------------------------------------------------

test("no SAM registration → conditional with a SAM.gov step + lead time (never excluded)", () => {
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        sam_registered: pf(false, "user_stated"),
      }),
      opp(), // universal SAM gate applies to all federal grants
      [], // no per-opp rules
    ),
  );
  assert.equal(d.bucket, "conditionally_eligible");
  assert.equal(d.required_steps.length, 1);
  assert.match(d.required_steps[0].step, /SAM\.gov/);
  assert.ok(
    typeof d.required_steps[0].lead_time_days === "number" && d.required_steps[0].lead_time_days > 0,
    "the step shows its lead time",
  );
  assert.equal(d.failed_rules.length, 0);
});

test("SAM registration already active → satisfied, no step, eligible", () => {
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      opp(),
      [], // non-SBIR, no per-opp gates
    ),
  );
  assert.equal(d.bucket, "eligible");
  assert.equal(d.required_steps.length, 0);
  assert.ok(d.satisfied_rules.some((r) => r.category === "registration"));
});

// ---------------------------------------------------------------------------
// GOLDEN CASE 4 — model_inferred rule alone → NOT excluded (R8.4)
// ---------------------------------------------------------------------------

test("a failing model_inferred rule NEVER excludes — even with a user_stated fact", () => {
  const rule = inferredRule({
    id: "rule-inferred-entity",
    category: "entity_type",
    description: "Appears limited to higher education (model-extracted, unreviewed).",
    predicate: { kind: "entity_type_in", allowed: ["higher_education"] },
  });
  const d = assertSafe(
    screen(profile({ entity_type: pf("nonprofit", "user_stated") }), opp(), [rule]),
  );
  assert.notEqual(d.bucket, "excluded"); // the crown-jewel invariant
  assert.equal(d.bucket, "unknown"); // surfaced for review, not acted on
  assert.equal(d.failed_rules.length, 0);
  assert.ok(
    d.unknown_rules.some((r) => r.rule_id === "rule-inferred-entity"),
    "the unreviewed rule is surfaced (never silently dropped)",
  );
});

// ---------------------------------------------------------------------------
// GOLDEN CASE 5 — unknown gate → unknown (never guessed)
// ---------------------------------------------------------------------------

test("reviewed gate the profile doesn't settle → unknown (not guessed either way)", () => {
  const rule = verifiedRule({
    id: "rule-highered-only-2",
    category: "entity_type",
    description: "This program is limited to institutions of higher education.",
    predicate: { kind: "entity_type_in", allowed: ["higher_education"] },
  });
  // Profile has NO entity_type at all.
  const d = assertSafe(screen(profile(), opp(), [rule]));
  assert.equal(d.bucket, "unknown");
  assert.equal(d.failed_rules.length, 0);
  assert.ok(d.unknown_rules.some((r) => r.rule_id === "rule-highered-only-2"));
});

// ---------------------------------------------------------------------------
// R8.2 — a model_inferred PROFILE FACT is never sufficient to exclude
// ---------------------------------------------------------------------------

test("reviewed rule + model_inferred failing fact → unknown, not excluded (R8.2)", () => {
  const rule = verifiedRule({
    id: "rule-us-owned-2",
    category: "size_ownership",
    description: "Applicants must be majority U.S.-owned.",
    predicate: { kind: "us_ownership_required" },
  });
  // The fact that would fail was itself only INFERRED.
  const d = assertSafe(
    screen(profile({ us_owned: pf(false, "model_inferred") }), opp(), [rule]),
  );
  assert.notEqual(d.bucket, "excluded");
  assert.equal(d.bucket, "unknown");
});

// ---------------------------------------------------------------------------
// R8.4 — the universal overlay never hard-excludes (SBIR size/ownership)
// ---------------------------------------------------------------------------

const SBIR_OPP: () => ScreenableOpportunity = () =>
  opp({ program: "SBIR Phase I", title: "DoD SBIR Phase I Topic" });

test("SBIR opp + foreign-owned via the UNIVERSAL ownership gate → unknown, not excluded", () => {
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        us_owned: pf(false, "user_stated"),
        employee_count: pf(10, "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      SBIR_OPP(),
      [], // only the universal SBIR overlay applies
    ),
  );
  assert.notEqual(d.bucket, "excluded"); // authoritative-but-unreviewed → informs only
  assert.equal(d.bucket, "unknown");
  assert.ok(d.unknown_rules.some((r) => r.rule_id === "universal-sbir-ownership"));
});

test("SBIR opp + >500 employees via the UNIVERSAL size gate → unknown, not excluded", () => {
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        us_owned: pf(true, "user_stated"),
        employee_count: pf(5000, "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      SBIR_OPP(),
      [],
    ),
  );
  assert.notEqual(d.bucket, "excluded");
  assert.equal(d.bucket, "unknown");
  assert.ok(d.unknown_rules.some((r) => r.rule_id === "universal-sbir-size"));
});

test("SBIR opp, US-owned small team, SAM active → eligible", () => {
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        us_owned: pf(true, "user_stated"),
        employee_count: pf(10, "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      SBIR_OPP(),
      [],
    ),
  );
  assert.equal(d.bucket, "eligible");
});

test("universal SBIR gates do NOT apply to a non-SBIR grant", () => {
  // us_owned unknown would make an SBIR opp `unknown`; a plain grant ignores it.
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      opp({ program: "Community Development Block Grant", title: "CDBG" }),
      [],
    ),
  );
  assert.equal(d.bucket, "eligible");
});

// ---------------------------------------------------------------------------
// Bucket precedence + program-specific + certification gates
// ---------------------------------------------------------------------------

test("a real exclusion outranks an unmet registration step (excluded wins)", () => {
  const rule = verifiedRule({
    id: "rule-highered-only-3",
    category: "entity_type",
    description: "Limited to institutions of higher education.",
    predicate: { kind: "entity_type_in", allowed: ["higher_education"] },
  });
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("nonprofit", "user_stated"),
        sam_registered: pf(false, "user_stated"), // would be a step
      }),
      opp(),
      [rule],
    ),
  );
  assert.equal(d.bucket, "excluded");
});

test("Phase II prior-award prerequisite unmet (reviewed) → excluded", () => {
  const rule = verifiedRule({
    id: "rule-phase2",
    category: "program_specific",
    description: "Phase II requires a prior Phase I award.",
    predicate: { kind: "prior_award_required" },
  });
  const d = assertSafe(
    screen(profile({ prior_federal_funding: pf(false, "user_stated") }), opp(), [rule]),
  );
  assert.equal(d.bucket, "excluded");
  assert.equal(d.failed_rules[0].rule_id, "rule-phase2");
});

test("certification gate satisfied → eligible; unknown when unstated", () => {
  const rule = verifiedRule({
    id: "rule-8a",
    category: "program_specific",
    description: "Reserved for 8(a) participants.",
    predicate: { kind: "certification_required", any_of: ["8a"] },
  });
  const eligible = assertSafe(
    screen(
      profile({
        certifications: pf(["8a"], "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      opp(),
      [rule],
    ),
  );
  assert.equal(eligible.bucket, "eligible");

  const unknownWhenUnstated = assertSafe(screen(profile(), opp(), [rule]));
  assert.equal(unknownWhenUnstated.bucket, "unknown");
});

// ---------------------------------------------------------------------------
// Never silently drop + advisory prose handling
// ---------------------------------------------------------------------------

test("every screen returns a determination for the opportunity (never dropped)", () => {
  const d = assertSafe(screen(profile(), opp(), []));
  assert.ok(d.opportunity_id);
});

test("a model_inferred rule WITHOUT a predicate is advisory — never downgrades a clear opp", () => {
  const advisory = inferredRule({
    id: "rule-prose",
    category: "other",
    description: "Some free-text clause the extractor could not structure.",
    predicate: undefined as never, // no recognized predicate
  });
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      opp(),
      [advisory],
    ),
  );
  assert.equal(d.bucket, "eligible");
});

// ---------------------------------------------------------------------------
// ZERO FALSE EXCLUSIONS — the primary EVL-03 metric, swept exhaustively
// ---------------------------------------------------------------------------

test("ZERO false exclusions: no non-reviewed scenario ever produces `excluded`", () => {
  const scenarios: Array<{ name: string; run: () => ReturnType<typeof screen> }> = [
    {
      name: "model_inferred rule + failing user_stated fact",
      run: () =>
        screen(profile({ entity_type: pf("nonprofit", "user_stated") }), opp(), [
          inferredRule({
            id: "mi-1",
            category: "entity_type",
            description: "inferred higher-ed-only",
            predicate: { kind: "entity_type_in", allowed: ["higher_education"] },
          }),
        ]),
    },
    {
      name: "reviewed rule + failing MODEL-INFERRED fact",
      run: () =>
        screen(profile({ us_owned: pf(false, "model_inferred") }), opp(), [
          verifiedRule({
            id: "v-1",
            category: "size_ownership",
            description: "US-owned required",
            predicate: { kind: "us_ownership_required" },
          }),
        ]),
    },
    {
      name: "universal SBIR ownership (foreign-owned, user_stated)",
      run: () =>
        screen(profile({ us_owned: pf(false, "user_stated") }), SBIR_OPP(), []),
    },
    {
      name: "universal SBIR size (>500, user_stated)",
      run: () =>
        screen(profile({ employee_count: pf(9999, "user_stated") }), SBIR_OPP(), []),
    },
    {
      name: "unmet SAM registration (a step, not a bar)",
      run: () =>
        screen(profile({ sam_registered: pf(false, "user_stated") }), opp(), []),
    },
    {
      name: "reviewed gate with a MISSING fact (unknown)",
      run: () =>
        screen(profile(), opp(), [
          verifiedRule({
            id: "v-2",
            category: "entity_type",
            description: "higher-ed only",
            predicate: { kind: "entity_type_in", allowed: ["higher_education"] },
          }),
        ]),
    },
    {
      name: "empty rule set (nothing to exclude on)",
      run: () => screen(profile(), opp(), []),
    },
    {
      name: "advisory model_inferred prose, no predicate",
      run: () =>
        screen(profile({ sam_registered: pf(true, "user_stated") }), opp(), [
          inferredRule({
            id: "mi-2",
            category: "other",
            description: "unstructured prose",
            predicate: undefined as never,
          }),
        ]),
    },
  ];

  for (const s of scenarios) {
    const d = assertSafe(s.run());
    assert.notEqual(d.bucket, "excluded", `FALSE EXCLUSION in: ${s.name}`);
  }
});

test("the ONLY excluding scenarios are reviewed-rule + trustworthy-fail — and they validate", () => {
  const legit = [
    screen(profile({ entity_type: pf("nonprofit", "user_stated") }), opp(), [
      verifiedRule({
        id: "e-1",
        category: "entity_type",
        description: "higher-ed only",
        predicate: { kind: "entity_type_in", allowed: ["higher_education"] },
      }),
    ]),
    screen(profile({ us_owned: pf(false, "user_stated") }), opp(), [
      verifiedRule({
        id: "e-2",
        category: "size_ownership",
        description: "US-owned required",
        predicate: { kind: "us_ownership_required" },
      }),
    ]),
  ];
  for (const d of legit) {
    assertSafe(d);
    assert.equal(d.bucket, "excluded");
    // Every excluding failed_rule is human-reviewed (never model_inferred).
    for (const fr of d.failed_rules) {
      assert.notEqual(fr.provenance, "model_inferred");
    }
  }
});

// ---------------------------------------------------------------------------
// ELG-03 additive edge cases (fixture-only) — strengthen coverage without
// weakening any existing assertion. Mirror the shapes ELG-03's live-DB
// integration test exercises, plus a few untested predicate branches.
// ---------------------------------------------------------------------------

test("[edge] DB-shaped per-opp rule (model_inferred, NO predicate, _origin per_opp) is advisory — never gates", () => {
  // This is exactly how a real `eligibility_rules` row maps into the engine:
  // model_inferred prose, no structured predicate, _origin "per_opp".
  const dbRule = inferredRule({
    id: "db-rule-1",
    category: "program_specific",
    description: "Applicants should demonstrate a strong commercialization plan.",
    predicate: undefined as never,
    _origin: "per_opp",
  });
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      opp(),
      [dbRule],
    ),
  );
  // Predicate-less model_inferred prose must never downgrade a clear opp, and
  // must appear in neither failed_rules nor unknown_rules.
  assert.equal(d.bucket, "eligible");
  assert.equal(d.failed_rules.length, 0);
  assert.ok(!d.unknown_rules.some((r) => r.rule_id === "db-rule-1"));
});

test("[edge] a whole SET of predicate-less model_inferred rules never excludes (mirrors real corpus)", () => {
  const rules = [
    inferredRule({ id: "mi-a", category: "entity_type", description: "Open to firms in the sector.", predicate: undefined as never, _origin: "per_opp" }),
    inferredRule({ id: "mi-b", category: "geography", description: "Preference for domestic applicants.", predicate: undefined as never, _origin: "per_opp" }),
    inferredRule({ id: "mi-c", category: "other", description: "Cost-share may apply.", predicate: undefined as never, _origin: "per_opp" }),
  ];
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("nonprofit", "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      opp(),
      rules,
    ),
  );
  assert.notEqual(d.bucket, "excluded");
  assert.equal(d.failed_rules.length, 0);
});

test("[edge] entity_type_not_in — reviewed disallow match → excluded; miss → eligible", () => {
  const rule = verifiedRule({
    id: "rule-not-individual",
    category: "entity_type",
    description: "Individuals are not eligible to apply.",
    predicate: { kind: "entity_type_not_in", disallowed: ["individual"] },
  });
  const excluded = assertSafe(
    screen(profile({ entity_type: pf("individual", "user_stated") }), opp(), [rule]),
  );
  assert.equal(excluded.bucket, "excluded");
  assert.equal(excluded.failed_rules[0].rule_id, "rule-not-individual");

  const ok = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      opp(),
      [rule],
    ),
  );
  assert.equal(ok.bucket, "eligible");
});

test("[edge] max_employees boundary — count == max passes; count == max+1 (reviewed) excludes", () => {
  const rule = verifiedRule({
    id: "rule-max-50",
    category: "size_ownership",
    description: "Applicants must have no more than 50 employees.",
    predicate: { kind: "max_employees", max: 50 },
  });
  const atLimit = assertSafe(
    screen(
      profile({
        employee_count: pf(50, "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      opp(),
      [rule],
    ),
  );
  assert.equal(atLimit.bucket, "eligible"); // <= max is a pass

  const overLimit = assertSafe(
    screen(profile({ employee_count: pf(51, "user_stated") }), opp(), [rule]),
  );
  assert.equal(overLimit.bucket, "excluded");
  assert.equal(overLimit.failed_rules[0].rule_id, "rule-max-50");
});

test("[edge] geography_in designation — reviewed mismatch → excluded; match → eligible; free-text only → unknown", () => {
  const rule = verifiedRule({
    id: "rule-hubzone",
    category: "geography",
    description: "Located in a HUBZone.",
    predicate: { kind: "geography_in", allowed_designations: ["hubzone"] },
  });
  const mismatch = assertSafe(
    screen(
      profile({ geography_designations: pf(["rural"], "user_stated") }),
      opp(),
      [rule],
    ),
  );
  assert.equal(mismatch.bucket, "excluded");
  assert.equal(mismatch.failed_rules[0].rule_id, "rule-hubzone");

  const match = assertSafe(
    screen(
      profile({
        geography_designations: pf(["HUBZone"], "user_stated"), // case-insensitive
        sam_registered: pf(true, "user_stated"),
      }),
      opp(),
      [rule],
    ),
  );
  assert.equal(match.bucket, "eligible");

  // No designations at all → the gate is indeterminate → unknown (never a guess).
  const unsettled = assertSafe(screen(profile(), opp(), [rule]));
  assert.equal(unsettled.bucket, "unknown");
});

test("[edge] SBIR opp + predicate-less model_inferred rules + unknown ownership → unknown, failed empty", () => {
  const dbRules = [
    inferredRule({ id: "sbir-mi-1", category: "program_specific", description: "Phase I topic scope.", predicate: undefined as never, _origin: "per_opp" }),
  ];
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        employee_count: pf(10, "user_stated"),
        sam_registered: pf(true, "user_stated"),
        // us_owned intentionally UNKNOWN → universal SBIR ownership gate → unknown
      }),
      SBIR_OPP(),
      dbRules,
    ),
  );
  assert.equal(d.bucket, "unknown");
  assert.equal(d.failed_rules.length, 0);
  assert.ok(d.unknown_rules.some((r) => r.rule_id === "universal-sbir-ownership"));
});

// ---------------------------------------------------------------------------
// [ADDED] uei_required predicate — eligible / excluded / unknown branches
// ---------------------------------------------------------------------------

test("[added] uei_required predicate: present → eligible, empty → excluded, absent → unknown", () => {
  const rule = verifiedRule({
    id: "rule-uei-required",
    category: "registration",
    description: "Applicants must have an active Unique Entity Identifier (UEI).",
    predicate: { kind: "uei_required" },
  });

  // SAM already registered too, so the universal registration step doesn't
  // itself hold the bucket down to `conditionally_eligible` here — this case
  // isolates the uei_required predicate's own pass verdict.
  const eligible = assertSafe(
    screen(
      profile({
        uei: pf("ABC123XYZ01", "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      opp(),
      [rule],
    ),
  );
  assert.equal(eligible.bucket, "eligible");

  const excluded = assertSafe(screen(profile({ uei: pf("", "user_stated") }), opp(), [rule]));
  assert.equal(excluded.bucket, "excluded");
  assert.equal(excluded.failed_rules.length, 1);
  assert.equal(excluded.failed_rules[0].rule_id, "rule-uei-required");

  const unsettled = assertSafe(screen(profile(), opp(), [rule]));
  assert.equal(unsettled.bucket, "unknown");
  assert.ok(unsettled.unknown_rules.some((r) => r.rule_id === "rule-uei-required"));
});

// ---------------------------------------------------------------------------
// [ADDED] certification_required — FAIL branch (no overlapping certification)
// ---------------------------------------------------------------------------

test("[added] certification_required predicate: held certifications don't overlap any_of → excluded", () => {
  const rule = verifiedRule({
    id: "rule-8a-only",
    category: "program_specific",
    description: "Reserved for 8(a) participants.",
    predicate: { kind: "certification_required", any_of: ["8a"] },
  });
  const d = assertSafe(
    screen(
      profile({ certifications: pf(["hubzone", "wosb"], "user_stated") }),
      opp(),
      [rule],
    ),
  );
  assert.equal(d.bucket, "excluded");
  assert.equal(d.failed_rules.length, 1);
  assert.equal(d.failed_rules[0].rule_id, "rule-8a-only");
});

// ---------------------------------------------------------------------------
// [ADDED] Bucket precedence — unknown outranks a pending conditional step
// ---------------------------------------------------------------------------

test("[added] an unresolved hard gate (unknown) outranks a pending SAM.gov step — and the step still shows", () => {
  const rule = verifiedRule({
    id: "rule-highered-precedence",
    category: "entity_type",
    description: "This program is limited to institutions of higher education.",
    predicate: { kind: "entity_type_in", allowed: ["higher_education"] },
  });
  const d = assertSafe(
    screen(
      profile({
        sam_registered: pf(false, "user_stated"), // triggers the universal conditional step
        // entity_type intentionally unset → unresolved reviewed hard gate → unknown
      }),
      opp(), // non-SBIR — only the universal SAM.gov conditional gate + this rule apply
      [rule],
    ),
  );
  assert.equal(d.bucket, "unknown");
  assert.notEqual(d.bucket, "conditionally_eligible");
  assert.ok(d.unknown_rules.some((r) => r.rule_id === "rule-highered-precedence"));
  // Precedence outranks the step for the BUCKET, but the step itself must
  // still be surfaced — it isn't cleared, just not what decides the bucket.
  assert.equal(d.required_steps.length, 1);
  assert.match(d.required_steps[0].step, /SAM\.gov/);
});

// ---------------------------------------------------------------------------
// [H10] predicate / reviewed-rule path — per-opp `EligibilityRule`s CAN now be
// structured into gating `ScreeningRule`s (conditional / unknown / — only when
// reviewed + a trustworthy fact — excluded), WITHOUT weakening any invariant.
// These exercise the NEW mechanism specifically: a CON-01 `EligibilityRule`
// (which carries NO predicate) flowing through `fromEligibilityRule(...)`.
// ---------------------------------------------------------------------------

/** A plain CON-01 `EligibilityRule` (no predicate — that's the point). */
function eligRule(
  over: Partial<EligibilityRule> & Pick<EligibilityRule, "id" | "category" | "description">,
): EligibilityRule {
  return {
    provenance: "verified",
    citation: {
      source_url: "https://www.grants.gov/example",
      source_name: "Example NOFO",
      quote: "Eligibility is limited as stated.",
    },
    ...over,
  };
}

test("[H10] REVIEWED EligibilityRule + supplied categorical predicate, failing a TRUSTWORTHY fact → excluded (cited)", () => {
  const rule = eligRule({
    id: "elg-highered-only",
    category: "entity_type",
    description: "This program is limited to institutions of higher education.",
    provenance: "verified",
  });
  // The reviewed-rule path: a rule-structuring/review layer supplies the predicate.
  const screening = fromEligibilityRule(rule, {
    predicate: { kind: "entity_type_in", allowed: ["higher_education"] },
  });
  const d = assertSafe(
    screen(profile({ entity_type: pf("nonprofit", "user_stated") }), opp(), [screening]),
  );
  assert.equal(d.bucket, "excluded");
  assert.equal(d.failed_rules.length, 1);
  assert.equal(d.failed_rules[0].rule_id, "elg-highered-only");
  assert.notEqual(d.failed_rules[0].provenance, "model_inferred");
  assert.ok(d.failed_rules[0].citation?.source_url, "the exclusion cites its source");
});

test("[H10] the SAME rule but provenance=model_inferred → NOT excluded — renders unknown (in unknown_rules)", () => {
  const rule = eligRule({
    id: "elg-highered-only-mi",
    category: "entity_type",
    description: "Appears limited to higher education (model-extracted, unreviewed).",
    provenance: "model_inferred",
  });
  const screening = fromEligibilityRule(rule, {
    predicate: { kind: "entity_type_in", allowed: ["higher_education"] },
  });
  const d = assertSafe(
    screen(profile({ entity_type: pf("nonprofit", "user_stated") }), opp(), [screening]),
  );
  // Crown-jewel invariant: a model_inferred rule + a predicate can never exclude.
  assert.notEqual(d.bucket, "excluded");
  assert.equal(d.bucket, "unknown");
  assert.equal(d.failed_rules.length, 0);
  assert.ok(d.unknown_rules.some((r) => r.rule_id === "elg-highered-only-mi"));
});

test("[H10] a MODEL_INFERRED `registration` rule mapped to the conditional predicate → a SAM.gov step → conditionally_eligible (never excluded)", () => {
  const rule = eligRule({
    id: "elg-registration",
    category: "registration",
    description: "Applicants must be registered in SAM.gov.",
    provenance: "model_inferred",
  });
  const screening = fromEligibilityRule(rule, { mapSafeCategories: true });
  // The deterministic mapper attached a CONDITIONAL registration predicate.
  assert.deepEqual(screening.predicate, { kind: "sam_registration_required" });
  assert.equal(screening.gate_kind, "conditional");
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        sam_registered: pf(false, "user_stated"),
      }),
      opp(),
      [screening],
    ),
  );
  assert.notEqual(d.bucket, "excluded"); // a conditional gate can never exclude
  assert.equal(d.bucket, "conditionally_eligible");
  assert.ok(d.required_steps.length >= 1);
  assert.match(d.required_steps[0].step, /SAM\.gov/);
  assert.equal(d.failed_rules.length, 0);
});

test("[H10] REVIEWED rule + predicate, failing on a MODEL_INFERRED profile fact → unknown, not excluded (invariant 2)", () => {
  const rule = eligRule({
    id: "elg-us-owned",
    category: "size_ownership",
    description: "Applicants must be majority U.S.-owned.",
    provenance: "verified",
  });
  const screening = fromEligibilityRule(rule, { predicate: { kind: "us_ownership_required" } });
  // The failing fact was itself only INFERRED → even a reviewed rule cannot exclude.
  const d = assertSafe(
    screen(profile({ us_owned: pf(false, "model_inferred") }), opp(), [screening]),
  );
  assert.notEqual(d.bucket, "excluded");
  assert.equal(d.bucket, "unknown");
  assert.equal(d.failed_rules.length, 0);
});

test("[H10] safeCategoryPredicate maps ONLY `registration` — every ambiguous category stays advisory (undefined)", () => {
  assert.deepEqual(safeCategoryPredicate("registration"), {
    predicate: { kind: "sam_registration_required" },
    gate_kind: "conditional",
  });
  // `size_ownership` is deliberately NOT mapped (it conflates a size number with
  // an ownership assertion — ambiguous; mapping it could risk a false exclusion).
  const advisory: EligibilityRuleCategory[] = [
    "entity_type",
    "size_ownership",
    "geography",
    "program_specific",
    "other",
  ];
  for (const c of advisory) {
    assert.equal(safeCategoryPredicate(c), undefined, `${c} must stay advisory (no auto-predicate)`);
  }
});

test("[H10] wiring via opportunity.eligibility_rules (internal safe-category mapping): registration → conditional step; entity_type stays advisory", () => {
  // A model_inferred `registration` DB row wired through the internal mapping
  // (no explicit `rules` arg) becomes a conditional SAM.gov step.
  const regOpp: ScreenableOpportunity = {
    ...opp(),
    eligibility_rules: [
      {
        id: "db-reg-1",
        category: "registration",
        description: "Must be registered in SAM.gov.",
        citation: { source_url: "https://sam.gov", quote: "registered in SAM.gov" },
        provenance: "model_inferred",
      },
    ],
  };
  const reg = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        sam_registered: pf(false, "user_stated"),
      }),
      regOpp, // no explicit rules arg → internal mapping runs
    ),
  );
  assert.notEqual(reg.bucket, "excluded");
  assert.equal(reg.bucket, "conditionally_eligible");
  assert.ok(reg.required_steps.length >= 1);

  // A model_inferred `entity_type` DB row is NOT auto-predicated (no free-text
  // parsing) → advisory → a clear opp stays eligible, the rule never gates.
  const entityOpp: ScreenableOpportunity = {
    ...opp(),
    eligibility_rules: [
      {
        id: "db-entity-1",
        category: "entity_type",
        description: "Limited to institutions of higher education.",
        citation: { source_url: "https://grants.gov", quote: "higher education" },
        provenance: "model_inferred",
      },
    ],
  };
  const ent = assertSafe(
    screen(
      profile({
        entity_type: pf("nonprofit", "user_stated"), // would "fail" a higher-ed gate IF one existed
        sam_registered: pf(true, "user_stated"),
      }),
      entityOpp,
    ),
  );
  assert.equal(ent.bucket, "eligible");
  assert.equal(ent.failed_rules.length, 0);
  assert.ok(!ent.unknown_rules.some((r) => r.rule_id === "db-entity-1"));
});

test("[H10 regression] with NO per-opp rules the determination is unchanged (demo-path parity)", () => {
  const p = profile({
    entity_type: pf("for_profit_small_business", "user_stated"),
    sam_registered: pf(true, "user_stated"),
  });
  const o = opp({ program: "Community Development Block Grant", title: "CDBG" });

  // The two ways the live/demo path arrives at "no per-opp rules" must agree
  // byte-for-byte: an explicit empty rule set, and no rules arg with an
  // opportunity that carries no `eligibility_rules` (exactly the bridge output).
  const viaExplicitEmpty = assertSafe(screen(p, o, []));
  const viaNoRulesArg = assertSafe(screen(p, { ...o })); // no eligibility_rules present
  assert.deepEqual(viaNoRulesArg, viaExplicitEmpty);

  // And it is the same clear determination as before this change.
  assert.equal(viaExplicitEmpty.bucket, "eligible");
  assert.equal(viaExplicitEmpty.failed_rules.length, 0);
  assert.equal(viaExplicitEmpty.unknown_rules.length, 0);
  assert.equal(viaExplicitEmpty.required_steps.length, 0);
});

test("[H10] fromEligibilityRule() with NO options is byte-identical legacy output plus the inert `_origin` tag (no predicate → advisory)", () => {
  const rule = eligRule({
    id: "elg-legacy",
    category: "other",
    description: "Some free-text clause.",
    provenance: "model_inferred",
  });
  const screening = fromEligibilityRule(rule);
  assert.equal(screening.predicate, undefined, "no options → no predicate (advisory)");
  assert.equal(screening.gate_kind, undefined);
  // `_origin: per_opp` is behaviorally inert (only `universal` is special-cased),
  // but documents provenance and matches the DB mapper's shape.
  assert.equal(screening._origin, "per_opp");
  // Advisory model_inferred prose must never downgrade a clear opp.
  const d = assertSafe(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        sam_registered: pf(true, "user_stated"),
      }),
      opp(),
      [screening],
    ),
  );
  assert.equal(d.bucket, "eligible");
});
