#!/usr/bin/env node
import {mkdir,readFile,writeFile,copyFile,chmod,rm,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {HOST_NAME,EXTENSION_ID} from './core.mjs';
const source=path.dirname(fileURLToPath(import.meta.url));const args=process.argv.slice(2);
function option(name){const i=args.indexOf(name);return i<0?undefined:args[i+1];}
const home=path.resolve(option('--home')??os.homedir()),directory=path.join(home,'Library','Application Support','Treatable','native-host'),native=path.join(directory,'native');
const chromeManifest=path.join(home,'Library','Application Support','Google','Chrome','NativeMessagingHosts',`${HOST_NAME}.json`);
if(args.includes('--uninstall')){await rm(chromeManifest,{force:true});await rm(directory,{recursive:true,force:true});console.log('Removed the native registration/helper. Keychain credential is retained; remove it explicitly with credential setup if desired.');process.exit(0);}
if(process.platform!=='darwin'&&!args.includes('--home'))throw new Error('Native setup currently supports macOS.');
const extensionId=option('--extension-id')??EXTENSION_ID;if(extensionId!==EXTENSION_ID)throw new Error('Unsupported extension identity.');
if(option('--manifest')){const manifest=JSON.parse(await readFile(path.resolve(option('--manifest')),'utf8'));if(typeof manifest.key!=='string')throw new Error('Missing fixed extension key.');const hex=createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32);const id=[...hex].map(x=>String.fromCharCode(97+parseInt(x,16))).join('');if(id!==EXTENSION_ID)throw new Error('Extension identity mismatch.');}
await mkdir(native,{recursive:true,mode:0o700});await chmod(directory,0o700);await chmod(native,0o700);await mkdir(path.join(directory,'shared'),{recursive:true,mode:0o700});
for(const file of ['host.mjs','core.mjs','provider.mjs','transport.mjs','credentials.mjs','real.mjs'])await copyFile(path.join(source,file),path.join(native,file));
for(const file of ['demo-contract.mjs','demo-fixtures.mjs','real-contract.mjs','public-catalog.mjs'])await copyFile(path.join(source,'..','shared',file),path.join(directory,'shared',file));
await mkdir(path.join(native,'data'),{recursive:true,mode:0o700});await copyFile(path.join(source,'data','studies.json'),path.join(native,'data','studies.json'));
const binary=path.join(native,'treatable-keychain');
if(option('--credential-helper')){const supplied=path.resolve(option('--credential-helper'));await access(supplied);await copyFile(supplied,binary);}else{const result=spawnSync('/usr/bin/swiftc',[path.join(source,'credential.swift'),'-o',binary],{stdio:'inherit',env:{PATH:'/usr/bin:/bin',HOME:home,TMPDIR:process.env.TMPDIR}});if(result.status!==0)throw new Error('Keychain helper compilation failed; no credential was accessed.');}
await chmod(binary,0o700);
await writeFile(path.join(native,'config.json'),JSON.stringify({extensionId,credentialHelper:binary},null,2),{mode:0o600});
const quote=v=>`'${v.replaceAll("'","'\\''")}'`,launcher=path.join(directory,'launch');
await writeFile(launcher,`#!/bin/sh\nexec /usr/bin/env -i HOME=${quote(home)} PATH=/usr/bin:/bin ${quote(process.execPath)} ${quote(path.join(native,'host.mjs'))} "$@"\n`,{mode:0o700});await chmod(launcher,0o700);
await mkdir(path.dirname(chromeManifest),{recursive:true});await writeFile(chromeManifest,JSON.stringify({name:HOST_NAME,description:'Treatable consented OpenAI API bridge',path:launcher,type:'stdio',allowed_origins:[`chrome-extension://${EXTENSION_ID}/`]},null,2),{mode:0o600});
console.log('Installed the stdio-only native bridge. No credential was accessed and no API request was made. Next run: node extension/native/credentials-setup.mjs configure');
