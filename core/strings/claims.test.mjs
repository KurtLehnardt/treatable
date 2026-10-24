// Dependency-free claims scan and strings contract test. Run with: node --test core/strings/claims.test.mjs
//
// Part 1 validates core/strings/strings.en.json (shape, required keys, consistency of repeated wording).
// Part 2 scans shipped strings and docs for banned compliance, security, anonymity, and validity claims.
// Part 3 proves every banned pattern is caught and every allowed negation or mechanism name passes.
//
// This file defines the banned patterns, so the scan skips this file itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, readdirSync, existsSync, realpathSync, mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync, appendFileSync, symlinkSync,
  chmodSync,
} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import path from 'node:path';

// Look-alike and invisible characters are built from code points so the source stays readable.
const cp = (...codes) => String.fromCodePoint(...codes);

const SELF = fileURLToPath(import.meta.url);
const STRINGS_FILE = path.join(path.dirname(SELF), 'strings.en.json');
const REPO_ROOT = path.resolve(path.dirname(SELF), '..', '..');

// ---------------------------------------------------------------------------------------------
// File selection: roots, extension classes, ignored directories, exemptions
// ---------------------------------------------------------------------------------------------

// Top-level scan roots. `docs/apps` is the only scanned folder under docs/. Matching is case-insensitive
// because the repository is used on case-insensitive file systems.
const SCAN_ROOT_DIRS = ['core', 'desktop-helper', 'mobile', 'macos', 'windows', 'linux'];
const DOCS_SCAN_DIR = 'apps';

// Folders that belong to earlier work and are not scanned. A new top-level folder that is in neither list fails the
// "every folder is classified" test, so a platform folder with an unexpected name cannot be skipped silently.
// Editor folders (.vscode, .idea) never ship, so a developer's local settings do not fail the scan.
const NOT_OURS_ROOT_DIRS = new Set([
  'extension', 'scaffold', 'evals', 'installer', '.git', '.claude', '.codex', '.github', 'node_modules', '.vscode', '.idea',
]);
const NOT_OURS_DOCS_ENTRIES = new Set(['implementation']);
// Root-level files from the extension era that contain wording this scan bans. Each is skipped only while its content
// is byte for byte what it was at base commit 48c569e (SHA-256 below). Any edit puts the file back into the scan.
// Every other root-level file, including README.md, is scanned.
const LEGACY_ROOT_FILE_DIGESTS = {
  'BUILD_REPORT.md': '40442f4392893ad30035d4baa3e530ee7838709f19442b900a91cfe203e126fa',
  'install-windows.ps1': 'f3add26ba2c1841f040c74d3094be9283dabe84b3dbc948de4877cdc0040bdb7',
};

// Source files: only string literals and comments are wording. Keywords and identifiers are not claims.
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.swift', '.kt', '.kts', '.cs', '.java', '.rs', '.vala', '.c', '.h', '.gradle',
]);
const REGEX_LITERAL_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
// JSX can appear in .js files (Expo's App.js) as well as .jsx and .tsx.
const JSX_EXTENSIONS = new Set(['.tsx', '.jsx', '.js']);
const JSON_EXTENSIONS = new Set(['.json', '.xcstrings']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx']);
// Files whose whole text is wording or may carry wording.
const PROSE_EXTENSIONS = new Set([
  '.xaml', '.ui', '.blp', '.iss', '.isl', '.desktop', '.plist', '.xml', '.strings', '.stringsdict', '.resx', '.resw',
  '.wxs', '.wxl', '.appxmanifest', '.html', '.htm', '.txt', '.rtf', '.po', '.pot', '.in', '.spec', '.yml', '.yaml',
  '.sh', '.ps1', '.bat', '.cmd', '.py', '.svg', '.entitlements', '.storyboard', '.xib', '.config',
]);
// Project and build files can carry user-visible text (INFOPLIST_KEY_* in a pbxproj, <Description> in a csproj).
// Every rule runs on them except the ones for the everyday word "private", which these formats use as a keyword.
const CONFIG_TEXT_EXTENSIONS = new Set(['.pbxproj', '.xcconfig', '.csproj', '.vbproj', '.props', '.targets', '.toml', '.properties']);
// Files that are deliberately not scanned: media, binaries, archives, generated maps.
const NON_TEXT_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.bmp', '.tif', '.tiff', '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.zip', '.tar', '.gz', '.tgz', '.7z', '.jar', '.apk', '.aab', '.ipa', '.exe', '.dll', '.so', '.dylib', '.a', '.o', '.class',
  '.pdf', '.bin', '.dat', '.db', '.sqlite', '.wav', '.mp3', '.mp4', '.mov', '.keystore', '.jks', '.p12', '.mobileprovision',
  '.car', '.nib', '.mo', '.deb', '.rpm', '.pkg', '.msi', '.dmg', '.flatpak', '.blob', '.wasm', '.map',
]);
// Build and tool configuration without user-facing wording.
const CONFIG_EXTENSIONS = new Set([
  '.sln', '.slnx', '.xcscheme', '.lock', '.resolved', '.lockb', '.cfg', '.ini', '.conf', '.tsbuildinfo',
]);
const SKIPPED_FILE_NAMES = new Set([
  'package-lock.json', '.ds_store', '.gitkeep', '.git', '.gitignore', '.gitattributes', '.gitmodules', '.npmrc', '.nvmrc', '.editorconfig',
  '.prettierrc', '.eslintrc', '.dockerignore',
]);

// Returns 'code', 'json', 'markdown', 'prose', 'config', 'skip', or 'unknown'. An extensionless name is scanned as prose.
export function classifyFile(relPath) {
  const name = path.posix.basename(relPath).toLowerCase();
  if (SKIPPED_FILE_NAMES.has(name)) return 'skip';
  const ext = path.posix.extname(name);
  if (ext === '') return name.startsWith('.') ? 'unknown' : 'prose';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (JSON_EXTENSIONS.has(ext)) return 'json';
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (PROSE_EXTENSIONS.has(ext)) return 'prose';
  if (CONFIG_TEXT_EXTENSIONS.has(ext)) return 'config';
  if (NON_TEXT_EXTENSIONS.has(ext) || CONFIG_EXTENSIONS.has(ext)) return 'skip';
  return 'unknown';
}

// Generated and third-party directories, as repository-relative path patterns. A bare directory name is never enough:
// a source folder that happens to be called `bin` or `build` (for example desktop-helper/bin) is still scanned.
const IGNORED_DIRECTORY_PATTERNS = [
  /(?:^|\/)node_modules$/i,
  /(?:^|\/)\.git$/i,
  /^(?:core|desktop-helper|mobile|macos|windows|linux)\/(?:dist|build|coverage)$/i,
  /^(?:macos|windows|linux)\/[^/]+\/(?:dist|build|coverage)$/i,
  /^mobile\/(?:\.expo|ios\/Pods|ios\/build|android\/\.gradle|android\/build|android\/app\/build)$/i,
  /^macos\/(?:[^/]+\/)?(?:\.build|DerivedData)$/i,
  /^windows\/(?:.+\/)?(?:bin|obj)$/i,
  /^linux\/(?:[^/]+\/)?(?:builddir|_build|\.flatpak-builder)$/i,
];

export function isIgnoredDirectory(relDir) {
  return IGNORED_DIRECTORY_PATTERNS.some(re => re.test(relDir));
}

// Recorded public registry responses (for example ClinicalTrials.gov fixtures) and test files that quote hostile text
// can legitimately contain a phrase this scan bans. Such a file is not Treatable wording. Each entry is one exact
// repository-relative path, the ids of the rules it may trip (the file is still scanned by every other rule), and a
// written reason. Only test and fixture paths qualify, and strings and documents are never exempt. The list starts
// empty and every entry needs a reviewer's approval.
const EXEMPT_FILES = [];
// Folder names are matched without regard to case, because the repository is used on case-insensitive file systems.
const EXEMPT_PATH_PATTERN = /(?:^|\/)(?:test|tests|__tests__|fixtures)\/|\.test\./i;
const EXEMPT_UNDER_TEST_DIR = /(?:^|\/)(?:test|tests|__tests__)\//i;
// Folders whose contents are bundled into an app (source, assets, platform resources, web public files).
const SHIPPED_SOURCE_DIR = /(?:^|\/)(?:src|assets|resources|res|app|public)\//i;

export function validateExemptions(list, fileExists, ruleIds = RULES.map(r => r.id)) {
  const problems = [];
  for (const entry of list) {
    const p = entry?.path;
    if (typeof p !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(p)) problems.push(`${JSON.stringify(p)}: path must be an exact repository-relative path`);
    else {
      if (!EXEMPT_PATH_PATTERN.test(p)) problems.push(`${p}: only test and fixture paths can be exempt`);
      if (SHIPPED_SOURCE_DIR.test(p) && !EXEMPT_UNDER_TEST_DIR.test(p)) problems.push(`${p}: a file under src/, assets/, resources/, res/, app/, or public/ ships in the app, so it can be exempt only inside test/ or __tests__/`);
      if (/^core\/strings\//i.test(p) || /^docs\//i.test(p) || /\.mdx?$/i.test(p)) problems.push(`${p}: strings and documents are never exempt`);
      if (!fileExists(p)) problems.push(`${p}: file does not exist`);
    }
    if (typeof entry?.reason !== 'string' || entry.reason.trim().length < 20) problems.push(`${p}: a written reason of at least 20 characters is required`);
    if (!Array.isArray(entry?.rules) || entry.rules.length === 0) problems.push(`${p}: list the rule ids the file may trip`);
    else for (const id of entry.rules) if (!ruleIds.includes(id)) problems.push(`${p}: unknown rule id ${JSON.stringify(id)}`);
  }
  return problems;
}

export function exemptRulesFor(relPath) {
  const entry = EXEMPT_FILES.find(e => e.path === relPath);
  return entry ? new Set(entry.rules) : new Set();
}

// Problems with how top-level folders (and docs/ entries) are classified. Pure so it can be self-tested.
export function classifyTopLevel(rootEntries, docsEntries) {
  const problems = [];
  const scanRoots = new Set(SCAN_ROOT_DIRS);
  for (const e of rootEntries) {
    if (!e.isDirectory) continue;
    const name = e.name.toLowerCase();
    if (scanRoots.has(name) || name === 'docs' || NOT_OURS_ROOT_DIRS.has(name)) continue;
    problems.push(`top-level folder "${e.name}" is not classified: add it to SCAN_ROOT_DIRS or NOT_OURS_ROOT_DIRS`);
  }
  for (const e of docsEntries) {
    const name = e.name.toLowerCase();
    if (name === DOCS_SCAN_DIR && e.isDirectory) continue;
    if (NOT_OURS_DOCS_ENTRIES.has(name)) continue;
    problems.push(`docs/${e.name} is not classified: add it to NOT_OURS_DOCS_ENTRIES or move it under docs/${DOCS_SCAN_DIR}`);
  }
  return problems;
}

function entriesOf(dir) {
  return readdirSync(dir, {withFileTypes: true}).map(e => ({name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile(), isSymlink: e.isSymbolicLink()}));
}

function findChild(dir, name) {
  return entriesOf(dir).find(e => e.isDirectory && e.name.toLowerCase() === name);
}

const toPosix = p => p.split(path.sep).join('/');

// The key used to compare a path on disk with a path that git reports. Names are compared in Unicode NFC form,
// because macOS can report a decomposed (NFD) name on disk while git records the composed one. Case is ignored
// when git ignores it (core.ignorecase), because a case-only rename on such a file system leaves git's view unchanged.
export function pathKey(relPath, ignoreCase) {
  const nfc = relPath.normalize('NFC');
  return ignoreCase ? nfc.toLowerCase() : nfc;
}

// Splits the NUL-separated output of `git ls-files -z` into paths.
export function parseGitFileList(output) {
  return output.split('\0').filter(Boolean);
}

// Parses `git ls-files -z -s` output ("<mode> <object> <stage><TAB><path>") into {mode, path} records.
export function parseGitIndex(output) {
  return parseGitFileList(output).map(record => ({mode: record.slice(0, record.indexOf(' ')), path: record.slice(record.indexOf('\t') + 1)}));
}

// What git says about the work tree, reduced to the questions the walk asks. `tracked` comes from the index.
// `ignored` is the output of `git ls-files --others --ignored --exclude-standard --directory`: untracked paths that git
// ignores, with a trailing slash on a folder that is ignored as a whole. The scan fails closed: it skips a path only
// when git ignores it and nothing under it is tracked. A file that git lists under a different spelling, or does not
// list at all, is still read.
export function makeGitView({tracked, ignored, ignoreCase}) {
  const key = p => pathKey(p, ignoreCase);
  const trackedKeys = new Set(tracked.map(entry => key(entry.path)));
  const ignoredFiles = new Set();
  const ignoredDirs = [];
  for (const p of ignored) {
    if (p.endsWith('/')) ignoredDirs.push(key(p));
    else ignoredFiles.add(key(p));
  }
  const isTracked = rel => trackedKeys.has(key(rel));
  const hasTrackedUnder = rel => {
    const prefix = `${key(rel)}/`;
    for (const k of trackedKeys) if (k.startsWith(prefix)) return true;
    return false;
  };
  const isIgnored = rel => {
    const k = key(rel);
    return ignoredFiles.has(k) || ignoredDirs.some(dir => `${k}/`.startsWith(dir));
  };
  return {
    tracked, ignoreCase, isTracked, hasTrackedUnder,
    skips: (rel, isDirectory) => isIgnored(rel) && !(isDirectory ? hasTrackedUnder(rel) : isTracked(rel)),
  };
}

// Null when git is not installed or `root` is not the top of a git work tree (for example an exported copy).
// Then every file under a scan root is considered, except the generated folders in IGNORED_DIRECTORY_PATTERNS.
export function gitState(root) {
  const run = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024});
  try {
    if (realpathSync(run(['rev-parse', '--show-toplevel']).trim()) !== realpathSync(root)) return null;
    let ignoreCase = false;
    try {
      ignoreCase = run(['config', '--bool', 'core.ignorecase']).trim() === 'true';
    } catch {
      // An unset value means git compares paths with case.
    }
    const tracked = parseGitIndex(run(['ls-files', '-z', '-s']));
    const ignored = parseGitFileList(run(['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']));
    return makeGitView({tracked, ignored, ignoreCase});
  } catch {
    return null;
  }
}

// True for root-level files and for paths under a scan root or docs/apps, whatever their case or Unicode form.
function inScanArea(relPath) {
  const parts = relPath.normalize('NFC').toLowerCase().split('/');
  if (parts.length === 1) return true;
  if (SCAN_ROOT_DIRS.includes(parts[0])) return true;
  return parts[0] === 'docs' && parts[1] === DOCS_SCAN_DIR && parts.length > 2;
}

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const SELF_REAL = realpathSync.native(SELF);
const isSelf = full => path.basename(full).toLowerCase() === path.basename(SELF).toLowerCase() && realpathSync.native(full) === SELF_REAL;

// `onlyTracked` is set inside a generated or dependency folder: there, only files that git tracks are read.
function walk(dir, found, onlyTracked) {
  for (const entry of entriesOf(dir)) {
    const full = path.join(dir, entry.name);
    const rel = toPosix(path.relative(found.root, full));
    if (found.git?.skips(rel, entry.isDirectory)) continue;
    if (onlyTracked && !(entry.isDirectory ? found.git.hasTrackedUnder(rel) : found.git.isTracked(rel))) continue;
    if (entry.name.toLowerCase() === '.git') {
      // A nested repository (or a submodule checkout) hides its files from git, so it is reported, not skipped.
      found.nestedRepos.push(rel);
    } else if (entry.isSymlink) {
      found.seen.add(found.key(rel));
      found.symlinks.push(rel);
    } else if (entry.isDirectory) {
      if (!isIgnoredDirectory(rel)) walk(full, found, onlyTracked);
      else if (found.git?.hasTrackedUnder(rel)) walk(full, found, true);
    } else if (entry.isFile) {
      considerFile(full, rel, found);
    } else {
      found.unknown.push(rel);
    }
  }
}

function considerFile(full, rel, found) {
  found.seen.add(found.key(rel));
  if (isSelf(full)) return;
  const kind = classifyFile(rel);
  if (kind === 'skip') return;
  if (kind === 'unknown') found.unknown.push(rel);
  else found.files.push({full, rel, ignoreRules: exemptRulesFor(rel)});
}

// Collects the files to scan under `root`. Besides `files`, it reports what must make the scan fail: `unknown` file
// types, `symlinks`, `nestedRepos` (a nested .git or a submodule entry in the index), and `missingTracked` (a file that
// git tracks in a scanned area but that the walk did not find, so its committed text would go unchecked).
export function collectFiles(root = REPO_ROOT, git = gitState(root)) {
  const found = {
    root, git, key: p => pathKey(p, git?.ignoreCase ?? false), seen: new Set(),
    files: [], unknown: [], symlinks: [], nestedRepos: [], missingTracked: [],
  };
  const rootEntries = entriesOf(root);
  for (const e of rootEntries) {
    // The repository's own metadata: a folder, or a file in a linked work tree.
    if (e.name.toLowerCase() === '.git') continue;
    if (git?.skips(e.name, e.isDirectory)) continue;
    if (e.isSymlink) {
      found.seen.add(found.key(e.name));
      found.symlinks.push(e.name);
    } else if (e.isDirectory && SCAN_ROOT_DIRS.includes(e.name.toLowerCase())) {
      walk(path.join(root, e.name), found, false);
    } else if (e.isFile) {
      const pinned = LEGACY_ROOT_FILE_DIGESTS[e.name];
      if (pinned && sha256(readFileSync(path.join(root, e.name))) === pinned) found.seen.add(found.key(e.name));
      else considerFile(path.join(root, e.name), e.name, found);
    }
  }
  const docs = rootEntries.find(e => e.isDirectory && e.name.toLowerCase() === 'docs');
  if (docs) {
    const apps = findChild(path.join(root, docs.name), DOCS_SCAN_DIR);
    if (apps && !git?.skips(`${docs.name}/${apps.name}`, true)) walk(path.join(root, docs.name, apps.name), found, false);
  }
  if (git) {
    for (const entry of git.tracked) {
      if (!inScanArea(entry.path)) continue;
      if (entry.mode === '160000') found.nestedRepos.push(entry.path);
      else if (!found.seen.has(found.key(entry.path))) found.missingTracked.push(entry.path);
    }
  }
  found.files.sort((a, b) => a.rel.localeCompare(b.rel));
  return found;
}

// Decoding fails closed. A file is read as strict UTF-8 (a UTF-8 byte order mark is allowed), or as strict UTF-16
// when it starts with the little-endian (FF FE) or big-endian (FE FF) byte order mark. Everything else is a problem
// that fails the scan: bytes that are not valid UTF-8, NUL bytes without a UTF-16 byte order mark, and UTF-16 that
// does not decode. A decoder never substitutes a replacement character, because a substituted byte could split a
// phrase that the normalizer would otherwise have joined. The one exception is an extensionless file that starts
// with an executable signature (a built binary): it is reported as a binary and not scanned.
const STRICT_UTF8 = new TextDecoder('utf-8', {fatal: true});
const STRICT_UTF16LE = new TextDecoder('utf-16le', {fatal: true});
const EXECUTABLE_SIGNATURES = [
  {name: 'ELF', bytes: [0x7f, 0x45, 0x4c, 0x46]},
  {name: 'Mach-O', bytes: [0xfe, 0xed, 0xfa, 0xce]},
  {name: 'Mach-O', bytes: [0xfe, 0xed, 0xfa, 0xcf]},
  {name: 'Mach-O', bytes: [0xce, 0xfa, 0xed, 0xfe]},
  {name: 'Mach-O', bytes: [0xcf, 0xfa, 0xed, 0xfe]},
  {name: 'Mach-O universal', bytes: [0xca, 0xfe, 0xba, 0xbe]},
];

const startsWithBytes = (buffer, bytes) => buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b);

// The name of the executable format, or null. A PE file ("MZ") must also carry the "PE\0\0" header at the offset that
// the DOS header names, so that a text file that merely starts with the letters MZ is not taken for a binary.
export function executableSignature(buffer) {
  for (const {name, bytes} of EXECUTABLE_SIGNATURES) if (startsWithBytes(buffer, bytes)) return name;
  if (startsWithBytes(buffer, [0x4d, 0x5a]) && buffer.length >= 0x40) {
    const offset = buffer.readUInt32LE(0x3c);
    if (offset >= 0x40 && offset + 4 <= buffer.length && startsWithBytes(buffer.subarray(offset), [0x50, 0x45, 0, 0])) return 'PE';
  }
  return null;
}

// Returns {text}, {binary} (the executable format of an extensionless file), or {problem} (why the bytes are not
// readable text). The decode check and the scan both use this one function.
export function decodeText(buffer, relPath) {
  const strict = (decoder, bytes, encoding) => {
    let text;
    try {
      text = decoder.decode(bytes);
    } catch {
      return {problem: `not valid ${encoding}`};
    }
    // A NUL character inside decoded text means the encoding was guessed wrong (for example UTF-32 read as UTF-16).
    return text.includes('\0') ? {problem: `contains NUL characters after decoding as ${encoding}`} : {text};
  };
  if (startsWithBytes(buffer, [0xff, 0xfe])) return strict(STRICT_UTF16LE, buffer.subarray(2), 'UTF-16LE');
  if (startsWithBytes(buffer, [0xfe, 0xff])) {
    const body = Buffer.from(buffer.subarray(2));
    if (body.length % 2 !== 0) return {problem: 'not valid UTF-16BE (odd number of bytes)'};
    return strict(STRICT_UTF16LE, body.swap16(), 'UTF-16BE');
  }
  if (buffer.includes(0)) {
    const signature = path.posix.extname(path.posix.basename(relPath)) === '' ? executableSignature(buffer) : null;
    return signature ? {binary: signature} : {problem: 'contains NUL bytes but has no UTF-16 byte order mark'};
  }
  return strict(STRICT_UTF8, buffer, 'UTF-8');
}

// ---------------------------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------------------------

// A negated mention is an honest statement ("Not PHI-ready"), so negatable rules let it pass.
// A hit is negated when a negator, followed by at most four filler words, sits right before it in the same sentence.
const NEGATOR = "(?:not|never|no|cannot|can't|isn't|aren't|wasn't|doesn't|don't|won't|without|nor|neither)";
const FILLER = '(?:a|an|any|be|been|being|is|are|was|do|does|can|ever|yet|also|currently|claim(?:s|ed)?|described|called|labeled|presented|considered|treated|stated|as|to|of|promis(?:e|es|ed|ing))';
const NEGATED_BEFORE = new RegExp(`\\b${NEGATOR}\\s+(?:${FILLER}\\s+){0,4}$`, 'i');

export function isNegated(text, index) {
  // A sentence ends at . ; : ! ? or a blank line. A single line break (hard-wrapped text) does not end it.
  const sentence = text.slice(Math.max(0, index - 80), index).split(/[.;:!?]|\n\s*\n/).pop();
  return NEGATED_BEFORE.test(sentence);
}

// Mechanism names that are not claims. Each match is replaced by underscores of the same length before the rules run.
// Underscores, not spaces, so that a negator in front of a masked name cannot reach a claim behind it.
// Bare "secure store" and "secure storage" are not allowed: only the named platform features below.
// An allowance never applies in a sentence that also mentions the user's data (see USER_DATA_WORDS): "TLS encrypts
// the request." is a mechanism, but "TLS encrypts the request and your health data." is a claim about that data.
// Each entry's `bad` samples are claims built around the same name, and the self-test proves each one is still caught.
const MECHANISM_NAMES = [
  {
    // A named platform feature that encrypts a key, a credential, or a request. The object must be one of those words
    // and the clause must end right after it (or after "in transit", "at rest", "for the current user", or the place
    // the key is held). Anything else after the object (", so ...", "and ...") puts the sentence back under the rules.
    // This entry must come first so that "expo-secure-store encrypts" is masked before the bare package name is.
    id: 'mechanism-encrypts',
    re: /\b(?:DPAPI|Keychain|(?:Android\s+)?Keystore|Credential\s+Manager|Secret\s+Service|libsecret|TLS|HTTPS|expo-secure-store)\s+(?:also\s+)?encrypts?\s+(?:(?:the|each|every|this|your|stored)\s+)?(?:(?:OpenAI\s+)?API\s+keys?|keys?|credentials?|secrets?|requests?|connection|traffic|values?)(?:\s+(?:in\s+transit|at\s+rest|for\s+the\s+current\s+user|with\s+a\s+key\s+(?:held|kept|stored)\s+in\s+the\s+(?:Android\s+Keystore|Keychain|Secure\s+Enclave|TPM)))?(?=[ \t]*(?:[.;:!?)\]"'`]|\n[ \t]*\n|$))/gi,
    ok: [
      'Windows DPAPI encrypts the key for the current user.', 'TLS encrypts the request in transit.',
      'expo-secure-store encrypts values with a key held in the Android Keystore.', 'Keychain encrypts the OpenAI API key at rest.',
    ],
    bad: [
      'Treatable encrypts your data.', 'Your data is encrypted.', 'The app encrypts the preview.',
      'HTTPS encrypts all your health data.', 'Keychain encrypts your health entries.', 'expo-secure-store encrypts your symptoms on your phone.',
      'Credential Manager encrypts your health profile.', 'TLS encrypts everything.', 'No TLS encrypts anonymous traffic.',
      'TLS encrypts the request and your health data.', 'TLS encrypts the request, so OpenAI cannot read it.',
      'TLS encrypts the request and the rest.', 'Your health data is sent to OpenAI, and TLS encrypts the request.',
      'TLS encrypts the request\nand your symptoms.',
    ],
  },
  {
    // A private key named by its kind (a signing, SSH, or App Store Connect key), or a key file name.
    id: 'private-key',
    re: /\b(?:signing|App\s+Store\s+Connect|SSH|RSA|EC|PEM|upload|notarization|developer|API)\s+private[-\s]keys?\b|\bprivate\.(?:pem|key|p8|p12)\b/gi,
    ok: ['Store the App Store Connect private key outside the repository.', 'openssl genpkey -out private.pem', 'Keep the signing private key offline.'],
    bad: [
      'Your private profile.', 'a private search', 'private notes', 'Your health data is locked with a private key.',
      'Only your private key can read your data.', 'Data protected by a private key and HTTPS.',
      'Your health data is locked with a signing private key.', 'Only your SSH private key can read your data.',
      'private.pem keeps your information safe.',
    ],
  },
  {
    id: 'expo-secure-store',
    re: /\bexpo-secure-store\b/gi,
    ok: ['"expo-secure-store": "~14.0.0"', "import * as Store from 'expo-secure-store';"],
    bad: ['expo secure store is a secure store', 'Your symptoms stay in expo-secure-store.', 'expo-secure-store keeps your health data.'],
  },
  {
    id: 'platform-secure-storage',
    re: /\b(?:platform|system|OS|operating system's|operating system)\s+secure\s+storage\b/gi,
    ok: ['Credentials use platform secure storage.', "The operating system's secure storage holds the key."],
    bad: [
      'Credentials are kept in secure storage.', 'a secure store', 'Your key is stored securely.',
      'Your health data is kept in platform secure storage.', 'Searches go into system secure storage.',
    ],
  },
  {
    id: 'secure-enclave',
    re: /\bSecure Enclave\b/g,
    ok: ['Apple Secure Enclave'],
    bad: ['a secure enclave for your data', 'Your health data lives in the Secure Enclave.'],
  },
  {
    id: 'secure-context-random',
    re: /\bsecure (?:context|random)\b/gi,
    ok: ['A secure context is required.', 'Use a secure random generator.'],
    bad: ['a secure connection', 'Your health data runs in a secure context.'],
  },
  {
    id: 'encrypted-ebs',
    re: /\bencrypted EBS\b/gi,
    ok: ['Use encrypted EBS volumes for the test instance.'],
    bad: ['encrypted storage', 'Your health data is on encrypted EBS volumes.'],
  },
];

// Words that mean the user's own data. A mechanism allowance does not apply in a sentence that contains one.
const USER_DATA_WORDS = /\b(?:health|medical|data|information|info|symptoms?|notes?|entries|entry|searches|search\s+(?:terms?|words|history)|profiles?|history|conditions?|diagnos\w*|identity|PHI|PII|everything|anything|you\s+(?:type|enter|share|search))\b/i;
const SENTENCE_BREAK = /[.;:!?]|\n\s*\n/;

function sentenceAround(text, start, length) {
  const before = text.slice(Math.max(0, start - 400), start).split(SENTENCE_BREAK).pop();
  const after = text.slice(start + length, start + length + 400).split(SENTENCE_BREAK)[0];
  return `${before}${text.slice(start, start + length)}${after}`;
}

function maskMechanismNames(text) {
  let masked = text;
  for (const {re} of MECHANISM_NAMES) {
    masked = masked.replace(re, (m, offset, whole) => (USER_DATA_WORDS.test(sentenceAround(whole, offset, m.length)) ? m : '_'.repeat(m.length)));
  }
  return masked;
}

// scope 'all' rules run on every scanned text region. scope 'prose' rules run only where the word is prose:
// markdown outside code, and string literals and comments in source files (so the `private` keyword is legal).
// Multi-word patterns use [-\s]+ so hyphens, spaces, tabs and hard-wrapped line breaks all match.
const RULES = [
  {
    id: 'compliance-label',
    re: /\b(?:HIPAA|GDPR|CCPA|HITRUST|SOC\s?2|ISO\s?27001)[-\s]+(?:complian(?:t|ce)|ready|eligible|safe|certified|approved|aligned|conformant|friendly|grade|level)\b|\bcomplian(?:t|ce)\s+with\s+(?:HIPAA|GDPR|CCPA)\b|\b(?:meets?|satisf(?:y|ies)|fulfil(?:s|ls)?|complies\s+with|adheres?\s+to|conforms?\s+to|built\s+for|designed\s+for)\s+(?:the\s+)?(?:HIPAA|GDPR|CCPA)\b|\b(?:fully\s+)?complian(?:t|ce)\s+with\s+(?:\w+\s+){0,2}(?:privacy|data[-\s]protection|health)\s+(?:laws?|regulations?|rules)\b/gi,
    negatable: true,
    bad: [
      'HIPAA compliant', 'a HIPAA-ready app', 'HIPAA eligible tool', 'SOC 2 certified', 'GDPR-compliant',
      'supports HIPAA compliance', 'compliant with HIPAA', 'HIPAA-aligned', 'Meets HIPAA requirements.', 'Complies with HIPAA.', 'Adheres to HIPAA.', 'HIPAA-conformant design.', 'Built for HIPAA.',
      'HIPAA-friendly', 'HIPAA-grade privacy', 'Treatable is fully compliant with privacy laws.', 'HIPAA\ncompliant', `HIPAA${cp(0x2011)}compliant`,
    ],
    ok: [
      'Treatable is not HIPAA compliant.', 'Treatable makes no claim of HIPAA compliance or legal sufficiency.',
      'Treatable does not claim HIPAA compliance.', 'No HIPAA compliance is claimed.', 'Treatable does not meet HIPAA requirements.', 'Treatable does not adhere to HIPAA.',
    ],
  },
  {
    id: 'phi-ready',
    re: /\bPHI[-\s]+ready\b/gi,
    negatable: true,
    bad: ['PHI-ready', 'This mode is PHI ready.', 'Fully PHI-ready', `PHI${cp(0xa0)}ready`, `PHI${cp(0x2010)}ready`],
    ok: ['Not PHI-ready.', 'OpenAI mode is not PHI-ready.', 'It is not yet PHI-ready.', 'It is not\nPHI-ready.'],
  },
  {
    id: 'baa-verification',
    re: /\b(?:BAA[-\s]+verif\w*|verif\w*\s+(?:a|the|your|any)\s+BAA)\b/gi,
    negatable: true,
    bad: ['BAA verified', 'BAA verification passed', 'We verified your BAA.', 'Verify a BAA here.'],
    ok: ['Treatable does not verify a BAA.', 'This is not BAA verification.', 'It never verifies your BAA.'],
  },
  {
    id: 'secure',
    re: /\bsecur(?:e|ed|es|ely)\b/gi,
    negatable: false,
    bad: [
      'Your data is secure.', 'a secure app', 'Secure by design', 'safe and secure', 'stored securely', 'in secure storage',
      'a secure store', 'This is not secure.', 'Your data is secured.', 'Treatable secures your data.', 'Secured with platform storage.',
    ],
    ok: ['SecureStore', 'FLAG_SECURE', 'expo-secure-store', 'Apple Secure Enclave'],
  },
  {
    id: 'guarantee',
    re: /\bguarantee(?:d|s|ing)?\b/gi,
    negatable: true,
    bad: ['We guarantee your privacy.', 'Guaranteed erasure', 'a guarantee of deletion', 'guarantees protection'],
    ok: [
      'Treatable does not guarantee erasure.', 'There is no guarantee of deletion.', 'It cannot guarantee provider erasure.',
      'This is not a guarantee.',
    ],
  },
  {
    id: 'clinical-validity',
    re: /\b(?:clinically[-\s]+(?:validated|proven|verified|tested|accurate|reliable|approved)|medically[-\s]+(?:validated|proven|accurate|reliable|approved|reviewed)|scientifically[-\s]+(?:validated|proven|verified|tested|backed))\b/gi,
    negatable: true,
    bad: [
      'clinically validated', 'a clinically proven method', 'Clinically tested', 'clinically\nvalidated', 'Medically accurate matches.', 'clinically accurate',
      'Scientifically validated matching.',
    ],
    ok: [
      'Treatable has not been clinically validated.', 'The score is not clinically validated.',
      'Never described as clinically proven.',
    ],
  },
  {
    id: 'certified',
    re: /\bcertified\b/gi,
    negatable: true,
    bad: ['certified de-identification', 'a certified tool'],
    ok: ['The app is not certified.', 'Treatable is not claimed to be certified.'],
  },
  {
    id: 'anonymity',
    re: /\b(?:anonym(?:ous(?:ly)?|ized|ised|ization|isation)|pseudonym(?:ous|ized|ised|ization|isation))\b/gi,
    negatable: true,
    bad: ['Your data is anonymous.', 'anonymized data', 'fully anonymous', 'Anonymised results', 'ANONYMOUS', 'Your searches are pseudonymous.'],
    ok: ['Minimized health information is not anonymous.', 'The packet is not anonymized.', 'No anonymization is performed.', 'The packet is not pseudonymized.'],
  },
  {
    id: 'de-identified',
    re: /\bde[-\s]?identified\b/gi,
    negatable: true,
    bad: ['de-identified data', 'deidentified records'],
    ok: ['The data is not de-identified.', 'HHS de-identification guidance describes formal standards.'],
  },
  {
    id: 'data-stays-local',
    re: /\b(?:nothing\s+(?:ever\s+)?leaves|no\s+(?:\w+\s+){0,2}(?:data|information|details)\s+(?:ever\s+)?leaves?|never\s+leaves?\s+(?:your|the|this)\s+\w+|(?:stays?|remains?)\s+(?:only\s+)?on[-\s]?(?:your\s+|the\s+|this\s+)?(?:\w+\s+)?(?:device|phone|computer|mac|pc|laptop|tablet)|(?:stored|kept|held|saved|processed)\s+(?:only\s+)?(?:locally|on[-\s]?(?:your\s+|the\s+|this\s+)?(?:\w+\s+)?(?:device|phone|computer|mac|pc|laptop|tablet))|stays?\s+local(?:ly)?|never\s+(?:sent|shared|uploaded|transmitted)\s+(?:anywhere|to\s+(?:anyone|any\s+server|the\s+cloud)))\b/gi,
    negatable: false,
    bad: [
      'Nothing leaves your phone.', 'no data leaves the app', 'Your data never leaves your device.', 'Everything stays on your device.',
      'No health data leaves your device.', 'Your notes never leave your device.', 'It remains on your device.',
      'Data stays on-device.', 'Everything stays local.', 'Data is processed locally and never sent anywhere.',
      'Your data stays on your phone.', 'Everything stays on your computer.', 'Symptoms remain on your Mac.',
      'Your data is stored only on your device.', 'Your data is processed locally.', 'Your health data is kept on-device.',
    ],
    ok: [
      'Searching does not send anything to OpenAI.', 'Treatable does not save your health entries.', 'OpenAI features stay locked.',
      'The key stays locked until you unlock the credential system.', 'Study contact details are never sent to OpenAI.',
    ],
  },
  {
    id: 'encryption',
    re: /\bencrypt(?:s|ed|ion|ing)?\b|\bE2EE\b|\bend[-\s]+to[-\s]+end[-\s]+(?:crypto\w*|protect\w*|privacy|secret\w*|secur\w*|safe\w*)/gi,
    negatable: true,
    bad: [
      'Your data is encrypted.', 'end-to-end encrypted', 'Encrypted storage', 'encrypts your data', 'End-to-end encryption',
      'Uses end to end crypto.', 'E2EE.', 'End-to-end protected.',
    ],
    ok: ['The text is not encrypted.', 'EncryptedSharedPreferences', 'Treatable does not encrypt the preview.'],
  },
  {
    id: 'erasure-promise',
    re: /\b(?:(?:instant(?:ly)?|immediate(?:ly)?|permanent(?:ly)?)[-\s]+(?:\w+[-\s]+)?(?:eras\w*|delet\w*|remov\w*|wip\w*)|(?:eras\w*|delet\w*|remov\w*|wip\w*)[-\s]+(?:\w+[-\s]+){0,2}(?:instant(?:ly)?|immediate(?:ly)?|permanent(?:ly)?))\b/gi,
    negatable: true,
    bad: [
      'Your data is deleted instantly.', 'Permanently erased after use.', 'instant erasure', 'immediately deletes your data',
      'permanently deleted',
    ],
    ok: [
      'Treatable does not promise instant physical erasure.', 'It cannot promise immediate erasure.',
      'Physical removal can happen later.', 'Treatable cannot promise that OpenAI has erased the data.',
    ],
  },
  {
    id: 'removal-promise',
    re: /\b(?:promis(?:e|es|ed|ing)|assur(?:e|es|ed|ing|ance))\s+(?:\w+\s+){0,3}(?:eras|delet|remov|wip|destr|purg)\w*|\b(?:assured|guaranteed|complete|total|irreversible|permanent)\s+(?:eras|delet|remov|wip|destr|purg)\w*|\b(?:eras|delet|remov|wip|destr|purg)\w*\s+(?:forever|for\s+good|completely|entirely)\b|\bcompletely\s+(?:eras|delet|remov|wip|destr|purg)\w*/gi,
    negatable: true,
    bad: ['We promise your data is erased.', 'Assured deletion.', 'Complete deletion of your data.', 'Irreversible erasure.', 'We assure removal of all data.',
      'Erased forever.', 'Completely deleted.', 'Deleted for good.'],
    ok: [
      'Treatable does not promise instant physical erasure.', 'Treatable cannot promise that OpenAI has erased the data.',
      'Treatable makes no promise of deletion.',
    ],
  },
  {
    id: 'endorsement-claim',
    re: /\b(?:doctor|physician|clinician|nurse|pharmacist|expert)s?[-\s]+(?:approved|recommended|endorsed|reviewed|verified|validated|tested|backed)\b|\b(?:trusted|approved|recommended|endorsed|reviewed|verified|validated|backed|used)\s+by\s+(?:\w+\s+){0,2}(?:doctors|physicians|clinicians|nurses|pharmacists|experts|hospitals|researchers)\b/gi,
    negatable: true,
    bad: [
      'Doctor approved.', 'Physician-reviewed matching.', 'Doctor-recommended app.', 'Clinician validated scores.', 'Trusted by doctors.',
      'Reviewed by leading clinicians.',
    ],
    ok: ['Treatable is not doctor approved.', 'The matching was not clinician reviewed.', 'The scores are not reviewed by clinicians.'],
  },
  {
    id: 'collection-denial',
    re: /\bno\s+(?:\w+\s+){0,2}(?:data|information)\s+(?:is|are)\s+(?:ever\s+)?(?:collected|stored|retained|tracked|logged|kept)\b|\bwe\s+(?:never|don't|do\s+not)\s+(?:collect|store|track|log|sell|keep|see|share)\b|\bzero\s+data\s+collection\b|\bdata\s+not\s+collected\b|\bno\s+(?:data|information)\s+collection\b|\bnothing\s+(?:\w+\s+){0,3}?(?:is|gets)\s+(?:ever\s+)?(?:retained|stored|kept|saved|logged|sent|shared|uploaded)\b|\b(?:keeps?|stores?|retains?)\s+nothing\b|\b(?:does\s+not|doesn't|never)\s+(?:store|keep|retain|log)\s+your\s+(?:data|information)\b|\bno\s+logs\s+(?:are\s+)?kept\b|\bno\s+(?:PII|personally[-\s]+identifiable(?:\s+information)?|personal\s+(?:data|information))\s+(?:is|are)\s+(?:ever\s+)?(?:sent|shared|collected|stored|transmitted)\b|\b(?:data|information|entries|symptoms|searches|profiles?|history)\s+(?:is|are)\s+never\s+(?:shared|stored|sent|saved|kept|logged|retained|uploaded)\b/gi,
    negatable: false,
    bad: [
      'No personal data is collected.', 'We never collect your data.', 'We do not collect any personal information.', 'Zero data collection.',
      'Data Not Collected', 'No tracking, no data collection.', 'Nothing is retained.', 'OpenAI keeps nothing.',
      'OpenAI does not store your data.', 'No logs are kept.', 'No PII is sent.', 'No personally identifiable information is sent to OpenAI.', 'No data is stored.',
      'We never share your data.', 'Health data is never shared.', 'Your health data is never stored.', 'Nothing is ever stored.',
      'Nothing you type is stored.', 'Nothing is sent to the cloud.',
    ],
    ok: [
      'Treatable does not save your health entries, notes, searches, or profiles.', 'Study contact details are never sent to OpenAI.',
      'Preparation failed. Nothing was sent to OpenAI.',
    ],
  },
  {
    id: 'invisibility-claim',
    re: /\b(?:no\s*one|nobody)\s+(?:else\s+)?(?:can\s+|will\s+(?:ever\s+)?)?(?:identify|see|access|read|trace|know)s?\b|\bonly\s+(?:you|(?:your|the)\s+(?:\S+\s+){0,2}?\S+)\s+can\s+(?:see|read|access|decrypt|unlock|view|open)\b|\b(?:cannot|can't|can\s+not)\s+be\s+(?:traced|tracked|linked)|\bincognito\b|\bnever\s+(?:sees?|reads?|knows?|learns?)\s+(?:who\s+you\s+are|your|what\s+you)\b|\bidentity\s+is\s+(?:never\s+shared|hidden|masked)\b/gi,
    negatable: false,
    bad: [
      'No one can identify you.', 'Nobody can see your searches.', 'Only you can see your results.',
      'Your searches cannot be traced back to you.', 'Incognito search.', 'OpenAI never sees who you are.',
      'Your identity is never shared.', 'Your identity is hidden.', 'No one sees your symptoms.', 'OpenAI never sees your symptoms.',
      'Only your device can read your entries.', 'Only the study team can see your matches.',
    ],
    ok: [
      'OpenAI can link these requests to your OpenAI account.', 'People who can view the logs of the project can see these traces.',
      'Only the study team can confirm eligibility.',
    ],
  },
  {
    id: 'eligibility-claim',
    re: /\bfind\s+out\s+(?:if|whether)\s+you\s+(?:qualify|are\s+eligible)\b|\bsee\s+which\s+(?:trials|studies)\s+you(?:'re|\s+are)\s+eligible\s+for\b|\bchecks?\s+(?:if|whether)\s+you\s+(?:qualify|are\s+eligible)\b/gi,
    negatable: true,
    bad: ['Find out if you qualify.', 'See which trials you are eligible for.', 'Treatable checks whether you are eligible.'],
    ok: ['Treatable does not check whether you qualify.', 'Only the study team can confirm eligibility.'],
  },
  {
    id: 'accuracy-claim',
    re: /\b\d{2,3}\s*%\s+(?:accurate|accuracy|reliable|correct|precise)\b|\baccuracy\s+of\s+\d{2,3}\s*%/gi,
    negatable: true,
    bad: ['Matches are 95% accurate.', 'An accuracy of 90 %.', '99 % reliable'],
    ok: ['The score is not 100% accurate.'],
  },
  {
    id: 'treatment-claim',
    re: /\b(?:diagnos(?:es|e|ing)|cures?|prescribes?)\s+(?:your|you|conditions?|diseases?)\b/gi,
    negatable: true,
    bad: ['Treatable diagnoses your condition.', 'It cures disease.', 'The app prescribes you treatment.'],
    ok: ['It does not diagnose conditions or recommend treatment.'],
  },
  {
    id: 'zero-data-retention-claim',
    // Zero Data Retention stated as a property, as something in use, or as a bare bullet or heading. The verb list
    // leaves out bare "with" and "eligible for", which honest denials need ("not eligible for Zero Data Retention").
    re: /\b(?:ZDR|Zero[-\s]+Data[-\s]+Retention)[-\s]+(?:compatible|eligible|enabled|covered|ready)\b|\b(?:runs?\s+with|works?\s+with|compatible\s+with|backed\s+by|covered\s+by|uses?|using|under|supports?|offers?|provides?|has|have|enables?|includes?|qualifies\s+for)\s+(?:(?!not\b|no\b|never\b|without\b)\w+\s+){0,2}(?:ZDR|Zero[-\s]+Data[-\s]+Retention)\b|^[ \t]*(?:[-*+][ \t]+|#{1,6}[ \t]+)?(?:ZDR|Zero[-\s]+Data[-\s]+Retention)(?:[ \t]+mode)?[ \t]*\.?[ \t]*$/gim,
    negatable: true,
    bad: [
      'ZDR-compatible', 'Zero Data Retention eligible', 'ZDR enabled', 'Zero-Data-Retention ready', 'Zero data retention.', 'Zero Data Retention',
      '- Zero Data Retention', '## ZDR', 'Uses Zero Data Retention.', 'Decisions requests run with ZDR.', 'ZDR mode.',
      'Treatable is compatible with Zero Data Retention.', 'Covered by Zero Data Retention.', 'Treatable has no logs and uses ZDR.',
    ],
    ok: [
      'Treatable is not ZDR-compatible.', 'It is not compatible with Zero Data Retention.', 'The Agents API does not support Zero Data Retention (ZDR).',
      'Treatable does not use Zero Data Retention.', 'It is not eligible for Zero Data Retention and currently supports data residency only in the United States.',
      'Treatable has no Zero Data Retention agreement.',
    ],
  },
  {
    id: 'protection-claim',
    re: /\b(?:(?:your|the|all)\s+(?:\w+\s+){0,2}(?:data|information|privacy|identity)\s+(?:is|are|stays?|remains?)\s+(?:(?!not\b|never\b|no\b)\w+\s+)?(?:safe|protected|confidential|shielded|locked|hidden|sealed)|(?:data|information|privacy|identity|searches|entries|details|symptoms|notes|profiles?|history)\s+(?:is|are|stays?|remains?|will\s+(?:stay|remain|be))\s+(?:(?!not\b|never\b|no\b)\w+\s+)?(?:safe|protected|confidential|shielded|locked|hidden|sealed)|(?:data|information|entries|searches|symptoms|notes|profiles?)\s+(?:fully\s+|always\s+|strongly\s+)?(?:protected|safeguarded|shielded)\s+(?:by|with|from|against|using)|(?:keeps?|kept|holds?)\s+(?:your|the|all)\s+(?:\w+\s+){0,2}(?:data|information|key|searches|entries|identity)\s+(?:safe|protected|confidential|secret)|we\s+(?:protect|safeguard)\s+your|(?:protects?|safeguards?|shields?)\s+(?:your|all|users?'?|patients?'?)\s+(?:\w+\s+){0,2}(?:data|information|privacy|identity|searches|entries|health|symptoms|notes)|[A-Za-z]+-(?:protected|safeguarded|shielded)|(?:bank|enterprise)[-\s]+(?:level|grade)|untraceable|confidential)\b/gi,
    negatable: true,
    bad: [
      'Your data is safe.', 'Your data is protected.', 'We protect your privacy.', 'Bank-level security for your data.',
      'Enterprise-grade security.', 'Searches are untraceable.', 'Your health information stays confidential.',
      'We keep your data safe.', 'Treatable keeps your key protected.', 'Confidential search.',
      'Protected health information stays protected.', 'Health data stays protected.', 'Health information remains safe.', 'Searches stay safe.',
      'Treatable protects your health information.', 'Treatable safeguards your data.', 'Keychain protects your health data.',
      'Your data is shielded.', 'Data protected by a private key and HTTPS.', 'Keychain-protected health data.',
      'Your health data is locked with a signing private key.', 'Your search history is hidden.',
    ],
    ok: [
      'Your data is not protected against a compromised operating system.', 'Treatable cannot protect your information.',
      'Treatable does not protect your data from malware.', 'PHI means protected health information.', 'OpenAI features stay locked.',
      'The key stays locked until you unlock the credential system.',
    ],
  },
  {
    id: 'marketing-claims',
    re: /\b(?:privacy[-\s]+(?:first|preserving|protected|focused|friendly|safe|by[-\s]+design|respecting|conscious|centric)|(?:military|bank)[-\s]+grade|100\s*%\s+(?:private|safe|secure|accurate|anonymous)|(?:FDA|CE)[-\s]+(?:approved|cleared))\b/gi,
    negatable: true,
    bad: ['privacy-first design', 'a privacy preserving app', 'Privacy by design.', 'A privacy-respecting app.', 'military-grade protection', 'bank grade', '100% accurate', 'Your data is 100 % safe.', 'FDA approved'],
    ok: ['Treatable is not FDA approved.', 'Treatable is not FDA cleared.'],
  },
  {
    id: 'private-prose',
    re: /\bprivat(?:e|ely)\b/gi,
    negatable: false,
    scope: 'prose',
    bad: ['Your private profile', 'Private by design', 'a private search', 'private retention', 'a private link', 'Privately search trials.'],
    ok: ['privacy contact'],
  },
];

// ---------------------------------------------------------------------------------------------
// Normalization: undo tricks that split or disguise a phrase before any rule runs
// ---------------------------------------------------------------------------------------------

const INVISIBLE_CHARS = new RegExp(`[${cp(0xad)}${cp(0x200b)}-${cp(0x200d)}${cp(0x2060)}${cp(0xfeff)}]`, 'g');
const DASH_CHARS = new RegExp(`[${cp(0x2010)}-${cp(0x2015)}${cp(0x2212)}]`, 'g');
const NBSP_CHARS = new RegExp(`[${cp(0xa0)}${cp(0x202f)}]`, 'g');
const SINGLE_QUOTE_CHARS = new RegExp(`[${cp(0x2018)}${cp(0x2019)}]`, 'g');
const DOUBLE_QUOTE_CHARS = new RegExp(`[${cp(0x201c)}${cp(0x201d)}]`, 'g');
const NAMED_ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '', hyphen: '-', ndash: '-', mdash: '-', minus: '-'};

export function normalize(text) {
  let t = text;
  for (let pass = 0; pass < 2; pass += 1) {
    t = t.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi, (whole, dec, hex, name) => {
      if (name) return Object.hasOwn(NAMED_ENTITIES, name.toLowerCase()) ? NAMED_ENTITIES[name.toLowerCase()] : whole;
      const code = dec ? Number(dec) : parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    });
  }
  t = t.normalize('NFKC');
  t = t.replace(INVISIBLE_CHARS, '');
  t = t.replace(DASH_CHARS, '-');
  t = t.replace(NBSP_CHARS, ' ');
  t = t.replace(SINGLE_QUOTE_CHARS, "'").replace(DOUBLE_QUOTE_CHARS, '"');
  t = t.replace(/<!--|-->/g, '');
  t = t.replace(/\*+/g, '');
  // Emphasis underscores (_word_ and __word__) only. An underscore inside a name such as FLAG_SECURE stays.
  t = t.replace(/(^|[\s(\[])_+(?=\S)/g, '$1').replace(/(?<=\S)_+(?=[\s)\].,;:!?]|$)/g, '');
  return t;
}

// ---------------------------------------------------------------------------------------------
// Region extraction: decide which text each rule sees
// ---------------------------------------------------------------------------------------------

// A "/" starts a regular expression literal after an operator, an opening bracket, or one of these keywords.
// The angle brackets are left out on purpose: after "</" or "/>" in JSX a slash closes a tag and starts nothing.
// A closing brace is left out too: after "}" a slash is almost always a division or JSX text ("{count}/{total}").
const REGEX_CAN_START_AFTER = /(?:[(,=:[!&|?{;+\-*%~^]|=>|\b(?:return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await))\s*$/;

// In JavaScript and TypeScript a quote right after a letter, digit, _ or $ cannot open a string, except after one of
// these keywords (`return"x"`). Such a quote is an apostrophe or inch mark in JSX text ("Don't"), so it is skipped.
const JS_KEYWORDS_BEFORE_STRING = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await', 'instanceof',
  'import', 'from', 'export', 'extends',
]);
const precedingWord = (text, i) => /[\w$]*$/.exec(text.slice(Math.max(0, i - 32), i))[0];

// The language family decides which literal forms the string scan knows: 'js' (regular expression literals and the
// apostrophe rule), 'swift' (raw strings #"..."#, and ' is not a delimiter), 'cs' (verbatim strings @"..."),
// 'rs' (raw strings r#"..."#, and lifetimes such as 'a), or 'c' (plain C-like strings and character literals).
export function codeLanguage(ext) {
  if (REGEX_LITERAL_EXTENSIONS.has(ext)) return 'js';
  if (ext === '.swift') return 'swift';
  if (ext === '.cs') return 'cs';
  if (ext === '.rs') return 'rs';
  return 'c';
}

// Returns the text of string literals and comments in C-like source code. Keywords and identifiers
// (for example the `private` modifier or a variable named `encrypted`) are not claims, so they are dropped.
// Pieces are joined by blank lines, so each literal is its own sentence: a negator in one cannot excuse another.
export function codeProse(text, {lang = 'c'} = {}) {
  const out = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    const raw = lang === 'swift' && c === '#' ? /^(#+)("""|")/.exec(text.slice(i, i + 40))
      : lang === 'rs' && (c === 'r' || c === 'b') && !/[\w$]/.test(text[i - 1] ?? '') ? /^b?r(#*)(")/.exec(text.slice(i, i + 40))
        : null;
    if (c === '/' && d === '/') {
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      out.push(text.slice(i + 2, j));
      i = j;
    } else if (c === '/' && d === '*') {
      let j = text.indexOf('*/', i + 2);
      if (j < 0) j = n;
      out.push(text.slice(i + 2, j));
      i = j + 2;
    } else if (raw) {
      // Swift #"..."# and Rust r#"..."#: backslashes and plain quotes inside do not end the string.
      const close = raw[2] + raw[1];
      const start = i + raw[0].length;
      let j = text.indexOf(close, start);
      if (j < 0) j = n;
      out.push(text.slice(start, j));
      i = j + close.length;
    } else if (lang === 'cs' && (c === '@' || c === '$') && /^(?:@\$?|\$@)"/.test(text.slice(i, i + 3))) {
      // C# verbatim string: a backslash is an ordinary character and "" stands for one quote.
      let j = i + text.slice(i, i + 3).indexOf('"') + 1;
      const start = j;
      while (j < n && !(text[j] === '"' && text[j + 1] !== '"')) j += text[j] === '"' ? 2 : 1;
      out.push(text.slice(start, Math.min(j, n)));
      i = j + 1;
    } else if (lang === 'rs' && c === "'") {
      // A Rust character literal ('a', '\n', '\u{1F600}'); otherwise the quote starts a lifetime or a label.
      const char = /^'(?:\\(?:u\{[0-9a-fA-F]{1,6}\}|x[0-9a-fA-F]{2}|.)|[^\\'\n])'/.exec(text.slice(i, i + 14));
      if (char) out.push(char[0].slice(1, -1));
      i += char ? char[0].length : 1;
    } else if (lang === 'swift' && c === "'") {
      i += 1;
    } else if (lang === 'js' && (c === '"' || c === "'") && /[\w$]/.test(text[i - 1] ?? '') && !JS_KEYWORDS_BEFORE_STRING.has(precedingWord(text, i))) {
      i += 1;
    } else if (c === '/' && lang === 'js' && d !== '>' && (text.slice(Math.max(0, i - 16), i).trim() === '' || REGEX_CAN_START_AFTER.test(text.slice(Math.max(0, i - 16), i)))) {
      // A regular expression literal can hold quote characters that are not string delimiters. Skip the whole literal.
      let j = i + 1;
      let inClass = false;
      while (j < n && text[j] !== '\n') {
        if (text[j] === '\\') j += 1;
        else if (text[j] === '[') inClass = true;
        else if (text[j] === ']') inClass = false;
        else if (text[j] === '/' && !inClass) break;
        j += 1;
      }
      i = j < n && text[j] === '/' ? j + 1 : i + 1;
    } else if (c === '"' && text.startsWith('"""', i)) {
      let j = text.indexOf('"""', i + 3);
      if (j < 0) j = n;
      out.push(text.slice(i + 3, j));
      i = j + 3;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === '\\') j += 1;
        else if (text[j] === '\n' && c !== '`') break;
        j += 1;
      }
      out.push(text.slice(i + 1, Math.min(j, n)));
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return out.join('\n\n');
}

// Text between JSX tags, which is user-facing wording but is neither a string literal nor a comment.
// The text may not contain ; = ` { } < > so that generic type arguments and ordinary code are not mistaken for it.
export function jsxText(text) {
  const out = [];
  const openTag = String.raw`<[A-Za-z][\w.:-]*(?:\s(?:[^<>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)?>`;
  for (const m of text.matchAll(new RegExp(`${openTag}([^<>{}\`;=]{1,2000})(?=[<{])`, 'g'))) out.push(m[1]);
  for (const m of text.matchAll(/\}([^<>{}`;=]{1,2000})(?=<)/g)) out.push(m[1]);
  for (const m of text.matchAll(/(?:<\/[A-Za-z][\w.:-]*\s*>|\/>)([^<>{}`;=]{1,2000})(?=[<{])/g)) out.push(m[1]);
  // Text that runs straight into a closing tag may hold ; and =, because a closing tag cannot be part of TypeScript generics.
  for (const m of text.matchAll(/[>}]([^<>{}]{1,2000})(?=<\/)/g)) out.push(m[1]);
  return out.join('\n\n');
}

// Attribute values and expression-container strings in JSX (title="...", label={'...'}, {"..."}), read straight from
// the source with a pattern. This does not depend on the string scan in codeProse, so JSX text that confuses that scan
// (an unmatched quote or a slash) cannot hide an attribute.
export function jsxAttributeStrings(text) {
  const out = [];
  for (const m of text.matchAll(/(?:[A-Za-z_$][\w$.:-]*\s*=\s*\{?|\{)\s*(?:"([^"\n]{0,2000})"|'([^'\n]{0,2000})')/g)) out.push(m[1] ?? m[2]);
  return out.join('\n\n');
}

// Returns string values and keys of a JSON document. The one exception is the package field `"private": true`.
export function jsonRegions(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return text;
  }
  const out = [];
  const visit = value => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      for (const [key, member] of Object.entries(value)) {
        if (!(key === 'private' && typeof member === 'boolean')) out.push(key);
        visit(member);
      }
    }
  };
  visit(data);
  return out.join('\n\n');
}

// Markdown code fences and inline code may show source keywords such as `private`.
export function markdownProse(text) {
  const blank = m => m.replace(/[^\n]/g, ' ');
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, blank).replace(/`[^`\n]*`/g, blank);
}

function regionsFor(relPath, text) {
  const ext = path.posix.extname(relPath).toLowerCase();
  const kind = classifyFile(relPath);
  if (kind === 'code') {
    const parts = [codeProse(text, {lang: codeLanguage(ext)})];
    if (JSX_EXTENSIONS.has(ext)) parts.push(jsxText(text), jsxAttributeStrings(text));
    const joined = parts.join('\n\n');
    return {all: joined, prose: joined};
  }
  if (kind === 'json') {
    const strings = jsonRegions(text);
    return {all: strings, prose: strings};
  }
  if (kind === 'markdown') return {all: text, prose: markdownProse(text)};
  if (kind === 'config') return {all: text, prose: ''};
  return {all: text, prose: text};
}

// Returns a list of readable hit descriptions. Empty means clean. `ignoreRules` holds rule ids that an approved
// exemption lets this file trip; every other rule still applies.
export function scanText(relPath, text, {ignoreRules = new Set()} = {}) {
  const regions = regionsFor(relPath, text);
  const variants = [regions];
  if (regions.all.includes('<!--') || regions.prose.includes('<!--')) {
    // Second pass with HTML comments removed, so a phrase split by a comment is read as one phrase.
    const strip = t => t.replace(/<!--[\s\S]*?-->/g, '');
    variants.push({all: strip(regions.all), prose: strip(regions.prose)});
  }
  const hits = new Set();
  for (const variant of variants) {
    const allText = normalize(variant.all);
    const proseText = normalize(variant.prose);
    for (const rule of RULES) {
      if (ignoreRules.has(rule.id)) continue;
      const region = maskMechanismNames(rule.scope === 'prose' ? proseText : allText);
      for (const m of region.matchAll(rule.re)) {
        if (rule.negatable && isNegated(region, m.index ?? 0)) continue;
        hits.add(`${relPath}: "${m[0].replace(/\s+/g, ' ')}" [${rule.id}]`);
      }
    }
  }
  return [...hits];
}

// ---------------------------------------------------------------------------------------------
// Part 1: strings.en.json contract
// ---------------------------------------------------------------------------------------------

const rawStrings = readFileSync(STRINGS_FILE, 'utf8');
const strings = JSON.parse(rawStrings);

const NAMESPACES = new Set([
  'app', 'disclaimer', 'operator', 'disclosure', 'notice', 'consent', 'payload', 'credential',
  'error', 'trace', 'session', 'cache', 'record',
]);
const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-z0-9][a-zA-Z0-9]*)+$/;
const SECTION_KEY = /^notice\.section\.(\d{2})\.(heading|body)$/;

const REQUIRED_KEYS = [
  'app.name',
  'disclaimer.persistent', 'disclaimer.matchingLimits', 'disclaimer.scoreMeaning', 'disclaimer.distance',
  'disclaimer.unknownEligibility', 'disclaimer.participationDraftOnly', 'disclaimer.publicRecords', 'disclaimer.aiOutput',
  'disclaimer.notClinicallyValidated', 'disclaimer.notAnonymous', 'disclaimer.notPhiReady', 'disclaimer.noComplianceClaim',
  'operator.name', 'operator.privacyContact', 'operator.noticeOnly', 'operator.noRecordLookup',
  'disclosure.ctgov.heading', 'disclosure.ctgov.body', 'disclosure.ctgov.networkNote',
  'disclosure.openai.heading', 'disclosure.openai.body', 'disclosure.openai.conditionTerm', 'disclosure.openai.account',
  'disclosure.openai.neverSent', 'disclosure.openai.studyContacts', 'disclosure.separation',
  'disclosure.agentsRetention', 'disclosure.agentsTracing', 'disclosure.agentsInterrupted',
  'disclosure.decisionsRetention', 'disclosure.abuseMonitoring', 'disclosure.noTraining', 'disclosure.cannotRetract',
  'disclosure.credentials', 'disclosure.limits',
  'notice.title', 'notice.regionLabel', 'notice.scrollHint', 'notice.endMarker', 'notice.acknowledgmentLabel',
  'notice.acknowledgeButton', 'notice.acknowledgedStatus', 'notice.acknowledgmentSessionOnly', 'notice.declineButton',
  'consent.separateConfirmationNote', 'consent.prepareButton', 'consent.previewHeading', 'consent.previewExplanation',
  'consent.previewNoCredentials', 'consent.digestLabel', 'consent.expiresLabel', 'consent.expiryNote', 'consent.resendNote',
  'consent.invalidationNote', 'consent.confirmLabel', 'consent.sendDecisions', 'consent.sendAgents',
  'consent.discardButton', 'consent.stopButton',
  'payload.heading', 'payload.conditionTerm', 'payload.ageBand', 'payload.state', 'payload.sex', 'payload.doNotShare',
  'payload.notSharedNote',
  'credential.heading', 'credential.explanation', 'credential.noFallback', 'credential.lockedWithoutKey',
  'credential.prompt', 'credential.neverInChat', 'credential.noSharedKey', 'credential.saveButton',
  'credential.removeButton', 'credential.removeConfirm', 'credential.statusPresent', 'credential.statusAbsent',
  'credential.statusLocked', 'credential.keepsAfterSession',
  'error.networkOffline', 'error.ctgovUnavailable', 'error.ctgovRateLimited', 'error.openaiUnavailable',
  'error.consentRequired', 'error.consentExpired', 'error.consentInvalidated', 'error.consentUsed',
  'error.credentialMissing', 'error.credentialLocked', 'error.cancelled', 'error.deletionFailed',
  'error.deletionNotAttempted', 'error.requestTooLarge', 'error.invalidInput', 'error.preparationFailed',
  'error.analysisIncomplete', 'error.componentUnavailable', 'error.localResultsKept', 'error.unknown',
  'trace.heading', 'trace.explanation', 'trace.mode.mocked', 'trace.mode.live', 'trace.mode.mockedNote',
  'trace.mode.liveNote', 'trace.label.input', 'trace.label.decision', 'trace.label.task', 'trace.label.toolCalls',
  'trace.label.result', 'trace.label.cleanup', 'trace.cleanupStatus.deleted', 'trace.cleanupStatus.failed',
  'trace.cleanupStatus.unconfirmed',
  'session.endButton', 'session.endDescription', 'session.endCleared', 'session.endNotCleared', 'session.endDone',
  'session.newStarted', 'session.nothingSaved',
  'cache.label', 'cache.badge', 'cache.description', 'cache.staleWarning',
  'record.sourceLabel', 'record.retrievedLabel', 'record.viewSource',
];

// Sentence-level wording that is repeated inside the notice sections must stay identical to its source key.
const NOTICE_COMPOSITION = {
  '02': ['disclosure.ctgov.body', 'disclosure.ctgov.networkNote', 'disclosure.separation'],
  '03': ['disclosure.openai.body', 'disclosure.openai.conditionTerm', 'disclosure.openai.account', 'disclosure.openai.neverSent', 'disclosure.openai.studyContacts'],
  '04': ['disclaimer.notAnonymous', 'disclaimer.notPhiReady', 'disclaimer.noComplianceClaim'],
  '05': ['disclosure.agentsRetention', 'disclosure.agentsTracing', 'disclosure.agentsInterrupted', 'disclosure.cannotRetract'],
  '06': ['disclosure.decisionsRetention', 'disclosure.abuseMonitoring', 'disclosure.noTraining'],
  '07': ['disclosure.credentials'],
  '09': ['disclosure.limits'],
  '10': ['consent.expiryNote', 'consent.resendNote', 'consent.invalidationNote'],
  '11': ['disclaimer.persistent', 'disclaimer.scoreMeaning', 'disclaimer.distance', 'disclaimer.unknownEligibility', 'disclaimer.aiOutput', 'disclaimer.participationDraftOnly'],
  '12': ['operator.name', 'operator.privacyContact', 'operator.noticeOnly', 'operator.noRecordLookup'],
};

test('strings.en.json: every value is a non-empty plain string', () => {
  const problems = [];
  for (const [key, value] of Object.entries(strings)) {
    if (typeof value !== 'string') problems.push(`${key}: not a string`);
    else if (value.trim() === '') problems.push(`${key}: empty`);
    else if (value !== value.trim()) problems.push(`${key}: leading or trailing whitespace`);
    else if (!/^[\x20-\x7E]+$/.test(value)) problems.push(`${key}: only printable ASCII on one line is allowed`);
    else if (/<[a-z/!][^>]*>/i.test(value) || /&[a-z]+;|&#\d+;/i.test(value)) problems.push(`${key}: contains HTML`);
    else if (/\b(?:sk-[A-Za-z0-9_-]{8,}|postgres(?:ql)?:\/\/)/i.test(value)) problems.push(`${key}: looks like a secret`);
    if (typeof value === 'string') {
      for (const token of value.match(/\{[^}]*\}|[{}]/g) ?? []) {
        if (!/^\{[a-z][a-zA-Z0-9]*\}$/.test(token)) problems.push(`${key}: malformed placeholder ${token}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('strings.en.json: keys are unique, namespaced, and stable in shape', () => {
  const lines = rawStrings.split('\n').map(l => l.match(/^\s*"((?:[^"\\]|\\.)*)"\s*:/)).filter(Boolean).map(m => m[1]);
  assert.equal(lines.length, Object.keys(strings).length, 'a key appears more than once or is not on its own line');
  const problems = [];
  for (const key of Object.keys(strings)) {
    const bare = key.startsWith('_todo.') ? key.slice('_todo.'.length) : key;
    if (!KEY_PATTERN.test(bare)) problems.push(`${key}: does not match the key pattern`);
    else if (!NAMESPACES.has(bare.split('.')[0])) problems.push(`${key}: unknown namespace (document it in README.md and NAMESPACES)`);
  }
  assert.deepEqual(problems, []);
});

test('strings.en.json: required keys exist', () => {
  const missing = REQUIRED_KEYS.filter(key => !(key in strings));
  assert.deepEqual(missing, []);
});

test('strings.en.json: notice sections are numbered 01..N with a heading and a body each', () => {
  const found = new Map();
  for (const key of Object.keys(strings)) {
    const m = SECTION_KEY.exec(key);
    if (m) found.set(m[1], new Set([...(found.get(m[1]) ?? []), m[2]]));
  }
  const numbers = [...found.keys()].sort();
  assert.ok(numbers.length >= 12, 'expected at least twelve notice sections');
  numbers.forEach((n, i) => assert.equal(n, String(i + 1).padStart(2, '0'), 'section numbers must be contiguous from 01'));
  for (const n of numbers) assert.deepEqual([...found.get(n)].sort(), ['body', 'heading'], `section ${n}`);
});

test('strings.en.json: todo keys point at an existing key and start with TODO', () => {
  const problems = [];
  for (const [key, value] of Object.entries(strings)) {
    if (!key.startsWith('_todo.')) continue;
    if (!(key.slice('_todo.'.length) in strings)) problems.push(`${key}: target key does not exist`);
    if (!value.startsWith('TODO:')) problems.push(`${key}: must start with "TODO:"`);
  }
  assert.deepEqual(problems, []);
});

// Opt-in gate for a release build: RELEASE=1 node --test core/strings/claims.test.mjs
test('release check: no open TODO keys remain', {skip: process.env.RELEASE === '1' ? false : 'set RELEASE=1 to enforce before a release'}, () => {
  const open = Object.keys(strings).filter(key => key.startsWith('_todo.'));
  assert.deepEqual(open, []);
});

test('strings.en.json: required wording is present exactly', () => {
  assert.equal(strings['disclaimer.persistent'], 'Research information, not medical advice.');
  assert.equal(strings['operator.name'], 'Kurt Lehnardt - Developer of Treatable');
  assert.equal(strings['operator.privacyContact'], 'privacy.6vpc5@mailer.me');
  assert.equal(strings['trace.mode.mocked'], 'Mocked');
  assert.equal(strings['trace.mode.live'], 'Live');
  assert.match(strings['disclaimer.scoreMeaning'], /not a probability of eligibility, enrollment, or treatment benefit/);
  assert.match(strings['disclaimer.distance'], /not medical exclusions/);
  assert.match(strings['disclaimer.unknownEligibility'], /stays marked unknown/);
  assert.match(strings['disclaimer.participationDraftOnly'], /drafts that you review/);
  for (const action of ['submit applications', 'email researchers', 'enroll you', 'clinical screening', 'sign consent']) {
    assert.ok(strings['disclaimer.participationDraftOnly'].includes(action), action);
  }
  assert.match(strings['disclaimer.aiOutput'], /can be wrong or incomplete/);
  assert.match(strings['disclaimer.notPhiReady'], /^Not PHI-ready\./);
  assert.match(strings['disclaimer.notPhiReady'], /does not verify a BAA/);
  assert.match(strings['disclaimer.notAnonymous'], /^Minimized health information is not anonymous\.$/);
  assert.match(strings['notice.acknowledgmentLabel'], /^I have read this notice/);
  assert.match(strings['consent.confirmLabel'], /^I reviewed this exact request and I confirm sending it to OpenAI/);
  assert.match(strings['consent.previewHeading'], /^Exact request preview$/);
  assert.match(strings['credential.noFallback'], /no plaintext fallback/);
  assert.match(strings['credential.lockedWithoutKey'], /stay locked/);
  assert.match(strings['disclosure.credentials'], /operating system's credential system/);
  for (const limit of ['malware', 'administrator access', 'compromised operating system', 'privileged debuggers', 'memory forensics']) {
    assert.ok(strings['disclosure.limits'].includes(limit), limit);
  }
});

test('strings.en.json: OpenAI provider retention wording is complete and sourced from the contract record', () => {
  const agents = strings['disclosure.agentsRetention'];
  assert.match(agents, /retains session state until the session is deleted/);
  assert.match(agents, /not compatible with Zero Data Retention/);
  assert.match(agents, /data residency only in the United States/);
  assert.match(agents, /attempts to cancel .* delete the session\./);
  assert.match(agents, /While Treatable is running, it shows whether deletion failed/);
  assert.match(agents, /physical cleanup may continue/);
  assert.match(agents, /does not promise instant physical erasure/);
  const tracing = strings['disclosure.agentsTracing'];
  assert.match(tracing, /records a trace of each Agents session by default/);
  assert.match(tracing, /inputs sent to the model, the tool calls and results, and the model's output/);
  assert.match(tracing, /can see these traces in OpenAI's dashboard/);
  assert.match(tracing, /API keys with trace or agents read permission for that project can export them/);
  assert.match(tracing, /does not describe a way to turn this off for a session/);
  assert.match(tracing, /does not say whether deleting the session removes its trace/);
  const interrupted = strings['disclosure.agentsInterrupted'];
  assert.match(interrupted, /closed, crashes, is stopped by the operating system, or loses power or its connection/);
  assert.match(interrupted, /cannot delete that session afterwards and cannot tell you about it later/);
  assert.match(interrupted, /stays in your OpenAI project until you delete it there/);
  assert.match(strings['disclosure.decisionsRetention'], /no stored application state .* other than prompt caching/);
  const abuse = strings['disclosure.abuseMonitoring'];
  assert.match(abuse, /abuse-monitoring logs, which can include prompts and responses/);
  assert.match(abuse, /up to 30 days by default for Decisions and Agents requests/);
  assert.match(abuse, /or longer when required by law or when OpenAI considers it reasonably necessary to protect its services or others from harm/);
  assert.match(abuse, /does not say that deleting an Agents session removes these logs/);
  const training = strings['disclosure.noTraining'];
  assert.match(training, /not used to train its models unless the account holder has opted in to share data with OpenAI/);
  assert.match(training, /cannot see whether your OpenAI organization has opted in/);
  assert.match(strings['disclosure.cannotRetract'], /cannot take back data that was already sent/);
  assert.match(strings['consent.resendNote'], /temporary rate limit, an overload, or a server error, Treatable may send the same Decisions request a second time, unchanged/);
  // "Trace" has two meanings: the app's session-only trace, and OpenAI's trace of an Agents session.
  const providerTrace = /OpenAI's trace of the session, or its abuse-monitoring log entries, may remain after deletion\./;
  assert.match(strings['trace.cleanupStatus.deleted'], providerTrace);
  assert.match(strings['session.endDescription'], providerTrace);
  assert.match(strings['session.endDescription'], /the session-only trace from the app/);
});

test('strings.en.json: ClinicalTrials.gov and OpenAI disclosures stay separate and complete', () => {
  const ct = strings['disclosure.ctgov.body'];
  assert.match(ct, /words you type to search/);
  assert.match(ct, /including any symptoms/);
  assert.match(ct, /web address \(URL\)/);
  assert.match(ct, /at most a US state/);
  assert.match(ct, /over HTTPS/);
  assert.match(ct, /clinicaltrials\.gov/);
  assert.match(ct, /Do not type names or other identifying details/);
  assert.match(ct, /policies apply/);
  assert.match(ct, /does not include your ZIP code or coordinates/);
  const allowedToOpenAi = strings['disclosure.openai.body'];
  for (const item of ['condition term', 'age band', 'US state if you chose to share it', 'sex if you chose to share it', 'public study fields']) {
    assert.ok(allowedToOpenAi.includes(item), `OpenAI allowed item: ${item}`);
  }
  const never = strings['disclosure.openai.neverSent'];
  for (const item of ['free-text symptoms or notes', 'ZIP codes', 'coordinates', 'exact age', 'date of birth', 'your name', 'your contact details']) {
    assert.ok(never.includes(item), `OpenAI never-sent item: ${item}`);
  }
  assert.match(strings['disclosure.openai.account'], /under your own OpenAI API key, so OpenAI can link them to your OpenAI account/);
  assert.match(strings['disclosure.openai.account'], /OpenAI also sees your network address/);
  assert.match(strings['disclosure.openai.studyContacts'], /never sent to OpenAI/);
  assert.match(strings['disclosure.openai.conditionTerm'], /the condition and MeSH terms listed on the study records your search returned\./);
  assert.match(strings['disclosure.openai.conditionTerm'], /chosen from that list, not copied from what you typed/);
  assert.match(strings['session.nothingSaved'], /^Treatable does not save your health entries, notes, searches, or profiles\. The only thing it saves is your OpenAI API key, if you choose to save one\.$/);
  // That sentence depends on the public study cache staying in memory, which task A2 still has to confirm.
  assert.match(strings['_todo.cache.description'] ?? 'session.nothingSaved', /session\.nothingSaved/);
});

test('strings.en.json: error messages cover every required failure and keep local results', () => {
  assert.match(strings['error.networkOffline'], /offline/);
  assert.match(strings['error.ctgovUnavailable'], /ClinicalTrials\.gov/);
  assert.match(strings['error.ctgovRateLimited'], /limiting requests/);
  assert.match(strings['error.openaiUnavailable'], /local results are kept/);
  assert.match(strings['error.consentExpired'], /expired/);
  assert.match(strings['error.consentInvalidated'], /changed an entry/);
  assert.match(strings['error.consentUsed'], /This operation was already sent from this prepared request/);
  assert.match(strings['error.credentialMissing'], /stay locked/);
  assert.match(strings['error.credentialLocked'], /locked or unavailable/);
  assert.match(strings['error.cancelled'], /^Cancelled\./);
  assert.match(strings['error.deletionFailed'], /Provider data may remain/);
  assert.ok(strings['error.deletionFailed'].includes(strings['operator.noRecordLookup']));
  assert.match(strings['error.requestTooLarge'], /not sent/);
  assert.match(strings['error.analysisIncomplete'], /local results are kept/);
});

test('strings.en.json: repeated wording inside notice sections matches its source key', () => {
  const problems = [];
  for (const [section, sources] of Object.entries(NOTICE_COMPOSITION)) {
    const body = strings[`notice.section.${section}.body`];
    for (const source of sources) {
      if (!body.includes(strings[source])) problems.push(`notice.section.${section}.body is missing the exact text of ${source}`);
    }
  }
  assert.equal(strings['notice.section.02.heading'], strings['disclosure.ctgov.heading']);
  assert.equal(strings['notice.section.03.heading'], strings['disclosure.openai.heading']);
  assert.match(strings['consent.expiryNote'], /^A prepared request expires after five minutes\. Decisions and Agents can each be sent once from it\.$/);
  assert.deepEqual(problems, []);
});

test('strings.en.json: the only email address is the notice-only privacy contact', () => {
  const emails = new Set();
  for (const value of Object.values(strings)) for (const m of value.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) emails.add(m[0]);
  assert.deepEqual([...emails], ['privacy.6vpc5@mailer.me']);
});

// ---------------------------------------------------------------------------------------------
// Part 2: scan
// ---------------------------------------------------------------------------------------------

// Decodes every collected file. Returns the decoded texts, the extensionless executables, and the decoding problems.
function decodeFound(found) {
  const texts = [];
  const binaries = [];
  const problems = [];
  for (const file of found.files) {
    const decoded = decodeText(readFileSync(file.full), file.rel);
    if (decoded.problem) problems.push(`${file.rel}: ${decoded.problem}`);
    else if (decoded.binary) binaries.push(`${file.rel} (${decoded.binary})`);
    else texts.push({file, text: decoded.text});
  }
  return {texts, binaries, problems};
}

// Scans every collected file and returns the hits. A file that cannot be decoded as text makes the scan throw:
// it never turns into a clean result.
function scanFound(found) {
  const {texts, problems} = decodeFound(found);
  if (problems.length > 0) {
    throw new Error(`the claims scan cannot read these files as text, so it fails closed:\n${problems.join('\n')}`);
  }
  return texts.flatMap(({file, text}) => scanText(file.rel, text, {ignoreRules: file.ignoreRules}));
}

test('claims scan: every top-level folder and docs entry is classified', () => {
  // Entries that git ignores (for example a coverage folder) are not part of the repository and need no class.
  const git = gitState(REPO_ROOT);
  const visible = (entries, prefix) => entries.filter(e => !git?.skips(`${prefix}${e.name}`, e.isDirectory));
  const rootEntries = visible(entriesOf(REPO_ROOT), '');
  const docs = rootEntries.find(e => e.isDirectory && e.name.toLowerCase() === 'docs');
  const problems = classifyTopLevel(rootEntries, docs ? visible(entriesOf(path.join(REPO_ROOT, docs.name)), `${docs.name}/`) : []);
  assert.deepEqual(problems, []);
});

test('claims scan: every file under a scan root has a known type, decodes as text, and is not a symlink', t => {
  const found = collectFiles();
  if (!found.git) t.diagnostic('git is unavailable or this is not a git work tree, so every file on disk was read');
  assert.deepEqual(found.unknown, [], 'classify these extensions in the test file (scanned, non-text, or config)');
  assert.deepEqual(found.symlinks, [], 'a symlink under a scan root hides its target from the scan: replace it with a real file');
  assert.deepEqual(found.nestedRepos, [], 'a nested repository or submodule hides its files from git and from this scan: move its files into this repository');
  assert.deepEqual(found.missingTracked, [], 'git tracks these files but the scan did not find them on disk: restore them or commit their removal');
  const {binaries, problems} = decodeFound(found);
  // An extensionless file that starts with an executable signature is a built binary. It is not scanned, but reported.
  if (binaries.length > 0) t.diagnostic(`not scanned, extensionless executable: ${binaries.join(', ')}`);
  assert.deepEqual(problems, [], 'these files are not valid UTF-8, or UTF-16 with a byte order mark: convert them to UTF-8');
});

test('claims scan: pinned legacy root files are listed by SHA-256 digest only', () => {
  for (const [name, digest] of Object.entries(LEGACY_ROOT_FILE_DIGESTS)) {
    assert.match(digest, /^[0-9a-f]{64}$/, name);
    assert.ok(!['README.md', 'install-linux.sh', 'install-macos.sh'].includes(name), `${name} scans clean and must stay in the scan`);
  }
});

test('claims scan: exemptions are exact, justified, and limited to test and fixture paths', () => {
  assert.deepEqual(validateExemptions(EXEMPT_FILES, rel => existsSync(path.join(REPO_ROOT, rel))), []);
});

test('claims scan: shipped strings and docs make no banned compliance, security, anonymity, or validity claims', () => {
  const found = collectFiles();
  const relative = found.files.map(f => f.rel);
  // A scan that collected nothing would pass the checks below by finding no text at all, so it must fail here.
  assert.ok(found.files.length > 0, 'an empty scan must fail the check, not pass it');
  assert.ok(relative.includes('core/strings/strings.en.json'), 'the strings file must be in the scan');
  assert.ok(relative.includes('core/strings/README.md'), 'the strings README must be in the scan');
  assert.ok(!relative.includes('core/strings/claims.test.mjs'), 'the rule definitions file must not be scanned');
  assert.deepEqual(scanFound(found), []);
});

// ---------------------------------------------------------------------------------------------
// Part 3: self-test of the scanner
// ---------------------------------------------------------------------------------------------

test('self-test: each banned pattern is caught on its samples', () => {
  const misses = [];
  for (const rule of RULES) {
    for (const sample of rule.bad) {
      const hits = scanText('sample.md', sample).filter(h => h.endsWith(`[${rule.id}]`));
      if (hits.length === 0) misses.push(`${rule.id}: not caught: ${JSON.stringify(sample)}`);
    }
  }
  assert.deepEqual(misses, []);
});

test('self-test: each allowed negation and mechanism name passes', () => {
  const falseAlarms = [];
  for (const rule of RULES) {
    for (const sample of rule.ok) {
      const hits = scanText('sample.md', sample);
      if (hits.length > 0) falseAlarms.push(`${rule.id}: wrongly flagged: ${JSON.stringify(sample)} -> ${hits.join(', ')}`);
    }
  }
  for (const name of MECHANISM_NAMES) {
    for (const sample of name.ok) {
      const hits = scanText('sample.md', sample);
      if (hits.length > 0) falseAlarms.push(`${name.id}: wrongly flagged: ${JSON.stringify(sample)} -> ${hits.join(', ')}`);
    }
    for (const sample of name.bad) {
      if (scanText('sample.md', sample).length === 0) falseAlarms.push(`${name.id}: mechanism allowance is too wide: ${JSON.stringify(sample)}`);
    }
  }
  assert.deepEqual(falseAlarms, []);
});

test('self-test: negation does not leak across sentences or unrelated words', () => {
  // A negator earlier in the paragraph must not excuse a later claim.
  assert.ok(scanText('s.md', 'This is not a diagnosis. The data is anonymous.').length > 0);
  assert.ok(scanText('s.md', 'We do not hide it, we guarantee it.').length > 0);
  assert.ok(scanText('s.md', 'It is not only PHI-ready but safe.').length > 0);
  assert.ok(scanText('s.md', 'It is not fully PHI-ready.').length > 0, 'fully is not a filler word');
  // A negator is not skipped by a comma, and a list excuses only its first item.
  assert.ok(scanText('s.md', 'No, the app is certified.').length > 0);
  assert.ok(scanText('s.md', 'It is not anonymous, certified, or approved.').some(h => h.includes('[certified]')));
  // Absolute claims are never excused by a negator.
  assert.ok(scanText('s.md', 'It is not true that nothing leaves your device.').length > 0);
  assert.ok(scanText('s.md', 'This is not secure.').length > 0);
  // A paragraph break ends the sentence; a single hard line break does not.
  assert.ok(scanText('s.md', 'This is not a claim.\n\nThe app is PHI-ready.').length > 0);
  assert.deepEqual(scanText('s.md', 'The app is not\nHIPAA\ncompliant.'), []);
});

test('self-test: look-alike characters, markup, and entities do not hide a phrase', () => {
  const disguised = [
    `HIPAA${cp(0x2011)}compliant`, `HIPAA${cp(0xa0)}compliant`, `HIPAA${cp(0x202f)}compliant`, `HIPAA${cp(0x2010)}compliant`, `HIPAA${cp(0x2212)}compliant`,
    `HIPAA com${cp(0xad)}pliant`, `HIPAA compli${cp(0x200b)}ant`, `HIPAA compli${cp(0x200d)}ant`, `HIPAA compliant${cp(0xfeff)}`, 'HIPAA&nbsp;compliant',
    'HIPAA&#8209;compliant', 'HIPAA&#x2011;compliant', '**HIPAA** **compliant**', 'HIPAA _compliant_', '__secure__',
    `${cp(0xff28)}IPAA compliant`, `HIPAA${cp(0x2003)}compliant`, `It is ${cp(0x201c)}anonymous${cp(0x201d)}.`, 'Not secur&#101;.',
  ];
  const misses = disguised.filter(sample => scanText('s.md', sample).length === 0);
  assert.deepEqual(misses, []);
  assert.deepEqual(scanText('s.md', `Not PHI${cp(0x2011)}ready.`), [], 'a negated look-alike phrase still passes');
  assert.deepEqual(scanText('s.md', 'Use FLAG_SECURE and kSecAttrAccessible.'), [], 'underscores inside names are untouched');
  assert.ok(scanText('s.md', '<!-- Your data is anonymous -->').length > 0, 'HTML comment text is still scanned');
});

test('self-test: source code keywords are legal, string literals and comments are scanned', () => {
  const ts = [
    'export class Store {',
    '  private readonly items = new Map<string, string>();',
    '  private encrypted = false;',
    '  private async load(): Promise<void> {}',
    '}',
  ].join('\n');
  assert.deepEqual(scanText('a.ts', ts), []);
  const swift = 'private let key = "ok"\nprivate(set) var count = 0\nprivate func go() {}\n';
  assert.deepEqual(scanText('a.swift', swift), []);
  const kotlin = 'private const val NAME = "Treatable"\nprivate suspend fun go() {}\n';
  assert.deepEqual(scanText('a.kt', kotlin), []);
  const csharp = 'private string name;\nprivate static readonly int Size = 1;\n';
  assert.deepEqual(scanText('a.cs', csharp), []);
  assert.ok(scanText('a.ts', 'const s = "Your private profile";').length > 0);
  assert.ok(scanText('a.swift', 'let s = "Your data is anonymous"').length > 0);
  assert.ok(scanText('a.kt', '// This screen is secure.\nval x = 1').length > 0);
  assert.ok(scanText('a.cs', '/* guaranteed erasure */ int x;').length > 0);
  assert.ok(scanText('a.ts', 'const t = `HIPAA compliant\nmultiline`;').length > 0);
  assert.ok(scanText('a.swift', 'let s = """\nNothing leaves your device\n"""').length > 0);
  assert.deepEqual(scanText('a.ts', "import * as SecureStore from 'expo-secure-store';"), []);
});

test('self-test: a regular expression literal with quote characters does not desync the string scan', () => {
  const ts = "class A {\n  private re = /[\"']/;\n  private y = 1;\n  private z = a / b;\n}\n";
  assert.deepEqual(scanText('a.ts', ts), []);
  assert.ok(scanText('a.ts', 'const re = /["\']/;\nconst s = "Your data is anonymous";').length > 0);
  assert.ok(scanText('a.ts', 'const half = total / 2; const s = "Your data is anonymous";').length > 0);
});

test('self-test: JSX child text is scanned and ordinary TypeScript is not mistaken for it', () => {
  assert.ok(scanText('a.tsx', 'export const A = () => <Text>Your data is secure</Text>;').length > 0);
  assert.ok(scanText('a.tsx', 'const B = () => <p>We {name} guarantee it</p>;').length > 0);
  assert.ok(scanText('a.jsx', 'const C = () => (<div><b>Fine</b> HIPAA compliant</div>);').length > 0);
  assert.ok(scanText('a.tsx', 'const D = () => <Button onPress={() => go()}>Anonymous results</Button>;').length > 0);
  assert.ok(scanText('a.tsx', 'const E = () => <Text style={s}>{label}</Text>;').length === 0);
  const generics = 'class S {\n  private a = new Map<string>();\n  private b: Array<string> = [];\n  private c = useState<string>("");\n}\n';
  assert.deepEqual(scanText('a.tsx', generics), []);
  assert.deepEqual(scanText('a.tsx', 'const F = () => <Text>Research information, not medical advice.</Text>;'), []);
});

test('self-test: JSX closing tags and self-closing tags do not hide a string', () => {
  const cases = [
    '<Text>{a}</Text><Text accessibilityLabel="Your data is anonymous">x</Text>',
    '<Row><Text>{a}</Text><Button title="Encrypted and secure" /></Row>',
    '<Text>{a}</Text>\n<Button title="Encrypted and secure" />',
    '<Text style={s} /><Text accessibilityLabel="Your data is anonymous">x</Text>',
    'const x = a </b/; const s = "Your data is anonymous";',
    '<Text>We keep it simple; it is anonymous</Text>',
    '<Text>Total = anonymous</Text>',
    '<Text>We say {x}; it is anonymous</Text>',
  ];
  for (const ext of ['tsx', 'jsx', 'js']) {
    for (const c of cases) assert.ok(scanText(`App.${ext}`, c).length > 0, `${ext}: ${c}`);
  }
  // A plain TypeScript division and a regular expression still behave.
  assert.deepEqual(scanText('a.ts', 'const half = a / b; const re = /["\']/g; const ok = "Research information, not medical advice.";'), []);
  assert.deepEqual(scanText('a.ts', 'const f = x => /["\']/.test(x);'), []);
  assert.ok(scanText('a.ts', 'const f = x => /["\']/.test(x); const s = "Your data is anonymous";').length > 0);
});

test('self-test: JSON keys and values are scanned, the package private flag is not', () => {
  assert.deepEqual(scanText('package.json', '{"name":"core","private":true,"dependencies":{"expo-secure-store":"~14.0.0"}}'), []);
  assert.ok(scanText('package.json', '{"description":"A secure app"}').length > 0);
  assert.ok(scanText('x.xcstrings', '{"strings":{"Your data is anonymous":{}}}').length > 0);
  assert.ok(scanText('package.json', '{"private":"yes"}').length > 0);
  assert.ok(scanText('app.json', '{"anonymous": true}').length > 0, 'a key with a non-string value is scanned');
  assert.ok(scanText('app.json', '{"private": {"a": 1}}').length > 0);
  assert.deepEqual(scanText('bad.json', '{ not json: Not PHI-ready }'), []);
  assert.ok(scanText('bad.json', '{ not json: PHI-ready }').length > 0);
});

test('self-test: markdown code fences may show the private keyword, prose may not', () => {
  assert.deepEqual(scanText('a.md', 'Use this:\n\n```ts\nprivate readonly x = 1;\n```\n\nAlso `private` is a keyword.\n'), []);
  assert.ok(scanText('a.md', 'A private profile.\n\n```ts\nprivate x = 1;\n```\n').length > 0);
  assert.ok(scanText('a.md', '```ts\nconst s = "Your data is anonymous";\n```\n').length > 0, 'other rules still apply inside fences');
});

test('self-test: prose file types are scanned in full', () => {
  for (const file of [
    'a.xaml', 'a.ui', 'a.blp', 'a.iss', 'a.isl', 'a.desktop', 'a.plist', 'a.xml', 'a.strings', 'a.stringsdict', 'a.resx', 'a.resw',
    'a.wxs', 'a.wxl', 'a.appxmanifest', 'a.html', 'a.txt', 'a.rtf', 'a.po', 'a.pot', 'a.in', 'a.spec', 'a.yml', 'a.yaml', 'a.sh',
    'a.ps1', 'a.py', 'a.mdx', 'control', 'copyright',
  ]) {
    assert.ok(scanText(file, 'Comment=Your private data is anonymous').length >= 2, file);
    assert.deepEqual(scanText(file, 'Comment=Research information, not medical advice.'), [], file);
  }
});

test('self-test: file types are classified, and an unknown type is reported rather than skipped', () => {
  for (const f of ['a.md', 'a.json', 'a.ts', 'a.mjs', 'a.tsx', 'a.swift', 'a.kt', 'a.cs', 'a.xaml', 'a.ui', 'a.blp', 'a.iss', 'a.desktop', 'a.plist', 'a.xml', 'a.yml', 'a.sh', 'a.py', 'a.rs', 'a.java', 'a.kts', 'a.c', 'a.h', 'a.vala', 'a.resw', 'a.isl', 'a.wxs', 'a.wxl', 'a.appxmanifest', 'a.po', 'a.pot', 'a.in', 'a.spec', 'a.stringsdict', 'a.mdx', 'a.ps1', 'debian/control']) {
    assert.notEqual(classifyFile(f), 'skip', f);
    assert.notEqual(classifyFile(f), 'unknown', f);
  }
  for (const f of ['a.png', 'a.ttf', 'a.exe', 'a.deb', 'a.sln', 'package-lock.json', '.DS_Store', 'x/.gitignore', '.git']) assert.equal(classifyFile(f), 'skip', f);
  for (const f of ['a.csproj', 'a.vbproj', 'a.pbxproj', 'a.xcconfig', 'a.props', 'a.targets', 'a.toml', 'a.properties']) assert.equal(classifyFile(f), 'config', f);
  for (const f of ['a.zzz', 'a.frobnicate', '.mysterydotfile']) assert.equal(classifyFile(f), 'unknown', f);
});

test('self-test: build output and dependency directories are ignored by path, source folders are not', () => {
  for (const dir of [
    'node_modules', 'core/node_modules', 'desktop-helper/node_modules', 'core/dist', 'core/build', 'desktop-helper/dist', 'desktop-helper/coverage',
    'mobile/dist', 'mobile/.expo', 'mobile/ios/Pods', 'mobile/ios/build', 'mobile/android/.gradle', 'mobile/android/app/build', 'macos/.build',
    'macos/Treatable/DerivedData', 'macos/build', 'windows/Treatable/bin', 'windows/Treatable/obj', 'windows/src/App/bin', 'linux/builddir',
    'linux/_build', 'linux/.flatpak-builder', 'core/.git',
  ]) assert.equal(isIgnoredDirectory(dir), true, dir);
  for (const dir of [
    'desktop-helper/bin', 'core/src/build', 'core/src/dist', 'core/bin', 'core/obj', 'mobile/src/build', 'linux/bin', 'macos/bin',
    'docs/apps', 'core/strings', 'core/src/coverage',
  ]) assert.equal(isIgnoredDirectory(dir), false, dir);
});

test('self-test: top-level folders and docs entries must be classified', () => {
  const dir = name => ({name, isDirectory: true, isFile: false});
  assert.deepEqual(classifyTopLevel([dir('core'), dir('Mobile'), dir('MACOS'), dir('docs'), dir('extension'), dir('.git')], [dir('apps'), dir('implementation')]), []);
  assert.equal(classifyTopLevel([dir('ios')], []).length, 1);
  assert.equal(classifyTopLevel([dir('android')], []).length, 1);
  assert.equal(classifyTopLevel([dir('core')], [dir('plans')]).length, 1);
  assert.equal(classifyTopLevel([dir('core')], [{name: 'NOTES.md', isDirectory: false, isFile: true}]).length, 1);
});

test('self-test: the scan roots cover the shared code, the mobile app, the desktop shells, and the app docs', () => {
  // Platforms that do not exist yet are in this list on purpose, so their files are scanned from the first day
  // someone adds the folder. Removing a root must be a decision visible in this test, not a silent gap.
  assert.deepEqual([...SCAN_ROOT_DIRS], ['core', 'desktop-helper', 'mobile', 'macos', 'windows', 'linux']);
  assert.equal(DOCS_SCAN_DIR, 'apps');
});

test('self-test: exemptions are accepted only for justified test and fixture paths with named rules', () => {
  const exists = () => true;
  const good = {path: 'core/test/fixtures/ctgov-real.json', reason: 'Recorded public registry response with sponsor wording.', rules: ['certified']};
  assert.deepEqual(validateExemptions([good], exists), []);
  assert.equal(validateExemptions([{...good, path: 'core/lib/strings.ts'}], exists).length, 1);
  assert.ok(validateExemptions([{...good, path: 'core/strings/fixtures/a.json'}], exists).length > 0);
  assert.ok(validateExemptions([{...good, path: 'docs/apps/fixtures/a.md'}], exists).length > 0);
  assert.ok(validateExemptions([{...good, path: 'mobile/test/readme.md'}], exists).length > 0);
  assert.ok(validateExemptions([{...good, reason: 'ok'}], exists).length > 0);
  assert.ok(validateExemptions([{path: 'core/test/*.json', reason: good.reason, rules: good.rules}], exists).length > 0);
  assert.ok(validateExemptions([good], () => false).length > 0);
  assert.ok(validateExemptions([{path: good.path, reason: good.reason}], exists).length > 0, 'rules are required');
  assert.ok(validateExemptions([{...good, rules: []}], exists).length > 0, 'rules may not be empty');
  assert.ok(validateExemptions([{...good, rules: ['no-such-rule']}], exists).length > 0, 'rule ids must exist');
  // Shipped source folders: only inside test/ or __tests__/.
  assert.ok(validateExemptions([{...good, path: 'core/src/fixtures/ctgov.json'}], exists).length > 0);
  assert.ok(validateExemptions([{...good, path: 'mobile/assets/fixtures/ctgov.json'}], exists).length > 0);
  assert.ok(validateExemptions([{...good, path: 'core/src/x.test.ts'}], exists).length > 0);
  assert.deepEqual(validateExemptions([{...good, path: 'core/src/__tests__/x.test.ts'}], exists), []);
  assert.deepEqual(validateExemptions([{...good, path: 'core/src/test/x.ts'}], exists), []);
});

test('self-test: an approved exemption silences only the named rules', () => {
  const text = 'A certified tool. Your data is anonymous.';
  assert.equal(scanText('t.md', text).length, 2);
  const hits = scanText('t.md', text, {ignoreRules: new Set(['certified'])});
  assert.equal(hits.length, 1);
  assert.match(hits[0], /\[anonymity\]/);
});

test('self-test: project and build files are scanned for wording but may use the word private as a keyword', () => {
  assert.deepEqual(scanText('App.csproj', '<ItemGroup><Reference Include="X"><Private>True</Private></Reference></ItemGroup>'), []);
  assert.deepEqual(scanText('project.pbxproj', 'name = "Private Headers";\nINFOPLIST_KEY_CFBundleDisplayName = Treatable;'), []);
  assert.ok(scanText('project.pbxproj', 'INFOPLIST_KEY_NSHumanReadableCopyright = "Your data is anonymous";').length > 0);
  assert.ok(scanText('App.csproj', '<Description>HIPAA compliant study finder</Description>').length > 0);
  assert.ok(scanText('Directory.Build.props', '<Product>A secure app</Product>').length > 0);
  assert.ok(scanText('x.xcconfig', 'INFOPLIST_KEY_NSFaceIDUsageDescription = Fully anonymous results').length > 0);
  assert.ok(scanText('gradle.properties', 'app.tagline=Nothing leaves your device').length > 0);
  assert.ok(scanText('Cargo.toml', 'description = "Guaranteed deletion"').length > 0);
});

test('self-test: git output is parsed, and only ignored paths with nothing tracked under them are skipped', () => {
  assert.deepEqual(parseGitFileList('core/a.ts\0mobile/b.tsx\0'), ['core/a.ts', 'mobile/b.tsx']);
  assert.deepEqual(parseGitIndex('100644 0123abcd 0\tcore/a b.ts\x00160000 4567cdef 0\twindows\x00'), [
    {mode: '100644', path: 'core/a b.ts'}, {mode: '160000', path: 'windows'},
  ]);
  const tracked = [{mode: '100644', path: 'mobile/screens/Home.tsx'}, {mode: '100644', path: 'core/Résumé.md'}, {mode: '100644', path: 'core/build/keep.json'}];
  const ignored = ['core/.env', 'core/dist/', 'core/build/out.js'];
  const nfd = p => p.normalize('NFD');
  const folded = makeGitView({tracked, ignored, ignoreCase: true});
  assert.equal(folded.isTracked('mobile/Screens/home.tsx'), true, 'a case-only rename is still the tracked file');
  assert.equal(folded.isTracked(nfd('core/Résumé.md')), true, 'a decomposed name is still the tracked file');
  assert.equal(folded.skips('core/.env', false), true);
  assert.equal(folded.skips('core/.ENV', false), true);
  assert.equal(folded.skips('core/dist', true), true);
  assert.equal(folded.skips('core/dist/a.js', false), true);
  assert.equal(folded.skips('core/build', true), false, 'a folder with a tracked file inside is walked');
  assert.equal(folded.skips('core/build/out.js', false), true);
  assert.equal(folded.skips('core/distribution.md', false), false);
  assert.equal(folded.skips('core/untracked.md', false), false, 'an untracked file that git does not ignore is scanned');
  assert.equal(folded.skips('mobile/screens/Home.tsx', false), false);
  const exact = makeGitView({tracked, ignored, ignoreCase: false});
  assert.equal(exact.skips('core/.ENV', false), false, 'a case-sensitive repository compares case, so a differently cased file is scanned');
  assert.equal(exact.isTracked('mobile/Screens/home.tsx'), false);
  assert.equal(exact.isTracked(nfd('core/Résumé.md')), true);
});

// Temporary git repositories for the file-selection self-tests. Hooks and signing are turned off for these commands.
const GIT_SKIP = (() => {
  try {
    execFileSync('git', ['--version'], {stdio: 'ignore'});
    return false;
  } catch {
    return 'git is not installed, so the scan reads every file and these cases cannot arise';
  }
})();

function runGit(cwd, args) {
  const config = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Claims scan self-test', '-c', 'user.email=claims-scan@example.invalid'];
  return execFileSync('git', [...config, ...args], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
}

function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(full), {recursive: true});
    writeFileSync(full, content);
  }
}

function tempRepo(t, files) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'treatable-claims-')));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  runGit(dir, ['init', '-q']);
  writeFiles(dir, files);
  runGit(dir, ['add', '-A']);
  runGit(dir, ['commit', '-q', '--no-verify', '-m', 'Self-test fixture']);
  return dir;
}

// Renames through a temporary name, so that a case-only rename also works on a case-insensitive file system.
function renameCase(dir, from, to) {
  renameSync(path.join(dir, from), path.join(dir, `${to}.rename-tmp`));
  renameSync(path.join(dir, `${to}.rename-tmp`), path.join(dir, to));
}

const hitFiles = hits => new Set(hits.map(h => h.slice(0, h.indexOf(': "')).normalize('NFC').toLowerCase()));
const CLAIM_TSX = 'export const A = () => <Text>Your data is anonymous</Text>;\n';
const CLAIM_MD = 'Your data is anonymous.\n';
const CLEAN_MD = 'Research information, not medical advice.\n';

test('self-test: a case-only rename, a decomposed name, or an untracked file cannot hide a claim from the scan', {skip: GIT_SKIP}, t => {
  const decomposed = 'core/Résumé.md';
  const dir = tempRepo(t, {
    'mobile/screens/Home.tsx': CLAIM_TSX, 'NOTES.md': CLEAN_MD, [decomposed]: CLAIM_MD, '.gitignore': 'core/ignored-notes.md\n',
  });
  renameCase(dir, 'mobile/screens', 'mobile/Screens');
  renameCase(dir, 'NOTES.md', 'Notes.md');
  appendFileSync(path.join(dir, 'Notes.md'), CLAIM_MD);
  writeFiles(dir, {'core/untracked.md': CLAIM_MD, 'core/ignored-notes.md': CLAIM_MD});
  const found = collectFiles(dir);
  assert.notEqual(found.git, null, 'the temporary repository is read through git');
  const files = hitFiles(scanFound(found));
  for (const rel of ['mobile/screens/home.tsx', 'notes.md', 'core/résumé.md', 'core/untracked.md']) assert.ok(files.has(rel), rel);
  assert.ok(!files.has('core/ignored-notes.md'), 'a file that git ignores is not part of the repository');
});

test('self-test: a pinned legacy file is skipped only under its exact name and content', {skip: GIT_SKIP}, t => {
  const legacy = path.join(REPO_ROOT, 'BUILD_REPORT.md');
  if (!existsSync(legacy) || sha256(readFileSync(legacy)) !== LEGACY_ROOT_FILE_DIGESTS['BUILD_REPORT.md']) {
    t.skip('the pinned BUILD_REPORT.md is not present in this checkout');
    return;
  }
  const dir = tempRepo(t, {'BUILD_REPORT.md': readFileSync(legacy)});
  let found = collectFiles(dir);
  assert.ok(!found.files.some(f => f.rel === 'BUILD_REPORT.md'), 'the unchanged legacy file is skipped');
  assert.deepEqual(found.missingTracked, []);
  renameCase(dir, 'BUILD_REPORT.md', 'Build_Report.md');
  appendFileSync(path.join(dir, 'Build_Report.md'), CLAIM_MD);
  found = collectFiles(dir);
  assert.ok(found.files.some(f => f.rel === 'Build_Report.md'), 'a renamed legacy file is scanned');
  assert.ok(scanFound(found).some(h => h.startsWith('Build_Report.md: "anonymous"')));
});

test('self-test: a nested repository or a submodule under a scan root fails the scan', {skip: GIT_SKIP}, t => {
  const dir = tempRepo(t, {'core/a.md': CLEAN_MD});
  writeFiles(dir, {'windows/App/Main.xaml': '<Page Title="Fully anonymous" />\n'});
  const inner = path.join(dir, 'windows');
  runGit(inner, ['init', '-q']);
  runGit(inner, ['add', '-A']);
  runGit(inner, ['commit', '-q', '--no-verify', '-m', 'Inner fixture']);
  let found = collectFiles(dir);
  assert.deepEqual(found.nestedRepos, ['windows/.git']);
  assert.ok(hitFiles(scanFound(found)).has('windows/app/main.xaml'), 'the files of a nested repository are still scanned');
  // Recorded in the outer index as a submodule (a gitlink), with nothing checked out.
  runGit(dir, ['add', 'windows']);
  rmSync(inner, {recursive: true, force: true});
  mkdirSync(inner);
  found = collectFiles(dir);
  assert.deepEqual(found.nestedRepos, ['windows']);
});

test('self-test: tracked files in build folders are scanned, and a tracked file missing on disk is reported', {skip: GIT_SKIP}, t => {
  const dir = tempRepo(t, {'core/dist/strings.json': '{"tagline": "Your data is anonymous"}\n', 'core/keep.md': CLEAN_MD});
  writeFiles(dir, {'core/dist/bundle.js': 'const s = "Your data is anonymous";\n'});
  rmSync(path.join(dir, 'core', 'keep.md'));
  const found = collectFiles(dir);
  const files = hitFiles(scanFound(found));
  assert.ok(files.has('core/dist/strings.json'), 'a tracked file in a build folder is scanned');
  assert.ok(!files.has('core/dist/bundle.js'), 'untracked build output is not scanned');
  assert.deepEqual(found.missingTracked, ['core/keep.md']);
  const noGit = collectFiles(dir, null);
  assert.ok(!noGit.files.some(f => f.rel.startsWith('core/dist/')), 'without git, build folders are skipped by path');
});

test('self-test: a symlink that git does not ignore is reported', {skip: GIT_SKIP}, t => {
  const dir = tempRepo(t, {'core/a.md': CLEAN_MD, 'outside/claim.md': CLAIM_MD});
  try {
    symlinkSync(path.join('..', 'outside', 'claim.md'), path.join(dir, 'core', 'link.md'));
  } catch {
    t.skip('this file system or user cannot create symlinks');
    return;
  }
  assert.deepEqual(collectFiles(dir).symlinks, ['core/link.md']);
});

test('self-test: a read error during the scan fails the check instead of passing it', () => {
  // A file that disappears between the walk and the read (or cannot be read for any other reason) crashes the
  // scan. It is never skipped, so a missing file cannot turn into a clean result.
  const found = {files: [{full: path.join(tmpdir(), `treatable-claims-gone-${process.pid}.md`), rel: 'mobile/gone.md', ignoreRules: new Set()}]};
  assert.throws(() => scanFound(found));
});

const bytes = (...parts) => Buffer.concat(parts.map(p => (typeof p === 'string' ? Buffer.from(p, 'utf8') : Buffer.from(p))));
const utf16be = text => Buffer.from(text, 'utf16le').swap16();

test('self-test: decoding fails closed on bytes that are not valid text', () => {
  const problem = (rel, buffer) => decodeText(buffer, rel).problem;
  // Legacy code pages: each byte is invalid UTF-8 and would have been replaced by U+FFFD inside the phrase.
  assert.ok(problem('core/notice.txt', bytes('We are HIPAA', [0xa0], 'compliant.\n')), 'Latin-1 no-break space');
  assert.ok(problem('core/s.resx', bytes('<data>Fully anony', [0xad], 'mous</data>\n')), 'Latin-1 soft hyphen');
  assert.ok(problem('docs/apps/x.md', bytes('We are HIPAA', [0x96], 'compliant.\n')), 'Windows-1252 en dash');
  // NUL bytes without a byte order mark, in a text file or in an extensionless file that is not an executable.
  assert.ok(problem('core/n.txt', Buffer.from('Your data is anonymous.', 'utf16le')), 'UTF-16LE without a byte order mark');
  assert.ok(problem('core/NOTICE', Buffer.from('Your data is anonymous.', 'utf16le')), 'extensionless UTF-16LE without a byte order mark');
  assert.ok(problem('core/NOTICE', bytes('MZ', [0], 'Your data is anonymous.')), 'the letters MZ alone are not a PE executable');
  assert.ok(problem('core/tool.txt', bytes([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 'Your data is anonymous.')), 'an executable signature counts only without an extension');
  // Broken UTF-16 and UTF-32 read through a UTF-16 byte order mark.
  assert.ok(problem('core/a.txt', bytes([0xff, 0xfe, 0x00, 0xd8, 0x41, 0x00])), 'a lone surrogate in UTF-16LE');
  assert.ok(problem('core/a.txt', bytes([0xfe, 0xff, 0x00, 0x41, 0x00])), 'an odd number of UTF-16BE bytes');
  assert.ok(problem('core/a.txt', bytes([0xff, 0xfe, 0, 0], Buffer.from('A\0\0\0', 'latin1'))), 'UTF-32LE is not read as UTF-16LE');
  // Text that must decode.
  assert.deepEqual(decodeText(bytes('Récupération des données, naïve café.\n'), 'core/a.md'), {text: 'Récupération des données, naïve café.\n'});
  assert.deepEqual(decodeText(bytes([0xef, 0xbb, 0xbf], 'Research information.\n'), 'core/a.md'), {text: 'Research information.\n'});
  assert.deepEqual(decodeText(bytes([0xff, 0xfe], Buffer.from('Not PHI-ready.', 'utf16le')), 'core/a.txt'), {text: 'Not PHI-ready.'});
  assert.deepEqual(decodeText(bytes([0xfe, 0xff], utf16be('Not PHI-ready.')), 'core/NOTICE'), {text: 'Not PHI-ready.'});
  // Extensionless executables are binaries, not text and not problems.
  assert.deepEqual(decodeText(bytes([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0]), 'linux/bin/treatable-helper'), {binary: 'ELF'});
  assert.deepEqual(decodeText(bytes([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1]), 'macos/helper'), {binary: 'Mach-O'});
  const pe = Buffer.alloc(0x88);
  pe.write('MZ', 0, 'latin1');
  pe.writeUInt32LE(0x80, 0x3c);
  pe.write('PE\0\0', 0x80, 'latin1');
  assert.deepEqual(decodeText(pe, 'windows/helper'), {binary: 'PE'});
});

test('self-test: a file that does not decode as text fails the scan, and decodable text is scanned', {skip: GIT_SKIP}, t => {
  const failing = {
    'core/notice.txt': bytes('We are HIPAA', [0xa0], 'compliant.\n'),
    'core/s.resx': bytes('<data>Fully anony', [0xad], 'mous</data>\n'),
    'docs/apps/x.md': bytes('We are HIPAA', [0x96], 'compliant.\n'),
  };
  for (const [rel, content] of Object.entries(failing)) {
    const dir = tempRepo(t, {'core/a.md': CLEAN_MD, [rel]: content});
    assert.throws(() => scanFound(collectFiles(dir)), new RegExp(`${rel.replace(/[.]/g, '\\.')}: not valid UTF-8`), rel);
  }
  // An extensionless UTF-16 big-endian file with a byte order mark is decoded and its claim is caught.
  const be = tempRepo(t, {'core/NOTICE': bytes([0xfe, 0xff], utf16be('Your data is anonymous.'))});
  assert.ok(hitFiles(scanFound(collectFiles(be))).has('core/notice'));
  // Clean text in every accepted form passes, and an extensionless executable is reported but not scanned.
  const ok = tempRepo(t, {
    'core/accents.md': bytes('Récupération des données: research information, not medical advice.\n'),
    'core/bom.md': bytes([0xef, 0xbb, 0xbf], CLEAN_MD),
    'windows/Strings.txt': bytes([0xff, 0xfe], Buffer.from(CLEAN_MD, 'utf16le')),
    'linux/bin/treatable-helper': bytes([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], [0, 0, 0, 0], 'Your data is anonymous.'),
  });
  const found = collectFiles(ok);
  assert.deepEqual(scanFound(found), []);
  const decoded = decodeFound(found);
  assert.deepEqual(decoded.problems, []);
  assert.deepEqual(decoded.binaries, ['linux/bin/treatable-helper (ELF)']);
});

test('self-test: a directory that cannot be read fails the scan instead of being skipped', {skip: GIT_SKIP}, t => {
  const dir = tempRepo(t, {'core/a.md': CLEAN_MD});
  const locked = path.join(dir, 'core', 'locked');
  mkdirSync(locked);
  writeFileSync(path.join(locked, 'claim.md'), CLAIM_MD);
  chmodSync(locked, 0o000);
  let error = null;
  try {
    collectFiles(dir);
  } catch (e) {
    error = e;
  }
  chmodSync(locked, 0o755);
  if (error === null) {
    // t.skip() only marks the test. It does not stop it, so the test must return here.
    t.skip('this account can read an unreadable directory (for example running as root), so the failure cannot be simulated');
    return;
  }
  assert.equal(error.code, 'EACCES', 'the walk must crash on a directory it cannot read');
});

test('self-test: a file that cannot be read fails the scan instead of being skipped', {skip: GIT_SKIP}, t => {
  const dir = tempRepo(t, {'core/a.md': CLEAN_MD, 'core/locked.md': CLAIM_MD});
  const locked = path.join(dir, 'core', 'locked.md');
  chmodSync(locked, 0o000);
  let error = null;
  try {
    scanFound(collectFiles(dir));
  } catch (e) {
    error = e;
  }
  chmodSync(locked, 0o644);
  if (error === null) {
    t.skip('this account can read an unreadable file (for example running as root), so the failure cannot be simulated');
    return;
  }
  assert.equal(error.code, 'EACCES', 'the read must crash on a file it cannot read');
});

test('self-test: a phrase split by an HTML comment is still caught', () => {
  assert.ok(scanText('a.md', 'HIPAA<!-- x -->-compliant').length > 0);
  assert.ok(scanText('a.md', 'HIPAA-<!-- -->compliant').length > 0);
  assert.ok(scanText('a.md', 'Fully anon<!-- x -->ymous.').length > 0);
  assert.ok(scanText('a.md', '<!-- Your data is anonymous -->').length > 0);
  assert.deepEqual(scanText('a.md', 'Not PHI-<!-- note -->ready.'), []);
});

test('self-test: named mechanism text passes and unnamed claims are still caught', () => {
  assert.deepEqual(scanText('a.md', 'Windows DPAPI encrypts the key for the current user.'), []);
  assert.deepEqual(scanText('a.md', 'TLS encrypts the request in transit.'), []);
  assert.deepEqual(scanText('a.md', 'Store the App Store Connect private key outside the repository.'), []);
  assert.deepEqual(scanText('a.sh', 'openssl genpkey -algorithm EC -out private.pem'), []);
  assert.ok(scanText('a.md', 'Treatable encrypts the request in transit.').length > 0);
  assert.ok(scanText('a.md', 'The preview is encrypted.').length > 0);
  assert.ok(scanText('a.md', 'Keep your private notes here.').length > 0);
  // A masked name is replaced by underscores, so a negator in front of it cannot excuse a claim behind it.
  assert.ok(scanText('a.md', 'No TLS encrypts anonymous traffic.').some(h => h.endsWith('[anonymity]')));
  assert.ok(scanText('a.md', 'Not expo-secure-store, anonymous.').some(h => h.endsWith('[anonymity]')));
  // The same allowance inside a code string, a JSON value, and a comment.
  assert.deepEqual(scanText('a.ts', "const note = 'TLS encrypts the request in transit.';"), []);
  assert.ok(scanText('a.ts', "const note = 'TLS encrypts the request and your health data.';").length > 0);
  assert.ok(scanText('a.json', '{"note": "Keychain encrypts your health entries."}').length > 0);
  assert.ok(scanText('a.kt', '// expo-secure-store holds your symptoms.\nval x = 1').length > 0);
});

test('self-test: quotes and slashes in JSX text, and language-specific literals, do not hide a string', () => {
  const jsx = [
    `<Text>Don't share names</Text><Badge label="It's anonymous" />`,
    `<Text>You're set</Text><Text accessibilityLabel="It's fully anonymous">x</Text>`,
    `<Text>Don't worry</Text><Badge title="Totally anonymous, isn't it" />`,
    `<Text>Don't worry</Text>; const s = "Your data's anonymous";`,
    `<Text>Don't worry</Text>\n<Badge label="It's anonymous" />`,
    `<Text>{a}/{b}</Text><X title="Fully anonymous" />`,
    `<Text>{count}/<B title="Fully anonymous" /></Text>`,
    `<Text>{count}/<B>{"Fully anonymous"}</B></Text>`,
    `<Text>Use "quotes</Text><X title="Fully anonymous" />`,
    '<Text>Run `npm</Text>\n<X title="Fully anonymous" />\n<Text>ok`</Text>',
    `<Text>5" screen</Text><X label={'Fully anonymous'} />`,
  ];
  for (const ext of ['tsx', 'jsx', 'js']) {
    for (const c of jsx) assert.ok(scanText(`App.${ext}`, c).length > 0, `${ext}: ${c}`);
  }
  // A keyword right before a quote still opens a string.
  assert.ok(scanText('a.js', 'function f(){return"Your data is anonymous"}').length > 0);
  assert.ok(scanText('a.ts', "import x from'./anonymous-data';").length > 0);
  // Ordinary TypeScript stays quiet: string literal types, tagged templates, and the private keyword.
  assert.deepEqual(scanText('a.ts', "type T = 'a'|'b';\nconst q = sql`select 1`;\nclass A { private x = 'ok'; }\n"), []);
  const other = [
    ['a.swift', 'let r = #"Your data is "anonymous""#'],
    ['a.swift', 'let r = ##"She said "#" and it is anonymous"##'],
    ['a.swift', 'let r = #"""\nYour data is anonymous\n"""#'],
    ['a.swift', 'Text("Don\'t")\nlet s = "Your data is anonymous"'],
    ['a.cs', 'var s = @"C:\\path\\"; var t = "Your data is anonymous";'],
    ['a.cs', 'var s = @"Say ""hi"" anonymously"; var u = 1;'],
    ['a.cs', 'var s = $@"C:\\{x}\\"; var t = "Your data is anonymous";'],
    ['a.cs', 'var s = $"{x}"; var t = "Your data is anonymous";'],
    ['a.rs', 'fn f<\'a>(x: &\'a str) -> &\'a str { "Your data is anonymous" }'],
    ['a.rs', 'let r = r#"Your data is "anonymous""#;'],
    ['a.rs', 'let c = \'"\'; let s = "Your data is anonymous";'],
    ['a.kt', 'val c = \'\\\'\'; val s = "Your data is anonymous"'],
    ['a.java', 'char c = \'"\'; String s = "Your data is anonymous";'],
    ['a.ts', 'const x = a < b ? /\'/ : 1; const s = "Your data is anonymous";'],
  ];
  for (const [file, source] of other) assert.ok(scanText(file, source).length > 0, `${file}: ${source}`);
  assert.deepEqual(scanText('a.swift', 'private let s = #"Research information, not medical advice."#\nprivate func go() {}\n'), []);
  assert.deepEqual(scanText('a.cs', 'private string p = @"C:\\temp\\"; private int n = 1;'), []);
  assert.deepEqual(scanText('a.rs', 'fn f<\'a>(x: &\'a str) -> &\'a str { x }\nstruct S<\'b> { v: &\'b str }\n'), []);
});

test('self-test: the real wording that must pass does pass', () => {
  const must = [
    'Not PHI-ready.',
    'Minimized health information is not anonymous.',
    'Treatable has not been clinically validated.',
    'Treatable does not verify a BAA.',
    'Treatable does not promise instant physical erasure.',
    'Treatable cannot guarantee that OpenAI has erased the data.',
    'Treatable makes no claim of HIPAA compliance or legal sufficiency.',
    'It is not compatible with Zero Data Retention.',
  ];
  for (const sentence of must) assert.deepEqual(scanText('s.md', sentence), [], sentence);
});
