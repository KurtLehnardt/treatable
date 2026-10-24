import { createGuideMount, type GuideChoice, type GuideDialog, type GuideMount } from './guide-mount';
import { createHighlighter } from './guide-highlight';
import {
  findConditionField, findFiltersToggle, findInterventional, findRecruiting, isRendered, pageKind, type FoundControl,
} from './guide-finders';
import { COPY, type StepCopy } from './guide-steps';
import type { PageGuideAction, PageGuideCommand, PageGuideEvent, PageGuideOp } from './guide-protocol';
import type { PlaceRect } from './guide-place';

/**
 * Walks a person through ClinicalTrials.gov from the page itself. It points at controls and waits; it never
 * ticks, types into or submits anything, and it removes every highlight and dialog when it ends.
 */
export interface PageGuideEnv {
  isRendered(element: Element): boolean;
  /** How long to wait for a late-rendered control before showing plain instructions instead. */
  findTimeoutMs: number;
  pollMs: number;
}

export interface PageGuideDeps {
  doc: Document;
  win: Window;
  emit(event: PageGuideEvent): void;
  /** Regions to keep clear of dialogs, such as the collapsed Treatable frame. */
  avoid?: () => PlaceRect[];
  createMount?: () => GuideMount;
  env?: Partial<PageGuideEnv>;
}

export interface PageGuide {
  run(command: PageGuideCommand): void;
  /** Ends the current guide. It reports nothing unless `report` is true, in which case the person's step counts as skipped. */
  cancel(report?: boolean): void;
  readonly active: boolean;
}

const DEFAULT_ENV: PageGuideEnv = { isRendered, findTimeoutMs: 8000, pollMs: 250 };

class Run {
  constructor(readonly op: PageGuideOp) {}
  cancelled = false;
  /** True while only a closing confirmation remains, so the guide no longer counts as being in the way. */
  finishing = false;
  private cleanups = new Set<() => void>();
  onEnd(cleanup: () => void) { if (this.cancelled) cleanup(); else this.cleanups.add(cleanup); }
  forget(cleanup: () => void) { this.cleanups.delete(cleanup); }
  end() {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const cleanup of [...this.cleanups]) { try { cleanup(); } catch { /* A failed cleanup must not block the rest. */ } }
    this.cleanups.clear();
  }
}

type Choice = 'next' | 'back' | 'skip' | 'closed';
const fromChoice = (choice: GuideChoice): Choice => choice;

interface CheckboxStep {
  find(root: ParentNode): FoundControl | null;
  tick: StepCopy;
  alreadyTicked: StepCopy;
  missing: StepCopy;
}

const STATUS_STEP: CheckboxStep = { find: findRecruiting, tick: COPY.status, alreadyTicked: COPY.statusDone, missing: COPY.statusMissing };
const TYPE_STEP: CheckboxStep = { find: findInterventional, tick: COPY.type, alreadyTicked: COPY.typeDone, missing: COPY.typeMissing };

export function createPageGuide(deps: PageGuideDeps): PageGuide {
  const { doc, win } = deps;
  const env: PageGuideEnv = { ...DEFAULT_ENV, ...deps.env };
  const emitReport = (op: PageGuideOp, action: PageGuideAction) => deps.emit({ op, action, page: pageKind(win.location.href) });
  const highlighter = createHighlighter(win);
  let current: Run | undefined;
  let mount: GuideMount | undefined;

  const reducedMotion = () => { try { return !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

  function ensureMount() {
    mount ??= (deps.createMount ?? (() => createGuideMount(doc)))();
    return mount;
  }

  function teardown(run: Run) {
    run.end();
    // A run that was replaced has no say over the dialog and highlight the newer run now owns.
    if (current === run || current === undefined) {
      highlighter.clear();
      mount?.dispose();
      mount = undefined;
    }
    if (current === run) current = undefined;
  }

  function finish(run: Run, op: PageGuideOp, action: PageGuideAction) {
    if (run.cancelled) return;
    emitReport(op, action);
    teardown(run);
  }

  function reveal(element: Element) {
    try {
      (element as HTMLElement).scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    } catch { /* Scrolling is a convenience only. */ }
  }

  /** Resolves true as soon as the predicate holds, false on timeout or when the run ends. */
  function until(run: Run, predicate: () => boolean, timeoutMs?: number): Promise<boolean> {
    return new Promise(resolve => {
      if (run.cancelled) { resolve(false); return; }
      let done = false;
      const finishWait = (value: boolean) => {
        if (done) return;
        done = true;
        observer.disconnect();
        doc.removeEventListener('change', onEvent, true);
        doc.removeEventListener('click', onEvent, true);
        win.clearInterval(interval);
        if (timer !== undefined) win.clearTimeout(timer);
        run.forget(stop);
        resolve(value);
      };
      const check = () => {
        if (done) return;
        let ok = false;
        try { ok = predicate(); } catch { ok = false; }
        if (ok) finishWait(true);
      };
      const onEvent = () => { win.setTimeout(check, 0); win.setTimeout(check, 200); };
      const stop = () => finishWait(false);
      const observer = new MutationObserver(() => check());
      observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style', 'aria-hidden', 'aria-expanded', 'checked'] });
      doc.addEventListener('change', onEvent, true);
      doc.addEventListener('click', onEvent, true);
      const interval = win.setInterval(check, env.pollMs);
      const timer = timeoutMs !== undefined ? win.setTimeout(() => finishWait(false), timeoutMs) : undefined;
      run.onEnd(stop);
      check();
    });
  }

  /** Waits for a value to appear, then returns it (or null on timeout or when the run ends). */
  async function waitForValue<T>(run: Run, probe: () => T | null | undefined, timeoutMs: number): Promise<T | null> {
    let found: T | null = null;
    await until(run, () => { found = probe() ?? null; return found !== null; }, timeoutMs);
    return run.cancelled ? null : found;
  }

  function dialogFrom(copy: StepCopy, extra: Partial<GuideDialog> = {}, allowBack = true): GuideDialog {
    return {
      title: copy.title,
      body: [...copy.body],
      next: copy.next,
      back: allowBack ? copy.back : undefined,
      skip: copy.skip ?? '',
      avoid: deps.avoid,
      ...extra,
    };
  }

  /**
   * Shows a dialog and, if a condition is supplied, closes it the moment the condition becomes true.
   * Resolves 'raced' in that case, otherwise with the person's choice.
   */
  async function ask(run: Run, dialog: GuideDialog, condition?: Promise<boolean>): Promise<Choice | 'raced'> {
    if (run.cancelled) return 'closed';
    const open = ensureMount();
    const pending = open.fire(dialog).then(fromChoice);
    if (!condition) return pending;
    const satisfied = condition.then(ok => (ok ? ('raced' as const) : pending));
    const outcome = await Promise.race([pending, satisfied]);
    if (outcome === 'raced') {
      open.closeActive();
      await pending;
      return 'raced';
    }
    return outcome;
  }

  const actionFor = (choice: Choice, ok: PageGuideAction = 'next'): PageGuideAction => (choice === 'next' ? ok : choice === 'back' ? 'back' : 'skip');

  // ---- steps -------------------------------------------------------------------------------------------------

  async function condition(run: Run, command: Extract<PageGuideCommand, { op: 'condition' }>) {
    const startedOn = pageKind(win.location.href);
    const found = await resolveControl(run, findConditionField, COPY.conditionMissing, command.canGoBack);
    if (run.cancelled) return;
    if (typeof found === 'string') {
      if (found !== 'closed') finish(run, 'condition', actionFor(found));
      return;
    }
    reveal(found.anchor);
    highlighter.apply(found.anchor);
    const reachedSearch = startedOn === 'home' ? until(run, () => pageKind(win.location.href) === 'search') : undefined;
    const choice = await ask(run, dialogFrom(COPY.condition, { target: found.anchor, focus: found.input }, command.canGoBack), reachedSearch);
    if (choice === 'closed') return;
    finish(run, 'condition', choice === 'raced' ? 'next' : actionFor(choice));
  }

  async function filtersOffer(run: Run) {
    const choice = await ask(run, dialogFrom(COPY.filtersOffer));
    if (choice === 'closed') return;
    finish(run, 'filters-offer', choice === 'back' ? 'decline' : actionFor(choice === 'raced' ? 'next' : choice));
  }

  async function results(run: Run) {
    const opened = until(run, () => pageKind(win.location.href) === 'study');
    const choice = await ask(run, dialogFrom(COPY.results), opened);
    if (choice === 'closed') return;
    finish(run, 'results', choice === 'raced' ? 'next' : actionFor(choice));
  }

  type Readiness = { kind: 'ready'; found: FoundControl } | { kind: 'collapsed'; toggle?: HTMLElement } | { kind: 'missing' };

  async function readiness(run: Run, find: (root: ParentNode) => FoundControl | null): Promise<Readiness | null> {
    const probe = (): Readiness | null => {
      const found = find(doc);
      if (found && env.isRendered(found.anchor)) return { kind: 'ready', found };
      const toggle = findFiltersToggle(doc);
      if (toggle && env.isRendered(toggle)) return { kind: 'collapsed', toggle };
      return null;
    };
    const state = await waitForValue(run, probe, env.findTimeoutMs);
    if (run.cancelled) return null;
    if (state) return state;
    return find(doc) ? { kind: 'collapsed' } : { kind: 'missing' };
  }

  /**
   * Finds a control that is on screen. A hidden panel gets a pointer to its toggle and the guide keeps waiting;
   * a control that never appears gets plain instructions. Resolves with the control, or with the person's
   * choice when they continue or skip instead.
   */
  async function resolveControl(run: Run, find: (root: ParentNode) => FoundControl | null, missing: StepCopy, allowBack: boolean): Promise<FoundControl | Choice> {
    for (let attempt = 0; attempt < 6 && !run.cancelled; attempt++) {
      const state = await readiness(run, find);
      if (!state || run.cancelled) return 'closed';
      if (state.kind === 'ready') return state.found;
      if (state.kind === 'missing') return fromAsk(await ask(run, dialogFrom(missing, {}, allowBack)));
      if (state.toggle) { reveal(state.toggle); highlighter.apply(state.toggle); }
      const visible = until(run, () => { const f = find(doc); return !!f && env.isRendered(f.anchor); });
      const choice = await ask(run, dialogFrom(state.toggle ? COPY.openFilters : COPY.openFiltersNoButton, { target: state.toggle ?? null }, false), visible);
      highlighter.clear();
      if (choice !== 'raced') return fromAsk(choice);
    }
    return 'closed';
  }

  /** One filter: point at it, wait for the person to tick it, and handle hidden, missing and already-ticked cases. */
  async function checkbox(run: Run, step: CheckboxStep, allowBack: boolean): Promise<Choice> {
    highlighter.clear();
    for (let pass = 0; pass < 8 && !run.cancelled; pass++) {
      const found = await resolveControl(run, step.find, step.missing, allowBack);
      if (typeof found === 'string') return found;
      if ((found.input as HTMLInputElement).checked) {
        if (pass > 0) return 'next';
        return fromAsk(await ask(run, dialogFrom(step.alreadyTicked, {}, allowBack)));
      }
      reveal(found.anchor);
      highlighter.apply(found.anchor);
      const changed = until(run, () => {
        const latest = step.find(doc);
        // The panel was hidden or the site redrew it: stop waiting on a box that is gone and look again.
        if (!latest || !env.isRendered(latest.anchor)) return true;
        // Keep the highlight on whichever box is current.
        if (latest.anchor !== highlighter.active) highlighter.apply(latest.anchor);
        return (latest.input as HTMLInputElement).checked;
      });
      const group = found.input.closest('ctg-checkbox-tree-filter') ?? found.input.closest('.filter-group');
      const choice = await ask(run, dialogFrom(step.tick, { target: found.anchor, context: group, focus: found.input }, allowBack), changed);
      highlighter.clear();
      if (choice !== 'raced') return fromAsk(choice);
      const latest = step.find(doc);
      if (latest && (latest.input as HTMLInputElement).checked) return 'next';
    }
    return 'closed';
  }

  const fromAsk = (choice: Choice | 'raced'): Choice => (choice === 'raced' ? 'next' : choice);

  async function filters(run: Run, command: Extract<PageGuideCommand, { op: 'filters' }>) {
    // If the person leaves the search page the filters are gone, so the guide ends and says so.
    void until(run, () => pageKind(win.location.href) !== 'search').then(left => { if (left) finish(run, 'filters', 'unavailable'); });
    if (command.intro) {
      const start = fromAsk(await ask(run, dialogFrom(COPY.searchIntro)));
      if (start === 'closed') return;
      if (start !== 'next') { finish(run, 'filters', 'skip'); return; }
    }
    let index = 0;
    while (!run.cancelled) {
      const result = await checkbox(run, index === 0 ? STATUS_STEP : TYPE_STEP, index === 1);
      if (result === 'closed') return;
      if (result === 'skip') { finish(run, 'filters', 'skip'); return; }
      if (result === 'back') { index = Math.max(0, index - 1); continue; }
      if (index === 1) break;
      index = 1;
    }
    if (run.cancelled) return;
    highlighter.clear();
    run.finishing = true;
    emitReport('filters', 'done');
    // The confirmation outlives the report so the panel can come back while it is still showing.
    await ask(run, { ...dialogFrom(COPY.filtersDone), toast: true, timerMs: 6500 });
    teardown(run);
  }

  function run(command: PageGuideCommand) {
    if (current) teardown(current);
    if (command.op === 'cancel') return;
    const next = new Run(command.op);
    current = next;
    const task = command.op === 'condition' ? condition(next, command)
      : command.op === 'filters-offer' ? filtersOffer(next)
      : command.op === 'filters' ? filters(next, command)
      : results(next);
    task.catch(() => finish(next, command.op, 'unavailable'));
  }

  return {
    run,
    cancel(report = false) {
      if (!current) return;
      if (report && !current.finishing && !current.cancelled) emitReport(current.op, 'skip');
      teardown(current);
    },
    get active() { return !!current && !current.cancelled && !current.finishing; },
  };
}
