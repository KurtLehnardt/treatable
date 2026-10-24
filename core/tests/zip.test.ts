// Mocked: no network. The offline ZIP lookup (task A1b) against the real bundled table, the node
// loader, and tampered tables. Ported from the resolveZip cases of extension/tests/core.test.ts
// (the corpus test: leading zeros, ZIP+4, unknown ZIP) and the ZIP-resolution tests of
// scaffold/lib/studies/__tests__/clinical.test.ts ("offline ZIP resolution preserves leading zeros
// and normalizes ZIP+4").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoreError } from '../src/errors.ts';
import { createNodeLoader, nodeSha256 } from '../node/ports.node.ts';
import { testPorts } from './support/fakes.ts';
import { loadZipTable, resolveZip, ZIP_RESOURCE, ZipTableSchema, type ZipTable } from '../src/zip.ts';

const CORE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_BYTES = new Uint8Array(await readFile(path.join(CORE_ROOT, 'data', 'zip-centroids.v1.json')));

const resourceInvalid = (e: unknown): boolean => e instanceof CoreError && e.code === 'RESOURCE_INVALID';
const invalidRequest = (e: unknown): boolean => e instanceof CoreError && e.code === 'INVALID_REQUEST';

/** Loads the real table once for the tests in this file (fake loader, real ports). */
async function realTable(): Promise<ZipTable> {
  return loadZipTable({ loader: testPorts({ 'zip-centroids.v1.json': REAL_BYTES }).loader, sha256: nodeSha256 });
}

test('the bundled table is byte-identical to the audited scaffold source and pinned by sha-256', async () => {
  const scaffold = new Uint8Array(await readFile(path.join(CORE_ROOT, '..', 'scaffold', 'data', 'us-zip-centroids.json')));
  assert.equal(REAL_BYTES.length, scaffold.length);
  assert.equal(await nodeSha256.digestHex(REAL_BYTES), await nodeSha256.digestHex(scaffold));
  assert.equal(await nodeSha256.digestHex(REAL_BYTES), ZIP_RESOURCE.sha256, 'the pinned hash matches the shipped bytes');
  assert.equal(ZIP_RESOURCE.id, 'zip-centroids.v1.json');
});

test('loadZipTable loads and validates the real table through the node loader', async () => {
  const loader = createNodeLoader(CORE_ROOT, { 'zip-centroids.v1.json': 'data/zip-centroids.v1.json' });
  const table = await loadZipTable({ loader, sha256: nodeSha256 });
  assert.equal(Object.keys(table.zips).length, 41488);
  assert.equal(table.license, 'CC BY 4.0');
  assert.match(table.attribution ?? '', /GeoNames/);
  // A leading-zero ZIP survives as a key, and the parsed entry keeps city, state, and coordinates.
  assert.deepEqual(table.zips['01001'], { city: 'Agawam', state: 'MA', lat: 42.0702, lon: -72.6227 });
});

test('[ported tests/core.test.ts, clinical.test.ts "offline ZIP..."] resolveZip normalizes ZIP+4, keeps leading zeros, and rejects bad input', async () => {
  const table = await realTable();
  const zipPlus4 = resolveZip('01001-1234', table);
  assert.equal(zipPlus4.zip, '01001');
  assert.deepEqual(zipPlus4, { zip: '01001', city: 'Agawam', state: 'MA', lat: 42.0702, lon: -72.6227 });
  assert.equal(resolveZip('83702', table).city, 'Boise');
  assert.equal(resolveZip(' 02108-1234 ', table).zip, '02108', 'trimmed and normalized');
  for (const bad of ['', ' ', '8370', '837023', '123456', 'abcde', '02108-12', '02108-12345', '00000', '8)7202']) {
    assert.throws(() => resolveZip(bad, table), invalidRequest, JSON.stringify(bad));
  }
});

test('[NIT-1] like the extension, resolveZip refuses control characters, tabs, and line breaks before trimming', async () => {
  const table = await realTable();
  for (const bad of ['83702\n', '83702\r\n', '\n83702', '\t83702', '83702\t', '83702\u0000', '83702\u007f', '‮83702', '83702\ud800']) {
    assert.throws(() => resolveZip(bad, table), invalidRequest, JSON.stringify(bad));
  }
  // Plain spaces are still trimmed, as boundedText and the scaffold did.
  assert.equal(resolveZip(' 83702 ', table).city, 'Boise');
  assert.throws(() => resolveZip(83702 as never, table), invalidRequest, 'not a string');
});

test('[MINOR-3] APO/FPO ZIPs (empty state in the table) are refused, as the extension refused them', async () => {
  const table = await realTable();
  // 34002 (APO AA) has a centroid in Panama, 09001 (APO AE) one in Italy: neither may become a
  // distance origin.
  assert.deepEqual(table.zips['34002'], { city: 'APO AA', state: '', lat: 8.9733, lon: -79.5556 });
  assert.throws(() => resolveZip('34002', table), invalidRequest);
  assert.throws(() => resolveZip('34002-1234', table), invalidRequest);
  assert.throws(() => resolveZip('09001', table), invalidRequest);
  // Over the whole table: exactly the 509 empty-state entries are refused, all APO/FPO, and every
  // other entry resolves with a two-letter state.
  const refused: string[] = [];
  for (const [zip, entry] of Object.entries(table.zips)) {
    try {
      const resolved = resolveZip(zip, table);
      assert.match(resolved.state, /^[A-Z]{2}$/, zip);
    } catch (error) {
      assert.ok(invalidRequest(error), zip);
      assert.equal(entry.state, '', zip);
      assert.match(entry.city, /^(?:APO|FPO) /, zip);
      refused.push(zip);
    }
  }
  assert.equal(refused.length, 509);
  // The two Marshall Islands entries carry state code MH and resolve, as they did in the extension.
  // MH is not one of the protocol's US_STATES, so callers must not treat ResolvedZip.state as one.
  assert.equal(resolveZip('96960', table).state, 'MH');
});

test('loadZipTable fails closed on unknown resources and tampered bytes', async () => {
  const ports = { loader: testPorts({ 'zip-centroids.v1.json': REAL_BYTES }).loader, sha256: nodeSha256 };
  assert.ok((await loadZipTable(ports)) !== undefined, 'sanity: the real table loads');
  await assert.rejects(
    loadZipTable({ loader: testPorts({ 'zip-centroids.v1.json': REAL_BYTES.subarray(0, 1000) }).loader, sha256: nodeSha256 }),
    resourceInvalid,
  );
  const flipped = new Uint8Array(REAL_BYTES);
  const last = flipped.length - 5;
  flipped[last] = (flipped[last] ?? 0) ^ 0x01;
  await assert.rejects(loadZipTable({ loader: testPorts({ 'zip-centroids.v1.json': flipped }).loader, sha256: nodeSha256 }), resourceInvalid);
  await assert.rejects(
    loadZipTable({ loader: testPorts({ 'zip-centroids.v1.json': new Uint8Array([0x7b]) }).loader, sha256: nodeSha256 }),
    resourceInvalid,
  );
  await assert.rejects(loadZipTable({ loader: testPorts({}).loader, sha256: nodeSha256 }), resourceInvalid, 'unknown resource id');
});

test('the table schema rejects tampered tables even before the pinned hash matters', async () => {
  const base = JSON.parse(new TextDecoder().decode(REAL_BYTES)) as Record<string, unknown>;
  // One typed view of the Agawam entry, since noUncheckedIndexedAccess makes every direct
  // record access a nullable-lookup error the edit lambda does not need to re-litigate.
  const entry = (draft: Record<string, unknown>): Record<string, any> => (draft.zips as Record<string, any>)['01001'];
  const edit = (change: (draft: Record<string, unknown>) => void): unknown => {
    const draft = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    change(draft);
    return draft;
  };
  const cases: [string, unknown][] = [
    ['unknown top-level key', edit(d => { d.surprise = 'x'; })],
    ['missing zips', edit(d => { delete d.zips; })],
    ['not an object', [1, 2, 3]],
    ['bad state code', edit(d => { entry(d).state = 'ma'; })],
    ['city with a control character', edit(d => { entry(d).city = 'A\tb'; })],
    ['latitude out of range', edit(d => { entry(d).lat = 999; })],
    ['longitude as a string', edit(d => { entry(d).lon = '-116'; })],
    ['four-digit ZIP key', edit(d => { const z = d.zips as Record<string, unknown>; z['0100'] = z['01001'] as unknown; delete z['01001']; })],
  ];
  for (const [name, value] of cases) assert.equal(ZipTableSchema.safeParse(value).success, false, name);
  assert.equal(ZipTableSchema.safeParse(base).success, true, 'the untouched real table parses');
});
