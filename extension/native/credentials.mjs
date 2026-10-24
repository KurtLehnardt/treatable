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
