// Mocked: no network. Plain-JSON validation, RFC 8785 canonical ordering, cloning and freezing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, deepFreeze, isJsonObject, isJsonValue, jsonClone, jsonEqual } from '../src/json.ts';

test('isJsonValue accepts only data a JSON round trip reproduces', () => {
  for (const ok of [null, 'x', 0, -1.5, true, [], {}, { a: [1, { b: null }] }, Object.create(null) as object]) assert.equal(isJsonValue(ok), true);
  class Instance {
    a = 1;
  }
  const getter = Object.defineProperty({}, 'x', { get: () => 1, enumerable: true });
  const hidden = Object.defineProperty({}, 'x', { value: 1, enumerable: false });
  const sparse = [1, , 3];
  const extraArrayKey = Object.assign([1], { extra: true });
  const deep: unknown[] = [];
  let cursor = deep;
  for (let i = 0; i < 40; i += 1) {
    const next: unknown[] = [];
    cursor.push(next);
    cursor = next;
  }
  for (const bad of [undefined, NaN, Infinity, () => 1, Symbol('x'), 1n, new Date(), new Instance(), getter, hidden, sparse, extraArrayKey, { [Symbol('s')]: 1 }, deep, new Uint8Array(2)]) {
    assert.equal(isJsonValue(bad), false);
  }
  assert.equal(isJsonObject([]), false);
  assert.equal(isJsonObject({ a: 1 }), true);
});

test('canonicalJson sorts keys by UTF-16 code units and uses ECMAScript number formatting (RFC 8785)', () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, 'x'], c: { z: 1e21, y: 0.1 } }), '{"a":[true,null,"x"],"b":1,"c":{"y":0.1,"z":1e+21}}');
  // RFC 8785 section 3.2.3 ordering example (subset): keys compared as UTF-16 code units.
  const sorted = canonicalJson({ '€': 'Euro Sign', '\r': 'Carriage Return', 'דּ': 'Hebrew Letter Dalet With Dagesh', '1': 'One', '😀': 'Emoji: Grinning Face', '\u0080': 'Control', 'ö': 'Latin Small Letter O With Diaeresis' });
  const keys = Object.keys(JSON.parse(sorted) as object);
  assert.deepEqual(
    sorted.match(/"([^"]*)":/g)?.map(k => JSON.parse(k.slice(0, -1))),
    ['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ'],
  );
  assert.equal(keys.length, 7);
  assert.equal(canonicalJson(-0), '0');
  assert.throws(() => canonicalJson({ a: undefined }));
});

test('jsonClone shares nothing; deepFreeze freezes every level; jsonEqual ignores key order', () => {
  const original = { a: { b: [1, { c: 'x' }] } };
  const copy = jsonClone(original);
  assert.deepEqual(copy, original);
  assert.notEqual(copy.a, original.a);
  deepFreeze(copy);
  assert.ok(Object.isFrozen(copy) && Object.isFrozen(copy.a) && Object.isFrozen(copy.a.b) && Object.isFrozen(copy.a.b[1]));
  assert.throws(() => {
    (copy.a.b as unknown[]).push(2);
  });
  assert.equal(jsonEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), true);
  assert.equal(jsonEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(jsonEqual([1, 2], [2, 1]), false);
});
