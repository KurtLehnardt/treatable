import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ApiError} from './transport.mjs';
const exec=promisify(execFile);
export function keychainCredentials(binary){
 const env={PATH:'/usr/bin:/bin',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,TREATABLE_CREDENTIAL_PIPE:'1'};
 return{
  async configured(){try{const{stdout}=await exec(binary,['status'],{env,timeout:5000,maxBuffer:1024});return JSON.parse(stdout).configured===true;}catch{return false;}},
  async read(){try{const{stdout}=await exec(binary,['read'],{env,timeout:15000,maxBuffer:1024});if(!/^sk-[A-Za-z0-9_-]{10,500}$/.test(stdout))throw new Error();return stdout;}catch{throw new ApiError('KEY_MISSING');}}
 };
}
// Parses the helper's metadata-only status JSON. Helpers built before the Keychain item rename omit migrationPending.
export function parseCredentialStatus(stdout){try{const s=JSON.parse(stdout);if(typeof s?.configured!=='boolean')return undefined;return{configured:s.configured,migrationPending:typeof s.migrationPending==='boolean'?s.migrationPending:undefined};}catch{return undefined;}}
export const STATUS_UNREADABLE='Could not read the credential status from the Keychain helper. Reinstall or rebuild the helper, then retry. Nothing was changed.';
// installed: whether the selected helper is the installed one (fixed by reinstalling) or the build in extension/native/bin.
export function outdatedHelperMessage(installed){return`The ${installed?'installed ':''}Keychain helper predates the renamed Keychain item. ${installed?'Reinstall it with node extension/native/install.mjs --manifest extension/dist/manifest.json':'Rebuild it with node extension/native/credentials-setup.mjs build'}, then retry. Nothing was changed.`;}
// Fixed text for credentials-setup.mjs status. It never includes the key, which status does not read.
export function describeCredentialStatus(status,{installed=true}={}){
 if(!status)return STATUS_UNREADABLE;
 if(status.migrationPending===undefined)return outdatedHelperMessage(installed);
 if(!status.configured)return'configured: false. No Treatable key is stored in macOS Keychain.';
 if(status.migrationPending)return'configured: true. Migration pending: a Keychain item from an earlier Treatable version is still present. Run node extension/native/credentials-setup.mjs migrate to finish moving the key now. If only that item exists, Treatable also moves the key the next time it uses it.';
 return'configured: true. The key is in the current Keychain item. API access has not been tested.';
}
