import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildFundingStrategy,
  DEFAULT_REGISTRATION_LEAD_DAYS,
  type StrategyMatchLike,
  type FundingStrategyMapLike,
} from "../fundingStrategy";

/**
 * D3 — Funding Strategy sequencing logic.
 *
 * Hermetic, no network, no DOM (mirrors lib/similar/__tests__ + the D2
 * AgencyMap test). A FIXED reference time is injected so every window is
 * reproducible. Deadlines use date-only ("YYYY-MM-DD") strings, which parse as
 * UTC midnight, keeping the math locale/timezone-independent.
 */

const NOW = new Date("2026-01-15T00:00:00Z");

function mkMatch(over: Partial<StrategyMatchLike> & { opportunity?: Partial<StrategyMatchLike["opportunity"]> } = {}): StrategyMatchLike {
  const { opportunity, ...rest } = over;
  return {
    score: 50,
    tier: "likely",
    opportunity: {
      id: "opp-x",
      program: "Program X",
      agency: "Agency X",
      kind: "grant",
      ...(opportunity ?? {}),
    },
    ...rest,
  };
}

function mapOf(...matches: StrategyMatchLike[]): FundingStrategyMapLike {
  return { matches };
}

describe("buildFundingStrategy — deadline ordering", () => {
  test("a nearer REAL deadline gets an earlier action slot and comes first in the plan", () => {
    const near = mkMatch({
      opportunity: { id: "near", program: "Near", deadline: "2026-03-01" },
      tier: "likely",
      score: 80,
    });
    const far = mkMatch({
      opportunity: { id: "far", program: "Far", deadline: "2026-11-01" },
      tier: "likely",
      score: 80,
    });

    const plan = buildFundingStrategy(mapOf(far, near), { now: NOW });
    assert.equal(plan.items.length, 2);
    // Nearer deadline sequenced first.
    assert.equal(plan.items[0].opportunity.id, "near");
    assert.equal(plan.items[1].opportunity.id, "far");
    // ... and earlier action month.
    assert.ok(plan.items[0].window.month < plan.items[1].window.month);
    assert.equal(plan.items[0].window.month, 1); // ~45 days out, minus prep → act now
    assert.equal(plan.items[0].hasDeadline, true);
    assert.equal(plan.items[0].deadline, "2026-03-01");
    assert.equal(plan.items[0].window.flexible, false);
  });

  test("deadline urgency can sequence a near-deadline program ahead of a higher-fit, far-deadline one", () => {
    const strongFarLikely = mkMatch({
      opportunity: { id: "strong", program: "Strong", deadline: "2026-10-01" },
      tier: "likely",
      score: 95,
    });
    const weakerNearVerify = mkMatch({
      opportunity: { id: "urgent", program: "Urgent", deadline: "2026-02-10" },
      tier: "verify",
      score: 55,
    });

    const plan = buildFundingStrategy(mapOf(strongFarLikely, weakerNearVerify), { now: NOW });
    // Both selected (fit picks who's in); the near deadline acts first.
    assert.deepEqual(
      plan.items.map((i) => i.opportunity.id),
      ["urgent", "strong"],
    );
  });
});

describe("buildFundingStrategy — evergreen / no invented deadline", () => {
  test("a rolling program is flexible and carries NO deadline (even if a stray deadline string is present)", () => {
    const rolling = mkMatch({
      opportunity: {
        id: "rolling",
        program: "Rolling",
        status: "rolling",
        // Present but MUST be ignored — status makes it evergreen.
        deadline: "2026-05-01",
      },
    });

    const plan = buildFundingStrategy(mapOf(rolling), { now: NOW });
    const it = plan.items[0];
    assert.equal(it.hasDeadline, false);
    assert.equal(it.deadline, null);
    assert.equal(it.window.flexible, true);
    assert.equal(it.window.label, "Flexible (rolling)");
    assert.match(it.rationale, /no fixed deadline/i);
  });

  test("missing OR already-past deadlines are treated as flexible, never fabricated", () => {
    const noDeadline = mkMatch({ opportunity: { id: "none-dl", program: "NoDeadline" } });
    const past = mkMatch({
      opportunity: { id: "past", program: "Past", status: "open", deadline: "2025-01-01" },
    });

    const plan = buildFundingStrategy(mapOf(noDeadline, past), { now: NOW });
    for (const it of plan.items) {
      assert.equal(it.hasDeadline, false);
      assert.equal(it.deadline, null);
      assert.equal(it.window.flexible, true);
    }
  });

  test("all-evergreen plans spread flexible programs across the horizon (no pile-up)", () => {
    const evers = [1, 2, 3].map((n) =>
      mkMatch({ opportunity: { id: `ev${n}`, program: `Ever ${n}`, status: "rolling" }, score: 90 - n }),
    );
    const plan = buildFundingStrategy(mapOf(...evers), { now: NOW });
    const months = plan.items.map((i) => i.window.month);
    // Spread on a cadence, all within [1, 12], strictly increasing.
    assert.deepEqual(months, [1, 3, 5]);
    assert.ok(months.every((m) => m >= 1 && m <= 12));
  });
});

describe("buildFundingStrategy — registration lead time", () => {
  test("registration required via the eligibility determination → note + per-item flag + rationale", () => {
    const withReg = mkMatch({
      opportunity: { id: "reg", program: "RegProgram", deadline: "2026-06-01" },
      eligibility: {
        determination: {
          bucket: "conditionally_eligible",
          required_steps: [
            { step: "Register the entity in SAM.gov and obtain a UEI.", lead_time_days: 21, why: "weeks" },
          ],
        },
      },
    });

    const plan = buildFundingStrategy(mapOf(withReg), { now: NOW });
    const it = plan.items[0];
    assert.equal(it.requiresRegistration, true);
    assert.equal(it.registrationLeadDays, 21);
    assert.match(it.rationale, /SAM\.gov/);
    assert.ok(plan.registrationNote);
    assert.match(plan.registrationNote as string, /SAM\.gov/);
    // Points at the first hard deadline.
    assert.match(plan.registrationNote as string, /Jun 1, 2026/);
  });

  test("registration inferred from eligibility PROSE when no determination is attached", () => {
    const prose = mkMatch({
      opportunity: {
        id: "prose",
        program: "ProseProgram",
        eligibility: "Applicants must be actively registered in SAM.gov before applying.",
        deadline: "2026-04-15",
      },
    });
    const plan = buildFundingStrategy(mapOf(prose), { now: NOW });
    assert.equal(plan.items[0].requiresRegistration, true);
    assert.equal(plan.items[0].registrationLeadDays, DEFAULT_REGISTRATION_LEAD_DAYS);
    assert.ok(plan.registrationNote);
  });

  test("no registration signal → no note, no per-item flag", () => {
    const clean = mkMatch({
      opportunity: { id: "clean", program: "Clean", deadline: "2026-07-15", eligibility: "Open to all." },
    });
    const plan = buildFundingStrategy(mapOf(clean), { now: NOW });
    assert.equal(plan.items[0].requiresRegistration, false);
    assert.equal(plan.items[0].registrationLeadDays, 0);
    assert.equal(plan.registrationNote, null);
  });

  test("with only evergreen registration-required programs, the note still fires (no deadline referenced)", () => {
    const ever = mkMatch({
      opportunity: { id: "ev", program: "EverReg", status: "rolling" },
      eligibility: { determination: { bucket: "conditionally_eligible", required_steps: [{ step: "SAM.gov" }] } },
    });
    const plan = buildFundingStrategy(mapOf(ever), { now: NOW });
    assert.ok(plan.registrationNote);
    assert.match(plan.registrationNote as string, /SAM\.gov/);
    assert.doesNotMatch(plan.registrationNote as string, /hard deadline/);
  });
});

describe("buildFundingStrategy — cap and selection", () => {
  test("caps the plan at 5 programs, keeping the best fits", () => {
    const many = [95, 85, 75, 65, 55, 45, 35].map((s, i) =>
      mkMatch({ opportunity: { id: `p${i}`, program: `P${i}`, status: "rolling" }, tier: "likely", score: s }),
    );
    const plan = buildFundingStrategy(mapOf(...many), { now: NOW });
    assert.equal(plan.items.length, 5);
    // The two lowest-scoring (45, 35) are dropped.
    const scores = new Set(plan.items.map((i) => i.score));
    assert.ok(scores.has(95) && scores.has(55));
    assert.ok(!scores.has(45) && !scores.has(35));
  });

  test("selection prioritizes fit tier over raw score", () => {
    const likelyLowScore = mkMatch({
      opportunity: { id: "L", program: "Likely", status: "rolling" },
      tier: "likely",
      score: 10,
    });
    const verifyHighScore = mkMatch({
      opportunity: { id: "V", program: "Verify", status: "rolling" },
      tier: "verify",
      score: 99,
    });
    const plan = buildFundingStrategy(mapOf(verifyHighScore, likelyLowScore), { now: NOW, cap: 1 });
    assert.equal(plan.items.length, 1);
    assert.equal(plan.items[0].opportunity.id, "L"); // likely tier wins the single slot
  });

  test("excludes 'none'-tier matches and matches without an opportunity", () => {
    const plan = buildFundingStrategy(
      mapOf(
        mkMatch({ opportunity: { id: "keep", program: "Keep", status: "rolling" }, tier: "adjacent" }),
        mkMatch({ opportunity: { id: "drop", program: "Drop", status: "rolling" }, tier: "none" }),
        { tier: "likely", score: 99, opportunity: undefined },
      ),
      { now: NOW },
    );
    assert.deepEqual(plan.items.map((i) => i.opportunity.id), ["keep"]);
  });

  test("dedupes by opportunity id, keeping the best-fit instance", () => {
    const plan = buildFundingStrategy(
      mapOf(
        mkMatch({ opportunity: { id: "dup", program: "Dup", status: "rolling" }, tier: "adjacent", score: 30 }),
        mkMatch({ opportunity: { id: "dup", program: "Dup", status: "rolling" }, tier: "likely", score: 88 }),
      ),
      { now: NOW },
    );
    assert.equal(plan.items.length, 1);
    assert.equal(plan.items[0].tier, "likely");
    assert.equal(plan.items[0].score, 88);
  });
});

describe("buildFundingStrategy — honest framing & robustness", () => {
  test("intro frames the plan as investigation, never a promise of funding", () => {
    const plan = buildFundingStrategy(
      mapOf(mkMatch({ opportunity: { id: "a", status: "rolling" } })),
      { now: NOW },
    );
    assert.match(plan.intro, /not a promise of funding/i);
    assert.match(plan.intro, /investigate/i);
    assert.match(plan.intro, /12 months/);
  });

  test("empty / missing input yields an empty plan and no note (component renders nothing)", () => {
    assert.deepEqual(buildFundingStrategy(undefined).items, []);
    assert.deepEqual(buildFundingStrategy(null).items, []);
    assert.deepEqual(buildFundingStrategy({}).items, []);
    assert.equal(buildFundingStrategy({ matches: [] }).registrationNote, null);
  });

  test("is deterministic — same input + same now → identical plan", () => {
    const build = () =>
      buildFundingStrategy(
        mapOf(
          mkMatch({ opportunity: { id: "a", program: "A", deadline: "2026-05-01" }, tier: "likely", score: 70 }),
          mkMatch({ opportunity: { id: "b", program: "B", status: "rolling" }, tier: "verify", score: 60 }),
        ),
        { now: NOW },
      );
    assert.deepEqual(build(), build());
  });

  test("every window month stays within the 12-month horizon", () => {
    const matches = [
      mkMatch({ opportunity: { id: "1", deadline: "2026-02-01" }, tier: "likely", score: 90 }),
      mkMatch({ opportunity: { id: "2", deadline: "2026-12-20" }, tier: "likely", score: 85 }),
      mkMatch({ opportunity: { id: "3", deadline: "2027-06-01" }, tier: "verify", score: 70 }),
      mkMatch({ opportunity: { id: "4", status: "rolling" }, tier: "adjacent", score: 40 }),
    ];
    const plan = buildFundingStrategy(mapOf(...matches), { now: NOW });
    for (const it of plan.items) {
      assert.ok(it.window.month >= 1 && it.window.month <= 12, `month ${it.window.month} out of range`);
      assert.equal(it.window.quarter, `Q${Math.ceil(it.window.month / 3)}`);
    }
  });
});
