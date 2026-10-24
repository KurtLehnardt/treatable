/**
 * The small, fixed vocabulary spoken between the Treatable panel and the guide that runs on the page.
 * Neither side ever sends free text: commands and events are chosen from these lists and validated on arrival.
 */
export const PAGE_GUIDE_OPS = ['condition', 'filters-offer', 'filters', 'results'] as const;
export type PageGuideOp = (typeof PAGE_GUIDE_OPS)[number];

export const PAGE_GUIDE_ACTIONS = ['next', 'back', 'skip', 'done', 'decline', 'unavailable'] as const;
export type PageGuideAction = (typeof PAGE_GUIDE_ACTIONS)[number];

export type PageGuideCommand =
  | { op: 'condition'; canGoBack: boolean }
  | { op: 'filters-offer' }
  | { op: 'filters'; intro: boolean }
  | { op: 'results' }
  | { op: 'cancel' };

/** Where the person is when the step ends, so the panel need not wait for its own view of the page to catch up. */
export const PAGE_KINDS = ['home', 'search', 'study', 'other'] as const;
export interface PageGuideEvent { op: PageGuideOp; action: PageGuideAction; page: (typeof PAGE_KINDS)[number] }

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));

export function parsePageGuideCommand(value: unknown): PageGuideCommand {
  if (!record(value) || typeof value.op !== 'string') throw new Error('Invalid guide command');
  switch (value.op) {
    case 'condition':
      if (!onlyKeys(value, ['op', 'canGoBack']) || typeof value.canGoBack !== 'boolean') break;
      return { op: 'condition', canGoBack: value.canGoBack };
    case 'filters-offer':
      if (!onlyKeys(value, ['op'])) break;
      return { op: 'filters-offer' };
    case 'filters':
      if (!onlyKeys(value, ['op', 'intro']) || typeof value.intro !== 'boolean') break;
      return { op: 'filters', intro: value.intro };
    case 'results':
      if (!onlyKeys(value, ['op'])) break;
      return { op: 'results' };
    case 'cancel':
      if (!onlyKeys(value, ['op'])) break;
      return { op: 'cancel' };
  }
  throw new Error('Invalid guide command');
}

export function parsePageGuideEvent(value: unknown): PageGuideEvent {
  if (!record(value) || !onlyKeys(value, ['op', 'action', 'page']) || !(PAGE_GUIDE_OPS as readonly unknown[]).includes(value.op) || !(PAGE_GUIDE_ACTIONS as readonly unknown[]).includes(value.action) || !(PAGE_KINDS as readonly unknown[]).includes(value.page)) {
    throw new Error('Invalid guide event');
  }
  return { op: value.op as PageGuideOp, action: value.action as PageGuideAction, page: value.page as PageGuideEvent['page'] };
}
