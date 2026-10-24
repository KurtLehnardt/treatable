import {TRIAL_ORIGINS,isSupportedSite} from './sites';
import {readPage} from './pageReader';
import {parsePageSource} from './core';
import {parseDemoRequest,parseDemoReply,type DemoRequest} from '../shared/demo-contract.mjs';
const panels=new Map<any,()=>void>();
function allowedPanel(sender:any){return sender?.id===chrome.runtime.id&&!sender.tab&&sender.url===chrome.runtime.getURL('panel.html')}
function attachPanel(panel:any){
 if(panel.name!=='treatable-panel-v2'||!allowedPanel(panel.sender)){panel.disconnect();return}
 let native:any,closed=false;const pending=new Map<string,{request:Pick<DemoRequest,'id'|'type'>,timer:ReturnType<typeof setTimeout>}>();
 const post=(message:unknown)=>{if(!closed)try{panel.postMessage(message)}catch{end()}};
 const failure=(id:string)=>({id,type:'result',ok:false,error:'The fixed API operation was unavailable. Local results are preserved.',code:'OPERATION_FAILED'});
 function end(){if(closed)return;closed=true;panels.delete(panel);for(const item of pending.values())clearTimeout(item.timer);pending.clear();try{native?.disconnect()}catch{}native=undefined;try{panel.disconnect()}catch{}}
 function connection(){if(native)return native;const connection=chrome.runtime.connectNative('com.treatable.local');native=connection;connection.onMessage.addListener((value:unknown)=>{if(native!==connection||!value||typeof value!=='object'||typeof(value as any).id!=='string')return;const id=(value as any).id,item=pending.get(id);if(!item)return;try{const reply=parseDemoReply(value,id);if(reply.type==='trace'){post({reply});return}if(item.request.type==='status'&&reply.type!=='status'||item.request.type!=='status'&&reply.type!=='result')throw new Error('Response mismatch');clearTimeout(item.timer);pending.delete(id);post({reply:!reply.ok?failure(id):reply.type==='status'?{id,type:'status',ok:true,provider:'openai',configured:reply.configured,message:reply.configured?'Dedicated credential configured.':'Dedicated credential setup required.'}:reply})}catch{clearTimeout(item.timer);pending.delete(id);post({reply:failure(id)})}});connection.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(native===connection){native=undefined;for(const[id,item]of pending){clearTimeout(item.timer);post({reply:failure(id)})}pending.clear()}});return connection}
 panel.onMessage.addListener((message:any)=>{if(closed)return;if(message?.kind!=='native')return;let request:DemoRequest;try{request=parseDemoRequest(message.request);if(pending.has(request.id)||pending.size>=4)throw new Error('Busy')}catch{end();return}const timer=setTimeout(()=>{pending.delete(request.id);post({reply:failure(request.id)});end()},150000);pending.set(request.id,{request:{id:request.id,type:request.type},timer});try{connection().postMessage(request)}catch{clearTimeout(timer);pending.delete(request.id);post({reply:failure(request.id)})}});
 panel.onDisconnect.addListener(end);panels.set(panel,end);post({kind:'panelReady'});
}
chrome.runtime.onConnect.addListener(attachPanel);
async function readCurrentPage(){const[tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||typeof tab.url!=='string'||!isSupportedSite(tab.url))throw new Error('Unsupported page');const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readPage,args:[[...TRIAL_ORIGINS]]});return parsePageSource(results?.[0]?.result)}
// A manifest default_path is global. Keep the default disabled and opt in per tab.
void chrome.sidePanel.setOptions({enabled:false}).catch(()=>{});
void chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(()=>{});
function configurePanel(tab:any){
 if(!Number.isInteger(tab?.id)||tab.id<0)return Promise.resolve();
 const enabled=typeof tab.url==='string'&&isSupportedSite(tab.url);
 return chrome.sidePanel.setOptions(enabled?{tabId:tab.id,path:'panel.html',enabled:true}:{tabId:tab.id,enabled:false}).catch(()=>{});
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
chrome.action.onClicked.addListener((tab:any)=>{
 if(!Number.isInteger(tab?.id)||tab.id<0)return;
 if(typeof tab.url!=='string'||!isSupportedSite(tab.url)){void updatePanel({id:tab.id});return}
 // Queue configuration before opening, without awaiting and losing the user gesture.
 void updatePanel(tab);
 void chrome.sidePanel.open({tabId:tab.id}).catch(()=>{});
});
// Chrome 142+: any closed panel ends all panel sessions, deliberately privacy-first.
chrome.sidePanel.onClosed.addListener(()=>{for(const[panel,end]of [...panels]){try{panel.postMessage({kind:'endSession'})}catch{}end()}panels.clear()});
chrome.runtime.onMessage.addListener((message:any,sender:any,respond:(v:unknown)=>void)=>{if(!allowedPanel(sender))return false;if(message?.kind==='readPage'){void readCurrentPage().then(source=>respond({ok:true,source})).catch(()=>respond({ok:false,error:'Open a supported ClinicalTrials.gov study page and retry.'}));return true}return false});
