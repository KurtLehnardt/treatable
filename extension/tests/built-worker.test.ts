/* Drives the BUILT service worker (dist/background.js), not src/, so a regression in how the bundle wires its brokers is caught.
 * Every port name is tried from registered and unregistered senders; a port may only be answered by the broker that owns its exact name. */
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
const bundle=readFileSync(new URL('../dist/background.js',import.meta.url),'utf8');
const id='lmgmjeabbalehlcakdbolielnfgchojf',origin=`chrome-extension://${id}`;
const SEARCH='https://clinicaltrials.gov/search?cond=public',STUDY='https://clinicaltrials.gov/study/NCT07254806';
const OVERLAY='treatable.site.overlay.v1',BADGE='treatable.site.badge.v1',LIVE='treatable-private-live-v1',APPLY='treatable-apply-v1';
class Events{listeners:((...v:any[])=>void)[]=[];addListener=(f:(...v:any[])=>void)=>{this.listeners.push(f)};removeListener=()=>{};emit=(...v:any[])=>{for(const f of this.listeners)f(...v)}}
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r))};
function broker(url=SEARCH){
 const connect=new Events(),clicked=new Events(),scripts:any[]=[],natives:any[]=[];
 const snapshot=()=>({generation:'doc-1',url,nctIds:url===SEARCH?['NCT00000001','NCT00000002']:[],diagnostic:'Synthetic page.',supported:url===SEARCH});
 const chrome:any={runtime:{id,lastError:undefined,getURL:(p:string)=>`${origin}/${p}`,onConnect:connect,onMessage:new Events(),onInstalled:new Events(),onStartup:new Events(),connectNative:()=>{const n={sent:[] as any[],closed:false,onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){this.sent.push(JSON.parse(JSON.stringify(v)))},disconnect(){this.closed=true}};natives.push(n);return n}},
  action:{onClicked:clicked,setTitle:async()=>{}},tabs:{query:async()=>[],get:async()=>({id:1,url}),update:async()=>{},create:async()=>{},sendMessage:async(_t:number,m:any)=>({ok:true,result:['snapshot','availability','clearAvailability','restore'].includes(m.type)?snapshot():{}}),onUpdated:new Events(),onActivated:new Events(),onRemoved:new Events()},
  scripting:{executeScript:async(v:any)=>{scripts.push(v);return[]}},windows:{create:async()=>({id:2,tabs:[{id:9}]})},storage:{session:{remove:async()=>{}},local:{remove:async()=>{}}}};
 const context=vm.createContext({chrome,URL,crypto:webcrypto,setTimeout,clearTimeout,setInterval,clearInterval,TextDecoder,TextEncoder,AbortController,structuredClone,fetch:async()=>{throw new Error('offline')}});
 vm.runInContext(bundle,context,{filename:'built-background.js'});
 const frame=(over:any={})=>({id,tab:{id:1,url},frameId:2,documentId:'frame-doc',url:`${origin}/overlay.html`,...over});
 function port(name:string,sender:any){const p:any={name,sender,sent:[] as any[],closed:false,onMessage:new Events(),onDisconnect:new Events(),postMessage(v:any){this.sent.push(JSON.parse(JSON.stringify(v)))},disconnect(){if(this.closed)return;this.closed=true;this.onDisconnect.emit()}};connect.emit(p);return p}
 /** A registered overlay: the toolbar click minted a one-use capability and the frame authenticated with it. */
 async function overlay(){clicked.emit({id:1,url});await flush();const capability=scripts.at(-1).args[0].capability,p=port(OVERLAY,frame());p.onMessage.emit({type:'site.authenticate',capability});await flush();return p}
 /** A registered private-matching sender: the registered overlay also asked the worker to open its protected context. */
 async function privateOverlay(){const p=await overlay();p.onMessage.emit({id:'open',type:'site.openPrivate',payload:{}});await flush();return p}
 return{chrome,natives,scripts,port,frame,overlay,privateOverlay};
}
const quiet=(p:any)=>{assert.equal(p.closed,true,`${p.name} must be disconnected`);assert.deepEqual(p.sent,[],`${p.name} must receive nothing`)};

test('the built worker answers a registered overlay on the site port, and the same sender on any other name is dropped silently',async()=>{
 for(const name of ['treatable.site.overlay.v1 ','TREATABLE.SITE.OVERLAY.V1','treatable.site.overlay','treatable.site.overlay.v2','','bogus-port','treatable-panel-v2','treatable-panel-v1','treatable-private-live-v1 ','treatable-apply-v1 ']){
  const b=broker();const registered=await b.overlay();assert.equal(registered.closed,false);assert.ok(registered.sent.some((m:any)=>m.type==='site.ready'),'the registered overlay is answered');
  const p=b.port(name,b.frame());await flush();p.onMessage.emit({type:'site.authenticate',capability:'x'.repeat(64)});p.onMessage.emit({kind:'liveNative',request:{id:'a',type:'liveCatalog',payload:{}}});p.onMessage.emit({kind:'applyNative',request:{id:'a',type:'prepareApply',payload:{}}});await flush();quiet(p);assert.equal(b.natives.length,0,name)}});

test('unregistered senders are refused on every owned port name and no native connection is opened',async()=>{
 const foreign:Record<string,(b:ReturnType<typeof broker>)=>any>={
  'no overlay was ever activated':b=>b.frame(),
  'other extension':b=>b.frame({id:'abcdefghijklmnopabcdefghijklmnop',url:'chrome-extension://abcdefghijklmnopabcdefghijklmnop/overlay.html'}),
  'web page':b=>({id,tab:{id:1,url:SEARCH},frameId:0,url:SEARCH}),
  'top-level extension page':b=>b.frame({frameId:0}),
  'no tab':b=>({id,url:`${origin}/overlay.html`,frameId:2,documentId:'frame-doc'}),
  'wrong page':b=>b.frame({url:`${origin}/panel.html`}),
  'empty sender':()=>({}),
 };
 for(const name of [OVERLAY,BADGE,LIVE,APPLY])for(const[label,make]of Object.entries(foreign)){const b=broker(STUDY);const p=b.port(name,make(b));await flush();p.onMessage.emit({type:'site.authenticate',capability:'x'.repeat(64)});p.onMessage.emit({kind:'liveNative',request:{id:'a',type:'liveCatalog',payload:{}}});p.onMessage.emit({kind:'applyNative',request:{id:'a',type:'prepareApply',payload:{}}});await flush();assert.equal(p.closed,true,`${name} from ${label}`);assert.deepEqual(p.sent,[],`${name} from ${label}`);assert.equal(b.natives.length,0,`${name} from ${label}`)}});

test('a registered private sender gets the live port ready, but only on the exact live name; a registered study-page overlay gets the apply port only on its exact name',async()=>{
 const b=broker();await b.privateOverlay();const ok=b.port(LIVE,b.frame());await flush();assert.equal(ok.closed,false);assert.deepEqual(ok.sent,[{kind:'liveReady'}]);
 for(const name of ['treatable-private-live-v1 ','TREATABLE-PRIVATE-LIVE-V1','treatable-private-live','bogus-port','treatable-panel-v2']){const c=broker();await c.privateOverlay();const p=c.port(name,c.frame());await flush();quiet(p);assert.equal(c.natives.length,0,name)}
 const s=broker(STUDY);await s.overlay();const applying=s.port(APPLY,s.frame());await flush();assert.equal(applying.closed,false);assert.equal(applying.sent[0].kind,'applyReady');
 for(const name of ['treatable-apply-v1 ','TREATABLE-APPLY-V1','treatable-apply','bogus-port','treatable-panel-v2']){const c=broker(STUDY);await c.overlay();const p=c.port(name,c.frame());await flush();quiet(p);assert.equal(c.natives.length,0,name)}});

test('a registered overlay that was never opened for private matching cannot use the live port',async()=>{const b=broker();await b.overlay();const p=b.port(LIVE,b.frame());await flush();quiet(p);assert.equal(b.natives.length,0)});

test('a port no broker owns, including the retired side-panel port, is disconnected without an answer and without a native connection',async()=>{
 const b=broker();for(const name of ['bogus-port','treatable-panel-v2','treatable-panel-v1','treatable-panel','','TREATABLE-PANEL-V2']){const p=b.port(name,{id,url:`${origin}/panel.html`});p.onMessage.emit({kind:'native',request:{id:'s',type:'status',payload:{}}});await flush();quiet(p)}
 assert.equal(b.natives.length,0);const own=b.port(OVERLAY,{id,url:`${origin}/overlay.html`});assert.equal(own.closed,false,'ports on an owned name are left to their broker until it refuses them')});

test('the built worker ignores runtime messages from the retired page and exposes no readPage handler',async()=>{const b=broker();assert.equal(b.chrome.runtime.onMessage.listeners.length>=0,true);for(const sender of [{id,url:`${origin}/panel.html`},{id,url:`${origin}/overlay.html`,tab:{id:1}}]){for(const listener of b.chrome.runtime.onMessage.listeners){let answered:any='none';const keep=listener({kind:'readPage'},sender,(v:any)=>{answered=v});assert.notEqual(keep,true,'no listener keeps the channel open for readPage');assert.equal(answered,'none')}}assert.equal(b.scripts.length,0,'no page was read')});
