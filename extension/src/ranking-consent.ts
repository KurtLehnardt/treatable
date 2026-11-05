/**
 * The AI-matched results switch as the person last set it: off, or on beside the OpenAI or the local model disclosure (ai-switch.ts).
 * Only the background service worker reads or writes it (site-background.ts), and it writes it only when the authenticated overlay
 * frame reports that the person turned the switch on with their own click or key press, or turned it off. The record is one fixed
 * marker string under one key in chrome.storage.local, kept on this device until the switch is turned off, so it never holds health
 * details, search terms, study IDs or any free text. A missing, unknown or unreadable value means off.
 * The key is new in this version: a switch that an earlier version saved as on (in the preferences record) reads as off here until the
 * person turns it on again beside the disclosure.
 */
import {isAiConsent,type AiConsent} from './ai-switch';
export const RANKING_CONSENT_KEY='treatable.aiRankingConsent';
/** Changing a value (for example when its disclosure changes) turns the switch off for everyone until they turn it on again. */
export const RANKING_CONSENT_VALUES:Readonly<Record<AiConsent,string>>=Object.freeze({openai:'openai-switch-2026-11',local:'local-switch-2026-11'});
export interface RankingConsentArea{get:(key:string)=>Promise<unknown>;set:(items:Record<string,unknown>)=>Promise<void>;remove:(key:string)=>Promise<void>}
export interface RankingConsent{get():Promise<AiConsent|null>;grant(consent:AiConsent):Promise<boolean>;revoke():Promise<boolean>;watch(listener:(consent:AiConsent|null)=>void):()=>void}
function parse(value:unknown):AiConsent|null{return value===RANKING_CONSENT_VALUES.openai?'openai':value===RANKING_CONSENT_VALUES.local?'local':null}
/** chrome.storage.local from the given extension API root, or undefined when it is unavailable. */
export function rankingConsentArea(root:any):RankingConsentArea|undefined{const area=root?.storage?.local;return area&&typeof area.get==='function'&&typeof area.set==='function'&&typeof area.remove==='function'?area:undefined}
/** `root` supplies chrome.storage.onChanged for watch(). Any read failure reads as off; a failed write reports false. */
export function rankingConsent(area:RankingConsentArea|undefined,root?:any):RankingConsent{
 return{
  async get(){if(!area)return null;try{const stored=await area.get(RANKING_CONSENT_KEY);return stored&&typeof stored==='object'&&Object.hasOwn(stored,RANKING_CONSENT_KEY)?parse((stored as Record<string,unknown>)[RANKING_CONSENT_KEY]):null}catch{return null}},
  async grant(consent){if(!area||!isAiConsent(consent))return false;try{await area.set({[RANKING_CONSENT_KEY]:RANKING_CONSENT_VALUES[consent]});return true}catch{return false}},
  /* Turning the switch off must stick: a failed removal is tried twice more before it is reported. */
  async revoke(){if(!area)return true;for(let attempt=0;attempt<3;attempt++){try{await area.remove(RANKING_CONSENT_KEY);return true}catch{}}return false},
  watch(listener){const source=root?.storage?.onChanged;if(!source||typeof source.addListener!=='function')return()=>{};const changed=(changes:Record<string,{newValue?:unknown}>,areaName:string)=>{if(areaName==='local'&&changes&&Object.hasOwn(changes,RANKING_CONSENT_KEY))listener(parse(changes[RANKING_CONSENT_KEY]?.newValue))};source.addListener(changed);return()=>source.removeListener?.(changed)},
 };
}
/** Asks Chrome to keep chrome.storage.local, which holds this record and the preferences, away from content scripts, so only the
 * extension's own pages and its service worker can read or write it. The background calls this every time it starts. */
export function limitStorageToExtension(root:any){try{void Promise.resolve(root?.storage?.local?.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'})).catch(()=>{})}catch{}}
