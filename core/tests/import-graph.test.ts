// Mocked: no network. Keeps core/src runtime-neutral: no Node or browser host APIs, no Chrome
// extension identity, no imports outside core/src except zod. Never weaken these rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lex, scanSource, scanTree, type RuleId } from './support/import-scan.ts';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('core/src imports nothing outside core/src except zod and uses no host APIs', () => {
  const { files, violations } = scanTree(SRC);
  const relative = files.map(f => path.relative(SRC, f).split(path.sep).join('/'));
  for (const expected of ['dispatcher.ts', 'protocol.ts', 'ports.ts', 'session.ts', 'consent/store.ts', 'consent/policy.ts', 'bytes.ts']) {
    assert.ok(relative.includes(expected), `scan covers ${expected}`);
  }
  assert.ok(files.length >= 12, `scanned ${files.length} files`);
  assert.deepEqual(violations, []);
});

// Each planted file contains exactly one kind of violation. The self-test proves the scan catches it.
const PLANTED: [file: string, source: string, rule: RuleId][] = [
  ['node-prefix.ts', "import { readFile } from 'node:fs/promises';\nexport const r = readFile;\n", 'node-builtin'],
  ['node-escaped.ts', "import fs from 'node\\u003afs';\nexport const f = fs;\n", 'node-builtin'],
  ['node-type-only.ts', "import type { Readable } from 'node:stream';\nexport type R = Readable;\n", 'node-builtin'],
  ['node-reexport.ts', "export * from 'node:crypto';\n", 'node-builtin'],
  ['bare-builtin.ts', "import path from 'path';\nexport const p = path;\n", 'bare-builtin'],
  ['bare-builtin-sub.ts', "import { readFile } from 'fs/promises';\nexport const r = readFile;\n", 'bare-builtin'],
  ['side-effect.ts', "import 'child_process';\n", 'bare-builtin'],
  ['require-call.ts', "const z = require('zod');\nexport { z };\n", 'require'],
  ['ts-require.ts', "import zod = require('zod');\nexport const z = zod;\n", 'require'],
  ['dynamic.ts', "export const load = () => import('./ok.ts');\n", 'dynamic-import'],
  ['import-meta.ts', 'export const here = import.meta.url;\n', 'import-meta'],
  ['process.ts', 'export const env = process.env;\n', 'host-global'],
  ['buffer.ts', "export const b = Buffer.from('x');\n", 'host-global'],
  ['fetch.ts', "export const get = () => fetch('https://example.invalid');\n", 'host-global'],
  ['global-this.ts', "export const p = globalThis['process'];\n", 'host-global'],
  ['timer.ts', 'setTimeout(() => {}, 1);\n', 'host-global'],
  ['text-encoder.ts', 'export const e = new TextEncoder();\n', 'host-global'],
  ['web-crypto.ts', 'export const c = crypto.getRandomValues(new Uint8Array(4));\n', 'host-global'],
  ['math-random.ts', 'export const r = Math.random();\n', 'host-global'],
  ['date-now.ts', 'export const t = Date.now();\n', 'host-global'],
  ['new-date.ts', 'export const t = new Date();\n', 'host-global'],
  ['chrome.ts', 'chrome.runtime.sendMessage({});\n', 'chrome'],
  ['extension-id.ts', 'export const id = EXTENSION_ID;\n', 'extension-identity'],
  ['host-name.ts', "export const name = 'HOST_NAME';\n", 'extension-identity'],
  ['validate-origin.ts', 'export function check(o: string) { return validateOrigin(o); }\n', 'extension-identity'],
  ['origin-string.ts', 'export const o = `chrome-extension://${"x"}/`;\n', 'extension-identity'],
  ['outside.ts', "import { parseRealPacket } from '../../extension/shared/real-contract.mjs';\nexport const p = parseRealPacket;\n", 'outside-src'],
  ['absolute.ts', "import x from '/etc/x.ts';\nexport const y = x;\n", 'outside-src'],
  ['file-url.ts', "import x from 'file:///etc/x.ts';\nexport const y = x;\n", 'outside-src'],
  ['package.ts', "import _ from 'lodash';\nexport const l = _;\n", 'unlisted-package'],
  ['zod-subpath.ts', "import { z } from 'zod/v4';\nexport const s = z;\n", 'unlisted-package'],
  ['extensionless.ts', "import { ok } from './ok';\nexport const o = ok;\n", 'extensionless-import'],
  ['missing.ts', "import { gone } from './gone.ts';\nexport const g = gone;\n", 'unresolved-import'],
  ['eval.ts', "export const v = eval('1');\n", 'eval'],
  ['function-ctor.ts', "export const f = new Function('return 1');\n", 'eval'],
  ['triple-slash.ts', '/// <reference types="node" />\nexport const x = 1;\n', 'triple-slash'],
  ['nocheck.ts', '// @ts-nocheck\nexport const x = 1;\n', 'ts-directive'],
  ['declare.ts', 'declare const process: { env: Record<string, string> };\nexport {};\n', 'declare-global'],
  ['indirect-eval.ts', "export const v = (0, eval)('1');\n", 'eval'],
  ['function-alias.ts', 'const F = Function;\nexport const f = F;\n', 'eval'],
  ['constructor-call.ts', "export const f = (async () => undefined).constructor('return 1');\n", 'eval'],
  ['constructor-key.ts', "const g = () => undefined;\nexport const f = (g as unknown as Record<string, (s: string) => unknown>)['constructor']!('return 1');\n", 'eval'],
  ['self.ts', 'export const s = self;\n', 'host-global'],
  ['url.ts', "export const u = new URL('https://example.invalid');\n", 'host-global'],
  ['url-search.ts', "export const q = new URLSearchParams('a=1');\n", 'host-global'],
  ['microtask.ts', 'queueMicrotask(() => undefined);\n', 'host-global'],
  ['weak-ref.ts', 'export const w = new WeakRef({});\n', 'host-global'],
  ['intl.ts', "export const n = new Intl.NumberFormat('en-US');\n", 'host-global'],
  ['atob.ts', "export const t = atob('eA==');\n", 'host-global'],
];

const CLEAN = `import { z } from 'zod';
import { ok } from './ok.ts';
import type { Thing } from './nested/thing.ts';
// Comments may mention process.env, Buffer, fetch(), require('fs'), chrome.runtime and node:fs freely.
/* import fs from 'node:fs'; setTimeout(() => {}, 1); */
export const question = 'Who should my clinician contact for the current screening process?';
export const note = "Buffer and fetch and setTimeout are words inside a string.";
export const pattern = /['"]node:fs['"]|process\\.env/;
export const ratio = (a: number, b: number) => a / b / 2;
export const view = new Uint8Array(new ArrayBuffer(4));
export const template = \`value \${ok} and \${\`nested \${'node:fs'}\`}\`;
const holder: Record<string, number> = {};
export const member = holder.process ?? ok.length;
export type T = Thing;
export const schema = z.string();
`;

test('self-test: the scan catches every planted violation and passes a clean file with tricky text', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'treatable-import-scan-'));
  const src = path.join(root, 'src');
  try {
    await mkdir(path.join(src, 'nested'), { recursive: true });
    await writeFile(path.join(src, 'ok.ts'), "export const ok = 'ok';\n");
    await writeFile(path.join(src, 'nested', 'thing.ts'), 'export type Thing = string;\n');
    await writeFile(path.join(src, 'clean.ts'), CLEAN);
    const clean = scanTree(src);
    assert.deepEqual(clean.violations, [], JSON.stringify(clean.violations));

    for (const [file, source] of PLANTED) await writeFile(path.join(src, file), source);
    await writeFile(path.join(src, 'helper.js'), 'module.exports = {};\n');
    await writeFile(path.join(src, 'ambient.d.ts'), 'declare const x: number;\n');
    await symlink(path.join(src, 'ok.ts'), path.join(src, 'link.ts'));
    const { violations } = scanTree(src);
    for (const [file, , rule] of PLANTED) {
      const hits = violations.filter(v => path.basename(v.file) === file);
      assert.ok(hits.some(v => v.rule === rule), `${file} should be flagged as ${rule}; got ${JSON.stringify(hits)}`);
    }
    assert.ok(violations.some(v => path.basename(v.file) === 'helper.js' && v.rule === 'non-ts-file'));
    assert.ok(violations.some(v => path.basename(v.file) === 'ambient.d.ts' && v.rule === 'non-ts-file'));
    assert.ok(violations.some(v => path.basename(v.file) === 'link.ts' && v.rule === 'symlink'));
    assert.ok(!violations.some(v => ['clean.ts', 'ok.ts', 'thing.ts'].includes(path.basename(v.file))));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lexer separates code from strings, templates, regular expressions, and comments', () => {
  const { code, literals, comments } = lex("const a = 'x/y'; // c\nconst r = /\\//g; const t = `a${b}c`; /* d */ const q = a / 2;");
  assert.deepEqual(literals.map(l => l.value), ['x/y', 'a', 'c']);
  assert.deepEqual(comments.map(c => c.text.trim()), ['c', 'd']);
  assert.ok(code.includes('const q = a / 2'));
  assert.ok(!code.includes('x/y'));
  assert.equal(scanSource('/virtual/src/a.ts', "const s = 'node:fs';\n", '/virtual/src').length, 0, 'a string that is not a specifier is not an import');
});
