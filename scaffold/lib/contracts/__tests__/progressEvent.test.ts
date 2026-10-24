import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ProgressEventSchema,
  ProgressStatusSchema,
} from "../progressEvent";

/** §3.2 — status must express `failed` and `timed_out`. */

test("status enum includes failed and timed_out", () => {
  assert.ok(ProgressStatusSchema.options.includes("failed"));
  assert.ok(ProgressStatusSchema.options.includes("timed_out"));
});

test("a failed stage event parses", () => {
  const ev = {
    stage: "search_dispatched",
    status: "failed",
    message: "Grants.gov did not respond",
    ts: Date.now(),
  };
  assert.doesNotThrow(() => ProgressEventSchema.parse(ev));
});

test("a timed_out stage event parses, with an optional pct hint", () => {
  const ev = {
    stage: "analysis_streaming",
    status: "timed_out",
    message: "Analysis exceeded the budget",
    pct_hint: 60,
    ts: Date.now(),
  };
  assert.doesNotThrow(() => ProgressEventSchema.parse(ev));
});

test("an unknown stage is rejected", () => {
  const ev = { stage: "nope", status: "done", message: "", ts: 0 };
  assert.equal(ProgressEventSchema.safeParse(ev).success, false);
});

test("pct_hint out of 0..100 is rejected", () => {
  const ev = { stage: "ranking", status: "in_progress", message: "", pct_hint: 150, ts: 0 };
  assert.equal(ProgressEventSchema.safeParse(ev).success, false);
});
