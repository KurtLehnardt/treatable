import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { diffOpportunities } from "../diff";
import type { AlertMatchLike, AlertSnapshot } from "../types";

/**
 * D5 — pure diff logic for "Opportunity Alerts". Mirrors the existing lib
 * test style (node:test + assert, no network, no DOM — see
 * lib/similar/__tests__/aggregate.test.ts / components/__tests__/AgencyMap.test.ts).
 * Storage is exercised separately in store.test.ts; this file only exercises
 * diffOpportunities, which never touches localStorage.
 */

const PROFILE_KEY = "profile-abc";
const NOW = Date.parse("2026-01-01T00:00:00.000Z");

function snapshot(opportunities: AlertSnapshot["opportunities"], profileKey = PROFILE_KEY): AlertSnapshot {
  return { profileKey, savedAt: "2025-12-01T00:00:00.000Z", opportunities };
}

describe("diffOpportunities", () => {
  test("flags a brand-new opportunity not present in the previous snapshot", () => {
    const previous = snapshot({});
    const matches: AlertMatchLike[] = [
      { tier: "likely", opportunity: { id: "opp-1", title: "Rural Health AI Grant", agency: "NIH" } },
    ];

    const { alerts, nextSnapshot } = diffOpportunities(previous, PROFILE_KEY, matches, NOW);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].kind, "new");
    assert.equal(alerts[0].opportunityId, "opp-1");
    assert.equal(alerts[0].title, "Rural Health AI Grant");
    assert.equal(alerts[0].agency, "NIH");
    assert.equal(alerts[0].tier, "likely");
    assert.equal(nextSnapshot.profileKey, PROFILE_KEY);
    assert.deepEqual(nextSnapshot.opportunities["opp-1"], { tier: "likely", closingSoon: false });
  });

  test("with no previous snapshot at all (first-ever run), every real-fit match is 'new'", () => {
    const matches: AlertMatchLike[] = [
      { tier: "verify", opportunity: { id: "opp-1", title: "A" } },
      { tier: "adjacent", opportunity: { id: "opp-2", title: "B" } },
      { tier: "none", opportunity: { id: "opp-3", title: "C (not a real fit)" } },
    ];

    const { alerts } = diffOpportunities(null, PROFILE_KEY, matches, NOW);

    // tier "none" is excluded — never a real fit, never alerted.
    assert.equal(alerts.length, 2);
    assert.deepEqual(
      alerts.map((a) => a.opportunityId).sort(),
      ["opp-1", "opp-2"],
    );
    assert.ok(alerts.every((a) => a.kind === "new"));
  });

  test("detects a tier upgrade (adjacent -> verify)", () => {
    const previous = snapshot({ "opp-1": { tier: "adjacent", closingSoon: false } });
    const matches: AlertMatchLike[] = [
      { tier: "verify", opportunity: { id: "opp-1", title: "Grew Into It", agency: "DOE" } },
    ];

    const { alerts } = diffOpportunities(previous, PROFILE_KEY, matches, NOW);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].kind, "tier_upgrade");
    assert.equal(alerts[0].previousTier, "adjacent");
    assert.equal(alerts[0].tier, "verify");
  });

  test("detects a tier upgrade all the way from verify -> likely", () => {
    const previous = snapshot({ "opp-1": { tier: "verify", closingSoon: false } });
    const matches: AlertMatchLike[] = [{ tier: "likely", opportunity: { id: "opp-1", title: "X" } }];

    const { alerts } = diffOpportunities(previous, PROFILE_KEY, matches, NOW);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].kind, "tier_upgrade");
    assert.equal(alerts[0].previousTier, "verify");
    assert.equal(alerts[0].tier, "likely");
  });

  test("a tier DOWNGRADE produces no tier_upgrade alert (and no alert at all when closing-soon is unchanged)", () => {
    const previous = snapshot({ "opp-1": { tier: "likely", closingSoon: false } });
    const matches: AlertMatchLike[] = [{ tier: "verify", opportunity: { id: "opp-1", title: "X" } }];

    const { alerts, nextSnapshot } = diffOpportunities(previous, PROFILE_KEY, matches, NOW);

    assert.equal(alerts.length, 0);
    // The snapshot still updates to reflect reality (the downgrade), just silently.
    assert.equal(nextSnapshot.opportunities["opp-1"].tier, "verify");
  });

  test("no false alerts when nothing changed (same tier, same closing-soon state)", () => {
    const previous = snapshot({ "opp-1": { tier: "likely", closingSoon: false } });
    const matches: AlertMatchLike[] = [
      { tier: "likely", opportunity: { id: "opp-1", title: "Steady State", deadline: "2027-06-01" } },
    ];

    const { alerts } = diffOpportunities(previous, PROFILE_KEY, matches, NOW);

    assert.deepEqual(alerts, []);
  });

  test("detects a newly closing-soon deadline (tier unchanged, deadline just entered the 90-day window)", () => {
    // NOW = 2026-01-01. A deadline 45 days out is inside the 90-day window.
    const previous = snapshot({ "opp-1": { tier: "likely", closingSoon: false } });
    const matches: AlertMatchLike[] = [
      { tier: "likely", opportunity: { id: "opp-1", title: "Deadline Approaching", deadline: "2026-02-15" } },
    ];

    const { alerts } = diffOpportunities(previous, PROFILE_KEY, matches, NOW);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].kind, "closing_soon");
    assert.equal(alerts[0].opportunityId, "opp-1");
  });

  test("does not re-alert closing-soon on every visit once already flagged", () => {
    const previous = snapshot({ "opp-1": { tier: "likely", closingSoon: true } });
    const matches: AlertMatchLike[] = [
      { tier: "likely", opportunity: { id: "opp-1", title: "Already Flagged", deadline: "2026-02-15" } },
    ];

    const { alerts } = diffOpportunities(previous, PROFILE_KEY, matches, NOW);

    assert.deepEqual(alerts, []);
  });

  test("a tier upgrade takes priority over a simultaneous closing-soon transition (one alert per id)", () => {
    const previous = snapshot({ "opp-1": { tier: "adjacent", closingSoon: false } });
    const matches: AlertMatchLike[] = [
      { tier: "verify", opportunity: { id: "opp-1", title: "Both At Once", deadline: "2026-02-15" } },
    ];

    const { alerts } = diffOpportunities(previous, PROFILE_KEY, matches, NOW);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].kind, "tier_upgrade");
  });

  test("a snapshot saved under a DIFFERENT profile key is ignored — treated as no prior snapshot", () => {
    const previous = snapshot({ "opp-1": { tier: "likely", closingSoon: false } }, "some-other-profile");
    const matches: AlertMatchLike[] = [{ tier: "likely", opportunity: { id: "opp-1", title: "X" } }];

    const { alerts, nextSnapshot } = diffOpportunities(previous, PROFILE_KEY, matches, NOW);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].kind, "new");
    assert.equal(nextSnapshot.profileKey, PROFILE_KEY);
  });

  test("handles a null/undefined/empty previous snapshot and empty/missing matches without throwing", () => {
    assert.deepEqual(diffOpportunities(null, PROFILE_KEY, null, NOW).alerts, []);
    assert.deepEqual(diffOpportunities(undefined, PROFILE_KEY, undefined, NOW).alerts, []);
    assert.deepEqual(diffOpportunities(null, PROFILE_KEY, [], NOW).alerts, []);
  });

  test("skips malformed match entries (missing id/tier) instead of throwing", () => {
    const matches: AlertMatchLike[] = [
      { tier: "likely" }, // no opportunity/id
      { opportunity: { id: "opp-2", title: "No tier" } } as AlertMatchLike, // no tier
      null as unknown as AlertMatchLike,
      { tier: "likely", opportunity: { id: "opp-3", title: "Valid" } },
    ];

    const { alerts, nextSnapshot } = diffOpportunities(null, PROFILE_KEY, matches, NOW);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].opportunityId, "opp-3");
    assert.deepEqual(Object.keys(nextSnapshot.opportunities), ["opp-3"]);
  });

  test("falls back to opportunity.program when title is absent", () => {
    const matches: AlertMatchLike[] = [{ tier: "likely", opportunity: { id: "opp-1", program: "SBIR Phase I" } }];

    const { alerts } = diffOpportunities(null, PROFILE_KEY, matches, NOW);

    assert.equal(alerts[0].title, "SBIR Phase I");
  });

  test("nextSnapshot only tracks real-fit (non-'none') opportunities", () => {
    const matches: AlertMatchLike[] = [
      { tier: "likely", opportunity: { id: "opp-1" } },
      { tier: "none", opportunity: { id: "opp-2" } },
    ];

    const { nextSnapshot } = diffOpportunities(null, PROFILE_KEY, matches, NOW);

    assert.deepEqual(Object.keys(nextSnapshot.opportunities), ["opp-1"]);
  });
});
