// ============================================================================
// EVL-03(b) — false-exclusion eval over the FROZEN golden set.
// ----------------------------------------------------------------------------
// Pure logic, NO LLM calls, NO live DB/Canon. Mirrors the fixture style in
// scaffold/lib/eligibility/__tests__/screen.test.ts (pf() for provenanced
// fields, verifiedRule()/inferredRule(), opp()).
//
// Scope: the golden-set entries whose `eligibility_bucket_expectations`
// contains at least one non-`eligible` bucket that is `excluded` or
// `conditionally_eligible` — the ~14 entries README.md's "Eligibility cases"
// table documents (entries with ONLY an `unknown` sub-bucket, e.g.
// climate-03/education-05/consumer-17/biotech-21/climate-24/health-it-27/
// climate-29/defense-hw-30, are out of that table and out of the required
// scope here; three of the `entity_type: "unknown"` one-line-vague entries are
// included anyway as a small SUPPLEMENTARY section because they cleanly
// demonstrate the "unknown-gate never guesses" check with zero invented
// predicates — see SUPPLEMENTARY_UNKNOWN_GATE_CASES below).
//
// Run (from repo root):
//   node --import tsx evals/false-exclusion-eval.mjs
//
// Exit code: 0 only if the PRIMARY invariant holds — zero false exclusions —
// AND the sanity/R8.4/unknown-gate checks that validate the harness itself all
// pass. A nonzero exit means either a false exclusion was found (the
// build-blocking finding) or the harness's own sanity checks are broken.
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { screen } from "../scaffold/lib/eligibility/screen.ts";
import { EligibilityDeterminationSchema } from "../scaffold/lib/contracts/eligibilityDetermination.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_SET_PATH = join(__dirname, "golden-set.jsonl");
const FROZEN_HASH =
  "f79c6e579f39431cc2b48cc8073569e529473be796cf0af46041a5e7a4cb04e4"; // evals/README.md v1.0

// ---------------------------------------------------------------------------
// Entity-type mapping — golden-set `entity_type` vocabulary → CompanyProfile
// `EntityType` enum (`for_profit_small_business` | `for_profit_other` |
// `nonprofit` | `higher_education` | `state_or_local_government` | `tribal` |
// `individual` | `other`). Documented here per the task spec ("document the
// mapping table in the script").
// ---------------------------------------------------------------------------
//
//   golden entity_type                    -> CompanyProfile EntityType   (+ extra facts)
//   -----------------------------------------------------------------------------------
//   for_profit_small_business             -> for_profit_small_business
//   nonprofit                             -> nonprofit
//   institution_of_higher_education       -> higher_education
//   state_or_local_government             -> state_or_local_government
//   tribal_entity                         -> tribal
//   individual                            -> individual
//   foreign_owned_entity                  -> for_profit_small_business  + us_owned: false
//   unknown                               -> (entity_type field OMITTED — "not stated")
//
// The golden set's `foreign_owned_entity` and `unknown` values have no direct
// CompanyProfile EntityType counterpart; per the task's own worked example we
// map `foreign_owned_entity` to the for-profit type plus a separate
// `us_owned: false` fact (the ownership gate, not the entity-type gate, is
// what actually excludes it), and `unknown` to simply not setting the
// `entity_type` field at all (CompanyProfile has no "unknown" enum value —
// absence of the field *is* "not stated").

// ---------------------------------------------------------------------------
// Fixture helpers (same shapes as screen.test.ts)
// ---------------------------------------------------------------------------

/** A provenanced profile field. */
function pf(value, provenance = "user_stated", confidence = 1) {
  return { value, provenance, confidence };
}

/** Build a valid CompanyProfile with sensible defaults + overrides. */
function profile(overrides = {}) {
  return {
    id: "profile-1",
    raw_text: pf("We build software.", "user_stated"),
    interview_answers: [],
    ...overrides,
  };
}

let oppCounter = 0;
function opp(over = {}) {
  oppCounter += 1;
  return {
    id: `opp-${oppCounter}`,
    program: "Test Grant Program",
    title: "Test Grant Program",
    ...over,
  };
}

/** An SBIR/STTR-flavored opportunity — triggers universalRulesForOpportunity's SBIR overlay. */
function sbirOpp(program) {
  return opp({ program, title: `${program} (SBIR)` });
}

/** A reviewed (human-verified) rule — the only kind that may drive exclusion. */
function verifiedRule(over) {
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
function inferredRule(over) {
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

/** Downgrade a rule to model_inferred provenance (R8.4 check), keeping everything else. */
function downgraded(rule) {
  return { ...rule, provenance: "model_inferred" };
}

// ---------------------------------------------------------------------------
// Tiny local test harness (this is a standalone eval script, not node:test)
// ---------------------------------------------------------------------------

const results = []; // { section, name, pass, detail }

function record(section, name, pass, detail) {
  results.push({ section, name, pass, detail });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`[${mark}] ${section} :: ${name}${detail ? " — " + detail : ""}`);
}

function safeParse(d) {
  EligibilityDeterminationSchema.parse(d); // throws if the R8.2/R8.4 refinements are violated
  return d;
}

// ---------------------------------------------------------------------------
// Load + hash the golden set
// ---------------------------------------------------------------------------

const raw = readFileSync(GOLDEN_SET_PATH, "utf8");
const liveHash = createHash("sha256").update(raw).digest("hex");
const entries = raw
  .split("\n")
  .filter((l) => l.trim().length > 0)
  .map((l) => JSON.parse(l));

const byId = Object.fromEntries(entries.map((e) => [e.id, e]));

console.log("=".repeat(78));
console.log("EVL-03(b) false-exclusion eval — golden-set version check");
console.log(`  live sha256:   ${liveHash}`);
console.log(`  frozen sha256: ${FROZEN_HASH}`);
console.log(
  liveHash === FROZEN_HASH
    ? "  MATCH — golden set is the frozen v1.0 reference."
    : "  *** MISMATCH — the golden set has drifted from the frozen v1.0 reference. ESCALATE. ***",
);
console.log("=".repeat(78));

// ===========================================================================
// SKIPPED CASES — rule can't be mapped to an existing RulePredicate without
// inventing a new predicate kind. Reported explicitly, never force-mapped.
// ===========================================================================

const SKIPPED = [
  {
    entryId: "biotech-06-precision-onco-therapeutic",
    program: "NIH STTR",
    reason:
      "STTR partnering-institution + 30/40 work-split requirement has no CompanyProfile field " +
      "(no 'has a partnering research institution' fact) and no RulePredicate models it. " +
      "entity_type_in/us_ownership_required/max_employees/etc. are all the wrong shape.",
  },
  {
    entryId: "biotech-14-sttr-no-research-partner",
    program: "STTR",
    reason: "Same as biotech-06 — STTR partnering-institution requirement has no matching RulePredicate.",
  },
  {
    entryId: "climate-10-phase2-no-phase1",
    program: "Direct-to-Phase-II (DoD/NIH under specific authority)",
    reason:
      "Whether a given solicitation offers Direct-to-Phase-II authority is program/solicitation-level " +
      "information, not a CompanyProfile fact about the applicant. No RulePredicate evaluates opportunity " +
      "program authority; it is genuinely 'unknown' for reasons outside this engine's inputs.",
  },
  {
    entryId: "defense-hw-08-foreign-owned-drone",
    program: "DoD/IC procurement",
    reason:
      "FOCI mitigation availability is topic/program-specific security-clearance information, not a " +
      "CompanyProfile fact. No RulePredicate models it.",
  },
  {
    entryId: "defense-hw-31-closed-solicitation-freshness",
    program: "Named prior-year topic (if closed)",
    reason:
      "This is an R8.3 solicitation freshness/status exclusion (closed vs. open), not a CompanyProfile " +
      "eligibility gate. Every RulePredicate kind in screen.ts evaluates a CompanyProfile fact; none " +
      "evaluate opportunity status. Out of scope for screen() entirely, not just unmapped.",
  },
];

console.log("\n--- SKIPPED (rule not representable by an existing RulePredicate) ---");
for (const s of SKIPPED) {
  console.log(`  SKIP  ${s.entryId} / "${s.program}" — ${s.reason}`);
  results.push({ section: "skipped", name: `${s.entryId} / ${s.program}`, pass: null, detail: s.reason });
}

// ===========================================================================
// SANITY: golden bucket = excluded, modeled with a VERIFIED rule → excluded.
// Confirms the harness can trigger real exclusions (not vacuously green).
// Each sanity case is immediately followed by its R8.4 pair: the SAME rule
// downgraded to model_inferred provenance must NEVER exclude (must be unknown).
// ===========================================================================

console.log("\n--- SANITY (verified rule) + R8.4 (same rule, model_inferred) ---");

const SANITY_CASES = [
  {
    entryId: "biotech-07-nonprofit-research-institute",
    program: "SBIR/STTR (as applicant)",
    build: () => ({
      profile: profile({ entity_type: pf("nonprofit", "user_stated") }),
      opp: sbirOpp("SBIR/STTR"),
      rule: {
        id: "biotech-07-forprofit-required",
        category: "entity_type",
        description:
          "SBIR/STTR eligibility requires a for-profit small business concern (SBA SBIR/STTR Policy Directive; 13 CFR 121.702)",
        predicate: { kind: "entity_type_in", allowed: ["for_profit_small_business", "for_profit_other"] },
      },
    }),
  },
  {
    entryId: "defense-hw-08-foreign-owned-drone",
    program: "SBIR/STTR",
    build: () => ({
      // foreign_owned_entity -> for_profit_small_business + us_owned:false (documented mapping above)
      profile: profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        us_owned: pf(false, "user_stated"),
      }),
      opp: sbirOpp("SBIR/STTR"),
      rule: {
        id: "defense-hw-08-us-ownership",
        category: "size_ownership",
        description:
          "SBIR/STTR require the concern to be >50% owned and controlled by US citizens or permanent residents (13 CFR 121.702)",
        predicate: { kind: "us_ownership_required" },
      },
    }),
  },
  {
    entryId: "climate-10-phase2-no-phase1",
    program: "SBIR/STTR Phase II (standard)",
    build: () => ({
      profile: profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        prior_federal_funding: pf(false, "user_stated"),
      }),
      opp: sbirOpp("SBIR/STTR Phase II"),
      rule: {
        id: "climate-10-phase1-required",
        category: "program_specific",
        description: "Standard SBIR/STTR Phase II requires a prior Phase I award on the same project line (SBA SBIR/STTR Policy Directive)",
        predicate: { kind: "prior_award_required" },
      },
    }),
  },
  {
    entryId: "education-11-university-ed-research",
    program: "SBIR/STTR (as applicant)",
    build: () => ({
      // institution_of_higher_education -> higher_education (documented mapping above)
      profile: profile({ entity_type: pf("higher_education", "user_stated") }),
      opp: sbirOpp("SBIR/STTR"),
      rule: {
        id: "education-11-not-ihe",
        category: "entity_type",
        description: "SBIR/STTR require a for-profit small business concern; an IHE is not one (13 CFR 121.702)",
        predicate: { kind: "entity_type_not_in", disallowed: ["higher_education"] },
      },
    }),
  },
  {
    entryId: "dualuse-sw-12-oversized-firm",
    program: "SBIR/STTR",
    build: () => ({
      profile: profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        employee_count: pf(800, "user_stated"),
      }),
      opp: sbirOpp("SBIR/STTR"),
      rule: {
        id: "dualuse-sw-12-size-cap",
        category: "size_ownership",
        description: "SBIR/STTR require the concern (with affiliates) to have <=500 employees (13 CFR 121.702)",
        predicate: { kind: "max_employees", max: 500 },
      },
    }),
  },
  {
    entryId: "climate-20-municipal-utility",
    program: "SBIR/STTR",
    build: () => ({
      // state_or_local_government -> state_or_local_government (direct match)
      profile: profile({ entity_type: pf("state_or_local_government", "user_stated") }),
      opp: sbirOpp("SBIR/STTR"),
      rule: {
        id: "climate-20-not-gov",
        category: "entity_type",
        description: "SBIR/STTR require a for-profit small business concern; a municipal government entity is not one (13 CFR 121.105 / 121.702)",
        predicate: { kind: "entity_type_not_in", disallowed: ["state_or_local_government"] },
      },
    }),
  },
  {
    entryId: "education-25-k12-edtech-forprofit",
    program: "IES research grants (institution-restricted)",
    caveat:
      "README.md flags this entry's rule citation as PENDING owner verification (not yet independently " +
      "re-confirmed against a primary source). Modeled here to exercise the engine's logic only — not a " +
      "claim that the underlying federal rule text is confirmed.",
    build: () => ({
      profile: profile({ entity_type: pf("for_profit_small_business", "user_stated") }),
      opp: opp({ program: "IES Research Grant", title: "IES Research Grant (institution-restricted)" }),
      rule: {
        id: "education-25-institution-restricted",
        category: "entity_type",
        description: "Some IES research mechanisms are restricted to IHEs/LEAs/nonprofits as the applicant",
        predicate: { kind: "entity_type_in", allowed: ["higher_education", "nonprofit"] },
      },
    }),
  },
];

for (const c of SANITY_CASES) {
  if (c.caveat) console.log(`  NOTE  ${c.entryId} / "${c.program}" — ${c.caveat}`);
  const { profile: p, opp: o, rule } = c.build();

  // Sanity: verified rule -> excluded.
  let sanityD;
  try {
    sanityD = safeParse(screen(p, o, [verifiedRule(rule)]));
    const pass =
      sanityD.bucket === "excluded" &&
      sanityD.failed_rules.length > 0 &&
      sanityD.failed_rules.some((r) => r.provenance !== "model_inferred");
    record(
      "sanity-excluded",
      `${c.entryId} / ${c.program}`,
      pass,
      pass ? undefined : `expected excluded, got ${sanityD.bucket}`,
    );
  } catch (err) {
    record("sanity-excluded", `${c.entryId} / ${c.program}`, false, `threw: ${err.message}`);
  }

  // R8.4: same rule downgraded to model_inferred -> must NEVER exclude (must be unknown).
  try {
    const r84D = safeParse(screen(p, o, [inferredRule(downgraded(rule))]));
    const pass = r84D.bucket !== "excluded" && r84D.bucket === "unknown";
    record(
      "r8.4-downgrade",
      `${c.entryId} / ${c.program}`,
      pass,
      pass ? undefined : `expected unknown (never excluded), got ${r84D.bucket}`,
    );
  } catch (err) {
    record("r8.4-downgrade", `${c.entryId} / ${c.program}`, false, `threw: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Supplementary R8.4-via-universal-overlay checks for the two entries whose
// gate the universal overlay ALREADY covers (SBIR ownership / SBIR size) —
// per the task spec: "don't hand-build a rule for it — call screen() with an
// SBIR/STTR-flavored opportunity and let the overlay apply, same as
// screen.test.ts does." These confirm the REAL end-to-end engine path (not
// just the hand-built-rule stand-in above) also never excludes on these gates.
// ---------------------------------------------------------------------------

console.log("\n--- R8.4 via the REAL universal overlay (no hand-built rule) ---");

{
  // defense-hw-08: universal-sbir-ownership gate, foreign ownership, via the overlay itself.
  const d = safeParse(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        us_owned: pf(false, "user_stated"),
      }),
      sbirOpp("SBIR/STTR"),
      [], // no per-opp rules — only the universal overlay applies
    ),
  );
  const pass = d.bucket !== "excluded" && d.bucket === "unknown" &&
    d.unknown_rules.some((r) => r.rule_id === "universal-sbir-ownership");
  record(
    "r8.4-universal-overlay",
    "defense-hw-08-foreign-owned-drone / SBIR/STTR (universal ownership gate)",
    pass,
    pass ? undefined : `expected unknown via universal-sbir-ownership, got ${d.bucket}`,
  );
}
{
  // dualuse-sw-12: universal-sbir-size gate, >500 employees, via the overlay itself.
  const d = safeParse(
    screen(
      profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        employee_count: pf(800, "user_stated"),
      }),
      sbirOpp("SBIR/STTR"),
      [],
    ),
  );
  const pass = d.bucket !== "excluded" && d.bucket === "unknown" &&
    d.unknown_rules.some((r) => r.rule_id === "universal-sbir-size");
  record(
    "r8.4-universal-overlay",
    "dualuse-sw-12-oversized-firm / SBIR/STTR (universal size gate)",
    pass,
    pass ? undefined : `expected unknown via universal-sbir-size, got ${d.bucket}`,
  );
}

// ===========================================================================
// PRIMARY METRIC — zero false exclusions. For every case whose golden bucket
// is eligible / conditionally_eligible / unknown, screen() must NEVER return
// excluded.
// ===========================================================================

console.log("\n--- PRIMARY METRIC: zero false exclusions (conditionally_eligible / unknown cases) ---");

const NON_EXCLUSION_CASES = [
  {
    entryId: "health-it-01-ai-nurse-admin",
    program: "NIH R01/R21",
    expectedBucket: "conditionally_eligible",
    note:
      "Golden reason: 'not a regulatory exclusion — a programmatic steering norm.' There is no gate to " +
      "hand-build (that's the point of this entry); modeled with no per-opp rules to confirm the engine " +
      "never manufactures an exclusion out of a mere steering norm.",
    build: () => ({
      profile: profile({ entity_type: pf("for_profit_small_business", "user_stated") }),
      opp: opp({ program: "NIH R01/R21", title: "NIH R01/R21 Parent FOA" }),
      rules: [],
    }),
  },
  {
    entryId: "defense-hw-02-aero-manufacturing",
    program: "SAM.gov procurement",
    expectedBucket: "conditionally_eligible",
    build: () => ({
      profile: profile({ entity_type: pf("for_profit_small_business", "user_stated") }), // sam_registered unstated
      opp: opp({ program: "SAM.gov procurement", title: "SAM.gov Contract Opportunity" }),
      rules: [],
    }),
  },
  {
    entryId: "health-it-09-no-sam-registration",
    program: "Grants.gov NOFO (target)",
    expectedBucket: "conditionally_eligible",
    build: () => ({
      profile: profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        employee_count: pf(4, "user_stated"),
        us_owned: pf(true, "user_stated"),
        sam_registered: pf(false, "user_stated"),
      }),
      opp: opp({ program: "Grants.gov NOFO", title: "Medication Adherence NOFO" }),
      rules: [],
    }),
  },
  {
    entryId: "health-it-09-no-sam-registration",
    program: "NIH/AHRQ SBIR",
    expectedBucket: "conditionally_eligible",
    build: () => ({
      profile: profile({
        entity_type: pf("for_profit_small_business", "user_stated"),
        employee_count: pf(4, "user_stated"),
        us_owned: pf(true, "user_stated"),
        sam_registered: pf(false, "user_stated"),
      }),
      opp: sbirOpp("NIH/AHRQ SBIR"),
      rules: [],
    }),
  },
  {
    entryId: "biotech-13-solo-founder-no-entity",
    program: "SBIR/STTR",
    expectedBucket: "conditionally_eligible",
    note:
      "Modeled with gate_kind:'conditional' on an entity_type_in predicate — 'form a US for-profit small " +
      "business concern' is a completable prerequisite step, not a permanent bar, which is exactly what " +
      "gate_kind:'conditional' already means in screen.ts (used generically, not just for registration). " +
      "us_owned/employee_count are stated here purely to isolate the entity-formation gate under test — " +
      "without them the universal SBIR ownership/size gates (unrelated to this entry's point) would also " +
      "go indeterminate on an SBIR-flavored opp and push the bucket to 'unknown' instead of 'conditionally_eligible'.",
    build: () => ({
      profile: profile({
        entity_type: pf("individual", "user_stated"),
        us_owned: pf(true, "user_stated"),
        employee_count: pf(1, "user_stated"),
      }),
      opp: sbirOpp("SBIR/STTR"),
      rules: [
        verifiedRule({
          id: "biotech-13-must-incorporate",
          category: "entity_type",
          description:
            "SBIR/STTR awardee must be a for-profit small business concern; an individual is not one until incorporated (13 CFR 121.105 / 121.702)",
          predicate: { kind: "entity_type_in", allowed: ["for_profit_small_business", "for_profit_other"] },
          gate_kind: "conditional",
        }),
      ],
    }),
  },
];

for (const c of NON_EXCLUSION_CASES) {
  if (c.note) console.log(`  NOTE  ${c.entryId} / "${c.program}" — ${c.note}`);
  const { profile: p, opp: o, rules } = c.build();
  try {
    const d = safeParse(screen(p, o, rules));
    const notExcluded = d.bucket !== "excluded";
    record(
      "primary-metric",
      `${c.entryId} / ${c.program}`,
      notExcluded,
      notExcluded
        ? `bucket=${d.bucket} (golden expects ${c.expectedBucket})`
        : `*** FALSE EXCLUSION *** golden expects ${c.expectedBucket}, engine returned excluded — rule(s): ${d.failed_rules.map((r) => r.rule_id).join(", ")}`,
    );
  } catch (err) {
    record("primary-metric", `${c.entryId} / ${c.program}`, false, `threw: ${err.message}`);
  }
}

// ===========================================================================
// SUPPLEMENTARY unknown-gate checks (beyond the required ~14-entry set) — the
// three `entity_type: "unknown"` one-line-vague entries are a clean,
// zero-invention way to exercise check #4 ("unknown-gate cases render
// unknown, not a guess") end-to-end via the real universal overlay: an
// entirely bare profile against an SBIR-flavored opportunity leaves the
// universal SBIR ownership/size gates indeterminate, which must render
// `unknown`, never a guess in either direction.
// ===========================================================================

console.log("\n--- SUPPLEMENTARY: unknown-gate cases (one-line-vague entries, entity_type omitted) ---");

const UNKNOWN_GATE_ENTRY_IDS = [
  "health-it-18-one-line-vague",
  "climate-19-one-line-vague",
  "defense-hw-32-one-line-vague",
];

for (const entryId of UNKNOWN_GATE_ENTRY_IDS) {
  const entry = byId[entryId];
  if (!entry) {
    record("unknown-gate", entryId, false, "entry not found in golden set");
    continue;
  }
  try {
    const d = safeParse(
      screen(
        profile(), // entity_type omitted entirely — golden entity_type is "unknown" (not stated)
        sbirOpp("SBIR/STTR"),
        [],
      ),
    );
    const pass = d.bucket === "unknown";
    record(
      "unknown-gate",
      `${entryId} / SBIR/STTR`,
      pass,
      pass ? undefined : `expected unknown (not a guess), got ${d.bucket}`,
    );
  } catch (err) {
    record("unknown-gate", `${entryId} / SBIR/STTR`, false, `threw: ${err.message}`);
  }
}

// Entries with ONLY an `unknown` sub-bucket (no excluded/conditionally_eligible)
// that are out of the required ~14-entry scope and were not otherwise modeled:
const OUT_OF_SCOPE_UNKNOWN_ONLY = [
  "climate-03-water-loss-sensors",
  "education-05-youth-activity-marketplace",
  "consumer-17-dating-app",
  "biotech-21-tribal-enterprise",
  "climate-24-grid-battery",
  "health-it-27-telehealth-medium",
  "climate-29-agtech-precision",
  "defense-hw-30-us-incorporated-foreign-founder",
];
console.log(
  "\n--- Out of required scope (unknown-only entries, not part of the ~14-entry table; not modeled) ---",
);
for (const id of OUT_OF_SCOPE_UNKNOWN_ONLY) {
  console.log(`  N/A   ${id} — golden bucket is 'unknown' only (no excluded/conditionally_eligible); outside the task's ~14-entry scope.`);
}

// ===========================================================================
// Summary
// ===========================================================================

console.log("\n" + "=".repeat(78));
console.log("SUMMARY");
console.log("=".repeat(78));

const bySection = {};
for (const r of results) {
  bySection[r.section] ??= { pass: 0, fail: 0, skip: 0 };
  if (r.pass === null) bySection[r.section].skip++;
  else if (r.pass) bySection[r.section].pass++;
  else bySection[r.section].fail++;
}
for (const [section, counts] of Object.entries(bySection)) {
  console.log(
    `  ${section}: ${counts.pass} pass, ${counts.fail} fail, ${counts.skip} skip`,
  );
}

const falseExclusions = results.filter(
  (r) => r.section === "primary-metric" && r.pass === false,
);
const sanityFailures = results.filter(
  (r) =>
    (r.section === "sanity-excluded" ||
      r.section === "r8.4-downgrade" ||
      r.section === "r8.4-universal-overlay" ||
      r.section === "unknown-gate") &&
    r.pass === false,
);

console.log(`\nFalse exclusions found: ${falseExclusions.length} (PRIMARY METRIC — must be 0)`);
if (falseExclusions.length > 0) {
  console.log("  *** BUILD-BLOCKING FINDING — R8 acceptance failure ***");
  for (const f of falseExclusions) console.log(`    - ${f.name}: ${f.detail}`);
}
console.log(`Harness sanity/R8.4/unknown-gate failures: ${sanityFailures.length} (should be 0 — indicates a broken harness, not necessarily a product bug)`);
if (sanityFailures.length > 0) {
  for (const f of sanityFailures) console.log(`    - [${f.section}] ${f.name}: ${f.detail}`);
}
console.log(`Skipped entries: ${SKIPPED.length} (documented above, no predicate invented)`);

const overallPass = falseExclusions.length === 0 && sanityFailures.length === 0;
console.log(`\nOVERALL: ${overallPass ? "PASS" : "FAIL"}`);
console.log("=".repeat(78));

process.exitCode = overallPass ? 0 : 1;
