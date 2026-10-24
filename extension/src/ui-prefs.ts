/**
 * Non-health preferences. This is the only data Treatable persists in chrome.storage, under one key: the display mode, the theme, the
 * model provider for study briefs and the chosen local model name. Every value is an enum except the model name, which must be an
 * Ollama library-style name (see shared/local-model.mjs). It never holds patient details, names, search terms, study IDs or other free
 * text. Patient data is session-only and is cleared by "Clear all" and "End session"; these preferences are deliberately kept.
 */
import {isLocalModelName} from '../shared/local-model.mjs';
export const UI_PREFS_KEY = 'treatable.uiPrefs';
export const DISPLAY_MODES = ['overlay', 'popup', 'sidebar'] as const;
export const THEMES = ['system', 'light', 'dark'] as const;
/** Who generates study briefs: OpenAI (the default) or a local model through Ollama on this device. */
export const MODEL_PROVIDERS = ['openai', 'local'] as const;
export type DisplayMode = typeof DISPLAY_MODES[number];
export type Theme = typeof THEMES[number];
export type ModelProvider = typeof MODEL_PROVIDERS[number];
export interface UiPrefs {displayMode: DisplayMode; theme: Theme; provider: ModelProvider; localModel: string | null}
export const DEFAULT_UI_PREFS: Readonly<UiPrefs> = Object.freeze({displayMode: 'popup', theme: 'system', provider: 'openai', localModel: null});
/** The only storage operations this module performs: read and write the single preferences key. */
export interface UiPrefsArea {
 get: (key: string) => Promise<unknown>;
 set: (items: Record<string, unknown>) => Promise<void>;
}
export interface UiPrefsChangeSource {
 addListener: (listener: (changes: Record<string, {newValue?: unknown}>, areaName: string) => void) => void;
 removeListener?: (listener: (changes: Record<string, {newValue?: unknown}>, areaName: string) => void) => void;
}

export const isDisplayMode = (value: unknown): value is DisplayMode => typeof value === 'string' && (DISPLAY_MODES as readonly string[]).includes(value);
export const isTheme = (value: unknown): value is Theme => typeof value === 'string' && (THEMES as readonly string[]).includes(value);
export const isModelProvider = (value: unknown): value is ModelProvider => typeof value === 'string' && (MODEL_PROVIDERS as readonly string[]).includes(value);
/** null (no local model chosen yet) or a strictly validated Ollama model name such as qwen3.5:9b. */
export const isLocalModelPref = (value: unknown): value is string | null => value === null || isLocalModelName(value);

const PREF_KEYS = ['displayMode', 'theme', 'provider', 'localModel'];
/**
 * Strict schema check. The value must be a plain object with exactly the four known keys: display mode, theme and provider each hold an
 * allowed enum value and localModel holds null or a valid model name. A record saved before the provider setting existed (exactly
 * displayMode and theme) still loads, with OpenAI as the provider. Anything else (extra or missing keys, wrong types, unknown values) is
 * rejected as a whole. The result is always a fresh object built from the validated fields, so nothing from the input is carried through.
 */
export function parseUiPrefs(value: unknown): UiPrefs | undefined {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
 const prototype = Object.getPrototypeOf(value);
 if (prototype !== Object.prototype && prototype !== null) return undefined;
 const keys = Object.keys(value), legacy = keys.length === 2 && keys.includes('displayMode') && keys.includes('theme');
 if (!legacy && (keys.length !== PREF_KEYS.length || !PREF_KEYS.every(key => keys.includes(key)))) return undefined;
 const record = value as Record<string, unknown>, {displayMode, theme} = record;
 const provider = legacy ? 'openai' : record.provider, localModel = legacy ? null : record.localModel;
 return isDisplayMode(displayMode) && isTheme(theme) && isModelProvider(provider) && isLocalModelPref(localModel) ? {displayMode, theme, provider, localModel} : undefined;
}

/** Returns chrome.storage.local from the given extension API root, or undefined when storage is unavailable. */
export function uiPrefsArea(root: any = typeof chrome !== 'undefined' ? chrome : undefined): UiPrefsArea | undefined {
 const area = root?.storage?.local;
 return area && typeof area.get === 'function' && typeof area.set === 'function' ? area : undefined;
}

/** Loads saved preferences. Never throws: missing storage, read errors and invalid stored values all give the defaults. */
export async function loadUiPrefs(area: UiPrefsArea | undefined): Promise<UiPrefs> {
 try {
  if (!area) return {...DEFAULT_UI_PREFS};
  const stored = await area.get(UI_PREFS_KEY);
  const record = stored && typeof stored === 'object' && Object.hasOwn(stored, UI_PREFS_KEY) ? (stored as Record<string, unknown>)[UI_PREFS_KEY] : undefined;
  return parseUiPrefs(record) ?? {...DEFAULT_UI_PREFS};
 } catch {
  return {...DEFAULT_UI_PREFS};
 }
}

/** Saves preferences. Invalid input is refused without writing anything. Returns whether the write happened. */
export async function saveUiPrefs(area: UiPrefsArea | undefined, prefs: unknown): Promise<boolean> {
 const valid = parseUiPrefs(prefs);
 if (!valid || !area) return false;
 try {
  await area.set({[UI_PREFS_KEY]: {displayMode: valid.displayMode, theme: valid.theme, provider: valid.provider, localModel: valid.localModel}});
  return true;
 } catch {
  return false;
 }
}

/** Calls the listener with validated preferences whenever another extension page saves them. Returns an unsubscribe function. */
export function subscribeUiPrefs(listener: (prefs: UiPrefs) => void, root: any = typeof chrome !== 'undefined' ? chrome : undefined): () => void {
 const source: UiPrefsChangeSource | undefined = root?.storage?.onChanged;
 if (!source || typeof source.addListener !== 'function') return () => {};
 const onChanged = (changes: Record<string, {newValue?: unknown}>, areaName: string) => {
  if (areaName !== 'local' || !changes || !Object.hasOwn(changes, UI_PREFS_KEY)) return;
  const next = parseUiPrefs(changes[UI_PREFS_KEY]?.newValue);
  if (next) listener(next);
 };
 source.addListener(onChanged);
 return () => source.removeListener?.(onChanged);
}
