import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOpportunityMap, CALIBRATION, type BuildDeps } from "../match";
import { screen as realScreen } from "../eligibility/screen";
import type { Opportunity, StartupProfile } from "../types";

/**
 * C1a — per-type retrieval quota (hermetic, no network).
 *
 * Regression for the crowd-out bug: a single global top-`candidateCount` cosine
 * cut let a large block of high-cosine grants fill every scorer slot, so lone
 * non-grant instrument types (rd/SBIR, procurement, assistance, loan,
 * scholarship) that cleared the floor at LOWER cosine never reached the LLM
 * scorer. The quota reserves top-`perTypeQuota`-by-cosine of each PRESENT kind,
 * unioned into the scored slice, WITHOUT discarding any strong grant.
 *
 * The DI seam (H6/C1) lets us inject a fixture corpus + a spy `explainMatches`
 * that captures the exact candidate list the retrieval step chose, so we assert
 * on what actually reaches the scorer.
 */

// --- Fixtures ---------------------------------------------------------------

const QUERY_VEC = [1, 0];

/**
 * Deterministic cosine control. The query is the unit +x vector; each opp is the
 * unit vector at the angle whose cosine is exactly `sim` (embedding =
 * [sim, sqrt(1 - sim^2)]), so `cosine(QUERY_VEC, embedding) === sim`. A grant at
 * 0.90 outranks a lone non-grant at 0.30, but both clear the 0.22 floor.
 */
function opp(id: string, kind: Opportunity["kind"], source: Opportunity["source"], sim: number): Opportunity {
  return {
    id,
    source,
    kind,
    program: `${kind} program ${id}`,
    agency: "TestAgency",
    description: `A ${kind} opportunity for testing retrieval quotas.`,
    eligibility: "US small business.",
    embedding: [sim, Math.sqrt(1 - sim * sim)],
  };
}

// 30 high-cosine grants (0.90..0.905) — far more than candidateCount (24), so a
// pure global cut would fill ALL slots with grants and starve everything else.
const grants: Opportunity[] = Array.from({ length: 30 }, (_, i) =>
  opp(`grant-${String(i).padStart(2, "0")}`, "grant", "grants.gov", 0.9 + i * 0.0001),
);

// Lone non-grant types, each clearing the floor but at LOWER cosine than every
// grant — exactly the opps the old global cut crowded out.
const loneRd = opp("sbir-rd-1", "rd", "sbir", 0.3); // SBIR/STTR modeled as kind:"rd"
const loneProcurement = opp("proc-1", "procurement", "usaspending", 0.29);
const loneAssistance = opp("assist-1", "assistance", "assistance-listings", 0.28);

// A below-floor opp that must NEVER be selected (proves the floor still gates).
const belowFloor = opp("scholar-below", "scholarship", "assistance-listings", 0.1);

const fixtureCorpus: Opportunity[] = [
  ...grants,
  loneRd,
  loneProcurement,
  loneAssistance,
  belowFloor,
];

const fixtureProfile: StartupProfile = {
  description: "We build advanced AI sensing hardware for federal customers.",
  employees: 20,
};

function assess(id: string, score = 80) {
  return {
    id,
    score,
    tier: "likely" as const,
    criteria: [],
    whyCare: "Relevant program.",
    whyFit: "Aligned.",
    whyIneligible: "Verify entity type.",
    whatToVerify: "SAM registration.",
    whatToDoNext: "Register in SAM.gov.",
  };
}

/**
 * Build deps with a spy that records the candidate list retrieval handed the
 * scorer. `captured.ids` is the exact, ordered slice sent to `explainMatches`.
 */
function depsWithSpy(captured: { ids: string[] }): Partial<BuildDeps> {
  return {
    corpus: fixtureCorpus,
    extractProfile: async () => ({ profile: fixtureProfile, followUps: [] }),
    embed: async () => QUERY_VEC,
    explainMatches: async (_p, candidates) => {
      captured.ids = candidates.map((c) => c.id);
      return candidates.map((c) => assess(c.id));
    },
    explainWeakField: async () => ({
      headline: "No strong federal match yet",
      reasoning: "Early for the programs in scope.",
      redirects: [],
    }),
    screen: realScreen,
  };
}

// --- The quota guarantees ---------------------------------------------------

test("C1a: each present kind reaches the scorer — lone rd/procurement/assistance are NOT crowded out by 30 grants", async () => {
  const captured = { ids: [] as string[] };
  await buildOpportunityMap(fixtureProfile.description, undefined, depsWithSpy(captured));

  const chosen = new Set(captured.ids);
  const kindOf = (id: string) => fixtureCorpus.find((o) => o.id === id)!.kind;
  const kindsReaching = new Set(captured.ids.map(kindOf));

  // Every present, floor-clearing kind must reach the scorer.
  assert.ok(kindsReaching.has("grant"), "grants must reach the scorer");
  assert.ok(kindsReaching.has("rd"), "the lone rd/SBIR opp must reach the scorer");
  assert.ok(kindsReaching.has("procurement"), "the lone procurement opp must reach the scorer");
  assert.ok(kindsReaching.has("assistance"), "the lone assistance opp must reach the scorer");

  // Explicitly: the three lone non-grant opps are all present.
  assert.ok(chosen.has("sbir-rd-1"), "sbir-rd-1 (kind rd) reaches the scorer");
  assert.ok(chosen.has("proc-1"), "proc-1 (kind procurement) reaches the scorer");
  assert.ok(chosen.has("assist-1"), "assist-1 (kind assistance) reaches the scorer");
});

test("C1a: strong grants are NOT discarded — the full global top-N grant block survives", async () => {
  const captured = { ids: [] as string[] };
  await buildOpportunityMap(fixtureProfile.description, undefined, depsWithSpy(captured));

  const chosen = new Set(captured.ids);
  const grantsChosen = grants.filter((g) => chosen.has(g.id)).length;

  // The base set is the unchanged global top-`candidateCount`; all of those are
  // grants here (they dominate cosine), so exactly candidateCount grants remain.
  assert.equal(
    grantsChosen,
    CALIBRATION.candidateCount,
    "the quota must ADD reserved slots, never displace any of the top-N grants",
  );

  // The highest-cosine grant (grant-29, sim 0.9029) must be present.
  assert.ok(chosen.has("grant-29"), "the single strongest grant is retained");
});

test("C1a: the below-floor opp is never selected (candidateFloor still gates)", async () => {
  const captured = { ids: [] as string[] };
  await buildOpportunityMap(fixtureProfile.description, undefined, depsWithSpy(captured));

  assert.ok(
    !captured.ids.includes("scholar-below"),
    "an opp below candidateFloor must never be admitted, quota or not",
  );
});

test("C1a: candidate ordering is deterministic (cosine desc, tie-broken by id) and stable across runs", async () => {
  const a = { ids: [] as string[] };
  const b = { ids: [] as string[] };
  await buildOpportunityMap(fixtureProfile.description, undefined, depsWithSpy(a));
  await buildOpportunityMap(fixtureProfile.description, undefined, depsWithSpy(b));

  // Identical across independent runs — no Math.random, stable tie-breaks.
  assert.deepEqual(a.ids, b.ids, "the candidate slice must be identical across runs");

  // Ordering is by descending cosine (grants, sim ~0.9) before the lower-cosine
  // non-grant reserved slots (sim ~0.3).
  const simOf = (id: string) => fixtureCorpus.find((o) => o.id === id)!.embedding![0];
  for (let i = 1; i < a.ids.length; i++) {
    assert.ok(
      simOf(a.ids[i]) <= simOf(a.ids[i - 1]) + 1e-9,
      `cosine must be non-increasing across the slice at index ${i}`,
    );
  }

  // The reserved non-grant slots sit at the tail (after the strong grant block).
  const lastThree = a.ids.slice(-3);
  assert.deepEqual(
    [...lastThree].sort(),
    ["assist-1", "proc-1", "sbir-rd-1"].sort(),
    "the three reserved lower-cosine non-grant slots are appended after the grants",
  );
});
