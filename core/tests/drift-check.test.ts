// Mocked: no network. The drift check runs clean on this branch and reports changes in a scratch repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'drift-check.mjs');

function run(args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

test('drift check is clean for the extension sources ported at 48c569e', () => {
  const { status, out } = run([]);
  assert.equal(status, 0, out);
  assert.match(out, /No drift\./);
  for (const file of ['extension/native/real.mjs', 'extension/shared/real-contract.mjs', 'extension/native/host.mjs', 'extension/src/validation.ts']) {
    assert.match(out, new RegExp(`unchanged  ${file.replace(/[./]/g, '\\$&')}`));
  }
  assert.equal(run(['--worktree']).status, 0);
});

test('drift check reports changed and deleted files, in commits and in the working tree, and rejects bad input', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'treatable-drift-'));
  const g = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Drift Test', '-c', 'user.email=drift@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim();
  try {
    g('init', '-q');
    await mkdir(path.join(repo, 'extension', 'native'), { recursive: true });
    await writeFile(path.join(repo, 'extension', 'native', 'real.mjs'), 'export const a = 1;\n');
    await writeFile(path.join(repo, 'extension', 'native', 'host.mjs'), 'export const b = 2;\n');
    await writeFile(path.join(repo, 'extension', 'native', 'core.mjs'), 'export const c = 3;\n');
    g('add', '.');
    g('commit', '-q', '-m', 'base');
    const base = g('rev-parse', 'HEAD');
    const manifest = ['real.mjs', 'host.mjs', 'core.mjs'].map(name => ({ path: `extension/native/${name}`, blob: g('rev-parse', `HEAD:extension/native/${name}`), status: 'ported (test)' }));
    const manifestFile = path.join(repo, 'manifest.json');
    await writeFile(manifestFile, JSON.stringify(manifest));
    const common = ['--repo', repo, '--base', base, '--manifest', manifestFile];
    assert.equal(run([...common, '--target', base]).status, 0);

    await writeFile(path.join(repo, 'extension', 'native', 'real.mjs'), 'export const a = 2; // changed upstream\n');
    await unlink(path.join(repo, 'extension', 'native', 'host.mjs'));
    const dirty = run([...common, '--worktree', '--diff']);
    assert.equal(dirty.status, 1, dirty.out);
    assert.match(dirty.out, /CHANGED\s+extension\/native\/real\.mjs/);
    assert.match(dirty.out, /DELETED\s+extension\/native\/host\.mjs/);
    assert.match(dirty.out, /unchanged {2}extension\/native\/core\.mjs/);
    assert.match(dirty.out, /changed upstream/, '--diff prints the change for review');

    g('add', '-A');
    g('commit', '-q', '-m', 'upstream edit');
    const committed = run([...common, '--target', 'HEAD']);
    assert.equal(committed.status, 1, committed.out);
    assert.match(committed.out, /Drift found in 2 file\(s\)/);
    assert.match(committed.out, /review: git diff/);

    await writeFile(manifestFile, JSON.stringify([{ ...manifest[0], blob: '0'.repeat(40) }]));
    assert.equal(run([...common, '--target', 'HEAD']).status, 2, 'a manifest that does not match the base is an error');
    assert.equal(run(['--bogus']).status, 2);
    assert.equal(run(['--repo', repo, '--base', 'no-such-commit']).status, 2);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
