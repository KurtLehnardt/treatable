"use client";

/**
 * SearchDraftProvider.tsx — FE-07 bridge from the sidebar's "Use this" action
 * (on a saved company-description version) to the main search textarea in
 * IntakeForm.
 *
 * The drawer and IntakeForm don't share a parent that could prop-drill this, so
 * a tiny context carries the request. `pending` holds the requested text plus a
 * `nonce` that changes on every request, so loading the SAME text twice still
 * triggers the consumer's effect (which keys on the nonce).
 *
 * Passive context, no UI/network — mounts unconditionally in app/layout.tsx and
 * does not affect flag-off behavior (nothing calls requestSearchDraft unless
 * the sidebar flag is on and the user clicks "Use this").
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type SearchDraft = { text: string; nonce: number };

type SearchDraftContextValue = {
  pending: SearchDraft | null;
  requestSearchDraft: (text: string) => void;
};

const SearchDraftContext = createContext<SearchDraftContextValue | null>(null);

export function SearchDraftProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<SearchDraft | null>(null);

  const requestSearchDraft = useCallback((text: string) => {
    // Date.now() guarantees a fresh nonce even for repeated identical text.
    setPending({ text, nonce: Date.now() });
  }, []);

  const value = useMemo<SearchDraftContextValue>(
    () => ({ pending, requestSearchDraft }),
    [pending, requestSearchDraft],
  );

  return <SearchDraftContext.Provider value={value}>{children}</SearchDraftContext.Provider>;
}

/**
 * Outside the provider this is an inert no-op (rather than a throw), so a
 * consumer stays renderable even if the provider is somehow absent.
 */
export function useSearchDraft(): SearchDraftContextValue {
  const ctx = useContext(SearchDraftContext);
  return ctx ?? { pending: null, requestSearchDraft: () => {} };
}
