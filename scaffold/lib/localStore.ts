/**
 * localStore.ts — SSR-safe localStorage helpers (FE-07).
 *
 * The FE-07 left-sidebar stores (grants, company descriptions, mock billing
 * tier) are all client-only and localStorage-backed. This module centralizes
 * the "never throw" access pattern so each store doesn't re-implement it.
 *
 * Framework-agnostic on purpose (no React, no Next.js imports) — same posture
 * as lib/mockAuth.ts. Reads during SSR, in private-browsing modes, or with
 * storage disabled degrade to the caller's fallback / a silent no-op rather
 * than throwing.
 */

/** localStorage is unavailable during SSR and in some privacy modes. Never throw. */
export function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    const probe = '__ff_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null; // Safari private mode, storage disabled, quota exceeded
  }
}

/**
 * Read + JSON.parse the value at `key`, returning `fallback` when the key is
 * absent, storage is unavailable, or the stored value fails to parse. Never
 * throws.
 */
export function readJSON<T>(key: string, fallback: T): T {
  const store = safeStorage();
  if (!store) return fallback;
  const raw = store.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * JSON.stringify + write `value` at `key`. No-ops when storage is unavailable
 * (SSR / private mode) or serialization fails. Never throws.
 */
export function writeJSON(key: string, value: unknown): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded / value not serializable — drop silently, same posture
    // as safeStorage() itself. A failed local write must never break the UI.
  }
}
