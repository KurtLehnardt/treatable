import { INTRO_STEPS, STEP_HOST, stepApplies, stepFrom, type IntroStepId, type StepContext } from './guide-steps';
import type { PageKind } from './guide-finders';
import type { OnboardingStore } from './guide-state';
import type { GuideChoice } from './guide-mount';
import type { PageGuideCommand, PageGuideEvent } from './guide-protocol';

/**
 * The intro tour as a small state machine. It decides which step comes next from the kind of page the person
 * is on, keeps only the step number in session storage, and hands every dialog to a port. It never ticks,
 * types or sends anything, and it does not touch the existing consent, preview or confirmation steps: it only
 * points at them.
 */
export interface IntroPorts {
  store: OnboardingStore;
  showPanelStep(id: IntroStepId, options: { allowBack: boolean }): Promise<GuideChoice>;
  closePanelStep(): void;
  /** Shrinks the panel out of the way and starts a step on the page itself. */
  runPageStep(command: PageGuideCommand): Promise<void>;
  cancelPage(): Promise<void>;
  expandPanel(): Promise<void>;
  /** Navigates this tab to the ClinicalTrials.gov home page; the panel reopens there. */
  openSearchPage(): Promise<void>;
  pageKind(): PageKind;
  onChange?(state: { active: boolean; step?: IntroStepId }): void;
}

const INDEX = Object.fromEntries(INTRO_STEPS.map((id, i) => [id, i])) as Record<IntroStepId, number>;
const PAGE_OP_STEP: Record<PageGuideEvent['op'], IntroStepId> = {
  condition: 'condition', 'filters-offer': 'filters-offer', filters: 'filters', results: 'results',
};

export class IntroGuide {
  private index: number | undefined;
  private token = 0;
  /** The newest page kind heard from the page guide. It can be fresher than the panel's own snapshot. */
  private reportedPage: PageKind | undefined;

  constructor(private readonly ports: IntroPorts) {}

  get active() { return this.index !== undefined; }
  get step(): IntroStepId | undefined { return this.index === undefined ? undefined : INTRO_STEPS[this.index]; }

  private context(): StepContext { return { page: this.reportedPage ?? this.ports.pageKind() }; }

  private notify() { this.ports.onChange?.({ active: this.active, step: this.step }); }

  /** Starts from the beginning, forgetting any saved position. Used for the first run and for Replay intro. */
  async start(): Promise<void> {
    this.halt();
    await this.ports.store.clearStep();
    await this.show(0);
  }

  /** Continues from a position saved before the page navigated. */
  async resume(saved: number): Promise<void> {
    this.halt();
    await this.show(saved);
  }

  /** Stops quietly, for example when the panel closes. Nothing is recorded as finished. */
  stop(): void {
    this.halt();
    void this.ports.cancelPage().catch(() => {});
  }

  private halt() {
    this.token++;
    this.ports.closePanelStep();
    const was = this.active;
    this.index = undefined;
    if (was) this.notify();
  }

  private async finish() {
    this.halt();
    await this.ports.cancelPage().catch(() => {});
    await this.ports.store.markDone();
    await this.ports.expandPanel().catch(() => {});
  }

  private async show(wanted: number, offerAccepted = false): Promise<void> {
    const token = ++this.token;
    const context = this.context();
    let index = Math.min(Math.max(Math.trunc(wanted), 0), INTRO_STEPS.length - 1);
    // `filters` only runs after the offer is accepted; a saved position there restarts at the offer.
    if (index === INDEX.filters && !offerAccepted) index = context.page === 'search' ? INDEX['filters-offer'] : (stepFrom(index, 1, context) ?? INTRO_STEPS.length - 1);
    if (!(index === INDEX.filters && offerAccepted) && !stepApplies(INTRO_STEPS[index], context)) {
      const next = stepFrom(index, 1, context);
      if (next === undefined) { await this.finish(); return; }
      index = next;
    }
    this.index = index;
    this.notify();
    void this.ports.store.saveStep(index);
    const id = INTRO_STEPS[index];
    try {
      if (STEP_HOST[id] === 'panel') {
        await this.ports.cancelPage();
        await this.ports.expandPanel();
        if (token !== this.token) return;
        const choice = await this.ports.showPanelStep(id, { allowBack: stepFrom(index, -1, context) !== undefined });
        if (token !== this.token) return;
        await this.afterPanel(index, id, choice);
      } else {
        this.ports.closePanelStep();
        await this.ports.runPageStep(this.commandFor(id, stepFrom(index, -1, context) !== undefined));
      }
    } catch {
      // The page or the connection is gone. Stop without recording the intro as finished.
      if (token === this.token) this.halt();
    }
  }

  private commandFor(id: IntroStepId, canGoBack: boolean): PageGuideCommand {
    switch (id) {
      case 'condition': return { op: 'condition', canGoBack };
      case 'filters-offer': return { op: 'filters-offer' };
      case 'filters': return { op: 'filters', intro: false };
      default: return { op: 'results' };
    }
  }

  private async goForward(from: number) {
    const next = stepFrom(from, 1, this.context());
    if (next === undefined) await this.finish(); else await this.show(next);
  }

  private async goBack(from: number) {
    const previous = stepFrom(from, -1, this.context());
    await this.show(previous ?? from);
  }

  private async afterPanel(index: number, id: IntroStepId, choice: GuideChoice) {
    if (choice === 'closed') return;
    if (choice === 'skip') { await this.finish(); return; }
    if (choice === 'back') {
      if (id === 'search-first') await this.goForward(INDEX.results); else await this.goBack(index);
      return;
    }
    if (id === 'search-first') {
      // The page reloads, so the next step is saved first. The panel reopens on the new page and resumes.
      await this.ports.store.saveStep(INDEX.condition);
      await this.ports.openSearchPage();
      return;
    }
    if (id === 'done') { await this.finish(); return; }
    await this.goForward(index);
  }

  /** A report from the guide running on the page. Reports for a step that is no longer current are ignored. */
  async handlePageEvent(event: PageGuideEvent): Promise<void> {
    if (this.index === undefined || INTRO_STEPS[this.index] !== PAGE_OP_STEP[event.op]) return;
    this.reportedPage = event.page;
    const index = this.index;
    try {
      if (event.action === 'skip') { await this.finish(); return; }
      if (event.action === 'back') { await this.goBack(index); return; }
      if (event.op === 'filters-offer' && event.action === 'next') { await this.show(INDEX.filters, true); return; }
      if (event.op === 'filters-offer' && event.action === 'decline') { await this.goForward(INDEX.filters); return; }
      await this.goForward(index);
    } catch {
      this.halt();
    }
  }

  /** The page changed under the tour (for example a study opened). Move off steps that no longer fit. */
  async onPageChange(): Promise<void> {
    // The panel's own view of the page has changed, so it is now at least as fresh as any earlier report.
    this.reportedPage = undefined;
    if (this.index === undefined) return;
    const id = INTRO_STEPS[this.index];
    if (id === 'filters' || stepApplies(id, this.context())) return;
    await this.goForward(this.index);
  }
}
