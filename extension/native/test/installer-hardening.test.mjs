import test from 'node:test';import assert from 'node:assert/strict';
import{mkdtemp,mkdir,writeFile,rm,stat,chmod,symlink,access}from'node:fs/promises';import os from 'node:os';import path from 'node:path';import{spawnSync}from'node:child_process';
import{validateHostManifest}from'../core.mjs';
const origin='chrome-extension://lmgmjeabbalehlcakdbolielnfgchojf/';
const installer=new URL('../install.mjs',import.meta.url).pathname;

test('host manifest validator requires fixed keys, one exact-form extension origin and an absolute stdio path',()=>{
 const good={name:'com.treatable.local',description:'x',path:'/Users/a/launch',type:'stdio',allowed_origins:[origin]};assert.equal(validateHostManifest(good),true);
 for(const bad of [{...good,allowed_origins:[origin,origin]},{...good,allowed_origins:['chrome-extension://*/']},{...good,allowed_origins:['chrome-extension://lmgmjeabbalehlcakdbolielnfgchojz/']},{...good,allowed_origins:[origin.slice(0,-1)]},{...good,path:'launch'},{...good,path:'/a\nb'},{...good,type:'tcp'},{...good,name:'other'},{...good,allowed_extensions:['x']},[]])assert.equal(validateHostManifest(bad),false);
});

async function fakeHome(prefix){const home=await mkdtemp(path.join(os.tmpdir(),prefix)),helper=path.join(home,'keychain');await writeFile(helper,`#!${process.execPath}\nif(process.argv[2]==='status')process.stdout.write('{"configured":false}');else process.stdout.write('sk-test-not-a-real-credential');`,{mode:0o700});return{home,helper};}
const install=(...args)=>spawnSync(process.execPath,[installer,...args],{encoding:'utf8'});
const nativeDir=home=>path.join(home,'Library','Application Support','Treatable','native-host');
const manifestPath=home=>path.join(home,'Library','Application Support','Google','Chrome','NativeMessagingHosts','com.treatable.local.json');
test('installer re-tightens modes of existing files and verifies the written manifest',async()=>{
 const{home,helper}=await fakeHome('treatable-modes-');try{
  await mkdir(path.join(nativeDir(home),'native'),{recursive:true});await mkdir(path.dirname(manifestPath(home)),{recursive:true});
  for(const [file,mode] of [[manifestPath(home),0o666],[path.join(nativeDir(home),'native','config.json'),0o666],[path.join(nativeDir(home),'launch'),0o777]]){await writeFile(file,'old');await chmod(file,mode);}
  const r=install('--home',home,'--credential-helper',helper);assert.equal(r.status,0,r.stderr);
  assert.equal((await stat(manifestPath(home))).mode&0o777,0o600);assert.equal((await stat(path.join(nativeDir(home),'native','config.json'))).mode&0o777,0o600);assert.equal((await stat(path.join(nativeDir(home),'launch'))).mode&0o777,0o700);assert.equal((await stat(path.join(nativeDir(home),'native','treatable-keychain'))).mode&0o777,0o700);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('--credential-helper never copies an arbitrary binary: relative, outside, directory and escaping-symlink helpers are refused before installing',async()=>{
 const{home}=await fakeHome('treatable-helper-'),outside=await fakeHome('treatable-outside-');try{
  await symlink(outside.helper,path.join(home,'link'));await mkdir(path.join(home,'dir'));
  for(const helper of [outside.helper,path.relative(process.cwd(),outside.helper),path.join(home,'link'),path.join(home,'dir'),path.join(home,'missing'),undefined]){const r=install('--home',home,...(helper===undefined?['--credential-helper']:['--credential-helper',helper]));assert.notEqual(r.status,0);assert.match(r.stderr,/accepts only an absolute path/);await assert.rejects(access(nativeDir(home)));await assert.rejects(access(manifestPath(home)));}
 }finally{await rm(home,{recursive:true,force:true});await rm(outside.home,{recursive:true,force:true});}
});
