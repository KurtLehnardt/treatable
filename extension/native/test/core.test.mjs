import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { EXTENSION_ID, MAX_MESSAGE_BYTES, MessageDecoder, encodeMessage, validateOrigin, validateRequest, hasLocalWeights, localModels } from '../core.mjs';

const origin = `chrome-extension://${EXTENSION_ID}/`;
test('only the exact pinned extension origin is allowed', () => {
  assert.equal(validateOrigin(origin), true);
  for (const invalid of ['https://clinicaltrials.gov', `${origin}extra`, origin.slice(0,-1), 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/', undefined]) assert.equal(validateOrigin(invalid), false);
});
test('framing handles fragmentation and multiple messages without losing identities', () => {
  const received = []; const errors = [];
  const decoder = new MessageDecoder(value => received.push(value), error => errors.push(error));
  const frames = Buffer.concat([encodeMessage({ id: 'a', type: 'status', payload: {} }), encodeMessage({ id: 'b', type: 'cancel', payload: { requestId: 'a' } })]);
  for (let index = 0; index < frames.length; index += 3) decoder.push(frames.subarray(index, index + 3));
  decoder.end(); assert.deepEqual(received.map(value => value.id), ['a','b']); assert.equal(errors.length, 0);
});
test('oversized/zero/malformed/incomplete frames fail without echoing content', () => {
  for (const length of [0, MAX_MESSAGE_BYTES + 1]) {
    const errors = []; const decoder = new MessageDecoder(() => assert.fail(), error => errors.push(error));
    const header = Buffer.alloc(4); header.writeUInt32LE(length); decoder.push(header);
    assert.equal(errors.length, 1); assert.equal(errors[0].message, 'Invalid native message');
  }
  const errors=[]; const decoder = new MessageDecoder(() => assert.fail(), error => errors.push(error));
  decoder.push(Buffer.from([10,0,0,0,123])); decoder.end(); assert.equal(errors[0].message,'Incomplete native message');
});
test('typed operations reject arbitrary URLs, commands, cloud names and excess prompts', () => {
  assert.equal(validateRequest({id:'ok',type:'generate',payload:{model:'qwen2.5:0.5b',prompt:'fictional'}}).id,'ok');
  const invalid = [
    {id:'x',type:'fetch',payload:{url:'https://example.org'}},
    {id:'x',type:'status',payload:{url:'https://example.org'}},
    {id:'x',type:'generate',payload:{model:'../model',prompt:'fictional'}},
    {id:'x',type:'generate',payload:{model:'remote:cloud',prompt:'fictional'}},
    {id:'x',type:'generate',payload:{model:'qwen2.5:0.5b',prompt:'x'.repeat(24001)}},
    {id:'x',type:'generate',payload:{model:'qwen2.5:0.5b',prompt:'fictional',tools:[]}},
    {id:'x',type:'cancel',payload:{requestId:'../x'}},
    {id:'x',type:'status',payload:{},command:'sh'}
  ];
  for (const request of invalid) assert.throws(() => validateRequest(request));
});
async function modelFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(),'treatable-native-model-'));
  const digest = `sha256:${'a'.repeat(64)}`;
  await mkdir(path.join(root,'manifests','registry.ollama.ai','library','sample'),{recursive:true});
  await mkdir(path.join(root,'blobs'));
  await writeFile(path.join(root,'blobs',digest.replace(':','-')),'weights');
  const manifestPath=path.join(root,'manifests','registry.ollama.ai','library','sample','latest');
  await writeFile(manifestPath,JSON.stringify({layers:[{mediaType:'application/vnd.ollama.image.model',digest,size:7}]}));
  return {root,manifestPath};
}
test('a local manifest needs actual complete local weight blobs',async()=>{
  const {root,manifestPath}=await modelFixture();
  try {
    assert.equal(await hasLocalWeights(root,'sample:latest'),true);
    assert.equal(await hasLocalWeights(root,'../sample:latest'),false);
    assert.equal(await hasLocalWeights(root,'missing:latest'),false);
    await writeFile(path.join(root,'blobs',`sha256-${'a'.repeat(64)}`),'partial');
    // Same byte count but later missing blob is rejected; manifest metadata cannot enable cloud.
    await rm(path.join(root,'blobs',`sha256-${'a'.repeat(64)}`));
    assert.equal(await hasLocalWeights(root,'sample:latest'),false);
    await writeFile(manifestPath,JSON.stringify({remote_host:'https://cloud.invalid',layers:[]}));
    assert.equal(await hasLocalWeights(root,'sample:latest'),false);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('remote aliases without cloud in the name are rejected by positive local and capability checks',async()=>{
  const {root}=await modelFixture();
  try {
    const tags={models:[{name:'sample:latest',size:7}]};
    assert.equal((await localModels(tags,async()=>({capabilities:['completion']}),root)).length,1);
    assert.equal((await localModels(tags,async()=>({capabilities:['completion'],remote_host:'https://remote.invalid'}),root)).length,0);
    assert.equal((await localModels(tags,async()=>({capabilities:['completion'],remote_model:'alias'}),root)).length,0);
    assert.equal((await localModels(tags,async()=>({capabilities:['embedding']}),root)).length,0);
    assert.equal((await localModels({models:[{name:'unknown:latest',size:999}]},async()=>({capabilities:['completion']}),root)).length,0);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('isolated-home install is durable, exact-origin, idempotent and uninstall retains models',async()=>{
  const home=await mkdtemp(path.join(os.tmpdir(),'treatable-native-home-'));
  try {
    const installer=new URL('../install.mjs',import.meta.url).pathname;
    const command=['--home',home,'--ollama',process.execPath];
    for(let count=0;count<2;count++) {const run=spawnSync(process.execPath,[installer,...command],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);}
    const host=JSON.parse(await readFile(path.join(home,'Library','Application Support','Google','Chrome','NativeMessagingHosts','com.treatable.local.json'),'utf8'));
    assert.deepEqual(host.allowed_origins,[origin]);
    assert.ok(host.path.startsWith(home)); assert.ok(!host.path.includes('.Codex'));
    const launch=await readFile(host.path,'utf8');assert.ok(launch.includes(process.execPath));
    assert.equal((await stat(path.dirname(host.path))).mode&0o777,0o700);
    const wrong=spawnSync(process.execPath,[path.join(path.dirname(host.path),'host.mjs'),'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'],{encoding:'utf8'});
    assert.equal(wrong.status,1); assert.equal(wrong.stdout,'');assert.ok(!wrong.stderr.includes('fictional'));
    await mkdir(path.join(home,'.ollama','models'),{recursive:true});
    const uninstall=spawnSync(process.execPath,[installer,'--home',home,'--uninstall'],{encoding:'utf8'});assert.equal(uninstall.status,0,uninstall.stderr);
    await access(path.join(home,'.ollama','models'));
    await assert.rejects(access(host.path));
  } finally {await rm(home,{recursive:true,force:true});}
});
test('host generation cannot reuse an existing daemon and never inherits cloud/proxy credentials',async()=>{
  const source=await readFile(new URL('../host.mjs',import.meta.url),'utf8');
  assert.match(source,/OLLAMA_NO_CLOUD: '1'/);assert.match(source,/OLLAMA_DEBUG: '0'/);assert.match(source,/stdio: 'ignore'/);
  assert.match(source,/ownsListener\(\)/);assert.match(source,/config\.lsofPath/);
  assert.ok(!source.includes('...process.env'));assert.ok(!source.includes('OPENAI'));
});
