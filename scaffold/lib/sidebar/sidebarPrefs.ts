/**
 * sidebarPrefs.ts — SSR-safe persistence for the persistent left sidebar's UI
 * state (FE-07 redesign): whether it's expanded on desktop, its docked width,
 * and which sections are open.
 *
 * These are UI preferences, NOT user data — they hold no personal content, so
 * they live under their own `ff.ui.*` key rather than in STORAGE_KEYS (they are
 * intentionally not wiped by "Delete my data"; there's nothing sensitive here).
 *
 * Framework-agnostic (no React) so it stays trivially unit-testable and the
 * provider can call it directly. Reads degrade to the first-visit defaults when
 * storage is unavailable (SSR / private mode) — see lib/localStore.
 *
 * First-visit contract (no stored value): the sidebar starts EXPANDED with the
 * Account section OPEN (so the sign-in / identity block is immediately visible).
 * A returning user's stored preference is respected verbatim.
 */

import { readJSON, writeJSON } from '@/lib/localStore';

export type SidebarSectionId =
  | 'settings'
  | 'grants'
  | 'descriptions'
  | 'account'
  | 'billing';

export const SIDEBAR_SECTION_IDS: readonly SidebarSectionId[] = [
  'settings',
  'grants',
  'descriptions',
  'account',
  'billing',
];

/** Docked-width bounds (desktop only). The resize handle clamps to these. */
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 288;

const STORAGE_KEY = 'ff.ui.sidebar.v1';

export interface SidebarPrefs {
  /** Desktop: whether the docked sidebar is shown (vs collapsed off-screen). */
  expanded: boolean;
  /** Desktop docked width in px, clamped to [MIN, MAX]. */
  width: number;
  /** Per-section open state — independent toggles, multiple may be open. */
  openSections: Record<SidebarSectionId, boolean>;
}

/** First-visit open set: only Account open so sign-in is immediately visible. */
export function defaultOpenSections(): Record<SidebarSectionId, boolean> {
  return {
    settings: false,
    grants: false,
    descriptions: false,
    account: true,
    billing: false,
  };
}

export function defaultSidebarPrefs(): SidebarPrefs {
  return {
    expanded: true,
    width: SIDEBAR_DEFAULT_WIDTH,
    openSections: defaultOpenSections(),
  };
}

/** Clamp any incoming width to the supported range; fall back on garbage. */
export function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

/**
 * Coerce a parsed value into a well-formed open-section map. Starts from the
 * first-visit default and overrides only the ids present as booleans, so a
 * partial or malformed stored object still yields a complete, valid map.
 */
export function normalizeOpenSections(
  value: unknown,
): Record<SidebarSectionId, boolean> {
  const out = defaultOpenSections();
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    for (const id of SIDEBAR_SECTION_IDS) {
      if (typeof v[id] === 'boolean') out[id] = v[id] as boolean;
    }
  }
  return out;
}

/** Coerce a parsed value into well-formed prefs, filling gaps with defaults. */
export function normalizeSidebarPrefs(value: unknown): SidebarPrefs {
  if (!value || typeof value !== 'object') return defaultSidebarPrefs();
  const v = value as Record<string, unknown>;
  return {
    expanded: typeof v.expanded === 'boolean' ? v.expanded : true,
    width: clampWidth(typeof v.width === 'number' ? v.width : SIDEBAR_DEFAULT_WIDTH),
    openSections: normalizeOpenSections(v.openSections),
  };
}

/**
 * Load stored prefs, or the first-visit defaults when nothing is stored / storage
 * is unavailable. A missing key is indistinguishable from "first visit", which is
 * exactly the desired behavior: expanded + Account open.
 */
export function loadSidebarPrefs(): SidebarPrefs {
  return normalizeSidebarPrefs(readJSON<unknown>(STORAGE_KEY, null));
}

/** Persist prefs. No-ops when storage is unavailable (never throws). */
export function saveSidebarPrefs(prefs: SidebarPrefs): void {
  writeJSON(STORAGE_KEY, prefs);
}
