import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { clearLegacyPatientData, STORAGE_KEY } from '../src/storage';
import { ONBOARDING_FLAG_KEY, ONBOARDING_STEP_KEY } from '../src/guide-state';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const srcNames = readdirSync(new URL('../src/', import.meta.url)).filter(name => /\.(ts|tsx)$/.test(name));
const sources = srcNames.map(name => ({ name, text: read(`../src/${name}`) }));
const guideSources = sources.filter(source => /^(guide-|use-guide)/.test(source.name));

test('only the guide state module touches extension storage beyond the existing deletion-only legacy cleanup', () => {
  const touching = sources.filter(({ text }) => /\bstorage\??\.(local|session)\b|\.storage\b/.test(text)).map(source => source.name).sort();
  assert.deepEqual(touching, ['background.ts', 'guide-state.ts', 'ranking-consent.ts', 'ui-prefs.ts', 'use-private-matching.ts'] /* ui-prefs.ts is the display preferences module; ranking-consent.ts holds one fixed session-only marker (strict test in hardening.test.ts); use-private-matching.ts and background.ts only call the deletion-only legacy cleanup */);
  const state = sources.find(source => source.name === 'guide-state.ts')!.text;
  assert.deepEqual(state.match(/\.(set|get|remove|clear|getKeys|getBytesInUse|setAccessLevel|onChanged)\(/g)?.map(call => call.slice(1, -1)).sort().filter((v, i, all) => all.indexOf(v) === i), ['get', 'remove', 'set']);
  assert.doesNotMatch(state, /\.(clear|getKeys|getBytesInUse|setAccessLevel|onChanged)\b/);
  // Every write names one of the two constants; nothing computed from input is ever a key.
  for (const call of state.match(/\.(set|remove)\([^)]*\)/g) ?? []) assert.match(call, /ONBOARDING_(FLAG|STEP)_KEY/, call);
  assert.equal(ONBOARDING_FLAG_KEY, 'treatable.onboardingVersion');
  assert.equal(ONBOARDING_STEP_KEY, 'treatable.onboardingStep');
});

test('the legacy patient-data cleanup removes only its own key and never the onboarding values', async () => {
  const removed: string[] = [];
  const area = { remove: async (key: string) => { removed.push(key); } };
  await clearLegacyPatientData(area, area);
  assert.deepEqual([...new Set(removed)], [STORAGE_KEY]);
  assert.ok(!removed.includes(ONBOARDING_FLAG_KEY) && !removed.includes(ONBOARDING_STEP_KEY));
});

test('guide code makes no network request, runs no dynamic code and writes no markup from text', () => {
  assert.ok(guideSources.length >= 9);
  for (const { name, text } of guideSources) {
    assert.doesNotMatch(text, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts/, `${name}: network`);
    assert.doesNotMatch(text, /\beval\s*\(|new Function|document\.write|innerHTML|insertAdjacentHTML|outerHTML\s*=/, `${name}: dynamic code or markup`);
    assert.doesNotMatch(text, /\btemplate\s*:/, `${name}: sweetalert2 template option parses code attributes`);
    assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|document\.cookie|console\./, `${name}: storage or logging`);
  }
});

test('sweetalert2 is pinned to one exact version and the installed copy has no locale- or domain-gated behaviour', () => {
  const pkg = JSON.parse(read('../package.json'));
  assert.match(pkg.dependencies.sweetalert2, /^\d+\.\d+\.\d+$/, 'exact version, no range');
  const installed = JSON.parse(read('../node_modules/sweetalert2/package.json'));
  assert.equal(installed.version, pkg.dependencies.sweetalert2);
  const lock = JSON.parse(read('../package-lock.json'));
  assert.equal(lock.packages['node_modules/sweetalert2'].version, pkg.dependencies.sweetalert2);
  assert.ok(Number(installed.version.split('.')[0]) === 11 && Number(installed.version.split('.')[1]) >= 4, 'a release after the 11.4.9 protestware');
  for (const file of ['sweetalert2.esm.js', 'sweetalert2.min.css']) {
    const code = read(`../node_modules/sweetalert2/dist/${file}`);
    // Versions 11.4.9 and later of some lines shipped code that reads the browser language and the host name,
    // writes a timestamp to web storage, then disables the page and plays audio on .ru, .su, .by and .рф sites.
    assert.doesNotMatch(code, /navigator\.language|navigator\.languages|location\.(host|hostname|href)|window\.location|document\.location/, `${file}: locale or host check`);
    assert.doesNotMatch(code, /localStorage|sessionStorage|swal-initiation|document\.cookie/, `${file}: web storage`);
    assert.doesNotMatch(code, /new Audio|createElement\(['"]audio|\.mp3|\.play\(\)|xn--p1ai|flag-gimn/, `${file}: audio or domain gate`);
    assert.doesNotMatch(code, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/, `${file}: network`);
    assert.doesNotMatch(code, /@import|url\(\s*['"]?https?:/, `${file}: remote resources`);
  }
  assert.ok(pkg.devDependencies.jsdom.match(/^\d/), 'jsdom, used only by tests, is pinned too');
});

test('the manifest asks for no new permission and no new host for the guide', () => {
  const manifest = JSON.parse(read('../manifest.json'));
  assert.deepEqual(manifest.permissions.slice().sort(), ['nativeMessaging', 'scripting', 'storage']);
  assert.equal(manifest.host_permissions, undefined, 'hosts come from sites.json at build time, unchanged');
  assert.equal(manifest.optional_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined, 'there is still no always-on content script');
  for (const dir of ['dist']) {
    if (!existsSync(new URL(`../${dir}/manifest.json`, import.meta.url))) continue;
    const built = JSON.parse(read(`../${dir}/manifest.json`));
    assert.deepEqual(built.host_permissions, ['https://clinicaltrials.gov/*', 'https://www.clinicaltrials.gov/*']);
    assert.deepEqual(built.permissions.slice().sort(), ['nativeMessaging', 'scripting', 'storage']);
  }
});

test('the built content script and overlay bundle sweetalert2 and its stylesheet with no remote loading', () => {
  for (const dir of ['dist']) {
    const content = read(`../${dir}/site-content.js`);
    assert.match(content, /swal2-popup/, `${dir}: stylesheet text is bundled`);
    assert.match(content, /data-treatable-guide-host/, `${dir}: the guide host is in the content script`);
    assert.doesNotMatch(content, /<link|@import|importScripts/, dir);
    const urls = [...new Set(content.match(/https?:\/\/[A-Za-z0-9./_-]+/g) ?? [])].sort();
    assert.deepEqual(urls, ['https://clinicaltrials.gov', 'https://sweetalert2.github.io/', 'https://www.clinicaltrials.gov'], `${dir}: the only URL strings are the two registry origins and a vendor message link`);
    const overlay = read(`../${dir}/overlay.js`);
    assert.match(overlay, /Replay intro/, `${dir}: the panel includes the intro tour`);
    assert.match(overlay, /swal2-popup/, `${dir}: the panel bundles its own dialog styles`);
    assert.doesNotMatch(read(`../${dir}/overlay.css`), /swal2/, `${dir}: dialog styles stay in the shadow root, not the panel stylesheet`);
  }
});
