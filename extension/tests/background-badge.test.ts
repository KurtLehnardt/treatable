import test from'node:test';import assert from'node:assert/strict';
/* A per-tab toolbar badge outlives the service worker, but the hidden-overlay state does not. This loads the real background.ts against a chrome stub to prove a stale dot is cleared when it starts. */
class Events{listeners:((...v:any[])=>void)[]=[];addListener=(f:(...v:any[])=>void)=>this.listeners.push(f);emit=(...v:any[])=>{for(const f of this.listeners)f(...v)}}
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r))};
test('a stale hidden badge left on a tab is cleared when the background initializes',async()=>{
 const events=new Map<string,Events>(),badges:{tabId:number;text:string}[]=[];
 const ev=(path:string)=>{let e=events.get(path);if(!e){e=new Events();events.set(path,e)}return e};
 const noop=():any=>new Proxy(function(){},{get:(_t,k)=>k==='then'?undefined:noop(),apply:()=>Promise.resolve(undefined)});
 const area=(name:string,own:Record<string,any>)=>new Proxy(own,{get:(t,k:string)=>k in t?t[k]:/^on[A-Z]/.test(k)?ev(name+'.'+k):noop()});
 (globalThis as any).chrome={
  runtime:area('runtime',{id:'test',getURL:(p:string)=>'chrome-extension://test/'+p,getManifest:()=>({action:{default_title:'Open Treatable'}})}),
  action:area('action',{setTitle:async()=>{},setBadgeText:async(v:any)=>{badges.push(v)}}),
  tabs:area('tabs',{get:async(id:number)=>({id}),query:async()=>[{id:1,windowId:1},{id:2,windowId:1}]}),
  sidePanel:area('sidePanel',{setOptions:async()=>{},setPanelBehavior:async()=>{}}),
 };
 await import('../src/background');await flush();
 for(const id of [1,2])assert.equal(badges.some(b=>b.tabId===id&&b.text===''),true,`tab ${id}: the badge is cleared at startup`);
});
