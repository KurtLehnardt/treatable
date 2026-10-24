import { ONBOARDING_VERSION, isStoredStep } from './guide-steps';

/**
 * The intro guide's only persisted values, and the only place the extension writes browser storage:
 *
 *  - `treatable.onboardingVersion` in extension-local storage: the number 1, set once when the intro is finished
 *    or skipped. It says that the intro has been seen. It holds no health, search or study information.
 *  - `treatable.onboardingStep` in session storage: a bare step number, kept so the intro can resume after the
 *    page navigates. It is removed when the intro ends and disappears when the browser session ends.
 *
 * Nothing the person types, no search term and no study identifier is ever written here. The patient-data
 * cleanup in storage.ts still removes only its own legacy key and never touches these.
 */
export const ONBOARDING_FLAG_KEY = 'treatable.onboardingVersion';
export const ONBOARDING_STEP_KEY = 'treatable.onboardingStep';

export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface OnboardingAreas { local?: StorageAreaLike; session?: StorageAreaLike }

/** Picks the two extension storage areas from the extension API object, tolerating a missing or blocked API. */
export function onboardingAreas(api: any): OnboardingAreas {
  const areas: OnboardingAreas = {};
  try {
    if (api?.storage?.local) areas.local = api.storage.local;
    if (api?.storage?.session) areas.session = api.storage.session;
  } catch { /* Storage can throw when blocked; the intro then simply does not persist. */ }
  return areas;
}

export interface OnboardingStore {
  /** True when the intro has already been finished or skipped for the current guide version. */
  isDone(): Promise<boolean>;
  markDone(): Promise<void>;
  savedStep(): Promise<number | undefined>;
  saveStep(step: number): Promise<void>;
  clearStep(): Promise<void>;
}

export function createOnboardingStore(areas: OnboardingAreas): OnboardingStore {
  const read = async (area: StorageAreaLike | undefined, key: string) => {
    if (!area) return undefined;
    try { return (await area.get(key))?.[key]; } catch { return undefined; }
  };
  return {
    async isDone() {
      const value = await read(areas.local, ONBOARDING_FLAG_KEY);
      return typeof value === 'number' && value >= ONBOARDING_VERSION;
    },
    async markDone() {
      try { await areas.session?.remove(ONBOARDING_STEP_KEY); } catch { /* Best effort. */ }
      try { await areas.local?.set({ [ONBOARDING_FLAG_KEY]: ONBOARDING_VERSION }); } catch { /* Best effort. */ }
    },
    async savedStep() {
      const value = await read(areas.session, ONBOARDING_STEP_KEY);
      return isStoredStep(value) ? value : undefined;
    },
    async saveStep(step) {
      if (!isStoredStep(step)) return;
      try { await areas.session?.set({ [ONBOARDING_STEP_KEY]: step }); } catch { /* Best effort. */ }
    },
    async clearStep() {
      try { await areas.session?.remove(ONBOARDING_STEP_KEY); } catch { /* Best effort. */ }
    },
  };
}
