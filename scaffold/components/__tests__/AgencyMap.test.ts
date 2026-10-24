import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveAgencyRelevance, type AgencyIntelLike, type MatchLike } from "../AgencyMap";

/**
 * D2 — "Agencies most relevant to you" view.
 *
 * Mirrors the existing lib test style (node:test + assert, no network, no
 * DOM — see lib/similar/__tests__/aggregate.test.ts). Exercises the pure
 * `deriveAgencyRelevance` derivation only: it consumes the EXISTING
 * agencyIntelligence + matches already computed by lib/match.ts and never
 * recomputes scoring/matching itself.
 */
describe("deriveAgencyRelevance", () => {
  test("keeps the LLM-authored why when present", () => {
    const intel: AgencyIntelLike[] = [
      { agency: "NIH", why: "Funds AI diagnostics for rural clinics.", opportunityCount: 2 },
    ];
    const matches: MatchLike[] = [
      { tier: "likely", score: 82, opportunity: { agency: "NIH", program: "Rural Clinic AI Diagnostics" } },
      { tier: "verify", score: 55, opportunity: { agency: "NIH", program: "Telehealth Innovation" } },
    ];

    const result = deriveAgencyRelevance(intel, matches);
    assert.equal(result.length, 1);
    assert.equal(result[0].agency, "NIH");
    assert.equal(result[0].headline, "Funds AI diagnostics for rural clinics.");
  });

  test("synthesizes a fallback headline from count/programs/sectors when why is empty", () => {
    const intel: AgencyIntelLike[] = [{ agency: "NSF", why: "", opportunityCount: 2 }];
    const matches: MatchLike[] = [
      {
        tier: "likely",
        score: 70,
        opportunity: { agency: "NSF", program: "SBIR Phase I", industryTags: ["Health IT"] },
      },
      {
        tier: "verify",
        score: 40,
        opportunity: { agency: "NSF", program: "SBIR Phase II", industryTags: ["Health IT", "AI/ML"] },
      },
    ];

    const result = deriveAgencyRelevance(intel, matches);
    assert.equal(result.length, 1);
    assert.equal(
      result[0].headline,
      "2 matching opportunities including SBIR Phase I, SBIR Phase II in Health IT, AI/ML.",
    );
    assert.deepEqual(result[0].programs, ["SBIR Phase I", "SBIR Phase II"]);
    assert.deepEqual(result[0].sectors, ["Health IT", "AI/ML"]);
  });

  test("uses singular 'opportunity' in the fallback headline when count is 1", () => {
    const intel: AgencyIntelLike[] = [{ agency: "DOE", why: "   ", opportunityCount: 1 }];
    const result = deriveAgencyRelevance(intel, []);
    assert.equal(result[0].headline, "1 matching opportunity.");
  });

  test("only pulls programs/sectors from strong (likely/verify) matches for the right agency", () => {
    const intel: AgencyIntelLike[] = [{ agency: "DOD", why: "", opportunityCount: 1 }];
    const matches: MatchLike[] = [
      // Wrong agency — excluded.
      { tier: "likely", score: 90, opportunity: { agency: "NASA", program: "Should Not Appear" } },
      // Right agency, but tier "adjacent" — excluded (not strong).
      { tier: "adjacent", score: 20, opportunity: { agency: "DOD", program: "Adjacent Program" } },
      // Right agency, strong — included.
      { tier: "likely", score: 60, opportunity: { agency: "DOD", program: "Defense Innovation Unit" } },
    ];

    const result = deriveAgencyRelevance(intel, matches);
    assert.deepEqual(result[0].programs, ["Defense Innovation Unit"]);
  });

  test("dedupes and caps programs/sectors to 3, ordered by score desc", () => {
    const intel: AgencyIntelLike[] = [{ agency: "NIH", why: "", opportunityCount: 5 }];
    const matches: MatchLike[] = [
      { tier: "likely", score: 10, opportunity: { agency: "NIH", program: "P1", industryTags: ["S1"] } },
      { tier: "likely", score: 90, opportunity: { agency: "NIH", program: "P2", industryTags: ["S2"] } },
      { tier: "verify", score: 50, opportunity: { agency: "NIH", program: "P2", industryTags: ["S2"] } }, // duplicate
      { tier: "likely", score: 70, opportunity: { agency: "NIH", program: "P3", industryTags: ["S3"] } },
      { tier: "likely", score: 60, opportunity: { agency: "NIH", program: "P4", industryTags: ["S4"] } },
    ];

    const result = deriveAgencyRelevance(intel, matches);
    // Highest score first (P2), deduped, capped at 3.
    assert.deepEqual(result[0].programs, ["P2", "P3", "P4"]);
    assert.deepEqual(result[0].sectors, ["S2", "S3", "S4"]);
  });

  test("handles empty/missing input without throwing", () => {
    assert.deepEqual(deriveAgencyRelevance([], []), []);
    assert.deepEqual(deriveAgencyRelevance(undefined, undefined), []);
    assert.deepEqual(deriveAgencyRelevance(null, null), []);
  });

  test("does not crash on a match with no opportunity", () => {
    const intel: AgencyIntelLike[] = [{ agency: "NIH", why: "Some why", opportunityCount: 1 }];
    const matches: MatchLike[] = [{ tier: "likely", score: 50 }];
    const result = deriveAgencyRelevance(intel, matches);
    assert.equal(result[0].headline, "Some why");
    assert.deepEqual(result[0].programs, []);
  });
});
