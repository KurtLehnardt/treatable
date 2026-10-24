import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useGuide, type GuideHost, type GuideViewModel } from '../src/use-guide';
import { ONBOARDING_FLAG_KEY, ONBOARDING_STEP_KEY, createOnboardingStore, type StorageAreaLike } from '../src/guide-state';
import { INTRO_STEPS, type IntroStepId } from '../src/guide-steps';
import type { PanelGuide } from '../src/guide-panel';
import type { PageGuideEvent } from '../src/guide-protocol';
import type { GuideChoice } from '../src/guide-mount';

const flush = async () => { for (let i = 0; i < 40; i++) await new Promise<void>(resolve => queueMicrotask(resolve)); };
const snap = (url: string) => ({ generation: url, url, nctIds: [], diagnostic: '', supported: true });

function fakeArea() {
  const data = new Map<string, unknown>();
  const area: StorageAreaLike = {
    async get(key) { return data.has(key) ? { [key]: data.get(key) } : {}; },
    async set(items) { for (const [k, v] of Object.entries(items)) data.set(k, v); },
    async remove(key) { data.delete(key); },
  };
  return { area, data };
}

function setup(options: { url?: string; done?: boolean; saved?: number; collapsed?: boolean } = {}) {
  const local = fakeArea(), session = fakeArea();
  if (options.done) local.data.set(ONBOARDING_FLAG_KEY, 1);
  if (options.saved !== undefined) session.data.set(ONBOARDING_STEP_KEY, options.saved);
  const store = createOnboardingStore({ local: local.area, session: session.area });
  const shown: IntroStepId[] = [];
  let closes = 0;
  const holds: Array<(choice: GuideChoice) => void> = [];
  const panel: PanelGuide = {
    show: id => { shown.push(id); return new Promise<GuideChoice>(resolve => holds.push(resolve)); },
    close: () => { closes++; },
  };
  const calls: Array<{ type: string; payload: unknown }> = [];
  const layouts: boolean[] = [];
  const listeners = new Set<(event: PageGuideEvent) => void>();
  const state = { url: options.url ?? 'https://clinicaltrials.gov/study/NCT01234567', collapsed: options.collapsed ?? false, connected: true };
  const host = (): GuideHost => ({
    connected: state.connected,
    snapshot: snap(state.url),
    collapsed: state.collapsed,
    layout: async value => { layouts.push(value); state.collapsed = value; },
    request: async (type, payload) => { calls.push({ type, payload }); return {}; },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  });
  let vm!: GuideViewModel;
  function Probe() { vm = useGuide(host(), { store, panel }); return null; }
  let renderer!: TestRenderer.ReactTestRenderer;
  return {
    local, session, shown, calls, layouts, holds, listeners, state,
    get vm() { return vm; },
    get closes() { return closes; },
    async mount() { await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); await flush(); }); },
    async rerender() { await act(async () => { renderer.update(React.createElement(Probe)); await flush(); }); },
    async emit(event: PageGuideEvent) { await act(async () => { for (const l of [...listeners]) l(event); await flush(); }); },
    async act(fn: () => void | Promise<void>) { await act(async () => { await fn(); await flush(); }); },
    async unmount() { await act(async () => { renderer.unmount(); await flush(); }); },
  };
}

test('first run: the tour starts by itself, once, at the welcome', async () => {
  const t = setup();
  await t.mount();
  assert.deepEqual(t.shown, ['welcome']);
  assert.equal(t.vm.active, true);
  await t.rerender();
  await t.rerender();
  assert.deepEqual(t.shown, ['welcome'], 'a re-render never starts it again');
  await t.unmount();
});

test('a browser that already finished the tour does not start it again, but Replay intro runs it from the start', async () => {
  const t = setup({ done: true });
  await t.mount();
  assert.deepEqual(t.shown, []);
  assert.equal(t.vm.active, false);
  await t.act(() => t.vm.replayIntro());
  assert.deepEqual(t.shown, ['welcome']);
  assert.equal(t.vm.active, true);
  await t.unmount();
});

test('after a page navigation the saved step number is resumed instead of starting over', async () => {
  const t = setup({ url: 'https://clinicaltrials.gov/study/NCT01234567', saved: INTRO_STEPS.indexOf('brief') });
  await t.mount();
  assert.deepEqual(t.shown, ['brief']);
  await t.unmount();
});

test('finishing the tour from the panel stores the done flag and removes the saved step', async () => {
  const t = setup();
  await t.mount();
  for (let i = 0; i < 12 && t.vm.active; i++) {
    const hold = t.holds.shift();
    if (!hold) break;
    await t.act(() => hold(t.shown.at(-1) === 'search-first' ? 'back' : 'next'));
  }
  assert.equal(t.vm.active, false);
  assert.equal(t.local.data.get(ONBOARDING_FLAG_KEY), 1);
  assert.equal(t.session.data.has(ONBOARDING_STEP_KEY), false);
  assert.deepEqual([...t.local.data.keys()], [ONBOARDING_FLAG_KEY], 'nothing else is stored');
  await t.unmount();
});

test('skipping at the welcome records it as seen so the tour does not return on the next open', async () => {
  const t = setup();
  await t.mount();
  await t.act(() => t.holds.shift()!('skip'));
  assert.equal(t.vm.active, false);
  assert.equal(t.local.data.get(ONBOARDING_FLAG_KEY), 1);
  await t.unmount();
  const next = setup({ done: true });
  await next.mount();
  assert.deepEqual(next.shown, []);
  await next.unmount();
});

test('the search help is offered on search pages only, shrinks the panel, runs the filters guide and restores the panel', async () => {
  const t = setup({ url: 'https://clinicaltrials.gov/search?cond=asthma', done: true, collapsed: false });
  await t.mount();
  assert.equal(t.vm.canSearchHelp, true);
  await t.act(() => t.vm.startSearchHelp());
  assert.deepEqual(t.layouts, [true]);
  assert.deepEqual(t.calls, [{ type: 'site.guide', payload: { command: { op: 'filters', intro: true } } }]);
  assert.equal(t.vm.active, true);
  assert.equal(t.vm.canSearchHelp, false, 'not offered again while it runs');
  await t.emit({ op: 'filters', action: 'done', page: 'search' });
  assert.deepEqual(t.layouts, [true, false], 'the panel returns to how it was');
  assert.equal(t.vm.active, false);
  assert.equal(t.local.data.size, 1, 'the search help stores nothing new');
  await t.unmount();
  const study = setup({ url: 'https://clinicaltrials.gov/study/NCT01234567', done: true });
  await study.mount();
  assert.equal(study.vm.canSearchHelp, false);
  await study.unmount();
  const home = setup({ url: 'https://clinicaltrials.gov/', done: true });
  await home.mount();
  assert.equal(home.vm.canSearchHelp, false);
  await home.unmount();
});

test('the search help leaves the panel collapsed if it started collapsed', async () => {
  const t = setup({ url: 'https://clinicaltrials.gov/search?cond=asthma', done: true, collapsed: true });
  await t.mount();
  await t.act(() => t.vm.startSearchHelp());
  await t.emit({ op: 'filters', action: 'skip', page: 'search' });
  assert.deepEqual(t.layouts, [true, true]);
  await t.unmount();
});

test('closing the panel stops the tour and the page guide without recording anything as finished', async () => {
  const t = setup();
  await t.mount();
  await t.unmount();
  assert.ok(t.closes >= 1);
  assert.deepEqual(t.calls.filter(call => (call.payload as any)?.command?.op === 'cancel').length > 0, true, 'the page guide is told to stop');
  assert.equal(t.local.data.has(ONBOARDING_FLAG_KEY), false);
});
