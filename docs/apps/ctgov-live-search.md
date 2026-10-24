# Live ClinicalTrials.gov search (task A2)

Status: stage 1 of task A2 on `feature/core-a2-fcc`. Not yet reviewed. The record-set pinning contract that this search feeds is described in `record-set-pinning.md` and needs the independent A2r security re-review.

Code: `core/src/ctgov/` (`query.ts`, `transport-seam.ts`, `client.ts`, `normalize.ts`, `search.ts`, `states.ts`). Tests: `core/tests/ctgov.test.ts` (mocked). Opt-in live run: `core/scripts/ctgov-live-smoke.ts`.

## 1. Official documentation check (2026-10-24)

| Source | URL | What was checked |
| --- | --- | --- |
| API reference page | https://clinicaltrials.gov/data-api/api | The page renders the OpenAPI description below; its static HTML has no other content. |
| OpenAPI description | https://clinicaltrials.gov/api/oas/v2 | `openapi: 3.0.3`, `info.version: 2.0.5`; every `GET /studies` parameter, the `PagedStudies` response, and the `Status`, `Phase`, `StudyType`, `Sex`, `ContactRole`, and `PartialDate` schemas. |
| Version endpoint | https://clinicaltrials.gov/api/v2/version | `apiVersion` 2.0.5, `dataTimestamp` 2026-10-23T09:00:04. |
| Field metadata | https://clinicaltrials.gov/api/v2/studies/metadata | Each of the 35 requested field names resolves to the JSON path that `normalize.ts` reads (for example `LocationGeoPoint` to `protocolSection.contactsLocationsModule.locations.geoPoint`, `ConditionMeshTerm` to `derivedSection.conditionBrowseModule.meshes.term`). |
| Search expression syntax | https://clinicaltrials.gov/find-studies/constructing-complex-search-queries (linked from the OpenAPI description) | The `SEARCH[Location](AREA[LocationCountry]United States AND AREA[LocationState]...)` form, which requires the country and the state to match on the same study location. |

Facts taken from these sources:

- `pageSize`: "maximum number of studies to return in response. It does not have to be the same for every page. If not specified or set to 0, the default value will be used [10]. It will be coerced down to 1,000, if greater than that." The core caps it at 25.
- `pageToken`: "Set it to a `nextPageToken` value returned with the previous page in JSON format. Do not specify it for first page." The last page has no `nextPageToken`, and "A page may have empty `studies` array."
- "Request for each subsequent page **must** have the same parameters as for the first page, except `countTotal`, `pageSize`, and `pageToken` parameters."
- `countTotal`: returns `totalCount` with the first page; "ignored for the subsequent pages".
- "The returning studies are not sorted by default for a performance reason"; `sort=@relevance` sorts by relevance to the query.
- "If any query parameter contains only NCT IDs (comma- and/or space-separated), filters are ignored." Search terms that name a study ID are therefore refused (`isSendableSearchTerm`), so the United States filter always applies.
- `filter.geo` (a distance function over coordinates) exists. The core never uses it.
- Status, phase, study type, and sex enums match `OVERALL_STATUSES`, `PHASES`, `STUDY_TYPES`, and `ELIGIBILITY_SEX` in `protocol.ts` (the core adds `UNKNOWN` for a missing sex). Dates may be `yyyy`, `yyyy-MM`, or `yyyy-MM-dd`; a year-only last-update date is kept as unknown.
- Rate limits: the OpenAPI description and the site's API pages state no numeric limit (searched on 2026-10-24). Third-party write-ups report about 50 requests per minute per address. The client therefore starts requests at least 1.25 seconds apart (at most 48 per minute) and honors `Retry-After`.

## 2. The request

One request per page:

```
GET https://clinicaltrials.gov/api/v2/studies
  ?format=json
  &query.cond="<term 1>" OR "<term 2>" ...                      (1 to 5 user search terms, each a quoted phrase)
  &filter.overallStatus=RECRUITING|NOT_YET_RECRUITING|ENROLLING_BY_INVITATION|AVAILABLE
  &filter.advanced=SEARCH[Location](AREA[LocationCountry]"United States"[ AND AREA[LocationState]"<state name>"])
  &fields=<35 fixed field names>
  &sort=@relevance
  &pageSize=<1..25>
  &countTotal=true                                              (first page only)
  &pageToken=<token>                                            (later pages only)
Accept: application/json                                        (the only header)
```

- Query parameter names, in this order, and no others: `format`, `query.cond`, `filter.overallStatus`, `filter.advanced`, `fields`, `sort`, `pageSize`, `countTotal`, `pageToken` (`CTGOV_QUERY_PARAMS`).
- Header set: exactly `Accept: application/json`. No `Authorization`, cookies, `OpenAI-Beta`, or custom headers; no body.
- The whole URL is at most 2,048 characters (`CTGOV_MAX_URL_LENGTH`); a longer search is refused with `INPUT_TOO_LARGE` before any request. Five 100-character ASCII terms, a state, and a 64-character page token fit.
- Values are percent-encoded with `encodeURIComponent`.

What ClinicalTrials.gov receives from the user: the search terms exactly as entered (after NFC normalization and trimming), and at most one US state, sent as its full name. The country is always the United States. The request has no field for a ZIP code, city, coordinates, distance, age, date of birth, sex, name, contact detail, or note, and the transport guard refuses any request that differs from what the builder produces. Search terms are refused when they contain a run of five digits, `@`, `://`, a double quote, a backslash, or a word starting with `NCT` followed by digits. Like any web request, it also reveals the device's network address and the host HTTP stack's connection metadata to ClinicalTrials.gov. Distance to study sites is computed by local screening (task A1b) and is not part of any ClinicalTrials.gov request.

### Transport guard

`createCtgovTransport` wraps the host's transport port. For every request it checks the method (`GET`), the absence of a body, the header set, and the URL: `parseStudiesUrl` recovers the terms, state, page size, page token, and `countTotal` from the URL and requires `buildStudiesUrl` of that query to equal the URL byte for byte. It then passes a rebuilt, frozen request (URL, the one header, and the cancellation signal only) to the port. A refused request throws `INVALID_ENDPOINT` and never reaches the port. The client always uses this guard. The general transport gate of task A1b currently allows only OpenAI endpoints; reconciling the branches must add an equivalent ClinicalTrials.gov rule there.

## 3. Client behavior

| Bound | Value | Where |
| --- | --- | --- |
| Records per `searchTrials` | at most `pageSize` (1 to 25, default 10) | `search.ts` |
| Pages per `searchTrials` | at most 3, only to fill `pageSize` after empty or unreadable pages | `MAX_SEARCH_PAGES_PER_REQUEST` |
| Response body | 8 MiB, read with a hard cap (streamed bodies stop at the cap) | `CTGOV_LIMITS.maxResponseBytes` |
| JSON nesting | 32 levels, checked before parsing | `withinJsonDepth` |
| Attempts per page | 3 (the first request and at most two retries) | `CTGOV_LIMITS.maxAttempts` |
| Attempt timeout | 20 s, through the clock port | `CTGOV_LIMITS.attemptTimeoutMs` |
| Whole search | 60 s including waits and retries | `CTGOV_LIMITS.searchBudgetMs` |
| Request pacing | at least 1.25 s between request starts | `CTGOV_LIMITS.minIntervalMs` |
| Longest honored `Retry-After` | 10 s; longer ends the search | `CTGOV_LIMITS.maxRetryAfterMs` |
| Record shown to the user | 40 KiB serialized; a full page of 25 fits the 1 MiB response bound | `MAX_STUDY_RECORD_BYTES` |
| Session record set | 250 records, oldest evicted first | `MAX_SESSION_RECORDS` |

Tests may lower these limits; no limit can be raised.

Retries: 429 (`RATE_LIMITED`) and 503 (`API_ERROR`) honor `Retry-After` given as delta seconds or an IMF-fixdate; any other form falls back to exponential backoff. 500, 502, 504, timeouts, and network failures back off exponentially from 1 s with up to 0.5 s of jitter from the token port. A retry resends the identical URL. Other statuses, a non-JSON content type, invalid UTF-8, nesting beyond the limit, invalid JSON, a missing or oversized `studies` array, an invalid `nextPageToken`, or an invalid `totalCount` fail at once with `INVALID_API_RESPONSE` or `OUTPUT_TOO_LARGE`. Errors are constant codes; response bodies are never echoed.

Cancellation: the search takes a `CancelSignal` (a WHATWG `AbortSignal` satisfies it). Cancelling aborts the request in flight (the transport receives an aborted signal), stops a backoff or pacing wait, and fails the search with `CANCELLED`. A failed or cancelled search commits nothing.

Pagination: `searchTrials` returns `nextPageToken` when more pages exist. A later `searchTrials` may pass only the latest token the core returned for the same terms and state; any other token is refused with `INVALID_REQUEST` before a request. Later pages repeat the first page's parameters, as the API requires.

## 4. Records

`normalizeStudy` treats every response value as untrusted:

- A study is skipped (counted in `skippedRecords`) when its NCT ID, title, or status is invalid, its status is not one of the requested open statuses, it has no United States location, or (with a state) no location in that state, or it is a repeat.
- Free text has control, bidirectional-override, and lone-surrogate characters removed; single-line fields have line breaks turned into spaces; long text is cut by UTF-8 bytes. Text that reads like instructions or HTML is kept as literal text: the core never interprets it, and hosts must render record text as plain text.
- Condition and MeSH terms are kept only when already clean single-line text of at most 300 characters, and are never changed, because a consented condition term must equal one of them exactly.
- Structured values (ages, roles, ZIP codes, coordinates, emails, dates) must match strict patterns or are dropped, so missing information stays unknown.
- Only United States locations are kept (at most 500), and contacts (at most 20) come from central contacts, overall officials, and contacts of United States locations. Contacts and locations are shown to the user locally; they are not part of any model-bound payload.
- `sourceUrl` is built from the NCT ID (`https://clinicaltrials.gov/study/NCT...`), never taken from the response. `retrievedAt` is the clock-port time at which the record's page arrived.
- Each record is fitted to 40 KiB; every field shortened on the way is listed in `truncatedFields`. The full record is at `sourceUrl`.

## 5. Cache

There is no cache. Every result has `source: "live"`, and records exist only in the session's memory until `endSession`. A future public cache must be a separate store, label its results `source: "public_cache"`, keep each record's original `retrievedAt`, and be shown as cached data with that timestamp.

## 6. Live smoke run (labeled LIVE)

Command, from `core/`: `TREATABLE_LIVE_CTGOV=1 npm run smoke:ctgov-live` (Node 22.23.3). It searches "asthma" in Colorado with page size 5, fetches page 2 with the returned token, and builds one pinned preview locally. It makes no OpenAI request and prints only counts, NCT IDs, `retrievedAt`, and `sourceUrl`. Output on 2026-10-24:

```
LIVE page 1: totalCount=23 records=5 skipped=0 nextPage=yes retrievedAt=2026-10-24T13:08:37.565Z
LIVE   NCT03762395, NCT07052942, NCT06270576, NCT07671001, NCT07456033 (each with retrievedAt=2026-10-24T13:08:37.565Z and sourceUrl=https://clinicaltrials.gov/study/<NCT ID>)
LIVE page 2: records=5 skipped=0 nextPage=yes retrievedAt=2026-10-24T13:08:38.879Z
LIVE   NCT07301255, NCT07219173, NCT06977581, NCT06609239, NCT06307665 (same form)
LIVE session record set: 10 records
LIVE local pinned preview: decisionsRequests=1 bytes=4478
```

The live API accepted every requested field, `sort=@relevance`, and the location filter, and returned page 2 for the page token 1.3 s after page 1 (request pacing).
