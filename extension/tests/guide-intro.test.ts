import test from 'node:test';
import assert from 'node:assert/strict';
import { IntroGuide, type IntroPorts } from '../src/guide-intro';
import { ONBOARDING_FLAG_KEY, ONBOARDING_STEP_KEY, createOnboardingStore, onboardingAreas, type StorageAreaLike } from '../src/guide-state';
import { INTRO_STEPS, ONBOARDING_VERSION, stepApplies, stepFrom, type IntroStepId } from '../src/guide-steps';
import type { PageKind } from '../src/guide-finders';
import type { GuideChoice } from '../src/guide-mount';
import type { PageGuideCommand } from '../src/guide-protocol';

function fakeArea() {
  const data = new Map<string, unknown>();
  const writes: Array<Record<string, unknown>> = [];
  const removes: string[] = [];
  const area: StorageAreaLike = {
    async get(key) { return data.has(key) ? { [key]: data.get(key) } : {}; },
    async set(items) { writes.push(structuredClone(items)); for (const [k, v] of Object.entries(items)) data.set(k, v); },
    async remove(key) { removes.push(key); data.delete(key); },
  };
  return { area, data, writes, removes };
}

function rig(options: { page?: PageKind; choices?: Array<GuideChoice | 'hold'>; done?: boolean; saved?: number } = {}) {
  const local = fakeArea(), session = fakeArea();
  if (options.done) local.data.set(ONBOARDING_FLAG_KEY, ONBOARDING_VERSION);
  if (options.saved !== undefined) session.data.set(ONBOARDING_STEP_KEY, options.saved);
  const store = createOnboardingStore({ local: local.area, session: session.area });
  const log: string[] = [];
  const panelSteps: IntroStepId[] = [];
  const pageCommands: PageGuideCommand[] = [];
  const queue = [...(options.choices ?? [])];
  let page: PageKind = options.page ?? 'study';
  const ports: IntroPorts = {
    store,
    async showPanelStep(id) {
      panelSteps.push(id); log.push(`panel:${id}`);
      const choice = queue.shift() ?? 'next';
      // 'hold' leaves the dialog open, as it would be while a person reads it.
      return choice === 'hold' ? new Promise<GuideChoice>(() => {}) : choice;
    },
    closePanelStep() { log.push('closePanel'); },
    async runPageStep(command) { pageCommands.push(command); log.push(`page:${command.op}`); },
    async cancelPage() { log.push('cancelPage'); },
    async expandPanel() { log.push('expand'); },
    async openSearchPage() { log.push('openSearch'); },
    pageKind: () => page,
  };
  const intro = new IntroGuide(ports);
  return { intro, local, session, log, panelSteps, pageCommands, setPage: (value: PageKind) => { page = value; } };
}

const begin = async (promise: Promise<unknown>) => { void promise.catch(() => {}); await flush(); };
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise<void>(resolve => queueMicrotask(resolve)); };

test('the step list starts with the welcome and ends with done, and the appearance and AI-matched results steps come right after the welcome', () => {
  assert.equal(INTRO_STEPS[0], 'welcome');
  assert.equal(INTRO_STEPS[1], 'appearance');
  assert.equal(INTRO_STEPS[2], 'ai-ranking');
  assert.equal(INTRO_STEPS.at(-1), 'done');
  assert.ok(INTRO_STEPS.indexOf('understand') < INTRO_STEPS.indexOf('brief'));
  assert.ok(INTRO_STEPS.indexOf('brief') < INTRO_STEPS.indexOf('personalize'));
  assert.ok(INTRO_STEPS.indexOf('personalize') < INTRO_STEPS.indexOf('draft'));
  assert.ok(INTRO_STEPS.indexOf('draft') < INTRO_STEPS.indexOf('send'));
});

test('steps apply only to the pages they are about', () => {
  const on = (page: PageKind) => INTRO_STEPS.filter(id => stepApplies(id, { page }));
  assert.deepEqual(on('home'), ['welcome', 'appearance', 'ai-ranking', 'condition', 'done']);
  assert.deepEqual(on('search'), ['welcome', 'appearance', 'ai-ranking', 'condition', 'filters-offer', 'results', 'done']);
  assert.deepEqual(on('study'), ['welcome', 'appearance', 'ai-ranking', 'search-first', 'understand', 'brief', 'personalize', 'draft', 'send', 'done']);
  assert.deepEqual(on('other'), ['welcome', 'appearance', 'ai-ranking', 'search-first', 'done']);
  assert.equal(stepFrom(INTRO_STEPS.length - 1, 1, { page: 'study' }), undefined);
  assert.equal(stepFrom(0, -1, { page: 'study' }), undefined);
});

test('on a study page the tour walks welcome, appearance, AI-matched results, search offer, then every Treatable control in order, and finishes', async () => {
  const t = rig({ page: 'study', choices: ['next', 'next', 'next', 'back' /* Not now on the search offer */] });
  await t.intro.start();
  await flush();
  assert.deepEqual(t.panelSteps, ['welcome', 'appearance', 'ai-ranking', 'search-first', 'understand', 'brief', 'personalize', 'draft', 'send', 'done']);
  assert.equal(t.intro.active, false);
  assert.deepEqual(t.pageCommands, [], 'no step was run on the page itself');
  assert.deepEqual(t.local.writes, [{ [ONBOARDING_FLAG_KEY]: ONBOARDING_VERSION }], 'finishing writes exactly the one allowed flag');
  assert.deepEqual(t.session.data.has(ONBOARDING_STEP_KEY), false, 'the saved step is removed at the end');
});

test('every stored step is a bare in-range integer and nothing else is ever written', async () => {
  const t = rig({ page: 'study', choices: ['next', 'next', 'next', 'back'] });
  await t.intro.start();
  await flush();
  const steps = t.session.writes.map(w => { assert.deepEqual(Object.keys(w), [ONBOARDING_STEP_KEY]); return w[ONBOARDING_STEP_KEY]; });
  assert.ok(steps.length >= 8);
  for (const step of steps) assert.ok(Number.isInteger(step) && (step as number) >= 0 && (step as number) < INTRO_STEPS.length, String(step));
  for (const key of [...t.local.writes, ...t.session.writes].flatMap(w => Object.keys(w))) assert.match(key, /^treatable\.onboarding(Version|Step)$/);
  assert.equal(JSON.stringify([...t.local.writes, ...t.session.writes]).match(/NCT|asthma|http/), null, 'no study ID, search term or URL is stored');
});

test('Skip finishes the tour at once, stores only the done flag and cleans up the panel and the page', async () => {
  const t = rig({ page: 'study', choices: ['next', 'skip'] });
  await t.intro.start();
  await flush();
  assert.deepEqual(t.panelSteps, ['welcome', 'appearance']);
  assert.equal(t.intro.active, false);
  assert.deepEqual(t.local.writes, [{ [ONBOARDING_FLAG_KEY]: ONBOARDING_VERSION }]);
  assert.equal(t.session.data.has(ONBOARDING_STEP_KEY), false);
  assert.ok(t.log.includes('closePanel') && t.log.includes('cancelPage'));
  assert.equal(t.log.at(-1), 'expand', 'the panel is expanded again at the end');
});

test('Back returns to the previous applicable step', async () => {
  const t = rig({ page: 'study', choices: ['next', 'back', 'skip'] });
  await t.intro.start();
  await flush();
  assert.deepEqual(t.panelSteps, ['welcome', 'appearance', 'welcome']);
});

test('on a study page the search offer opens ClinicalTrials.gov and saves the next step for the new page', async () => {
  const t = rig({ page: 'study', choices: ['next', 'next', 'next', 'next'] });
  await t.intro.start();
  await flush();
  assert.deepEqual(t.panelSteps, ['welcome', 'appearance', 'ai-ranking', 'search-first']);
  assert.ok(t.log.includes('openSearch'));
  assert.equal(t.session.data.get(ONBOARDING_STEP_KEY), INTRO_STEPS.indexOf('condition'));
  assert.equal(t.local.data.has(ONBOARDING_FLAG_KEY), false, 'not finished yet');
  assert.equal(t.intro.active, true, 'still in progress; the panel resumes on the new page');
});

test('after the page reloads, the saved step resumes on the home page with the condition step run on the page', async () => {
  const t = rig({ page: 'home', saved: INTRO_STEPS.indexOf('condition') });
  await t.intro.resume(INTRO_STEPS.indexOf('condition'));
  await flush();
  assert.deepEqual(t.pageCommands, [{ op: 'condition', canGoBack: true }]);
  assert.deepEqual(t.panelSteps, []);
  assert.equal(t.intro.step, 'condition');
});

test('page reports move the tour on: condition, offer, filters, results and then the study tools', async () => {
  const t = rig({ page: 'search', choices: ['hold'] });
  await t.intro.resume(INTRO_STEPS.indexOf('condition'));
  await t.intro.handlePageEvent({ op: 'condition', action: 'next', page: 'search' });
  await flush();
  assert.equal(t.intro.step, 'filters-offer');
  assert.deepEqual(t.pageCommands.at(-1), { op: 'filters-offer' });
  await t.intro.handlePageEvent({ op: 'filters-offer', action: 'next', page: 'search' });
  await flush();
  assert.equal(t.intro.step, 'filters');
  assert.deepEqual(t.pageCommands.at(-1), { op: 'filters', intro: false });
  await t.intro.handlePageEvent({ op: 'filters', action: 'done', page: 'search' });
  await flush();
  assert.equal(t.intro.step, 'results');
  assert.deepEqual(t.pageCommands.at(-1), { op: 'results' });
  t.setPage('study');
  await begin(t.intro.handlePageEvent({ op: 'results', action: 'next', page: 'study' }));
  assert.equal(t.intro.step, 'understand');
  assert.equal(t.panelSteps.at(-1), 'understand');
});

test('declining the filters help skips straight to opening a study', async () => {
  const t = rig({ page: 'search' });
  await t.intro.resume(INTRO_STEPS.indexOf('filters-offer'));
  await t.intro.handlePageEvent({ op: 'filters-offer', action: 'decline', page: 'search' });
  await flush();
  assert.equal(t.intro.step, 'results');
});

test('a report for a step that is no longer current is ignored', async () => {
  const t = rig({ page: 'search' });
  await t.intro.resume(INTRO_STEPS.indexOf('filters-offer'));
  await t.intro.handlePageEvent({ op: 'condition', action: 'skip', page: 'search' });
  await t.intro.handlePageEvent({ op: 'results', action: 'next', page: 'study' });
  assert.equal(t.intro.step, 'filters-offer');
  assert.equal(t.local.data.has(ONBOARDING_FLAG_KEY), false);
});

test('a skip reported from the page ends the tour and records it as seen', async () => {
  const t = rig({ page: 'search' });
  await t.intro.resume(INTRO_STEPS.indexOf('condition'));
  await t.intro.handlePageEvent({ op: 'condition', action: 'skip', page: 'search' });
  await flush();
  assert.equal(t.intro.active, false);
  assert.deepEqual(t.local.writes, [{ [ONBOARDING_FLAG_KEY]: ONBOARDING_VERSION }]);
});

test('when the page changes under the tour (a study opens), steps that no longer fit are skipped', async () => {
  const t = rig({ page: 'search', choices: ['hold'] });
  await t.intro.resume(INTRO_STEPS.indexOf('results'));
  t.setPage('study');
  await begin(t.intro.onPageChange());
  assert.equal(t.intro.step, 'understand');
});

test('a saved position on the filters step restarts at the offer when it is a search page and moves on otherwise', async () => {
  const filters = INTRO_STEPS.indexOf('filters');
  const search = rig({ page: 'search' });
  await search.intro.resume(filters);
  assert.equal(search.intro.step, 'filters-offer');
  const study = rig({ page: 'study', choices: ['hold'] });
  await begin(study.intro.resume(filters));
  assert.equal(study.intro.step, 'understand');
});

test('page steps shrink the panel through the port; panel steps cancel the page first', async () => {
  const t = rig({ page: 'search', choices: ['skip'] });
  await t.intro.resume(INTRO_STEPS.indexOf('condition'));
  assert.ok(t.log.indexOf('closePanel') < t.log.indexOf('page:condition'));
  await t.intro.start();
  await flush();
  assert.ok(t.log.indexOf('cancelPage') < t.log.lastIndexOf('panel:welcome'));
});

test('stopping the tour (the panel closed) records nothing as finished', async () => {
  const t = rig({ page: 'search' });
  await t.intro.resume(INTRO_STEPS.indexOf('condition'));
  t.intro.stop();
  await flush();
  assert.equal(t.intro.active, false);
  assert.equal(t.local.writes.length, 0);
  assert.equal(t.session.data.get(ONBOARDING_STEP_KEY), INTRO_STEPS.indexOf('condition'), 'the position is kept for the browser session');
});

test('a failing page connection halts the tour without recording it as finished', async () => {
  const t = rig({ page: 'search' });
  (t as any).intro['ports'].runPageStep = async () => { throw new Error('gone'); };
  await t.intro.resume(INTRO_STEPS.indexOf('condition'));
  await flush();
  assert.equal(t.intro.active, false);
  assert.equal(t.local.writes.length, 0);
});

test('storage: the done flag compares against the guide version, and unreadable storage never throws', async () => {
  const local = fakeArea();
  const store = createOnboardingStore({ local: local.area });
  assert.equal(await store.isDone(), false);
  local.data.set(ONBOARDING_FLAG_KEY, ONBOARDING_VERSION - 1);
  assert.equal(await store.isDone(), false);
  local.data.set(ONBOARDING_FLAG_KEY, ONBOARDING_VERSION);
  assert.equal(await store.isDone(), true);
  local.data.set(ONBOARDING_FLAG_KEY, 'yes');
  assert.equal(await store.isDone(), false, 'anything but a number is ignored');
  const broken: StorageAreaLike = { get: async () => { throw new Error('blocked'); }, set: async () => { throw new Error('blocked'); }, remove: async () => { throw new Error('blocked'); } };
  const blocked = createOnboardingStore({ local: broken, session: broken });
  assert.equal(await blocked.isDone(), false);
  assert.equal(await blocked.savedStep(), undefined);
  await blocked.saveStep(2); await blocked.markDone(); await blocked.clearStep();
  const none = createOnboardingStore({});
  assert.equal(await none.isDone(), false);
  await none.markDone();
});

test('storage: out-of-range or non-integer steps are neither saved nor trusted', async () => {
  const session = fakeArea();
  const store = createOnboardingStore({ session: session.area });
  for (const bad of [-1, 99, 1.5, NaN, '2' as any]) await store.saveStep(bad);
  assert.equal(session.writes.length, 0);
  session.data.set(ONBOARDING_STEP_KEY, 99);
  assert.equal(await store.savedStep(), undefined);
  session.data.set(ONBOARDING_STEP_KEY, 4);
  assert.equal(await store.savedStep(), 4);
});

test('onboardingAreas reads the two extension areas and tolerates a missing or throwing API', () => {
  const local = fakeArea().area, session = fakeArea().area;
  assert.deepEqual(onboardingAreas({ storage: { local, session } }), { local, session });
  assert.deepEqual(onboardingAreas(undefined), {});
  assert.deepEqual(onboardingAreas({ get storage() { throw new Error('blocked'); } }), {});
});

test('a page report is trusted over the panel\'s own, possibly older, view of the page', async () => {
  // The panel still thinks it is on the home page when the page reports that the search page opened.
  const t = rig({ page: 'home', choices: ['hold'] });
  await t.intro.resume(INTRO_STEPS.indexOf('condition'));
  await t.intro.handlePageEvent({ op: 'condition', action: 'next', page: 'search' });
  await flush();
  assert.equal(t.intro.step, 'filters-offer');
  assert.deepEqual(t.pageCommands.at(-1), { op: 'filters-offer' });
});
