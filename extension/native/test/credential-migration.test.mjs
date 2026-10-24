// Keychain item rename to com.treatable.openai and the migration from the item of earlier versions.
// The Swift checks compile credential.swift with TREATABLE_CREDENTIAL_TESTS, which leaves out the real Keychain
// backend, and run them against an in-memory store. No test here reads or writes a real Keychain.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCredentialStatus,describeCredentialStatus,outdatedHelperMessage,STATUS_UNREADABLE} from '../credentials.mjs';

const native=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source=path.join(native,'credential.swift'),harness=path.join(native,'test','credential-migration-harness.swift');
const fakeKeys=['sk-fakeMigrationKey_0123456789abcdefXYZ','sk-otherFakeKey_9876543210zyxwvuABC'];
const swiftc='/usr/bin/swiftc';
const canCompile=process.platform==='darwin'&&existsSync(swiftc);

test('Swift migration logic passes against an in-memory Keychain and never prints a key',{skip:canCompile?false:'needs macOS with /usr/bin/swiftc',timeout:600000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'treatable-credential-migration-'));
 try{
  const binary=path.join(dir,'harness');
  const env={PATH:'/usr/bin:/bin',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR};
  const build=spawnSync(swiftc,['-parse-as-library','-D','TREATABLE_CREDENTIAL_TESTS',source,harness,'-o',binary],{env,encoding:'utf8',timeout:540000});
  assert.equal(build.status,0,build.stderr);
  if(existsSync('/usr/bin/nm')){
   const symbols=spawnSync('/usr/bin/nm',['-u',binary],{env,encoding:'utf8'});
   assert.equal(symbols.status,0,symbols.stderr);
   assert.doesNotMatch(symbols.stdout,/SecItem(Add|Update|Delete|CopyMatching)/,'the test build links no real Keychain calls');
  }
  const run=spawnSync(binary,[],{env:{},encoding:'utf8',timeout:30000});
  const output=`${run.stdout}\n${run.stderr}`;
  assert.equal(run.status,0,output);
  assert.match(run.stdout,/^ALL PASSED$/m);
  assert.doesNotMatch(run.stdout,/^FAIL /m);
  assert.ok((run.stdout.match(/^ok /gm)??[]).length>=50,'every scenario ran');
  for(const key of fakeKeys)for(const fragment of [key,key.slice(3)])assert.ok(!output.includes(fragment),'harness output never contains a key');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('credential.swift keeps the key out of logs, files, argv and env and names the items as expected',async()=>{
 const swift=await readFile(source,'utf8');
 assert.match(swift,/^let currentService = "com\.treatable\.openai"$/m);
 assert.match(swift,/^let currentLabel = "Treatable OpenAI API key"$/m);
 assert.match(swift,/^let legacyService = "com\.treatable\.hackathon\.openai"$/m);
 assert.equal(swift.match(/com\.treatable\.hackathon\.openai/g).length,1,'the legacy service name is only the migration constant');
 assert.doesNotMatch(swift,/\b(print|debugPrint|dump|NSLog|os_log)\(|\bLogger\(/,'no logging calls');
 assert.doesNotMatch(swift,/\b(Process|NSTask)\(|setenv\(|putenv\(|FileManager|\.write\(to:|fopen\(|\bopen\(/,'no subprocesses, environment writes or file writes');
 assert.equal(swift.match(/FileHandle\.standardOutput\.write\(data\)/g).length,1,'raw key bytes are written only by the read operation');
 const read=swift.slice(swift.indexOf('} else if operation == "read" {'),swift.indexOf('} else if operation == "migrate" {'));
 assert.match(read,/TREATABLE_CREDENTIAL_PIPE/);assert.match(read,/isatty\(STDOUT_FILENO\) == 0/);assert.match(read,/FileHandle\.standardOutput\.write\(data\)/);
 assert.match(swift,/#if !TREATABLE_CREDENTIAL_TESTS\nstruct SystemKeychain/,'the real Keychain backend is excluded from test builds');
 for(const file of ['credentials.mjs','credentials-setup.mjs','install.mjs','host.mjs','cleanup.mjs'])assert.doesNotMatch(await readFile(path.join(native,file),'utf8'),/com\.treatable\.(hackathon\.)?openai/,`${file} never addresses a Keychain item directly`);
});

test('setup status parsing and text: configured if either item exists, migration pending reported, older helpers detected',()=>{
 assert.deepEqual(parseCredentialStatus('{"configured":true,"migrationPending":true}'),{configured:true,migrationPending:true});
 assert.deepEqual(parseCredentialStatus('{"configured":false,"migrationPending":false}'),{configured:false,migrationPending:false});
 assert.deepEqual(parseCredentialStatus('{"configured":true}'),{configured:true,migrationPending:undefined});
 for(const bad of ['','not json','{}','{"configured":"yes"}','null'])assert.equal(parseCredentialStatus(bad),undefined);
 assert.match(describeCredentialStatus({configured:true,migrationPending:true}),/^configured: true\. Migration pending: .*credentials-setup\.mjs migrate/);
 assert.match(describeCredentialStatus({configured:true,migrationPending:false}),/^configured: true\. The key is in the current Keychain item\./);
 assert.match(describeCredentialStatus({configured:false,migrationPending:false}),/^configured: false\./);
 assert.equal(describeCredentialStatus({configured:true,migrationPending:undefined}),outdatedHelperMessage(true));
 assert.match(describeCredentialStatus({configured:true,migrationPending:undefined},{installed:true}),/installed Keychain helper .*Reinstall it with node extension\/native\/install\.mjs/);
 assert.match(describeCredentialStatus({configured:true,migrationPending:undefined},{installed:false}),/Rebuild it with node extension\/native\/credentials-setup\.mjs build/);
 assert.equal(describeCredentialStatus(undefined),STATUS_UNREADABLE);
 assert.doesNotMatch(STATUS_UNREADABLE,/predates/,'an unreadable status is not reported as an outdated helper');
 const texts=[true,false].flatMap(configured=>[true,false,undefined].map(migrationPending=>describeCredentialStatus({configured,migrationPending})));
 for(const text of [...texts,outdatedHelperMessage(true),outdatedHelperMessage(false),STATUS_UNREADABLE])assert.doesNotMatch(text,/sk-|hackathon/i);
});
