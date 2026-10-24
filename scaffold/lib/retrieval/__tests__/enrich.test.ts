import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  deriveEnrichmentSignal,
  enrichmentQueryTerms,
  boostForOpportunity,
  MECHANISM_BOOST,
  SIZE_BOOST,
  INDUSTRY_BOOST,
  SMALL_BUSINESS_EMPLOYEE_CAP,
} from "../enrich";
import type { StartupProfile, Opportunity } from "../../types";

/**
 * B2 — pure, hermetic tests of the profile-enrichment signal + boost. No LLM,
 * no embedding, no network: these assert the deterministic mapping from
 * structured StartupProfile fields to mechanism/size/industry signals and the
 * per-opportunity ranking boost.
 */

function opp(over: Partial<Opportunity> & Pick<Opportunity, "id" | "kind" | "source">): Opportunity {
  return {
    program: "p",
    agency: "a",
    description: "d",
    ...over,
  } as Opportunity;
}

describe("deriveEnrichmentSignal — mechanism read from stage / use-of-funds", () => {
  test("an R&D use-of-funds points at the rd (SBIR/STTR) mechanism", () => {
    const p: StartupProfile = { description: "x", useOfFunds: "fund early research and prototype development" };
    const s = deriveEnrichmentSignal(p);
    assert.ok(s.mechanisms.has("rd"), "R&D use-of-funds → rd mechanism");
    assert.ok(enrichmentQueryTerms(s).includes("SBIR"), "emits SBIR query vocabulary");
  });

  test("a working-capital / equipment use-of-funds points at the loan mechanism", () => {
    const p: StartupProfile = { description: "x", useOfFunds: "buy equipment and working capital for expansion" };
    const s = deriveEnrichmentSignal(p);
    assert.ok(s.mechanisms.has("loan"));
    assert.ok(!s.mechanisms.has("rd"), "no R&D language → rd not asserted");
  });

  test("a sell-to-government use-of-funds points at the procurement mechanism", () => {
    const p: StartupProfile = { description: "x", useOfFunds: "win a federal contract to sell to the government" };
    const s = deriveEnrichmentSignal(p);
    assert.ok(s.mechanisms.has("procurement"));
  });

  test("early stage + development prose nudges in the rd mechanism", () => {
    const p: StartupProfile = { description: "x", fundingStage: "pre-seed", rdActivities: "developing novel technology" };
    const s = deriveEnrichmentSignal(p);
    assert.ok(s.mechanisms.has("rd"));
  });

  test("no routing prose → no mechanisms and no query terms", () => {
    const p: StartupProfile = { description: "x" };
    const s = deriveEnrichmentSignal(p);
    assert.equal(s.mechanisms.size, 0);
    assert.deepEqual(enrichmentQueryTerms(s), []);
  });
});

describe("deriveEnrichmentSignal — size", () => {
  test("a headcount at/under the cap is small-business; over is not; absent is unknown", () => {
    assert.equal(deriveEnrichmentSignal({ description: "x", employees: 20 }).smallBusiness, true);
    assert.equal(deriveEnrichmentSignal({ description: "x", employees: SMALL_BUSINESS_EMPLOYEE_CAP }).smallBusiness, true);
    assert.equal(deriveEnrichmentSignal({ description: "x", employees: 5000 }).smallBusiness, false);
    assert.equal(deriveEnrichmentSignal({ description: "x" }).smallBusiness, undefined);
  });

  test("small business emits the small-business query term", () => {
    const s = deriveEnrichmentSignal({ description: "x", employees: 10 });
    assert.ok(enrichmentQueryTerms(s).includes("small business"));
  });
});

describe("boostForOpportunity — deterministic, non-negative", () => {
  test("mechanism match boosts the matching kind and nothing else", () => {
    const s = deriveEnrichmentSignal({ description: "x", useOfFunds: "research and development, prototype" });
    assert.equal(boostForOpportunity(s, opp({ id: "1", kind: "rd", source: "sbir" })), MECHANISM_BOOST + SIZE_BOOST * 0);
    // rd + small business would add SIZE too; here employees is unset so only mechanism fires.
    assert.equal(boostForOpportunity(s, opp({ id: "2", kind: "grant", source: "grants.gov" })), 0);
  });

  test("small-business size boosts rd/SBIR instruments", () => {
    const s = deriveEnrichmentSignal({ description: "x", employees: 12 });
    assert.equal(boostForOpportunity(s, opp({ id: "1", kind: "rd", source: "sbir" })), SIZE_BOOST);
    assert.equal(boostForOpportunity(s, opp({ id: "2", kind: "grant", source: "grants.gov" })), 0, "size never boosts a non-rd/non-sbir kind");
  });

  test("industry/NAICS overlap with an opp's industryTags boosts it", () => {
    const s = deriveEnrichmentSignal({ description: "x", industry: "healthcare artificial intelligence", naicsGuesses: ["541511"] });
    const hit = opp({ id: "1", kind: "grant", source: "grants.gov", industryTags: ["Artificial Intelligence", "Health"] });
    const miss = opp({ id: "2", kind: "grant", source: "grants.gov", industryTags: ["Agriculture"] });
    assert.equal(boostForOpportunity(s, hit), INDUSTRY_BOOST);
    assert.equal(boostForOpportunity(s, miss), 0);
  });

  test("signals stack additively and the boost is always >= 0", () => {
    const s = deriveEnrichmentSignal({
      description: "x",
      employees: 15,
      useOfFunds: "research and development",
      industry: "artificial intelligence",
    });
    const opp1 = opp({ id: "1", kind: "rd", source: "sbir", industryTags: ["artificial intelligence"] });
    assert.equal(boostForOpportunity(s, opp1), MECHANISM_BOOST + SIZE_BOOST + INDUSTRY_BOOST);
    // Nothing ever produces a negative boost.
    const s2 = deriveEnrichmentSignal({ description: "x", employees: 9000 });
    assert.ok(boostForOpportunity(s2, opp({ id: "9", kind: "rd", source: "sbir" })) >= 0);
  });
});
