// Mocked: no network. Node reference ports (core/node/ports.node.ts). The HTTPS transport is exercised
// with an injected request function, the technique extension/native/test/real.test.mjs uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createNodeLoader, createNodePorts, createNodeTransport, nodeClock, nodeSha256, nodeTokens } from '../node/ports.node.ts';
import { assertPorts } from '../src/ports.ts';
import { createCancelSource } from '../src/cancel.ts';
import { readBounded, utf8Encode } from '../src/bytes.ts';

test('sha256, token and clock reference ports', async () => {
  assert.equal(await nodeSha256.digestHex(utf8Encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const a = await nodeTokens.randomBytes(32);
  const b = await nodeTokens.randomBytes(32);
  assert.equal(a.length, 32);
  assert.notDeepEqual(a, b);
  assert.throws(() => nodeTokens.randomBytes(0));
  assert.ok(Number.isSafeInteger(nodeClock.now()));
  const t0 = nodeClock.monotonic();
  let fired = 0;
  const cancel = nodeClock.schedule(5, () => (fired += 1));
  cancel();
  // nodeClock's timers are unref'd by design (a pending timer must not keep a host process alive
  // on its own), so the test has to pin the event loop itself while it waits on one; otherwise the
  // runner sees an empty loop and cancels the whole file ("promise resolution is still pending").
  const keepAlive = setTimeout(() => undefined, 5_000);
  try {
    await new Promise(resolve => nodeClock.schedule(10, () => resolve(undefined)));
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(fired, 0, 'a cancelled timer never fires');
  assert.ok(nodeClock.monotonic() >= t0);
  assertPorts(createNodePorts());
});

test('the loader reads only mapped files inside its root, bounded, and refuses links that escape', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'treatable-core-loader-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'treatable-core-outside-'));
  try {
    await writeFile(path.join(dir, 'zips.json'), '{"ok":true}');
    await writeFile(path.join(outside, 'secret.json'), '{"secret":true}');
    await symlink(path.join(outside, 'secret.json'), path.join(dir, 'link.json'));
    await mkdir(path.join(dir, 'sub'));
    await symlink(outside, path.join(dir, 'sub', 'escape'));
    const loader = createNodeLoader(dir, { 'zips.json': 'zips.json', 'link.json': 'link.json', 'escape.json': 'sub/escape/secret.json', 'parent.json': '../x.json' });
    assert.equal(new TextDecoder().decode(await loader.load('zips.json', 100)), '{"ok":true}');
    await assert.rejects(loader.load('zips.json', 5));
    await assert.rejects(loader.load('link.json', 100));
    await assert.rejects(loader.load('escape.json', 100));
    await assert.rejects(loader.load('parent.json', 100));
    await assert.rejects(loader.load('unmapped.json', 100));
    await assert.rejects(loader.load('../zips.json', 100));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

type Captured = { options: Record<string, any>; body: string };

function fakeHttps(status = 200, chunks: string[] = ['{"ok":true}']) {
  const captured: Captured[] = [];
  const request = (options: Record<string, any>, callback: (response: any) => void) => {
    const req = new EventEmitter() as EventEmitter & { write: (c: Uint8Array) => void; end: () => void };
    let body = '';
    req.write = chunk => {
      body += Buffer.from(chunk).toString('utf8');
    };
    req.end = () => {
      queueMicrotask(() => {
        captured.push({ options, body });
        if (options.signal?.aborted) {
          req.emit('error', new Error('aborted'));
          return;
        }
        const response = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, unknown> };
        response.statusCode = status;
        response.headers = { 'Content-Type': 'application/json', 'set-cookie': ['a=1', 'b=2'] };
        callback(response);
        for (const chunk of chunks) response.write(chunk);
        response.end();
      });
    };
    return req;
  };
  return { request: request as never, captured };
}

test('the HTTPS transport sends exactly the given bytes with certificate validation and no connection reuse', async () => {
  const fake = fakeHttps(201, ['{"a":', '1}']);
  const transport = createNodeTransport({ request: fake.request });
  const body = utf8Encode(JSON.stringify({ hello: 'wörld' }));
  const response = await transport.request({ method: 'POST', url: 'https://api.openai.com/v1/decisions', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal(response.status, 201);
  assert.equal(response.headers['content-type'], 'application/json');
  assert.equal(response.headers['set-cookie'], 'a=1, b=2');
  assert.equal(new TextDecoder().decode(await readBounded(response.body, 100)), '{"a":1}');
  const { options } = fake.captured[0]!;
  assert.equal(options.hostname, 'api.openai.com');
  assert.equal(options.port, 443);
  assert.equal(options.path, '/v1/decisions');
  assert.equal(options.method, 'POST');
  assert.equal(options.agent, false);
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.headers['Content-Length'], String(body.length));
  assert.equal(fake.captured[0]!.body, JSON.stringify({ hello: 'wörld' }));
});

test('the HTTPS transport refuses non-https URLs, embedded credentials, and cancelled requests', async () => {
  const fake = fakeHttps();
  const transport = createNodeTransport({ request: fake.request });
  for (const url of ['http://api.openai.com/v1/decisions', 'https://user:pass@api.openai.com/v1/decisions', 'file:///etc/passwd', 'not a url', 'https://api.openai.com/v1/decisions#frag']) {
    await assert.rejects(transport.request({ method: 'GET', url, headers: {} }), url);
  }
  const cancel = createCancelSource();
  cancel.cancel();
  await assert.rejects(transport.request({ method: 'GET', url: 'https://api.openai.com/v1/decisions', headers: {}, signal: cancel.signal }));
  assert.equal(fake.captured.length, 0);
});
