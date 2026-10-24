/**
 * Node reference implementations of the core ports.
 *
 * These live outside core/src on purpose: core/src must stay runtime-neutral, and only hosts may use
 * Node built-ins. The desktop helper (task A6a) can use or adapt them; the mobile app supplies its
 * own ports. None of these functions logs, persists, or prints anything.
 */
import { createHash, randomBytes } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import https from 'node:https';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { CancelSignal, Clock, CorePorts, Loader, Sha256, TokenSource, Transport, TransportRequest, TransportResponse } from '../src/ports.ts';
import { RESOURCE_ID_PATTERN } from '../src/resources.ts';

export const nodeSha256: Sha256 = {
  digestHex(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
  },
};

export const nodeTokens: TokenSource = {
  randomBytes(length) {
    if (!Number.isSafeInteger(length) || length < 1 || length > 1024) throw new RangeError('Invalid random byte length');
    return new Uint8Array(randomBytes(length));
  },
};

export const nodeClock: Clock = {
  now: () => Date.now(),
  monotonic: () => performance.now(),
  schedule(delayMs, callback) {
    const timer = setTimeout(callback, Math.max(0, delayMs));
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};

/**
 * Loader over an explicit map of resource IDs to files inside one directory. IDs never become
 * paths directly; symbolic links and files outside the root are refused, and the size is checked
 * before and while reading.
 */
export function createNodeLoader(root: string, files: Readonly<Record<string, string>>): Loader {
  return {
    async load(resourceId, maxBytes) {
      if (!RESOURCE_ID_PATTERN.test(resourceId) || !Object.prototype.hasOwnProperty.call(files, resourceId)) {
        throw new Error('Unknown resource');
      }
      const realRoot = await realpath(root);
      const candidate = path.resolve(realRoot, files[resourceId] as string);
      const info = await lstat(candidate);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unknown resource');
      const resolved = await realpath(candidate);
      if (!resolved.startsWith(realRoot + path.sep)) throw new Error('Unknown resource');
      if (info.size > maxBytes) throw new Error('Resource too large');
      const handle = await open(resolved, 'r');
      try {
        const buffer = new Uint8Array(Math.min(maxBytes + 1, info.size + 1));
        let total = 0;
        for (;;) {
          const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
          if (bytesRead === 0) break;
          total += bytesRead;
          if (total > maxBytes) throw new Error('Resource too large');
          if (total === buffer.length) break;
        }
        return buffer.slice(0, total);
      } finally {
        await handle.close();
      }
    },
  };
}

type RequestFunction = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;

function toAbortSignal(signal: CancelSignal | undefined): AbortSignal | undefined {
  if (!signal) return undefined;
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', () => controller.abort(), { once: true });
  return controller.signal;
}

function lowerCaseHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return out;
}

async function* chunks(response: IncomingMessage): AsyncIterable<Uint8Array> {
  try {
    for await (const chunk of response) yield new Uint8Array(chunk as Uint8Array);
  } finally {
    response.destroy();
  }
}

/**
 * HTTPS-only transport over node:https with certificate validation, no connection reuse, and no
 * redirects. `request` is injectable so tests can capture exactly what would be sent without any
 * network access (the same technique as extension/native/test/real.test.mjs).
 */
export function createNodeTransport({ request = https.request as RequestFunction }: { request?: RequestFunction } = {}): Transport {
  return {
    request(input: TransportRequest): Promise<TransportResponse> {
      return new Promise((resolve, reject) => {
        let url: URL;
        try {
          url = new URL(input.url);
        } catch {
          reject(new Error('Invalid URL'));
          return;
        }
        if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
          reject(new Error('Only plain https URLs are allowed'));
          return;
        }
        if (input.signal?.aborted) {
          reject(new Error('Cancelled'));
          return;
        }
        const body = input.body;
        const signal = toAbortSignal(input.signal);
        const options: RequestOptions = {
          protocol: 'https:',
          hostname: url.hostname,
          port: url.port ? Number(url.port) : 443,
          path: `${url.pathname}${url.search}`,
          method: input.method,
          headers: { ...input.headers, ...(body ? { 'Content-Length': String(body.length) } : {}) },
          agent: false,
          rejectUnauthorized: true,
          ...(signal ? { signal } : {}),
        } as RequestOptions;
        const req = request(options, response => {
          resolve({
            status: response.statusCode ?? 0,
            headers: lowerCaseHeaders(response.headers),
            body: chunks(response),
          });
        });
        req.on('error', () => reject(new Error(signal?.aborted ? 'Cancelled' : 'Network error')));
        if (body) req.write(body);
        req.end();
      });
    },
  };
}

/** A reference port set for Node hosts. `loader` defaults to one that knows no resources. */
export function createNodePorts(overrides: Partial<CorePorts> = {}): CorePorts {
  return {
    transport: overrides.transport ?? createNodeTransport(),
    sha256: overrides.sha256 ?? nodeSha256,
    tokens: overrides.tokens ?? nodeTokens,
    clock: overrides.clock ?? nodeClock,
    loader: overrides.loader ?? createNodeLoader('.', {}),
  };
}
