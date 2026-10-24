import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PhiNotice, NOT_PHI_READY, BAA_ATTESTED_NOTE} from '../src/notices';
import {saveApiKey, loadApiKey, clearApiKey, KEY_STORAGE_KEY, type StorageArea} from '../src/storage';

class Area implements StorageArea {
  data: Record<string, unknown> = {};
  async get(key: string) { return {[key]: this.data[key]}; }
  async set(value: Record<string, unknown>) { Object.assign(this.data, value); }
  async remove(key: string) { delete this.data[key]; }
}

test('OpenAI mode without BAA attestation shows the persistent Not PHI-ready banner', () => {
  const html = renderToStaticMarkup(<PhiNotice openaiActive={true} baaAttested={false}/>);
  assert.ok(html.includes(NOT_PHI_READY));
  assert.match(html, /role="alert"/);
  assert.ok(!html.includes(BAA_ATTESTED_NOTE));
});

test('with attestation the softer responsibility note shows; nothing shows outside OpenAI mode', () => {
  const html = renderToStaticMarkup(<PhiNotice openaiActive={true} baaAttested={true}/>);
  assert.ok(html.includes(BAA_ATTESTED_NOTE));
  assert.ok(!html.includes(NOT_PHI_READY));
  assert.doesNotMatch(html, /HIPAA[- ]compliant/i);
  assert.equal(renderToStaticMarkup(<PhiNotice openaiActive={false} baaAttested={false}/>), '');
});

test('key and attestation persist together: session by default, local only on Remember, cleared together', async () => {
  const session = new Area(), local = new Area();
  await saveApiKey(session, local, 'sk-test-key-123456789', false, true);
  assert.deepEqual(session.data[KEY_STORAGE_KEY], {key: 'sk-test-key-123456789', baaAttested: true});
  assert.equal(local.data[KEY_STORAGE_KEY], undefined);
  await saveApiKey(session, local, 'sk-test-key-123456789', true, false);
  assert.equal(session.data[KEY_STORAGE_KEY], undefined);
  assert.deepEqual(await loadApiKey(session, local), {key: 'sk-test-key-123456789', baaAttested: false});
  await clearApiKey(session, local);
  assert.deepEqual(await loadApiKey(session, local), {key: '', baaAttested: false});
});

test('Phase 1 (no policy gate): attestation can never soften the Not PHI-ready alert', () => {
  const html = renderToStaticMarkup(<PhiNotice openaiActive={true} baaAttested={true} attestationEnabled={false}/>);
  assert.ok(html.includes(NOT_PHI_READY));
  assert.match(html, /role="alert"/);
  assert.ok(!html.includes(BAA_ATTESTED_NOTE));
});
