#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { MessageDecoder, encodeMessage, validateOrigin, validateRequest, localModels, MAX_RESPONSE_CHARS } from './core.mjs';

const execFileAsync = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
let child;
let runtimePromise;
let endpoint;
let closed = false;
const pending = new Map();
const seenIds = new Set();
const send = message => { if (!closed) { try { process.stdout.write(encodeMessage(message)); } catch { process.stdout.write(encodeMessage({ id: message.id, type: 'result', ok: false, error: 'Local response exceeded its size limit.' })); } } };
function shutdown() { if (closed) return; closed = true; for (const controller of pending.values()) controller.abort(); child?.kill('SIGTERM'); setTimeout(() => { child?.kill('SIGKILL'); process.exit(); }, 200).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('exit', () => child?.kill('SIGTERM'));

let config;
try {
  config = JSON.parse(await readFile(path.join(directory, 'config.json'), 'utf8'));
  if (!validateOrigin(process.argv[2], config.extensionId)) throw new Error();
  if (!path.isAbsolute(config.ollamaPath) || !path.isAbsolute(config.modelsDir) || !path.isAbsolute(config.lsofPath)) throw new Error();
} catch { process.stderr.write('Treatable native helper is not installed or its caller is not allowed.\n'); process.exit(1); }

async function ownsListener() {
  if (!child?.pid || child.exitCode !== null || child.killed || !endpoint) return false;
  try {
    const port = new URL(endpoint).port;
    const { stdout } = await execFileAsync(config.lsofPath, ['-nP', '-a', '-p', String(child.pid), `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'p'], { timeout: 1500, maxBuffer: 4096 });
    return stdout.split('\n').includes(`p${child.pid}`);
  } catch { return false; }
}

async function requestJson(route, body, signal) {
  const timeout = AbortSignal.timeout(5000);
  const response = await fetch(`${endpoint}${route}`, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new Error('Local runtime unavailable');
  const text = await response.text();
  if (text.length > 1024 * 1024) throw new Error('Local metadata exceeded limit');
  return JSON.parse(text);
}

async function startRuntime() {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    // Reserve an OS-assigned loopback port. Never reuse an existing unknown daemon.
    const reservation = net.createServer();
    await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    endpoint = `http://127.0.0.1:${port}`;
    const env = { PATH: path.dirname(config.ollamaPath), HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, OLLAMA_HOST: `127.0.0.1:${port}`, OLLAMA_MODELS: config.modelsDir, OLLAMA_NO_CLOUD: '1', OLLAMA_DEBUG: '0', OLLAMA_KEEP_ALIVE: '1m', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_NUM_PARALLEL: '1' };
    child = spawn(config.ollamaPath, ['serve'], { env, stdio: 'ignore' });
    let failed = false;
    child.once('error', () => { failed = true; });
    child.once('exit', () => { failed = true; runtimePromise = undefined; });
    for (let attempt = 0; attempt < 80; attempt++) {
      if (failed || closed) throw new Error('Local Ollama could not start');
      try { if (await ownsListener()) { await requestJson('/api/version'); return; } } catch {}
      await delay(100);
    }
    child.kill('SIGTERM'); throw new Error('Local Ollama could not start');
  })();
  try { await runtimePromise; } catch { runtimePromise = undefined; throw new Error('Local Ollama is unavailable. Install Ollama and a local model, then reconnect.'); }
}
async function availableModels() {
  await startRuntime();
  return localModels(await requestJson('/api/tags'), model => requestJson('/api/show', { model }), config.modelsDir);
}
async function handle(raw) {
  let message;
  try {
    message = validateRequest(raw);
    if (seenIds.has(message.id)) throw new Error('Duplicate request');
    if (seenIds.size >= 10000) throw new Error('Reconnect the local helper');
    seenIds.add(message.id);
  } catch {
    send({ id: typeof raw?.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(raw.id) ? raw.id : 'invalid', type: 'result', ok: false, error: 'Invalid or unsupported local request.' }); return;
  }
  const { id, type, payload } = message;
  if (type === 'cancel') { pending.get(payload.requestId)?.abort(); send({ id, type: 'result', ok: true }); return; }
  if (type === 'status') {
    try { const models = await availableModels(); send({ id, type: 'status', ok: true, models, message: models.length ? 'Private local runtime ready.' : 'No verified local chat model is installed. Search and screening still work without it.' }); }
    catch { send({ id, type: 'status', ok: false, models: [], message: 'Local Ollama is unavailable. Install Ollama and a local model, then reconnect.' }); }
    return;
  }
  if (pending.size) { send({ id, type: 'result', ok: false, error: 'A local request is already running. Stop it before starting another.' }); return; }
  const controller = new AbortController();
  pending.set(id, controller);
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const models = await availableModels();
    if (controller.signal.aborted) throw new Error('Cancelled');
    if (!await ownsListener()) throw new Error('Local runtime ownership lost');
    if (!models.some(model => model.name === payload.model)) throw new Error('Unknown local model');
    const response = await fetch(`${endpoint}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, redirect: 'error', body: JSON.stringify({ model: payload.model, prompt: payload.prompt, stream: false, options: { temperature: 0, num_predict: 512, num_ctx: 4096 }, keep_alive: '1m' }) });
    if (!response.ok) throw new Error('Local inference failed');
    const reader = response.body.getReader();
    let bytes = 0;
    const chunks = [];
    while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 256 * 1024) { await reader.cancel(); throw new Error('Local response too large'); } chunks.push(Buffer.from(value)); }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (result.remote_host || result.remote_model || typeof result.response !== 'string' || result.response.length > MAX_RESPONSE_CHARS) throw new Error('Invalid local response');
    send({ id, type: 'result', ok: true, text: result.response });
  } catch { send({ id, type: 'result', ok: false, error: controller.signal.aborted ? 'Local analysis stopped or timed out. Your results are preserved.' : 'Local analysis is unavailable. Your results are preserved.' }); }
  finally { clearTimeout(timeout); pending.delete(id); }
}
const decoder = new MessageDecoder(message => { void handle(message); }, () => { process.stderr.write('Treatable rejected an invalid native message.\n'); shutdown(); });
process.stdin.on('data', chunk => decoder.push(chunk));
process.stdin.on('end', () => { decoder.end(); shutdown(); });
process.stdin.on('error', shutdown);
