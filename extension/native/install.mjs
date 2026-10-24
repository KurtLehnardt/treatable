#!/usr/bin/env node
import { mkdir, readFile, writeFile, copyFile, chmod, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { HOST_NAME, EXTENSION_ID } from './core.mjs';

const source = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function option(name) { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; }
const home = path.resolve(option('--home') ?? os.homedir());
const directory = path.join(home, 'Library', 'Application Support', 'Treatable', 'native-host');
const chromeManifest = path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
if (args.includes('--uninstall')) {
  await rm(chromeManifest, { force: true });
  await rm(directory, { recursive: true, force: true });
  console.log('Removed Treatable native helper registration and installed helper. Local models and browser data were retained.');
  process.exit(0);
}
if (process.platform !== 'darwin' && !args.includes('--home')) throw new Error('This installer currently supports macOS.');
let extensionId = option('--extension-id') ?? EXTENSION_ID;
const manifestPath = option('--manifest');
if (manifestPath) {
  const manifest = JSON.parse(await readFile(path.resolve(manifestPath), 'utf8'));
  if (typeof manifest.key !== 'string') throw new Error('Extension manifest needs its fixed public key.');
  const hex = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
  const derived = [...hex].map(char => String.fromCharCode(97 + Number.parseInt(char, 16))).join('');
  if (derived !== extensionId) throw new Error('Extension public key does not match the pinned extension ID.');
}
if (!/^[a-p]{32}$/.test(extensionId) || extensionId !== EXTENSION_ID) throw new Error('This helper only supports the pinned Treatable extension ID.');
const candidates = [option('--ollama'), '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama'].filter(Boolean);
let ollamaPath;
for (const candidate of candidates) { if (!path.isAbsolute(candidate)) continue; try { await access(candidate); ollamaPath = candidate; break; } catch {} }
if (!ollamaPath) throw new Error('Install Ollama first, or provide --ollama /absolute/path/to/ollama. No downloads were attempted.');
const lsofPath = '/usr/sbin/lsof';
await access(lsofPath);
const modelsDir = path.resolve(option('--models-dir') ?? path.join(home, '.ollama', 'models'));
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
for (const file of ['host.mjs', 'core.mjs']) await copyFile(path.join(source, file), path.join(directory, file));
const config = { extensionId, ollamaPath, modelsDir, lsofPath };
await writeFile(path.join(directory, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const launcher = path.join(directory, 'launch');
await writeFile(launcher, `#!/bin/sh\nunset NODE_OPTIONS NODE_USE_ENV_PROXY HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy\nexec ${quote(process.execPath)} ${quote(path.join(directory, 'host.mjs'))} "$@"\n`, { mode: 0o700 });
await chmod(launcher, 0o700);
await mkdir(path.dirname(chromeManifest), { recursive: true });
await writeFile(chromeManifest, JSON.stringify({ name: HOST_NAME, description: 'Treatable private local model helper', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`] }, null, 2), { mode: 0o600 });
console.log(`Installed ${HOST_NAME} for ${extensionId}. Node: ${process.execPath}. Models remain local; this installer does not download them.`);
