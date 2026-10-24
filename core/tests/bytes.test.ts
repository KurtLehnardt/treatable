// Mocked: no network. Compares the core's neutral byte helpers with Node's WHATWG implementations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base64UrlEncode,
  constantTimeEqual,
  readBounded,
  truncateUtf8,
  utf8ByteLength,
  utf8Decode,
  utf8Encode,
} from '../src/bytes.ts';
import { CoreError } from '../src/errors.ts';
import { createCancelSource } from '../src/cancel.ts';

function seeded(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

const SAMPLES = ['', 'ascii', 'Sjögren’s syndrome', 'ألم مزمن', '😀 emoji', '\uD800 lone high', 'lone low \uDC00', '􏿿', 'é'.repeat(100)];

test('utf8Encode and utf8ByteLength match TextEncoder, including lone surrogates', () => {
  const encoder = new TextEncoder();
  const random = seeded(7);
  const samples = [...SAMPLES];
  for (let n = 0; n < 500; n += 1) {
    let s = '';
    const len = Math.floor(random() * 12);
    for (let i = 0; i < len; i += 1) s += String.fromCharCode(Math.floor(random() * 0x10000));
    samples.push(s);
  }
  for (const s of samples) {
    const expected = encoder.encode(s);
    assert.deepEqual(utf8Encode(s), expected);
    assert.equal(utf8ByteLength(s), expected.length);
  }
});

test('utf8Decode matches fatal TextDecoder on valid, invalid, overlong, surrogate and truncated input', () => {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const random = seeded(11);
  const cases: Uint8Array[] = [
    new Uint8Array([0xef, 0xbb, 0xbf, 0x41]),
    new Uint8Array([0xc0, 0x80]),
    new Uint8Array([0xe0, 0x80, 0x80]),
    new Uint8Array([0xed, 0xa0, 0x80]),
    new Uint8Array([0xf4, 0x90, 0x80, 0x80]),
    new Uint8Array([0xf0, 0x9f, 0x98]),
    new Uint8Array([0xff]),
    new Uint8Array([2, 0, 0, 0, 0xff, 0xff]),
    new TextEncoder().encode(SAMPLES.join('|')),
  ];
  const biased = [0x00, 0x41, 0x7f, 0x80, 0xbf, 0xc2, 0xdf, 0xe0, 0xed, 0xef, 0xf0, 0xf4, 0xf5, 0xff, 0xa0, 0x9f, 0x90, 0x8f];
  for (let n = 0; n < 3000; n += 1) {
    const len = Math.floor(random() * 10);
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) bytes[i] = random() < 0.6 ? biased[Math.floor(random() * biased.length)]! : Math.floor(random() * 256);
    cases.push(bytes);
  }
  for (const bytes of cases) {
    let expected: string | undefined;
    try {
      expected = decoder.decode(bytes);
    } catch {
      expected = undefined;
    }
    if (expected === undefined) assert.throws(() => utf8Decode(bytes));
    else assert.equal(utf8Decode(bytes), expected);
  }
});

test('truncateUtf8 cuts by bytes at code point boundaries, never by characters', () => {
  assert.deepEqual(truncateUtf8('abc', 10), { text: 'abc', truncated: false });
  assert.deepEqual(truncateUtf8('ééé', 5), { text: 'éé', truncated: true });
  assert.deepEqual(truncateUtf8('a😀b', 4), { text: 'a', truncated: true });
  assert.deepEqual(truncateUtf8('a😀b', 5), { text: 'a😀', truncated: true });
  for (const s of SAMPLES) for (let max = 0; max < 30; max += 1) assert.ok(utf8ByteLength(truncateUtf8(s, max).text) <= max);
});

test('base64UrlEncode matches Node base64url; 32 bytes give a 43-character token', () => {
  const random = seeded(3);
  for (let len = 0; len < 70; len += 1) {
    const bytes = new Uint8Array(len).map(() => Math.floor(random() * 256));
    assert.equal(base64UrlEncode(bytes), Buffer.from(bytes).toString('base64url'));
  }
  assert.match(base64UrlEncode(new Uint8Array(32).fill(250)), /^[A-Za-z0-9_-]{43}$/);
});

test('constantTimeEqual compares exactly', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('abc', 'abcd'), false);
  assert.equal(constantTimeEqual('', ''), true);
});

test('readBounded enforces the byte cap, cancellation, and byte-only chunks', async () => {
  assert.deepEqual(await readBounded(new Uint8Array([1, 2]), 2), new Uint8Array([1, 2]));
  await assert.rejects(readBounded(new Uint8Array(3), 2), (e: unknown) => e instanceof CoreError && e.code === 'OUTPUT_TOO_LARGE');
  let pulled = 0;
  async function* stream(): AsyncIterable<Uint8Array> {
    for (let i = 0; i < 100; i += 1) {
      pulled += 1;
      yield new Uint8Array(10);
    }
  }
  await assert.rejects(readBounded(stream(), 25), (e: unknown) => e instanceof CoreError && e.code === 'OUTPUT_TOO_LARGE');
  assert.equal(pulled, 3, 'stops reading once the cap is exceeded');
  async function* strings(): AsyncIterable<Uint8Array> {
    yield 'not bytes' as unknown as Uint8Array;
  }
  await assert.rejects(readBounded(strings(), 100), (e: unknown) => e instanceof CoreError && e.code === 'INVALID_API_RESPONSE');
  await assert.rejects(readBounded('text' as unknown as Uint8Array, 100), (e: unknown) => e instanceof CoreError && e.code === 'INVALID_API_RESPONSE');
  const cancel = createCancelSource();
  async function* slow(): AsyncIterable<Uint8Array> {
    yield new Uint8Array(1);
    cancel.cancel();
    yield new Uint8Array(1);
  }
  await assert.rejects(readBounded(slow(), 100, cancel.signal), (e: unknown) => e instanceof CoreError && e.code === 'CANCELLED');
  async function* two(): AsyncIterable<Uint8Array> {
    yield new Uint8Array([1]);
    yield new Uint8Array([2, 3]);
  }
  assert.deepEqual(await readBounded(two(), 3), new Uint8Array([1, 2, 3]));
});

test('cancel sources notify listeners once, including late listeners', () => {
  const source = createCancelSource();
  let calls = 0;
  const listener = () => {
    calls += 1;
  };
  source.signal.addEventListener('abort', listener);
  source.signal.addEventListener('abort', () => {
    throw new Error('ignored');
  });
  source.cancel();
  source.cancel();
  assert.equal(source.signal.aborted, true);
  assert.equal(calls, 1);
  source.signal.addEventListener('abort', listener);
  assert.equal(calls, 2);
});
