import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom-harness';
import { HOME_FORM_LIVE, NARROW_CLOSED, STATUS_USER, TYPE_LIVE, homePage, narrowSearchPage, searchPage, collapsedSearchPage } from './guide-fixtures';

const finders = () => import('../src/guide-finders');

test('Recruiting is found by value and label, never a lookalike (owner markup and live capture)', async () => {
  const { findRecruiting } = await finders();
  for (const status of [STATUS_USER, undefined]) {
    const env = installDom(searchPage(status === undefined ? {} : { status }));
    try {
      const found = findRecruiting(env.document)!;
      assert.ok(found, 'found');
      assert.equal((found.input as HTMLInputElement).value, 'rec');
      assert.equal(found.input.id, 'adv-check0-status1');
      assert.equal(found.via, 'label-and-value');
      assert.equal(found.anchor.tagName, 'LABEL', 'the hidden input is represented by its visible label');
      assert.match(found.anchor.textContent!, /^Recruiting/);
      assert.doesNotMatch(found.anchor.textContent!, /Not yet|Active|Enrolling/);
    } finally { env.teardown(); }
  }
});

test('Recruiting falls back to the label alone, the value alone, then the known id', async () => {
  const { findRecruiting } = await finders();
  const env = installDom(searchPage({ status: STATUS_USER.replace('value="rec"', 'value="open"') }));
  try {
    const found = findRecruiting(env.document)!;
    assert.equal(found.via, 'label');
    assert.equal(found.input.id, 'adv-check0-status1');
  } finally { env.teardown(); }
  const valueOnly = installDom(searchPage({ status: STATUS_USER.replace('>Recruiting <', '>Open for enrolment <') }));
  try {
    const found = findRecruiting(valueOnly.document)!;
    assert.equal(found.via, 'value');
    assert.equal(found.input.id, 'adv-check0-status1');
  } finally { valueOnly.teardown(); }
  const idOnly = installDom(searchPage({ status: STATUS_USER.replace('value="rec"', 'value="open"').replace('>Recruiting <', '>Open for enrolment <') }));
  try {
    const found = findRecruiting(idOnly.document)!;
    assert.equal(found.via, 'id');
    assert.equal(found.input.id, 'adv-check0-status1');
  } finally { idOnly.teardown(); }
});

test('Recruiting is never confused with "Not yet recruiting" or "Active, not recruiting" when its own box is gone', async () => {
  const { findRecruiting } = await finders();
  const withoutRecruiting = STATUS_USER.replace(/<div class="usa-checkbox"><input type="checkbox" id="adv-check0-status1"[\s\S]*?<\/label><\/div>/, '');
  assert.notEqual(withoutRecruiting, STATUS_USER);
  const env = installDom(searchPage({ status: withoutRecruiting }));
  try { assert.equal(findRecruiting(env.document), null); } finally { env.teardown(); }
});

test('Interventional is found by its label in the Study Type group, not Observational or the expanded-access options', async () => {
  const { findInterventional } = await finders();
  const env = installDom(searchPage());
  try {
    const found = findInterventional(env.document)!;
    assert.equal((found.input as HTMLInputElement).value, 'int');
    assert.equal(found.via, 'label-and-value');
    assert.match(found.anchor.textContent!, /^Interventional/);
    assert.equal(found.input.id, 'adv-check0-studyType0');
  } finally { env.teardown(); }
  const noLabel = installDom(searchPage({ type: TYPE_LIVE.replace('>Interventional <', '>Treatment trials <') }));
  try {
    const found = findInterventional(noLabel.document)!;
    assert.equal(found.via, 'value');
    assert.equal((found.input as HTMLInputElement).value, 'int');
  } finally { noLabel.teardown(); }
  const idOnly = installDom(searchPage({ type: TYPE_LIVE.replace('>Interventional <', '>Treatment trials <').replace('value="int"', 'value="x"') }));
  try {
    const found = findInterventional(idOnly.document)!;
    assert.equal(found.via, 'id');
    assert.equal(found.input.id, 'adv-check0-studyType0');
  } finally { idOnly.teardown(); }
  const gone = installDom(searchPage());
  try {
    gone.document.getElementById('adv-check0-studyType0')!.closest('.usa-checkbox')!.remove();
    assert.equal(findInterventional(gone.document), null, 'no lookalike is accepted when the box is gone');
  } finally { gone.teardown(); }
});

test('the Condition/disease and Location fields are found by accessible name on the home and search pages', async () => {
  const { findConditionField, findLocationField } = await finders();
  for (const [name, html] of [['home', homePage()], ['search', searchPage()]] as const) {
    const env = installDom(html);
    try {
      const condition = findConditionField(env.document)!;
      assert.ok(condition, `${name}: condition`);
      assert.equal(condition.input.id, 'advcond');
      assert.equal(condition.via, 'accessible-name');
      const location = findLocationField(env.document)!;
      assert.ok(location, `${name}: location`);
      assert.equal(location.input.id, 'location-input');
    } finally { env.teardown(); }
  }
  const renamed = installDom(homePage().replace('aria-label="Condition/disease"', 'aria-label="Disease"').replace(/<label[^>]*for="advcond"[^>]*>[^<]*<\/label>/, ''));
  try {
    const found = findConditionField(renamed.document)!;
    assert.equal(found.via, 'id', 'falls back to the known id');
    assert.equal(found.input.id, 'advcond');
  } finally { renamed.teardown(); }
});

test('the filters toggle is found by name: Show on a wide screen, Focus Your Search on a narrow one', async () => {
  const { findFiltersToggle } = await finders();
  const wide = installDom(collapsedSearchPage());
  try {
    const toggle = findFiltersToggle(wide.document)!;
    assert.equal(toggle.textContent!.trim(), 'Show');
  } finally { wide.teardown(); }
  const narrow = installDom(narrowSearchPage());
  try {
    const toggle = findFiltersToggle(narrow.document)!;
    assert.equal(toggle.getAttribute('aria-controls'), 'focus-your-search-modal');
    assert.match(toggle.textContent!, /Focus Your Search/);
  } finally { narrow.teardown(); }
  const expanded = installDom(searchPage());
  try {
    const toggle = findFiltersToggle(expanded.document);
    assert.equal(toggle, null, 'an open panel has no opener: Hide, Clear Filters and Apply Filters are not ways to open it');
  } finally { expanded.teardown(); }
});

test('the Apply Filters button is found by name, with the known id as a fallback', async () => {
  const { findApplyFilters } = await finders();
  const env = installDom(searchPage());
  try {
    assert.equal(findApplyFilters(env.document)!.id, 'apply-filters');
    env.document.getElementById('apply-filters')!.textContent = 'Go';
    assert.equal(findApplyFilters(env.document)!.id, 'apply-filters', 'id fallback');
    env.document.getElementById('apply-filters')!.remove();
    assert.equal(findApplyFilters(env.document), null);
  } finally { env.teardown(); }
});

test('page kind recognises the home, search and study pages only on exact paths', async () => {
  const { pageKind } = await finders();
  assert.equal(pageKind('https://clinicaltrials.gov/'), 'home');
  assert.equal(pageKind('https://clinicaltrials.gov'), 'home');
  assert.equal(pageKind('https://clinicaltrials.gov/search?cond=asthma'), 'search');
  assert.equal(pageKind('https://clinicaltrials.gov/search/'), 'search');
  assert.equal(pageKind('https://clinicaltrials.gov/study/NCT01234567?tab=table'), 'study');
  assert.equal(pageKind('https://clinicaltrials.gov/study/NCT0123456'), 'other');
  assert.equal(pageKind('https://clinicaltrials.gov/about-site/about-ctg'), 'other');
  assert.equal(pageKind('not a url'), 'other');
});

test('fixtures are real captures: the narrow modal is closed and the home page has no Recruiting checkbox', async () => {
  const { findRecruiting } = await finders();
  assert.match(NARROW_CLOSED, /aria-controls="focus-your-search-modal"/);
  assert.match(HOME_FORM_LIVE, /id="advcond"/);
  const env = installDom(homePage());
  try { assert.equal(findRecruiting(env.document), null); } finally { env.teardown(); }
});
