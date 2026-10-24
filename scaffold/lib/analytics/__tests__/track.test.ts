import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  track,
  landingView,
  descriptionStarted,
  descriptionSubmitted,
  interviewShown,
  interviewCompleted,
  interviewSkipped,
  searchStarted,
  firstResultRendered,
  runCompleted,
  runAbandoned,
  cancelClicked,
  verifyClicked,
  verificationCompleted,
  enhanceOpened,
  enhanceCompleted,
  upgradeViewed,
  upgradeStarted,
  upgradeCompleted,
  runRevisited,
  setAnalyticsConsent,
  type AnalyticsSink,
} from "../track";
import {
  AnalyticsEventSchema,
  AnalyticsEventNameSchema,
  type AnalyticsEvent,
  type AnalyticsEventName,
  type AnalyticsPayload,
} from "../../contracts/analyticsEvent";
import { FLAG_REGISTRY } from "../../flags/registry";

/**
 * PLT-03 — application-level track()/builder tests.
 *
 * These exercise OUR module's own API surface (track(), the 19 funnel
 * builders), not just the underlying CON-01 contract (already covered by
 * `lib/contracts/__tests__/analyticsEvent.test.ts`).
 */

const R10_ENV_VAR = FLAG_REGISTRY.r10_analytics.envVar;

let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  // Most tests in this file want the flag ON so track()'s validation/sink
  // behavior is what's under test, not the flag gate itself. Tests that
  // specifically test the flag gate override this.
  process.env[R10_ENV_VAR] = "true";
  // Analytics is private by default (consent-gated). Grant consent for the bulk
  // of tests so the flag/validation/sink behavior is what's exercised; the
  // consent-gating block below overrides this to assert the opt-in gate.
  setAnalyticsConsent(true);
});

afterEach(() => {
  process.env = savedEnv;
  setAnalyticsConsent(false); // reset the module-level consent gate between tests
});

function spy(): { calls: AnalyticsEvent[]; sink: AnalyticsSink } {
  const calls: AnalyticsEvent[] = [];
  return { calls, sink: (event: AnalyticsEvent) => calls.push(event) };
}

// ---------------------------------------------------------------------------
// Flag gating
// ---------------------------------------------------------------------------

describe("track() — flag gating (r10_analytics)", () => {
  test("flag unset (default OFF) -> fully inert, sink never called", () => {
    delete process.env[R10_ENV_VAR];
    const { calls, sink } = spy();
    track(landingView(), sink);
    assert.equal(calls.length, 0);
  });

  test("flag explicitly off -> fully inert", () => {
    process.env[R10_ENV_VAR] = "false";
    const { calls, sink } = spy();
    track(landingView({ count: 1 }), sink);
    assert.equal(calls.length, 0);
  });

  test("flag on -> a valid event reaches the sink", () => {
    const { calls, sink } = spy();
    track(landingView({ count: 1 }), sink);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "landing_view");
  });

  test("flag off even with an otherwise-valid event -> sink still never called", () => {
    delete process.env[R10_ENV_VAR];
    const { calls, sink } = spy();
    track(runAbandoned(4200, { results_shown: 2 }), sink);
    assert.equal(calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Consent gating (§5.3 / R10.1) — private by default; opt-in required
// ---------------------------------------------------------------------------

describe("track() — consent gating (opt-in required)", () => {
  test("flag on but consent NOT granted -> fully inert, sink never called", () => {
    // flag is ON via beforeEach; revoke consent for this case.
    setAnalyticsConsent(false);
    const { calls, sink } = spy();
    track(landingView({ count: 1 }), sink);
    assert.equal(calls.length, 0);
  });

  test("flag on + consent granted -> a valid event reaches the sink", () => {
    setAnalyticsConsent(true);
    const { calls, sink } = spy();
    track(landingView({ count: 1 }), sink);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "landing_view");
  });

  test("both gates required: consent granted but flag OFF -> still inert", () => {
    delete process.env[R10_ENV_VAR];
    setAnalyticsConsent(true);
    const { calls, sink } = spy();
    track(landingView({ count: 1 }), sink);
    assert.equal(calls.length, 0);
  });

  test("revoking consent mid-session immediately stops emission", () => {
    setAnalyticsConsent(true);
    const { calls, sink } = spy();
    track(landingView(), sink);
    assert.equal(calls.length, 1);
    setAnalyticsConsent(false);
    track(runCompleted({ results_shown: 0 }), sink);
    assert.equal(calls.length, 1); // no second event after opt-out
  });
});

// ---------------------------------------------------------------------------
// Never throws
// ---------------------------------------------------------------------------

describe("track() — never throws, never crashes a bad call site", () => {
  test("flag off + garbage event -> no throw, sink not called", () => {
    delete process.env[R10_ENV_VAR];
    const { calls, sink } = spy();
    assert.doesNotThrow(() => track({} as unknown as AnalyticsEvent, sink));
    assert.equal(calls.length, 0);
  });

  test("flag on + invalid event shape -> silent no-op, no throw, sink not called", () => {
    const { calls, sink } = spy();
    const bad = { name: "not_a_real_event", ts: -1 } as unknown as AnalyticsEvent;
    assert.doesNotThrow(() => track(bad, sink));
    assert.equal(calls.length, 0);
  });

  test("a throwing sink does not propagate out of track()", () => {
    const throwingSink: AnalyticsSink = () => {
      throw new Error("sink exploded");
    };
    assert.doesNotThrow(() => track(landingView(), throwingSink));
  });

  test("default sink (no sink argument) uses console.debug and never throws", () => {
    const original = console.debug;
    const logged: unknown[][] = [];
    console.debug = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      assert.doesNotThrow(() => track(landingView({ count: 1 })));
    } finally {
      console.debug = original;
    }
    assert.equal(logged.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Runtime rejection — description/free-text content NEVER reaches the sink
// ---------------------------------------------------------------------------

describe("track() — runtime rejection of description/free-text content", () => {
  test("a forbidden key (`description`) never reaches the sink", () => {
    const { calls, sink } = spy();
    // Cast bypasses the compile-time guarantee on purpose, to exercise the
    // runtime backstop for values that arrive already-typed as AnalyticsEvent
    // (e.g. from JSON, or a non-TS caller).
    const smuggled = {
      name: "search_started",
      ts: Date.now(),
      payload: { description: "we build AI for hospitals, pre-filing IP" },
    } as unknown as AnalyticsEvent;
    track(smuggled, sink);
    assert.equal(calls.length, 0);
  });

  test("free text under a BENIGN key (e.g. `blurb`) never reaches the sink", () => {
    const { calls, sink } = spy();
    const smuggled = {
      name: "description_submitted",
      ts: Date.now(),
      payload: { blurb: "we build AI for hospitals, pre-filing IP, raising $2.5M, 15 people" },
    } as unknown as AnalyticsEvent;
    track(smuggled, sink);
    assert.equal(calls.length, 0);
  });

  test("free text under a benign key never reaches the sink even when smuggled through a builder", () => {
    const { calls, sink } = spy();
    const smuggledPayload = { blurb: "we build AI for hospitals" } as unknown as AnalyticsPayload;
    const event = landingView(smuggledPayload);
    track(event, sink);
    assert.equal(calls.length, 0);
  });

  test("the default console.debug sink is also never invoked for a smuggled description", () => {
    const original = console.debug;
    const logged: unknown[][] = [];
    console.debug = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const smuggled = {
        name: "run_completed",
        ts: Date.now(),
        payload: { notes: "raising a seed round, 15 employees, pre-revenue" },
      } as unknown as AnalyticsEvent;
      track(smuggled);
    } finally {
      console.debug = original;
    }
    assert.equal(logged.length, 0);
  });
});

// ---------------------------------------------------------------------------
// run_abandoned — elapsed_ms is required ("the single most important event")
// ---------------------------------------------------------------------------

describe("runAbandoned() — elapsed_ms is required", () => {
  test("builds a valid run_abandoned event carrying elapsed_ms in the payload", () => {
    const event = runAbandoned(4200, { results_shown: 2 });
    assert.equal(event.name, "run_abandoned");
    assert.equal(event.payload?.elapsed_ms, 4200);
    assert.equal(event.payload?.results_shown, 2);
    assert.doesNotThrow(() => AnalyticsEventSchema.parse(event));
  });

  test("tracks successfully end to end", () => {
    const { calls, sink } = spy();
    track(runAbandoned(9999), sink);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].payload?.elapsed_ms, 9999);
  });
});

// ---------------------------------------------------------------------------
// All 19 R10.1 funnel events are wired through OUR module's builders
// ---------------------------------------------------------------------------

describe("all 19 R10.1 funnel events are wired end to end", () => {
  // Record<AnalyticsEventName, ...> makes this exhaustive BY CONSTRUCTION: if
  // a name were ever added to AnalyticsEventNameSchema without a matching
  // builder here, this object literal fails to type-check.
  const BUILDERS: Record<AnalyticsEventName, () => AnalyticsEvent> = {
    landing_view: () => landingView({ count: 1 }),
    description_started: () => descriptionStarted(),
    description_submitted: () => descriptionSubmitted({ char_count: 120 }),
    interview_shown: () => interviewShown(),
    interview_completed: () => interviewCompleted({ questions_answered: 3 }),
    interview_skipped: () => interviewSkipped(),
    search_started: () => searchStarted(),
    first_result_rendered: () => firstResultRendered({ results_shown: 5 }),
    run_completed: () => runCompleted({ results_shown: 10 }),
    run_abandoned: () => runAbandoned(4200, { results_shown: 2 }),
    cancel_clicked: () => cancelClicked(),
    verify_clicked: () => verifyClicked(),
    verification_completed: () => verificationCompleted({ verified_count: 4 }),
    enhance_opened: () => enhanceOpened(),
    enhance_completed: () => enhanceCompleted(),
    upgrade_viewed: () => upgradeViewed(),
    upgrade_started: () => upgradeStarted(),
    upgrade_completed: () => upgradeCompleted(),
    run_revisited: () => runRevisited({ visits: 2 }),
  };

  test("BUILDERS covers every name in AnalyticsEventNameSchema exactly", () => {
    assert.deepEqual(
      Object.keys(BUILDERS).sort(),
      AnalyticsEventNameSchema.options.slice().sort(),
    );
  });

  for (const name of AnalyticsEventNameSchema.options) {
    test(`${name}: builds + tracks without type or runtime errors, reaches the sink`, () => {
      const { calls, sink } = spy();
      const event = BUILDERS[name]();
      assert.equal(event.name, name);
      assert.doesNotThrow(() => AnalyticsEventSchema.parse(event));
      assert.doesNotThrow(() => track(event, sink));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].name, name);
    });
  }
});

/**
 * Compile-time guarantees at OUR module's own API surface — track() and the
 * funnel builders, not the raw AnalyticsEvent type (that's covered by
 * `lib/contracts/__tests__/analyticsEvent.test.ts`'s own `_compileTimeChecks`).
 * This function is intentionally never called; it exists so `tsc --noEmit`
 * type-checks the `@ts-expect-error` assertions below. If any of these
 * guarantees ever weakens, the matching directive goes unused and tsc fails.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _compileTimeChecks() {
  // A forbidden key passed straight through track() is a type error at the
  // track() call site itself.
  // @ts-expect-error - track() rejects a `description` key in the payload.
  track({ name: "search_started", ts: 0, payload: { description: "we build AI" } });

  // A free-text string under a benign key is illegal through track() too —
  // values must be number | boolean | AnalyticsId, never raw string content.
  // @ts-expect-error - free-text values are not assignable, even via track().
  track({ name: "search_started", ts: 0, payload: { blurb: "we build AI for hospitals" } });

  // Same guarantee at a builder call site — a forbidden key.
  // @ts-expect-error - landingView()'s payload param rejects a `description` key.
  landingView({ description: "we build AI for hospitals" });

  // Same guarantee at a builder call site — free text under a benign key.
  // @ts-expect-error - landingView()'s payload param rejects free-text values.
  landingView({ blurb: "we build AI for hospitals, pre-filing IP" });

  // run_abandoned's elapsed_ms is a REQUIRED parameter, not optional.
  // @ts-expect-error - runAbandoned() requires elapsed_ms as its first argument.
  runAbandoned();

  // Sanity check the positive case still compiles (not itself a @ts-expect-error).
  const ok = runAbandoned(1000, { results_shown: 1 });

  return ok;
}
