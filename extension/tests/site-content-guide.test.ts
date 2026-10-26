import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, settle, type TestDom } from './dom-harness';
import { searchPage } from './guide-fixtures';

/** Drives the real content script controller against the live-capture search page, as the background would. */
async function rig() {
  const env: TestDom = installDom(searchPage());
  // jsdom does no layout, so every element reports an empty box. Give each one a size so controls count as on screen.
  env.window.Element.prototype.getClientRects = function () { return [{ width: 10, height: 10 }] as any; };
  const { installSiteContent } = await import('../src/site-content');
  const handlers: Array<(message: any, sender: any, respond: (v: unknown) => void) => boolean | void> = [];
  const sent: any[] = [];
  const api: any = {
    runtime: {
      id: 'test',
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: async (message: any) => { sent.push(message); return { ok: true }; },
      onMessage: { addListener: (f: any) => handlers.push(f), removeListener: (f: any) => handlers.splice(handlers.indexOf(f), 1) },
    },
  };
  const controller = installSiteContent(env.window, env.document, api);
  const command = (type: string, payload: unknown = {}, sender: any = { id: 'test' }) => {
    let reply: any;
    handlers[0]({ kind: 'treatable.site.command', type, payload }, sender, v => { reply = v; });
    return reply;
  };
  const guideEvents = () => sent.filter(m => m.type === 'guide').map(m => m.event);
  const hosts = () => env.document.querySelectorAll('[data-treatable-guide-host]').length;
  return { env, controller, command, sent, guideEvents, hosts, handlers, api };
}

test('the content script runs a guide command from the extension, mounts its dialog in a shadow host and reports only fixed results', async () => {
  const t = await rig();
  try {
    assert.deepEqual(t.command('guide', { command: { op: 'filters', intro: false } }), { ok: true, result: {} });
    await settle(8);
    assert.equal(t.hosts(), 1);
    assert.equal(t.env.document.querySelectorAll('[data-treatable-guide-highlight]').length, 1, 'the Recruiting box is highlighted');
    // Skip is inside a closed shadow root; ending through the command channel is the supported route.
    assert.deepEqual(t.command('guide', { command: { op: 'cancel' } }), { ok: true, result: {} });
    await settle(8);
    assert.equal(t.hosts(), 0);
    assert.deepEqual(t.guideEvents(), [], 'a cancelled guide reports nothing');
  } finally { t.controller.dispose(); await settle(8); t.env.teardown(); }
});

test('guide commands from a web page or with unknown shapes are refused', async () => {
  const t = await rig();
  try {
    const foreign = t.command('guide', { command: { op: 'filters', intro: false } }, { id: 'someone-else' });
    assert.equal(foreign, undefined, 'a sender that is not this extension gets no answer');
    for (const payload of [{ command: { op: 'click', selector: 'input' } }, { command: { op: 'filters' } }, { command: { op: 'filters', intro: false, js: 'alert(1)' } }, { other: 1 }, {}]) {
      const reply = t.command('guide', payload);
      assert.equal(reply.ok, false, JSON.stringify(payload));
    }
    await settle(5);
    assert.equal(t.hosts(), 0);
  } finally { t.controller.dispose(); await settle(8); t.env.teardown(); }
});

test('expanding the Treatable panel while a page step is showing ends that step as skipped', async () => {
  const t = await rig();
  try {
    t.controller.activate({ capability: 'a'.repeat(64), purpose: 'overlay' });
    t.command('guide', { command: { op: 'filters', intro: false } });
    await settle(8);
    assert.equal(t.hosts(), 1);
    t.controller.layout({ collapsed: false });
    await settle(5);
    assert.equal(t.hosts(), 0);
    assert.deepEqual(t.guideEvents(), [{ op: 'filters', action: 'skip', page: 'search' }]);
  } finally { t.controller.dispose(); await settle(8); t.env.teardown(); }
});

test('closing Treatable, or the page going away, removes the guide with no leftovers on the page', async () => {
  const t = await rig();
  try {
    t.controller.activate({ capability: 'a'.repeat(64), purpose: 'overlay' });
    t.command('guide', { command: { op: 'filters', intro: false } });
    await settle(8);
    assert.equal(t.hosts(), 1);
    t.command('close');
    await settle(5);
    assert.equal(t.hosts(), 0);
    assert.equal(t.env.document.querySelectorAll('[data-treatable-guide-highlight]').length, 0);
    t.command('guide', { command: { op: 'results' } });
    await settle(8);
    assert.equal(t.hosts(), 1);
    t.controller.dispose();
    await settle(5);
    assert.equal(t.hosts(), 0);
  } finally { t.controller.dispose(); await settle(8); t.env.teardown(); }
});

test('the panel opens in the popup display by default', async () => {
  const t = await rig();
  try {
    t.controller.activate({ capability: 'a'.repeat(64), purpose: 'overlay' });
    const frame = t.env.document.querySelector('iframe') as HTMLIFrameElement;
    assert.ok(frame);
    assert.equal(frame.style.getPropertyValue('width'), `${Math.min(760, t.env.window.innerWidth - 24)}px`, 'popup width, not the 440px sidebar width');
    assert.equal(frame.style.getPropertyValue('transform'), 'translate(-50%,-50%)');
    // While the page is covered by a popup the rest of the page is inert; collapsing frees it for the guide.
    const main = t.env.document.getElementById('app') as any;
    assert.equal(main.inert, true);
    t.controller.layout({ collapsed: true });
    assert.ok(!main.inert, 'collapsed panel leaves the page usable for the guide steps');
  } finally { t.controller.dispose(); await settle(8); t.env.teardown(); }
});


/* Outside press in the popup, hide and show in place, and the sidebar sharing the page width. */
type Rig = Awaited<ReturnType<typeof rig>>;
const overlayFrame = (t: Rig) => t.env.document.querySelector('iframe[src$="overlay.html"]') as HTMLIFrameElement;
const press = (t: Rig, target: EventTarget = t.env.document.body, init: Record<string, unknown> = {}) => target.dispatchEvent(new t.env.window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, isPrimary: true, ...init }));
const outsideRequests = (t: Rig) => t.sent.filter(m => m.type === 'outsideClick');
const css = (element: HTMLElement, name: string) => [element.style.getPropertyValue(name), element.style.getPropertyPriority(name)];
const pageInert = (t: Rig) => (t.env.document.getElementById('app') as any).inert === true;
const open = (t: Rig, extra: Record<string, unknown> = {}) => t.controller.activate({ capability: 'a'.repeat(64), purpose: 'overlay', ...extra } as any);

test('a primary press on the page outside the popup sends one fixed close request, even with the page behind it inert', async () => {
  const t = await rig();
  try {
    open(t);
    assert.ok(pageInert(t), 'the page behind the popup is inert');
    // In Chrome a press on inert content lands on body or html; the capture listener on the document still hears it.
    press(t);
    await settle(2);
    assert.deepEqual(outsideRequests(t), [{ kind: 'treatable.site.content', type: 'outsideClick' }], 'only the fixed request leaves the page, with no event data');
    press(t, t.env.document.documentElement);
    await settle(2);
    assert.equal(outsideRequests(t).length, 2);
    for (const init of [{ button: 2 }, { button: 1 }, { isPrimary: false }]) press(t, t.env.document.body, init);
    press(t, overlayFrame(t));
    await settle(2);
    assert.equal(outsideRequests(t).length, 2, 'secondary buttons, non-primary pointers and the frame element itself do nothing');
  } finally { t.controller.dispose(); await settle(8); t.env.teardown(); }
});

test('presses while a request is on its way are not sent twice', async () => {
  const t = await rig();
  try {
    let release!: () => void;
    const original = t.api.runtime.sendMessage;
    t.api.runtime.sendMessage = async (message: any) => { t.sent.push(message); await new Promise<void>(resolve => { release = resolve; }); return { ok: true }; };
    open(t);
    press(t); press(t); press(t);
    await settle(2);
    assert.equal(outsideRequests(t).length, 1);
    release();
    await settle(2);
    t.api.runtime.sendMessage = original;
    press(t);
    await settle(2);
    assert.equal(outsideRequests(t).length, 2, 'the next press after the reply is sent again');
  } finally { t.controller.dispose(); await settle(8); t.env.teardown(); }
});

test('no close request in the sidebar, while collapsed, while the page guide runs, while hidden or after the page goes away', async () => {
  const t = await rig();
  try {
    open(t, { displayMode: 'sidebar' });
    press(t);
    t.controller.layout({ displayMode: 'popup', collapsed: true });
    press(t);
    t.controller.layout({ collapsed: false });
    t.command('guide', { command: { op: 'filters', intro: false } });
    await settle(8);
    assert.equal(t.hosts(), 1, 'the guide is running');
    press(t);
    t.command('guide', { command: { op: 'cancel' } });
    await settle(8);
    assert.deepEqual(t.command('hide'), { ok: true, result: {} });
    press(t);
    await settle(2);
    assert.equal(outsideRequests(t).length, 0);
    t.command('layout', { collapsed: false, hidden: false });
    t.controller.dispose();
    press(t);
    await settle(2);
    assert.equal(outsideRequests(t).length, 0);
  } finally { t.controller.dispose(); await settle(8); t.env.teardown(); }
});

test('hide keeps the very same frame alive, frees the page and returns focus to it; the toolbar shows that frame again in place', async () => {
  const t = await rig();
  try {
    open(t);
    const frame = overlayFrame(t), child = frame.contentWindow;
    frame.focus();
    assert.ok(t.env.document.activeElement === frame, 'focus starts in the popup');
    // jsdom does not move focus out of an iframe on blur(); Chrome hands it to the page. Count the call instead.
    let blurred = 0;
    const blur = frame.blur.bind(frame);
    frame.blur = () => { blurred++; blur(); };
    assert.deepEqual(t.command('hide'), { ok: true, result: {} });
    assert.ok(overlayFrame(t) === frame && frame.isConnected && frame.contentWindow === child, 'not removed, moved or reloaded');
    assert.deepEqual([css(frame, 'display'), css(frame, 'visibility'), css(frame, 'pointer-events')], [['none', 'important'], ['hidden', 'important'], ['none', 'important']]);
    assert.equal(pageInert(t), false, 'the page is usable while the popup is hidden');
    assert.equal(blurred, 1, 'focus is handed back to the page');
    assert.deepEqual(t.command('hide'), { ok: true, result: {} }, 'hiding again changes nothing');
    const pageField = t.env.document.querySelector('#app input') as HTMLInputElement;
    pageField.focus();
    assert.ok(t.env.document.activeElement === pageField, 'the page can take focus while the popup is hidden');
    // The background's toolbar handler: expanded and shown again, the same frame.
    assert.deepEqual(t.command('layout', { collapsed: false, hidden: false }), { ok: true, result: {} });
    assert.ok(overlayFrame(t) === frame && frame.contentWindow === child);
    assert.deepEqual([css(frame, 'display'), css(frame, 'visibility'), css(frame, 'pointer-events'), css(frame, 'top')], [['block', 'important'], ['visible', 'important'], ['auto', 'important'], ['50%', 'important']]);
    assert.ok(pageInert(t), 'the popup is modal again');
    assert.ok(t.env.document.activeElement === frame, 'focus is back inside the popup');
    assert.equal(t.env.document.querySelectorAll('iframe[src$="overlay.html"]').length, 1);
  } finally { t.controller.dispose(); await settle(8); t.env.teardown(); }
});

test('hide is refused outside the expanded popup and while the page guide runs', async () => {
  const t = await rig();
  try {
    assert.equal(t.command('hide').ok, false, 'no overlay');
    open(t, { displayMode: 'sidebar' });
    assert.equal(t.command('hide').ok, false, 'sidebar');
    t.controller.layout({ displayMode: 'popup', collapsed: true });
    assert.equal(t.command('hide').ok, false, 'collapsed');
    t.controller.layout({ collapsed: false });
    t.command('guide', { command: { op: 'filters', intro: false } });
    await settle(8);
    assert.equal(t.command('hide').ok, false, 'guide running');
    assert.notEqual(overlayFrame(t).style.getPropertyValue('display'), 'none');
  } finally { t.controller.dispose(); await settle(8); t.env.teardown(); }
});

test('a hidden popup still goes away with the page, and a replaced overlay never starts hidden', async () => {
  const t = await rig();
  try {
    open(t);
    t.command('hide');
    open(t);
    const fresh = overlayFrame(t);
    assert.equal(t.env.document.querySelectorAll('iframe[src$="overlay.html"]').length, 1);
    assert.equal(fresh.style.getPropertyValue('display'), 'block');
    assert.ok(pageInert(t));
    t.command('hide');
    t.env.window.dispatchEvent(new t.env.window.Event('pagehide'));
    assert.equal(t.env.document.querySelectorAll('iframe').length, 0, 'pagehide removes the hidden frame');
    assert.equal(pageInert(t), false);
    assert.equal(t.controller.isDisposed(), true);
  } finally { t.controller.dispose(); await settle(8); t.env.teardown(); }
});

test('the sidebar reserves its width on the right of the page, follows resizes and puts the page back exactly on every way out', async () => {
  const t = await rig();
  const root = t.env.document.documentElement, width = () => `${Math.min(440, t.env.window.innerWidth - 16)}px`;
  try {
    root.style.setProperty('margin-right', '3px');
    const before = root.getAttribute('style');
    const reserved = () => assert.deepEqual(css(root, 'margin-right'), [width(), 'important']);
    const restored = (label: string) => { assert.equal(root.getAttribute('style'), before, label); assert.deepEqual(css(root, 'margin-right'), ['3px', ''], label); };
    open(t, { displayMode: 'sidebar' });
    reserved();
    assert.equal(overlayFrame(t).style.getPropertyValue('width'), width(), 'the reserve is exactly the sidebar width');
    assert.equal(pageInert(t), false, 'the page beside the sidebar stays usable');
    Object.defineProperty(t.env.window, 'innerWidth', { configurable: true, value: 400 });
    t.env.window.dispatchEvent(new t.env.window.Event('resize'));
    assert.equal(width(), '384px');
    reserved();
    assert.equal(overlayFrame(t).style.getPropertyValue('width'), '384px', 'frame and reserve stay in step');
    t.controller.layout({ collapsed: true }); restored('collapse');
    t.controller.layout({ collapsed: false }); reserved();
    t.controller.layout({ displayMode: 'popup' }); restored('switch to popup');
    t.controller.layout({ displayMode: 'sidebar' }); reserved();
    open(t, { displayMode: 'popup' }); restored('replaced by a popup overlay');
    open(t, { displayMode: 'sidebar' }); reserved();
    open(t, { displayMode: 'sidebar' }); reserved();
    t.command('close'); restored('close');
    open(t, { displayMode: 'sidebar' }); reserved();
    t.env.window.dispatchEvent(new t.env.window.MessageEvent('message', { data: { type: 'treatable.site.dismiss' }, origin: 'chrome-extension://test', source: overlayFrame(t).contentWindow }));
    assert.equal(overlayFrame(t), null, 'dismissed');
    restored('dismiss');
    open(t, { displayMode: 'sidebar' }); reserved();
    t.env.window.dispatchEvent(new t.env.window.Event('pagehide'));
    restored('pagehide');
  } finally { t.controller.dispose(); await settle(8); t.env.teardown(); }
});

test('a page with no inline style gets none back, and dispose alone also releases the reserve', async () => {
  const t = await rig();
  try {
    const root = t.env.document.documentElement;
    assert.equal(root.hasAttribute('style'), false);
    open(t, { displayMode: 'sidebar' });
    assert.ok(root.hasAttribute('style'));
    t.controller.dispose();
    assert.equal(root.hasAttribute('style'), false, 'no empty style attribute is left behind');
  } finally { t.controller.dispose(); await settle(8); t.env.teardown(); }
});

test('fixed page elements under the sidebar are fitted: right-edge tabs move left, wide layers end at its edge, and all is put back', async () => {
  const t = await rig();
  const doc = t.env.document;
  const fixed = (id: string, styleText: string, rect: { left: number; right: number; height?: number }, parent: HTMLElement = doc.body) => {
    const element = doc.createElement('div'); element.id = id; element.setAttribute('style', styleText); parent.appendChild(element);
    element.getBoundingClientRect = () => ({ left: rect.left, right: rect.right, width: rect.right - rect.left, top: 0, bottom: rect.height ?? 40, height: rect.height ?? 40, x: rect.left, y: 0, toJSON() {} }) as DOMRect;
    return element;
  };
  try {
    // jsdom has no layout: the viewport is innerWidth (1024) wide, so a 440px sidebar starts at 584px.
    const toTop = fixed('to-top', 'position: fixed; right: -1px; bottom: 170px;', { left: 972, right: 1024 });
    const nudged = fixed('nudged', 'position: fixed; right: 20px; translate: 5px 0;', { left: 900, right: 1004 });
    const mask = fixed('mask', 'position: fixed; top: 0; left: 0; width: 100%; height: 100%;', { left: 0, right: 1024, height: 768 });
    const inner = fixed('inner', 'position: fixed; right: 0;', { left: 900, right: 1024 }, mask);
    const leftNav = fixed('left-nav', 'position: fixed; left: 0;', { left: 0, right: 200 });
    const staticRight = fixed('static-right', 'position: relative;', { left: 900, right: 1024 });
    const drawer = fixed('drawer', 'position: fixed; right: -300px; width: 300px;', { left: 1024, right: 1324 });
    open(t, { displayMode: 'sidebar' });
    const frame = overlayFrame(t);
    assert.deepEqual(css(toTop, 'translate'), ['-440px 0', 'important'], 'Back to top moves left of the sidebar');
    assert.deepEqual(css(nudged, 'translate'), ['-440px 0', 'important']);
    assert.deepEqual(css(mask, 'max-width'), ['584px', 'important'], 'a full-width layer ends at the sidebar');
    assert.deepEqual(css(mask, 'translate'), ['', '']);
    assert.deepEqual([css(inner, 'translate'), css(inner, 'max-width')], [['', ''], ['', '']], 'a fixed element inside a fitted one moves with it');
    assert.deepEqual([css(leftNav, 'translate'), css(staticRight, 'translate'), css(drawer, 'translate')], [['', ''], ['', ''], ['', '']], 'elements clear of the sidebar, not fixed, or parked off screen are left alone');
    assert.deepEqual(css(frame, 'translate'), ['', ''], 'Treatable’s own frame is not moved');
    // A tab the site adds later is fitted too.
    const late = fixed('late', 'position: fixed; right: 0; bottom: 10px;', { left: 990, right: 1024 });
    await settle(50);
    assert.deepEqual(css(late, 'translate'), ['-440px 0', 'important']);
    // A narrower window keeps the 440px sidebar but moves its edge; wide layers are refitted once the resize settles.
    Object.defineProperty(t.env.window, 'innerWidth', { configurable: true, value: 900 });
    t.env.window.dispatchEvent(new t.env.window.Event('resize'));
    await settle(50);
    assert.deepEqual(css(mask, 'max-width'), ['460px', 'important']);
    t.controller.layout({ collapsed: true });
    assert.deepEqual([css(toTop, 'translate'), css(late, 'translate'), css(mask, 'max-width')], [['', ''], ['', ''], ['', '']], 'everything is put back on collapse');
    assert.deepEqual(css(nudged, 'translate'), ['5px 0', ''], 'a value the site set itself comes back exactly');
    assert.equal(toTop.getAttribute('style'), 'position: fixed; right: -1px; bottom: 170px;');
    const lateAgain = fixed('late-again', 'position: fixed; right: 0;', { left: 990, right: 1024 });
    await settle(50);
    assert.deepEqual(css(lateAgain, 'translate'), ['', ''], 'nothing is watched or fitted once the sidebar is collapsed');
  } finally { t.controller.dispose(); await settle(8); t.env.teardown(); }
});
