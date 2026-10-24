import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { drainNdjson } from "../ndjson";

/**
 * R5-deep — the streaming client's line buffering. The route emits one
 * `JSON.stringify(event) + "\n"` per line, but network chunks split lines
 * arbitrarily. drainNdjson must parse only COMPLETE lines and carry the partial
 * remainder forward, dropping nothing at a chunk boundary.
 */
describe("drainNdjson — complete lines out, partial remainder carried", () => {
  test("parses whole lines and returns no remainder when the buffer ends on a newline", () => {
    const { objects, rest } = drainNdjson('{"type":"stage","pct":8}\n{"type":"stage","pct":30}\n');
    assert.equal(rest, "");
    assert.deepEqual(objects, [
      { type: "stage", pct: 8 },
      { type: "stage", pct: 30 },
    ]);
  });

  test("holds a partial trailing line as remainder (no half-parsed event)", () => {
    const { objects, rest } = drainNdjson('{"type":"stage","pct":8}\n{"type":"evi');
    assert.deepEqual(objects, [{ type: "stage", pct: 8 }]);
    assert.equal(rest, '{"type":"evi');
  });

  test("an event split across two chunks parses once the second arrives", () => {
    const first = drainNdjson('{"type":"result","ok":tr');
    assert.deepEqual(first.objects, []);
    assert.equal(first.rest, '{"type":"result","ok":tr');
    // next chunk completes the line
    const second = drainNdjson(first.rest + 'ue}\n');
    assert.deepEqual(second.objects, [{ type: "result", ok: true }]);
    assert.equal(second.rest, "");
  });

  test("blank lines are skipped; multiple complete lines in one chunk all parse", () => {
    const { objects, rest } = drainNdjson('\n{"a":1}\n\n{"b":2}\n');
    assert.deepEqual(objects, [{ a: 1 }, { b: 2 }]);
    assert.equal(rest, "");
  });
});
