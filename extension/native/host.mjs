#!/usr/bin/env node
import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {MessageDecoder,encodeReply,validateOrigin,validateRequest,replyId,ID_PATTERN} from './core.mjs';
import {keychainCredentials} from './credentials.mjs';
import {OpenAITransport,ApiError} from './transport.mjs';
import {runScore,runAgent,runPreparedScore,runPreparedAgent,runPreparedLiveScore,runPreparedLiveAgent} from './provider.mjs';
import{loadPublicCorpus,PreparedRealStore}from './real.mjs';
import{PendingCleanup,deleteSessions,validSessionId,MAX_PENDING,MIN_LEFTOVER_AGE_MS,PENDING_FILE}from'./pending-cleanup.mjs';
import{LiveEvidenceStore}from './live-evidence.mjs';
import{PreparedLiveStore}from './live.mjs';
import{LIVE_REQUEST_TYPES}from '../shared/live-analysis-contract.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url)),pendingCleanup=new PendingCleanup(path.join(directory,PENDING_FILE));
const ERRORS={KEY_MISSING:'Configure the dedicated Treatable key in macOS Keychain.',KEY_REJECTED:'OpenAI rejected the configured key.',API_PERMISSION:'This key does not have access to the requested API.',RATE_LIMITED:'The API rate limit was reached. Try again later.',CANCELLED:'The request stopped or timed out.',INVALID_FIXTURE_STUDIES:'Only this fictional fixture’s public studies are allowed.',INCOMPLETE_AGENT_TURN:'The agent stream ended without a completed, tool-verified result.',API_ERROR:'OpenAI returned an unsuccessful response.',NETWORK_ERROR:'OpenAI could not be reached.',CONSENT_EXPIRED:'The prepared preview expired. Prepare and review it again.',INVALID_CONSENT_RECEIPT:'The preview receipt is stale, changed, or already used. Prepare it again.',PREVIEW_TOO_LARGE:'The selected records exceed the preview limit. Choose a smaller selection.',INTERNAL_ERROR:'The native helper could not complete this request.',GOV_NETWORK_ERROR:'ClinicalTrials.gov could not be reached. Try again later.',GOV_HTTP_ERROR:'ClinicalTrials.gov did not return this study. Refresh the results page.',GOV_INVALID_RECORD:'ClinicalTrials.gov returned unsupported study data.',GOV_ID_MISMATCH:'The returned study did not match the requested NCT ID.',GOV_RECORD_TOO_LARGE:'The public study record exceeds the safe download limit.',LIVE_SNAPSHOT_EXPIRED:'The fetched public records expired. Refresh and review a new preview.',LIVE_SOURCE_CHANGED:'The results page changed. Refresh and review a new preview.',LIVE_SELECTION_CHANGED:'Choose only condition labels and study IDs from the current fetched records.'};
// State is declared before any await so the fatal handlers below never hit an uninitialized binding.
const RECENT_ID_LIMIT=512,pending=new Map(),seen=new Set(),silenced=new Set(),realPending=new Set(),livePending=new Set(),realIds=new Set(),liveIds=new Set(),liveSessions=new Set(),attemptedLeftovers=new Set(),leftoverAbort=new AbortController();let closed=false,crashed=false,prepared,liveEvidence,livePrepared,leftovers=[],leftoverRunning=false,cleanupSpawned=false;
// Uncaught failures never print stacks or data: fixed reply for each in-flight request, one fixed stderr line, then orderly exit.
function fatal(){if(crashed)process.exit(1);crashed=true;process.exitCode=1;for(const id of pending.keys())send({id,type:'result',ok:false,code:'INTERNAL_ERROR',error:ERRORS.INTERNAL_ERROR});try{process.stderr.write('Treatable native helper stopped after an internal error.\n');}catch{}void shutdown();}
process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
let config;try{config=JSON.parse(await readFile(path.join(directory,'config.json'),'utf8'));if(!validateOrigin(process.argv[2],config.extensionId)||typeof config.credentialHelper!=='string'||!path.isAbsolute(config.credentialHelper))throw new Error();config.credentialHelper=await realpath(config.credentialHelper);if(path.dirname(config.credentialHelper)!==await realpath(directory))throw new Error();}catch{process.stderr.write('Treatable native helper is not installed or its caller is not allowed.\n');process.exit(1);}
const credentials=keychainCredentials(config.credentialHelper);
try{prepared=new PreparedRealStore(await loadPublicCorpus(),{onInvalidate:()=>{for(const id of realPending)pending.get(id)?.abort();}});}catch{process.stderr.write('Treatable public catalog does not match this build. Reinstall the helper.\n');process.exit(1);}
liveEvidence=new LiveEvidenceStore({onInvalidate:()=>livePrepared?.clear()});
livePrepared=new PreparedLiveStore(liveEvidence,{onInvalidate:()=>{for(const id of livePending)pending.get(id)?.abort();}});
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
const REAL_TYPES=['prepareReal','executeReal','revokeReal'],LIVE_TYPES=[...LIVE_REQUEST_TYPES],BASE_TYPES=['status','cancel','scoreDemo','agentDemo'];
function rememberIn(ids,id){ids.add(id);while(ids.size>64)ids.delete(ids.values().next().value);}
// Both fail closed: anything that is not clearly a status, fictional-demo, other-path or unrelated cancel frame counts as input for that path.
function targetsReal(raw){return![...BASE_TYPES,...LIVE_TYPES].includes(raw?.type)||raw.type==='cancel'&&realIds.has(raw.payload?.requestId);}
function targetsLive(raw){return![...BASE_TYPES,...REAL_TYPES].includes(raw?.type)||raw.type==='cancel'&&liveIds.has(raw.payload?.requestId);}
// Invalid input only discards the preview of the path it targets (no later send from it); a send that already started is never aborted.
function discardFor(raw){if(targetsReal(raw))prepared.discard();if(targetsLive(raw)){livePrepared.discard();liveEvidence.discard();}}
// Returns whether the original reply was sent. An unencodable reply becomes a small fixed error (never echoed); an in-flight request is stopped and its later frames are dropped.
function send(value){if(closed)return false;const id=replyId(value);if(silenced.has(id))return false;const{frame,ok}=encodeReply(value,ERRORS.INTERNAL_ERROR);if(!ok&&pending.has(id)){silenced.add(id);pending.get(id).abort();}try{process.stdout.write(frame);}catch{return false;}return ok;}
async function shutdown(){if(closed)return;closed=true;spawnDetachedCleanup();leftoverAbort.abort();prepared?.clear();liveEvidence?.clear({cache:true});livePrepared?.clear();for(const c of pending.values())c.abort();const timer=setTimeout(()=>process.exit(),6000);timer.unref();while(pending.size)await new Promise(r=>setTimeout(r,25));await pendingCleanup.queue;process.exit();}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
// Invalid snapshot-path or live-path input discards that path's prepared preview (no later send) without aborting a send that already started;
// the other path's preview and fictional-demo frames are unaffected.
async function handle(raw){
 // A frame reusing an in-flight ID gets no reply, so nothing can be mistaken for that request's own result (the background already rejects duplicates).
 if(typeof raw?.id==='string'&&ID_PATTERN.test(raw.id)&&pending.has(raw.id)){discardFor(raw);return;}
 let message;try{message=validateRequest(raw);if(seen.has(message.id))throw new Error();remember(message.id);}catch{discardFor(raw);send({id:replyId(raw),type:'result',ok:false,code:'INVALID_REQUEST',error:'Invalid or unsupported native request.'});return;}
 const{id,type,payload}=message;if(REAL_TYPES.includes(type))rememberIn(realIds,id);else if(LIVE_TYPES.includes(type))rememberIn(liveIds,id);
 // Cancelling a snapshot-path (live-path) operation revokes only that path's preview and aborts its sends; Stop on the fictional demo or the
 // other path leaves it usable.
 if(type==='cancel'){const target=payload.requestId;if(realIds.has(target)||realPending.has(target))prepared.clear();if(liveIds.has(target)||livePending.has(target))liveEvidence.clear();pending.get(target)?.abort();send({id,type:'result',ok:true});return;}
 if(type==='status'){const configured=await credentials.configured();send({id,type:'status',ok:true,provider:'openai',configured,message:configured?'Dedicated Keychain credential present. API authentication and access are not yet verified.':'Native bridge ready. Configure the dedicated Keychain credential to run the fictional demo.'});return;}
 if(type==='revokeReal'){try{prepared.revoke(payload.token);send({id,type:'result',ok:true});}catch{send({id,type:'result',ok:false,code:'INVALID_CONSENT_RECEIPT',error:ERRORS.INVALID_CONSENT_RECEIPT});}return;}
 if(type==='revokeLive'){try{livePrepared.revoke(payload.token);liveEvidence.clear();send({id,type:'result',ok:true});}catch{send({id,type:'result',ok:false,code:'INVALID_CONSENT_RECEIPT',error:ERRORS.INVALID_CONSENT_RECEIPT});}return;}
 if(pending.size){send({id,type:'result',ok:false,code:'BUSY',error:'Stop the current request before starting another.'});return;}
 if(type==='liveCatalog'){const controller=new AbortController();pending.set(id,controller);try{const result=await liveEvidence.catalog(payload.nctIds,payload.source,{signal:controller.signal});prepared.discard();if(!send({id,type:'result',ok:true,result}))liveEvidence.clear();}catch(error){liveEvidence.clear();const code=controller.signal.aborted?'CANCELLED':error instanceof ApiError?error.code:'GOV_INVALID_RECORD';send({id,type:'result',ok:false,code,error:ERRORS[code]??ERRORS.GOV_INVALID_RECORD});}finally{pending.delete(id);silenced.delete(id);}return;}
 // Starting one path's preview retires the other path's, but only once this one succeeds (a failed or invalid request leaves it intact).
 if(type==='prepareLive'){try{const result=livePrepared.prepare(payload);prepared.discard();if(!send({id,type:'result',ok:true,result}))livePrepared.discard();}catch(error){livePrepared.discard();const code=error instanceof ApiError?error.code:'INVALID_REQUEST';send({id,type:'result',ok:false,code,error:ERRORS[code]??'The minimized profile or current-page binding is invalid.'});}return;}
 if(type==='prepareReal'){try{const result=prepared.prepare(payload.packet,payload.policyReceipt);livePrepared.discard();if(!send({id,type:'result',ok:true,result}))prepared.discard();}catch(error){prepared.discard();const code=error instanceof ApiError?error.code:'INVALID_REQUEST';send({id,type:'result',ok:false,code,error:ERRORS[code]??'The minimized packet or policy receipt is invalid.'});}return;}
 let pinned;if(type==='executeReal'||type==='executeLive'){try{pinned=(type==='executeLive'?livePrepared:prepared).take(payload);}catch(error){const code=error instanceof ApiError?error.code:'INVALID_CONSENT_RECEIPT';send({id,type:'result',ok:false,code,error:ERRORS[code]??ERRORS.INVALID_CONSENT_RECEIPT});return;}}
 const controller=new AbortController();pending.set(id,controller);if(pinned)(type==='executeLive'?livePending:realPending).add(id);let transport,key,sequence=0;const run={};
 const onTrace=trace=>{try{track(trace,run);}catch{}return send({id,type:'trace',ok:true,trace:{sequence:++sequence,...trace}});};
 try{key=await credentials.read();if(controller.signal.aborted)throw new ApiError('CANCELLED');transport=new OpenAITransport(key);cleanLeftovers(key);key=undefined;const result=pinned?await(type==='executeLive'?(payload.operation==='score'?runPreparedLiveScore:runPreparedLiveAgent):(payload.operation==='score'?runPreparedScore:runPreparedAgent))(transport,pinned,{signal:controller.signal,onTrace}):await(type==='scoreDemo'?runScore:runAgent)(transport,payload,{signal:controller.signal,onTrace});send({id,type:'result',ok:true,result});}
 catch(error){const code=controller.signal.aborted?'CANCELLED':error instanceof ApiError?error.code:'INVALID_API_RESPONSE';onTrace({stage:code==='CANCELLED'?'cancelled':'failed',...(Number.isInteger(error.status)?{httpStatus:error.status}:{})});send({id,type:'result',ok:false,code,error:ERRORS[code]??'The API returned an unsupported result. Existing local study checks are preserved.'});}
 finally{key=undefined;transport?.clear();pending.delete(id);realPending.delete(id);livePending.delete(id);silenced.delete(id);}
}
const decoder=new MessageDecoder(raw=>void handle(raw),()=>{process.stderr.write('Treatable rejected an invalid native frame.\n');void shutdown();});
process.stdin.on('data',chunk=>decoder.push(chunk));process.stdin.on('end',()=>{decoder.end();void shutdown();});process.stdin.on('error',()=>void shutdown());process.stdout.on('error',()=>void shutdown());
