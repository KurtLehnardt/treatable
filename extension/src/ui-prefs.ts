/**
 * Non-health preferences, kept in chrome.storage.local under one key: the display mode, the theme, the model provider and the chosen
 * local model name. Every value is an enum except the model name, which must be an Ollama library-style name (see
 * shared/local-model.mjs). It never holds patient details, names, search terms, study IDs or other free text. Patient data is
 * session-only and is cleared by "Clear all" and "End session"; these preferences are deliberately kept.
 * The AI-matched results switch is not stored here. Turning it on is the person's consent, which only the background records
 * (ranking-consent.ts).
 */
import {isLocalModelName} from '../shared/local-model.mjs';
export const UI_PREFS_KEY = 'treatable.uiPrefs';
export const DISPLAY_MODES = ['popup', 'sidebar'] as const;
/** Display modes saved by earlier versions that no longer exist. The corner card ('overlay') was removed; a record that still holds it reads as the default popup, with its other choices kept. */
const RETIRED_DISPLAY_MODES: readonly unknown[] = ['overlay'];
export const THEMES = ['system', 'light', 'dark'] as const;
/** Who generates study briefs: OpenAI (the default) or a local model through Ollama on this device. */
export const MODEL_PROVIDERS = ['openai', 'local'] as const;
/** The two positions of the AI-matched results switch (off unless the person turns it on; see ai-switch.ts). Records saved by earlier versions also hold one. */
export const AI_RANKING = ['on', 'off'] as const;
export type DisplayMode = typeof DISPLAY_MODES[number];
export type Theme = typeof THEMES[number];
export type ModelProvider = typeof MODEL_PROVIDERS[number];
export type AiRanking = typeof AI_RANKING[number];
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
export const isAiRanking = (value: unknown): value is AiRanking => typeof value === 'string' && (AI_RANKING as readonly string[]).includes(value);

const PREF_KEYS = ['displayMode', 'theme', 'provider', 'localModel'], RANKING_ERA_KEYS = [...PREF_KEYS, 'aiRanking'];
/**
 * Strict schema check. The value must be a plain object with exactly the four known keys: display mode, theme and provider each hold an
 * allowed enum value and localModel holds null or a valid model name. Records saved by earlier versions still load: exactly displayMode
 * and theme (OpenAI as the provider), or the four keys plus an aiRanking of 'on' or 'off'. That aiRanking value is checked and then
 * dropped: the switch moved to the background's consent record, so a switch an earlier version saved as on never turns AI-matched
 * results on. A retired display mode (the removed corner card, 'overlay') reads as the default popup instead of discarding the whole record.
 * Anything else (extra or missing keys, wrong types, unknown values) is rejected as a whole. The result is always a fresh object built from the validated fields, so nothing from the input is carried through.
 */
export function parseUiPrefs(value: unknown): UiPrefs | undefined {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
 const prototype = Object.getPrototypeOf(value);
 if (prototype !== Object.prototype && prototype !== null) return undefined;
 const keys = Object.keys(value), exactly = (list: readonly string[]) => keys.length === list.length && list.every(key => keys.includes(key));
 const legacy = exactly(['displayMode', 'theme']), rankingEra = exactly(RANKING_ERA_KEYS);
 if (!legacy && !rankingEra && !exactly(PREF_KEYS)) return undefined;
 const record = value as Record<string, unknown>, {theme} = record, displayMode = RETIRED_DISPLAY_MODES.includes(record.displayMode) ? DEFAULT_UI_PREFS.displayMode : record.displayMode;
 const provider = legacy ? 'openai' : record.provider, localModel = legacy ? null : record.localModel;
 if (rankingEra && !isAiRanking(record.aiRanking)) return undefined;
 return isDisplayMode(displayMode) && isTheme(theme) && isModelProvider(provider) && isLocalModelPref(localModel) ? {displayMode, theme, provider, localModel} : undefined;
}

/** Returns chrome.storage.local from the given extension API root, or undefined when storage is unavailable. */
export function uiPrefsArea(root: any = typeof chrome !== 'undefined' ? chrome : undefined): UiPrefsArea | undefined {
 const area = root?.storage?.local;
 return area && typeof area.get === 'function' && typeof area.set === 'function' ? area : undefined;
}

/** Loads saved preferences. Never throws: missing storage, read errors and invalid stored values all give the defaults. */
export async function loadUiPrefs(area: UiPrefsArea | undefined): Promise<UiPrefs> {
 return (await readUiPrefs(area)) ?? {...DEFAULT_UI_PREFS};
}

/** The saved preferences, or the defaults when nothing was ever saved. Unlike loadUiPrefs it gives undefined when storage is unavailable,
 * the read fails or the stored record is invalid, so AI-matched results can stay off instead of falling back to the OpenAI default. */
export async function readUiPrefs(area: UiPrefsArea | undefined): Promise<UiPrefs | undefined> {
 try {
  if (!area) return undefined;
  const stored = await area.get(UI_PREFS_KEY);
  if (!stored || typeof stored !== 'object' || !Object.hasOwn(stored, UI_PREFS_KEY)) return {...DEFAULT_UI_PREFS};
  return parseUiPrefs((stored as Record<string, unknown>)[UI_PREFS_KEY]);
 } catch {
  return undefined;
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
