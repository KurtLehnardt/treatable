import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

// Fails the build if shipped strings or docs make compliance, security, or validity claims.
const root = new URL('../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8');
const srcFiles = readdirSync(new URL('src/', root)).filter(f => /\.(ts|tsx)$/.test(f)).map(f => `src/${f}`);
const docFiles = ['README.md', 'PRIVACY.md', 'NATIVE_SETUP.md', 'manifest.json', 'managed_schema.json', 'public/panel.html'];

const BANNED_EVERYWHERE: RegExp[] = [
  /\bHIPAA[- ]compliant\b/i,
  /\bHIPAA[- ](?:ready|eligible) (?:extension|app|tool)\b/i,
  /(?<!not )\bPHI[- ]ready\b/i,
  /\bBAA[- ]verified\b/i,
  /\bverified (?:your |the )?BAA\b/i,
  /\bsecure\b/i,
  /\bguarantee(?:d|s)?\b/i,
  /(?<!not )\bclinically validated\b/i,
  /\bcertified\b/i,
  /\banonymous\b/i,
  /\bnothing leaves\b/i,
  /\bno data leaves\b/i,
  /(?<!promise of )\bencrypted\b/i,
];
// In TypeScript source the `private` modifier is legal, so only prose uses are banned there.
const BANNED_IN_DOCS: RegExp[] = [/\bprivate\b(?! retention| link)/i];
const BANNED_IN_SRC: RegExp[] = [/\bprivate\b(?! retention| link)(?!\s+(?:readonly|async|static|[A-Za-z_]\w*\s*[:(=?!<;,)]))/i];

test('no banned compliance, security, or validity claims in shipped strings and docs', () => {
  const hits: string[] = [];
  for (const file of [...srcFiles, ...docFiles]) {
    const text = read(file);
    const patterns = docFiles.includes(file) ? [...BANNED_EVERYWHERE, ...BANNED_IN_DOCS] : [...BANNED_EVERYWHERE, ...BANNED_IN_SRC];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) hits.push(`${file}: "${m[0]}"`);
    }
    // "verify a BAA" may appear only in a negated statement.
    for (const m of text.matchAll(/verif\w*\s+(?:a|the|your)\s+BAA/gi)) {
      const before = text.slice(Math.max(0, (m.index ?? 0) - 16), m.index).toLowerCase();
      if (!/not\W*$/.test(before)) hits.push(`${file}: "${m[0]}" without negation`);
    }
  }
  assert.deepEqual(hits, []);
});

test('required disclaimers are present', () => {
  const readme = read('README.md'), privacy = read('PRIVACY.md'), panel = read('src/panel.tsx');
  assert.match(readme, /## Disclaimer/);
  assert.match(readme, /Research information, not medical advice/);
  assert.match(readme, /No warranty/);
  assert.match(readme, /not legal advice/i);
  assert.match(privacy, /operates no servers/);
  assert.match(privacy, /You are responsible for legal and regulatory compliance/);
  assert.match(panel, /Research information, not medical advice/);
  assert.match(panel, /You are responsible for confirming your own BAA and endpoint coverage/);
  assert.match(read('manifest.json'), /local-first study finder/i);
});
