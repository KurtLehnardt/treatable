#!/usr/bin/env node
// Detached provider-session cleanup. host.mjs starts it (own session, stdio ignored, minimal env) when stdin closes or SIGTERM arrives while
// an Agents session is not confirmed deleted, because Chrome may SIGKILL the host about 2 s later while in-process cleanup needs up to ~5.5 s.
// It sends a best-effort cancel, then DELETE (two attempts), and drops confirmed (2xx/404) entries from the pending-cleanup file.
// argv carries only opaque provider session IDs. The key is read here from the dedicated Keychain helper into memory only: never argv, env or files.
import{readFile,realpath}from'node:fs/promises';import path from'node:path';import{fileURLToPath}from'node:url';
import{keychainCredentials}from'./credentials.mjs';import{OpenAITransport}from'./transport.mjs';
import{PendingCleanup,deleteSessions,validSessionId,MAX_PENDING,PENDING_FILE}from'./pending-cleanup.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url)),ids=process.argv.slice(2);
setTimeout(()=>process.exit(1),40000).unref();
if(!ids.length||ids.length>MAX_PENDING||!ids.every(validSessionId)||new Set(ids).size!==ids.length)process.exit(2);
let transport;
try{
 const config=JSON.parse(await readFile(path.join(directory,'config.json'),'utf8'));if(typeof config.credentialHelper!=='string'||!path.isAbsolute(config.credentialHelper))throw new Error();
 const helper=await realpath(config.credentialHelper);if(path.dirname(helper)!==await realpath(directory))throw new Error();
 let key=await keychainCredentials(helper).read();transport=new OpenAITransport(key);key=undefined;
 const done=await deleteSessions(transport,ids,{timeout:3000,budget:15000,attempts:2,retryDelay:500,cancelFirst:true});
 if(done.length)await new PendingCleanup(path.join(directory,PENDING_FILE)).remove(done);
 process.exitCode=done.length===ids.length?0:1;
}catch{process.exitCode=1;}finally{transport?.clear();}
