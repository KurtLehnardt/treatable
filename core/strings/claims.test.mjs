// Dependency-free claims scan and strings contract test. Run with: node --test core/strings/claims.test.mjs
//
// Part 1 validates core/strings/strings.en.json (shape, required keys, consistency of repeated wording).
// Part 2 scans shipped strings and docs for banned compliance, security, anonymity, and validity claims.
// Part 3 proves every banned pattern is caught and every allowed negation or mechanism name passes.
//
// This file defines the banned patterns, so the scan skips this file itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
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
const NOT_OURS_ROOT_DIRS = new Set(['extension', 'scaffold', 'evals', 'installer', '.git', '.claude', '.codex', '.github', 'node_modules']);
const NOT_OURS_DOCS_ENTRIES = new Set(['implementation']);
// Root-level files from the extension era. Any other root-level file is scanned.
const LEGACY_ROOT_FILES = new Set([
  'build_report.md', 'readme.md', 'license', '.gitignore',
  'install-linux.sh', 'install-macos.sh', 'install-windows.ps1', 'install-windows.tests.ps1',
]);

// Source files: only string literals and comments are wording. Keywords and identifiers are not claims.
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.swift', '.kt', '.kts', '.cs', '.java', '.rs', '.vala', '.c', '.h', '.gradle',
]);
const REGEX_LITERAL_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const JSX_EXTENSIONS = new Set(['.tsx', '.jsx']);
const JSON_EXTENSIONS = new Set(['.json', '.xcstrings']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx']);
// Files whose whole text is wording or may carry wording.
const PROSE_EXTENSIONS = new Set([
  '.xaml', '.ui', '.blp', '.iss', '.isl', '.desktop', '.plist', '.xml', '.strings', '.stringsdict', '.resx', '.resw',
  '.wxs', '.wxl', '.appxmanifest', '.html', '.htm', '.txt', '.rtf', '.po', '.pot', '.in', '.spec', '.yml', '.yaml',
  '.sh', '.ps1', '.bat', '.cmd', '.py', '.svg', '.entitlements', '.storyboard', '.xib', '.config',
]);
// Files that are deliberately not scanned: media, binaries, archives, generated maps.
const NON_TEXT_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.bmp', '.tif', '.tiff', '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.zip', '.tar', '.gz', '.tgz', '.7z', '.jar', '.apk', '.aab', '.ipa', '.exe', '.dll', '.so', '.dylib', '.a', '.o', '.class',
  '.pdf', '.bin', '.dat', '.db', '.sqlite', '.wav', '.mp3', '.mp4', '.mov', '.keystore', '.jks', '.p12', '.mobileprovision',
  '.car', '.nib', '.mo', '.deb', '.rpm', '.pkg', '.msi', '.dmg', '.flatpak', '.blob', '.wasm', '.map',
]);
// Build and tool configuration without user-facing wording.
const CONFIG_EXTENSIONS = new Set([
  '.csproj', '.vbproj', '.sln', '.slnx', '.props', '.targets', '.pbxproj', '.xcscheme', '.xcconfig', '.properties',
  '.toml', '.lock', '.resolved', '.lockb', '.cfg', '.ini', '.conf', '.tsbuildinfo',
]);
const SKIPPED_FILE_NAMES = new Set([
  'package-lock.json', '.ds_store', '.gitkeep', '.git', '.gitignore', '.gitattributes', '.gitmodules', '.npmrc', '.nvmrc', '.editorconfig',
  '.prettierrc', '.eslintrc', '.dockerignore',
]);

// Returns 'code', 'json', 'markdown', 'prose', 'skip', or 'unknown'. An extensionless name is scanned as prose.
export function classifyFile(relPath) {
  const name = path.posix.basename(relPath).toLowerCase();
  if (SKIPPED_FILE_NAMES.has(name)) return 'skip';
  const ext = path.posix.extname(name);
  if (ext === '') return name.startsWith('.') ? 'unknown' : 'prose';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (JSON_EXTENSIONS.has(ext)) return 'json';
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (PROSE_EXTENSIONS.has(ext)) return 'prose';
  if (NON_TEXT_EXTENSIONS.has(ext) || CONFIG_EXTENSIONS.has(ext)) return 'skip';
  return 'unknown';
}

// Generated and third-party directories, as repository-relative paths. These are matched by path, not by bare name,
// so a source folder that happens to be called `bin` or `build` (for example desktop-helper/bin) is still scanned.
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
// repository-relative path with a written reason, limited to test and fixture paths. Strings and documents are never
// exempt. The list starts empty and every entry needs a reviewer's approval.
const EXEMPT_FILES = [];
const EXEMPT_PATH_PATTERN = /(?:^|\/)(?:test|tests|fixtures)\/|\.test\./;

export function validateExemptions(list, fileExists) {
  const problems = [];
  for (const entry of list) {
    const p = entry?.path;
    if (typeof p !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(p)) problems.push(`${JSON.stringify(p)}: path must be an exact repository-relative path`);
    else {
      if (!EXEMPT_PATH_PATTERN.test(p)) problems.push(`${p}: only test and fixture paths can be exempt`);
      if (/^core\/strings\//.test(p) || /^docs\//.test(p) || /\.mdx?$/.test(p)) problems.push(`${p}: strings and documents are never exempt`);
      if (!fileExists(p)) problems.push(`${p}: file does not exist`);
    }
    if (typeof entry?.reason !== 'string' || entry.reason.trim().length < 20) problems.push(`${p}: a written reason of at least 20 characters is required`);
  }
  return problems;
}

export function isExempt(relPath) {
  return EXEMPT_FILES.some(entry => entry.path === relPath);
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
  return readdirSync(dir, {withFileTypes: true}).filter(e => !e.isSymbolicLink()).map(e => ({name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile()}));
}

function findChild(dir, name) {
  return entriesOf(dir).find(e => e.isDirectory && e.name.toLowerCase() === name);
}

const toPosix = p => p.split(path.sep).join('/');

function walk(dir, found) {
  for (const entry of entriesOf(dir)) {
    const full = path.join(dir, entry.name);
    const rel = toPosix(path.relative(REPO_ROOT, full));
    if (entry.isDirectory) {
      if (!isIgnoredDirectory(rel)) walk(full, found);
    } else if (entry.isFile) {
      considerFile(full, rel, found);
    }
  }
}

function considerFile(full, rel, found) {
  if (path.resolve(full) === SELF) return;
  const kind = classifyFile(rel);
  if (kind === 'skip') return;
  if (kind === 'unknown') found.unknown.push(rel);
  else if (isExempt(rel)) found.exempt.push(rel);
  else found.files.push({full, rel});
}

function collectFiles() {
  const found = {files: [], unknown: [], exempt: []};
  const rootEntries = entriesOf(REPO_ROOT);
  for (const e of rootEntries) {
    if (e.isDirectory && SCAN_ROOT_DIRS.includes(e.name.toLowerCase())) walk(path.join(REPO_ROOT, e.name), found);
    else if (e.isFile && !LEGACY_ROOT_FILES.has(e.name.toLowerCase())) considerFile(path.join(REPO_ROOT, e.name), e.name, found);
  }
  const docs = rootEntries.find(e => e.isDirectory && e.name.toLowerCase() === 'docs');
  if (docs) {
    const apps = findChild(path.join(REPO_ROOT, docs.name), DOCS_SCAN_DIR);
    if (apps) walk(path.join(REPO_ROOT, docs.name, apps.name), found);
  }
  found.files.sort((a, b) => a.rel.localeCompare(b.rel));
  return found;
}

// A text file is read as UTF-8, or as UTF-16 when it has a byte order mark. Anything else with NUL bytes is binary.
function decode(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString('utf16le');
  if (buffer.includes(0)) return null;
  return buffer.toString('utf8');
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

// Mechanism names that are not claims. Each is blanked out (same length) before the rules run.
// Bare "secure store" and "secure storage" are not allowed: only the named platform features below.
const MECHANISM_NAMES = [
  {
    id: 'expo-secure-store',
    re: /\bexpo-secure-store\b/gi,
    ok: ['"expo-secure-store": "~14.0.0"', "import * as Store from 'expo-secure-store';"],
    bad: ['expo secure store is a secure store'],
  },
  {
    id: 'platform-secure-storage',
    re: /\b(?:platform|system|OS|operating system's|operating system)\s+secure\s+storage\b/gi,
    ok: ['Credentials use platform secure storage.', "The operating system's secure storage holds the key."],
    bad: ['Credentials are kept in secure storage.', 'a secure store', 'Your key is stored securely.'],
  },
  {
    id: 'secure-enclave',
    re: /\bSecure Enclave\b/g,
    ok: ['Apple Secure Enclave'],
    bad: ['a secure enclave for your data'],
  },
  {
    id: 'secure-context-random',
    re: /\bsecure (?:context|random)\b/gi,
    ok: ['A secure context is required.', 'Use a secure random generator.'],
    bad: ['a secure connection'],
  },
  {
    id: 'encrypted-ebs',
    re: /\bencrypted EBS\b/gi,
    ok: ['Use encrypted EBS volumes for the test instance.'],
    bad: ['encrypted storage'],
  },
];

function maskMechanismNames(text) {
  let masked = text;
  for (const {re} of MECHANISM_NAMES) masked = masked.replace(re, m => ' '.repeat(m.length));
  return masked;
}

// scope 'all' rules run on every scanned text region. scope 'prose' rules run only where the word is prose:
// markdown outside code, and string literals and comments in source files (so the `private` keyword is legal).
// Multi-word patterns use [-\s]+ so hyphens, spaces, tabs and hard-wrapped line breaks all match.
const RULES = [
  {
    id: 'compliance-label',
    re: /\b(?:HIPAA|GDPR|CCPA|HITRUST|SOC\s?2|ISO\s?27001)[-\s]+(?:complian(?:t|ce)|ready|eligible|safe|certified|approved|aligned)\b|\bcomplian(?:t|ce)\s+with\s+(?:HIPAA|GDPR|CCPA)\b|\b(?:meets?|satisf(?:y|ies)|fulfil(?:s|ls)?)\s+(?:the\s+)?(?:HIPAA|GDPR|CCPA)\b/gi,
    negatable: true,
    bad: [
      'HIPAA compliant', 'a HIPAA-ready app', 'HIPAA eligible tool', 'SOC 2 certified', 'GDPR-compliant',
      'supports HIPAA compliance', 'compliant with HIPAA', 'HIPAA-aligned', 'Meets HIPAA requirements.', 'HIPAA\ncompliant', `HIPAA${cp(0x2011)}compliant`,
    ],
    ok: [
      'Treatable is not HIPAA compliant.', 'Treatable makes no claim of HIPAA compliance or legal sufficiency.',
      'Treatable does not claim HIPAA compliance.', 'No HIPAA compliance is claimed.', 'Treatable does not meet HIPAA requirements.',
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
    re: /\bsecure(?:ly)?\b/gi,
    negatable: false,
    bad: [
      'Your data is secure.', 'a secure app', 'Secure by design', 'safe and secure', 'stored securely', 'in secure storage',
      'a secure store', 'This is not secure.',
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
    re: /\b(?:clinically[-\s]+(?:validated|proven|verified|tested|accurate|reliable|approved)|medically[-\s]+(?:validated|proven|accurate|reliable|approved|reviewed))\b/gi,
    negatable: true,
    bad: ['clinically validated', 'a clinically proven method', 'Clinically tested', 'clinically\nvalidated', 'Medically accurate matches.', 'clinically accurate'],
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
    re: /\banonym(?:ous(?:ly)?|ized|ised|ization|isation)\b/gi,
    negatable: true,
    bad: ['Your data is anonymous.', 'anonymized data', 'fully anonymous', 'Anonymised results', 'ANONYMOUS'],
    ok: ['Minimized health information is not anonymous.', 'The packet is not anonymized.', 'No anonymization is performed.'],
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
    re: /\b(?:nothing\s+(?:ever\s+)?leaves|no\s+(?:\w+\s+){0,2}(?:data|information|details)\s+(?:ever\s+)?leaves?|never\s+leaves?\s+(?:your|the|this)\s+\w+|(?:stays?|remains?)\s+(?:only\s+)?on[-\s]?(?:your\s+|the\s+|this\s+)?(?:\w+\s+)?device|stays?\s+local(?:ly)?|never\s+(?:sent|shared|uploaded|transmitted)\s+(?:anywhere|to\s+(?:anyone|any\s+server|the\s+cloud)))\b/gi,
    negatable: false,
    bad: [
      'Nothing leaves your phone.', 'no data leaves the app', 'Your data never leaves your device.', 'Everything stays on your device.',
      'No health data leaves your device.', 'Your notes never leave your device.', 'It remains on your device.',
      'Data stays on-device.', 'Everything stays local.', 'Data is processed locally and never sent anywhere.',
    ],
    ok: [
      'Searching does not send anything to OpenAI.', 'Nothing you enter is saved.', 'OpenAI features stay locked.',
      'The key stays locked until you unlock the credential system.', 'Study contact details are never sent to OpenAI.',
    ],
  },
  {
    id: 'encryption',
    re: /\bencrypt(?:s|ed|ion|ing)?\b/gi,
    negatable: true,
    bad: ['Your data is encrypted.', 'end-to-end encrypted', 'Encrypted storage', 'encrypts your data', 'End-to-end encryption'],
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
    id: 'zero-data-retention-claim',
    re: /\b(?:ZDR|Zero[-\s]+Data[-\s]+Retention)[-\s]+(?:compatible|eligible|enabled|covered|ready)\b/gi,
    negatable: true,
    bad: ['ZDR-compatible', 'Zero Data Retention eligible', 'ZDR enabled', 'Zero-Data-Retention ready'],
    ok: ['Treatable is not ZDR-compatible.', 'It is not compatible with Zero Data Retention.'],
  },
  {
    id: 'protection-claim',
    re: /\b(?:(?:your|the|all)\s+(?:\w+\s+){0,2}(?:data|information|privacy|identity)\s+(?:is|are|stays?|remains?)\s+(?:(?!not\b|never\b|no\b)\w+\s+)?(?:safe|protected|confidential)|we\s+(?:protect|safeguard)\s+your|(?:bank|enterprise)[-\s]+(?:level|grade)|no\s+one\s+can\s+(?:identify|see|access|read)|untraceable)\b/gi,
    negatable: true,
    bad: [
      'Your data is safe.', 'Your data is protected.', 'We protect your privacy.', 'Bank-level security for your data.',
      'Enterprise-grade security.', 'Searches are untraceable.', 'No one can identify you.', 'Your health information stays confidential.',
    ],
    ok: [
      'Your data is not protected against a compromised operating system.', 'Treatable cannot protect your information.',
      'Treatable does not protect your data from malware.',
    ],
  },
  {
    id: 'marketing-claims',
    re: /\b(?:privacy[-\s]+(?:first|preserving|protected|focused|friendly|safe)|(?:military|bank)[-\s]+grade|100\s*%\s+(?:private|safe|secure|accurate|anonymous)|(?:FDA|CE)[-\s]+(?:approved|cleared))\b/gi,
    negatable: true,
    bad: ['privacy-first design', 'a privacy preserving app', 'military-grade protection', 'bank grade', '100% accurate', 'Your data is 100 % safe.', 'FDA approved'],
    ok: ['Treatable is not FDA approved.', 'Treatable is not FDA cleared.'],
  },
  {
    id: 'private-prose',
    re: /\bprivate\b/gi,
    negatable: false,
    scope: 'prose',
    bad: ['Your private profile', 'Private by design', 'a private search', 'private retention', 'a private link'],
    ok: ['privacy contact', 'privately held'],
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
const REGEX_CAN_START_AFTER = /(?:[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await))\s*$/;

// Returns the text of string literals and comments in C-like source code. Keywords and identifiers
// (for example the `private` modifier or a variable named `encrypted`) are not claims, so they are dropped.
export function codeProse(text, {regexLiterals = false} = {}) {
  const out = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
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
    } else if (c === '/' && regexLiterals && (text.slice(Math.max(0, i - 16), i).trim() === '' || REGEX_CAN_START_AFTER.test(text.slice(Math.max(0, i - 16), i)))) {
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
  return out.join('\n');
}

// Text between JSX tags, which is user-facing wording but is neither a string literal nor a comment.
// The text may not contain ; = ` { } < > so that generic type arguments and ordinary code are not mistaken for it.
export function jsxText(text) {
  const out = [];
  const openTag = String.raw`<[A-Za-z][\w.:-]*(?:\s(?:[^<>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)?>`;
  for (const m of text.matchAll(new RegExp(`${openTag}([^<>{}\`;=]{1,2000})(?=[<{])`, 'g'))) out.push(m[1]);
  for (const m of text.matchAll(/\}([^<>{}`;=]{1,2000})(?=<)/g)) out.push(m[1]);
  for (const m of text.matchAll(/(?:<\/[A-Za-z][\w.:-]*\s*>|\/>)([^<>{}`;=]{1,2000})(?=[<{])/g)) out.push(m[1]);
  return out.join('\n');
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
  return out.join('\n');
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
    const prose = codeProse(text, {regexLiterals: REGEX_LITERAL_EXTENSIONS.has(ext)});
    const joined = JSX_EXTENSIONS.has(ext) ? `${prose}\n${jsxText(text)}` : prose;
    return {all: joined, prose: joined};
  }
  if (kind === 'json') {
    const strings = jsonRegions(text);
    return {all: strings, prose: strings};
  }
  if (kind === 'markdown') return {all: text, prose: markdownProse(text)};
  return {all: text, prose: text};
}

// Returns a list of readable hit descriptions. Empty means clean.
export function scanText(relPath, text) {
  const regions = regionsFor(relPath, text);
  const allText = normalize(regions.all);
  const proseText = normalize(regions.prose);
  const hits = [];
  for (const rule of RULES) {
    const region = maskMechanismNames(rule.scope === 'prose' ? proseText : allText);
    for (const m of region.matchAll(rule.re)) {
      if (rule.negatable && isNegated(region, m.index ?? 0)) continue;
      hits.push(`${relPath}: "${m[0].replace(/\s+/g, ' ')}" [${rule.id}]`);
    }
  }
  return hits;
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
  'consent.previewNoCredentials', 'consent.digestLabel', 'consent.expiresLabel', 'consent.expiryNote',
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
  '02': ['disclosure.ctgov.body', 'disclosure.ctgov.networkNote'],
  '03': ['disclosure.openai.body', 'disclosure.openai.conditionTerm', 'disclosure.openai.account', 'disclosure.openai.neverSent', 'disclosure.openai.studyContacts'],
  '04': ['disclaimer.notAnonymous', 'disclaimer.notPhiReady', 'disclaimer.noComplianceClaim'],
  '05': ['disclosure.agentsRetention', 'disclosure.agentsTracing', 'disclosure.agentsInterrupted', 'disclosure.cannotRetract'],
  '06': ['disclosure.decisionsRetention', 'disclosure.abuseMonitoring', 'disclosure.noTraining'],
  '07': ['disclosure.credentials'],
  '09': ['disclosure.limits'],
  '10': ['consent.expiryNote', 'consent.invalidationNote'],
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
  assert.match(agents, /retains session state/);
  assert.match(agents, /not compatible with Zero Data Retention/);
  assert.match(agents, /attempts to cancel .* delete the session, and it reports any failure/);
  assert.match(agents, /physical cleanup may continue/);
  assert.match(agents, /does not promise instant physical erasure/);
  const tracing = strings['disclosure.agentsTracing'];
  assert.match(tracing, /tracing by default/);
  assert.match(tracing, /inputs, outputs, and tool results/);
  assert.match(tracing, /Logs, Agents/);
  assert.match(tracing, /no per-session setting to turn tracing off/);
  assert.match(tracing, /does not say whether deleting a session also removes its trace/);
  assert.match(strings['disclosure.agentsInterrupted'], /closed or the device loses power/);
  assert.match(strings['disclosure.agentsInterrupted'], /can remain in your OpenAI project until it is deleted/);
  assert.match(strings['disclosure.decisionsRetention'], /no stored application state .* other than prompt caching/);
  assert.match(strings['disclosure.abuseMonitoring'], /up to 30 days/);
  assert.match(strings['disclosure.abuseMonitoring'], /does not say that deleting an Agents session removes these logs/);
  assert.match(strings['disclosure.noTraining'], /not used to train or improve its models unless the owner of the OpenAI account has opted in/);
  assert.match(strings['disclosure.cannotRetract'], /cannot take back data that was already sent/);
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
  assert.match(strings['disclosure.openai.conditionTerm'], /never text that you typed/);
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

test('claims scan: every top-level folder and docs entry is classified', () => {
  const docs = entriesOf(REPO_ROOT).find(e => e.isDirectory && e.name.toLowerCase() === 'docs');
  const problems = classifyTopLevel(entriesOf(REPO_ROOT), docs ? entriesOf(path.join(REPO_ROOT, docs.name)) : []);
  assert.deepEqual(problems, []);
});

test('claims scan: every file under a scan root has a known type and decodes as text', () => {
  const found = collectFiles();
  assert.deepEqual(found.unknown, [], 'classify these extensions in the test file (scanned, non-text, or config)');
  // An extensionless file with NUL bytes is a binary (for example a built executable) and is skipped.
  const unreadable = found.files.filter(f => path.posix.extname(f.rel) !== '' && decode(readFileSync(f.full)) === null).map(f => f.rel);
  assert.deepEqual(unreadable, [], 'a file with a text extension contains NUL bytes');
});

test('claims scan: exemptions are exact, justified, and limited to test and fixture paths', () => {
  assert.deepEqual(validateExemptions(EXEMPT_FILES, rel => existsSync(path.join(REPO_ROOT, rel))), []);
});

test('claims scan: shipped strings and docs make no banned compliance, security, anonymity, or validity claims', () => {
  const found = collectFiles();
  const relative = found.files.map(f => f.rel);
  assert.ok(relative.includes('core/strings/strings.en.json'), 'the strings file must be in the scan');
  assert.ok(relative.includes('core/strings/README.md'), 'the strings README must be in the scan');
  assert.ok(!relative.includes('core/strings/claims.test.mjs'), 'the rule definitions file must not be scanned');
  const hits = [];
  for (const file of found.files) {
    const text = decode(readFileSync(file.full));
    if (text !== null) hits.push(...scanText(file.rel, text));
  }
  assert.deepEqual(hits, []);
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
  for (const f of ['a.png', 'a.ttf', 'a.exe', 'a.deb', 'a.csproj', 'a.pbxproj', 'package-lock.json', '.DS_Store', 'x/.gitignore']) assert.equal(classifyFile(f), 'skip', f);
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

test('self-test: exemptions are accepted only for justified test and fixture paths', () => {
  const exists = () => true;
  const good = {path: 'core/test/fixtures/ctgov-real.json', reason: 'Recorded public registry response with sponsor wording.'};
  assert.deepEqual(validateExemptions([good], exists), []);
  assert.deepEqual(validateExemptions([{...good, path: 'core/src/strings.ts'}], exists).length, 1);
  assert.ok(validateExemptions([{...good, path: 'core/strings/fixtures/a.json'}], exists).length > 0);
  assert.ok(validateExemptions([{...good, path: 'docs/apps/fixtures/a.md'}], exists).length > 0);
  assert.ok(validateExemptions([{...good, path: 'mobile/test/readme.md'}], exists).length > 0);
  assert.ok(validateExemptions([{...good, reason: 'ok'}], exists).length > 0);
  assert.ok(validateExemptions([{path: 'core/test/*.json', reason: good.reason}], exists).length > 0);
  assert.ok(validateExemptions([good], () => false).length > 0);
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
