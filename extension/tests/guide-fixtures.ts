import { readFileSync } from 'node:fs';

/** Real ClinicalTrials.gov markup captured with headless Chrome on 2026-10-24, plus the owner-supplied status markup. */
export const fixture = (name: string) => readFileSync(new URL(`./fixtures/ctgov/${name}`, import.meta.url), 'utf8');

export const STATUS_LIVE = fixture('search-filter-status.html');
export const STATUS_USER = fixture('status-user-supplied.html');
export const TYPE_LIVE = fixture('search-filter-type.html');
export const SEARCH_FORM_LIVE = fixture('search-page-form.html');
export const HOME_FORM_LIVE = fixture('home-search-form.html');
export const NARROW_CLOSED = fixture('search-filters-panel-narrow-closed.html');
export const DESKTOP_COLLAPSED = fixture('search-filters-panel-desktop-collapsed.html');

const shell = (body: string) => `<!doctype html><html><head><title>Test</title></head><body>${body}</body></html>`;

export interface SearchPageOptions { status?: string; type?: string; form?: string }

/** A wide search page: the Focus Your Search panel is open and shows the search fields and both filter groups. */
export function searchPage(options: SearchPageOptions = {}) {
  const { status = STATUS_LIVE, type = TYPE_LIVE, form = SEARCH_FORM_LIVE } = options;
  return shell(`<main id="app"><ctg-focus-your-search-panel><div class="filters-panel"><div class="filters-panel-header"><div class="show-hide-container"><button class="usa-button usa-button--unstyled expand-button"><span>Hide</span></button></div></div><div id="panel-body">${form}${status}${type}</div><div class="filters-panel-footer"><button type="button" id="clear-filters" class="usa-button secondary-button">Clear Filters (0)</button><button type="button" id="apply-filters" class="usa-button primary-button" disabled>Apply Filters</button></div></div></ctg-focus-your-search-panel><div id="results"><ctg-search-hit-card><a href="/study/NCT00000001">A study</a></ctg-search-hit-card></div></main>`);
}

/** The home page: only the search form, with no checkbox filters. */
export function homePage() {
  return shell(`<main id="app">${HOME_FORM_LIVE}</main>`);
}

/** A narrow search page: the filters live in a closed modal that a toggle button opens. */
export function narrowSearchPage() {
  const modal = NARROW_CLOSED.replace(/(<div class="is-hidden usa-modal-wrapper"[^>]*>)/, `$1<div id="narrow-body">${SEARCH_FORM_LIVE}${STATUS_LIVE}${TYPE_LIVE}</div>`);
  return shell(`<main id="app">${modal}</main>`);
}

/** The wide search page after the person pressed Hide: the whole panel body is gone and only Show remains. */
export function collapsedSearchPage() {
  return shell(`<main id="app">${DESKTOP_COLLAPSED}</main>`);
}
