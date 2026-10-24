import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const HOST_NAME = 'com.treatable.local';
export const EXTENSION_ID = 'lmgmjeabbalehlcakdbolielnfgchojf';
export const MAX_MESSAGE_BYTES = 96 * 1024;
export const MAX_PROMPT_CHARS = 24000;
export const MAX_RESPONSE_CHARS = 40000;
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
export const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,100}(?::[A-Za-z0-9._-]{1,80})?$/;

export function validateOrigin(origin, extensionId = EXTENSION_ID) {
  return /^[a-p]{32}$/.test(extensionId) && origin === `chrome-extension://${extensionId}/`;
}

export function validateRequest(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || !ID_PATTERN.test(message.id ?? '')) throw new Error('Invalid request');
  if (!['status', 'generate', 'cancel'].includes(message.type)) throw new Error('Unsupported operation');
  const payload = message.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid payload');
  if (message.type === 'generate') {
    if (typeof payload.model !== 'string' || !MODEL_PATTERN.test(payload.model) || /cloud/i.test(payload.model)) throw new Error('Only installed local models are allowed');
    if (typeof payload.prompt !== 'string' || !payload.prompt.trim() || payload.prompt.length > MAX_PROMPT_CHARS) throw new Error('Invalid prompt size');
    if (Object.keys(payload).some(key => !['model', 'prompt'].includes(key))) throw new Error('Unsupported generation option');
  } else if (message.type === 'cancel') {
    if (!ID_PATTERN.test(payload.requestId ?? '')) throw new Error('Invalid cancellation');
    if (Object.keys(payload).some(key => key !== 'requestId')) throw new Error('Unsupported cancellation option');
  } else if (Object.keys(payload).length) throw new Error('Unsupported status option');
  if (Object.keys(message).some(key => !['id', 'type', 'payload'].includes(key))) throw new Error('Unsupported request option');
  return message;
}

export function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > MAX_MESSAGE_BYTES) throw new Error('Response too large');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

export class MessageDecoder {
  constructor(onMessage, onError) { this.buffer = Buffer.alloc(0); this.onMessage = onMessage; this.onError = onError; this.failed = false; }
  push(chunk) {
    if (this.failed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      while (this.buffer.length >= 4) {
        const length = this.buffer.readUInt32LE(0);
        if (!length || length > MAX_MESSAGE_BYTES) throw new Error('Invalid frame size');
        if (this.buffer.length < length + 4) return;
        const body = this.buffer.subarray(4, length + 4);
        this.buffer = this.buffer.subarray(length + 4);
        this.onMessage(JSON.parse(body.toString('utf8')));
      }
    } catch {
      this.failed = true; this.buffer = Buffer.alloc(0); this.onError(new Error('Invalid native message'));
    }
  }
  end() { if (this.buffer.length && !this.failed) { this.failed = true; this.onError(new Error('Incomplete native message')); } }
}

export async function hasLocalWeights(modelsDir, model) {
  if (!MODEL_PATTERN.test(model) || /cloud/i.test(model)) return false;
  const [name, tag = 'latest'] = model.split(':');
  try {
    const manifestPath = path.join(modelsDir, 'manifests', 'registry.ollama.ai', 'library', name, tag);
    const info = await stat(manifestPath);
    if (!info.isFile() || info.size > 1024 * 1024) return false;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.remote_host || manifest.remote_model) return false;
    const layers = manifest.layers?.filter(layer => layer.mediaType === 'application/vnd.ollama.image.model');
    if (!layers?.length) return false;
    for (const layer of layers) {
      if (!/^sha256:[a-f0-9]{64}$/.test(layer.digest) || !Number.isSafeInteger(layer.size) || layer.size <= 0) return false;
      const blob = await stat(path.join(modelsDir, 'blobs', layer.digest.replace(':', '-')));
      if (!blob.isFile() || blob.size !== layer.size) return false;
    }
    return true;
  } catch { return false; }
}

export async function localModels(tags, showModel, modelsDir) {
  const models = [];
  for (const item of (Array.isArray(tags?.models) ? tags.models : []).slice(0, 100)) {
    const name = item.name;
    if (typeof name !== 'string' || !MODEL_PATTERN.test(name) || /cloud/i.test(name) || item.remote_host || item.remote_model) continue;
    if (!await hasLocalWeights(modelsDir, name)) continue;
    try {
      const info = await showModel(name);
      if (info.remote_host || info.remote_model || !Array.isArray(info.capabilities) || !info.capabilities.includes('completion')) continue;
      models.push({ name, size: Number.isSafeInteger(item.size) && item.size > 0 ? item.size : undefined });
    } catch { /* Unknown or unavailable models are never offered. */ }
  }
  return models;
}
