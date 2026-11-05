#!/usr/bin/env node
import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {MessageDecoder,encodeReply,validateOrigin,validateRequest,replyId,ID_PATTERN} from './core.mjs';
import {keychainCredentials} from './credentials.mjs';
import {OpenAITransport,ApiError} from './transport.mjs';
import{PendingCleanup,deleteSessions,validSessionId,MAX_PENDING,MIN_LEFTOVER_AGE_MS,PENDING_FILE}from'./pending-cleanup.mjs';
import{PreparedStudyBriefStore,runPreparedStudyBrief}from './study-brief.mjs';
import{APPLY_REQUEST_TYPES,studyBriefEngine,parseLocalModelsResult}from '../shared/apply-contract.mjs';
import{findOllama,OllamaRuntime,MISSING_RUNTIME,OLLAMA_LOCATIONS,listLocalModels,machineProfile,recommend,versionAtLeast}from './local-runtime.mjs';
import{buildLocalBriefRequest,runLocalStudyBrief}from './local-brief.mjs';
import{PreparedRankStore,runPreparedRank}from './rank.mjs';
import{RANK_REQUEST_TYPES}from '../shared/rank-contract.mjs';
import{stat}from 'node:fs/promises';import os from 'node:os';
const directory=path.dirname(fileURLToPath(import.meta.url)),pendingCleanup=new PendingCleanup(path.join(directory,PENDING_FILE));
// The helper serves two shipped features and nothing else: AI-matched results (prepareRank, executeRank, revokeRank) and the study brief
// with its local model check (prepareStudyBrief, executeStudyBrief, revokeStudyBrief, localModels). core.mjs validateRequest rejects every
// other operation name as INVALID_REQUEST before any state, credential or network is touched.
const ERRORS={KEY_MISSING:'Configure the dedicated Treatable key in macOS Keychain.',KEY_REJECTED:'OpenAI rejected the configured key.',API_PERMISSION:'This key does not have access to the requested API.',RATE_LIMITED:'The API rate limit was reached. Try again later.',CANCELLED:'The request stopped or timed out.',INCOMPLETE_AGENT_TURN:'The agent stream ended without a completed, tool-verified result.',API_ERROR:'OpenAI returned an unsuccessful response.',NETWORK_ERROR:'OpenAI could not be reached.',CONSENT_EXPIRED:'The prepared preview expired. Prepare and review it again.',INVALID_CONSENT_RECEIPT:'The preview receipt is stale, changed, or already used. Prepare it again.',PREVIEW_TOO_LARGE:'The selected records exceed the preview limit. Choose a smaller selection.',INTERNAL_ERROR:'The native helper could not complete this request.',RECORD_UNAVAILABLE:'The official ClinicalTrials.gov record for this study could not be loaded. Try again later.',APPLY_EXPIRED:'The prepared contact plan expired. Prepare it again.',INVALID_APPLY_RECEIPT:'The prepared contact plan is stale, changed, or already used. Prepare it again.',LOCAL_NOT_INSTALLED:'Ollama is not installed on this device.',LOCAL_RUNTIME_FAILED:'The local Ollama runtime could not start.',LOCAL_MODEL_UNAVAILABLE:'The chosen local model is not installed or cannot generate text.',LOCAL_MODEL_FAILED:'The local model could not run on this device.',LOCAL_OLLAMA_OUTDATED:'Ollama on this device is too old for structured output.',LOCAL_TIMEOUT:'The local model did not finish in time.',LOCAL_INVALID_OUTPUT:'The local model returned output that failed validation.'};
// A study brief sends only public NCT IDs; its agent failures keep the record-based contact plan usable.
const APPLY_AGENT_ERROR='The agent could not finish its suggestions. The contact details from the official record are unaffected.';
// State is declared before any await so the fatal handlers below never hit an uninitialized binding.
const RECENT_ID_LIMIT=512,pending=new Map(),seen=new Set(),silenced=new Set(),applyPending=new Set(),rankPending=new Set(),liveSessions=new Set(),attemptedLeftovers=new Set(),leftoverAbort=new AbortController();let closed=false,crashed=false,briefPrepared,rankPrepared,leftovers=[],leftoverRunning=false,cleanupSpawned=false,localRuntime,localBinary,localIdle;
// Uncaught failures never print stacks or data: fixed reply for each in-flight request, one fixed stderr line, then orderly exit.
function fatal(){if(crashed)process.exit(1);crashed=true;process.exitCode=1;for(const id of pending.keys())send({id,type:'result',ok:false,code:'INTERNAL_ERROR',error:ERRORS.INTERNAL_ERROR});try{process.stderr.write('Treatable native helper stopped after an internal error.\n');}catch{}void shutdown();}
process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
let config;try{config=JSON.parse(await readFile(path.join(directory,'config.json'),'utf8'));if(!validateOrigin(process.argv[2],config.extensionId)||typeof config.credentialHelper!=='string'||!path.isAbsolute(config.credentialHelper))throw new Error();config.credentialHelper=await realpath(config.credentialHelper);if(path.dirname(config.credentialHelper)!==await realpath(directory))throw new Error();if(config.ollama!==undefined&&(!config.ollama||typeof config.ollama!=='object'||Object.keys(config.ollama).sort().join()!=='candidates,modelsDir'||!Array.isArray(config.ollama.candidates)||config.ollama.candidates.length>4||[...config.ollama.candidates,config.ollama.modelsDir].some(v=>typeof v!=='string'||!path.isAbsolute(v)||/[\u0000-\u001f]/.test(v))))throw new Error();}catch{process.stderr.write('Treatable native helper is not installed or its caller is not allowed.\n');process.exit(1);}
const credentials=keychainCredentials(config.credentialHelper);
briefPrepared=new PreparedStudyBriefStore({buildLocalRequest:buildLocalBriefRequest,onInvalidate:()=>{for(const id of applyPending)pending.get(id)?.abort();}});
// AI ranking: the minimized ranking profile and pinned public records, one-use like the study brief; see rank.mjs.
rankPrepared=new PreparedRankStore({onInvalidate:()=>{for(const id of rankPending)pending.get(id)?.abort();}});
// Local model (Ollama on this device). Installed-location overrides exist only in isolated test installs; production uses the known locations
// and the user's own ~/.ollama/models. The dedicated runtime starts on first use and stops when idle, on shutdown and on exit.
const modelsDir=config.ollama?.modelsDir??path.join(os.homedir(),'.ollama','models'),LOCAL_IDLE_MS=5*60*1000;
async function localRuntimeFor(){const binary=await findOllama(config.ollama?.candidates??OLLAMA_LOCATIONS);if(!binary)return MISSING_RUNTIME;if(localRuntime&&localBinary===binary)return localRuntime;await localRuntime?.stop();localBinary=binary;localRuntime=new OllamaRuntime({binary,modelsDir});return localRuntime;}
function localIdleStop(){clearTimeout(localIdle);localIdle=setTimeout(()=>{if(!pending.size)void localRuntime?.stop();},LOCAL_IDLE_MS);localIdle.unref?.();}
process.on('exit',()=>localRuntime?.killNow());
async function checkLocalModels(signal){
 const machine=await machineProfile({diskPath:await stat(modelsDir).then(()=>modelsDir,()=>os.homedir())}),runtime=await localRuntimeFor();
 const answer=(status,version,ranked)=>parseLocalModelsResult({kind:'localModels',ollama:{status,version},machine,models:ranked.models,recommendation:ranked.recommendation});
 if(runtime===MISSING_RUNTIME)return answer('not_installed',null,recommend({machine,models:[],installed:false}));
 let models;try{models=await listLocalModels(runtime,signal);}catch(error){if(signal.aborted)throw error;return answer('runtime_failed',null,{models:[],recommendation:{kind:'none',reason:'Ollama is installed, but Treatable could not start its own private Ollama runtime on this device. Restart the computer or reinstall Ollama, then check again.'}});}
 const ranked=recommend({machine,models});
 // JSON-schema structured outputs need Ollama 0.5 or later; an older runtime is listed but nothing is recommended.
 if(!versionAtLeast(runtime.version))return answer('ready',runtime.version,{models:ranked.models.map(m=>({...m,recommended:false})),recommendation:{kind:'none',reason:`Ollama ${runtime.version} is too old for the structured output Treatable needs. Update it from ollama.com/download, then check again.`}});
 return answer('ready',runtime.version,ranked);
}
// Agents sessions an earlier host could not confirm deleted (it was killed mid-cleanup). Reading the file needs no credential.
leftovers=await pendingCleanup.read();
// Only opaque provider session IDs go to the pending-cleanup file; an entry is removed once the provider reports a confirmed delete.
// Cleanup traces carry no provider session ID (bounded diagnostics only), so each request remembers the ID its own created-trace reported.
function track(trace,run){if(trace?.stage==='agent.session.created'&&validSessionId(trace.sessionId)){run.sessionId=trace.sessionId;liveSessions.add(trace.sessionId);void pendingCleanup.add(trace.sessionId);}else if(trace?.stage==='agent.cleanup.deleted'&&validSessionId(run.sessionId)){liveSessions.delete(run.sessionId);void pendingCleanup.remove([run.sessionId]);}}
// Runs after a normal request's successful key read (never an extra Keychain read). Only leftovers older than any live run are touched; 2xx/404 drop the entry.
function cleanLeftovers(key){if(leftoverRunning||closed)return;const now=Date.now(),due=leftovers.filter(e=>!attemptedLeftovers.has(e.id)&&!liveSessions.has(e.id)&&now-e.at>=MIN_LEFTOVER_AGE_MS);if(!due.length)return;let transport;try{transport=new OpenAITransport(key);}catch{return;}leftoverRunning=true;for(const e of due)attemptedLeftovers.add(e.id);
 void deleteSessions(transport,due.map(e=>e.id),{timeout:3000,budget:12000,signal:leftoverAbort.signal}).then(done=>pendingCleanup.remove(done)).catch(()=>{}).finally(()=>{transport.clear();leftoverRunning=false;});}
// Chrome may SIGKILL the host ~2 s after the port closes, before in-process cleanup (up to ~5.5 s) ends. A detached child in its own session
// reads the key itself and deletes the unconfirmed sessions. argv holds only validated provider session IDs; env is the minimal launcher env.
function spawnDetachedCleanup(){if(cleanupSpawned||!liveSessions.size)return;cleanupSpawned=true;try{const child=spawn(process.execPath,[...process.execArgv,path.join(directory,'cleanup.mjs'),...[...liveSessions].slice(-MAX_PENDING)],{detached:true,stdio:'ignore',cwd:directory,env:{PATH:'/usr/bin:/bin',...(typeof process.env.HOME==='string'?{HOME:process.env.HOME}:{})}});child.on('error',()=>{});child.unref();}catch{}}
// Replays of the most recent request IDs are rejected; the window is bounded so long sessions keep working.
function remember(id){seen.add(id);while(seen.size>RECENT_ID_LIMIT)seen.delete(seen.values().next().value);}
const APPLY_TYPES=[...APPLY_REQUEST_TYPES],RANK_TYPES=[...RANK_REQUEST_TYPES];
// Both fail closed: anything that is not clearly a frame of the other path, including an unknown or retired operation name, counts as input for this path.
function targetsApply(raw){return!RANK_TYPES.includes(raw?.type);}
function targetsRank(raw){return!APPLY_TYPES.includes(raw?.type);}
// Invalid input only discards the preview of the path it targets (no later send from it); a send that already started is never aborted.
function discardFor(raw){if(targetsApply(raw))briefPrepared.discard();if(targetsRank(raw))rankPrepared.discard();}
// Returns whether the original reply was sent. An unencodable reply becomes a small fixed error (never echoed); an in-flight request is stopped and its later frames are dropped.
function send(value){if(closed)return false;const id=replyId(value);if(silenced.has(id))return false;const{frame,ok}=encodeReply(value,ERRORS.INTERNAL_ERROR);if(!ok&&pending.has(id)){silenced.add(id);pending.get(id).abort();}try{process.stdout.write(frame);}catch{return false;}return ok;}
async function shutdown(){if(closed)return;closed=true;clearTimeout(localIdle);const stopping=localRuntime?.stop();spawnDetachedCleanup();leftoverAbort.abort();briefPrepared?.clear();rankPrepared?.clear();for(const c of pending.values())c.abort();const timer=setTimeout(()=>process.exit(),6000);timer.unref();while(pending.size)await new Promise(r=>setTimeout(r,25));await stopping;await pendingCleanup.queue;process.exit();}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
async function handle(raw){
 // A frame reusing an in-flight ID gets no reply, so nothing can be mistaken for that request's own result (the background already rejects duplicates).
 if(typeof raw?.id==='string'&&ID_PATTERN.test(raw.id)&&pending.has(raw.id)){discardFor(raw);return;}
 let message;try{message=validateRequest(raw);if(seen.has(message.id))throw new Error();remember(message.id);}catch{discardFor(raw);send({id:replyId(raw),type:'result',ok:false,code:'INVALID_REQUEST',error:'Invalid or unsupported native request.'});return;}
 const{id,type,payload}=message;
 if(type==='revokeStudyBrief'){try{briefPrepared.revoke(payload.token);send({id,type:'result',ok:true});}catch{send({id,type:'result',ok:false,code:'INVALID_APPLY_RECEIPT',error:ERRORS.INVALID_APPLY_RECEIPT});}return;}
 if(type==='revokeRank'){try{rankPrepared.revoke(payload.token);send({id,type:'result',ok:true});}catch{send({id,type:'result',ok:false,code:'INVALID_CONSENT_RECEIPT',error:ERRORS.INVALID_CONSENT_RECEIPT});}return;}
 if(pending.size){send({id,type:'result',ok:false,code:'BUSY',error:'Stop the current request before starting another.'});return;}
 // Detection only: Ollama, this machine's profile and installed models. No study, patient or model input is accepted.
 if(type==='localModels'){const controller=new AbortController();pending.set(id,controller);try{const result=await checkLocalModels(AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]));send({id,type:'result',ok:true,result});}catch{const code=controller.signal.aborted?'CANCELLED':'LOCAL_RUNTIME_FAILED';send({id,type:'result',ok:false,code,error:ERRORS[code]});}finally{pending.delete(id);silenced.delete(id);localIdleStop();}return;}
 if(type==='prepareStudyBrief'){const controller=new AbortController();pending.set(id,controller);try{const result=await briefPrepared.prepare(payload.nctIds,{signal:controller.signal,engine:studyBriefEngine(payload)});if(!send({id,type:'result',ok:true,result}))briefPrepared.discard();}catch(error){briefPrepared.discard();const code=controller.signal.aborted?'CANCELLED':error instanceof ApiError&&['CANCELLED','RECORD_UNAVAILABLE'].includes(error.code)?error.code:'RECORD_UNAVAILABLE';send({id,type:'result',ok:false,code,error:ERRORS[code]});}finally{pending.delete(id);silenced.delete(id);}return;}
 // AI ranking preparation fetches public records only; nothing reaches a model until executeRank presents this one-use receipt.
 if(type==='prepareRank'){const controller=new AbortController();pending.set(id,controller);try{const result=await rankPrepared.prepare(payload,{signal:controller.signal});if(!send({id,type:'result',ok:true,result}))rankPrepared.discard();}catch(error){rankPrepared.discard();const code=controller.signal.aborted?'CANCELLED':error instanceof ApiError&&['CANCELLED','RECORD_UNAVAILABLE','PREVIEW_TOO_LARGE'].includes(error.code)?error.code:'RECORD_UNAVAILABLE';send({id,type:'result',ok:false,code,error:ERRORS[code]});}finally{pending.delete(id);silenced.delete(id);}return;}
 // Only the two execute operations below can read the Keychain key or reach OpenAI, and each needs its own one-use prepared receipt.
 if(type!=='executeRank'&&type!=='executeStudyBrief'){send({id,type:'result',ok:false,code:'INVALID_REQUEST',error:'Invalid or unsupported native request.'});return;}
 let pinned;try{pinned=(type==='executeRank'?rankPrepared:briefPrepared).take(payload);}catch(error){const fallback=type==='executeRank'?'INVALID_CONSENT_RECEIPT':'INVALID_APPLY_RECEIPT',code=error instanceof ApiError?error.code:fallback;send({id,type:'result',ok:false,code,error:ERRORS[code]??ERRORS[fallback]});return;}
 // A local brief runs on this device only: no Keychain read, no OpenAI transport. Failures are reported inside the validated result.
 if(type==='executeStudyBrief'&&pinned.engine){const controller=new AbortController();pending.set(id,controller);applyPending.add(id);let sequence=0;const onTrace=trace=>send({id,type:'trace',ok:true,trace:{sequence:++sequence,...trace}});
  try{const result=await runLocalStudyBrief(await localRuntimeFor(),pinned,{signal:controller.signal,onTrace,budgetMs:payload.budgetMs});send({id,type:'result',ok:true,result});}
  catch(error){const code=controller.signal.aborted?'CANCELLED':error instanceof ApiError&&/^LOCAL_[A-Z_]+$/.test(error.code)?error.code:'LOCAL_INVALID_OUTPUT';onTrace({stage:code==='CANCELLED'?'cancelled':'failed'});send({id,type:'result',ok:false,code,error:ERRORS[code]});}
  finally{pending.delete(id);applyPending.delete(id);silenced.delete(id);localIdleStop();}return;}
 // A local ranking runs on this device only: no Keychain read, no OpenAI transport.
 if(type==='executeRank'&&pinned.provider==='local'){const controller=new AbortController();pending.set(id,controller);rankPending.add(id);
  try{const result=await runPreparedRank(undefined,pinned,{signal:controller.signal,runtime:await localRuntimeFor()});send({id,type:'result',ok:true,result});}
  catch(error){const code=controller.signal.aborted?'CANCELLED':error instanceof ApiError&&/^LOCAL_[A-Z_]+$/.test(error.code)?error.code:'LOCAL_INVALID_OUTPUT';send({id,type:'result',ok:false,code,error:ERRORS[code]??'The local model could not rank these studies.'});}
  finally{pending.delete(id);rankPending.delete(id);silenced.delete(id);localIdleStop();}return;}
 const controller=new AbortController();pending.set(id,controller);(type==='executeRank'?rankPending:applyPending).add(id);let transport,key,sequence=0;const run={};
 const onTrace=trace=>{try{track(trace,run);}catch{}return send({id,type:'trace',ok:true,trace:{sequence:++sequence,...trace}});};
 try{key=await credentials.read();if(controller.signal.aborted)throw new ApiError('CANCELLED');transport=new OpenAITransport(key);cleanLeftovers(key);key=undefined;const result=type==='executeRank'?await runPreparedRank(transport,pinned,{signal:controller.signal,onTrace}):await runPreparedStudyBrief(transport,pinned,{signal:controller.signal,onTrace});send({id,type:'result',ok:true,result});}
 catch(error){const code=controller.signal.aborted?'CANCELLED':error instanceof ApiError?error.code:'INVALID_API_RESPONSE';onTrace({stage:code==='CANCELLED'?'cancelled':'failed',...(Number.isInteger(error.status)?{httpStatus:error.status}:{})});send({id,type:'result',ok:false,code,error:ERRORS[code]??(type==='executeStudyBrief'?APPLY_AGENT_ERROR:'The API returned an unsupported result. Existing local study checks are preserved.')});}
 finally{key=undefined;transport?.clear();pending.delete(id);applyPending.delete(id);rankPending.delete(id);silenced.delete(id);}
}
const decoder=new MessageDecoder(raw=>void handle(raw),()=>{process.stderr.write('Treatable rejected an invalid native frame.\n');void shutdown();});
process.stdin.on('data',chunk=>decoder.push(chunk));process.stdin.on('end',()=>{decoder.end();void shutdown();});process.stdin.on('error',()=>void shutdown());process.stdout.on('error',()=>void shutdown());
