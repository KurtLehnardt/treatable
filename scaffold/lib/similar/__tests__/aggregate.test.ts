import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { aggregateSimilarCompanies, type MatchLike } from "../aggregate";

/**
 * D1 — free "Similar companies funded" aggregate panel.
 *
 * Mirrors the existing lib test style (node:test + assert, no network, no
 * DOM). Covers the three required paths: verified-only filtering, cross-match
 * dedupe, and a deterministic capped sort.
 */
describe("aggregateSimilarCompanies", () => {
  test("drops recipients without a sourceUrl (missing or empty string)", () => {
    const matches: MatchLike[] = [
      {
        tier: "likely",
        history: {
          recipients: [
            { company: "Verified Co", program: "SBIR Phase I", agency: "NSF", amount: 250000, year: 2023, sourceUrl: "https://www.sbir.gov/awards?firm=verified-co" },
            { company: "No Source Co", program: "SBIR Phase I", agency: "NSF", amount: 200000, year: 2023 }, // no sourceUrl at all
            { company: "Empty Source Co", program: "SBIR Phase I", agency: "NSF", amount: 300000, year: 2023, sourceUrl: "" }, // empty string
          ],
        },
      },
    ];

    const result = aggregateSimilarCompanies(matches);
    assert.equal(result.length, 1);
    assert.equal(result[0].company, "Verified Co");
    assert.equal(result[0].sourceUrl, "https://www.sbir.gov/awards?firm=verified-co");
  });

  test("dedupes the same award appearing under two different matches", () => {
    const shared = {
      company: "Repeat Co",
      program: "SBIR Phase II",
      agency: "DOD",
      amount: 750000,
      year: 2022,
      sourceUrl: "https://www.sbir.gov/awards?firm=repeat-co",
    };
    const matches: MatchLike[] = [
      { tier: "likely", history: { recipients: [shared] } },
      { tier: "verify", history: { recipients: [{ ...shared }] } },
    ];

    const result = aggregateSimilarCompanies(matches);
    assert.equal(result.length, 1);
    assert.equal(result[0].company, "Repeat Co");
  });

  test("caps to the requested limit and sorts deterministically (amount desc, then company)", () => {
    const matches: MatchLike[] = [
      {
        tier: "likely",
        history: {
          recipients: [
            { company: "Charlie Co", program: "SBIR", agency: "NASA", amount: 100000, year: 2021, sourceUrl: "https://www.sbir.gov/awards?firm=charlie" },
            { company: "Bravo Co", program: "SBIR", agency: "NASA", amount: 500000, year: 2021, sourceUrl: "https://www.sbir.gov/awards?firm=bravo" },
            { company: "Alpha Co", program: "SBIR", agency: "NASA", amount: 500000, year: 2021, sourceUrl: "https://www.sbir.gov/awards?firm=alpha" },
            { company: "Delta Co", program: "SBIR", agency: "NASA", amount: 900000, year: 2021, sourceUrl: "https://www.sbir.gov/awards?firm=delta" },
          ],
        },
      },
    ];

    const capped = aggregateSimilarCompanies(matches, { limit: 2 });
    assert.equal(capped.length, 2);
    // Highest amount first (Delta), then a tie broken by company name
    // (Alpha before Bravo at 500000).
    assert.equal(capped[0].company, "Delta Co");
    assert.equal(capped[1].company, "Alpha Co");

    // Re-running against the same input is stable (deterministic sort).
    const again = aggregateSimilarCompanies(matches, { limit: 2 });
    assert.deepEqual(capped, again);
  });

  test("prefers strong (likely/verify) matches, falling back to all matches only when strong yields nothing verified", () => {
    const strongButUnverified: MatchLike = {
      tier: "likely",
      history: {
        recipients: [{ company: "Unverified Strong Co", program: "SBIR", agency: "NIH", amount: 400000, year: 2020 }],
      },
    };
    const adjacentVerified: MatchLike = {
      tier: "adjacent",
      history: {
        recipients: [{ company: "Verified Adjacent Co", program: "SBIR", agency: "NIH", amount: 400000, year: 2020, sourceUrl: "https://www.sbir.gov/awards?firm=adjacent" }],
      },
    };

    const result = aggregateSimilarCompanies([strongButUnverified, adjacentVerified]);
    assert.equal(result.length, 1);
    assert.equal(result[0].company, "Verified Adjacent Co");
  });

  test("handles empty/missing input without throwing", () => {
    assert.deepEqual(aggregateSimilarCompanies([]), []);
    assert.deepEqual(aggregateSimilarCompanies(undefined), []);
    assert.deepEqual(aggregateSimilarCompanies(null), []);
    assert.deepEqual(aggregateSimilarCompanies([{ tier: "likely" }]), []);
  });
});
