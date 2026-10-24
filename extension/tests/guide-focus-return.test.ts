import test from 'node:test';
import assert from 'node:assert/strict';
import Swal from 'sweetalert2/dist/sweetalert2.esm.js';
import { installDom, settle } from './dom-harness';

// This file holds one test on purpose. sweetalert2 keeps the element to return focus to in module state,
// so a second test in the same process would start from the first test's leftovers.
test('guide dialogs ask sweetalert2 to return focus, and focus goes back to the control that was in use', async () => {
  const env = installDom('<!doctype html><html><body><button id="trigger">Open the guide</button></body></html>');
  const fire = Swal.fire;
  const configs: Array<Record<string, unknown>> = [];
  (Swal as any).fire = function (this: unknown, config: Record<string, unknown>) { configs.push(config); return fire.call(this, config as any); };
  try {
    const { createGuideMount } = await import('../src/guide-mount');
    const trigger = env.document.getElementById('trigger') as HTMLButtonElement;
    trigger.focus();
    assert.equal(env.document.activeElement, trigger);
    const mount = createGuideMount(env.document, { css: '' });
    const choice = mount.fire({ title: 'Tick Recruiting', body: ['Find the box.'], next: 'Next', skip: 'Skip' });
    await settle();
    assert.equal(configs.length, 1);
    assert.equal(configs[0].returnFocus, true, 'a guide dialog returns focus when it closes');
    assert.notEqual(env.document.activeElement, trigger, 'the dialog took focus while it was open');
    (mount.root.querySelector('.swal2-cancel') as HTMLButtonElement).click();
    assert.equal(await choice, 'skip');
    // sweetalert2 puts focus back 100 ms after the dialog is removed.
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(env.document.activeElement, trigger, 'focus is back on the control the person was using');
    mount.dispose();
  } finally {
    (Swal as any).fire = fire;
    env.teardown();
  }
});
