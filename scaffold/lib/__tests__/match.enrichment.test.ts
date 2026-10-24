import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { buildOpportunityMap, type BuildDeps } from "../match";
import { screen as realScreen } from "../eligibility/screen";
import type { Opportunity, StartupProfile } from "../types";

/**
 * B2 — profile-enriched ranking, end-to-end but hermetic (no network).
 *
 * Proves the deterministic enrichment boost SHARPENS retrieval: a
 * size + funding-stage/use-of-funds + industry/NAICS signal deterministically
 * re-orders the candidate slice handed to the scorer, promoting the
 * better-fitting instrument above a slightly-higher-cosine but worse-fitting
 * one — WITHOUT ever admitting a below-floor opp (the floor stays on raw
 * cosine) and without touching scoring/tiers. Gated behind the
 * `b2_enriched_ranking` flag (default OFF), so the flag-off ordering is exactly
 * the pre-B2 cosine order.
 *
 * The DI seam (H6/C1) injects a fixture corpus + a spy `explainMatches` that
 * captures the exact ordered candidate list retrieval chose.
 */

const FLAG_ENV = "NEXT_PUBLIC_FLAG_B2_ENRICHED_RANKING";
const QUERY_VEC = [1, 0];

/** embedding whose cosine with QUERY_VEC ([1,0]) is exactly `sim`. */
function emb(sim: number): number[] {
  return [sim, Math.sqrt(1 - sim * sim)];
}

function opp(over: Partial<Opportunity> & Pick<Opportunity, "id" | "kind" | "source">, sim: number): Opportunity {
  return {
    program: `program ${over.id}`,
    agency: "TestAgency",
    description: "A federal opportunity for testing enrichment ranking.",
    eligibility: "US small business.",
    embedding: emb(sim),
    ...over,
  } as Opportunity;
}

// A: a grant at HIGHER raw cosine but with no mechanism/size/industry fit.
const grantHigher = opp({ id: "grant-A", kind: "grant", source: "grants.gov", industryTags: ["Agriculture"] }, 0.5);
// B: an rd/SBIR opp at slightly LOWER raw cosine but matching every enrichment
// signal (rd mechanism + small-business size + AI industry).
const rdLower = opp({ id: "rd-B", kind: "rd", source: "sbir", industryTags: ["Artificial Intelligence"] }, 0.48);
// C: matches every enrichment signal too, but sits BELOW the 0.22 cosine floor —
// enrichment must never admit it (the floor gates on raw cosine, not boosted rank).
const rdBelowFloor = opp({ id: "rd-C-belowfloor", kind: "rd", source: "sbir", industryTags: ["Artificial Intelligence"] }, 0.1);

const fixtureCorpus: Opportunity[] = [grantHigher, rdLower, rdBelowFloor];

const fixtureProfile: StartupProfile = {
  description: "We build advanced AI sensing hardware for federal customers.",
  employees: 20, // small business
  fundingStage: "seed",
  useOfFunds: "fund research and development to build a prototype",
  industry: "artificial intelligence",
  naicsGuesses: ["541511"],
};

function assess(id: string, score = 80) {
  return {
    id, score, tier: "likely" as const, criteria: [],
    whyCare: "Relevant.", whyFit: "Aligned.", whyIneligible: "Verify entity type.",
    whatToVerify: "SAM registration.", whatToDoNext: "Register in SAM.gov.",
  };
}

function depsWithSpy(captured: { ids: string[]; profile?: StartupProfile }): Partial<BuildDeps> {
  return {
    corpus: fixtureCorpus,
    extractProfile: async () => ({ profile: fixtureProfile, followUps: [] }),
    embed: async () => QUERY_VEC,
    explainMatches: async (p, candidates) => {
      captured.ids = candidates.map((c) => c.id);
      captured.profile = p;
      return candidates.map((c) => assess(c.id));
    },
    explainWeakField: async () => ({ headline: "h", reasoning: "r", redirects: [] }),
    screen: realScreen,
  };
}

let saved: NodeJS.ProcessEnv;
beforeEach(() => {
  saved = { ...process.env };
  delete process.env[FLAG_ENV];
});
afterEach(() => {
  process.env = saved;
});

describe("B2 enriched ranking", () => {
  test("flag OFF: candidate order is the raw cosine order (grant-A before rd-B), below-floor excluded", async () => {
    const captured = { ids: [] as string[] };
    await buildOpportunityMap(fixtureProfile.description, undefined, depsWithSpy(captured));

    assert.deepEqual(captured.ids, ["grant-A", "rd-B"], "pre-B2 behavior: pure cosine desc");
    assert.ok(!captured.ids.includes("rd-C-belowfloor"), "below-floor opp is never a candidate");
  });

  test("flag ON: enrichment promotes the better-fitting rd/SBIR opp above the higher-cosine grant", async () => {
    process.env[FLAG_ENV] = "true";
    const captured = { ids: [] as string[] };
    await buildOpportunityMap(fixtureProfile.description, undefined, depsWithSpy(captured));

    assert.deepEqual(
      captured.ids,
      ["rd-B", "grant-A"],
      "the rd/SBIR opp (mechanism+size+industry fit) now outranks the higher-cosine grant",
    );
  });

  test("flag ON: the below-floor opp is STILL never admitted (floor gates raw cosine, not boosted rank)", async () => {
    process.env[FLAG_ENV] = "true";
    const captured = { ids: [] as string[] };
    await buildOpportunityMap(fixtureProfile.description, undefined, depsWithSpy(captured));

    assert.ok(
      !captured.ids.includes("rd-C-belowfloor"),
      "even with a boost that would lift its rank over the floor, a below-floor opp is not admitted",
    );
  });

  test("flag ON: ordering is deterministic across runs", async () => {
    process.env[FLAG_ENV] = "true";
    const a = { ids: [] as string[] };
    const b = { ids: [] as string[] };
    await buildOpportunityMap(fixtureProfile.description, undefined, depsWithSpy(a));
    await buildOpportunityMap(fixtureProfile.description, undefined, depsWithSpy(b));
    assert.deepEqual(a.ids, b.ids);
  });

  test("the scorer payload carries the structured routing fields (employees / useOfFunds / industry / naicsGuesses)", async () => {
    const captured = { ids: [] as string[], profile: undefined as StartupProfile | undefined };
    await buildOpportunityMap(fixtureProfile.description, undefined, depsWithSpy(captured));
    const p = captured.profile!;
    assert.equal(p.employees, 20);
    assert.equal(p.useOfFunds, fixtureProfile.useOfFunds);
    assert.equal(p.industry, "artificial intelligence");
    assert.deepEqual(p.naicsGuesses, ["541511"]);
  });
});
