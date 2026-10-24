/**
 * Byte and text helpers built only from ECMAScript built-ins.
 *
 * The core cannot rely on TextEncoder, TextDecoder, or Buffer because not every target runtime
 * provides all of them. These functions match the WHATWG UTF-8 encoder and the fatal UTF-8 decoder
 * (tests compare them byte for byte with Node's implementations).
 */
import { CoreError } from './errors.ts';
import type { CancelSignal } from './ports.ts';

const REPLACEMENT_BYTES = 3; // U+FFFD encodes as EF BF BD.

function isHigh(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLow(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** Number of bytes the WHATWG UTF-8 encoder produces for `text` (lone surrogates count as U+FFFD). */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (isHigh(unit) && i + 1 < text.length && isLow(text.charCodeAt(i + 1))) {
      bytes += 4;
      i += 1;
    } else if (isHigh(unit) || isLow(unit)) bytes += REPLACEMENT_BYTES;
    else bytes += 3;
  }
  return bytes;
}

/** UTF-8 bytes of the JSON serialization of `value`. Throws INVALID_REQUEST when it cannot be serialized. */
export function jsonByteLength(value: unknown): number {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new CoreError('INVALID_REQUEST');
  }
  if (typeof text !== 'string') throw new CoreError('INVALID_REQUEST');
  return utf8ByteLength(text);
}

/** WHATWG UTF-8 encoding. Lone surrogates become U+FFFD, exactly like TextEncoder. */
export function utf8Encode(text: string): Uint8Array {
  const out = new Uint8Array(utf8ByteLength(text));
  let at = 0;
  for (let i = 0; i < text.length; i += 1) {
    let cp = text.charCodeAt(i);
    if (isHigh(cp) && i + 1 < text.length && isLow(text.charCodeAt(i + 1))) {
      cp = 0x10000 + ((cp - 0xd800) << 10) + (text.charCodeAt(i + 1) - 0xdc00);
      i += 1;
    } else if (isHigh(cp) || isLow(cp)) {
      cp = 0xfffd;
    }
    if (cp < 0x80) {
      out[at++] = cp;
    } else if (cp < 0x800) {
      out[at++] = 0xc0 | (cp >> 6);
      out[at++] = 0x80 | (cp & 0x3f);
    } else if (cp < 0x10000) {
      out[at++] = 0xe0 | (cp >> 12);
      out[at++] = 0x80 | ((cp >> 6) & 0x3f);
      out[at++] = 0x80 | (cp & 0x3f);
    } else {
      out[at++] = 0xf0 | (cp >> 18);
      out[at++] = 0x80 | ((cp >> 12) & 0x3f);
      out[at++] = 0x80 | ((cp >> 6) & 0x3f);
      out[at++] = 0x80 | (cp & 0x3f);
    }
  }
  return out;
}

export class Utf8Error extends Error {
  constructor() {
    super('Invalid UTF-8');
    this.name = 'Utf8Error';
  }
}

/**
 * Strict UTF-8 decoding with the semantics of `new TextDecoder('utf-8', { fatal: true })`:
 * a leading byte order mark is removed, and any malformed, overlong, surrogate, out-of-range, or
 * truncated sequence throws Utf8Error.
 */
export function utf8Decode(bytes: Uint8Array): string {
  const n = bytes.length;
  let i = n >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const parts: string[] = [];
  let units: number[] = [];
  const flush = (): void => {
    if (units.length) {
      parts.push(String.fromCharCode.apply(null, units));
      units = [];
    }
  };
  const cont = (index: number, low = 0x80, high = 0xbf): number => {
    if (index >= n) throw new Utf8Error();
    const b = bytes[index] as number;
    if (b < low || b > high) throw new Utf8Error();
    return b & 0x3f;
  };
  while (i < n) {
    const b0 = bytes[i] as number;
    let cp: number;
    if (b0 < 0x80) {
      cp = b0;
      i += 1;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      cp = ((b0 & 0x1f) << 6) | cont(i + 1);
      i += 2;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      const low = b0 === 0xe0 ? 0xa0 : 0x80;
      const high = b0 === 0xed ? 0x9f : 0xbf;
      cp = ((b0 & 0x0f) << 12) | (cont(i + 1, low, high) << 6) | cont(i + 2);
      i += 3;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      const low = b0 === 0xf0 ? 0x90 : 0x80;
      const high = b0 === 0xf4 ? 0x8f : 0xbf;
      cp = ((b0 & 0x07) << 18) | (cont(i + 1, low, high) << 12) | (cont(i + 2) << 6) | cont(i + 3);
      i += 4;
    } else {
      throw new Utf8Error();
    }
    if (cp >= 0x10000) {
      const v = cp - 0x10000;
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else {
      units.push(cp);
    }
    if (units.length >= 4096) flush();
  }
  flush();
  return parts.join('');
}

/**
 * Cuts `text` to at most `maxBytes` UTF-8 bytes without splitting a code point.
 * Size bounds in the core are byte caps, never character slices.
 */
export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new CoreError('INTERNAL_ERROR');
  if (utf8ByteLength(text) <= maxBytes) return { text, truncated: false };
  let bytes = 0;
  let end = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    let size: number;
    let width = 1;
    if (unit < 0x80) size = 1;
    else if (unit < 0x800) size = 2;
    else if (isHigh(unit) && i + 1 < text.length && isLow(text.charCodeAt(i + 1))) {
      size = 4;
      width = 2;
    } else size = 3;
    if (bytes + size > maxBytes) break;
    bytes += size;
    i += width - 1;
    end = i + 1;
  }
  return { text: text.slice(0, end), truncated: true };
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Unpadded base64url (RFC 4648 section 5). 32 bytes become 43 characters. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const v = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += BASE64URL[(v >> 18) & 63]! + BASE64URL[(v >> 12) & 63]! + BASE64URL[(v >> 6) & 63]! + BASE64URL[v & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const v = (bytes[i] as number) << 16;
    out += BASE64URL[(v >> 18) & 63]! + BASE64URL[(v >> 12) & 63]!;
  } else if (rest === 2) {
    const v = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += BASE64URL[(v >> 18) & 63]! + BASE64URL[(v >> 12) & 63]! + BASE64URL[(v >> 6) & 63]!;
  }
  return out;
}

const HEX64 = /^[a-f0-9]{64}$/;

export function isHex64(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value);
}

/** Compares two strings in time that depends only on their lengths. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * Reads a transport or loader body with a hard byte cap. Throws OUTPUT_TOO_LARGE once the cap is
 * exceeded (without reading further), CANCELLED when the signal fires, and INVALID_API_RESPONSE when
 * the body is not bytes.
 */
export async function readBounded(
  body: Uint8Array | AsyncIterable<Uint8Array>,
  maxBytes: number,
  signal?: CancelSignal,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new CoreError('INTERNAL_ERROR');
  if (signal?.aborted) throw new CoreError('CANCELLED');
  if (body instanceof Uint8Array) {
    if (body.length > maxBytes) throw new CoreError('OUTPUT_TOO_LARGE');
    return body;
  }
  if (typeof body !== 'object' || body === null || typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== 'function') {
    throw new CoreError('INVALID_API_RESPONSE');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    if (signal?.aborted) throw new CoreError('CANCELLED');
    if (!(chunk instanceof Uint8Array)) throw new CoreError('INVALID_API_RESPONSE');
    total += chunk.length;
    if (total > maxBytes) throw new CoreError('OUTPUT_TOO_LARGE');
    chunks.push(chunk);
  }
  if (signal?.aborted) throw new CoreError('CANCELLED');
  return concat(chunks, total);
}
