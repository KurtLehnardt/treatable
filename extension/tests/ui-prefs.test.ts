import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import TestRenderer, {act, type ReactTestRenderer} from 'react-test-renderer';
import {DEFAULT_UI_PREFS, DISPLAY_MODES, THEMES, UI_PREFS_KEY, loadUiPrefs, parseUiPrefs, saveUiPrefs, subscribeUiPrefs, uiPrefsArea, type UiPrefs} from '../src/ui-prefs';
import {LEGACY_STORAGE_KEYS, STORAGE_KEY, clearLegacyPatientData} from '../src/storage';
import {useSiteController} from '../src/use-site-controller';
import {OverlayView} from '../src/overlay-view';
import {ScoreBadgeClient} from '../src/score-badge-client';
import {installSiteContent} from '../src/site-content';
import {captureSiteActivations} from '../src/overlay-port';
import {SITE_FILTERS} from '../src/site-filter-catalog';

const flush = async () => {await new Promise<void>(r => setImmediate(r)); await new Promise<void>(r => setImmediate(r))};
const DEFAULTS: UiPrefs = {displayMode: 'popup', theme: 'system'};
const SAVED: UiPrefs = {displayMode: 'popup', theme: 'dark'};

/** In-memory stand-in for chrome.storage.local. Values are cloned like Chrome's JSON storage, and every call is recorded. */
function fakeArea(initial: Record<string, unknown> = {}) {
 const store = new Map<string, unknown>(Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]));
 const calls: string[] = [];
 return {
  store, calls,
  async get(key: string) {calls.push('get:' + key); return store.has(key) ? {[key]: structuredClone(store.get(key))} : {}},
  async set(items: Record<string, unknown>) {calls.push('set:' + Object.keys(items).join(',')); for (const [key, value] of Object.entries(items)) store.set(key, structuredClone(value))},
  async remove(key: string) {calls.push('remove:' + key); store.delete(key)},
 };
}
const rootOf = (area: unknown) => ({storage: {local: area}});

test('schema accepts exactly the allowed display modes and themes and rejects everything else', () => {
 for (const displayMode of DISPLAY_MODES) for (const theme of THEMES) assert.deepEqual(parseUiPrefs({displayMode, theme}), {displayMode, theme});
 class Look { displayMode = 'popup'; theme = 'dark'; }
 const rejected: unknown[] = [
  undefined, null, 'popup', 42, [], [SAVED], new Look(), Object.create({displayMode: 'popup', theme: 'dark'}),
  {}, {displayMode: 'popup'}, {theme: 'dark'},
  {displayMode: 'Popup', theme: 'dark'}, {displayMode: 'popup', theme: 'purple'}, {displayMode: '', theme: 'dark'}, {displayMode: 'popup ', theme: 'dark'},
  {displayMode: 1, theme: 'dark'}, {displayMode: ['popup'], theme: 'dark'}, {displayMode: {toString: () => 'popup'}, theme: 'dark'}, {displayMode: null, theme: undefined},
  {displayMode: 'popup', theme: 'dark', extra: 'x'}, {displayMode: 'popup', theme: 'dark', zip: '83702'}, {displayMode: 'popup', theme: 'dark', condition: 'fibromyalgia'},
  {displayMode: 'popup', theme: 'dark', nctId: 'NCT00000001'}, {displayMode: 'popup', theme: 'dark', query: 'free text'}, {displayMode: 'fibromyalgia', theme: 'dark'},
 ];
 for (const value of rejected) assert.equal(parseUiPrefs(value), undefined, JSON.stringify(value));
 const input = {displayMode: 'sidebar', theme: 'light'}, output = parseUiPrefs(input)!;
 assert.notEqual(output, input as unknown, 'parsing returns a fresh object, never the input');
 assert.deepEqual(DEFAULT_UI_PREFS, DEFAULTS);
 assert.ok(Object.isFrozen(DEFAULT_UI_PREFS));
});

test('saved preferences load back after a simulated reload; missing or unreadable storage gives the defaults', async () => {
 const area = fakeArea();
 assert.deepEqual(await loadUiPrefs(area), DEFAULTS, 'nothing saved yet');
 assert.equal(await saveUiPrefs(area, SAVED), true);
 assert.deepEqual([...area.store.keys()], [UI_PREFS_KEY]);
 assert.deepEqual(area.store.get(UI_PREFS_KEY), SAVED);
 assert.deepEqual(await loadUiPrefs(area), SAVED, 'a fresh load after a reload sees the saved choice');
 assert.deepEqual(await loadUiPrefs(undefined), DEFAULTS, 'storage unavailable');
 assert.deepEqual(await loadUiPrefs(uiPrefsArea({})), DEFAULTS, 'no storage API');
 assert.deepEqual(await loadUiPrefs(uiPrefsArea({storage: {local: {}}})), DEFAULTS, 'storage API without get or set');
 assert.deepEqual(await loadUiPrefs({get: async () => {throw new Error('storage failed')}, set: async () => {}}), DEFAULTS, 'read error');
 assert.deepEqual(await loadUiPrefs({get: () => {throw new Error('sync failure')}, set: async () => {}} as any), DEFAULTS, 'synchronous read error');
 assert.equal(await saveUiPrefs({get: async () => ({}), set: async () => {throw new Error('quota')}}, SAVED), false, 'write errors never throw');
 assert.equal(await saveUiPrefs(undefined, SAVED), false);
 assert.ok(uiPrefsArea(rootOf(area)));
});

test('invalid stored values fall back to the defaults and are never used', async () => {
 const stored: unknown[] = [
  {displayMode: 'fullscreen', theme: 'dark'}, {displayMode: 'popup', theme: 'neon'}, {displayMode: 'popup'}, {theme: 'dark'}, {},
  'popup', 7, true, null, [], [SAVED], {displayMode: 'popup', theme: 'dark', zip: '83702'}, {displayMode: {}, theme: []},
 ];
 for (const value of stored) assert.deepEqual(await loadUiPrefs(fakeArea({[UI_PREFS_KEY]: value})), DEFAULTS, JSON.stringify(value));
 const others = fakeArea({[STORAGE_KEY]: {condition: 'PRIVATE_CANARY'}, 'treatable.other': SAVED, displayMode: 'popup', theme: 'dark'});
 assert.deepEqual(await loadUiPrefs(others), DEFAULTS, 'other keys are never read as preferences');
 assert.deepEqual(others.calls, ['get:' + UI_PREFS_KEY], 'only the preferences key is requested');
 const hostile = {get: async () => ({[UI_PREFS_KEY]: SAVED, polluted: true}), set: async () => {}};
 assert.deepEqual(await loadUiPrefs(hostile), SAVED, 'extra top-level keys in the reply are ignored, only the preferences key is used');
});

test('no other key, value or health data can be written through the preferences module', async () => {
 const area = fakeArea();
 const canary = {condition: 'PRIVATE_CANARY', zip: '83702', name: 'Pat Example', nctId: 'NCT00000001', query: 'fibromyalgia near me'};
 const refused: unknown[] = [
  {...SAVED, ...canary}, {...SAVED, zip: '83702'}, {displayMode: 'PRIVATE_CANARY', theme: 'dark'}, {displayMode: 'popup', theme: 'PRIVATE_CANARY'},
  {displayMode: 'popup'}, {theme: 'dark'}, {}, canary, 'PRIVATE_CANARY', null, undefined, 3, [SAVED], {[UI_PREFS_KEY]: SAVED},
 ];
 for (const value of refused) assert.equal(await saveUiPrefs(area, value), false, JSON.stringify(value));
 assert.deepEqual(area.calls, [], 'refused values never reach storage');
 assert.equal(area.store.size, 0);
 const nullPrototype = Object.assign(Object.create(null), {displayMode: 'popup', theme: 'dark'});
 assert.equal(await saveUiPrefs(area, nullPrototype), true);
 assert.deepEqual(area.calls, ['set:' + UI_PREFS_KEY]);
 assert.deepEqual([...area.store.keys()], [UI_PREFS_KEY]);
 assert.doesNotMatch(JSON.stringify([...area.store]), /PRIVATE_CANARY|83702|Pat Example|NCT0|fibromyalgia/);
 assert.deepEqual(area.store.get(UI_PREFS_KEY), SAVED);
});

test('subscription delivers only valid local preference changes', () => {
 const listeners: Array<(changes: any, area: string) => void> = [];
 const root = {storage: {onChanged: {addListener: (f: any) => listeners.push(f), removeListener: (f: any) => listeners.splice(listeners.indexOf(f), 1)}}};
 const seen: UiPrefs[] = [];
 const stop = subscribeUiPrefs(prefs => seen.push(prefs), root);
 const emit = (changes: any, area = 'local') => listeners.forEach(f => f(changes, area));
 emit({[UI_PREFS_KEY]: {newValue: {displayMode: 'sidebar', theme: 'light'}}});
 emit({[UI_PREFS_KEY]: {newValue: {displayMode: 'sidebar', theme: 'light'}}}, 'sync');
 emit({[UI_PREFS_KEY]: {newValue: {displayMode: 'sidebar', theme: 'neon'}}});
 emit({[UI_PREFS_KEY]: {newValue: {displayMode: 'sidebar', theme: 'light', zip: '83702'}}});
 emit({[UI_PREFS_KEY]: {}});
 emit({other: {newValue: {displayMode: 'popup', theme: 'dark'}}});
 assert.deepEqual(seen, [{displayMode: 'sidebar', theme: 'light'}]);
 stop();
 assert.equal(listeners.length, 0);
 assert.doesNotThrow(() => subscribeUiPrefs(() => {}, {})());
});

test('legacy patient-key cleanup removes only the legacy key and keeps the preferences', async () => {
 assert.deepEqual([...LEGACY_STORAGE_KEYS], [STORAGE_KEY]);
 assert.ok(!(LEGACY_STORAGE_KEYS as readonly string[]).includes(UI_PREFS_KEY));
 const local = fakeArea({[STORAGE_KEY]: {condition: 'PRIVATE_CANARY'}, [UI_PREFS_KEY]: SAVED}), session = fakeArea({[STORAGE_KEY]: {condition: 'PRIVATE_CANARY'}});
 await clearLegacyPatientData(session, local);
 assert.equal(local.store.has(STORAGE_KEY), false);
 assert.equal(session.store.has(STORAGE_KEY), false);
 assert.deepEqual(local.store.get(UI_PREFS_KEY), SAVED, 'preferences survive cleanup');
 assert.deepEqual(local.calls, ['remove:' + STORAGE_KEY]);
 assert.deepEqual(await loadUiPrefs(local), SAVED);
});

/* Overlay controller: preferences apply on the first render, save on change, survive reloads and End session. */
const snapshot = {generation: 'page-1', url: 'https://clinicaltrials.gov/search?cond=Fibromyalgia', nctIds: ['NCT00000001'], diagnostic: 'One result card found.', supported: true};
class FakePort {
 messages: any[] = []; closed = false; listeners: Array<(m: any) => void> = []; ends: Array<() => void> = [];
 onMessage = {addListener: (f: (m: any) => void) => this.listeners.push(f)};
 onDisconnect = {addListener: (f: () => void) => this.ends.push(f)};
 emit(v: any) {for (const f of this.listeners) f(v)}
 postMessage(v: any) {
  this.messages.push(structuredClone(v));
  if (v.type === 'site.authenticate') {queueMicrotask(() => this.emit({type: 'site.ready', snapshot, filters: SITE_FILTERS, search: {}})); return}
  queueMicrotask(() => this.emit({id: v.id, ok: true, result: {}}));
 }
 disconnect() {if (this.closed) return; this.closed = true; for (const f of this.ends) f()}
}
let latest: any; let rendered: Array<{displayMode: string; theme: string}> = [];
function Probe({prefs}: {prefs: UiPrefs}) {
 const vm = useSiteController(prefs);
 latest = vm; rendered.push({displayMode: vm.displayMode!, theme: vm.theme!});
 return React.createElement(OverlayView, {vm});
}
async function mount(area: ReturnType<typeof fakeArea> | undefined, prefs: UiPrefs) {
 const parent = {postMessage() {}}, win = new EventTarget() as any, doc = new EventTarget() as any, port = new FakePort();
 win.parent = parent; doc.visibilityState = 'visible'; rendered = [];
 Object.defineProperty(globalThis, 'window', {configurable: true, value: win});
 Object.defineProperty(globalThis, 'document', {configurable: true, value: doc});
 Object.defineProperty(globalThis, 'chrome', {configurable: true, value: {runtime: {connect: () => port}, ...(area ? {storage: {local: area}} : {})}});
 captureSiteActivations(win);
 let renderer!: ReactTestRenderer;
 await act(async () => {
  renderer = TestRenderer.create(React.createElement(Probe, {prefs}), {createNodeMock: () => ({focus() {}})});
  const event = new Event('message');
  Object.defineProperties(event, {source: {value: parent}, origin: {value: 'https://clinicaltrials.gov'}, data: {value: {type: 'treatable.site.activate', purpose: 'overlay', capability: 'a'.repeat(43)}}});
  win.dispatchEvent(event);
 });
 return {port, renderer, win};
}
const layoutRequests = (port: FakePort) => port.messages.filter(m => m.type === 'site.layout').map(m => m.payload);

test('display mode and theme persist across a simulated reload and are applied on the very first render', async () => {
 const area = fakeArea();
 const first = await mount(area, await loadUiPrefs(uiPrefsArea(rootOf(area))));
 assert.deepEqual(rendered[0], DEFAULTS);
 assert.deepEqual(layoutRequests(first.port), [], 'default preferences send no layout request on connect');
 act(() => latest.setDisplayMode('popup'));
 act(() => latest.setTheme('dark'));
 await act(async () => {await flush()});
 assert.deepEqual(area.store.get(UI_PREFS_KEY), SAVED);
 assert.deepEqual([...area.store.keys()], [UI_PREFS_KEY]);
 assert.deepEqual(layoutRequests(first.port), [{displayMode: 'popup'}, {theme: 'dark'}]);
 act(() => first.renderer.unmount());

 /* Reload: a brand-new page reads the saved record before it renders anything. */
 const loaded = await loadUiPrefs(uiPrefsArea(rootOf(area)));
 assert.deepEqual(loaded, SAVED);
 const second = await mount(area, loaded);
 assert.deepEqual(rendered[0], SAVED, 'the first render already uses the saved choice, with no flash of the defaults');
 const main = second.renderer.root.findByType('main');
 assert.equal(main.props['data-theme'], 'dark');
 assert.equal(main.props['data-display-mode'], 'popup');
 assert.equal(main.props['aria-modal'], true);
 assert.deepEqual(layoutRequests(second.port), [{displayMode: 'popup', theme: 'dark'}], 'the host frame is told the saved layout on connect');
 act(() => second.renderer.unmount());
});

test('changing one setting keeps the other and every save is the full validated record', async () => {
 const area = fakeArea({[UI_PREFS_KEY]: SAVED});
 const session = await mount(area, await loadUiPrefs(area));
 act(() => latest.setTheme('light'));
 assert.deepEqual(area.store.get(UI_PREFS_KEY), {displayMode: 'popup', theme: 'light'});
 act(() => latest.setDisplayMode('sidebar'));
 assert.deepEqual(area.store.get(UI_PREFS_KEY), {displayMode: 'sidebar', theme: 'light'});
 act(() => session.renderer.unmount());
});

test('invalid values and missing storage never break the overlay or write anything', async () => {
 const area = fakeArea();
 const session = await mount(area, await loadUiPrefs(area));
 for (const bad of ['fullscreen', '', undefined, null, 3, {x: 1}, 'popup ']) act(() => latest.setDisplayMode(bad));
 for (const bad of ['neon', '', undefined, null, 3, {x: 1}, 'Dark']) act(() => latest.setTheme(bad));
 assert.deepEqual({displayMode: latest.displayMode, theme: latest.theme}, DEFAULTS);
 assert.deepEqual(area.calls.filter(c => !c.startsWith('get:')), []);
 assert.equal(area.store.size, 0);
 act(() => session.renderer.unmount());

 const garbage = await mount(area, {displayMode: 'x', theme: 'y', zip: '83702'} as any);
 assert.deepEqual(rendered[0], DEFAULTS, 'invalid initial preferences fall back to the defaults');
 act(() => garbage.renderer.unmount());

 const noStorage = await mount(undefined, SAVED);
 assert.deepEqual(rendered[0], SAVED);
 act(() => latest.setTheme('light'));
 assert.equal(latest.theme, 'light', 'the choice still applies for this page when storage is unavailable');
 act(() => noStorage.renderer.unmount());

 const failing = {get: async () => {throw new Error('down')}, set: async () => {throw new Error('down')}};
 const broken = await mount(failing as any, await loadUiPrefs(failing));
 assert.deepEqual(rendered[0], DEFAULTS);
 await act(async () => {latest.setTheme('dark'); await flush()});
 assert.equal(latest.theme, 'dark');
 act(() => broken.renderer.unmount());
});

test('End session clears the search but keeps the display preferences, and no search text reaches storage', async () => {
 const area = fakeArea();
 const session = await mount(area, await loadUiPrefs(area));
 act(() => latest.setTheme('dark'));
 act(() => latest.setField('cond', 'PRIVATE_QUERY_CANARY'));
 await act(async () => latest.search());
 assert.equal(latest.fields.cond, 'PRIVATE_QUERY_CANARY');
 await act(async () => {latest.close(); await flush()});
 assert.deepEqual(latest.fields, {});
 assert.equal(latest.connected, false);
 assert.equal(latest.ended, true);
 assert.equal(latest.theme, 'dark', 'ending the session does not reset the theme');
 assert.deepEqual(area.store.get(UI_PREFS_KEY), {displayMode: 'popup', theme: 'dark'});
 assert.deepEqual([...area.store.keys()], [UI_PREFS_KEY]);
 assert.doesNotMatch(JSON.stringify([...area.store]), /PRIVATE_QUERY_CANARY/);
 assert.ok(area.calls.every(call => call === 'set:' + UI_PREFS_KEY || call === 'get:' + UI_PREFS_KEY), area.calls.join());
 assert.ok(!area.calls.some(call => call.startsWith('remove')), 'ending a session never deletes the preferences');
 act(() => session.renderer.unmount());
});

/* Score badge: the same saved theme applies, first render and live. */
test('score badge renders the saved theme first and follows later theme changes', async () => {
 assert.match(renderToStaticMarkup(React.createElement(ScoreBadgeClient, {initialTheme: 'dark' as const})), /data-theme="dark"/);
 assert.match(renderToStaticMarkup(React.createElement(ScoreBadgeClient)), /data-theme="system"/);
 const listeners: Array<(changes: any, area: string) => void> = [];
 const win = new EventTarget() as any; win.parent = {postMessage() {}};
 Object.defineProperty(globalThis, 'window', {configurable: true, value: win});
 Object.defineProperty(globalThis, 'chrome', {configurable: true, value: {runtime: {connect: () => new FakePort()}, storage: {onChanged: {addListener: (f: any) => listeners.push(f), removeListener: (f: any) => listeners.splice(listeners.indexOf(f), 1)}}}});
 let renderer!: ReactTestRenderer;
 await act(async () => {renderer = TestRenderer.create(React.createElement(ScoreBadgeClient, {initialTheme: 'light' as const}))});
 const theme = () => renderer.root.findByProps({className: 'score-badge'}).props['data-theme'];
 assert.equal(theme(), 'light');
 act(() => listeners.forEach(f => f({[UI_PREFS_KEY]: {newValue: {displayMode: 'overlay', theme: 'dark'}}}, 'local')));
 assert.equal(theme(), 'dark');
 act(() => listeners.forEach(f => f({[UI_PREFS_KEY]: {newValue: {displayMode: 'overlay', theme: 'neon'}}}, 'local')));
 assert.equal(theme(), 'dark', 'invalid changes are ignored');
 act(() => renderer.unmount());
 assert.equal(listeners.length, 0, 'unmounting unsubscribes');
});

/* Content script: the host frame is laid out from the saved preferences as it is created. */
class Fake extends EventTarget {
 parentElement: Fake | null = null; children: Fake[] = []; isConnected = true; kind = 'node'; id = ''; hrefs: string[] = []; inert = false; title = ''; src = '';
 styles: Record<string, string> = {}; style: any = {setProperty: (key: string, value: string) => {this.styles[key] = value}}; contentWindow = {postMessage() {}};
 insertBefore(n: Fake, b: Fake | null) {if (n.parentElement) n.parentElement.children.splice(n.parentElement.children.indexOf(n), 1); const i = b ? this.children.indexOf(b) : this.children.length; this.children.splice(i < 0 ? this.children.length : i, 0, n); n.parentElement = this; return n}
 appendChild(n: Fake) {return this.insertBefore(n, null)}
 remove() {if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; this.isConnected = false}
 closest() {return null} querySelectorAll() {return this.hrefs.map(href => ({getAttribute: () => href}))} contains(n: Fake): boolean {return n === this || this.children.some(c => c.contains(n))}
 focus() {} setAttribute() {} getBoundingClientRect() {return {top: 10, bottom: 100, right: 500}} matches() {return this.kind === 'card'} querySelector() {return null}
}
function patchDom(t: any) {
 const saved = {Element: globalThis.Element, HTMLElement: globalThis.HTMLElement, MutationObserver: globalThis.MutationObserver};
 Object.assign(globalThis, {Element: Fake, HTMLElement: Fake, MutationObserver: class {observe() {} disconnect() {}}});
 t.after(() => Object.assign(globalThis, saved));
}
function contentHarness(t: any) {
 const root = new Fake(), doc: any = new EventTarget(), win: any = new EventTarget();
 Object.assign(doc, {body: root, visibilityState: 'visible', defaultView: {getComputedStyle: () => ({display: 'block'})}, querySelector: () => root, querySelectorAll: () => [], createComment: () => new Fake(), createElement: () => new Fake(), activeElement: null});
 Object.assign(win, {location: {href: 'https://clinicaltrials.gov/search'}, innerWidth: 1000, innerHeight: 800});
 const controller = installSiteContent(win, doc, {runtime: {id: 'test', getURL: (p: string) => 'chrome-extension://test/' + p, onMessage: {addListener() {}, removeListener() {}}, sendMessage: async () => ({})}});
 t.after(() => controller.dispose());
 return {controller, frame: () => root.children.find(n => n.src.includes('overlay.html'))!};
}

test('overlay frame is created already laid out for the saved display mode and theme', async t => {
 patchDom(t);
 for (const [prefs, check] of [
  [{displayMode: 'popup', theme: 'dark'}, (f: Fake) => {assert.equal(f.styles.top, '50%'); assert.match(f.styles.transform, /translate\(-50%/); assert.equal(f.style.colorScheme, 'dark')}],
  [{displayMode: 'sidebar', theme: 'light'}, (f: Fake) => {assert.equal(f.styles.top, '0'); assert.equal(f.styles.right, '0'); assert.equal(f.styles.height, '800px'); assert.equal(f.style.colorScheme, 'light')}],
  [{displayMode: 'overlay', theme: 'dark'}, (f: Fake) => {assert.equal(f.styles.top, '16px'); assert.equal(f.style.colorScheme, 'dark')}],
  [{displayMode: 'fullscreen', theme: 'neon'}, (f: Fake) => {assert.equal(f.styles.top, '50%', 'invalid layout falls back to the default popup'); assert.equal(f.style.colorScheme, 'light', 'invalid theme falls back to the system theme')}],
  [{}, (f: Fake) => assert.equal(f.styles.top, '50%', 'no saved choice gives the default popup')],
 ] as Array<[any, (f: Fake) => void]>) {
  const {controller, frame} = contentHarness(t);
  controller.activate({purpose: 'overlay', capability: 'a'.repeat(64), ...prefs});
  check(frame());
  controller.dispose();
 }
});
