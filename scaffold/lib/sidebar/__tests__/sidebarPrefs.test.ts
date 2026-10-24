import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampWidth,
  defaultOpenSections,
  defaultSidebarPrefs,
  normalizeOpenSections,
  normalizeSidebarPrefs,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '../sidebarPrefs';

/**
 * FE-07 redesign — persistent-sidebar UI prefs. Pure coercion/clamp helpers the
 * SidebarProvider relies on. No storage is exercised here (that path degrades to
 * defaults under node); these assert the first-visit contract and normalization.
 */
describe('sidebarPrefs', () => {
  test('first-visit default is expanded with only Account open', () => {
    const prefs = defaultSidebarPrefs();
    assert.equal(prefs.expanded, true);
    assert.equal(prefs.width, SIDEBAR_DEFAULT_WIDTH);
    assert.deepEqual(prefs.openSections, {
      settings: false,
      grants: false,
      descriptions: false,
      account: true,
      billing: false,
    });
  });

  test('clampWidth keeps values inside [MIN, MAX] and rounds', () => {
    assert.equal(clampWidth(SIDEBAR_MIN_WIDTH - 100), SIDEBAR_MIN_WIDTH);
    assert.equal(clampWidth(SIDEBAR_MAX_WIDTH + 100), SIDEBAR_MAX_WIDTH);
    assert.equal(clampWidth(300.6), 301);
    assert.equal(clampWidth(Number.NaN), SIDEBAR_DEFAULT_WIDTH);
    assert.equal(clampWidth(Number.POSITIVE_INFINITY), SIDEBAR_DEFAULT_WIDTH);
  });

  test('normalizeOpenSections fills gaps from the default and honors booleans', () => {
    // A partial object: account explicitly closed, grants opened.
    const result = normalizeOpenSections({ account: false, grants: true, junk: 'x' });
    assert.equal(result.account, false);
    assert.equal(result.grants, true);
    // Untouched ids fall back to the first-visit default.
    assert.equal(result.settings, false);
    assert.equal(result.billing, false);
  });

  test('normalizeOpenSections returns defaults for non-objects', () => {
    assert.deepEqual(normalizeOpenSections(null), defaultOpenSections());
    assert.deepEqual(normalizeOpenSections('nope'), defaultOpenSections());
  });

  test('normalizeSidebarPrefs coerces a full stored object', () => {
    const stored = {
      expanded: false,
      width: 9999,
      openSections: { settings: true, account: false },
    };
    const prefs = normalizeSidebarPrefs(stored);
    assert.equal(prefs.expanded, false); // returning user's collapse respected
    assert.equal(prefs.width, SIDEBAR_MAX_WIDTH); // clamped
    assert.equal(prefs.openSections.settings, true);
    assert.equal(prefs.openSections.account, false);
  });

  test('normalizeSidebarPrefs falls back to defaults for garbage', () => {
    assert.deepEqual(normalizeSidebarPrefs(undefined), defaultSidebarPrefs());
    assert.deepEqual(normalizeSidebarPrefs(42), defaultSidebarPrefs());
  });
});
