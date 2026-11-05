import test from'node:test';import assert from'node:assert/strict';import{isSupportedSite}from'../src/sites';
/* background.ts and the hidden cue in site-background.ts both write the toolbar title. This loads the real background.ts against a chrome
 * stub to prove they always agree. Like Chrome without the tabs permission, the stub shows a tab's URL only on a supported site. */
class Events{listeners:((...v:any[])=>void)[]=[];addListener=(f:(...v:any[])=>void)=>this.listeners.push(f);emit=(...v:any[])=>{for(const f of this.listeners)f(...v)}}
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r))};
const HIDDEN='Treatable is hidden — click to reopen',OPEN='Open Treatable',UNSUPPORTED='Open ClinicalTrials.gov to use Treatable',SEARCH='https://clinicaltrials.gov/search?cond=public',ELSEWHERE='https://example.com/';
test('the hidden title survives onUpdated and onActivated, and leaving for an unsupported site ends on the unsupported title',async()=>{
 const origin='chrome-extension://test',events=new Map<string,Events>(),titles:{tabId:number;title:string}[]=[],scripts:any[]=[],urls=new Map([[1,SEARCH],[2,SEARCH]]);
 const readable=(id:number)=>{const url=urls.get(id)??'';return isSupportedSite(url)?url:undefined},of=(tabId:number)=>[...new Set(titles.filter(t=>t.tabId===tabId).map(t=>t.title))];
 const ev=(path:string)=>{let e=events.get(path);if(!e){e=new Events();events.set(path,e)}return e};
 const noop=():any=>new Proxy(function(){},{get:(_t,k)=>k==='then'?undefined:noop(),apply:()=>Promise.resolve(undefined)});
 const area=(name:string,own:Record<string,any>)=>new Proxy(own,{get:(t,k:string)=>k in t?t[k]:/^on[A-Z]/.test(k)?ev(name+'.'+k):noop()});
 (globalThis as any).chrome={
  runtime:area('runtime',{id:'test',getURL:(p:string)=>origin+'/'+p,getManifest:()=>({action:{default_title:OPEN}})}),
  action:area('action',{setTitle:async(v:any)=>{titles.push(v)},setBadgeText:async()=>{}}),
  tabs:area('tabs',{get:async(id:number)=>({id,url:readable(id)}),query:async()=>[...urls.keys()].map(id=>({id,windowId:1,url:readable(id)})),sendMessage:async(id:number,m:any)=>({ok:true,result:m.type==='snapshot'?{generation:'g',url:urls.get(id),nctIds:[],diagnostic:'',supported:true}:{}})}),
  scripting:area('scripting',{executeScript:async(v:any)=>{scripts.push(v);return[]}}),
  sidePanel:area('sidePanel',{setOptions:async()=>{},setPanelBehavior:async()=>{}}),
 };
 await import('../src/background');await flush();
 const ports=new Map<number,any>();
 for(const id of [1,2]){ev('action.onClicked').emit({id,url:SEARCH});await flush();
  const onMessage=new Events(),port:any={name:'treatable.site.overlay.v1',sender:{id:'test',tab:{id,url:SEARCH},frameId:2,documentId:'d'+id,url:origin+'/overlay.html'},onMessage,onDisconnect:new Events(),postMessage(){},disconnect(){}};ports.set(id,port);
  ev('runtime.onConnect').emit(port);onMessage.emit({type:'site.authenticate',capability:scripts.at(-1).args[0].capability});await flush();
  onMessage.emit({id:'h',type:'site.hide',payload:{expiresAt:Date.now()+60000}});await flush()}
 assert.equal(titles.filter(t=>t.tabId===1).at(-1)?.title,HIDDEN,'hiding sets the hidden title');
 titles.length=0;for(const id of [1,2]){ev('tabs.onUpdated').emit(id,{status:'complete'},{id,url:SEARCH});ev('tabs.onActivated').emit({tabId:id});await flush()}
 for(const id of [1,2])assert.deepEqual(of(id),[HIDDEN],`tab ${id}: every write while hidden says hidden`);
 /* Tab 1 leaves with a URL the browser reports, so the site assistant ends the tab itself. */
 titles.length=0;urls.set(1,ELSEWHERE);ev('tabs.onUpdated').emit(1,{url:ELSEWHERE,status:'loading'},{id:1,url:ELSEWHERE});await flush();ev('tabs.onActivated').emit({tabId:1});await flush();
 assert.deepEqual(of(1),[UNSUPPORTED],'a reported unsupported URL ends on the unsupported title, never Open Treatable');
 /* Tab 2 leaves with the URL withheld: the overlay frame goes with the old page, and its port ends after the title was already set. */
 urls.set(2,ELSEWHERE);ev('tabs.onUpdated').emit(2,{status:'loading'},{id:2});await flush();titles.length=0;
 ports.get(2).onDisconnect.emit();await flush();ev('tabs.onUpdated').emit(2,{status:'complete'},{id:2});ev('tabs.onActivated').emit({tabId:2});await flush();
 assert.deepEqual(of(2),[UNSUPPORTED],'a withheld URL reads as unsupported in both writers');
 assert.equal(titles.filter(t=>t.tabId===2).length>=2,true,'both writers wrote');
});
