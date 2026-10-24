import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, type TestDom } from './dom-harness';
import { collapsedSearchPage, homePage, narrowSearchPage, searchPage, STATUS_LIVE, TYPE_LIVE } from './guide-fixtures';
import type { PageGuideEvent } from '../src/guide-protocol';
import type { GuideMount } from '../src/guide-mount';

const HIGHLIGHT = '[data-treatable-guide-highlight]';

async function rig(html: string, options: { findTimeoutMs?: number; isRendered?: (el: Element) => boolean; url?: string } = {}) {
  const env: TestDom = installDom(html, options.url);
  const { createPageGuide } = await import('../src/guide-page');
  const { createGuideMount, GUIDE_HOST_ATTRIBUTE } = await import('../src/guide-mount');
  const events: Array<Pick<PageGuideEvent, 'op' | 'action'>> = [];
  const pages: string[] = [];
  let mount: GuideMount | undefined;
  const guide = createPageGuide({
    doc: env.document,
    win: env.window,
    emit: event => { events.push({ op: event.op, action: event.action }); pages.push(event.page); },
    createMount: () => (mount = createGuideMount(env.document, { css: '', mode: 'open' })),
    env: { isRendered: options.isRendered ?? (() => true), findTimeoutMs: options.findTimeoutMs ?? 400, pollMs: 15 },
  });
  const root = () => mount?.host.shadowRoot ?? null;
  const title = () => root()?.querySelector('.swal2-title')?.textContent ?? '';
  const buttons = () => [...(root()?.querySelectorAll('button.swal2-styled') ?? [])].filter(b => (b as HTMLElement).style.display !== 'none').map(b => b.textContent);
  const press = (cls: 'confirm' | 'deny' | 'cancel') => (root()!.querySelector(`.swal2-${cls}`) as HTMLButtonElement).click();
  async function eventually(check: () => boolean, label: string, ms = 3000) {
    const start = Date.now();
    while (Date.now() - start < ms) { if (check()) return; await new Promise(r => setTimeout(r, 10)); }
    assert.fail(`timed out waiting for ${label}; title="${title()}"`);
  }
  const tick = (id: string) => {
    const input = env.document.getElementById(id) as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    // The site enables its Apply Filters button once a filter is staged.
    env.document.getElementById('apply-filters')?.removeAttribute('disabled');
  };
  const pressApply = () => { const apply = env.document.getElementById('apply-filters') as HTMLButtonElement; apply.setAttribute('disabled', ''); apply.dispatchEvent(new env.window.Event('click', { bubbles: true })); };
  const hostCount = () => env.document.querySelectorAll(`[${GUIDE_HOST_ATTRIBUTE}]`).length;
  const highlighted = () => [...env.document.querySelectorAll(HIGHLIGHT)].map(el => (el as HTMLElement).getAttribute('for') || el.id || el.tagName);
  /** Ends the guide and lets sweetalert2's own timers run out before the fake window goes away. */
  const close = async () => { guide.cancel(); await new Promise(r => setTimeout(r, 150)); env.teardown(); };
  return { env, guide, events, pages, root, title, buttons, press, eventually, tick, pressApply, hostCount, highlighted, close };
}

/** The page outside the guide's own host, for proving the guide leaves the site untouched. */
const pageMarkup = (env: TestDom) => {
  const clone = env.document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-treatable-guide-host]').forEach(host => host.remove());
  return clone.innerHTML;
};

test('Recruiting then Interventional: the guide waits for the person to tick each box and never ticks one itself', async () => {
  const t = await rig(searchPage());
  try {
    const before = pageMarkup(t.env);
    let clicks = 0;
    t.env.document.addEventListener('click', event => { if ((event.target as Element).closest('input, label')) clicks++; }, true);
    t.guide.run({ op: 'filters', intro: true });
    await t.eventually(() => t.title() === 'Find studies that are looking for people', 'intro');
    assert.deepEqual(t.buttons(), ['Start', 'Skip']);
    assert.equal(t.guide.active, true);
    t.press('confirm');
    await t.eventually(() => t.title() === 'Tick “Recruiting”', 'recruiting step');
    assert.deepEqual(t.buttons(), ['Skip'], 'only Skip: the person must tick the box');
    assert.deepEqual(t.highlighted(), ['adv-check0-status1']);
    assert.equal((t.env.document.getElementById('adv-check0-status1') as HTMLInputElement).checked, false, 'the guide did not tick it');
    assert.equal(t.root()!.querySelector('.swal2-popup')!.getAttribute('aria-modal'), 'false', 'non-blocking');
    // Ticking the lookalikes does not advance the guide.
    t.tick('adv-check0-status0');
    await new Promise(r => setTimeout(r, 80));
    assert.equal(t.title(), 'Tick “Recruiting”');
    t.tick('adv-check0-status1');
    await t.eventually(() => t.title() === 'Tick “Interventional”', 'type step');
    assert.deepEqual(t.highlighted(), ['adv-check0-studyType0'], 'the highlight moved');
    assert.match(t.root()!.textContent!, /Interventional studies test a treatment or other intervention/);
    assert.match(t.root()!.textContent!, /Observational studies watch what happens without giving a treatment/);
    assert.match(t.root()!.textContent!, /not medical advice/);
    assert.deepEqual(t.buttons(), ['Back', 'Skip']);
    t.tick('adv-check0-studyType0');
    await t.eventually(() => t.title() === 'Press “Apply Filters”', 'apply step');
    assert.deepEqual(t.highlighted(), ['apply-filters'], 'the site’s own Apply Filters button is pointed at');
    assert.deepEqual(t.buttons(), ['Done', 'Skip']);
    assert.equal(t.events.length, 0, 'not finished until the filters are applied');
    assert.equal(clicks, 0);
    t.pressApply();
    await t.eventually(() => t.title() === 'All set', 'confirmation');
    assert.deepEqual(t.events, [{ op: 'filters', action: 'done' }]);
    assert.deepEqual(t.highlighted(), [], 'no highlight is left after the last box');
    assert.equal(t.guide.active, false, 'the confirmation no longer counts as the guide being in the way');
    t.guide.cancel();
    assert.equal(t.hostCount(), 0);
    assert.equal(clicks, 0, 'the guide never clicked a page checkbox or label');
    assert.equal(pageMarkup(t.env).replace(/ checked=""/g, '').replace(/\s+style=""/g, ''), before.replace(/ checked=""/g, ''), 'the page markup is back to how it was apart from the ticks the person made');
    assert.doesNotMatch(t.env.document.body.className + t.env.document.documentElement.className, /swal2/);
  } finally { await t.close(); }
});

test('a box that is already ticked is reported and the guide moves on', async () => {
  const t = await rig(searchPage());
  try {
    (t.env.document.getElementById('adv-check0-status1') as HTMLInputElement).checked = true;
    t.guide.run({ op: 'filters', intro: false });
    await t.eventually(() => t.title() === 'Recruiting is already ticked', 'already ticked');
    assert.deepEqual(t.highlighted(), []);
    t.press('confirm');
    await t.eventually(() => t.title() === 'Tick “Interventional”', 'type step');
  } finally { await t.close(); }
});

test('Back from the Study Type step returns to Study Status', async () => {
  const t = await rig(searchPage());
  try {
    (t.env.document.getElementById('adv-check0-status1') as HTMLInputElement).checked = true;
    t.guide.run({ op: 'filters', intro: false });
    await t.eventually(() => t.title() === 'Recruiting is already ticked', 'status');
    t.press('confirm');
    await t.eventually(() => t.title() === 'Tick “Interventional”', 'type');
    t.press('deny');
    await t.eventually(() => t.title() === 'Recruiting is already ticked', 'back to status');
  } finally { await t.close(); }
});

test('Skip ends the guide cleanly: highlights gone, host removed, one skip event, nothing ticked', async () => {
  const t = await rig(searchPage());
  try {
    const before = pageMarkup(t.env);
    t.guide.run({ op: 'filters', intro: false });
    await t.eventually(() => t.title() === 'Tick “Recruiting”', 'status');
    assert.equal(t.highlighted().length, 1);
    t.press('cancel');
    await t.eventually(() => t.events.length === 1, 'skip event');
    assert.deepEqual(t.events, [{ op: 'filters', action: 'skip' }]);
    assert.equal(t.hostCount(), 0);
    assert.deepEqual(t.highlighted(), []);
    assert.equal(t.guide.active, false);
    assert.equal(pageMarkup(t.env), before, 'the page is exactly as it was');
    const label = t.env.document.querySelector('label[for="adv-check0-status1"]') as HTMLElement;
    assert.equal(label.getAttribute('style'), null, 'inline highlight styles are removed, not just emptied');
  } finally { await t.close(); }
});

test('cancel (for example when Treatable closes) removes everything without reporting', async () => {
  const t = await rig(searchPage());
  try {
    t.guide.run({ op: 'filters', intro: false });
    await t.eventually(() => t.title() === 'Tick “Recruiting”', 'status');
    t.guide.cancel();
    assert.equal(t.hostCount(), 0);
    assert.deepEqual(t.highlighted(), []);
    assert.deepEqual(t.events, []);
    t.tick('adv-check0-status1');
    await new Promise(r => setTimeout(r, 80));
    assert.equal(t.hostCount(), 0, 'a cancelled guide stays quiet');
  } finally { await t.close(); }
});

test('a missing box shows plain text instructions instead of failing', async () => {
  const t = await rig(searchPage({ status: '<div class="filter-group"><legend class="group-title">Study Status</legend></div>' }), { findTimeoutMs: 150 });
  try {
    t.guide.run({ op: 'filters', intro: false });
    await t.eventually(() => t.title() === 'Find “Recruiting” yourself', 'plain instructions');
    assert.match(t.root()!.textContent!, /Look for the Study Status list and tick Recruiting yourself/);
    assert.deepEqual(t.highlighted(), []);
    assert.deepEqual(t.buttons(), ['Next', 'Skip']);
    t.press('confirm');
    await t.eventually(() => t.title() === 'Tick “Interventional”', 'continues to the next box');
  } finally { await t.close(); }
});

test('a late-rendered filter is picked up without a timeout message', async () => {
  const t = await rig(searchPage(), { findTimeoutMs: 1500 });
  try {
    const group = t.env.document.getElementById('adv-check-status')!.closest('.filter-group')!;
    const parent = group.parentElement!;
    const next = group.nextSibling;
    group.remove();
    t.guide.run({ op: 'filters', intro: false });
    await new Promise(r => setTimeout(r, 120));
    assert.equal(t.title(), '', 'still waiting quietly');
    parent.insertBefore(group, next);
    await t.eventually(() => t.title() === 'Tick “Recruiting”', 'late filter');
    assert.deepEqual(t.highlighted(), ['adv-check0-status1']);
  } finally { await t.close(); }
});

test('collapsed wide panel: the Show button is highlighted and the guide continues when the filters appear', async () => {
  const t = await rig(collapsedSearchPage());
  try {
    t.guide.run({ op: 'filters', intro: false });
    await t.eventually(() => t.title() === 'Open the filters first', 'collapsed path');
    const show = t.env.document.querySelector('ctg-focus-your-search-panel button') as HTMLElement;
    assert.deepEqual(t.highlighted(), ['BUTTON']);
    assert.ok(show.hasAttribute('data-treatable-guide-highlight'), 'the toggle is the highlighted control');
    assert.deepEqual(t.buttons(), ['Skip']);
    // The site re-renders the panel when the person presses Show.
    const main = t.env.document.getElementById('app')!;
    main.innerHTML = searchPage().match(/<main id="app">([\s\S]*)<\/main>/)![1];
    await t.eventually(() => t.title() === 'Tick “Recruiting”', 'continues once the filters show');
    assert.deepEqual(t.highlighted(), ['adv-check0-status1'], 'the toggle highlight is gone');
  } finally { await t.close(); }
});

test('hiding the filters panel while waiting for a tick leads to the open-the-filters message, then carries on', async () => {
  const t = await rig(searchPage());
  try {
    t.guide.run({ op: 'filters', intro: false });
    await t.eventually(() => t.title() === 'Tick “Recruiting”', 'status');
    const main = t.env.document.getElementById('app')!;
    const open = main.innerHTML;
    main.innerHTML = '<ctg-focus-your-search-panel><div class="filters-panel"><div class="filters-panel-header"><div class="show-hide-container"><button class="usa-button usa-button--unstyled expand-button"><span>Show</span></button></div></div></div></ctg-focus-your-search-panel>';
    await t.eventually(() => t.title() === 'Open the filters first', 'hidden panel noticed');
    assert.deepEqual(t.highlighted(), ['BUTTON']);
    main.innerHTML = open;
    await t.eventually(() => t.title() === 'Tick “Recruiting”', 'back to the tick step');
    assert.deepEqual(t.highlighted(), ['adv-check0-status1']);
    t.tick('adv-check0-status1');
    await t.eventually(() => t.title() === 'Tick “Interventional”', 'moves on after the tick');
  } finally { await t.close(); }
});

test('narrow screen: the Focus Your Search button is highlighted until the drawer opens', async () => {
  const hidden = (el: Element) => !el.closest('.is-hidden');
  const t = await rig(narrowSearchPage(), { isRendered: hidden });
  try {
    t.guide.run({ op: 'filters', intro: false });
    await t.eventually(() => t.title() === 'Open the filters first', 'drawer closed');
    const toggle = t.env.document.querySelector('button[aria-controls="focus-your-search-modal"]') as HTMLElement;
    assert.ok(toggle.hasAttribute('data-treatable-guide-highlight'));
    // The site opens its modal when the toggle is pressed.
    t.env.document.getElementById('focus-your-search-modal')!.classList.remove('is-hidden');
    await t.eventually(() => t.title() === 'Tick “Recruiting”', 'drawer opened');
    assert.ok(!toggle.hasAttribute('data-treatable-guide-highlight'));
  } finally { await t.close(); }
});

test('hidden filters with no toggle at all still get a plain "open the filters" message and keep waiting', async () => {
  const t = await rig(searchPage(), { isRendered: el => !el.closest('#panel-body'), findTimeoutMs: 120 });
  try {
    t.guide.run({ op: 'filters', intro: false });
    await t.eventually(() => t.title() === 'Open the filters first', 'plain message');
    assert.match(t.root()!.textContent!, /Focus Your Search, Filters or Show/);
    assert.deepEqual(t.highlighted(), []);
  } finally { await t.close(); }
});

test('leaving the search page ends the filters guide with an unavailable report and no leftovers', async () => {
  const t = await rig(searchPage());
  try {
    t.guide.run({ op: 'filters', intro: false });
    await t.eventually(() => t.title() === 'Tick “Recruiting”', 'status');
    t.env.window.history.pushState({}, '', '/study/NCT01234567');
    await t.eventually(() => t.events.length === 1, 'report');
    assert.deepEqual(t.events, [{ op: 'filters', action: 'unavailable' }]);
    assert.equal(t.hostCount(), 0);
    assert.deepEqual(t.highlighted(), []);
  } finally { await t.close(); }
});

test('the Condition/disease step highlights the field on the home page and moves on by itself when the search page opens', async () => {
  const t = await rig(homePage(), { url: 'https://clinicaltrials.gov/' });
  try {
    t.guide.run({ op: 'condition', canGoBack: true });
    await t.eventually(() => t.title() === 'Type your condition here', 'condition step');
    assert.deepEqual(t.highlighted(), ['advcond']);
    assert.match(t.root()!.textContent!, /sent to ClinicalTrials\.gov as a normal site search/);
    assert.match(t.root()!.textContent!, /Location box/);
    assert.deepEqual(t.buttons(), ['Next', 'Back', 'Skip']);
    assert.equal((t.env.document.getElementById('advcond') as HTMLInputElement).value, '', 'the guide typed nothing');
    t.env.window.history.pushState({}, '', '/search?cond=asthma');
    await t.eventually(() => t.events.length === 1, 'auto advance');
    assert.deepEqual(t.events, [{ op: 'condition', action: 'next' }]);
    assert.deepEqual(t.pages, ['search'], 'the report says which kind of page the person is now on');
    assert.equal(t.hostCount(), 0);
    assert.deepEqual(t.highlighted(), []);
  } finally { await t.close(); }
});

test('the Condition/disease step on the search page: Next and Back report, and Back is optional', async () => {
  const t = await rig(searchPage());
  try {
    t.guide.run({ op: 'condition', canGoBack: false });
    await t.eventually(() => t.title() === 'Type your condition here', 'condition step');
    assert.deepEqual(t.buttons(), ['Next', 'Skip']);
    t.press('confirm');
    await t.eventually(() => t.events.length === 1, 'next');
    assert.deepEqual(t.events, [{ op: 'condition', action: 'next' }]);
    t.guide.run({ op: 'condition', canGoBack: true });
    await t.eventually(() => t.title() === 'Type your condition here', 'again');
    t.press('deny');
    await t.eventually(() => t.events.length === 2, 'back');
    assert.deepEqual(t.events[1], { op: 'condition', action: 'back' });
  } finally { await t.close(); }
});

test('a missing Condition/disease field gives plain instructions', async () => {
  const t = await rig('<!doctype html><html><body><main></main></body></html>', { findTimeoutMs: 120 });
  try {
    t.guide.run({ op: 'condition', canGoBack: false });
    await t.eventually(() => t.title() === 'Type your condition in the search box', 'plain instructions');
    assert.deepEqual(t.highlighted(), []);
    t.press('cancel');
    await t.eventually(() => t.events.length === 1, 'skip');
    assert.deepEqual(t.events, [{ op: 'condition', action: 'skip' }]);
  } finally { await t.close(); }
});

test('the filters offer maps Yes, No thanks and Skip to distinct reports', async () => {
  const t = await rig(searchPage());
  try {
    for (const [button, action] of [['confirm', 'next'], ['deny', 'decline'], ['cancel', 'skip']] as const) {
      t.guide.run({ op: 'filters-offer' });
      await t.eventually(() => t.title() === 'Want help choosing filters?', 'offer');
      t.press(button);
      await t.eventually(() => t.events.length > 0, 'report');
      assert.deepEqual(t.events.pop(), { op: 'filters-offer', action });
    }
  } finally { await t.close(); }
});

test('the open-a-study step waits for a study page and then reports next', async () => {
  const t = await rig(searchPage());
  try {
    t.guide.run({ op: 'results' });
    await t.eventually(() => t.title() === 'Open a study you are interested in', 'results step');
    assert.deepEqual(t.buttons(), ['Back', 'Skip']);
    t.env.window.history.pushState({}, '', '/study/NCT01234567');
    await t.eventually(() => t.events.length === 1, 'opened');
    assert.deepEqual(t.events, [{ op: 'results', action: 'next' }]);
    assert.equal(t.hostCount(), 0);
  } finally { await t.close(); }
});

test('a new command replaces the running one without reporting the old one', async () => {
  const t = await rig(searchPage());
  try {
    t.guide.run({ op: 'filters', intro: false });
    await t.eventually(() => t.title() === 'Tick “Recruiting”', 'status');
    t.guide.run({ op: 'results' });
    await t.eventually(() => t.title() === 'Open a study you are interested in', 'replaced');
    assert.deepEqual(t.events, []);
    assert.deepEqual(t.highlighted(), []);
    assert.equal(t.hostCount(), 1);
  } finally { await t.close(); }
});

test('the Apply Filters step ends with Done or Skip, or when the address changes after the site applies the filters', async () => {
  for (const [how, action] of [['done', 'done'], ['skip', 'skip'], ['url', 'done']] as const) {
    const t = await rig(searchPage());
    try {
      t.tick('adv-check0-status1'); t.tick('adv-check0-studyType0');
      t.guide.run({ op: 'filters', intro: false });
      await t.eventually(() => t.title() === 'Recruiting is already ticked', 'status');
      t.press('confirm');
      await t.eventually(() => t.title() === 'Interventional is already ticked', 'type');
      t.press('confirm');
      await t.eventually(() => t.title() === 'Press “Apply Filters”', 'apply step');
      if (how === 'done') t.press('confirm');
      else if (how === 'skip') t.press('cancel');
      else t.env.window.history.pushState({}, '', '/search?cond=asthma&aggFilters=status:rec,studyType:int');
      await t.eventually(() => t.events.length === 1, 'report');
      assert.deepEqual(t.events, [{ op: 'filters', action }], how);
      assert.deepEqual(t.highlighted(), [], how + ': highlight removed');
    } finally { await t.close(); }
  }
});

test('with nothing staged, the Apply Filters button is not pointed at', async () => {
  const t = await rig(searchPage());
  try {
    (t.env.document.getElementById('adv-check0-status1') as HTMLInputElement).checked = true;
    (t.env.document.getElementById('adv-check0-studyType0') as HTMLInputElement).checked = true;
    t.guide.run({ op: 'filters', intro: false });
    await t.eventually(() => t.title() === 'Recruiting is already ticked', 'status');
    t.press('confirm');
    await t.eventually(() => t.title() === 'Interventional is already ticked', 'type');
    t.press('confirm');
    await t.eventually(() => t.title() === 'All set', 'straight to the confirmation');
    assert.deepEqual(t.highlighted(), []);
  } finally { await t.close(); }
});

test('a step that starts while the closing confirmation is still showing is not torn down by the old one', async () => {
  const t = await rig(searchPage());
  try {
    (t.env.document.getElementById('adv-check0-status1') as HTMLInputElement).checked = true;
    (t.env.document.getElementById('adv-check0-studyType0') as HTMLInputElement).checked = true;
    t.guide.run({ op: 'filters', intro: false });
    await t.eventually(() => t.title() === 'Recruiting is already ticked', 'status');
    t.press('confirm');
    await t.eventually(() => t.title() === 'Interventional is already ticked', 'type');
    t.press('confirm');
    await t.eventually(() => t.title() === 'All set', 'confirmation');
    t.guide.run({ op: 'results' });
    await t.eventually(() => t.title() === 'Open a study you are interested in', 'next step');
    await new Promise(r => setTimeout(r, 150));
    assert.equal(t.title(), 'Open a study you are interested in', 'the older run did not remove the newer dialog');
    assert.equal(t.hostCount(), 1);
  } finally { await t.close(); }
});

test('the whole guide makes no network call and writes no storage or cookie', async () => {
  const t = await rig(searchPage());
  const calls: string[] = [];
  const g = globalThis as any;
  const saved = { fetch: g.fetch, XMLHttpRequest: g.XMLHttpRequest, WebSocket: g.WebSocket, EventSource: g.EventSource };
  g.fetch = () => { calls.push('fetch'); return Promise.reject(new Error('no network')); };
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource']) g[name] = function () { calls.push(name); throw new Error('no network'); };
  const win = t.env.window;
  win.fetch = g.fetch;
  win.navigator.sendBeacon = () => { calls.push('sendBeacon'); return false; };
  const cookieBefore = t.env.document.cookie;
  try {
    t.guide.run({ op: 'filters', intro: true });
    await t.eventually(() => t.title() === 'Find studies that are looking for people', 'intro');
    t.press('confirm');
    await t.eventually(() => t.title() === 'Tick “Recruiting”', 'status');
    t.tick('adv-check0-status1');
    await t.eventually(() => t.title() === 'Tick “Interventional”', 'type');
    t.tick('adv-check0-studyType0');
    await t.eventually(() => t.title() === 'Press “Apply Filters”', 'apply');
    t.pressApply();
    await t.eventually(() => t.title() === 'All set', 'done');
    t.guide.cancel();
    assert.deepEqual(calls, []);
    assert.equal(win.localStorage.length, 0);
    assert.equal(win.sessionStorage.length, 0);
    assert.equal(t.env.document.cookie, cookieBefore);
  } finally {
    Object.assign(g, saved);
    await t.close();
  }
});

test('the guide only ever uses the lookalike-safe finders: STATUS and TYPE fixtures stay intact', () => {
  assert.match(STATUS_LIVE, /adv-check0-status1/);
  assert.match(TYPE_LIVE, /adv-check0-studyType0/);
});
