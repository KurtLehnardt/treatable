import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AnalyticsEventSchema,
  AnalyticsPayloadSchema,
  analyticsId,
  type AnalyticsEvent,
} from "../analyticsEvent";

/**
 * §3.11 — AnalyticsEvent MUST NOT be able to carry description content.
 *
 * The primary guarantee is COMPILE-TIME (see `_compileTimeChecks` below) and is
 * verified by `npx tsc --noEmit`: each `@ts-expect-error` must stay a real
 * error. If the guarantee weakens, the directive becomes unused and tsc fails.
 *
 * These runtime tests are the belt-and-suspenders backstop.
 */

test("valid analytics event parses (names, ids, timings, counts only)", () => {
  const ev = {
    name: "run_abandoned",
    ts: Date.now(),
    session_id: "sess_123",
    payload: { elapsed_ms: 42000, results_shown: 3, was_pro: false },
  };
  assert.doesNotThrow(() => AnalyticsEventSchema.parse(ev));
});

test("runtime guard rejects a payload with a `description` key", () => {
  const bad = { description: "we build AI for hospitals" } as unknown;
  const res = AnalyticsPayloadSchema.safeParse(bad);
  assert.equal(res.success, false);
});

test("runtime guard rejects other free-text content keys", () => {
  for (const key of ["text", "content", "raw_text", "company_description", "prompt"]) {
    const res = AnalyticsPayloadSchema.safeParse({ [key]: "some free text" });
    assert.equal(res.success, false, `expected key '${key}' to be rejected`);
  }
});

test("branded analytics ids are legal payload values", () => {
  const ev: AnalyticsEvent = {
    name: "run_completed",
    ts: 0,
    payload: { run_id: analyticsId("run_abc"), count: 2 },
  };
  assert.equal(ev.payload?.count, 2);
});

// --- Smuggling probe (HIGH hardening): free text must not pass as an id ---

test("analyticsId() THROWS on a long free-text description (no cast bypass)", () => {
  const description =
    "We build AI software for hospitals, pre-filing IP, raising $2.5M, 15 people in Utah.";
  assert.throws(() => analyticsId(description), /Invalid analytics id/);
});

test("analyticsId() rejects whitespace and over-length ids", () => {
  assert.throws(() => analyticsId("has spaces"));
  assert.throws(() => analyticsId("a".repeat(65)));
  assert.throws(() => analyticsId("comma,separated"));
});

test("analyticsId() accepts a legit short opaque id", () => {
  assert.doesNotThrow(() => analyticsId("run_abc-123.v2:1"));
});

test("runtime guard rejects free text under a BENIGN key (value-aware)", () => {
  const smuggled = { blurb: "we build AI for hospitals, pre-filing IP" };
  assert.equal(AnalyticsPayloadSchema.safeParse(smuggled).success, false);
});

test("runtime guard accepts id-shaped string values under a benign key", () => {
  const ok = { run_id: "run_abc123", count: 3, was_pro: true };
  assert.equal(AnalyticsPayloadSchema.safeParse(ok).success, true);
});

/**
 * Compile-time guarantees. This function is intentionally never called — it
 * exists so `tsc` type-checks the assertions below.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _compileTimeChecks() {
  // A `description` key with free text must be a type error.
  // @ts-expect-error - AnalyticsEvent payload cannot carry a `description`.
  const a: AnalyticsEvent = { name: "search_started", ts: 0, payload: { description: "we build AI" } };

  // ANY raw free-text string value is illegal, even under a benign key.
  // @ts-expect-error - free-text string values are not assignable to a payload.
  const b: AnalyticsEvent = { name: "search_started", ts: 0, payload: { note: "free text" } };

  // A branded id under a forbidden key is still illegal (key denylist).
  // @ts-expect-error - `content` is a forbidden key regardless of value type.
  const c: AnalyticsEvent = { name: "search_started", ts: 0, payload: { content: analyticsId("x") } };

  return [a, b, c];
}
