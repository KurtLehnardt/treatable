import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeProfileKey } from "../profileKey";

describe("computeProfileKey", () => {
  test("is deterministic for the same profile", () => {
    const profile = { description: "We build AI diagnostics for rural clinics.", industry: "Health IT" };
    assert.equal(computeProfileKey(profile), computeProfileKey({ ...profile }));
  });

  test("is case/whitespace-insensitive", () => {
    const a = { description: "  We Build AI Diagnostics  ", industry: "Health IT" };
    const b = { description: "we build ai diagnostics", industry: "health it" };
    assert.equal(computeProfileKey(a), computeProfileKey(b));
  });

  test("differs for materially different profiles", () => {
    const a = { description: "We build AI diagnostics for rural clinics." };
    const b = { description: "We manufacture industrial sensors." };
    assert.notEqual(computeProfileKey(a), computeProfileKey(b));
  });

  test("handles null/undefined/empty profiles without throwing", () => {
    assert.doesNotThrow(() => computeProfileKey(null));
    assert.doesNotThrow(() => computeProfileKey(undefined));
    assert.equal(computeProfileKey(null), computeProfileKey(undefined));
    assert.equal(computeProfileKey({}), computeProfileKey(null));
  });

  test("returns a non-empty string", () => {
    const key = computeProfileKey({ description: "x" });
    assert.equal(typeof key, "string");
    assert.ok(key.length > 0);
  });
});
