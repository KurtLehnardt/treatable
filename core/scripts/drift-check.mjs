#!/usr/bin/env node
// Drift check for the reviewed extension code that core/ ports (final-plan.md amendment R3).
//
// core/ is a second copy of security-critical extension code. Codex keeps editing extension/, so at
// every re-base this script lists which ported source files changed since the commit they were
// ported from (48c569e), so that a reviewer can port or reject each change on purpose.
//
// Usage:
//   node scripts/drift-check.mjs [--target <commit-ish> | --worktree] [--base <commit>] [--repo <dir>]
//                                [--manifest <file.json>] [--diff]
//
//   --target    Commit to compare with the base (default HEAD of the repository that contains core/).
//   --worktree  Compare the working tree instead, including uncommitted edits.
//   --base      Commit the code was ported from (default 48c569e).
//   --repo      Repository root (default: the repository that contains this script).
//   --manifest  JSON file with [{ "path", "blob", "status" }] entries, replacing the built-in list (tests).
//   --diff      Also print the unified diff of every drifted file.
//
// Exit codes: 0 no drift, 1 drift found, 2 usage or git error. Nothing is written anywhere.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE_COMMIT = '48c569e';

// Git blob IDs at 48c569e. "ported" files were ported by tasks A1a and A1b; "pending" files are
// reviewed, security-critical sources that later tasks port (A4, A6a, A6b); "reference" files
// informed the design without code being copied. Every entry is checked, because any change in them
// needs a review before the next re-base.
export const PORTED_SOURCES = [
  { path: 'extension/native/real.mjs', blob: '699f0e29e7498543ada36646d4ad5af918be3bd1', status: 'ported (A1a): PreparedRealStore, publicStudy field set, request texts, corpus integrity checks' },
  { path: 'extension/shared/real-contract.mjs', blob: '3ff2614b3ac040d5657f73554b331a299716c20d', status: 'ported (A1a): policy receipt, TTL, packet, execute/revoke, result and prepared-reply contracts' },
  { path: 'extension/shared/real-contract.d.mts', blob: 'd993d15a170e0a86ded5ac3d376a7184b69e26f3', status: 'ported (A1a): contract types' },
  { path: 'extension/shared/demo-contract.mjs', blob: '293923d9c567daa389a7ec2cdc4349dcb12b1278', status: 'ported (A1a): MAX_MESSAGE_BYTES, ID and key checks, question and caution IDs, reply validation' },
  { path: 'extension/shared/demo-contract.d.mts', blob: 'e0886efa0790eb12c96240eed8d8938c914f2aa3', status: 'reference: reply and trace types' },
  { path: 'extension/shared/demo-fixtures.mjs', blob: '42ded4710760237c5ef22b57238d3dd29d4a2cc5', status: 'ported (A1a): score level labels, agent output schema; pending (A4): request builders' },
  { path: 'extension/native/host.mjs', blob: 'a73405c5f9077b8e17796d7a6bff6b78065abd88', status: 'ported (A1a): request dispatch, BUSY, cancel, revoke, invalidation; pending (A6a): process lifecycle' },
  { path: 'extension/native/core.mjs', blob: 'df85cfa98f10e3860ffd98c34d2a1010436373bf', status: 'ported (A1a): ID pattern and reply ID; pending (A6a): stdio framing' },
  { path: 'extension/src/validation.ts', blob: '66536a8c6f8b7889cda8facbefafa5462a167e9e', status: 'ported (A1a): boundedText rules, request ID, message budget' },
  { path: 'scaffold/lib/eligibility/hardFilters.ts', blob: '75abf15f0709d92d3af7cdca5d925c582a635dc2', status: 'ported (A1b): screenStudy pipeline, ageInYears, status and sex rules, haversine distance -> src/screening.ts' },
  { path: 'scaffold/data/us-zip-centroids.json', blob: '7aad1e742e4b1fa16301075d1a8bbfca50353a9d', status: 'ported (A1b): bundled byte-identical as core/data/zip-centroids.v1.json, pinned by sha256' },
  { path: 'extension/src/core.ts', blob: 'c16e69c1ee1ab460731f256aa82cbf0cd7dbd231', status: 'ported (A1b): resolveZip and the ZIP-table handling -> src/zip.ts; nearestSite -> src/screening.ts' },
  { path: 'extension/native/transport.mjs', blob: '5f1471cf4bceb1b2ca4dd95b714f131ebbd7cdc0', status: 'ported (A1b): outbound request invariants (endpoint allowlist, host pin, body cap, header and beta rules) -> src/transport-gate.ts; pending (A4): response caps and error mapping' },
  { path: 'extension/native/provider.mjs', blob: '4d7c2726620d2301ecdace8ba770fc1abd035f17', status: 'pending (A4): Decisions and Agents runners, cleanup' },
  { path: 'extension/native/credentials.mjs', blob: '06bdbd02238b7f4822efa70c65d52d1ed35e49b9', status: 'reference (A6b): credential boundary' },
  { path: 'extension/native/test/real.test.mjs', blob: '63b58728bc069ed88ebb9048817c868f893a554d', status: 'ported (A1a): consent and contract tests; pending (A4, A6a): HTTPS and stdio tests' },
  { path: 'extension/native/test/core.test.mjs', blob: 'a19066611e6619b37a824c051f96fcdbdae3c93c', status: 'ported (A1a): request validation tests; pending (A4, A6a): provider and framing tests' },
  { path: 'scaffold/lib/studies/__tests__/clinical.test.ts', blob: '20261bbf9d3f2bb57689bb3dfdb1dc58c37c29bb', status: 'ported (A1b): screening cases (age, distance, sex, status, staleness) and offline-ZIP cases -> tests/screening.test.ts, tests/zip.test.ts' },
  { path: 'extension/tests/core.test.ts', blob: 'cbdf6e6292179baad01e57ecdc6691772fb56858', status: 'ported (A1b): resolveZip corpus cases (leading zeros, ZIP+4, unknown ZIP) -> tests/zip.test.ts' },
];

function parseArgs(argv) {
  const options = { target: 'HEAD', worktree: false, base: BASE_COMMIT, repo: undefined, manifest: undefined, diff: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === '--target') options.target = value();
    else if (arg === '--worktree') options.worktree = true;
    else if (arg === '--base') options.base = value();
    else if (arg === '--repo') options.repo = value();
    else if (arg === '--manifest') options.manifest = value();
    else if (arg === '--diff') options.diff = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

function git(repo, args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (allowFail) return undefined;
    throw new Error(`git ${args.join(' ')} failed`);
  }
}

export function runDriftCheck(argv, write = text => process.stdout.write(text)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    write(`drift-check: ${error.message}\n`);
    return 2;
  }
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repo = options.repo ?? git(here, ['rev-parse', '--show-toplevel']);
    const manifest = options.manifest ? JSON.parse(readFileSync(options.manifest, 'utf8')) : PORTED_SOURCES;
    const base = git(repo, ['rev-parse', '--verify', `${options.base}^{commit}`]);
    const target = options.worktree ? 'working tree' : git(repo, ['rev-parse', '--verify', `${options.target}^{commit}`]);
    write(`Drift check: base ${base.slice(0, 12)} -> ${options.worktree ? 'working tree' : target.slice(0, 12)} (${manifest.length} files)\n`);
    let drift = 0;
    for (const entry of manifest) {
      const baseBlob = git(repo, ['rev-parse', `${base}:${entry.path}`], { allowFail: true });
      if (baseBlob !== entry.blob) {
        write(`drift-check: the manifest blob for ${entry.path} does not match the base commit; fix the manifest first\n`);
        return 2;
      }
      let targetBlob;
      if (options.worktree) {
        const file = path.join(repo, entry.path);
        targetBlob = existsSync(file) ? git(repo, ['hash-object', '--', entry.path]) : undefined;
      } else {
        targetBlob = git(repo, ['rev-parse', `${target}:${entry.path}`], { allowFail: true });
      }
      if (targetBlob === entry.blob) {
        write(`  unchanged  ${entry.path}  [${entry.status}]\n`);
        continue;
      }
      drift += 1;
      const label = targetBlob === undefined ? 'DELETED' : 'CHANGED';
      write(`  ${label.padEnd(9)}  ${entry.path}  [${entry.status}]\n`);
      const range = options.worktree ? [base] : [base, target];
      const stat = git(repo, ['diff', '--stat', ...range, '--', entry.path], { allowFail: true });
      if (stat) write(`${stat.split('\n').map(line => `             ${line}`).join('\n')}\n`);
      write(`             review: git diff ${range.map(c => c.slice(0, 12)).join(' ')} -- ${entry.path}\n`);
      if (options.diff) write(`${git(repo, ['diff', ...range, '--', entry.path], { allowFail: true }) ?? ''}\n`);
    }
    write(drift ? `Drift found in ${drift} file(s). Review each change and port or reject it in core/ before re-basing.\n` : 'No drift.\n');
    return drift ? 1 : 0;
  } catch (error) {
    write(`drift-check: ${error.message}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runDriftCheck(process.argv.slice(2));
}
