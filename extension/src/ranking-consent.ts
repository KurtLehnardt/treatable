/**
 * The AI-matched results confirmation for this browser session. After the person confirms the first OpenAI ranking, later
 * rankings in the same browser session run without asking again. The record is one fixed marker string in
 * chrome.storage.session (memory only, cleared when the browser closes), so it never holds health details, search terms,
 * study IDs or any free text. Turning AI-matched results off removes it. Any read or write failure means "not confirmed".
 */
export const RANKING_CONSENT_KEY='treatable.rankingConsent';
/** Changing this value (for example when the notice changes) asks everyone again. */
export const RANKING_CONSENT_VALUE='openai-ranking-2026-10';
export interface RankingConsentArea{get:(key:string)=>Promise<unknown>;set:(items:Record<string,unknown>)=>Promise<void>;remove:(key:string)=>Promise<void>}
export interface RankingConsent{has():Promise<boolean>;grant():Promise<void>;clear():Promise<void>}
/** The session area from the given extension API root, or undefined when it is unavailable. */
export function rankingConsentArea(root:any):RankingConsentArea|undefined{const area=root?.storage?.session;return area&&typeof area.get==='function'&&typeof area.set==='function'&&typeof area.remove==='function'?area:undefined}
export function rankingConsent(area:RankingConsentArea|undefined):RankingConsent{
 return{
  async has(){if(!area)return false;try{const stored=await area.get(RANKING_CONSENT_KEY);return!!stored&&typeof stored==='object'&&Object.hasOwn(stored,RANKING_CONSENT_KEY)&&(stored as Record<string,unknown>)[RANKING_CONSENT_KEY]===RANKING_CONSENT_VALUE}catch{return false}},
  async grant(){if(!area)return;try{await area.set({[RANKING_CONSENT_KEY]:RANKING_CONSENT_VALUE})}catch{}},
  async clear(){if(!area)return;try{await area.remove(RANKING_CONSENT_KEY)}catch{}}
 };
}
