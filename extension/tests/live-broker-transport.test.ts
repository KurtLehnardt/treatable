/* Native-transport hardening for the registered private-matching (live) broker. These properties were first asserted against the
 * retired side-panel broker (tests/built-worker.test.ts); the live broker is the transport that remains, so they are asserted here. */
import test from 'node:test';import assert from 'node:assert/strict';
import {installLiveBroker,PRIVATE_LIVE_PORT} from '../src/live-background';
import {FAILURE_COPY,GENERIC_FAILURE_COPY} from '../src/failures';
import {parseDemoRequest} from '../shared/demo-contract.mjs';
import {parseLiveRequest} from '../shared/live-analysis-contract.mjs';
import {PUBLIC_CONDITIONS,PUBLIC_STUDY_IDS} from '../shared/public-catalog.mjs';
import {REAL_POLICY_VERSION} from '../shared/real-contract.mjs';

const hash='a'.repeat(64),source={generation:'doc-1',queryKey:hash},nct='NCT00000001';
const CANARY=/PAGE_TEXT_CANARY|NOTES_CANARY|83702|AGE_CANARY|CONDITION_CANARY|SyntheticPrivateName/;
class E{l:((...v:any[])=>void)[]=[];addListener=(f:(...v:any[])=>void)=>this.l.push(f);emit=(...v:any[])=>this.l.forEach(f=>f(...v))}
const flush=async()=>{await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r))};
const catalogRequest=(id:string,extra:Record<string,unknown>={})=>({kind:'liveNative',request:{id,type:'liveCatalog',payload:{nctIds:[nct],source,...extra}}});

function rig(options:{registered?:boolean;throwOnSend?:boolean}={}){
 const connections=new E(),nativeMessages=new E(),nativeDisconnect=new E(),natives:any[]=[],runtime:any={onConnect:connections,lastError:undefined as any};
 runtime.connectNative=()=>{const native={sent:[] as any[],closed:false,postMessage(v:any){if(options.throwOnSend)throw new Error('Attempting to use a disconnected port object');native.sent.push(v)},disconnect(){native.closed=true},onMessage:nativeMessages,onDisconnect:nativeDisconnect};natives.push(native);return native};
 let registered=options.registered!==false;
 const site:any={privateSender:()=>registered,privateContext:async()=>{if(!registered)throw Error('Unregistered');return{source,snapshot:{nctIds:[nct]}}},clearPrivate(){},confirmOperation:async()=>true,captureAnalysis:async()=>{}};
 const timers:{fn:()=>void;ms:number}[]=[],realSet=globalThis.setTimeout;
 globalThis.setTimeout=((fn:any,ms?:number,...args:any[])=>{if(ms===150000){timers.push({fn:()=>fn(...args),ms});return timers.length as any}return realSet(fn,ms,...args)}) as any;
 installLiveBroker({runtime},site);
 function open(name=PRIVATE_LIVE_PORT,sender:any={tab:{id:9}}){const messages=new E(),disconnected=new E(),sent:any[]=[];const port:any={name,sender,onMessage:messages,onDisconnect:disconnected,postMessage:(v:any)=>sent.push(JSON.parse(JSON.stringify(v))),disconnect(){port.closed=true}};connections.emit(port);return{port,sent,send:(v:unknown)=>messages.emit(v),disconnect:()=>disconnected.emit()}}
 const replies=(sent:any[])=>sent.filter(m=>m.reply).map(m=>m.reply);
 const reply=(value:unknown)=>nativeMessages.emit(JSON.parse(JSON.stringify(value)));
 return{open,natives,reply,nativeDisconnect,runtime,timers,replies,setRegistered:(v:boolean)=>{registered=v},restore:()=>{globalThis.setTimeout=realSet}};
}

test('only a registered private sender on the exact live port name can open a native connection',async()=>{const r=rig({registered:false});try{const unregistered=r.open();assert.equal(unregistered.port.closed,true);unregistered.send(catalogRequest('a'));await flush();assert.deepEqual(unregistered.sent,[]);for(const name of ['treatable-private-live','','TREATABLE-PRIVATE-LIVE-V1','treatable-private-live-v1 ','treatable-panel-v2']){const p=r.open(name);p.send(catalogRequest('b'));await flush();assert.deepEqual(p.sent,[],name)}assert.equal(r.natives.length,0)}finally{r.restore()}});

test('malformed operations and requests carrying private text are rejected before any native port is used',async()=>{const r=rig();try{for(const message of [{kind:'liveNative',request:{id:123,type:'liveCatalog',payload:{nctIds:[nct],source}}},catalogRequest('x',{notes:'NOTES_CANARY'}),catalogRequest('y',{pageText:'PAGE_TEXT_CANARY'}),{kind:'liveNative',request:{id:'z',type:'generate',payload:{prompt:'NOTES_CANARY'}}},{kind:'liveNative',request:{id:'w',type:'executeLive',payload:{}}},{kind:'unknown'},{kind:'native',request:{id:'s',type:'status',payload:{}}}]){const p=r.open();p.send(message);await flush();assert.equal(p.port.closed,true,JSON.stringify(message).slice(0,80))}assert.equal(r.natives.length,0);assert.doesNotMatch(JSON.stringify(r.natives.map(n=>n.sent)),CANARY)}finally{r.restore()}});

test('requests carrying page text, notes, ZIP, exact age or free-text conditions fail the shared request schema',()=>{
 const receipt={policyVersion:REAL_POLICY_VERSION,accepted:true},packet={ageBand:'45_59',conditionIds:[PUBLIC_CONDITIONS[0].id],selectedNctIds:[PUBLIC_STUDY_IDS[0]]},token='A'.repeat(43),digest='b'.repeat(64);
 const privateRequests=[
  {id:'s1',type:'status',payload:{notes:'NOTES_CANARY'}},{id:'s2',type:'status',payload:{},pageText:'PAGE_TEXT_CANARY'},
  {id:'d1',type:'scoreDemo',payload:{fixtureId:'fibromyalgia',consent:true,pageText:'PAGE_TEXT_CANARY study text'}},
  {id:'d2',type:'scoreDemo',payload:{fixtureId:'fibromyalgia',consent:true,profile:{ageYears:45,zip:'83702'}}},
  {id:'d3',type:'agentDemo',payload:{fixtureId:'fibromyalgia',consent:true,studyIds:['CONDITION_CANARY fibromyalgia pain']}},
  {id:'d4',type:'agentDemo',payload:{fixtureId:'CONDITION_CANARY',consent:true}},
  {id:'c1',type:'cancel',payload:{requestId:'d1',notes:'NOTES_CANARY'}},
  {id:'r1',type:'prepareReal',payload:{packet:{...packet,conditionIds:['CONDITION_CANARY chronic widespread pain']},policyReceipt:receipt}},
  {id:'r2',type:'prepareReal',payload:{packet:{...packet,ageBand:'45',age:'AGE_CANARY'},policyReceipt:receipt}},
  {id:'r3',type:'prepareReal',payload:{packet:{...packet,zip:'83702'},policyReceipt:receipt}},
  {id:'r4',type:'prepareReal',payload:{packet:{...packet,notes:'NOTES_CANARY'},policyReceipt:receipt}},
  {id:'r5',type:'prepareReal',payload:{packet,policyReceipt:receipt,pageText:'PAGE_TEXT_CANARY'}},
  {id:'r6',type:'prepareReal',payload:{packet,policyReceipt:{...receipt,notes:'NOTES_CANARY'}}},
  {id:'r7',type:'prepareReal',payload:{packet:{...packet,state:'83702'},policyReceipt:receipt}},
  {id:'e1',type:'executeReal',payload:{token,digest,operation:'score',policyReceipt:receipt,notes:'NOTES_CANARY'}},
  {id:'e2',type:'executeReal',payload:{token:'CONDITION_CANARY: chronic widespread pain and fatigue',digest,operation:'score',policyReceipt:receipt}},
  {id:'v1',type:'revokeReal',payload:{token,pageText:'PAGE_TEXT_CANARY'}},
  {id:'x1',type:'explain',payload:{prompt:'NOTES_CANARY PAGE_TEXT_CANARY'}},
 ];
 for(const request of privateRequests)assert.throws(()=>parseDemoRequest(request),Error,request.id);
 assert.throws(()=>parseLiveRequest({id:'x',type:'liveCatalog',payload:{nctIds:[nct],source,notes:'NOTES_CANARY'}}));
});

test('a second message while a request is pending closes the session instead of overwriting it',async()=>{const r=rig();try{const p=r.open();p.send(catalogRequest('same'));await flush();p.send(catalogRequest('same'));await flush();assert.equal(r.natives[0].sent.length,1);assert.equal(p.port.closed,true);assert.equal(r.natives[0].closed,true)}finally{r.restore()}});

test('each live port owns its native connection; disconnecting one drops only that connection',async()=>{const r=rig();try{const a=r.open(),b=r.open();a.send(catalogRequest('a'));b.send(catalogRequest('b'));await flush();assert.equal(r.natives.length,2);a.disconnect();assert.equal(r.natives[0].closed,true);assert.equal(r.natives[1].closed,false);b.disconnect()}finally{r.restore()}});

test('validated native failure codes pass through with fixed table text, never the transported error text',async()=>{for(const[code,expected]of [['KEY_MISSING',FAILURE_COPY.KEY_MISSING],['INVALID_REQUEST',FAILURE_COPY.INVALID_REQUEST]]as const){const r=rig();try{const p=r.open();p.send(catalogRequest('k'));await flush();r.reply({id:'k',type:'result',ok:false,error:'SyntheticPrivateName',code});await flush();assert.deepEqual(r.replies(p.sent),[{id:'k',type:'result',ok:false,code,error:expected}]);assert.doesNotMatch(JSON.stringify(p.sent),CANARY);p.disconnect()}finally{r.restore()}}
 const r=rig();try{const p=r.open();p.send(catalogRequest('u'));await flush();r.reply({id:'u',type:'result',ok:false,error:'SyntheticPrivateName',code:'SOME_NEW_CODE'});await flush();const [reply]=r.replies(p.sent);assert.ok(reply===undefined||reply.error===GENERIC_FAILURE_COPY||reply.code==='INVALID_NATIVE_REPLY');assert.doesNotMatch(JSON.stringify(p.sent),CANARY)}finally{r.restore()}});

test('native replies with unexpected IDs, extra keys or malformed shapes are dropped or refused; nothing unvalidated is forwarded',async()=>{const r=rig();try{const p=r.open();p.send(catalogRequest('a'));await flush();for(const junk of [{id:'unknown',type:'result',ok:false,code:'API_ERROR'},{id:'A',type:'result',ok:false,code:'API_ERROR'},{id:5,type:'result',ok:true},'a',null,[],{type:'result',ok:true}])r.reply(junk);await flush();assert.deepEqual(r.replies(p.sent),[],'unknown or malformed IDs never produce a reply');
 r.reply({id:'a',type:'result',ok:false,code:'API_ERROR',error:'NOTES_CANARY'.repeat(30),debug:'PAGE_TEXT_CANARY'});await flush();assert.doesNotMatch(JSON.stringify(p.sent),CANARY);for(const reply of r.replies(p.sent))assert.equal(reply.ok,false);assert.equal(r.replies(p.sent).length,1);r.reply({id:'a',type:'result',ok:false,code:'API_ERROR'});await flush();assert.equal(r.replies(p.sent).length,1,'a settled ID cannot be answered again')}finally{r.restore()}});

test('native host missing/forbidden/disconnected fails the pending request immediately with a specific code and clears its timer',async()=>{for(const[lastError,code]of [['Specified native messaging host not found.','NATIVE_HOST_MISSING'],['Access to the specified native messaging host is forbidden.','NATIVE_HOST_FORBIDDEN'],['Native host has exited.','NATIVE_HOST_DISCONNECTED'],[undefined,'NATIVE_HOST_DISCONNECTED']]as const){const r=rig();try{const p=r.open();p.send(catalogRequest('a'));await flush();r.runtime.lastError=lastError===undefined?undefined:{message:lastError};r.nativeDisconnect.emit();r.runtime.lastError=undefined;await flush();assert.deepEqual(r.replies(p.sent),[{id:'a',type:'result',ok:false,code,error:FAILURE_COPY[code]}],String(lastError));assert.equal(p.port.closed,true,'the session ends with the connection')}finally{r.restore()}}});

test('background timeout uses its own generic code, then closes the session and native connection',async()=>{const r=rig();try{const p=r.open();p.send(catalogRequest('t'));await flush();assert.equal(r.timers.length,1);r.timers[0].fn();assert.deepEqual(r.replies(p.sent),[{id:'t',type:'result',ok:false,code:'NATIVE_TIMEOUT',error:FAILURE_COPY.NATIVE_TIMEOUT}]);assert.equal(p.port.closed,true);assert.equal(r.natives[0].closed,true)}finally{r.restore()}});

test('a native port that throws on send ends the session without leaking a request or a connection',async()=>{const r=rig({throwOnSend:true});try{const p=r.open();p.send(catalogRequest('a'));await flush();assert.equal(p.port.closed,true);assert.equal(r.natives.every(n=>n.sent.length===0),true);assert.deepEqual(r.replies(p.sent),[])}finally{r.restore()}});
