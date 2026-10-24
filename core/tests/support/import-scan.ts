/**
 * Static scan that keeps core/src runtime-neutral.
 *
 * A small JavaScript/TypeScript lexer separates code, string literals, template text, regular
 * expression literals, and comments, so that words inside strings or comments (for example
 * "screening process") are not mistaken for code, while every import specifier, global reference,
 * and directive is still seen. Strings are unescaped before checks, so escapes cannot hide a
 * specifier such as node:fs. This scanner backs tests/import-graph.test.ts; it is test tooling and
 * never ships.
 */
import { builtinModules } from 'node:module';
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export type RuleId =
  | 'node-builtin'
  | 'bare-builtin'
  | 'outside-src'
  | 'unlisted-package'
  | 'unresolved-import'
  | 'extensionless-import'
  | 'require'
  | 'dynamic-import'
  | 'import-meta'
  | 'host-global'
  | 'chrome'
  | 'extension-identity'
  | 'eval'
  | 'triple-slash'
  | 'ts-directive'
  | 'declare-global'
  | 'non-ts-file'
  | 'symlink';

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly rule: RuleId;
  readonly detail: string;
}

interface Literal {
  readonly value: string;
  readonly start: number;
  readonly kind: 'string' | 'template';
}

interface Comment {
  readonly text: string;
  readonly start: number;
}

export interface Lexed {
  /** Source with comments and literal contents replaced by spaces; positions and newlines kept. */
  readonly code: string;
  readonly literals: Literal[];
  readonly comments: Comment[];
}

const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

function unescape(raw: string): string {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[0-7]{1,3}|\r\n|[\s\S])/g, (_m, esc: string) => {
    if (esc.startsWith('u{')) return String.fromCodePoint(parseInt(esc.slice(2, -1), 16));
    if (esc[0] === 'u' && esc.length === 5) return String.fromCharCode(parseInt(esc.slice(1), 16));
    if (esc[0] === 'x' && esc.length === 3) return String.fromCharCode(parseInt(esc.slice(1), 16));
    if (/^[0-7]+$/.test(esc)) return String.fromCharCode(parseInt(esc, 8));
    const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '\n': '', '\r\n': '' };
    return simple[esc] ?? esc;
  });
}

export function lex(source: string): Lexed {
  const out = source.split('');
  const literals: Literal[] = [];
  const comments: Comment[] = [];
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  const braceStack: number[] = []; // brace depth at which each open template substitution started
  let depth = 0;
  let i = 0;
  const n = source.length;

  const lastSignificant = (): string => {
    let k = i - 1;
    while (k >= 0 && /\s/.test(out[k] as string)) k -= 1;
    return k >= 0 ? (out[k] as string) : '';
  };

  const readTemplate = (): void => {
    // At a backtick or at the closing brace of a substitution; i points at the opening character.
    let start = i + 1;
    i += 1;
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        literals.push({ value: unescape(source.slice(start, i)), start, kind: 'template' });
        blank(start, i);
        i += 1;
        return;
      }
      if (c === '$' && source[i + 1] === '{') {
        literals.push({ value: unescape(source.slice(start, i)), start, kind: 'template' });
        blank(start, i);
        braceStack.push(depth);
        depth += 1;
        i += 2;
        return;
      }
      i += 1;
    }
    literals.push({ value: source.slice(start), start, kind: 'template' });
    blank(start, n);
    start = n;
  };

  while (i < n) {
    const c = source[i] as string;
    const d = source[i + 1];
    if (c === '/' && d === '/') {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      comments.push({ text: source.slice(i + 2, stop), start: i });
      blank(i, stop);
      i = stop;
    } else if (c === '/' && d === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      comments.push({ text: source.slice(i + 2, end < 0 ? n : end), start: i });
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      const start = i + 1;
      i += 1;
      while (i < n && source[i] !== c && source[i] !== '\n') i += source[i] === '\\' ? 2 : 1;
      literals.push({ value: unescape(source.slice(start, i)), start, kind: 'string' });
      blank(start, i);
      i += 1;
    } else if (c === '`') {
      readTemplate();
    } else if (c === '{') {
      depth += 1;
      i += 1;
    } else if (c === '}') {
      depth -= 1;
      if (braceStack.length && braceStack[braceStack.length - 1] === depth) {
        braceStack.pop();
        readTemplate();
      } else {
        i += 1;
      }
    } else if (c === '/') {
      const prev = lastSignificant();
      const before = source.slice(Math.max(0, i - 12), i).trimEnd();
      if (prev === '' || REGEX_PRECEDERS.has(prev) || REGEX_KEYWORDS.test(before)) {
        const start = i + 1;
        i += 1;
        let inClass = false;
        while (i < n && source[i] !== '\n') {
          const r = source[i];
          if (r === '\\') {
            i += 2;
            continue;
          }
          if (r === '[') inClass = true;
          else if (r === ']') inClass = false;
          else if (r === '/' && !inClass) break;
          i += 1;
        }
        blank(start, i);
        i += 1;
      } else {
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  return { code: out.join(''), literals, comments };
}

const BUILTINS = new Set(builtinModules.flatMap(name => [name, name.replace(/^node:/, '')]));
const ALLOWED_PACKAGES = new Set(['zod']);

const HOST_GLOBALS = [
  'process', 'Buffer', 'fetch', 'globalThis', 'global', 'window', 'document', 'navigator', 'XMLHttpRequest', 'WebSocket',
  'EventSource', 'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate',
  'performance', 'crypto', 'TextEncoder', 'TextDecoder', 'structuredClone', 'AbortController', 'AbortSignal',
  'localStorage', 'sessionStorage', 'indexedDB', '__dirname', '__filename', 'module', 'exports', 'Deno', 'Bun',
  // Not available, or not complete, on every target runtime (Hermes in particular): web platform
  // objects, scheduling and memory APIs, internationalization, and engine or React Native globals.
  'self', 'URL', 'URLSearchParams', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'atob', 'btoa',
  'queueMicrotask', 'requestAnimationFrame', 'requestIdleCallback', 'WebAssembly', 'Worker', 'WeakRef',
  'FinalizationRegistry', 'SharedArrayBuffer', 'Atomics', 'Intl', 'HermesInternal', 'nativeModuleProxy',
];
const HOST_GLOBAL_PATTERN = new RegExp(`(?<![\\w$.])(${HOST_GLOBALS.join('|')})\\b`, 'g');
const CODE_RULES: { rule: RuleId; pattern: RegExp; detail: string }[] = [
  { rule: 'require', pattern: /(?<![\w$.])require\b/g, detail: 'require' },
  { rule: 'dynamic-import', pattern: /(?<![\w$.])import\s*\(/g, detail: 'import()' },
  { rule: 'import-meta', pattern: /(?<![\w$.])import\s*\.\s*meta\b/g, detail: 'import.meta' },
  { rule: 'chrome', pattern: /(?<![\w$.])(?:chrome|browser)\s*[.[]/g, detail: 'chrome.*' },
  { rule: 'extension-identity', pattern: /\b(?:EXTENSION_ID|HOST_NAME|validateOrigin)\b/g, detail: 'extension identity' },
  { rule: 'eval', pattern: /(?<![\w$.])(?:eval|Function)\b/g, detail: 'dynamic code (eval or Function, also aliased or indirect)' },
  { rule: 'eval', pattern: /\.\s*constructor\s*\(/g, detail: 'dynamic code through a constructor property' },
  { rule: 'host-global', pattern: /\bMath\s*\.\s*random\b/g, detail: 'Math.random' },
  { rule: 'host-global', pattern: /\bDate\s*\.\s*now\b/g, detail: 'Date.now' },
  { rule: 'host-global', pattern: /\bnew\s+Date\s*\(\s*\)/g, detail: 'new Date()' },
  { rule: 'declare-global', pattern: /\bdeclare\s+(?:global|var|let|const|function|module|namespace)\b/g, detail: 'ambient declaration' },
];
const IDENTITY_VALUES = ['EXTENSION_ID', 'HOST_NAME', 'validateOrigin', 'chrome-extension://', 'com.treatable.local', 'lmgmjeabbalehlcakdbolielnfgchojf'];

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let k = 0; k < index && k < source.length; k += 1) if (source[k] === '\n') line += 1;
  return line;
}

function isSpecifierPosition(code: string, start: number): 'static' | 'dynamic' | 'require' | undefined {
  // A specifier keyword is always close to its string; a bounded window keeps the scan linear.
  const before = code.slice(Math.max(0, start - 1 - 200), start - 1).trimEnd();
  if (/(?:^|[^\w$.])from$/.test(before) || /(?:^|[^\w$.])import$/.test(before)) return 'static';
  if (/(?:^|[^\w$.])import\s*\($/.test(before)) return 'dynamic';
  if (/(?:^|[^\w$.])require\s*\($/.test(before)) return 'require';
  return undefined;
}

export function scanSource(file: string, source: string, srcRoot: string): Violation[] {
  const violations: Violation[] = [];
  const add = (index: number, rule: RuleId, detail: string) => violations.push({ file, line: lineOf(source, index), rule, detail });
  const { code, literals, comments } = lex(source);

  for (const literal of literals) {
    if (IDENTITY_VALUES.some(v => literal.value.includes(v))) add(literal.start, 'extension-identity', 'identity string');
    // obj['constructor'](...) reaches the Function constructor without the word appearing in code.
    if (literal.value === 'constructor') add(literal.start, 'eval', 'constructor by string key');
    if (literal.kind !== 'string') continue;
    const position = isSpecifierPosition(code, literal.start);
    if (!position) continue;
    const spec = literal.value;
    if (spec.startsWith('node:')) add(literal.start, 'node-builtin', spec);
    else if (BUILTINS.has(spec) || BUILTINS.has(spec.split('/')[0] as string)) add(literal.start, 'bare-builtin', spec);
    else if (spec.startsWith('./') || spec.startsWith('../')) {
      const resolved = path.resolve(path.dirname(file), spec);
      const relative = path.relative(srcRoot, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) add(literal.start, 'outside-src', spec);
      else if (!spec.endsWith('.ts')) add(literal.start, 'extensionless-import', spec);
      else if (!existsSync(resolved) || !statSync(resolved).isFile()) add(literal.start, 'unresolved-import', spec);
    } else if (spec.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(spec)) add(literal.start, 'outside-src', spec);
    else if (!ALLOWED_PACKAGES.has(spec)) add(literal.start, 'unlisted-package', spec);
  }

  for (const match of code.matchAll(HOST_GLOBAL_PATTERN)) add(match.index ?? 0, 'host-global', match[1] as string);
  for (const { rule, pattern, detail } of CODE_RULES) for (const match of code.matchAll(pattern)) add(match.index ?? 0, rule, detail);

  for (const comment of comments) {
    if (/^\/\s*<reference\b/.test(comment.text) || /^\/\s*<amd-module\b/.test(comment.text)) add(comment.start, 'triple-slash', 'reference directive');
    if (/@ts-(?:nocheck|ignore|expect-error)\b/.test(comment.text)) add(comment.start, 'ts-directive', 'type-check suppression');
  }
  return violations;
}

/** Walks every entry under srcRoot without following links. */
export function scanTree(srcRoot: string): { files: string[]; violations: Violation[] } {
  const files: string[] = [];
  const violations: Violation[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const info = lstatSync(full);
      if (info.isSymbolicLink()) {
        violations.push({ file: full, line: 0, rule: 'symlink', detail: 'symbolic link' });
      } else if (info.isDirectory()) {
        walk(full);
      } else if (!name.endsWith('.ts') || name.endsWith('.d.ts')) {
        violations.push({ file: full, line: 0, rule: 'non-ts-file', detail: name });
      } else {
        files.push(full);
        violations.push(...scanSource(full, readFileSync(full, 'utf8'), srcRoot));
      }
    }
  };
  walk(srcRoot);
  return { files, violations };
}
