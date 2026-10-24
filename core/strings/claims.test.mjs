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

const SELF = fileURLToPath(import.meta.url);
const STRINGS_FILE = path.join(path.dirname(SELF), 'strings.en.json');
const REPO_ROOT = path.resolve(path.dirname(SELF), '..', '..');

// ---------------------------------------------------------------------------------------------
// Part 2 and 3 definitions: scan roots, file types, ignored directories
// ---------------------------------------------------------------------------------------------

// Roots that always exist in this repository, then roots that appear as platform work lands.
const SCAN_ROOTS = ['core', 'desktop-helper', 'docs/apps', 'mobile', 'macos', 'windows', 'linux'];

// Extensions from the task list plus plain-JavaScript, localization, and installer-text variants.
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.swift', '.kt', '.cs']);
const JSON_EXTENSIONS = new Set(['.json', '.xcstrings']);
const MARKDOWN_EXTENSIONS = new Set(['.md']);
const PROSE_EXTENSIONS = new Set([
  '.xaml', '.ui', '.blp', '.iss', '.desktop', '.plist', '.xml', '.strings', '.resx', '.html', '.txt', '.rtf',
]);
const SCANNED_EXTENSIONS = new Set([...CODE_EXTENSIONS, ...JSON_EXTENSIONS, ...MARKDOWN_EXTENSIONS, ...PROSE_EXTENSIONS]);

// Build output, dependency, and tool directories hold generated or third-party text, not shipped wording.
const IGNORED_DIRECTORIES = new Set([
  'node_modules', 'dist', 'build', '.git', '.gradle', '.build', 'DerivedData', 'Pods', '.expo', 'coverage', 'obj', 'bin',
  'builddir', '_build', '.flatpak-builder',
]);
const IGNORED_FILE_NAMES = new Set(['package-lock.json']);

// Recorded public registry responses (for example ClinicalTrials.gov fixtures) quote the words of study sponsors,
// and a study record can legitimately contain a phrase this scan bans. Such a file is not Treatable wording.
// Each entry is one exact repository-relative JSON path and needs a reviewer to accept it. The list starts empty.
const EXEMPT_RECORDED_PUBLIC_DATA = [];

export function isIgnoredDirectory(name) {
  return IGNORED_DIRECTORIES.has(name);
}

export function isExemptRecordedPublicData(relPath) {
  return EXEMPT_RECORDED_PUBLIC_DATA.includes(relPath);
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!isIgnoredDirectory(entry.name)) walk(full, out);
    } else if (entry.isFile()) {
      if (IGNORED_FILE_NAMES.has(entry.name)) continue;
      if (!SCANNED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      if (path.resolve(full) === SELF) continue;
      if (isExemptRecordedPublicData(path.relative(REPO_ROOT, full).split(path.sep).join('/'))) continue;
      out.push(full);
    }
  }
}

function collectFiles() {
  const files = [];
  for (const root of SCAN_ROOTS) {
    const dir = path.join(REPO_ROOT, root);
    if (existsSync(dir)) walk(dir, files);
  }
  return files.sort();
}

// ---------------------------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------------------------

// A negated mention is an honest statement ("Not PHI-ready"), so negatable rules let it pass.
// A hit is negated when a negator, followed by at most four filler words, sits right before it in the same sentence.
const NEGATOR = "(?:not|never|no|cannot|can't|isn't|aren't|wasn't|doesn't|don't|won't|without|nor|neither)";
const FILLER = '(?:a|an|any|be|been|being|is|are|was|do|does|can|ever|yet|also|currently|fully|claimed?|described|called|labeled|presented|considered|treated|stated|as|to)';
const NEGATED_BEFORE = new RegExp(`\\b${NEGATOR}\\s+(?:${FILLER}\\s+)*$`, 'i');

export function isNegated(text, index) {
  const sentence = text.slice(Math.max(0, index - 80), index).split(/[.;:!?\n]/).pop();
  return NEGATED_BEFORE.test(sentence);
}

// Mechanism names that are not claims. Each is blanked out (same length) before the rules run.
const MECHANISM_NAMES = [
  {
    id: 'expo-secure-store',
    re: /\bexpo-secure-store\b/gi,
    ok: ['"expo-secure-store": "~14.0.0"', "import * as Store from 'expo-secure-store';"],
  },
  {
    id: 'secure-mechanism-nouns',
    re: /\bsecure[- ](?:store|storage|enclave|context|random)\b/gi,
    ok: ['Credentials use platform secure storage.', 'Apple Secure Enclave', 'A secure context is required.'],
  },
  {
    id: 'encrypted-ebs',
    re: /\bencrypted EBS\b/gi,
    ok: ['Use encrypted EBS volumes for the test instance.'],
  },
];

function maskMechanismNames(text) {
  let masked = text;
  for (const {re} of MECHANISM_NAMES) masked = masked.replace(re, m => ' '.repeat(m.length));
  return masked;
}

// scope 'all' rules run on every scanned text region. scope 'prose' rules run only where the word is prose:
// markdown outside code, and string literals and comments in source files (so the `private` keyword is legal).
const RULES = [
  {
    id: 'compliance-label',
    re: /\b(?:HIPAA|GDPR|CCPA|HITRUST|SOC ?2|ISO ?27001)[- ](?:compliant|ready|eligible|safe|certified|approved)\b/gi,
    negatable: true,
    bad: ['HIPAA compliant', 'a HIPAA-ready app', 'HIPAA eligible tool', 'SOC 2 certified', 'GDPR-compliant'],
    ok: ['Treatable is not HIPAA compliant.', 'Treatable makes no claim of HIPAA compliance or legal sufficiency.'],
  },
  {
    id: 'phi-ready',
    re: /\bPHI[- ]ready\b/gi,
    negatable: true,
    bad: ['PHI-ready', 'This mode is PHI ready.', 'Fully PHI-ready'],
    ok: ['Not PHI-ready by default.', 'OpenAI mode is not PHI-ready.', 'It is not yet PHI-ready.'],
  },
  {
    id: 'baa-verification',
    re: /\b(?:BAA[- ]verif\w*|verif\w*\s+(?:a|the|your|any)\s+BAA)\b/gi,
    negatable: true,
    bad: ['BAA verified', 'BAA verification passed', 'We verified your BAA.', 'Verify a BAA here.'],
    ok: ['Treatable does not verify a BAA.', 'This is not BAA verification.', 'It never verifies your BAA.'],
  },
  {
    id: 'secure',
    re: /\bsecure\b/gi,
    negatable: false,
    bad: ['Your data is secure.', 'a secure app', 'Secure by design', 'safe and secure'],
    ok: ['securely prompts', 'SecureStore', 'FLAG_SECURE'],
  },
  {
    id: 'guarantee',
    re: /\bguarantee(?:d|s|ing)?\b/gi,
    negatable: true,
    bad: ['We guarantee your privacy.', 'Guaranteed erasure', 'a guarantee of deletion', 'guarantees protection'],
    ok: ['Treatable does not guarantee erasure.', 'There is no guarantee of deletion.', 'It cannot guarantee provider erasure.', 'This is not a guarantee.'],
  },
  {
    id: 'clinical-validity',
    re: /\bclinically[- ](?:validated|proven|verified|tested)\b/gi,
    negatable: true,
    bad: ['clinically validated', 'a clinically proven method', 'Clinically tested'],
    ok: ['Treatable has not been clinically validated.', 'The score is not clinically validated.', 'Never described as clinically proven.'],
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
    bad: ['Your data is anonymous.', 'anonymized data', 'fully anonymous', 'Anonymised results'],
    ok: ['Minimized health information is not anonymous.', 'The packet is not anonymized.', 'No anonymization is performed.'],
  },
  {
    id: 'de-identified',
    re: /\bde-?identified\b/gi,
    negatable: true,
    bad: ['de-identified data', 'deidentified records'],
    ok: ['The data is not de-identified.', 'HHS de-identification guidance describes formal standards.'],
  },
  {
    id: 'nothing-leaves',
    re: /\b(?:nothing (?:ever )?leaves|no data (?:ever )?leaves|never leaves (?:your|the) (?:device|phone|computer|app)|stays? (?:only )?on your (?:device|phone|computer))\b/gi,
    negatable: false,
    bad: ['Nothing leaves your phone.', 'no data leaves the app', 'Your data never leaves your device.', 'Everything stays on your device.'],
    ok: ['Searching does not send anything to OpenAI.', 'Nothing you enter is saved.'],
  },
  {
    id: 'encrypted',
    re: /\bencrypted\b/gi,
    negatable: true,
    bad: ['Your data is encrypted.', 'end-to-end encrypted', 'Encrypted storage'],
    ok: ['The text is not encrypted.', 'Use encrypted EBS volumes for the test instance.', 'EncryptedSharedPreferences'],
  },
  {
    id: 'marketing-claims',
    re: /\b(?:privacy[- ](?:first|preserving|protected|focused|friendly|safe)|(?:military|bank)[- ]grade|100% (?:private|safe|secure|accurate|anonymous)|(?:FDA|CE)[- ](?:approved|cleared))\b/gi,
    negatable: true,
    bad: ['privacy-first design', 'a privacy preserving app', 'military-grade protection', 'bank grade', '100% accurate', 'FDA approved'],
    ok: ['Treatable is not FDA approved.', 'Treatable is not FDA cleared.'],
  },
  {
    id: 'private-prose',
    re: /\bprivate\b(?! retention| link)/gi,
    negatable: false,
    scope: 'prose',
    bad: ['Your private profile', 'Private by design', 'a private search'],
    ok: ['private retention', 'a private link', 'privacy contact'],
  },
];

// ---------------------------------------------------------------------------------------------
// Region extraction: decide which text each rule sees
// ---------------------------------------------------------------------------------------------

// Returns the text of string literals and comments in C-like source code. Keywords and identifiers
// (for example the `private` modifier or a variable named `encrypted`) are not claims, so they are dropped.
export function codeProse(text) {
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

// Returns string values and non-flag keys of a JSON document. Boolean, number, and null members are
// configuration flags (for example `"private": true`), so their keys are not claims.
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
        if (member !== null && (typeof member === 'string' || typeof member === 'object')) out.push(key);
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
  const ext = path.extname(relPath).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) {
    const prose = codeProse(text);
    return {all: prose, prose};
  }
  if (JSON_EXTENSIONS.has(ext)) {
    const strings = jsonRegions(text);
    return {all: strings, prose: strings};
  }
  if (MARKDOWN_EXTENSIONS.has(ext)) return {all: text, prose: markdownProse(text)};
  return {all: text, prose: text};
}

// Returns a list of readable hit descriptions. Empty means clean.
export function scanText(relPath, text) {
  const regions = regionsFor(relPath, text);
  const hits = [];
  for (const rule of RULES) {
    const region = maskMechanismNames(rule.scope === 'prose' ? regions.prose : regions.all);
    for (const m of region.matchAll(rule.re)) {
      if (rule.negatable && isNegated(region, m.index ?? 0)) continue;
      hits.push(`${relPath}: "${m[0]}" [${rule.id}]`);
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
  'disclaimer.unknownEligibility', 'disclaimer.participationDraftOnly', 'disclaimer.publicRecords',
  'disclaimer.notClinicallyValidated', 'disclaimer.notAnonymous', 'disclaimer.notPhiReady', 'disclaimer.noComplianceClaim',
  'operator.name', 'operator.privacyContact', 'operator.noticeOnly', 'operator.noRecordLookup',
  'disclosure.ctgov.heading', 'disclosure.ctgov.body', 'disclosure.ctgov.networkNote',
  'disclosure.openai.heading', 'disclosure.openai.body', 'disclosure.openai.conditionTerm',
  'disclosure.openai.neverSent', 'disclosure.openai.studyContacts', 'disclosure.separation',
  'disclosure.agentsRetention', 'disclosure.decisionsRetention', 'disclosure.cannotRetract',
  'disclosure.credentials', 'disclosure.limits',
  'notice.title', 'notice.regionLabel', 'notice.scrollHint', 'notice.endMarker', 'notice.acknowledgmentLabel',
  'notice.acknowledgeButton', 'notice.acknowledgedStatus', 'notice.acknowledgmentSessionOnly', 'notice.declineButton',
  'consent.separateConfirmationNote', 'consent.prepareButton', 'consent.previewHeading', 'consent.previewExplanation',
  'consent.previewNoCredentials', 'consent.digestLabel', 'consent.expiresLabel', 'consent.expiryNote',
  'consent.invalidationNote', 'consent.confirmLabel', 'consent.sendDecisions', 'consent.sendAgents',
  'consent.oneUseNote', 'consent.discardButton', 'consent.stopButton',
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
  '03': ['disclosure.openai.body', 'disclosure.openai.conditionTerm', 'disclosure.openai.neverSent', 'disclosure.openai.studyContacts'],
  '04': ['disclaimer.notAnonymous', 'disclaimer.notPhiReady', 'disclaimer.noComplianceClaim'],
  '05': ['disclosure.agentsRetention', 'disclosure.cannotRetract'],
  '06': ['disclosure.decisionsRetention'],
  '07': ['disclosure.credentials'],
  '09': ['disclosure.limits'],
  '10': ['consent.invalidationNote'],
  '11': ['disclaimer.persistent', 'disclaimer.scoreMeaning', 'disclaimer.distance', 'disclaimer.unknownEligibility', 'disclaimer.participationDraftOnly'],
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
    for (const token of String(value).match(/[{}]/g) ? String(value).match(/\{[^}]*\}|[{}]/g) : []) {
      if (!/^\{[a-z][a-zA-Z0-9]*\}$/.test(token)) problems.push(`${key}: malformed placeholder ${token}`);
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

test('strings.en.json: todo keys point at an existing key and say what to confirm', () => {
  const problems = [];
  for (const [key, value] of Object.entries(strings)) {
    if (!key.startsWith('_todo.')) continue;
    if (!(key.slice('_todo.'.length) in strings)) problems.push(`${key}: target key does not exist`);
    if (!value.startsWith('TODO:')) problems.push(`${key}: must start with "TODO:"`);
  }
  assert.deepEqual(problems, []);
  assert.match(strings['_todo.disclosure.decisionsRetention'], /confirm against docs\/apps\/openai-contracts\.md \(task A0\)/);
  assert.match(strings['_todo.notice.section.06.body'], /confirm against docs\/apps\/openai-contracts\.md \(task A0\)/);
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
  assert.match(strings['disclaimer.notPhiReady'], /^Not PHI-ready by default\./);
  assert.match(strings['disclaimer.notPhiReady'], /does not verify a BAA/);
  assert.match(strings['disclaimer.notAnonymous'], /^Minimized health information is not anonymous\.$/);
  assert.match(strings['notice.acknowledgmentLabel'], /^I have read this notice/);
  assert.match(strings['consent.confirmLabel'], /^I reviewed this exact request and I confirm sending it to OpenAI/);
  assert.match(strings['consent.previewHeading'], /^Exact request preview$/);
  assert.match(strings['credential.noFallback'], /no plaintext fallback/);
  assert.match(strings['credential.lockedWithoutKey'], /stay locked/);
  assert.match(strings['disclosure.credentials'], /operating system's credential store/);
  for (const limit of ['compromised operating system', 'privileged debuggers', 'memory forensics']) {
    assert.ok(strings['disclosure.limits'].includes(limit), limit);
  }
  assert.match(strings['disclosure.agentsRetention'], /retains session state/);
  assert.match(strings['disclosure.agentsRetention'], /not compatible with Zero Data Retention/);
  assert.match(strings['disclosure.agentsRetention'], /attempts to cancel .* delete the session, and it reports any failure/);
  assert.match(strings['disclosure.agentsRetention'], /does not promise instant physical erasure/);
});

test('strings.en.json: ClinicalTrials.gov and OpenAI disclosures stay separate and complete', () => {
  const ct = strings['disclosure.ctgov.body'];
  assert.match(ct, /search terms/);
  assert.match(ct, /at most a US state/);
  assert.match(ct, /over HTTPS/);
  assert.match(ct, /clinicaltrials\.gov/);
  assert.match(ct, /policies apply/);
  assert.match(ct, /does not include your ZIP code or coordinates/);
  const allowedToOpenAi = strings['disclosure.openai.body'];
  for (const item of ['condition term', 'age band', 'US state', 'sex', 'public study fields']) {
    assert.ok(allowedToOpenAi.includes(item), `OpenAI allowed item: ${item}`);
  }
  const never = strings['disclosure.openai.neverSent'];
  for (const item of ['free-text symptoms or notes', 'ZIP codes', 'coordinates', 'exact age', 'date of birth', 'names', 'contact details']) {
    assert.ok(never.includes(item), `OpenAI never-sent item: ${item}`);
  }
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
  assert.match(strings['error.credentialMissing'], /stay locked/);
  assert.match(strings['error.credentialLocked'], /locked or unavailable/);
  assert.match(strings['error.cancelled'], /^Cancelled\./);
  assert.match(strings['error.deletionFailed'], /Provider data may remain/);
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
  assert.equal(strings['consent.expiryNote'].replace(/\.$/, '').split(' and ')[0], 'A prepared request expires after five minutes');
  assert.ok(strings['notice.section.10.body'].includes('expires after five minutes and can be used once'));
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

test('claims scan: shipped strings and docs make no banned compliance, security, anonymity, or validity claims', () => {
  const files = collectFiles();
  const relative = files.map(f => path.relative(REPO_ROOT, f).split(path.sep).join('/'));
  assert.ok(relative.includes('core/strings/strings.en.json'), 'the strings file must be in the scan');
  assert.ok(relative.includes('core/strings/README.md'), 'the strings README must be in the scan');
  assert.ok(!relative.includes('core/strings/claims.test.mjs'), 'the rule definitions file must not be scanned');
  const hits = [];
  for (const [i, file] of files.entries()) hits.push(...scanText(relative[i], readFileSync(file, 'utf8')));
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
      if (hits.length === 0) misses.push(`${rule.id}: not caught: ${sample}`);
    }
  }
  assert.deepEqual(misses, []);
});

test('self-test: each allowed negation and mechanism name passes', () => {
  const falseAlarms = [];
  for (const rule of RULES) {
    for (const sample of rule.ok) {
      const hits = scanText('sample.md', sample);
      if (hits.length > 0) falseAlarms.push(`${rule.id}: wrongly flagged: ${sample} -> ${hits.join(', ')}`);
    }
  }
  for (const name of MECHANISM_NAMES) {
    for (const sample of name.ok) {
      const hits = scanText('sample.md', sample);
      if (hits.length > 0) falseAlarms.push(`${name.id}: wrongly flagged: ${sample} -> ${hits.join(', ')}`);
    }
  }
  assert.deepEqual(falseAlarms, []);
});

test('self-test: negation does not leak across sentences or unrelated words', () => {
  // A negator earlier in the paragraph must not excuse a later claim.
  assert.ok(scanText('s.md', 'This is not a diagnosis. The data is anonymous.').length > 0);
  assert.ok(scanText('s.md', 'We do not hide it, we guarantee it.').length > 0);
  assert.ok(scanText('s.md', 'It is not only PHI-ready but safe.').length > 0);
  // A negator is not skipped by a comma.
  assert.ok(scanText('s.md', 'No, the app is certified.').length > 0);
  // Absolute claims are never excused by a negator.
  assert.ok(scanText('s.md', 'It is not true that nothing leaves your device.').length > 0);
  assert.ok(scanText('s.md', 'This is not secure.').length > 0);
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

test('self-test: JSON configuration flags are legal, values and keys with text are scanned', () => {
  assert.deepEqual(scanText('package.json', '{"name":"core","private":true,"dependencies":{"expo-secure-store":"~14.0.0"}}'), []);
  assert.ok(scanText('package.json', '{"description":"A secure app"}').length > 0);
  assert.ok(scanText('x.xcstrings', '{"strings":{"Your data is anonymous":{}}}').length > 0);
  assert.ok(scanText('package.json', '{"private":"yes"}').length > 0);
  assert.deepEqual(scanText('bad.json', '{ not json: Not PHI-ready }'), []);
  assert.ok(scanText('bad.json', '{ not json: PHI-ready }').length > 0);
});

test('self-test: markdown code fences may show the private keyword, prose may not', () => {
  assert.deepEqual(scanText('a.md', 'Use this:\n\n```ts\nprivate readonly x = 1;\n```\n\nAlso `private` is a keyword.\n'), []);
  assert.ok(scanText('a.md', 'A private profile.\n\n```ts\nprivate x = 1;\n```\n').length > 0);
  assert.ok(scanText('a.md', '```ts\nconst s = "Your data is anonymous";\n```\n').length > 0, 'other rules still apply inside fences');
});

test('self-test: prose file types are scanned in full', () => {
  for (const file of ['a.xaml', 'a.ui', 'a.blp', 'a.iss', 'a.desktop', 'a.plist', 'a.xml', 'a.strings', 'a.resx', 'a.html', 'a.txt', 'a.rtf']) {
    assert.ok(scanText(file, 'Comment=Your private data is anonymous').length >= 2, file);
    assert.deepEqual(scanText(file, 'Comment=Research information, not medical advice.'), [], file);
  }
});

test('self-test: build output and dependency directories are ignored, scanned extensions are listed', () => {
  for (const dir of ['node_modules', 'dist', 'build', '.git', 'Pods', 'DerivedData', '.gradle', '.build', '.expo']) {
    assert.equal(isIgnoredDirectory(dir), true, dir);
  }
  for (const dir of ['src', 'strings', 'docs', 'mobile', 'Resources']) assert.equal(isIgnoredDirectory(dir), false, dir);
  for (const ext of ['.md', '.json', '.ts', '.mjs', '.tsx', '.swift', '.kt', '.cs', '.xaml', '.ui', '.blp', '.iss', '.desktop', '.plist', '.xml']) {
    assert.equal(SCANNED_EXTENSIONS.has(ext), true, ext);
  }
});

test('self-test: recorded public data exemptions are exact, existing JSON files', () => {
  for (const entry of EXEMPT_RECORDED_PUBLIC_DATA) {
    assert.match(entry, /^[A-Za-z0-9_./-]+\.json$/, `${entry} must be an exact repository-relative JSON path`);
    assert.ok(existsSync(path.join(REPO_ROOT, entry)), `${entry} must exist`);
    assert.ok(!entry.startsWith('core/strings/'), 'strings and docs are never exempt');
  }
  assert.equal(isExemptRecordedPublicData('core/strings/strings.en.json'), false);
});

test('self-test: the real wording that must pass does pass', () => {
  const must = [
    'Not PHI-ready by default.',
    'Minimized health information is not anonymous.',
    'Treatable has not been clinically validated.',
    'Treatable does not verify a BAA.',
    'Treatable does not promise instant physical erasure.',
    'Treatable cannot guarantee that OpenAI has erased the data.',
  ];
  for (const sentence of must) assert.deepEqual(scanText('s.md', sentence), [], sentence);
});
