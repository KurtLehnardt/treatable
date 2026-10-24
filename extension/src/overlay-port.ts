import {TRIAL_ORIGINS} from './sites';
import {SITE_FILTERS} from './site-filter-catalog';
import {SITE_MAX_MESSAGE_BYTES,siteBytes} from './site-contract';
import type {OverlayReady,OverlaySnapshot,OverlayStudy} from './overlay-types';
/** Study page binding chosen by the background from the validated tab URL; only a strict public NCT ID is accepted. */
export function parseStudy(v:unknown):OverlayStudy|undefined{return object(v)&&Object.keys(v).length===1&&typeof v.nctId==='string'&&/^NCT[0-9]{8}$/.test(v.nctId)?{nctId:v.nctId}:undefined}
export type SitePurpose='overlay'|'badge';
export interface SitePort {postMessage:(v:unknown)=>void;disconnect:()=>void;onMessage:{addListener:(f:(v:any)=>void)=>void};onDisconnect:{addListener:(f:()=>void)=>void}}
export interface SiteRuntime {connect:(options:{name:string})=>SitePort}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function parseSnapshot(v:unknown):OverlaySnapshot {
 if(!object(v)||typeof v.generation!=='string'||v.generation.length>160||typeof v.url!=='string'||typeof v.diagnostic!=='string'||v.diagnostic.length>2000||typeof v.supported!=='boolean'||!Array.isArray(v.nctIds)||v.nctIds.length>100||v.nctIds.some((id:unknown)=>typeof id!=='string'||!/^NCT[0-9]{8}$/.test(id))||new Set(v.nctIds).size!==v.nctIds.length)throw Error('The page snapshot was rejected.');
 const url=new URL(v.url);if(!TRIAL_ORIGINS.includes(url.origin)||url.username||url.password)throw Error('Unsupported page snapshot.');
 for(const key of ['totalCards','hiddenCards','unverifiedCards','distanceHiddenCards'])if(v[key]!==undefined&&(!Number.isInteger(v[key])||v[key]<0||v[key]>100))throw Error('Invalid public card count');if(v.allNctIds!==undefined&&(!Array.isArray(v.allNctIds)||v.allNctIds.length>100||v.allNctIds.some((id:any)=>typeof id!=='string'||!/^NCT[0-9]{8}$/.test(id))||new Set(v.allNctIds).size!==v.allNctIds.length))throw Error('Invalid public card set');return {generation:v.generation,url:v.url,nctIds:[...v.nctIds],diagnostic:v.diagnostic,supported:v.supported,...(v.totalCards!==undefined?{totalCards:v.totalCards}:{}),...(v.hiddenCards!==undefined?{hiddenCards:v.hiddenCards}:{}),...(v.unverifiedCards!==undefined?{unverifiedCards:v.unverifiedCards}:{}),...(v.allNctIds?{allNctIds:[...v.allNctIds]}:{}),...(v.distanceHiddenCards!==undefined?{distanceHiddenCards:v.distanceHiddenCards}:{})};
}
export function readActivation(event:Pick<MessageEvent,'source'|'origin'|'data'>,parent:Window,purpose:SitePurpose){
 if(event.source!==parent||!(TRIAL_ORIGINS as readonly string[]).includes(event.origin)||!object(event.data))return;
 const v=event.data;if(Object.keys(v).some(k=>!['type','capability','purpose','nctId'].includes(k))||v.type!=='treatable.site.activate'||v.purpose!==purpose||typeof v.capability!=='string'||!/^[A-Za-z0-9_-]{24,160}$/.test(v.capability))return;
 if(v.nctId!==undefined&&(typeof v.nctId!=='string'||!/^NCT[0-9]{8}$/.test(v.nctId)))return;
 return {capability:v.capability,nctId:v.nctId as string|undefined};
}
type ActivationListener=(event:MessageEvent)=>void;
const activationInboxes=new WeakMap<Window,{listeners:Map<SitePurpose,Set<ActivationListener>>;pending:Map<SitePurpose,{event:MessageEvent;expires:number}>}>();
/** Install while the module executes, before the parent frame's load handler can send its one-use capability. */
export function captureSiteActivations(target:Window){
 if(activationInboxes.has(target))return;
 const state={listeners:new Map<SitePurpose,Set<ActivationListener>>(),pending:new Map<SitePurpose,{event:MessageEvent;expires:number}>()};activationInboxes.set(target,state);
 target.addEventListener('message',(event:MessageEvent)=>{for(const purpose of ['overlay','badge'] as const){if(!readActivation(event,target.parent,purpose))continue;const listeners=state.listeners.get(purpose);if(listeners?.size){for(const listener of listeners)listener(event)}else state.pending.set(purpose,{event,expires:Date.now()+8000})}});
}
export function subscribeSiteActivation(target:Window,purpose:SitePurpose,listener:ActivationListener){captureSiteActivations(target);const state=activationInboxes.get(target)!;let listeners=state.listeners.get(purpose);if(!listeners){listeners=new Set();state.listeners.set(purpose,listeners)}listeners.add(listener);const waiting=state.pending.get(purpose);state.pending.delete(purpose);if(waiting&&waiting.expires>=Date.now())queueMicrotask(()=>{if(listeners!.has(listener))listener(waiting.event)});return()=>{listeners!.delete(listener);state.pending.delete(purpose)}}
/** Only the opaque one-use activation reaches this iframe through window messaging. All data uses extension runtime ports. */
export class SiteClient {
 private port?:SitePort;private cancelAuth?:()=>void;private ended=false;private ready=false;private pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();private listeners=new Set<(v:any)=>void>();
 constructor(private runtime:SiteRuntime,private purpose:SitePurpose='overlay'){}
 onEvent(listener:(event:any)=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener)}
 authenticate(capability:string):Promise<OverlayReady>{
 if(this.ended)return Promise.reject(Error('The session has ended.'));if(this.port)return Promise.reject(Error('Activation already started.'));
 const port=this.runtime.connect({name:this.purpose==='overlay'?'treatable.site.overlay.v1':'treatable.site.badge.v1'});this.port=port;
 return new Promise((resolve,reject)=>{const authTimer=setTimeout(()=>{this.disconnect();reject(Error('Open Treatable from its toolbar button on ClinicalTrials.gov.'))},8000);this.cancelAuth=()=>{clearTimeout(authTimer);reject(Error('The activation session ended.'))};
 port.onMessage.addListener((v:any)=>{if(this.ended||this.port!==port||!object(v)||siteBytes(v)>SITE_MAX_MESSAGE_BYTES)return;
  if(v.type==='site.ready'){try{const snapshot=parseSnapshot(v.snapshot);if(!Array.isArray(v.filters)||v.filters.length>100)throw Error();this.ready=true;clearTimeout(authTimer);this.cancelAuth=undefined;const study=parseStudy(v.study);resolve({snapshot,filters:SITE_FILTERS.map(f=>({...f,options:f.options?.map(o=>({...o}))})),search:object(v.search)?v.search:undefined,compact:v.compact===true,...(study?{study}:{})});this.emit(v)}catch{this.disconnect();reject(Error('The site connection was rejected.'))}return}
  if(v.type==='site.snapshot'){try{this.emit({...v,snapshot:parseSnapshot(v.snapshot)})}catch{}return}
  if(v.type==='site.study'){if(this.ready)this.emit({type:'site.study',study:parseStudy(v.study)});return}
  if(v.type==='site.guide'){if(this.ready)this.emit(v);return}if(v.type==='site.availability'){this.emit(v);return}if(v.type==='site.badge'){this.emit(v);return}
  if(typeof v.id!=='string')return;const item=this.pending.get(v.id);if(!item)return;clearTimeout(item.timer);this.pending.delete(v.id);v.ok===true?item.resolve(v.result):item.reject(Error('The site action did not complete. Your local inputs were not sent.'));
 });
 port.onDisconnect.addListener(()=>{clearTimeout(authTimer);this.cancelAuth=undefined;this.port=undefined;this.ready=false;this.rejectPending();if(!this.ended)this.emit({type:'site.ended'});reject(Error('The site session closed.'))});
 port.postMessage({type:'site.authenticate',capability});
 });
 }
 request(type:string,payload:Record<string,unknown>={}):Promise<any>{if(!this.port||!this.ready||this.ended)return Promise.reject(Error('Open Treatable using its toolbar button first.'));if(this.pending.size>=4)return Promise.reject(Error('Wait for the current site action.'));const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('The site action timed out.'))},20000);this.pending.set(id,{resolve,reject,timer});try{this.port!.postMessage({id,type,payload})}catch{clearTimeout(timer);this.pending.delete(id);reject(Error('The site connection is unavailable.'))}})}
 private emit(v:any){for(const listener of this.listeners)listener(v)}
 private rejectPending(){for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(Error('The session has ended.'))}this.pending.clear()}
 disconnect(){if(this.ended)return;this.ended=true;this.cancelAuth?.();this.cancelAuth=undefined;this.ready=false;this.rejectPending();const port=this.port;this.port=undefined;try{port?.disconnect()}catch{}this.listeners.clear()}
}
