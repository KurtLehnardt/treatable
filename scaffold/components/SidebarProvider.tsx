"use client";

/**
 * SidebarProvider.tsx — FE-07 redesign. Shared state for the PERSISTENT,
 * collapsible left sidebar (claude.ai-style), so the sidebar itself and the
 * main content column (which shifts right to make room on desktop) read one
 * source of truth.
 *
 * State:
 *   - expanded  : desktop docked visibility (persisted). Collapse hides the
 *                 sidebar; a floating re-open affordance takes its place.
 *   - width     : desktop docked width in px (persisted; clamped by the resize
 *                 handle). The content column pads left by this when expanded.
 *   - mobileOpen: mobile overlay-drawer open state (ephemeral, never persisted).
 *   - openSections: per-section open map (persisted). Independent toggles —
 *                 multiple sections may be open; all may be closed.
 *
 * Hydration: SSR and the first client render use the first-visit defaults
 * (expanded, Account open, default width) so there is no hydration mismatch;
 * `hydrated` flips true after the effect reads localStorage. A returning user's
 * stored preference is applied at that point.
 *
 * Passive context — no network, no UI of its own. Only mounted on the home page
 * (app/page.tsx), and only the left_sidebar flag's ON path renders a consumer.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clampWidth,
  defaultSidebarPrefs,
  loadSidebarPrefs,
  saveSidebarPrefs,
  type SidebarPrefs,
  type SidebarSectionId,
} from "@/lib/sidebar/sidebarPrefs";

type SidebarContextValue = {
  hydrated: boolean;
  expanded: boolean;
  width: number;
  mobileOpen: boolean;
  /** True while the resize handle is being dragged — lets the content column
   *  drop its shift transition so it tracks the pointer instantly. */
  resizing: boolean;
  openSections: Record<SidebarSectionId, boolean>;
  setExpanded: (next: boolean) => void;
  toggleExpanded: () => void;
  setWidth: (next: number) => void;
  setMobileOpen: (next: boolean) => void;
  setResizing: (next: boolean) => void;
  toggleSection: (id: SidebarSectionId) => void;
  setSectionOpen: (id: SidebarSectionId, open: boolean) => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<SidebarPrefs>(() => defaultSidebarPrefs());
  const [hydrated, setHydrated] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [resizing, setResizing] = useState(false);

  // Hydrate stored prefs after mount — never during render (keeps SSR + first
  // client render on the deterministic defaults).
  useEffect(() => {
    setPrefs(loadSidebarPrefs());
    setHydrated(true);
  }, []);

  // Persist prefs whenever they change, but only after hydration so the initial
  // default snapshot doesn't clobber a returning user's stored value on load.
  useEffect(() => {
    if (!hydrated) return;
    saveSidebarPrefs(prefs);
  }, [hydrated, prefs]);

  const setExpanded = useCallback((next: boolean) => {
    setPrefs((p) => (p.expanded === next ? p : { ...p, expanded: next }));
  }, []);

  const toggleExpanded = useCallback(() => {
    setPrefs((p) => ({ ...p, expanded: !p.expanded }));
  }, []);

  const setWidth = useCallback((next: number) => {
    setPrefs((p) => {
      const w = clampWidth(next);
      return p.width === w ? p : { ...p, width: w };
    });
  }, []);

  const toggleSection = useCallback((id: SidebarSectionId) => {
    setPrefs((p) => ({
      ...p,
      openSections: { ...p.openSections, [id]: !p.openSections[id] },
    }));
  }, []);

  const setSectionOpen = useCallback((id: SidebarSectionId, open: boolean) => {
    setPrefs((p) =>
      p.openSections[id] === open
        ? p
        : { ...p, openSections: { ...p.openSections, [id]: open } },
    );
  }, []);

  const value = useMemo<SidebarContextValue>(
    () => ({
      hydrated,
      expanded: prefs.expanded,
      width: prefs.width,
      mobileOpen,
      resizing,
      openSections: prefs.openSections,
      setExpanded,
      toggleExpanded,
      setWidth,
      setMobileOpen,
      setResizing,
      toggleSection,
      setSectionOpen,
    }),
    [
      hydrated,
      prefs.expanded,
      prefs.width,
      prefs.openSections,
      mobileOpen,
      resizing,
      setExpanded,
      toggleExpanded,
      setWidth,
      toggleSection,
      setSectionOpen,
    ],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

/**
 * Outside the provider this is an inert set of defaults (rather than a throw) so
 * any consumer stays renderable even if the provider is somehow absent.
 */
export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (ctx) return ctx;
  const fallback = defaultSidebarPrefs();
  return {
    hydrated: false,
    expanded: fallback.expanded,
    width: fallback.width,
    mobileOpen: false,
    resizing: false,
    openSections: fallback.openSections,
    setExpanded: () => {},
    toggleExpanded: () => {},
    setWidth: () => {},
    setMobileOpen: () => {},
    setResizing: () => {},
    toggleSection: () => {},
    setSectionOpen: () => {},
  };
}
