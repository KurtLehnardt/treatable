import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Fails the build if shipped strings or docs make compliance, security, or validity claims.
const root = new URL("../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? (name === "__tests__" ? [] : walk(full)) : [full];
  });
}
const srcFiles = walk(join(root, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts")).map((f) => relative(root, f));
const docFiles = ["README.md", "PRIVACY.md", "src/renderer/index.html"];

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

test("source files are found", () => {
  assert.ok(srcFiles.length > 0);
});

test("no banned compliance, security, or validity claims in shipped strings and docs", () => {
  const hits: string[] = [];
  for (const file of [...srcFiles, ...docFiles]) {
    const text = read(file);
    const patterns = docFiles.includes(file) ? [...BANNED_EVERYWHERE, ...BANNED_IN_DOCS] : [...BANNED_EVERYWHERE, ...BANNED_IN_SRC];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) hits.push(`${file}: "${m[0]}"`);
    }
    for (const m of text.matchAll(/verif\w*\s+(?:a|the|your)\s+BAA/gi)) {
      const before = text.slice(Math.max(0, (m.index ?? 0) - 16), m.index).toLowerCase();
      if (!/not\W*$/.test(before)) hits.push(`${file}: "${m[0]}" without negation`);
    }
  }
  assert.deepEqual(hits, []);
});

test("required disclaimers are present", () => {
  const readme = read("README.md"), privacy = read("PRIVACY.md");
  assert.match(readme, /## Disclaimer/);
  assert.match(readme, /Research information, not medical advice/);
  assert.match(readme, /No warranty/);
  assert.match(readme, /not legal advice/i);
  assert.match(privacy, /operates no servers/);
  assert.match(privacy, /You are responsible for legal and regulatory compliance/);
  const renderer = srcFiles.filter((f) => f.startsWith("src/renderer/") || f.startsWith("src/shared/")).map(read).join("\n");
  assert.match(renderer, /Research information, not medical advice/);
});
