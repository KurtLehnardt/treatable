import {PatientProfileSchema,type PatientProfile} from './core';
export interface StoredState{profile?:PatientProfile;savedIds:string[]}
export const STORAGE_KEY='treatable.patient.v1';
export interface StorageArea{get:(key:string)=>Promise<Record<string,unknown>>;set:(value:Record<string,unknown>)=>Promise<void>;remove:(key:string)=>Promise<void>;setAccessLevel?:(arg:{accessLevel:string})=>Promise<void>}
export async function secureStorage(session:StorageArea,local:StorageArea){await session.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});await local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});}
export async function loadState(session:StorageArea,local:StorageArea):Promise<{state:StoredState;remember:boolean}>{for(const [area,remember]of [[session,false],[local,true]]as const){const raw=(await area.get(STORAGE_KEY))[STORAGE_KEY];if(!raw||typeof raw!=='object')continue;const value=raw as Record<string,unknown>;const parsed=PatientProfileSchema.safeParse(value.profile);return{state:{profile:parsed.success?parsed.data:undefined,savedIds:Array.isArray(value.savedIds)?value.savedIds.filter((v):v is string=>typeof v==='string'&&/^NCT\d{8}$/.test(v)).slice(0,200):[]},remember};}return{state:{savedIds:[]},remember:false}}
export async function saveState(session:StorageArea,local:StorageArea,state:StoredState,remember:boolean){const target=remember?local:session,other=remember?session:local;await other.remove(STORAGE_KEY);await target.set({[STORAGE_KEY]:state})}
export async function clearState(session:StorageArea,local:StorageArea){await Promise.all([session.remove(STORAGE_KEY),local.remove(STORAGE_KEY)])}

/** Non-patient preferences. Consent and threshold persist in local storage; they contain no health data. */
export const SETTINGS_KEY = 'treatable.settings.v1';
export type ProviderChoice = 'openai' | 'local' | 'none';
export interface Settings {provider?: ProviderChoice; openaiConsent: boolean; minMatch: 50 | 65 | 80; rememberKey: boolean; localModel?: string}
export const DEFAULT_SETTINGS: Settings = {openaiConsent: false, minMatch: 80, rememberKey: false};
export async function loadSettings(local: StorageArea): Promise<Settings> {
  const raw = (await local.get(SETTINGS_KEY))[SETTINGS_KEY];
  if (!raw || typeof raw !== 'object') return {...DEFAULT_SETTINGS};
  const v = raw as Record<string, unknown>;
  return {
    provider: v.provider === 'openai' || v.provider === 'local' || v.provider === 'none' ? v.provider : undefined,
    openaiConsent: v.openaiConsent === true,
    minMatch: v.minMatch === 50 || v.minMatch === 65 || v.minMatch === 80 ? v.minMatch : 80,
    rememberKey: v.rememberKey === true,
    localModel: typeof v.localModel === 'string' && v.localModel.length <= 150 ? v.localModel : undefined,
  };
}
export async function saveSettings(local: StorageArea, settings: Settings) { await local.set({[SETTINGS_KEY]: settings}); }

/**
 * The OpenAI key and the user's BAA attestation, stored together: chrome.storage.session by
 * default, chrome.storage.local only when Remember is selected. Forgetting the key forgets the
 * attestation too.
 */
export const KEY_STORAGE_KEY = 'treatable.openai.key.v1';
export interface StoredKey {key: string; baaAttested: boolean}
export async function loadApiKey(session: StorageArea, local: StorageArea): Promise<StoredKey> {
  for (const area of [session, local]) {
    const v = (await area.get(KEY_STORAGE_KEY))[KEY_STORAGE_KEY];
    if (typeof v === 'string' && v.trim()) return {key: v.trim(), baaAttested: false};
    if (v && typeof v === 'object') {
      const r = v as Record<string, unknown>;
      if (typeof r.key === 'string' && r.key.trim()) return {key: r.key.trim(), baaAttested: r.baaAttested === true};
    }
  }
  return {key: '', baaAttested: false};
}
export async function saveApiKey(session: StorageArea, local: StorageArea, key: string, remember: boolean, baaAttested = false) {
  const target = remember ? local : session, other = remember ? session : local;
  await other.remove(KEY_STORAGE_KEY);
  if (key.trim()) await target.set({[KEY_STORAGE_KEY]: {key: key.trim(), baaAttested}}); else await target.remove(KEY_STORAGE_KEY);
}
export async function clearApiKey(session: StorageArea, local: StorageArea) { await Promise.all([session.remove(KEY_STORAGE_KEY), local.remove(KEY_STORAGE_KEY)]); }
