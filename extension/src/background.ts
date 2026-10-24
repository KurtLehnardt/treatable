import {TRIAL_ORIGINS,isSupportedSite} from './sites';
import {readPage} from './pageReader';
import {parsePageSource} from './core';
import {parseLocalRequest,parseNativeReply,type LocalRequest} from './validation';
const pending=new Map<string,{resolve:(value:unknown)=>void,timer:ReturnType<typeof setTimeout>,request:Pick<LocalRequest,'id'|'type'>}>();
let nativePort:any;
function failPending(){for(const[id,item]of pending){clearTimeout(item.timer);item.resolve({id,type:'result',ok:false,error:'Local helper disconnected. Source results are preserved.'});}pending.clear();nativePort=undefined;}
function port(){
 if(nativePort)return nativePort;const connection=chrome.runtime.connectNative('com.treatable.local');nativePort=connection;
 connection.onMessage.addListener((message:unknown)=>{if(nativePort!==connection||!message||typeof message!=='object'||typeof(message as any).id!=='string')return;const id=(message as any).id,item=pending.get(id);if(!item)return;clearTimeout(item.timer);pending.delete(id);try{item.resolve(parseNativeReply(message,item.request))}catch{item.resolve({id,type:'result',ok:false,error:'Local helper returned an unsupported response. Source checks are preserved.'})}});
 connection.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(nativePort===connection)failPending()});return connection;
}
async function sendNative(input:unknown){
 const request=parseLocalRequest(input);if(pending.has(request.id))throw new Error('Duplicate local request.');if(pending.size>=6)throw new Error('Local helper busy. Stop the current explanation first.');
 return new Promise(resolve=>{const id=request.id;const timer=setTimeout(()=>{pending.delete(id);resolve({id,type:'result',ok:false,error:'Local model timed out. Source results are preserved.'})},95000);pending.set(id,{resolve,timer,request:{id,type:request.type}});try{port().postMessage(request)}catch{clearTimeout(timer);pending.delete(id);resolve({id,type:'result',ok:false,error:'Install the local helper to enable private explanations.'})}});
}
async function readCurrentPage(){const[tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||typeof tab.url!=='string'||!isSupportedSite(tab.url))throw new Error('Open an HTTPS ClinicalTrials.gov page. Other sites are not supported.');const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readPage,args:[[...TRIAL_ORIGINS]]});return parsePageSource(results?.[0]?.result);}
chrome.action.onClicked.addListener((tab:any)=>{if(tab?.windowId!==undefined)void chrome.sidePanel.open({windowId:tab.windowId})});
chrome.runtime.onMessage.addListener((message:any,sender:any,respond:(v:unknown)=>void)=>{const origin=`chrome-extension://${chrome.runtime.id}/`;if(sender.id!==chrome.runtime.id||sender.tab||typeof sender.url!=='string'||!sender.url.startsWith(origin))return false;if(message?.kind==='nativeDisconnect'){nativePort?.disconnect();failPending();respond({ok:true});return false}if(message?.kind==='native'){void sendNative(message.request).then(respond).catch(()=>respond({ok:false,error:'Invalid or unavailable local request. Source checks are preserved.'}));return true}if(message?.kind==='readPage'){void readCurrentPage().then(source=>respond({ok:true,source})).catch(()=>respond({ok:false,error:'Open an HTTPS ClinicalTrials.gov page, then click Analyze. This release cannot read other sites.'}));return true}return false});
