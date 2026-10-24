#!/usr/bin/env node
import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {MessageDecoder,encodeReply,validateOrigin,validateRequest,replyId,ID_PATTERN} from './core.mjs';
import {keychainCredentials} from './credentials.mjs';
import {OpenAITransport,ApiError} from './transport.mjs';
import {runScore,runAgent,runPreparedScore,runPreparedAgent} from './provider.mjs';
import{loadPublicCorpus,PreparedRealStore}from './real.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
const ERRORS={KEY_MISSING:'Configure the dedicated Treatable key in macOS Keychain.',KEY_REJECTED:'OpenAI rejected the configured key.',API_PERMISSION:'This key does not have access to the requested API.',RATE_LIMITED:'The API rate limit was reached. Try again later.',CANCELLED:'The request stopped or timed out.',INVALID_FIXTURE_STUDIES:'Only this fictional fixture’s public studies are allowed.',INCOMPLETE_AGENT_TURN:'The agent stream ended without a completed, tool-verified result.',API_ERROR:'OpenAI returned an unsuccessful response.',NETWORK_ERROR:'OpenAI could not be reached.',CONSENT_EXPIRED:'The prepared preview expired. Prepare and review it again.',INVALID_CONSENT_RECEIPT:'The preview receipt is stale, changed, or already used. Prepare it again.',PREVIEW_TOO_LARGE:'The selected records exceed the preview limit. Choose a smaller selection.',INTERNAL_ERROR:'The native helper could not complete this request.'};
// State is declared before any await so the fatal handlers below never hit an uninitialized binding.
const RECENT_ID_LIMIT=512,pending=new Map(),seen=new Set(),silenced=new Set(),realPending=new Set(),realIds=new Set();let closed=false,crashed=false,prepared;
// Uncaught failures never print stacks or data: fixed reply for each in-flight request, one fixed stderr line, then orderly exit.
function fatal(){if(crashed)process.exit(1);crashed=true;process.exitCode=1;for(const id of pending.keys())send({id,type:'result',ok:false,code:'INTERNAL_ERROR',error:ERRORS.INTERNAL_ERROR});try{process.stderr.write('Treatable native helper stopped after an internal error.\n');}catch{}void shutdown();}
process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
let config;try{config=JSON.parse(await readFile(path.join(directory,'config.json'),'utf8'));if(!validateOrigin(process.argv[2],config.extensionId)||typeof config.credentialHelper!=='string'||!path.isAbsolute(config.credentialHelper))throw new Error();config.credentialHelper=await realpath(config.credentialHelper);if(path.dirname(config.credentialHelper)!==await realpath(directory))throw new Error();}catch{process.stderr.write('Treatable native helper is not installed or its caller is not allowed.\n');process.exit(1);}
const credentials=keychainCredentials(config.credentialHelper);
try{prepared=new PreparedRealStore(await loadPublicCorpus(),{onInvalidate:()=>{for(const id of realPending)pending.get(id)?.abort();}});}catch{process.stderr.write('Treatable public catalog does not match this build. Reinstall the helper.\n');process.exit(1);}
// Replays of the most recent request IDs are rejected; the window is bounded so long sessions keep working.
function remember(id){seen.add(id);while(seen.size>RECENT_ID_LIMIT)seen.delete(seen.values().next().value);}
const REAL_TYPES=['prepareReal','executeReal','revokeReal'],OTHER_TYPES=['status','cancel','scoreDemo','agentDemo'];
function rememberReal(id){realIds.add(id);while(realIds.size>64)realIds.delete(realIds.values().next().value);}
// Fails closed: anything that is not clearly a status, fictional-demo or unrelated cancel frame counts as real-path input.
function targetsReal(raw){return!OTHER_TYPES.includes(raw?.type)||raw.type==='cancel'&&realIds.has(raw.payload?.requestId);}
// Returns whether the original reply was sent. An unencodable reply becomes a small fixed error (never echoed); an in-flight request is stopped and its later frames are dropped.
function send(value){if(closed)return false;const id=replyId(value);if(silenced.has(id))return false;const{frame,ok}=encodeReply(value,ERRORS.INTERNAL_ERROR);if(!ok&&pending.has(id)){silenced.add(id);pending.get(id).abort();}try{process.stdout.write(frame);}catch{return false;}return ok;}
async function shutdown(){if(closed)return;closed=true;prepared?.clear();for(const c of pending.values())c.abort();const timer=setTimeout(()=>process.exit(),6000);timer.unref();while(pending.size)await new Promise(r=>setTimeout(r,25));process.exit();}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
// Invalid real-path input discards the prepared preview (no later send) without aborting a send that already started; other invalid frames leave it intact.
async function handle(raw){
 // A frame reusing an in-flight ID gets no reply, so nothing can be mistaken for that request's own result (the background already rejects duplicates).
 if(typeof raw?.id==='string'&&ID_PATTERN.test(raw.id)&&pending.has(raw.id)){if(targetsReal(raw))prepared.discard();return;}
 let message;try{message=validateRequest(raw);if(seen.has(message.id))throw new Error();remember(message.id);}catch{if(targetsReal(raw))prepared.discard();send({id:replyId(raw),type:'result',ok:false,code:'INVALID_REQUEST',error:'Invalid or unsupported native request.'});return;}
 const{id,type,payload}=message;if(REAL_TYPES.includes(type))rememberReal(id);
 // Only cancelling a real operation revokes the prepared preview (and aborts real sends); Stop on the fictional demo leaves it usable.
 if(type==='cancel'){if(realIds.has(payload.requestId)||realPending.has(payload.requestId))prepared.clear();pending.get(payload.requestId)?.abort();send({id,type:'result',ok:true});return;}
 if(type==='status'){const configured=await credentials.configured();send({id,type:'status',ok:true,provider:'openai',configured,message:configured?'Dedicated Keychain credential present. API authentication and access are not yet verified.':'Native bridge ready. Configure the dedicated Keychain credential to run the fictional demo.'});return;}
 if(type==='revokeReal'){try{prepared.revoke(payload.token);send({id,type:'result',ok:true});}catch{send({id,type:'result',ok:false,code:'INVALID_CONSENT_RECEIPT',error:ERRORS.INVALID_CONSENT_RECEIPT});}return;}
 if(pending.size){send({id,type:'result',ok:false,code:'BUSY',error:'Stop the current request before starting another.'});return;}
 if(type==='prepareReal'){try{const result=prepared.prepare(payload.packet,payload.policyReceipt);if(!send({id,type:'result',ok:true,result}))prepared.discard();}catch(error){prepared.discard();const code=error instanceof ApiError?error.code:'INVALID_REQUEST';send({id,type:'result',ok:false,code,error:ERRORS[code]??'The minimized packet or policy receipt is invalid.'});}return;}
 let pinned;if(type==='executeReal'){try{pinned=prepared.take(payload);}catch(error){const code=error instanceof ApiError?error.code:'INVALID_CONSENT_RECEIPT';send({id,type:'result',ok:false,code,error:ERRORS[code]??ERRORS.INVALID_CONSENT_RECEIPT});return;}}
 const controller=new AbortController();pending.set(id,controller);if(pinned)realPending.add(id);let transport,key,sequence=0;
 const onTrace=trace=>send({id,type:'trace',ok:true,trace:{sequence:++sequence,...trace}});
 try{key=await credentials.read();if(controller.signal.aborted)throw new ApiError('CANCELLED');transport=new OpenAITransport(key);key=undefined;const result=pinned?await(payload.operation==='score'?runPreparedScore:runPreparedAgent)(transport,pinned,{signal:controller.signal,onTrace}):await(type==='scoreDemo'?runScore:runAgent)(transport,payload,{signal:controller.signal,onTrace});send({id,type:'result',ok:true,result});}
 catch(error){const code=controller.signal.aborted?'CANCELLED':error instanceof ApiError?error.code:'INVALID_API_RESPONSE';onTrace({stage:code==='CANCELLED'?'cancelled':'failed',...(Number.isInteger(error.status)?{httpStatus:error.status}:{})});send({id,type:'result',ok:false,code,error:ERRORS[code]??'The API returned an unsupported result. Existing local study checks are preserved.'});}
 finally{key=undefined;transport?.clear();pending.delete(id);realPending.delete(id);silenced.delete(id);}
}
const decoder=new MessageDecoder(raw=>void handle(raw),()=>{process.stderr.write('Treatable rejected an invalid native frame.\n');void shutdown();});
process.stdin.on('data',chunk=>decoder.push(chunk));process.stdin.on('end',()=>{decoder.end();void shutdown();});process.stdin.on('error',()=>void shutdown());process.stdout.on('error',()=>void shutdown());
