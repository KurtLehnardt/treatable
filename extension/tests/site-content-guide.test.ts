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
  return { env, controller, command, sent, guideEvents, hosts, handlers };
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
    assert.equal(frame.style.getPropertyValue('width'), `${Math.min(760, t.env.window.innerWidth - 24)}px`, 'popup width, not the 440px overlay width');
    assert.equal(frame.style.getPropertyValue('transform'), 'translate(-50%,-50%)');
    // While the page is covered by a popup the rest of the page is inert; collapsing frees it for the guide.
    const main = t.env.document.getElementById('app') as any;
    assert.equal(main.inert, true);
    t.controller.layout({ collapsed: true });
    assert.ok(!main.inert, 'collapsed panel leaves the page usable for the guide steps');
  } finally { t.controller.dispose(); await settle(8); t.env.teardown(); }
});
