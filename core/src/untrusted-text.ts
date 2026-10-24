/**
 * Sanitizer for untrusted public record text (orchestrator decision D2).
 *
 * Text from ClinicalTrials.gov records reaches the user and, for the allowlisted public fields, the
 * model. Invisible and format characters can hide or reorder text there, so at ingestion the core
 * removes every code point in INVISIBLE_OR_FORMAT and then normalizes to NFC (never NFKC, which
 * rewrites clinical strings such as superscripts in "10⁹/L" or "m²"). The set is the union of:
 *   - General_Category Cf (format characters, which include bidirectional controls, the zero-width
 *     characters, the Arabic letter mark, the Mongolian vowel separator, the interlinear annotation
 *     characters, the byte-order mark, and the tag characters);
 *   - Default_Ignorable_Code_Point (which adds the soft hyphen, the combining grapheme joiner, the
 *     Hangul fillers, the variation selectors, the Khmer inherent vowels, and reserved ranges);
 * taken from the Unicode 16.0 character database. The ranges are written out explicitly instead of
 * as Unicode property escapes, so the pattern does not depend on the regular-expression engine's
 * Unicode tables (Hermes, JavaScriptCore, V8).
 *
 * isCleanUntrustedText is the matching check for model-bound and record schemas: a string passes
 * only if sanitizing would not change it.
 */

const INVISIBLE_OR_FORMAT_RANGES =
  '\\u00AD\\u034F\\u061C\\u0600-\\u0605\\u06DD\\u070F\\u0890\\u0891\\u08E2\\u115F\\u1160\\u17B4\\u17B5' +
  '\\u180B-\\u180F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\u3164\\uFE00-\\uFE0F\\uFEFF\\uFFA0\\uFFF0-\\uFFFB' +
  '\\u{110BD}\\u{110CD}\\u{13430}-\\u{1343F}\\u{1BCA0}-\\u{1BCA3}\\u{1D173}-\\u{1D17A}\\u{E0000}-\\u{E0FFF}';

/** Every invisible or format code point removed at ingestion (global, Unicode mode). */
export const INVISIBLE_OR_FORMAT = new RegExp(`[${INVISIBLE_OR_FORMAT_RANGES}]`, 'gu');
const HAS_INVISIBLE_OR_FORMAT = new RegExp(`[${INVISIBLE_OR_FORMAT_RANGES}]`, 'u');

/** Replaces lone surrogates with U+FFFD, so the text is well-formed before NFC. */
export function replaceLoneSurrogates(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i]! + text[i + 1]!;
        i += 1;
      } else out += '�';
    } else if (unit >= 0xdc00 && unit <= 0xdfff) out += '�';
    else out += text[i]!;
  }
  return out;
}

/** Lone surrogates replaced, invisible and format characters removed, then NFC. */
export function sanitizeUntrustedText(text: string): string {
  return replaceLoneSurrogates(text).replace(INVISIBLE_OR_FORMAT, '').normalize('NFC');
}

/** True when `text` holds no invisible or format character and is already in NFC. */
export function isCleanUntrustedText(text: string): boolean {
  return typeof text === 'string' && !HAS_INVISIBLE_OR_FORMAT.test(text) && text === text.normalize('NFC');
}
