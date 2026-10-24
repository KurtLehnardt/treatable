/**
 * Locates the ClinicalTrials.gov controls the guide points at. The site is a client-rendered app, so every
 * finder works from visible labels and accessible names first and falls back to ids and values that were
 * confirmed against the live page. A finder never changes the page.
 */

export type PageKind = 'home' | 'search' | 'study' | 'other';

export function pageKind(url: string): PageKind {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    if (path === '/') return 'home';
    if (path === '/search') return 'search';
    if (/^\/study\/NCT[0-9]{8}$/i.test(path)) return 'study';
  } catch { /* Fall through to other. */ }
  return 'other';
}

export type FoundVia = 'label-and-value' | 'label' | 'value' | 'id' | 'accessible-name';

export interface FoundControl {
  /** The control whose state or value the person changes. */
  input: HTMLElement;
  /**
   * What to scroll to, highlight and keep the dialog clear of. ClinicalTrials.gov moves its checkbox inputs
   * far off screen and draws the box on the label, so a checkbox is represented by its visible label.
   */
  anchor: HTMLElement;
  via: FoundVia;
}

const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

/** Label text without the trailing result count, such as "(64,983)". */
export function labelText(label: Element | null | undefined): string {
  if (!label) return '';
  const copy = label.cloneNode(true) as Element;
  copy.querySelectorAll('.agg-count').forEach(count => count.remove());
  return clean(copy.textContent).replace(/\s*\(\d[\d,]*\)\s*$/, '');
}

export function accessibleName(element: Element): string {
  const aria = clean(element.getAttribute('aria-label'));
  if (aria) return aria;
  const by = element.getAttribute('aria-labelledby');
  if (by) {
    const doc = element.ownerDocument;
    const text = clean(by.split(/\s+/).map(id => doc.getElementById(id)?.textContent ?? '').join(' '));
    if (text) return text;
  }
  const own = clean(element.textContent);
  return own || clean(element.getAttribute('title')) || clean(element.getAttribute('placeholder'));
}

function labelFor(input: HTMLInputElement): HTMLLabelElement | null {
  const direct = input.labels?.[0];
  if (direct) return direct;
  const root = input.getRootNode() as ParentNode;
  if (input.id) {
    for (const candidate of Array.from(root.querySelectorAll('label'))) if (candidate.htmlFor === input.id) return candidate;
  }
  return input.closest('label');
}

/** Finds the group wrapper by its id or, failing that, by its legend text. */
function groupScope(root: ParentNode, selector: string, legend: RegExp): ParentNode | null {
  const byId = root.querySelector(selector);
  if (byId) return byId;
  for (const title of Array.from(root.querySelectorAll('legend, .group-title'))) {
    if (legend.test(clean(title.textContent))) return title.closest('.filter-group') ?? title.parentElement;
  }
  return null;
}

interface CheckboxSpec {
  scope: string;
  legend: RegExp;
  value: string;
  label: RegExp;
  fallbackId: string;
}

function checkboxIn(root: ParentNode, spec: CheckboxSpec): FoundControl | null {
  const scope = groupScope(root, spec.scope, spec.legend);
  const make = (input: HTMLInputElement, via: FoundVia): FoundControl => {
    const label = labelFor(input);
    return { input, anchor: (label ?? input.closest('.usa-checkbox') ?? input) as HTMLElement, via };
  };
  if (scope) {
    const boxes = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    const labelled = (input: HTMLInputElement) => spec.label.test(labelText(labelFor(input)));
    const both = boxes.find(input => input.value === spec.value && labelled(input));
    if (both) return make(both, 'label-and-value');
    const byLabel = boxes.find(labelled);
    if (byLabel) return make(byLabel, 'label');
    const byValue = boxes.find(input => input.value === spec.value);
    if (byValue) return make(byValue, 'value');
  }
  const byId = root.querySelector<HTMLInputElement>(`input[type="checkbox"][id="${spec.fallbackId}"]`);
  return byId ? make(byId, 'id') : null;
}

/** "Recruiting" under Study Status. It never matches "Not yet recruiting" or "Active, not recruiting". */
export function findRecruiting(root: ParentNode): FoundControl | null {
  return checkboxIn(root, { scope: 'ctg-checkbox-tree-filter#adv-check-status', legend: /^study status\b/i, value: 'rec', label: /^recruiting\b/i, fallbackId: 'adv-check0-status1' });
}

/** "Interventional" under Study Type. Observational and expanded-access options are never matched. */
export function findInterventional(root: ParentNode): FoundControl | null {
  return checkboxIn(root, { scope: 'ctg-checkbox-tree-filter#adv-check-studyType', legend: /^study type\b/i, value: 'int', label: /^interventional\b/i, fallbackId: 'adv-check0-studyType0' });
}

function textInput(root: ParentNode, spec: { ids: string[]; names: RegExp }): FoundControl | null {
  const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])'));
  for (const input of inputs) {
    const label = labelFor(input);
    const names = [accessibleName(input), labelText(label), clean(input.getAttribute('placeholder'))];
    if (names.some(name => spec.names.test(name))) return { input, anchor: input, via: 'accessible-name' };
  }
  for (const id of spec.ids) {
    const byId = root.querySelector<HTMLInputElement>(`input[id="${id}"]`);
    if (byId) return { input: byId, anchor: byId, via: 'id' };
  }
  return null;
}

/** The Condition/disease box on the home page and on the search page. */
export function findConditionField(root: ParentNode): FoundControl | null {
  return textInput(root, { ids: ['advcond', 'cond', 'condition'], names: /^condition(\s*\/\s*disease)?$/i });
}

export function findLocationField(root: ParentNode): FoundControl | null {
  return textInput(root, { ids: ['location-input', 'locn'], names: /\b(location|in country, state, or city)\b/i });
}

/**
 * The control that opens a collapsed or narrow-screen filters panel. On a wide screen the panel has a Show/Hide
 * button; on a narrow screen a "Focus Your Search" button opens a dialog that holds the filters.
 */
export function findFiltersToggle(root: ParentNode): HTMLElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]'));
  const modal = buttons.find(button => button.getAttribute('aria-controls') === 'focus-your-search-modal');
  if (modal) return modal;
  const panel = root.querySelector('ctg-focus-your-search-panel');
  if (panel) {
    const show = Array.from(panel.querySelectorAll<HTMLElement>('button')).find(button => /^show$/i.test(accessibleName(button)));
    if (show) return show;
  }
  return buttons.find(button => /\b(focus your search|filters?)\b/i.test(accessibleName(button)) && !/glossary|close|clear/i.test(accessibleName(button))) ?? null;
}

/** True when the element takes up space on screen. A hidden checkbox input is judged by its anchor, not itself. */
export function isRendered(element: Element): boolean {
  const html = element as HTMLElement;
  try {
    if (typeof (html as any).checkVisibility === 'function' && !(html as any).checkVisibility({ checkVisibilityCSS: true })) return false;
  } catch { /* Fall back to geometry. */ }
  return Array.from(html.getClientRects()).some(rect => rect.width > 0 && rect.height > 0);
}
