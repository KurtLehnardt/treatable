/**
 * Plain-JSON helpers: validation, canonical serialization, cloning, and deep freezing.
 *
 * Consent digests are computed over the canonical form, so any party that holds the exact preview
 * (for example a desktop UI after a stdio round trip that does not keep key order) can recompute the
 * digest independently. The canonical form follows RFC 8785 (JSON Canonicalization Scheme) for the
 * values the core produces: object keys sorted by UTF-16 code units, ECMAScript number and string
 * serialization, no insignificant whitespace.
 */
import { CoreError } from './errors.ts';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const MAX_JSON_DEPTH = 32;

function isPlainObjectPrototype(proto: unknown): boolean {
  return proto === Object.prototype || proto === null;
}

/**
 * True only for data a JSON round trip reproduces exactly: plain objects (no accessors, symbols, or
 * custom prototypes), dense arrays, strings, finite numbers, booleans, and null, nested at most
 * `maxDepth` levels.
 */
export function isJsonValue(value: unknown, maxDepth: number = MAX_JSON_DEPTH): value is JsonValue {
  return check(value, maxDepth);
}

function check(value: unknown, depth: number): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      break;
    default:
      return false;
  }
  if (depth <= 0) return false;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    if (Object.keys(value).length !== value.length) return false;
    for (let i = 0; i < value.length; i += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) return false;
      if (!check(value[i], depth - 1)) return false;
    }
    return Object.getOwnPropertySymbols(value).length === 0;
  }
  if (!isPlainObjectPrototype(Object.getPrototypeOf(value))) return false;
  if (Object.getOwnPropertySymbols(value).length) return false;
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return false;
    if (!check(descriptor.value, depth - 1)) return false;
  }
  return true;
}

export function isJsonObject(value: unknown, maxDepth: number = MAX_JSON_DEPTH): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && isJsonValue(value, maxDepth);
}

/** Canonical JSON text (RFC 8785 ordering). Throws INTERNAL_ERROR for non-JSON input. */
export function canonicalJson(value: unknown): string {
  if (!isJsonValue(value)) throw new CoreError('INTERNAL_ERROR');
  return serialize(value);
}

function serialize(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${serialize(value[key] as JsonValue)}`).join(',')}}`;
}

/** Deep copy through JSON text, so the copy shares nothing with the original. */
export function jsonClone<T extends JsonValue>(value: T): T {
  if (!isJsonValue(value)) throw new CoreError('INTERNAL_ERROR');
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Freezes every object and array reachable from `value` and returns it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Structural equality for JSON values (key order does not matter). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (!isJsonValue(a) || !isJsonValue(b)) return false;
  return serialize(a) === serialize(b);
}
