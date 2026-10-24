#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {mkdir,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
const root=path.dirname(fileURLToPath(import.meta.url));
if(process.platform!=='darwin')throw new Error('This credential setup supports macOS Keychain.');
const op=process.argv[2]??'configure';if(!['configure','status','remove','build'].includes(op))throw new Error('Use configure, status, remove, or build. Never pass an API key as an argument.');
const dir=path.join(root,'bin');await mkdir(dir,{recursive:true,mode:0o700});const binary=path.join(dir,'treatable-keychain');
if(op==='build'||!await access(binary).then(()=>true,()=>false)){const run=spawnSync('/usr/bin/swiftc',[path.join(root,'credential.swift'),'-o',binary],{stdio:'inherit',env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR}});if(run.status!==0)process.exit(run.status??1);}
if(op==='build'){console.log('Built the Keychain helper. No credential was accessed.');process.exit(0);}
const installed=path.join(os.homedir(),'Library','Application Support','Treatable','native-host','native','treatable-keychain');
const selected=await access(installed).then(()=>installed,()=>binary);
const run=spawnSync(selected,[op],{stdio:'inherit',env:{PATH:'/usr/bin:/bin',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR}});process.exit(run.status??1);
