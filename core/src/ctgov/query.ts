/**
 * The exact ClinicalTrials.gov API v2 request that a live search sends.
 *
 * Verified on 2026-10-24 against the official OpenAPI description served by the API
 * (https://clinicaltrials.gov/api/oas/v2, API version 2.0.5 from https://clinicaltrials.gov/api/v2/version)
 * and against live responses. One request is
 *
 *   GET https://clinicaltrials.gov/api/v2/studies?format=json
 *       &query.cond=<each search term as a quoted Essie phrase, joined with OR>
 *       &filter.overallStatus=RECRUITING|NOT_YET_RECRUITING|ENROLLING_BY_INVITATION|AVAILABLE
 *       &filter.advanced=SEARCH[Location](AREA[LocationCountry]"United States"[ AND AREA[LocationState]"<state name>"])
 *       &fields=<fixed field list>
 *       &sort=@relevance
 *       &pageSize=<1..25>
 *       &countTotal=true            (first page only)
 *       &pageToken=<token>          (later pages only; a token ClinicalTrials.gov returned)
 *
 * Without `sort` the API returns studies unsorted ("The returning studies are not sorted by default
 * for a performance reason"), so the request asks for `@relevance`, the order the website uses. The
 * OpenAPI description also requires every later page to repeat the first page's parameters except
 * countTotal, pageSize, and pageToken; search.ts binds each page token to the terms and state it
 * came from. pageSize is capped at 25 here (the API allows up to 1,000).
 *
 * The only user-derived values are the search terms and, optionally, one US state name. The country
 * is always the United States. SEARCH[Location](...) requires the country and the state to match on
 * the same study location, which is how the ClinicalTrials.gov website itself builds its location
 * filter. No ZIP code, city, coordinates, distance (filter.geo), age, sex, or other profile field is
 * ever part of the URL: the input type has no such fields, and buildStudiesUrl checks the result
 * against a fixed parameter allowlist.
 *
 * Search terms are sent as quoted phrases. ClinicalTrials.gov still applies its synonym expansion to
 * a quoted phrase (checked live: "heart attack" matches "Acute Myocardial Infarction"). Quoting keeps
 * user text from acting as Essie operators. Terms that contain a double quote or a backslash, or that
 * name a study ID, are refused before any request (isSendableSearchTerm in protocol.ts), because a
 * query holding only study IDs makes ClinicalTrials.gov ignore all filters (checked live).
 */
import { CoreError } from '../errors.ts';
import {
  MAX_SEARCH_PAGE_SIZE,
  PAGE_TOKEN_PATTERN,
  US_STATES,
  hasContactLikeContent,
  isSafeText,
  isSendableSearchTerm,
} from '../protocol.ts';
import { US_STATE_NAMES, type UsStateCode } from './states.ts';

export const CTGOV_ORIGIN = 'https://clinicaltrials.gov';
export const CTGOV_HOST = 'clinicaltrials.gov';
export const CTGOV_STUDIES_PATH = '/api/v2/studies';
export const CTGOV_STUDIES_URL = `${CTGOV_ORIGIN}${CTGOV_STUDIES_PATH}`;
export const CTGOV_COUNTRY = 'United States';
export const DEFAULT_SEARCH_PAGE_SIZE = 10;
export const MAX_SEARCH_TERMS = 5;
export const MAX_SEARCH_TERM_LENGTH = 100;
/** Fixed sort order: relevance to the search terms, as on the ClinicalTrials.gov website. */
export const CTGOV_SORT = '@relevance';
/**
 * Upper bound for a whole request URL. Long non-ASCII terms grow up to nine characters per character
 * when percent-encoded, so a search whose URL would be longer is refused before any request with
 * INPUT_TOO_LARGE. The same bound is planned for the general transport gate (task A1b).
 */
export const CTGOV_MAX_URL_LENGTH = 2048;

/**
 * Open statuses requested from ClinicalTrials.gov. Same set as ALLOWED_STATUSES in
 * scaffold/scripts/lib/ctgov.mjs at 48c569e. Records with any other status are skipped even if
 * ClinicalTrials.gov returns them.
 */
export const CTGOV_OPEN_STATUSES = ['RECRUITING', 'NOT_YET_RECRUITING', 'ENROLLING_BY_INVITATION', 'AVAILABLE'] as const;

/**
 * Fields requested from ClinicalTrials.gov (names from the API's study data structure; each one was
 * accepted by the live API on 2026-10-24). Detailed descriptions, outcomes, arms, and results are not
 * requested, which keeps pages small.
 */
export const CTGOV_FIELDS = [
  'NCTId',
  'BriefTitle',
  'OfficialTitle',
  'OverallStatus',
  'StudyType',
  'Phase',
  'Condition',
  'ConditionMeshTerm',
  'BriefSummary',
  'EligibilityCriteria',
  'MinimumAge',
  'MaximumAge',
  'Sex',
  'HealthyVolunteers',
  'LeadSponsorName',
  'LastUpdatePostDate',
  'LocationFacility',
  'LocationStatus',
  'LocationCity',
  'LocationState',
  'LocationZip',
  'LocationCountry',
  'LocationGeoPoint',
  'LocationContactName',
  'LocationContactRole',
  'LocationContactPhone',
  'LocationContactPhoneExt',
  'LocationContactEMail',
  'CentralContactName',
  'CentralContactRole',
  'CentralContactPhone',
  'CentralContactPhoneExt',
  'CentralContactEMail',
  'OverallOfficialName',
  'OverallOfficialRole',
] as const;

/** The only query parameters a ClinicalTrials.gov request may carry, in the order they are sent. */
export const CTGOV_QUERY_PARAMS = [
  'format',
  'query.cond',
  'filter.overallStatus',
  'filter.advanced',
  'fields',
  'sort',
  'pageSize',
  'countTotal',
  'pageToken',
] as const;

export interface StudiesQuery {
  readonly conditionTerms: readonly string[];
  readonly state?: UsStateCode | undefined;
  readonly pageSize: number;
  readonly pageToken?: string | undefined;
  readonly countTotal: boolean;
}

function assertTerms(terms: readonly string[]): void {
  if (!Array.isArray(terms) || terms.length < 1 || terms.length > MAX_SEARCH_TERMS) throw new CoreError('INVALID_REQUEST');
  for (const term of terms) {
    if (
      typeof term !== 'string' ||
      term.length < 1 ||
      term.length > MAX_SEARCH_TERM_LENGTH ||
      term.trim() !== term ||
      !isSafeText(term) ||
      hasContactLikeContent(term) ||
      !isSendableSearchTerm(term)
    ) {
      throw new CoreError('INVALID_REQUEST');
    }
  }
}

/** `"term one" OR "term two"`: each term is one quoted Essie phrase. */
export function conditionExpression(terms: readonly string[]): string {
  assertTerms(terms);
  return terms.map(term => `"${term}"`).join(' OR ');
}

/** The location filter: always the United States, and at most one state on the same location. */
export function locationExpression(state?: UsStateCode): string {
  const country = `AREA[LocationCountry]"${CTGOV_COUNTRY}"`;
  if (state === undefined) return `SEARCH[Location](${country})`;
  if (!(US_STATES as readonly string[]).includes(state)) throw new CoreError('INVALID_REQUEST');
  return `SEARCH[Location](${country} AND AREA[LocationState]"${US_STATE_NAMES[state]}")`;
}

/** Ordered [name, value] pairs of one request. */
export function studiesQueryParams(query: StudiesQuery): [string, string][] {
  if (!Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > MAX_SEARCH_PAGE_SIZE) {
    throw new CoreError('INVALID_REQUEST');
  }
  if (query.pageToken !== undefined && (typeof query.pageToken !== 'string' || !PAGE_TOKEN_PATTERN.test(query.pageToken))) {
    throw new CoreError('INVALID_REQUEST');
  }
  const params: [string, string][] = [
    ['format', 'json'],
    ['query.cond', conditionExpression(query.conditionTerms)],
    ['filter.overallStatus', CTGOV_OPEN_STATUSES.join('|')],
    ['filter.advanced', locationExpression(query.state)],
    ['fields', CTGOV_FIELDS.join('|')],
    ['sort', CTGOV_SORT],
    ['pageSize', String(query.pageSize)],
  ];
  if (query.countTotal && query.pageToken === undefined) params.push(['countTotal', 'true']);
  if (query.pageToken !== undefined) params.push(['pageToken', query.pageToken]);
  return params;
}

/** Percent-encodes with encodeURIComponent (ECMAScript built-in; no URL or URLSearchParams host API). */
export function encodeQuery(params: readonly (readonly [string, string])[]): string {
  return params.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('&');
}

/** The complete request URL. The parameter names are checked against CTGOV_QUERY_PARAMS. */
export function buildStudiesUrl(query: StudiesQuery): string {
  const params = studiesQueryParams(query);
  const names = params.map(([name]) => name);
  const allowed: readonly string[] = CTGOV_QUERY_PARAMS;
  if (names.some(name => !allowed.includes(name)) || new Set(names).size !== names.length) throw new CoreError('INTERNAL_ERROR');
  const url = `${CTGOV_STUDIES_URL}?${encodeQuery(params)}`;
  if (url.length > CTGOV_MAX_URL_LENGTH) throw new CoreError('INPUT_TOO_LARGE');
  return url;
}

/** True only for a URL with the exact https origin and path and a query string (a cheap first check). */
export function isCtgovStudiesUrl(url: string): boolean {
  return typeof url === 'string' && url.startsWith(`${CTGOV_STUDIES_URL}?`) && !url.includes('#');
}

function decodeComponent(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    throw new CoreError('INVALID_ENDPOINT');
  }
}

/**
 * Recovers the StudiesQuery from a request URL and proves that the URL is exactly what
 * buildStudiesUrl produces for it: same parameters, same order, same encoding, and nothing else.
 * The transport seam runs this on every ClinicalTrials.gov request, so a URL that carries anything
 * beyond the search terms, the United States, at most one state, the fixed parameters, a page size,
 * and a ClinicalTrials.gov page token never reaches the transport port. Throws INVALID_ENDPOINT.
 */
export function parseStudiesUrl(url: string): StudiesQuery {
  if (!isCtgovStudiesUrl(url) || url.length > CTGOV_MAX_URL_LENGTH) throw new CoreError('INVALID_ENDPOINT');
  const values = new Map<string, string>();
  for (const part of url.slice(CTGOV_STUDIES_URL.length + 1).split('&')) {
    const at = part.indexOf('=');
    if (at <= 0) throw new CoreError('INVALID_ENDPOINT');
    const name = decodeComponent(part.slice(0, at));
    if (values.has(name) || !(CTGOV_QUERY_PARAMS as readonly string[]).includes(name)) throw new CoreError('INVALID_ENDPOINT');
    values.set(name, decodeComponent(part.slice(at + 1)));
  }
  const cond = values.get('query.cond');
  if (cond === undefined || cond.length < 2 || !cond.startsWith('"') || !cond.endsWith('"')) throw new CoreError('INVALID_ENDPOINT');
  // Terms cannot contain a double quote (isSendableSearchTerm), so this split is unambiguous.
  const conditionTerms = cond.slice(1, -1).split('" OR "');
  const advanced = values.get('filter.advanced');
  let state: UsStateCode | undefined;
  if (advanced !== locationExpression()) {
    state = US_STATES.find(code => locationExpression(code) === advanced);
    if (state === undefined) throw new CoreError('INVALID_ENDPOINT');
  }
  const pageSizeText = values.get('pageSize') ?? '';
  if (!/^[1-9]\d{0,1}$/.test(pageSizeText)) throw new CoreError('INVALID_ENDPOINT');
  const countTotal = values.get('countTotal');
  if (countTotal !== undefined && countTotal !== 'true') throw new CoreError('INVALID_ENDPOINT');
  const query: StudiesQuery = {
    conditionTerms,
    state,
    pageSize: Number(pageSizeText),
    pageToken: values.get('pageToken'),
    countTotal: countTotal === 'true',
  };
  let rebuilt: string;
  try {
    rebuilt = buildStudiesUrl(query);
  } catch {
    throw new CoreError('INVALID_ENDPOINT');
  }
  if (rebuilt !== url) throw new CoreError('INVALID_ENDPOINT');
  return query;
}
