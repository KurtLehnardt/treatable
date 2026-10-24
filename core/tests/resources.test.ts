// Mocked: no network. Integrity checks ported from loadPublicCorpus (extension/native/real.mjs at 48c569e).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadJsonResource, loadResource } from '../src/resources.ts';
import { CoreError } from '../src/errors.ts';
import { createCancelSource } from '../src/cancel.ts';
import { testPorts, sha256Hex } from './support/fakes.ts';

const json = new TextEncoder().encode(JSON.stringify({ zips: { '01001': { lat: 42.06, lon: -72.61 } } }));
const digest = sha256Hex(new TextDecoder().decode(json));
const isCode = (code: string) => (e: unknown) => e instanceof CoreError && e.code === code;

test('loadJsonResource returns parsed JSON when size, digest and UTF-8 are valid', async () => {
  const ports = testPorts({ 'zip-centroids.v1.json': json });
  assert.deepEqual(await loadJsonResource(ports, { id: 'zip-centroids.v1.json', maxBytes: 1024, sha256: digest }), { zips: { '01001': { lat: 42.06, lon: -72.61 } } });
  assert.deepEqual(await loadResource(ports, { id: 'zip-centroids.v1.json', maxBytes: 1024 }), json);
});

test('identifiers are never paths, and every integrity failure is RESOURCE_INVALID', async () => {
  const ports = testPorts({
    'zip-centroids.v1.json': json,
    'bad-utf8.json': new Uint8Array([0x7b, 0xff, 0x7d]),
    'bad-json.json': new TextEncoder().encode('{nope'),
  });
  for (const id of ['../etc/passwd', '/abs.json', 'UPPER.json', 'a/b.json', '', 'x..json', '.hidden']) {
    await assert.rejects(loadResource(ports, { id, maxBytes: 1024 }), isCode('RESOURCE_INVALID'), id);
  }
  await assert.rejects(loadResource(ports, { id: 'zip-centroids.v1.json', maxBytes: 10 }), isCode('RESOURCE_INVALID'));
  await assert.rejects(loadResource(ports, { id: 'zip-centroids.v1.json', maxBytes: 1024, sha256: '0'.repeat(64) }), isCode('RESOURCE_INVALID'));
  await assert.rejects(loadResource(ports, { id: 'zip-centroids.v1.json', maxBytes: 1024, sha256: 'BAD' }), isCode('RESOURCE_INVALID'));
  await assert.rejects(loadResource(ports, { id: 'missing.json', maxBytes: 1024 }), isCode('RESOURCE_INVALID'));
  await assert.rejects(loadJsonResource(ports, { id: 'bad-utf8.json', maxBytes: 1024 }), isCode('RESOURCE_INVALID'));
  await assert.rejects(loadJsonResource(ports, { id: 'bad-json.json', maxBytes: 1024 }), isCode('RESOURCE_INVALID'));
  await assert.rejects(loadResource(ports, { id: 'zip-centroids.v1.json', maxBytes: 64 * 1024 * 1024 }), isCode('RESOURCE_INVALID'));
  const lying = { ...ports, loader: { load: async () => new Uint8Array(4096) } };
  await assert.rejects(loadResource(lying, { id: 'zip-centroids.v1.json', maxBytes: 100 }), isCode('RESOURCE_INVALID'), 'a loader that ignores maxBytes is caught');
  const cancel = createCancelSource();
  cancel.cancel();
  await assert.rejects(loadResource(ports, { id: 'zip-centroids.v1.json', maxBytes: 1024 }, cancel.signal), isCode('CANCELLED'));
});
