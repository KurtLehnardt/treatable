#!/usr/bin/env node
import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {MessageDecoder,encodeMessage,validateOrigin,validateRequest,replyId} from './core.mjs';
import {keychainCredentials} from './credentials.mjs';
import {OpenAITransport,ApiError} from './transport.mjs';
import {runScore,runAgent,runPreparedScore,runPreparedAgent} from './provider.mjs';
import{loadPublicCorpus,PreparedRealStore}from './real.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
const ERRORS={KEY_MISSING:'Configure the dedicated Treatable key in macOS Keychain.',KEY_REJECTED:'OpenAI rejected the configured key.',API_PERMISSION:'This key does not have access to the requested API.',RATE_LIMITED:'The API rate limit was reached. Try again later.',CANCELLED:'The request stopped or timed out.',INVALID_FIXTURE_STUDIES:'Only this fictional fixture’s public studies are allowed.',INCOMPLETE_AGENT_TURN:'The agent stream ended without a completed, tool-verified result.',API_ERROR:'OpenAI returned an unsuccessful response.',NETWORK_ERROR:'OpenAI could not be reached.',CONSENT_EXPIRED:'The prepared preview expired. Prepare and review it again.',INVALID_CONSENT_RECEIPT:'The preview receipt is stale, changed, or already used. Prepare it again.',PREVIEW_TOO_LARGE:'The selected records exceed the preview limit. Choose a smaller selection.'};
let config;try{config=JSON.parse(await readFile(path.join(directory,'config.json'),'utf8'));if(!validateOrigin(process.argv[2],config.extensionId)||typeof config.credentialHelper!=='string'||!path.isAbsolute(config.credentialHelper))throw new Error();config.credentialHelper=await realpath(config.credentialHelper);if(path.dirname(config.credentialHelper)!==await realpath(directory))throw new Error();}catch{process.stderr.write('Treatable native helper is not installed or its caller is not allowed.\n');process.exit(1);}
const credentials=keychainCredentials(config.credentialHelper),pending=new Map(),seen=new Set();let closed=false;const realPending=new Set();
let prepared;try{prepared=new PreparedRealStore(await loadPublicCorpus(),{onInvalidate:()=>{for(const id of realPending)pending.get(id)?.abort();}});}catch{process.stderr.write('Treatable public catalog does not match this build. Reinstall the helper.\n');process.exit(1);}
function send(value){if(!closed)try{process.stdout.write(encodeMessage(value));}catch{/* Protocol failures never echo data. */}}
async function shutdown(){if(closed)return;closed=true;prepared.clear();for(const c of pending.values())c.abort();const timer=setTimeout(()=>process.exit(),6000);timer.unref();while(pending.size)await new Promise(r=>setTimeout(r,25));process.exit();}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
async function handle(raw){let message;try{message=validateRequest(raw);if(seen.has(message.id)||seen.size>=1000)throw new Error();seen.add(message.id);}catch{prepared.clear();send({id:replyId(raw),type:'result',ok:false,code:'INVALID_REQUEST',error:'Invalid or unsupported native request.'});return;}
 const{id,type,payload}=message;
 if(type==='cancel'){prepared.clear();pending.get(payload.requestId)?.abort();send({id,type:'result',ok:true});return;}
 if(type==='status'){const configured=await credentials.configured();send({id,type:'status',ok:true,provider:'openai',configured,message:configured?'Dedicated Keychain credential present. API authentication and access are not yet verified.':'Native bridge ready. Configure the dedicated Keychain credential to run the fictional demo.'});return;}
 if(type==='revokeReal'){try{prepared.revoke(payload.token);send({id,type:'result',ok:true});}catch{send({id,type:'result',ok:false,code:'INVALID_CONSENT_RECEIPT',error:ERRORS.INVALID_CONSENT_RECEIPT});}return;}
 if(pending.size){send({id,type:'result',ok:false,code:'BUSY',error:'Stop the current request before starting another.'});return;}
 if(type==='prepareReal'){try{const result=prepared.prepare(payload.packet,payload.policyReceipt);send({id,type:'result',ok:true,result});}catch(error){prepared.clear();const code=error instanceof ApiError?error.code:'INVALID_REQUEST';send({id,type:'result',ok:false,code,error:ERRORS[code]??'The minimized packet or policy receipt is invalid.'});}return;}
 let pinned;if(type==='executeReal'){try{pinned=prepared.take(payload);}catch(error){const code=error instanceof ApiError?error.code:'INVALID_CONSENT_RECEIPT';send({id,type:'result',ok:false,code,error:ERRORS[code]??ERRORS.INVALID_CONSENT_RECEIPT});return;}}
 const controller=new AbortController();pending.set(id,controller);if(pinned)realPending.add(id);let transport,key,sequence=0;
 const onTrace=trace=>send({id,type:'trace',ok:true,trace:{sequence:++sequence,...trace}});
 try{key=await credentials.read();if(controller.signal.aborted)throw new ApiError('CANCELLED');transport=new OpenAITransport(key);key=undefined;const result=pinned?await(payload.operation==='score'?runPreparedScore:runPreparedAgent)(transport,pinned,{signal:controller.signal,onTrace}):await(type==='scoreDemo'?runScore:runAgent)(transport,payload,{signal:controller.signal,onTrace});send({id,type:'result',ok:true,result});}
 catch(error){const code=controller.signal.aborted?'CANCELLED':error instanceof ApiError?error.code:'INVALID_API_RESPONSE';onTrace({stage:code==='CANCELLED'?'cancelled':'failed',...(Number.isInteger(error.status)?{httpStatus:error.status}:{})});send({id,type:'result',ok:false,code,error:ERRORS[code]??'The API returned an unsupported result. Existing local study checks are preserved.'});}
 finally{key=undefined;transport?.clear();pending.delete(id);realPending.delete(id);}
}
const decoder=new MessageDecoder(raw=>void handle(raw),()=>{process.stderr.write('Treatable rejected an invalid native frame.\n');void shutdown();});
process.stdin.on('data',chunk=>decoder.push(chunk));process.stdin.on('end',()=>{decoder.end();void shutdown();});process.stdin.on('error',()=>void shutdown());
