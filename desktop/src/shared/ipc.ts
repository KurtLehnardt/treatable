/**
 * Typed IPC contract between the renderer and the main process.
 *
 * This module is a pure-type and constant module. It has no runtime imports,
 * so the renderer, the preload script, and the main process can all load it.
 * The main process owns consent, the API key, the provider choice, and the
 * settings. The renderer only ever receives the DTOs defined here, never a key.
 */

export const APP_NAME = "Treatable Desktop";
export const DISCLAIMER = "Research information, not medical advice.";
export const OPENAI_NOT_PHI_NOTICE = "Not PHI-ready: use synthetic or non-identifying information only";
export const UNREFINED_CAP = 79;

/** Invoke channel names. Every channel is request/response through ipcRenderer.invoke. */
export const IPC = {
  /** getState(): the current provider, key status, consent, settings, and local LLM availability. */
  getState: "treatable:getState",
  /** setProvider(provider, model?): choose Send nothing, Local LLM, or OpenAI; returns the new state. */
  setProvider: "treatable:setProvider",
  /** saveKey(key): store the OpenAI key in the main process only; returns the new state. */
  saveKey: "treatable:saveKey",
  /** clearKey(): forget the stored OpenAI key; returns the new state. */
  clearKey: "treatable:clearKey",
  /** grantConsent(kind, accepted): record the OpenAI consent decision; returns the new state. */
  grantConsent: "treatable:grantConsent",
  /** revokeConsent(kind): withdraw the OpenAI consent; returns the new state. */
  revokeConsent: "treatable:revokeConsent",
  /** setSettings(partial): update the minimum match and the remember-profile setting; returns the new state. */
  setSettings: "treatable:setSettings",
  /** score(profileForm): run the pipeline in the main process and return a serializable result or an error. */
  score: "treatable:score",
  /** cancelScore(): abort the scoring run that is in progress, if any. */
  cancelScore: "treatable:cancelScore",
  /** loadDemoProfiles(): the clearly fictional demo profiles used by the form. */
  loadDemoProfiles: "treatable:loadDemoProfiles",
  /** getRememberedProfile(): the saved profile form, or null when the user did not tick Remember. */
  getRememberedProfile: "treatable:getRememberedProfile",
  /** clearAll(): wipe the key, consent, settings, and remembered profile; returns the new state. */
  clearAll: "treatable:clearAll",
  /** openExternal(url): open an https URL in the system browser; any other scheme is refused. */
  openExternal: "treatable:openExternal",
  /** checkForUpdate(): report the current version and, if newer, a download link. It never installs anything. */
  checkForUpdate: "treatable:checkForUpdate",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export type ProviderChoice = "none" | "local" | "openai";
export type MinMatch = 50 | 65 | 80;
export type KeyStorage = "safeStorage" | "session-only";
export type ConsentKind = "openai";
export type Tier = "strong" | "possible" | "weak" | "below";

export interface LocalStatus {
  /** True when Ollama is running and at least one model has complete local weights. */
  available: boolean;
  /** Names of models with complete local weights. */
  models: string[];
  selectedModel?: string;
  /** Plain-language reason when not available. */
  reason?: string;
}

export interface Settings {
  minMatch: MinMatch;
  rememberProfile: boolean;
}

/** What the renderer is allowed to know. It never contains the key itself. */
export interface AppState {
  provider: ProviderChoice;
  providerLabel: string;
  hasKey: boolean;
  /** Last four characters of the key, or an empty string when there is no key. */
  last4: string;
  /** Set when scoring with the chosen provider is blocked, for example OpenAI without consent. */
  lockReason?: string;
  consent: { openai: boolean };
  settings: Settings;
  local: LocalStatus;
  keyStorage: KeyStorage;
  version: string;
}

/** Matches the input of profileFromForm in the extension core. All fields are strings. */
export interface ProfileForm {
  condition: string;
  notes: string;
  age: string;
  sex: string;
  zip: string;
  /** A number of miles as a string, or "anywhere". */
  radius: string;
}

export interface DemoProfile {
  id: string;
  /** Clearly fictional label shown on the button. */
  label: string;
  form: ProfileForm;
}

export interface SiteDto {
  facility: string;
  city?: string;
  state?: string;
  distanceMiles?: number;
}

export interface CapDto {
  value: number;
  reason: string;
  source: "deterministic" | "model";
}

/** The "How this was scored" panel for one study. Strings are already JSON-serialized. */
export interface HowScoredDto {
  provider: string;
  model?: string;
  /** Exactly what was sent to the provider, or a description of the local keyword screen. */
  requestShown?: string;
  /** Raw provider answers, truncated. */
  rawShown?: string;
}

export interface StudyDto {
  id: string;
  title: string;
  url: string;
  conditions: string[];
  nearestSite?: SiteDto;
  /** Final displayed score, 0 to 100. */
  score: number;
  tier: Tier;
  tierLabel: string;
  /** False means keyword screening only, capped at 79. */
  refined: boolean;
  modelScore?: number;
  caps: CapDto[];
  reasonsFor: string[];
  reasonsAgainst: string[];
  lowConfidence: boolean;
  howScored: HowScoredDto;
  /** For example "Scoring failed for this study" or "Not scored: only the top N are refined". */
  note?: string;
}

/** Serializable mirror of the extension's PipelineResult. */
export interface ScoreResult {
  mode: "refined" | "unrefined";
  providerLabel?: string;
  /** Plain-language reason a provider was not used or partly failed. */
  failure?: string;
  /** Main list sorted by score. It holds every study at 50 or above; the renderer filters by Minimum match. */
  studies: StudyDto[];
  /** Related research below 50, shown only in the collapsed section. */
  nearMiss: StudyDto[];
  excludedCount: number;
  shortlistCount: number;
  corpusCount: number;
  /** Count line per Minimum match, computed in main from the extension core. */
  countLines: Record<MinMatch, string>;
  /** Honest empty-state message per Minimum match, or null when something is shown. */
  emptyMessages: Record<MinMatch, string | null>;
  /** Studies hidden at 80 or 65 that appear at 50, per Minimum match. */
  moreAt50: Record<MinMatch, number>;
}

export type ScoreResponse = { ok: true; result: ScoreResult } | { ok: false; error: string };

export interface UpdateInfo {
  current: string;
  latest?: string;
  /** An https link to open in the browser. The app never downloads or installs updates. */
  downloadUrl?: string;
}

/** Request and response types for each channel. */
export interface IpcContract {
  getState(): Promise<AppState>;
  setProvider(provider: ProviderChoice, model?: string): Promise<AppState>;
  saveKey(key: string): Promise<AppState>;
  clearKey(): Promise<AppState>;
  grantConsent(kind: ConsentKind, accepted: true): Promise<AppState>;
  revokeConsent(kind: ConsentKind): Promise<AppState>;
  setSettings(partial: Partial<Settings>): Promise<AppState>;
  score(profile: ProfileForm): Promise<ScoreResponse>;
  cancelScore(): Promise<void>;
  loadDemoProfiles(): Promise<DemoProfile[]>;
  getRememberedProfile(): Promise<ProfileForm | null>;
  clearAll(): Promise<AppState>;
  openExternal(url: string): Promise<boolean>;
  checkForUpdate(): Promise<UpdateInfo>;
}

/** The exact method names exposed on window.treatable. */
export const TREATABLE_API_METHODS = [
  "getState",
  "setProvider",
  "saveKey",
  "clearKey",
  "grantConsent",
  "revokeConsent",
  "setSettings",
  "score",
  "cancelScore",
  "loadDemoProfiles",
  "getRememberedProfile",
  "clearAll",
  "openExternal",
  "checkForUpdate",
] as const satisfies ReadonlyArray<keyof IpcContract>;

export type TreatableApi = IpcContract;

/** Only https URLs may be opened outside the app. */
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Three clearly fictional demo profiles. The names and details are invented. */
export const DEMO_PROFILES: DemoProfile[] = [
  {
    id: "demo-lumbar",
    label: "Demo: fictional lumbar disc case",
    form: { condition: "lumbar disc herniation", notes: "Fictional demo person with low back and leg pain. Not a real patient.", age: "45", sex: "female", zip: "55905", radius: "250" },
  },
  {
    id: "demo-cervical",
    label: "Demo: fictional neck pain case",
    form: { condition: "cervical radiculopathy", notes: "Fictional demo person with neck and arm pain. Not a real patient.", age: "52", sex: "male", zip: "77030", radius: "500" },
  },
  {
    id: "demo-anywhere",
    label: "Demo: fictional anywhere case",
    form: { condition: "degenerative disc disease", notes: "Fictional demo person, willing to travel anywhere. Not a real patient.", age: "38", sex: "female", zip: "", radius: "anywhere" },
  },
];
