/**
 * Highlight for a page or panel control. It uses only inline styles and one uniquely named attribute, never a
 * stylesheet, so it works under a strict page CSP and can be removed completely.
 */
export const HIGHLIGHT_ATTRIBUTE = 'data-treatable-guide-highlight';

const PROPERTIES = ['outline', 'outline-offset', 'box-shadow', 'border-radius'] as const;
interface Saved { values: Map<string, [string, string]>; animation?: Animation; hadAttribute: string | null }

export interface Highlighter {
  /** Highlights one element. Any previous highlight owned by this highlighter is removed first. */
  apply(element: Element): void;
  /** Removes every highlight this highlighter applied. Safe to call repeatedly. */
  clear(): void;
  readonly active: Element | undefined;
}

export function createHighlighter(win: Window, options: { reducedMotion?: () => boolean } = {}): Highlighter {
  const saved = new Map<HTMLElement, Saved>();
  let current: HTMLElement | undefined;
  const reduced = options.reducedMotion ?? (() => { try { return !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } });
  function restore(element: HTMLElement, entry: Saved) {
    entry.animation?.cancel();
    for (const property of PROPERTIES) {
      const [value, priority] = entry.values.get(property) ?? ['', ''];
      if (value) element.style.setProperty(property, value, priority); else element.style.removeProperty(property);
    }
    if (entry.hadAttribute === null) element.removeAttribute(HIGHLIGHT_ATTRIBUTE); else element.setAttribute(HIGHLIGHT_ATTRIBUTE, entry.hadAttribute);
    if (!element.getAttribute('style')) element.removeAttribute('style');
  }
  function clear() {
    for (const [element, entry] of saved) restore(element, entry);
    saved.clear();
    current = undefined;
  }
  return {
    apply(element) {
      if (!(element instanceof (win as any).HTMLElement)) return;
      clear();
      const html = element as HTMLElement, values = new Map<string, [string, string]>();
      for (const property of PROPERTIES) values.set(property, [html.style.getPropertyValue(property), html.style.getPropertyPriority(property)]);
      const entry: Saved = { values, hadAttribute: html.getAttribute(HIGHLIGHT_ATTRIBUTE) };
      saved.set(html, entry);
      current = html;
      html.setAttribute(HIGHLIGHT_ATTRIBUTE, 'true');
      html.style.setProperty('outline', '3px solid #1f7a52', 'important');
      html.style.setProperty('outline-offset', '4px', 'important');
      html.style.setProperty('box-shadow', '0 0 0 7px rgba(31, 122, 82, 0.28)', 'important');
      html.style.setProperty('border-radius', '4px');
      if (!reduced() && typeof html.animate === 'function') {
        try {
          entry.animation = html.animate(
            [{ boxShadow: '0 0 0 4px rgba(31, 122, 82, 0.45)' }, { boxShadow: '0 0 0 12px rgba(31, 122, 82, 0)' }],
            { duration: 1400, iterations: Infinity, easing: 'ease-out' },
          );
        } catch { /* The static outline is enough when animation is unavailable. */ }
      }
    },
    clear,
    get active() { return current; },
  };
}
