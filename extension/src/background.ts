import './zod-jitless';
import{installLiveBroker,PRIVATE_LIVE_PORT}from'./live-background';
import {installSiteAssistant,isSitePort,isProtectedPanelSender} from './site-background';
import {TRIAL_ORIGINS,isSupportedSite} from './sites';
import {readPage} from './pageReader';
import {parsePageSource} from './core';
import {parseDemoRequest,parseDemoReply,type DemoRequest,type DemoReply} from '../shared/demo-contract.mjs';
import {FAILURE_CODE,failureCopy,nativeDisconnectCode} from './failures';
const panels=new Map<any,()=>void>();
function allowedPanel(sender:any){return isProtectedPanelSender(chrome,sender)}
/** Failure replies carry a validated code and fixed text, never transported error content. */
function failure(id:string,code:string){const safe=FAILURE_CODE.test(code)?code:'UNEXPECTED_FAILURE';return{id,type:'result',ok:false,code:safe,error:failureCopy(safe)}}
function attachPanel(panel:any){
 if(panel.name!=='treatable-panel-v2'||!allowedPanel(panel.sender)){panel.disconnect();return}
 let native:any,closed=false;const pending=new Map<string,{request:Pick<DemoRequest,'id'|'type'>,timer:ReturnType<typeof setTimeout>}>();
 const post=(message:unknown)=>{if(!closed)try{panel.postMessage(message)}catch{end()}};
 const settle=(id:string,reply:unknown)=>{const item=pending.get(id);if(!item)return;clearTimeout(item.timer);pending.delete(id);post({reply})};
 function end(){if(closed)return;closed=true;panels.delete(panel);for(const item of pending.values())clearTimeout(item.timer);pending.clear();try{native?.disconnect()}catch{}native=undefined;try{panel.disconnect()}catch{}}
 function connection(){if(native)return native;const connection=chrome.runtime.connectNative('com.treatable.local');native=connection;
  connection.onMessage.addListener((value:unknown)=>{
   // Unsolicited or unknown IDs are dropped without a reply.
   if(native!==connection||!value||typeof value!=='object'||typeof(value as any).id!=='string')return;const id=(value as any).id,item=pending.get(id);if(!item)return;
   let reply:DemoReply;try{reply=parseDemoReply(value,id)}catch{settle(id,failure(id,'INVALID_NATIVE_REPLY'));return}
   if(reply.type==='trace'){post({reply});return}
   if(reply.type==='result'&&!reply.ok){settle(id,failure(id,reply.code!));return}
   if(item.request.type==='status'){if(reply.type!=='status'){settle(id,failure(id,'INVALID_NATIVE_REPLY'));return}settle(id,{id,type:'status',ok:true,provider:'openai',configured:reply.configured,message:reply.configured?'Dedicated credential configured.':'Dedicated credential setup required.'});return}
   if(reply.type!=='result'){settle(id,failure(id,'INVALID_NATIVE_REPLY'));return}
   settle(id,reply.result===undefined?{id,type:'result',ok:true}:{id,type:'result',ok:true,result:reply.result});
  });
  connection.onDisconnect.addListener(()=>{
   // Always read lastError: it is the only signal for a missing or forbidden host, and reading it avoids unchecked-error noise.
   const code=nativeDisconnectCode(chrome.runtime.lastError?.message);
   if(native!==connection)return;native=undefined;for(const id of [...pending.keys()])settle(id,failure(id,code));
  });
  return connection}
 panel.onMessage.addListener((message:any)=>{if(closed)return;if(message?.kind!=='native')return;let request:DemoRequest;try{request=parseDemoRequest(message.request);if(pending.has(request.id)||pending.size>=4)throw new Error('Busy')}catch{end();return}
  const timer=setTimeout(()=>{settle(request.id,failure(request.id,'NATIVE_TIMEOUT'));end()},150000);pending.set(request.id,{request:{id:request.id,type:request.type},timer});
  let port:any;try{port=connection();port.postMessage(request)}catch(error){if(port&&native===port){native=undefined;try{port.disconnect()}catch{}}settle(request.id,failure(request.id,nativeDisconnectCode(error instanceof Error?error.message:'')))}});
 panel.onDisconnect.addListener(end);panels.set(panel,end);post({kind:'panelReady'});
}
chrome.runtime.onConnect.addListener((port:any)=>{if(!isSitePort(port.name)&&port.name!==PRIVATE_LIVE_PORT)attachPanel(port)});
let liveBroker:ReturnType<typeof installLiveBroker>|undefined;
const siteAssistant=installSiteAssistant(chrome,{onProtectedEnd:tabId=>{liveBroker?.endTab(tabId);for(const[panel,end]of [...panels])if(panel.sender?.tab?.id===tabId){try{panel.postMessage({kind:'endSession'})}catch{}end()}}});
liveBroker=installLiveBroker(chrome,siteAssistant);
async function readCurrentPage(){const[tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||typeof tab.url!=='string'||!isSupportedSite(tab.url))throw new Error('Unsupported page');const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readPage,args:[[...TRIAL_ORIGINS]]});return parsePageSource(results?.[0]?.result)}
// A manifest default_path is global. Keep the default disabled and opt in per tab.
void chrome.sidePanel.setOptions({enabled:false}).catch(()=>{});
void chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(()=>{});
function configurePanel(tab:any){
 if(!Number.isInteger(tab?.id)||tab.id<0)return Promise.resolve();
 return chrome.sidePanel.setOptions({tabId:tab.id,enabled:false}).catch(()=>{});
}
let panelSequence=0;
const panelRevisions=new Map<number,number>();
function updatePanel(tab:any){if(Number.isInteger(tab?.id)&&tab.id>=0)panelRevisions.set(tab.id,++panelSequence);return configurePanel(tab)}
async function initializePanels(){
 const revision=panelSequence;
 try{const tabs=await chrome.tabs.query({});
 // Close only this extension's legacy global panels; tab panels use separate options.
 for(const windowId of new Set(tabs.map((tab:any)=>tab.windowId).filter((id:any)=>Number.isInteger(id)&&id>=0)))void chrome.sidePanel.close({windowId}).catch(()=>{});
 await Promise.all(tabs.filter((tab:any)=>(panelRevisions.get(tab.id)??0)<=revision).map(updatePanel));
 }catch{}
}
void initializePanels();
chrome.runtime.onInstalled.addListener(()=>{void initializePanels()});
chrome.runtime.onStartup.addListener(()=>{void initializePanels()});
chrome.tabs.onUpdated.addListener((tabId:number,change:any,tab:any)=>{void updatePanel({...tab,id:tabId,url:change.url??tab.url})});
chrome.tabs.onActivated.addListener(({tabId}:{tabId:number})=>{
 const revision=++panelSequence;panelRevisions.set(tabId,revision);
 void chrome.tabs.get(tabId).then((tab:any)=>{if(panelRevisions.get(tabId)===revision)void configurePanel(tab)}).catch(()=>{if(panelRevisions.get(tabId)===revision)void configurePanel({id:tabId})});
});
chrome.tabs.onRemoved.addListener((tabId:number)=>{panelRevisions.delete(tabId)});
// Chrome 142+: any closed panel ends all panel sessions, deliberately privacy-first.
chrome.sidePanel.onClosed.addListener(()=>{for(const[panel,end]of [...panels]){try{panel.postMessage({kind:'endSession'})}catch{}end()}panels.clear()});
chrome.runtime.onMessage.addListener((message:any,sender:any,respond:(v:unknown)=>void)=>{if(!allowedPanel(sender))return false;if(message?.kind==='readPage'){void readCurrentPage().then(source=>respond({ok:true,source})).catch(()=>respond({ok:false,error:'Open a supported ClinicalTrials.gov study page and retry.'}));return true}return false});
