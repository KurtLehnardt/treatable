/**
 * lib/alerts/store.ts — localStorage persistence for the D5 alert snapshot.
 *
 * Deliberately separated from diff.ts: the diff logic itself never touches
 * storage, so it stays hermetically unit-testable with no DOM/localStorage
 * needed (see diff.ts's header). This module owns the read/write + defensive
 * normalization of whatever is actually sitting in localStorage.
 *
 * Client-only, own device, per §5.3 "no server retention": this snapshot
 * NEVER leaves localStorage — nothing here calls fetch or any API route.
 */

import type { Tier } from "@/lib/types";
import { readJSON, writeJSON } from "@/lib/localStore";
import { VALID_TIERS, type AlertSnapshot, type AlertSnapshotEntry } from "./types";

const STORAGE_KEY = "ff.alerts.v1";

function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (VALID_TIERS as readonly string[]).includes(value);
}

function normalizeEntry(value: unknown): AlertSnapshotEntry | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isTier(v.tier)) return null;
  return { tier: v.tier, closingSoon: v.closingSoon === true };
}

/**
 * Coerce a parsed value into a well-formed AlertSnapshot, or null when the
 * stored value is absent, corrupt, or malformed in any way. Never throws —
 * a malformed entry inside `opportunities` is dropped rather than failing
 * the whole snapshot. Exported (mirrors lib/sidebar/sidebarPrefs.ts's
 * normalizeSidebarPrefs pattern) so corrupt/malformed-storage handling is
 * directly unit-testable without a `window` global.
 */
export function normalizeAlertSnapshot(value: unknown): AlertSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.profileKey !== "string" || typeof v.savedAt !== "string") return null;
  if (!v.opportunities || typeof v.opportunities !== "object") return null;

  const opportunities: Record<string, AlertSnapshotEntry> = {};
  for (const [id, raw] of Object.entries(v.opportunities as Record<string, unknown>)) {
    const entry = normalizeEntry(raw);
    if (entry) opportunities[id] = entry;
  }
  return { profileKey: v.profileKey, savedAt: v.savedAt, opportunities };
}

/**
 * Load the last-saved snapshot, or null when absent, corrupt, or storage is
 * unavailable (SSR, private mode, quota — see lib/localStore's readJSON).
 * Never throws.
 */
export function loadAlertSnapshot(): AlertSnapshot | null {
  return normalizeAlertSnapshot(readJSON<unknown>(STORAGE_KEY, null));
}

/** Persist a snapshot. No-op when storage is unavailable (never throws). */
export function saveAlertSnapshot(snapshot: AlertSnapshot): void {
  writeJSON(STORAGE_KEY, snapshot);
}
