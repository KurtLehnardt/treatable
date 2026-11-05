import test, {before, after, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {installDom, settle, type TestDom} from './dom-harness';
import type {OverlayViewModel, UnsavedWorkHost} from '../src/overlay-types';

/**
 * Escape and the Close control ask first, but only when closing would throw away something the person typed.
 * These tests run in a real (jsdom) document because the confirmation is a sweetalert2 dialog.
 */
let env: TestDom, createRoot: typeof import('react-dom/client').createRoot, OverlayView: typeof import('../src/overlay-view').OverlayView;
const snapshot = {generation: 'page-1', url: 'https://clinicaltrials.gov/search?cond=Fibromyalgia', nctIds: ['NCT00000001'], diagnostic: '', supported: true};
type Vm = OverlayViewModel & UnsavedWorkHost;
let counts = {closed: 0, collapsed: [] as boolean[]};
function view(overrides: Partial<Vm> = {}): Vm {
  return {connected: true, ended: false, busy: false, error: '', snapshot, opacity: .9, collapsed: false, setOpacity() {}, setCollapsed: value => {counts.collapsed.push(value)}, restore() {}, close: () => {counts.closed++}, ...overrides};
}
let mounted: Array<() => Promise<void>> = [];
async function mountView(vm: Vm, extra: Record<string, unknown> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {root.render(React.createElement(OverlayView, {vm, ...extra}))});
  mounted.push(async () => {await act(async () => {root.unmount()}); container.remove()});
  return {container, rerender: (next: Vm, nextExtra: Record<string, unknown> = extra) => act(async () => {root.render(React.createElement(OverlayView, {vm: next, ...nextExtra}))})};
}
/** Stands in for the study section: only its heading matters to the focus rules. */
const studySection = (key = 'study') => React.createElement('h2', {id: 'apply-heading', tabIndex: -1, key}, 'Understand this study');
const escape = (target: EventTarget = window, init: KeyboardEventInit = {}) => target.dispatchEvent(new (window as any).KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true, ...init}));
const popup = () => document.querySelector('.swal2-popup') as HTMLElement | null;
const dialogs = () => document.querySelectorAll('.swal2-popup').length;
const button = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
const CLOSE = 'Close Treatable and end session';
/** Long enough for sweetalert2 to hand focus back to the control that had it (it waits 100 ms). */
const later = () => settle(40);

before(async () => {
  env = installDom('<!doctype html><html><head></head><body></body></html>', 'https://clinicaltrials.gov/study/NCT00000001');
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom does no layout, so every element reports zero size and sweetalert2 treats its own buttons as hidden. Report a size instead.
  env.window.scrollTo = () => {};
  for (const property of ['offsetWidth', 'offsetHeight']) Object.defineProperty(env.window.HTMLElement.prototype, property, {configurable: true, get: () => 100});
  ({createRoot} = await import('react-dom/client'));
  ({OverlayView} = await import('../src/overlay-view'));
});
afterEach(async () => {
  for (const unmount of mounted.reverse()) await unmount();
  mounted = [];
  await later();
  counts = {closed: 0, collapsed: []};
  document.body.innerHTML = '';
});
after(() => {delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; env.teardown()});

test('Escape with nothing typed closes at once, with no dialog', async () => {
  await mountView(view({hasUnsavedWork: () => false}));
  await act(async () => {escape()});
  await settle();
  assert.equal(counts.closed, 1);
  assert.equal(dialogs(), 0);
});

test('a host that does not report unsaved work keeps the old behavior: Escape and Close both close at once', async () => {
  await mountView(view());
  await act(async () => {escape()});
  await act(async () => {button(CLOSE).click()});
  await settle();
  assert.equal(counts.closed, 2);
  assert.equal(dialogs(), 0);
});

test('Escape with typed work asks first; Keep working leaves everything as it was and returns focus', async () => {
  await mountView(view({hasUnsavedWork: () => true}));
  const field = button('Treatable settings');
  field.focus();
  assert.ok(document.activeElement === field);
  await act(async () => {escape(field)});
  await settle();
  const dialog = popup()!;
  assert.ok(dialog, 'a confirmation dialog is shown');
  assert.equal(counts.closed, 0, 'nothing is closed while asking');
  assert.match(dialog.textContent!, /Close Treatable and clear what you typed\?/);
  assert.match(dialog.textContent!, /cannot be brought back/);
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.ok(dialog.contains(document.activeElement), 'focus moves into the dialog');
  assert.equal(document.activeElement!.textContent, 'Keep working', 'the safe button has focus, so Enter does not clear anything');
  await act(async () => {(dialog.querySelector('.swal2-cancel') as HTMLButtonElement).click()});
  await later();
  assert.equal(counts.closed, 0, 'Cancel keeps the session');
  assert.deepEqual(counts.collapsed, []);
  assert.equal(dialogs(), 0, 'the dialog is gone');
  assert.ok(document.activeElement === field, 'focus returns to the control that had it');
  assert.equal(document.querySelectorAll('main').length, 1, 'the overlay is still there');
});

const OTHER = 'Search for other studies on ClinicalTrials.gov';
const link = () => [...document.querySelectorAll('button')].find(node => node.textContent === OTHER) as HTMLButtonElement | undefined;
test('study page: the search link goes straight to the website search when nothing was typed', async () => {
  let opened = 0;
  await mountView(view({study: {nctId: 'NCT00000001'}, guide: {active: false, canSearchHelp: false, startSearchHelp() {}, replayIntro() {}, stop() {}, openSearch: () => {opened++}} as any, hasUnsavedWork: () => false}));
  assert.ok(link(), 'the link is on the study page');
  await act(async () => {link()!.click()});
  await settle();
  assert.equal(opened, 1);
  assert.equal(dialogs(), 0);
});

test('study page: with typed work the search link asks first; Keep working stays, Leave and clear goes', async () => {
  let opened = 0;
  await mountView(view({study: {nctId: 'NCT00000001'}, guide: {active: false, canSearchHelp: false, startSearchHelp() {}, replayIntro() {}, stop() {}, openSearch: () => {opened++}} as any, hasUnsavedWork: () => true}));
  await act(async () => {link()!.click()});
  await settle();
  assert.equal(opened, 0, 'nothing happens while asking');
  assert.match(popup()!.textContent!, /Leave this study and clear what you typed\?/);
  assert.match(popup()!.textContent!, /cannot be brought back/);
  await act(async () => {(popup()!.querySelector('.swal2-cancel') as HTMLButtonElement).click()});
  await later();
  assert.equal(opened, 0, 'Keep working leaves the study as it was');
  assert.equal(counts.closed, 0);
  await act(async () => {link()!.click()});
  await settle();
  await act(async () => {(popup()!.querySelector('.swal2-confirm') as HTMLButtonElement).click()});
  await later();
  assert.equal(opened, 1, 'confirming goes to the search page');
  assert.equal(counts.closed, 0, 'it does not close the overlay');
});

test('the search link is only on study pages', async () => {
  await mountView(view({guide: {active: false, canSearchHelp: false, startSearchHelp() {}, replayIntro() {}, stop() {}, openSearch() {}} as any}));
  assert.equal(link(), undefined);
});

test('Confirm closes and ends the session', async () => {
  await mountView(view({hasUnsavedWork: () => true}));
  await act(async () => {escape()});
  await settle();
  assert.equal(counts.closed, 0);
  await act(async () => {(popup()!.querySelector('.swal2-confirm') as HTMLButtonElement).click()});
  await later();
  assert.equal(counts.closed, 1);
  assert.equal(dialogs(), 0);
});

test('Escape inside the dialog cancels it: the overlay stays open, no second dialog opens, and it is not closed by the same key press', async () => {
  await mountView(view({hasUnsavedWork: () => true}));
  await act(async () => {escape()});
  await settle();
  assert.equal(dialogs(), 1);
  const outer: string[] = [];
  const spy = () => {outer.push('window bubble')};
  window.addEventListener('keydown', spy);
  try {
    await act(async () => {escape(document.activeElement!)});
    await later();
    assert.deepEqual(outer, [], 'the Escape that dismisses the dialog never reaches other window handlers');
  } finally {window.removeEventListener('keydown', spy)}
  assert.equal(dialogs(), 0, 'the dialog closed');
  assert.equal(counts.closed, 0, 'the overlay is not closed');
  assert.deepEqual(counts.collapsed, []);
});

test('Escape while the dialog is open but focus is elsewhere also only cancels the dialog', async () => {
  await mountView(view({hasUnsavedWork: () => true}));
  await act(async () => {escape()});
  await settle();
  assert.equal(dialogs(), 1);
  (document.activeElement as HTMLElement).blur();
  await act(async () => {escape(document.body)});
  await later();
  assert.equal(dialogs(), 0);
  assert.equal(counts.closed, 0);
});

test('a held Escape key (auto-repeat) neither opens the dialog again nor closes the overlay', async () => {
  await mountView(view({hasUnsavedWork: () => true}));
  await act(async () => {escape(window, {repeat: true})});
  await settle();
  assert.equal(dialogs(), 0);
  assert.equal(counts.closed, 0);
});

test('a second Escape press while the dialog is open cancels it: it neither opens another dialog nor closes the overlay', async () => {
  await mountView(view({hasUnsavedWork: () => true}));
  await act(async () => {escape(); escape()});
  await settle();
  assert.equal(dialogs(), 0);
  assert.equal(counts.closed, 0);
  await later();
  await act(async () => {escape()});
  await settle();
  assert.equal(dialogs(), 1, 'asking works again afterwards');
  assert.equal(counts.closed, 0);
});

test('the Close control asks the same way: Keep working cancels, Close and clear ends the session, and a clean session closes at once', async () => {
  let dirty = true;
  await mountView(view({hasUnsavedWork: () => dirty}));
  await act(async () => {button(CLOSE).click()});
  await settle();
  assert.ok(popup(), 'the Close control asks');
  assert.equal(counts.closed, 0);
  await act(async () => {(popup()!.querySelector('.swal2-cancel') as HTMLButtonElement).click()});
  await later();
  assert.equal(counts.closed, 0, 'Cancel keeps the session');
  assert.equal(dialogs(), 0);
  await act(async () => {button(CLOSE).click()});
  await settle();
  await act(async () => {(popup()!.querySelector('.swal2-confirm') as HTMLButtonElement).click()});
  await later();
  assert.equal(counts.closed, 1, 'Confirm closes');
  dirty = false;
  await act(async () => {button(CLOSE).click()});
  await settle();
  assert.equal(counts.closed, 2, 'with nothing typed the Close control closes immediately');
  assert.equal(dialogs(), 0);
});

test('Escape inside the dialog cancels a Close-control confirmation too', async () => {
  await mountView(view({hasUnsavedWork: () => true}));
  await act(async () => {button(CLOSE).click()});
  await settle();
  assert.equal(dialogs(), 1);
  await act(async () => {escape(document.activeElement!)});
  await later();
  assert.equal(dialogs(), 0);
  assert.equal(counts.closed, 0);
});

test('Escape closes the settings panel first, and only the next Escape asks about closing', async () => {
  await mountView(view({hasUnsavedWork: () => true}));
  await act(async () => {button('Treatable settings').click()});
  assert.ok(document.getElementById('treatable-settings'));
  await act(async () => {escape()});
  await settle();
  assert.ok(!document.getElementById('treatable-settings'));
  assert.equal(dialogs(), 0);
  await act(async () => {escape()});
  await settle();
  assert.equal(dialogs(), 1);
  assert.equal(counts.closed, 0);
});

test('a collapsed frame is expanded to ask, and collapsed again if the person keeps working', async () => {
  await mountView(view({hasUnsavedWork: () => true, collapsed: true}));
  await act(async () => {escape()});
  await settle();
  assert.deepEqual(counts.collapsed, [false], 'the small frame is opened so the dialog is not clipped');
  assert.ok(popup());
  await act(async () => {(popup()!.querySelector('.swal2-cancel') as HTMLButtonElement).click()});
  await later();
  assert.deepEqual(counts.collapsed, [false, true], 'Keep working puts the frame back as it was');
  assert.equal(counts.closed, 0);
  await act(async () => {escape()});
  await settle();
  await act(async () => {(popup()!.querySelector('.swal2-confirm') as HTMLButtonElement).click()});
  await later();
  assert.equal(counts.closed, 1);
  assert.deepEqual(counts.collapsed, [false, true, false], 'a confirmed close is not collapsed again');
});

test('if the session ends while the dialog is open, the dialog goes away without closing anything twice', async () => {
  const shown = view({hasUnsavedWork: () => true});
  const {rerender} = await mountView(shown);
  await act(async () => {escape()});
  await settle();
  assert.equal(dialogs(), 1);
  await rerender({...shown, ended: true});
  await later();
  assert.equal(dialogs(), 0);
  assert.equal(counts.closed, 0);
});

test('unmounting the overlay removes an open dialog', async () => {
  await mountView(view({hasUnsavedWork: () => true}));
  await act(async () => {escape()});
  await settle();
  assert.equal(dialogs(), 1);
  for (const unmount of mounted.reverse()) await unmount();
  mounted = [];
  await later();
  assert.equal(dialogs(), 0);
  assert.equal(counts.closed, 0);
});

test('the dialog follows the overlay theme and its text is plain text', async () => {
  await mountView(view({hasUnsavedWork: () => true, theme: 'dark'}));
  await act(async () => {escape()});
  await settle();
  assert.equal((document.querySelector('.swal2-container') as HTMLElement).getAttribute('data-swal2-theme'), 'dark');
  assert.equal(popup()!.querySelectorAll('img:not(.swal2-image), script').length, 0);
  await act(async () => {escape(document.activeElement!)});
  await later();
});

test('the packaged stylesheet is used, so the frame needs no style element', async () => {
  const {readFileSync} = await import('node:fs');
  const build = readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.match(build, /guide-swal-css/);
  const source = readFileSync(new URL('../src/confirm-close.ts', import.meta.url), 'utf8');
  assert.match(source, /adoptedStyleSheets/, 'a constructed stylesheet is tried first because the extension page policy forbids style elements');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|chrome\.storage/, 'the dialog stores nothing');
});

/* The whole production overlay: typed fields, edited drafts and "Your details" make Escape and Close ask; nothing typed does not. */
const ID = 'NCT99999990';
const rawStudy = () => ({protocolSection: {identificationModule: {nctId: ID, briefTitle: 'Synthetic public study for the close confirmation', orgStudyIdInfo: {id: 'SYNTHETIC-ONLY'}}, descriptionModule: {briefSummary: 'A public synthetic fixture.', detailedDescription: 'Two treatments are spaced 4 weeks apart. Follow-up visits occur at 3 and 12 months post injection.'}, designModule: {designInfo: {allocation: 'RANDOMIZED'}}, statusModule: {overallStatus: 'RECRUITING'}, eligibilityModule: {}, contactsLocationsModule: {centralContacts: [{name: 'Study Coordinator', phone: '303-555-0100', email: 'coordinator@example.org'}], locations: [{facility: 'Synthetic Clinic', status: 'RECRUITING', city: 'Example City', state: 'Colorado', country: 'United States', contacts: []}]}}});
class Events {listeners: Array<(v?: any) => void> = []; addListener = (f: (v?: any) => void) => {this.listeners.push(f)}; emit = (v?: any) => {for (const f of [...this.listeners]) f(v)}}
/** `tour: false` marks the first-run intro as already seen (the default); `tour: true` lets it start and show its first dialog.
 * `step` is the study step opened after loading, through the step list; the email step (the default) holds the typed fields. */
async function mountAssistant({tour = false, step = 'Email'}: {tour?: boolean; step?: 'Understand' | 'Contact' | 'Email'} = {}) {
  const {captureSiteActivations} = await import('../src/overlay-port');
  const {OverlayAssistant} = await import('../src/overlay-app');
  const {normalizeApplyRecord, normalizeStudyBrief} = await import('../shared/apply-record.mjs');
  const now = Date.now(), messages = new Events(), sent: any[] = [];
  const sitePort: any = {onMessage: messages, onDisconnect: new Events(), disconnect() {}, postMessage(v: any) {
    sent.push(v);
    if (v.type === 'site.authenticate') messages.emit({type: 'site.ready', snapshot: {generation: 'g', url: `https://clinicaltrials.gov/study/${ID}`, nctIds: [], diagnostic: '', supported: true}, study: {nctId: ID}});
    else messages.emit({id: v.id, ok: true, result: {active: true}});
  }};
  const applyPort: any = {onMessage: new Events(), onDisconnect: new Events(), disconnect() {}, postMessage(v: any) {
    if (v.kind === 'studyBriefRecord') queueMicrotask(() => applyPort.onMessage.emit({reply: {id: v.id, type: 'briefRecords', ok: true, records: [normalizeApplyRecord(rawStudy(), now)], briefs: [normalizeStudyBrief(rawStudy(), now)], purposes: ['A public synthetic fixture.']}}));
  }};
  const runtime = {connect: ({name}: {name: string}) => {
    if (name === 'treatable.site.overlay.v1') return sitePort;
    if (name === 'treatable-apply-v1') {queueMicrotask(() => applyPort.onMessage.emit({kind: 'applyReady', nctId: ID, nctIds: [ID], expiresAt: now + 300000, studies: [{nctId: ID, title: 'Synthetic study'}]})); return applyPort}
    throw new Error('unexpected port ' + name);
  }, sendMessage: async () => ({ok: true}), getURL: (path: string) => `chrome-extension://test/${path}`};
  /* The stored intro version must be the current one to count as seen; an older one replays the intro. */
  const {ONBOARDING_VERSION} = await import('../src/guide-steps');
  const local = {get: async (key: string) => (tour ? {} : {[key]: ONBOARDING_VERSION}), set: async () => {}, remove: async () => {}};
  Object.defineProperty(globalThis, 'chrome', {configurable: true, value: {runtime, storage: {local, session: {get: async () => ({}), set: async () => {}, remove: async () => {}}}}});
  captureSiteActivations(window);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push(async () => {await act(async () => {root.unmount()}); container.remove(); delete (globalThis as any).chrome});
  await act(async () => {
    root.render(React.createElement(OverlayAssistant));
    const event = new window.Event('message');
    Object.defineProperties(event, {source: {value: window}, origin: {value: 'https://clinicaltrials.gov'}, data: {value: {type: 'treatable.site.activate', purpose: 'overlay', capability: 'a'.repeat(64)}}});
    window.dispatchEvent(event);
  });
  await act(async () => {await settle(6)});
  if (step !== 'Understand') await act(async () => {stepButton(step).click()});
  const closes = () => sent.filter(v => v.type === 'site.close').length;
  /* The background relaying a press on the page outside the popup over the authenticated port. */
  const outside = () => act(async () => {messages.emit({type: 'site.outsideClick'}); await settle(2)});
  const hides = () => sent.filter(v => v.type === 'site.hide');
  return {sent, closes, outside, hides};
}
async function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(new window.Event('input', {bubbles: true}));
  });
}
const personalizeName = () => document.querySelector('[data-apply-field="name"]') as HTMLInputElement;
/** A button in the study step list: Understand, Contact or Email. */
const stepButton = (label: string) => [...document.querySelectorAll('.study-steps button')].find(node => (node.textContent || '').includes(label)) as HTMLButtonElement;
const emailDraft = () => document.querySelector('textarea.apply-email') as HTMLTextAreaElement;
const sessionEnded = () => /Session ended/.test(document.body.textContent || '');

test('production overlay: nothing typed, Escape closes and ends the session at once', async () => {
  const page = await mountAssistant();
  assert.ok(personalizeName(), 'the study section loaded');
  await act(async () => {escape()});
  await settle();
  assert.equal(page.closes(), 1);
  assert.equal(dialogs(), 0);
  assert.ok(sessionEnded());
});

test('production overlay: a typed name makes Escape ask; Keep working keeps it and focus; Close and clear ends the session', async () => {
  const page = await mountAssistant();
  const field = personalizeName();
  await typeInto(field, 'Morgan Example');
  field.focus();
  await act(async () => {escape(field)});
  await settle();
  assert.ok(popup(), 'asks before closing');
  assert.equal(page.closes(), 0);
  await act(async () => {(popup()!.querySelector('.swal2-cancel') as HTMLButtonElement).click()});
  await later();
  assert.equal(page.closes(), 0);
  assert.equal(personalizeName().value, 'Morgan Example', 'what was typed is still there');
  assert.ok(document.activeElement === personalizeName(), `focus returns to the field, not ${document.activeElement?.tagName}.${document.activeElement?.className}`);
  assert.equal(sessionEnded(), false);
  await act(async () => {button(CLOSE).click()});
  await settle();
  assert.ok(popup(), 'the Close control asks as well');
  await act(async () => {(popup()!.querySelector('.swal2-confirm') as HTMLButtonElement).click()});
  await later();
  assert.equal(page.closes(), 1);
  assert.ok(sessionEnded());
  assert.ok(!document.querySelector('.apply-local-details'), 'typed details are cleared with the session');
});

test('production overlay: typing and then deleting leaves nothing to lose, so Escape closes at once', async () => {
  const page = await mountAssistant();
  await typeInto(personalizeName(), 'M');
  await typeInto(personalizeName(), '');
  await act(async () => {escape()});
  await settle();
  assert.equal(dialogs(), 0);
  assert.equal(page.closes(), 1);
});

test('production overlay: an edited email draft or call script is typed work too', async () => {
  const page = await mountAssistant();
  await typeInto(emailDraft(), 'My own wording.');
  await act(async () => {button(CLOSE).click()});
  await settle();
  assert.ok(popup());
  assert.equal(page.closes(), 0);
  await act(async () => {escape(document.activeElement!)});
  await later();
  assert.equal(emailDraft().value, 'My own wording.');
  assert.equal(page.closes(), 0);
});

test('production overlay: "Your details" from Settings are typed work even when no study field was touched', async () => {
  const page = await mountAssistant();
  await act(async () => {button('Treatable settings').click()});
  const settings = document.getElementById('treatable-settings')!;
  const name = [...settings.querySelectorAll('label')].find(label => /Your name/.test(label.textContent || ''))!.querySelector('input') as HTMLInputElement;
  await typeInto(name, 'Pat Doe');
  await act(async () => {escape()});
  await settle();
  assert.ok(!document.getElementById('treatable-settings'), 'the first Escape only closes Settings');
  assert.equal(dialogs(), 0);
  await act(async () => {escape()});
  await settle();
  assert.ok(popup(), 'the second Escape asks, because the details would be cleared');
  assert.equal(page.closes(), 0);
  await act(async () => {(popup()!.querySelector('.swal2-cancel') as HTMLButtonElement).click()});
  await later();
  await act(async () => {button('Treatable settings').click()});
  const again = [...document.getElementById('treatable-settings')!.querySelectorAll('label')].find(label => /Your name/.test(label.textContent || ''))!.querySelector('input') as HTMLInputElement;
  assert.equal(again.value, 'Pat Doe');
});

test('production overlay: a running intro tour is stopped before asking, and focus still returns to the field', async () => {
  const page = await mountAssistant({tour: true});
  /* Replay intro lives in Settings: open them to read the button, and close them again so Escape still reaches the close question. */
  const replayDisabled = async () => {
    await act(async () => {button('Treatable settings').click()});
    const disabled = ([...document.querySelectorAll('#treatable-settings button')].find(node => node.textContent === 'Replay intro') as HTMLButtonElement).disabled;
    await act(async () => {([...document.querySelectorAll('#treatable-settings button')].find(node => node.textContent === 'Done') as HTMLButtonElement).click()});
    return disabled;
  };
  assert.equal(await replayDisabled(), true, 'the intro tour is showing its first step');
  const field = personalizeName();
  await typeInto(field, 'Morgan Example');
  field.focus();
  await act(async () => {escape(field)});
  await settle();
  assert.ok(popup(), 'asks before closing');
  assert.equal(document.querySelectorAll('.swal2-popup').length, 1, 'only the confirmation is open: the tour dialog is gone');
  assert.equal(await replayDisabled(), false, 'the tour was stopped, so it can be replayed');
  await act(async () => {(popup()!.querySelector('.swal2-cancel') as HTMLButtonElement).click()});
  await later();
  assert.equal(page.closes(), 0);
  assert.equal(personalizeName().value, 'Morgan Example');
  assert.ok(document.activeElement === personalizeName(), 'focus returns to the field, not to an element the tour remembered');
});

/* A press on the page outside the popup, relayed by the background. Nothing typed closes at once; something typed hides the popup, with no question and nothing cleared. */
function outsideHost() {
  const listeners = new Set<() => void>();
  return {onOutsideClick: (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener)}}, press: () => act(async () => {for (const listener of [...listeners]) listener(); await settle(2)}), size: () => listeners.size};
}

test('outside press with nothing typed closes at once, through the usual close and with no dialog', async () => {
  const outside = outsideHost();
  let hides = 0;
  await mountView(view({...outside, hasUnsavedWork: () => false, hide: async () => {hides++; return true}}));
  await outside.press();
  assert.equal(counts.closed, 1);
  assert.equal(hides, 0);
  assert.equal(dialogs(), 0);
});

test('outside press with something typed hides instead: no dialog, nothing closed, and a press while hiding is on its way does nothing', async () => {
  const outside = outsideHost();
  let hides = 0, finish!: (value: boolean) => void;
  await mountView(view({...outside, hasUnsavedWork: () => true, hide: () => {hides++; return new Promise<boolean>(resolve => {finish = resolve})}}));
  await outside.press();
  await outside.press();
  assert.equal(hides, 1, 'one hide request at a time');
  assert.equal(counts.closed, 0);
  assert.equal(dialogs(), 0, 'no confirmation for an outside press');
  await act(async () => {finish(true); await settle(2)});
  await outside.press();
  assert.equal(hides, 2, 'after the first settles, a later press may hide again');
});

test('outside press while the discard question is showing does nothing harmful', async () => {
  const outside = outsideHost();
  let hides = 0;
  await mountView(view({...outside, hasUnsavedWork: () => true, hide: async () => {hides++; return true}}));
  await act(async () => {button(CLOSE).click()});
  await settle();
  assert.ok(popup(), 'the Close control asks');
  await outside.press();
  await outside.press();
  assert.equal(dialogs(), 1, 'still exactly one dialog');
  assert.equal(hides, 0);
  assert.equal(counts.closed, 0);
  await act(async () => {(popup()!.querySelector('.swal2-cancel') as HTMLButtonElement).click()});
  await later();
  assert.equal(counts.closed, 0);
});

test('outside press does nothing in the sidebar or after the session ended', async () => {
  for (const overrides of [{displayMode: 'sidebar' as const}, {ended: true}]) {
    const outside = outsideHost();
    let hides = 0;
    await mountView(view({...outside, hasUnsavedWork: () => true, hide: async () => {hides++; return true}, ...overrides}));
    await outside.press();
    assert.deepEqual({hides, closed: counts.closed, dialogs: dialogs()}, {hides: 0, closed: 0, dialogs: 0}, JSON.stringify(Object.keys(overrides)));
    for (const unmount of mounted.splice(0).reverse()) await unmount();
    assert.equal(outside.size(), 0, 'the view stops listening when it goes away');
  }
});

test('outside press is not held back by the view’s own collapsed flag: the page sends none while the frame is collapsed, so one that arrives counts', async () => {
  const outside = outsideHost();
  let hides = 0;
  await mountView(view({...outside, collapsed: true, hasUnsavedWork: () => true, hide: async () => {hides++; return true}}));
  await outside.press();
  assert.equal(hides, 1);
  assert.equal(dialogs(), 0);
});

test('outside press with something typed whose hide is refused runs the usual close instead, which asks first', async () => {
  for (const hide of [async () => false, async (): Promise<boolean> => {throw Error('refused')}]) {
    const outside = outsideHost();
    await mountView(view({...outside, hasUnsavedWork: () => true, hide}));
    await outside.press();
    await settle();
    assert.ok(popup(), 'the discard question shows instead of the press being lost');
    assert.equal(counts.closed, 0);
    await act(async () => {(popup()!.querySelector('.swal2-cancel') as HTMLButtonElement).click()});
    await later();
    assert.equal(counts.closed, 0, 'keeping the work closes nothing');
    for (const unmount of mounted.splice(0).reverse()) await unmount();
  }
});

test('production overlay: outside press with a typed name hides it with everything kept, and asks the background with only the session deadline', async () => {
  const page = await mountAssistant();
  await typeInto(personalizeName(), 'Morgan Example');
  const before = Date.now();
  await page.outside();
  assert.equal(dialogs(), 0, 'no question is asked');
  assert.equal(page.closes(), 0);
  const [hide] = page.hides();
  assert.ok(hide, 'a hide request was sent');
  assert.deepEqual(Object.keys(hide.payload), ['expiresAt']);
  assert.ok(Number.isSafeInteger(hide.payload.expiresAt) && hide.payload.expiresAt > before && hide.payload.expiresAt <= Date.now() + 30 * 60 * 1000, 'the live session deadline');
  assert.equal(personalizeName().value, 'Morgan Example', 'what was typed is still there');
  assert.equal(sessionEnded(), false);
});

test('production overlay: outside press with nothing typed ends the session at once, even while the intro tour shows', async () => {
  const page = await mountAssistant({tour: true});
  await act(async () => {button('Treatable settings').click()});
  assert.equal(([...document.querySelectorAll('#treatable-settings button')].find(node => node.textContent === 'Replay intro') as HTMLButtonElement).disabled, true, 'the intro tour is running');
  await act(async () => {([...document.querySelectorAll('#treatable-settings button')].find(node => node.textContent === 'Done') as HTMLButtonElement).click()});
  await page.outside();
  assert.equal(page.closes(), 1);
  assert.equal(page.hides().length, 0);
  assert.equal(dialogs(), 0);
  assert.ok(sessionEnded());
});

test('opening a study page in the popup puts focus on the study heading, once', async () => {
  const study = {apply: studySection()};
  const page = await mountView(view({}), study);
  assert.equal(document.activeElement?.id, 'apply-heading');
  (document.activeElement as HTMLElement).blur();
  await page.rerender(view({}), {apply: studySection('another-study')});
  assert.notEqual(document.activeElement?.id, 'apply-heading', 'moving to another study on the site does not pull focus again');
});

const guideStub = (active: boolean): any => ({active, canSearchHelp: false, replayIntro() {}, startSearchHelp() {}, stop() {}, openSearch() {}});
test('a tour running when the website moves to a study page keeps focus: the heading does not take it', async () => {
  const page = await mountView(view({guide: guideStub(true)}));
  await page.rerender(view({guide: guideStub(true)}), {apply: studySection()});
  assert.notEqual(document.activeElement?.id, 'apply-heading');
});

test('a new connection in the same frame lands on the study heading again', async () => {
  const page = await mountView(view({}), {apply: studySection()});
  assert.equal(document.activeElement?.id, 'apply-heading');
  (document.activeElement as HTMLElement).blur();
  await page.rerender(view({connected: false}), {apply: undefined});
  await page.rerender(view({}), {apply: studySection()});
  assert.equal(document.activeElement?.id, 'apply-heading');
});

test('a hidden popup does not use up the heading focus: it lands once the popup is shown again, and only once', async () => {
  const page = await mountView(view({hidden: true}), {apply: studySection()});
  assert.notEqual(document.activeElement?.id, 'apply-heading', 'nothing takes focus while the popup is hidden');
  await page.rerender(view({hidden: false}), {apply: studySection()});
  assert.equal(document.activeElement?.id, 'apply-heading', 'shown again: the first landing happens now');
  (document.activeElement as HTMLElement).blur();
  await page.rerender(view({hidden: true}), {apply: studySection()});
  await page.rerender(view({hidden: false}), {apply: studySection()});
  assert.notEqual(document.activeElement?.id, 'apply-heading', 'still once per connection');
});

test('production overlay: the study steps move focus to the new step heading, but never out of the close question', async () => {
  await mountAssistant({step: 'Understand'});
  assert.equal(document.activeElement?.id, 'apply-heading', 'the first open lands on the heading');
  assert.equal(stepButton('Understand').getAttribute('aria-current'), 'step');
  assert.equal(document.querySelectorAll('.study-steps [aria-current="step"]').length, 1);
  await act(async () => {stepButton('Contact').click()});
  assert.equal(document.activeElement?.id, 'apply-heading');
  assert.equal(document.activeElement?.textContent, 'Questions and contact');
  assert.equal(stepButton('Contact').getAttribute('aria-current'), 'step');
  await act(async () => {stepButton('Email').click()});
  assert.equal(document.activeElement?.textContent, 'Write your email');
  await typeInto(personalizeName(), 'Morgan Example');
  personalizeName().focus();
  await act(async () => {escape(personalizeName())});
  await settle();
  assert.ok(popup(), 'the close question is open');
  await act(async () => {stepButton('Understand').click()});
  assert.ok(popup()!.contains(document.activeElement), `focus stays in the dialog, not ${document.activeElement?.tagName}#${document.activeElement?.id}`);
  await act(async () => {(popup()!.querySelector('.swal2-cancel') as HTMLButtonElement).click()});
  await later();
});

test('production overlay: Close is the one way to end and clear; the study page has no End and clear, and Settings keeps one Clear my details', async () => {
  const page = await mountAssistant({step: 'Understand'});
  const labels = () => [...document.querySelectorAll('button,a')].map(node => (node.textContent || '').trim());
  for (const step of ['Understand', 'Contact', 'Email']) {
    await act(async () => {stepButton(step).click()});
    assert.ok(!labels().some(label => /End and clear/i.test(label)), `${step}: no End and clear control`);
  }
  await act(async () => {button('Treatable settings').click()});
  assert.equal(labels().filter(label => label === 'Clear my details').length, 1, 'one quiet Clear my details, beside the Your details fields');
  assert.ok([...document.querySelectorAll('button')].find(node => node.textContent === 'Clear my details')!.closest('.your-details'));
  await act(async () => {([...document.querySelectorAll('#treatable-settings button')].find(node => node.textContent === 'Done') as HTMLButtonElement).click()});
  await typeInto(personalizeName(), 'Morgan Example');
  await act(async () => {button(CLOSE).click()});
  await settle();
  assert.ok(popup(), 'Close still asks first while something is typed');
  await act(async () => {(popup()!.querySelector('.swal2-confirm') as HTMLButtonElement).click()});
  await later();
  assert.equal(page.closes(), 1);
  assert.ok(sessionEnded());
});

test('the sidebar and a results page leave the website\'s focus alone', async () => {
  await mountView(view({displayMode: 'sidebar'}), {apply: studySection()});
  assert.notEqual(document.activeElement?.id, 'apply-heading');
  document.body.innerHTML = '';
  await mountView(view({}));
  assert.notEqual(document.activeElement?.id, 'apply-heading');
});

test('collapsed, then close: the study section coming back never takes focus from the close question', async () => {
  const page = await mountView(view({hasUnsavedWork: () => true, collapsed: true}), {apply: undefined});
  await act(async () => {escape()});
  await settle();
  assert.ok(popup(), 'the close question is open');
  /* Opening the frame to ask mounts the study section again, as the real section does. */
  await page.rerender(view({hasUnsavedWork: () => true, collapsed: false}), {apply: studySection()});
  assert.notEqual(document.activeElement?.id, 'apply-heading', 'the heading must not take focus from behind the dialog');
  assert.ok(popup()!.contains(document.activeElement), `focus stays in the dialog, not ${document.activeElement?.tagName}`);
  await act(async () => {(popup()!.querySelector('.swal2-cancel') as HTMLButtonElement).click()});
  await later();
  assert.notEqual(document.activeElement?.id, 'apply-heading', 'Keep working does not send focus to the heading either');
  assert.equal(counts.closed, 0);
});

test('merged overlay: exactly one Replay intro, only in Settings, no footer, and the website-filters help and search link stay', async () => {
  await mountAssistant({tour: false});
  const replays = () => [...document.querySelectorAll('button')].filter(node => node.textContent === 'Replay intro');
  assert.equal(replays().length, 0, 'closed settings: none on the page');
  assert.equal(document.querySelector('footer'), null, 'no footer');
  await act(async () => {button('Treatable settings').click()});
  assert.equal(replays().length, 1, 'one, in Settings');
  assert.ok(replays()[0].closest('#treatable-settings'), 'inside the settings panel');
  assert.ok(replays()[0].closest('.settings-actions'), 'beside Done');
  assert.ok([...document.querySelectorAll('button')].some(node => node.textContent === 'Search for other studies on ClinicalTrials.gov'), 'the study page keeps the search link');
});

