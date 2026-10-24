import { createGuideMount, type GuideChoice, type GuideMount, type GuideMountOptions } from './guide-mount';
import { createHighlighter } from './guide-highlight';
import { COPY, PANEL_TARGET, type IntroStepId, type StepCopy } from './guide-steps';

/** Marks a Treatable control the intro tour can point at. Set in the panel's own markup. */
export const GUIDE_TARGET_ATTRIBUTE = 'data-treatable-guide';

const PANEL_COPY: Partial<Record<IntroStepId, StepCopy>> = {
  welcome: COPY.welcome, appearance: COPY.appearance, 'search-first': COPY.searchFirst, understand: COPY.understand,
  brief: COPY.brief, personalize: COPY.personalize, draft: COPY.draft, send: COPY.send, done: COPY.done,
};

export function findPanelTarget(doc: ParentNode, name: string): HTMLElement | null {
  return doc.querySelector<HTMLElement>(`[${GUIDE_TARGET_ATTRIBUTE}="${name}"]`);
}

export interface PanelGuide {
  /** Shows one tour step inside the Treatable panel, pointing at its control when that control is on screen. */
  show(id: IntroStepId, options: { allowBack: boolean }): Promise<GuideChoice>;
  close(): void;
}

/** Tour steps that point at Treatable's own controls. The dialog is mounted in a shadow root inside the panel frame. */
export function createPanelGuide(getDocument: () => Document, mountOptions: GuideMountOptions = {}): PanelGuide {
  let mount: GuideMount | undefined;
  let highlighterFor: ReturnType<typeof createHighlighter> | undefined;
  const highlighter = {
    apply: (element: Element) => (highlighterFor ??= createHighlighter(getDocument().defaultView!)).apply(element),
    clear: () => highlighterFor?.clear(),
  };

  const reducedMotion = () => { try { return !!getDocument().defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

  return {
    async show(id, options) {
      const doc = getDocument();
      highlighter.clear();
      const name = PANEL_TARGET[id];
      const target = name ? findPanelTarget(doc, name) : null;
      const copy: StepCopy = id === 'draft' && !target ? COPY.draftMissing : PANEL_COPY[id] ?? COPY.done;
      if (target) {
        try { target.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch { /* Convenience only. */ }
        highlighter.apply(target);
      }
      mount ??= createGuideMount(doc, mountOptions);
      return mount.fire({
        title: copy.title,
        body: [...copy.body],
        next: copy.next,
        // "Not now" on the search offer is a real choice, not a way back.
        back: options.allowBack || id === 'search-first' ? copy.back : undefined,
        skip: copy.skip ?? '',
        target,
      });
    },
    close() {
      highlighter.clear();
      mount?.dispose();
      mount = undefined;
    },
  };
}
