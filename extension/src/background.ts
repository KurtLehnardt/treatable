import './zod-jitless';
import{installLiveBroker,PRIVATE_LIVE_PORT}from'./live-background';
import{installApplyBroker,APPLY_PORT}from'./apply-background';
import {installSiteAssistant,isSitePort} from './site-background';
import {isSupportedSite} from './sites';
import {clearLegacyPatientData} from './storage';
// Every port belongs to exactly one broker below (site overlay/badge, private live matching, apply). Any other name, including the retired side-panel port, is disconnected unanswered.
chrome.runtime.onConnect.addListener((port:any)=>{if(!isSitePort(port.name)&&port.name!==PRIVATE_LIVE_PORT&&port.name!==APPLY_PORT)try{port.disconnect()}catch{}});
let liveBroker:ReturnType<typeof installLiveBroker>|undefined;
const siteAssistant=installSiteAssistant(chrome,{onProtectedEnd:tabId=>{liveBroker?.endTab(tabId)}});
liveBroker=installLiveBroker(chrome,siteAssistant);
// Help me apply: study-page overlay frame only; public NCT ID and prepared receipt only.
installApplyBroker(chrome,siteAssistant);
// The toolbar title says what a click does on this tab. Tab URLs are readable only on the supported sites, so any other tab reads as unsupported. Titles need no permission.
function setActionTitle(tab:any){try{void Promise.resolve(chrome.action.setTitle({tabId:tab.id,title:isSupportedSite(tab.url??'')?'Open Treatable':'Open ClinicalTrials.gov to use Treatable'})).catch(()=>{})}catch{}}
// Revisions keep a late startup snapshot from overwriting the title of a tab that navigated or activated after the snapshot began.
let titleSequence=0;
const titleRevisions=new Map<number,number>();
function updateTitle(tab:any){if(!Number.isInteger(tab?.id)||tab.id<0)return;titleRevisions.set(tab.id,++titleSequence);setActionTitle(tab)}
async function initializeTitles(){
 const revision=titleSequence;
 try{const tabs=await chrome.tabs.query({});
 for(const tab of tabs)if((titleRevisions.get(tab.id)??0)<=revision)updateTitle(tab);
 }catch{}
}
void initializeTitles();
chrome.runtime.onInstalled.addListener(()=>{void initializeTitles();/* Deletion-only cleanup of the key an earlier version stored patient text under. */void clearLegacyPatientData(chrome.storage?.session,chrome.storage?.local).catch(()=>{})});
chrome.runtime.onStartup.addListener(()=>{void initializeTitles()});
chrome.tabs.onUpdated.addListener((tabId:number,change:any,tab:any)=>{updateTitle({...tab,id:tabId,url:change.url??tab.url})});
chrome.tabs.onActivated.addListener(({tabId}:{tabId:number})=>{
 const revision=++titleSequence;titleRevisions.set(tabId,revision);
 void chrome.tabs.get(tabId).then((tab:any)=>{if(titleRevisions.get(tabId)===revision)setActionTitle(tab)}).catch(()=>{if(titleRevisions.get(tabId)===revision)setActionTitle({id:tabId})});
});
chrome.tabs.onRemoved.addListener((tabId:number)=>{titleRevisions.delete(tabId)});
