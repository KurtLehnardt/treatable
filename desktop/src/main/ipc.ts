import {
  APP_NAME,
  DEMO_PROFILES,
  IPC,
  isHttpsUrl,
  type AppState,
  type ConsentKind,
  type DemoProfile,
  type IpcContract,
  type ProfileForm,
  type ProviderChoice,
  type ScoreResponse,
  type Settings,
  type UpdateInfo,
} from "../shared/ipc";

/** The slice of Electron's ipcMain that registration needs. Tests inject a fake. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void;
  removeHandler(channel: string): void;
}

/** Everything the handlers touch outside themselves. Wave 1 supplies real implementations. */
export interface IpcDeps {
  version: string;
  openExternal(url: string): Promise<void> | void;
}

const DEFAULT_SETTINGS: Settings = { minMatch: 80, rememberProfile: false };

/**
 * Placeholder handlers: every method returns a well-typed value and keeps its
 * state in memory only. Wave 1 replaces the bodies with the real engine,
 * consent, key storage, and local LLM runtime.
 */
export function createHandlers(deps: IpcDeps): IpcContract {
  let state: AppState = {
    provider: "none",
    providerLabel: "Send nothing (keyword screening only)",
    hasKey: false,
    last4: "",
    consent: { openai: false },
    settings: { ...DEFAULT_SETTINGS },
    local: { available: false, models: [], reason: "Local LLM detection is not wired up yet." },
    keyStorage: "session-only",
    version: deps.version,
  };
  const snapshot = (): AppState => structuredClone(state);

  return {
    async getState() {
      return snapshot();
    },
    async setProvider(provider: ProviderChoice, model?: string) {
      if (provider !== "none" && provider !== "local" && provider !== "openai") throw new Error("Unknown provider.");
      state = { ...state, provider, local: { ...state.local, selectedModel: model ?? state.local.selectedModel } };
      return snapshot();
    },
    async saveKey(key: string) {
      const trimmed = typeof key === "string" ? key.trim() : "";
      if (!trimmed) throw new Error("Enter a key.");
      state = { ...state, hasKey: true, last4: trimmed.slice(-4) };
      return snapshot();
    },
    async clearKey() {
      state = { ...state, hasKey: false, last4: "" };
      return snapshot();
    },
    async grantConsent(kind: ConsentKind, accepted: true) {
      if (kind !== "openai" || accepted !== true) throw new Error("Unsupported consent request.");
      state = { ...state, consent: { openai: true } };
      return snapshot();
    },
    async revokeConsent(kind: ConsentKind) {
      if (kind !== "openai") throw new Error("Unsupported consent request.");
      state = { ...state, consent: { openai: false } };
      return snapshot();
    },
    async setSettings(partial: Partial<Settings>) {
      const next = { ...state.settings };
      if (partial?.minMatch === 50 || partial?.minMatch === 65 || partial?.minMatch === 80) next.minMatch = partial.minMatch;
      if (typeof partial?.rememberProfile === "boolean") next.rememberProfile = partial.rememberProfile;
      state = { ...state, settings: next };
      return snapshot();
    },
    async score(_profile: ProfileForm): Promise<ScoreResponse> {
      return { ok: false, error: "Scoring is not wired up yet." };
    },
    async cancelScore() {
      // Nothing is running in the placeholder.
    },
    async loadDemoProfiles(): Promise<DemoProfile[]> {
      return structuredClone(DEMO_PROFILES);
    },
    async getRememberedProfile() {
      return null;
    },
    async clearAll() {
      state = { ...state, provider: "none", providerLabel: "Send nothing (keyword screening only)", hasKey: false, last4: "", consent: { openai: false }, settings: { ...DEFAULT_SETTINGS } };
      return snapshot();
    },
    async openExternal(url: string) {
      if (!isHttpsUrl(url)) return false;
      await deps.openExternal(url);
      return true;
    },
    async checkForUpdate(): Promise<UpdateInfo> {
      return { current: deps.version };
    },
  };
}

/** Register every contract channel on ipcMain. Returns a function that removes them. */
export function registerIpcHandlers(ipcMain: IpcMainLike, handlers: IpcContract): () => void {
  const table: Record<keyof typeof IPC, (...args: any[]) => unknown> = {
    getState: () => handlers.getState(),
    setProvider: (provider, model) => handlers.setProvider(provider, model),
    saveKey: (key) => handlers.saveKey(key),
    clearKey: () => handlers.clearKey(),
    grantConsent: (kind, accepted) => handlers.grantConsent(kind, accepted),
    revokeConsent: (kind) => handlers.revokeConsent(kind),
    setSettings: (partial) => handlers.setSettings(partial),
    score: (profile) => handlers.score(profile),
    cancelScore: () => handlers.cancelScore(),
    loadDemoProfiles: () => handlers.loadDemoProfiles(),
    getRememberedProfile: () => handlers.getRememberedProfile(),
    clearAll: () => handlers.clearAll(),
    openExternal: (url) => handlers.openExternal(url),
    checkForUpdate: () => handlers.checkForUpdate(),
  };
  const channels = (Object.keys(table) as Array<keyof typeof IPC>).map((name) => IPC[name]);
  for (const name of Object.keys(table) as Array<keyof typeof IPC>) {
    ipcMain.handle(IPC[name], (_event, ...args) => table[name](...args));
  }
  return () => channels.forEach((c) => ipcMain.removeHandler(c));
}

export const WINDOW_TITLE = APP_NAME;
