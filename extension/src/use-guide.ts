import { useEffect, useMemo, useRef, useState } from 'react';
import { IntroGuide, type IntroPorts } from './guide-intro';
import { createPanelGuide, type PanelGuide } from './guide-panel';
import { pageKind } from './guide-finders';
import { createOnboardingStore, onboardingAreas, type OnboardingStore } from './guide-state';
import type { PageGuideCommand, PageGuideEvent } from './guide-protocol';
import type { OverlaySnapshot } from './overlay-types';

/** What the guide needs from the site controller. Everything goes through the authenticated site connection. */
export interface GuideHost {
  connected: boolean;
  snapshot?: OverlaySnapshot;
  collapsed: boolean;
  /** Collapses or expands the panel and resolves once the page has applied the new layout. */
  layout(collapsed: boolean): Promise<void>;
  request(type: string, payload: Record<string, unknown>): Promise<any>;
  subscribe(listener: (event: PageGuideEvent) => void): () => void;
}

export interface GuideViewModel {
  /** True while the intro tour or the search help is running. */
  active: boolean;
  /** The search help needs the filters, so it is offered on search pages only. */
  canSearchHelp: boolean;
  startSearchHelp(): void;
  replayIntro(): void;
}

export interface GuideDeps {
  store?: OnboardingStore;
  panel?: PanelGuide;
}

export function useGuide(host: GuideHost, deps: GuideDeps = {}): GuideViewModel {
  const [active, setActive] = useState(false);
  const hostRef = useRef(host);
  hostRef.current = host;
  const booted = useRef(false);
  const searchHelp = useRef<{ restoreCollapsed: boolean } | undefined>();

  const parts = useMemo(() => {
    const store = deps.store ?? createOnboardingStore(onboardingAreas((globalThis as any).chrome));
    const panel = deps.panel ?? createPanelGuide(() => document);
    const page = () => hostRef.current;
    const ports: IntroPorts = {
      store,
      showPanelStep: (id, options) => panel.show(id, options),
      closePanelStep: () => panel.close(),
      runPageStep: async (command: PageGuideCommand) => {
        await page().layout(true);
        await page().request('site.guide', { command });
      },
      cancelPage: async () => { try { await page().request('site.guide', { command: { op: 'cancel' } }); } catch { /* The page may already be gone. */ } },
      expandPanel: () => page().layout(false),
      openSearchPage: async () => { await page().request('site.openSearch', {}); },
      pageKind: () => pageKind(page().snapshot?.url ?? ''),
      onChange: state => setActive(state.active || searchHelp.current !== undefined),
    };
    return { store, panel, intro: new IntroGuide(ports) };
  // The ports are fixed for the life of the panel and read the latest host through a ref.
  }, []);

  // First run: start the tour once, or resume it where a page navigation interrupted it.
  useEffect(() => {
    if (!host.connected || !host.snapshot || booted.current) return;
    booted.current = true;
    void (async () => {
      const saved = await parts.store.savedStep();
      if (saved !== undefined) { await parts.intro.resume(saved); return; }
      if (await parts.store.isDone()) return;
      await parts.intro.start();
    })();
  }, [host.connected, !!host.snapshot]);

  const url = host.snapshot?.url;
  useEffect(() => { if (url) void parts.intro.onPageChange(); }, [url]);

  useEffect(() => host.subscribe(event => {
    const help = searchHelp.current;
    if (help && event.op === 'filters') {
      searchHelp.current = undefined;
      setActive(parts.intro.active);
      void hostRef.current.layout(help.restoreCollapsed).catch(() => {});
      return;
    }
    void parts.intro.handlePageEvent(event);
  }), [host.connected]);

  useEffect(() => () => { parts.intro.stop(); parts.panel.close(); }, [parts]);

  const canSearchHelp = host.connected && pageKind(host.snapshot?.url ?? '') === 'search' && !active;

  return {
    active,
    canSearchHelp,
    startSearchHelp() {
      if (!canSearchHelp) return;
      searchHelp.current = { restoreCollapsed: hostRef.current.collapsed };
      setActive(true);
      void (async () => {
        try {
          await hostRef.current.layout(true);
          await hostRef.current.request('site.guide', { command: { op: 'filters', intro: true } });
        } catch {
          const help = searchHelp.current;
          searchHelp.current = undefined;
          setActive(false);
          if (help) void hostRef.current.layout(help.restoreCollapsed).catch(() => {});
        }
      })();
    },
    replayIntro() {
      if (!host.connected) return;
      searchHelp.current = undefined;
      void parts.intro.start();
    },
  };
}
