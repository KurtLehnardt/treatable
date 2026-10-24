#!/usr/bin/env node
// Keeps the extension version identical in manifest.json, package.json and package-lock.json.
// Usage: node scripts/bump-version.mjs patch        -> 1.0.0 becomes 1.0.1
//        node scripts/bump-version.mjs set 1.2.3    -> sets an exact version
//        node scripts/bump-version.mjs current      -> prints the manifest version
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  manifest: join(root, 'manifest.json'),
  pkg: join(root, 'package.json'),
  lock: join(root, 'package-lock.json'),
};
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const [command, arg] = process.argv.slice(2);
const current = readJson(files.manifest).version;

let next;
if (command === 'current') {
  console.log(current);
  process.exit(0);
} else if (command === 'patch') {
  const match = SEMVER.exec(current);
  if (!match) throw new Error(`manifest.json version "${current}" is not MAJOR.MINOR.PATCH`);
  next = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
} else if (command === 'set' && SEMVER.test(arg ?? '')) {
  next = arg;
} else {
  console.error('Usage: bump-version.mjs patch | set MAJOR.MINOR.PATCH | current');
  process.exit(2);
}

const manifest = readJson(files.manifest);
manifest.version = next;
writeJson(files.manifest, manifest);

const pkg = readJson(files.pkg);
pkg.version = next;
writeJson(files.pkg, pkg);

if (existsSync(files.lock)) {
  const lock = readJson(files.lock);
  lock.version = next;
  if (lock.packages?.['']) lock.packages[''].version = next;
  writeJson(files.lock, lock);
}

console.log(`${current} -> ${next}`);
