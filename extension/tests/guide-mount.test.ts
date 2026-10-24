import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom, settle } from './dom-harness';

const swalCssPath = new URL('../node_modules/sweetalert2/dist/sweetalert2.min.css', import.meta.url);

test('the mount renders sweetalert2 inside its own shadow root and leaves the page tree alone', async () => {
  const env = installDom('<!doctype html><html><body><main id="page"><button id="b">Page button</button></main></body></html>');
  try {
    const { createGuideMount, GUIDE_HOST_ATTRIBUTE } = await import('../src/guide-mount');
    const pageBefore = env.document.getElementById('page')!.outerHTML;
    const mount = createGuideMount(env.document, { css: readFileSync(swalCssPath, 'utf8') });
    assert.equal(env.document.querySelectorAll(`[${GUIDE_HOST_ATTRIBUTE}]`).length, 1);
    const choice = mount.fire({ title: 'Tick Recruiting', body: ['Find the box.', 'Then tick it.'], next: 'Next', back: 'Back', skip: 'Skip' });
    await settle();
    const popup = mount.root.querySelector('.swal2-popup') as HTMLElement;
    assert.ok(popup, 'popup is inside the shadow root');
    assert.equal(env.document.querySelector('.swal2-popup'), null, 'nothing leaked into the light DOM');
    assert.equal(env.document.getElementById('page')!.outerHTML, pageBefore);
    assert.equal(popup.getAttribute('aria-modal'), 'false');
    assert.equal(popup.querySelector('.swal2-title')!.textContent, 'Tick Recruiting');
    assert.equal(popup.querySelectorAll('#swal2-html-container p').length, 2);
    for (const label of ['Next', 'Back', 'Skip']) assert.ok([...popup.querySelectorAll('button')].some(b => b.textContent === label), label);
    (popup.querySelector('.swal2-cancel') as HTMLButtonElement).click();
    assert.equal(await choice, 'skip');
    mount.dispose();
    assert.equal(env.document.querySelectorAll(`[${GUIDE_HOST_ATTRIBUTE}]`).length, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(env.document.body, 'querySelector'), false, 'the querySelector bridge is removed');
  } finally { env.teardown(); }
});

test('next, back, programmatic close and replacement resolve with distinct choices', async () => {
  const env = installDom();
  try {
    const { createGuideMount } = await import('../src/guide-mount');
    const mount = createGuideMount(env.document, { css: '' });
    let pending = mount.fire({ title: 'A', body: ['a'], next: 'Next', back: 'Back' });
    await settle();
    (mount.root.querySelector('.swal2-confirm') as HTMLButtonElement).click();
    assert.equal(await pending, 'next');
    pending = mount.fire({ title: 'B', body: ['b'], next: 'Next', back: 'Back' });
    await settle();
    (mount.root.querySelector('.swal2-deny') as HTMLButtonElement).click();
    assert.equal(await pending, 'back');
    pending = mount.fire({ title: 'C', body: ['c'], skip: 'Skip' });
    await settle();
    assert.equal(mount.hasDialog, true);
    mount.closeActive();
    assert.equal(await pending, 'closed');
    const first = mount.fire({ title: 'D', body: ['d'], skip: 'Skip' });
    await settle();
    const second = mount.fire({ title: 'E', body: ['e'], skip: 'Skip' });
    assert.equal(await first, 'closed', 'a replaced dialog never reports a choice');
    await settle();
    assert.equal(mount.root.querySelector('.swal2-title')!.textContent, 'E');
    mount.closeActive();
    assert.equal(await second, 'closed');
    mount.dispose();
  } finally { env.teardown(); }
});

test('dialog text is inserted as text, never as markup', async () => {
  const env = installDom();
  try {
    const { createGuideMount } = await import('../src/guide-mount');
    const mount = createGuideMount(env.document, { css: '' });
    const pending = mount.fire({ title: '<img src=x onerror=alert(1)>', body: ['<b>bold</b> <script>1</script>'], skip: 'Skip' });
    await settle();
    assert.equal(mount.root.querySelector('img:not(.swal2-image)'), null);
    assert.equal(mount.root.querySelector('script'), null);
    assert.equal(mount.root.querySelector('b'), null);
    assert.match(mount.root.querySelector('.swal2-title')!.textContent!, /<img src=x/);
    mount.closeActive();
    await pending;
    mount.dispose();
  } finally { env.teardown(); }
});

test('the vendor stylesheet is scoped to the shadow root: tokens move to :host and the host is click-through', async () => {
  const { scopeSwalCss, GUIDE_CSS } = await import('../src/guide-style');
  const css = readFileSync(swalCssPath, 'utf8');
  assert.match(css, /:root\{/, 'the packaged sheet declares its tokens on :root');
  const scoped = scopeSwalCss(css);
  assert.doesNotMatch(scoped, /:root/);
  assert.match(scoped, /:host\{--swal2-/);
  assert.match(GUIDE_CSS, /\.swal2-container\s*\{[^}]*pointer-events:\s*none/);
  assert.match(GUIDE_CSS, /\.swal2-popup\s*\{[^}]*pointer-events:\s*auto/);
});
