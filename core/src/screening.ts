/**
 * Deterministic local screening (task A1b).
 *
 * Port of the structured half of scaffold/lib/eligibility/hardFilters.ts (screenStudy, ageInYears,
 * ALLOWED_STATUSES, haversineMiles, nearestDistance) and the coordinate helpers in
 * extension/src/core.ts (nearestSite; resolveZip lives in zip.ts) at commit 48c569e. The rules keep
 * the steering semantics:
 *   - Deterministic only: every decision comes from structured fields or is "unknown". Missing
 *     information is never guessed into a mismatch, and nothing here calls a model.
 *   - Distance is local and informational. `outOfRadius` reports a travel preference going beyond
 *     the nearest site, and never changes the bucket: distance is not a medical exclusion.
 *   - Time is injected. The caller passes the clock's now-milliseconds, so tests are reproducible
 *     and no host global is touched. Staleness compares calendar dates: a record is stale when its
 *     lastUpdatePostDate is strictly before the civil date two calendar years before now (the
 *     scaffold used `new Date()` and Date arithmetic; core/src forbids Date, so this is exact
 *     civil-date arithmetic instead, which differs from the port only within the boundary day at
 *     exact midnight UTC).
 *   - Screening only studies the session has: nctIds that were never returned by searchTrials are
 *     RECORD_NOT_IN_SESSION, so no operation can probe the registry by_id. (The scaffold compared
 *     against a whole local corpus; the session-scoped rule is the live-data counterpart.)
 * Task A2 owns searchTrials and calls rememberRecords with its live result pages; what the session
 * digest covers is A2's decision. Task A5 renders the user-facing language; the protocol result
 * here carries only structured outcomes (no note strings), deliberately.
 */
import { CoreError } from './errors.ts';
import type { HandlerContext } from './dispatcher.ts';
import { StudyRecordSchema, type OperationResult, type RequestPayload, type StudyRecord } from './protocol.ts';
import { defineSlot, type Session } from './session.ts';
import { loadZipTable, resolveZip, type ZipTable } from './zip.ts';

/** Statuses that can list a recruiting-style record, ported from hardFilters.ts. */
export const ALLOWED_STATUSES: ReadonlySet<string> = new Set([
  'RECRUITING',
  'NOT_YET_RECRUITING',
  'ENROLLING_BY_INVITATION',
  'AVAILABLE',
]);

/**
 * Parses a ClinicalTrials.gov age string ("18 Years", "24 Months", "6 Weeks", "7 Days") into years.
 * Unstated and non-numeric answers stay undefined, so an age band is never invented. Exact port of
 * ageInYears in hardFilters.ts, including the N/A shortcut and unit conversion.
 */
export function ageInYears(raw: string | null | undefined): number | undefined {
  if (!raw || /^n\/?a$/i.test(raw)) return undefined;
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*(Years?|Months?|Weeks?|Days?)$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const u = (m[2] ?? '').toLowerCase();
  return u.startsWith('year') ? n : u.startsWith('month') ? n / 12 : u.startsWith('week') ? n * 7 / 365.25 : n / 365.25;
}

/** Approximate great-circle miles between two coordinates. Exact port of haversineMiles. */
export function haversineMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (n: number) => (n * Math.PI) / 180;
  const dlat = rad(b.lat - a.lat);
  const dlon = rad(b.lon - a.lon);
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlon / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

/** A point the user is near: either given directly or resolved from a US ZIP (approximate). */
export interface Coords {
  readonly lat: number;
  readonly lon: number;
}

/**
 * Shortest distance in miles from the user's coordinates to a located study site, or undefined when
 * neither applies. Port of nearestDistance in hardFilters.ts over the record's site geocoordinates.
 */
export function nearestDistanceMiles(record: StudyRecord, from: Coords): number | undefined {
  let best: number | undefined = undefined;
  for (const location of record.locations) {
    if (!location.geo) continue;
    const d = haversineMiles(from, location.geo);
    if (best === undefined || d < best) best = d;
  }
  return best;
}

/**
 * The study site closest to the user, for local display only. Port of nearestSite in
 * extension/src/core.ts: without coordinates the first listed site is returned, and a record with
 * no located sites falls back to its first site either way. Unlike the extension it does not sort
 * (and so cannot reorder) the record's locations: the minimum is found in place.
 */
export function nearestSite(record: StudyRecord, from: Coords | undefined): StudyRecord['locations'][number] | undefined {
  const locations = record.locations;
  if (from === undefined) return locations[0];
  let best: StudyRecord['locations'][number] | undefined = undefined;
  let bestMiles = Infinity;
  for (const location of locations) {
    if (!location.geo) continue;
    const d = haversineMiles(from, location.geo);
    if (d < bestMiles) {
      bestMiles = d;
      best = location;
    }
  }
  return best ?? locations[0];
}

// -------------------------------------------------------------------------------------------
// Civil dates (pure integer arithmetic; no Date anywhere, see file header)
// -------------------------------------------------------------------------------------------

interface CivilDate {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number; // 1-31
}

/** Converts days since 1970-01-01 to a civil date (Hinnant's civil_from_days; pure integer math). */
function civilFromDays(days: number): CivilDate {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const month = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return { year: month <= 2 ? y + 1 : y, month, day };
}

/** The civil date of a wall-clock time, truncated to whole days. */
export function civilDateOf(nowMs: number): CivilDate {
  return civilFromDays(Math.floor(nowMs / 86_400_000));
}

/**
 * Parses a ClinicalTrials.gov date into a civil date, or null. Month-only dates ("2020-01") count
 * as their first day, and impossible months or days are null, which (as with the scaffold's Invalid
 * Date) never counts as stale.
 */
function civilDateFromRecordDate(text: string): CivilDate | null {
  if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(text)) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = text.length === 10 ? Number(text.slice(8, 10)) : 1;
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** True when the record's last update is strictly before the civil date two calendar years back. */
export function isStaleRecord(record: StudyRecord, nowMs: number): boolean {
  const update = record.lastUpdatePostDate !== null ? civilDateFromRecordDate(record.lastUpdatePostDate) : null;
  if (update === null) return false;
  const cutoff = civilDateOf(nowMs);
  const yearsBack = { year: cutoff.year - 2, month: cutoff.month, day: cutoff.day };
  return (
    update.year < yearsBack.year ||
    (update.year === yearsBack.year &&
      (update.month < yearsBack.month || (update.month === yearsBack.month && update.day < yearsBack.day)))
  );
}

// -------------------------------------------------------------------------------------------
// Session records and the ZIP table cache
// -------------------------------------------------------------------------------------------

/** Session-scoped study records (results of this session's searches only). */
export const STUDY_RECORDS = defineSlot<readonly StudyRecord[]>('session.studyRecords');
/** The ZIP table parsed once per session; wiped with every other slot at endSession. */
const ZIP_TABLE = defineSlot<ZipTable>('session.zipTable');

/** The session accepts at most this many records; whole-registry dumps are INPUT_TOO_LARGE. */
export const MAX_SESSION_RECORDS = 1000;

type CheckStatus = OperationResult<'screenLocal'>['results'][number]['checks'][number]['status'];
type ScreenEntry = OperationResult<'screenLocal'>['results'][number];
type ScreenProfile = RequestPayload<'screenLocal'>['profile'];

/**
 * Validates public study records and remembers them for this session. Only records that passed
 * StudyRecordSchema can be screened or previewed later, and duplicate NCT IDs are rejected rather
 * than silently deduplicated, so the caller learns its pages overlap. The call replaces the
 * remembered set; task A2 owns how pages accumulate (it can merge before calling, and it owns the
 * subject digest and mutation bookkeeping when records arrive). Throws INPUT_TOO_LARGE,
 * INVALID_REQUEST, or a session error.
 */
export function rememberRecords(session: Session, records: readonly unknown[]): readonly StudyRecord[] {
  if (records.length > MAX_SESSION_RECORDS) throw new CoreError('INPUT_TOO_LARGE');
  const seen = new Set<string>();
  const validated: StudyRecord[] = [];
  for (const record of records) {
    const parsed = StudyRecordSchema.safeParse(record);
    if (!parsed.success) throw new CoreError('INVALID_REQUEST');
    if (seen.has(parsed.data.nctId)) throw new CoreError('INVALID_REQUEST');
    seen.add(parsed.data.nctId);
    validated.push(parsed.data);
  }
  session.set(STUDY_RECORDS, validated);
  return validated;
}

async function zipTableFor(ctx: HandlerContext): Promise<ZipTable> {
  const cached = ctx.session.get(ZIP_TABLE);
  if (cached !== undefined) return cached;
  const table = await loadZipTable(ctx.ports, ctx.signal);
  ctx.session.set(ZIP_TABLE, table);
  return table;
}

/** The user's coordinates for screening: direct lat/lon passes through, a ZIP resolves locally. */
export async function coordinatesForProfile(
  ctx: HandlerContext,
  location: ScreenProfile['location'],
): Promise<Coords | undefined> {
  if (location === undefined) return undefined;
  if ('lat' in location) return { lat: location.lat, lon: location.lon };
  const resolved = resolveZip(location.zip, await zipTableFor(ctx));
  return { lat: resolved.lat, lon: resolved.lon };
}

// -------------------------------------------------------------------------------------------
// The screening itself
// -------------------------------------------------------------------------------------------

/**
 * Screens one public record against one profile, deterministically. The three structured checks:
 *   - age: unmet only when the record states a range and the shared age is outside it;
 *   - sex: unmet only when the record states a restriction that excludes the shared value;
 *   - status: met only for the statuses that can list a recruiting-style record; UNKNOWN status
 *     stays unknown, closed statuses are unmet.
 * The bucket keeps the ported precedence: any unmet -> known_mismatch, else any unknown -> unknown,
 * else no_known_mismatch. Distance and staleness are reported and never change the bucket.
 */
export function screenStudyRecord(
  record: StudyRecord,
  profile: ScreenProfile,
  from: Coords | undefined,
  nowMs: number,
): ScreenEntry {
  const minimum = ageInYears(record.eligibility.minimumAge);
  const maximum = ageInYears(record.eligibility.maximumAge);
  const age = profile.ageYears;
  const ageStatus: CheckStatus =
    minimum === undefined && maximum === undefined
      ? 'unknown'
      : age === undefined
        ? 'unknown'
        : (minimum !== undefined && age < minimum) || (maximum !== undefined && age > maximum)
          ? 'unmet'
          : 'met';

  const recordSex = record.eligibility.sex;
  const sexStatus: CheckStatus =
    recordSex === 'UNKNOWN' || profile.sex === undefined || profile.sex === 'prefer_not_to_say'
      ? 'unknown'
      : recordSex === 'ALL' || recordSex === profile.sex.toUpperCase()
        ? 'met'
        : 'unmet';

  const statusStatus: CheckStatus =
    record.status === 'UNKNOWN' ? 'unknown' : ALLOWED_STATUSES.has(record.status) ? 'met' : 'unmet';

  const checks: ScreenEntry['checks'] = [
    { rule: 'age', status: ageStatus },
    { rule: 'sex', status: sexStatus },
    { rule: 'status', status: statusStatus },
  ];
  const bucket: ScreenEntry['bucket'] = checks.some(c => c.status === 'unmet')
    ? 'known_mismatch'
    : checks.some(c => c.status === 'unknown')
      ? 'unknown'
      : 'no_known_mismatch';

  const distance = from === undefined ? undefined : nearestDistanceMiles(record, from);
  const radius = profile.travelRadiusMiles;
  const outOfRadius =
    distance !== undefined && radius !== undefined && radius !== 'anywhere' && distance > radius;

  return {
    nctId: record.nctId,
    bucket,
    checks,
    distanceMiles: distance === undefined ? null : distance,
    outOfRadius,
    stale: isStaleRecord(record, nowMs),
  };
}

/**
 * The built-in screenLocal pipeline: screens records this session returned against the shared
 * profile. A ZIP resolves through the locally bundled table (an unresolvable ZIP is
 * INVALID_REQUEST, and the host can offer screening without location); records and nctIds outside
 * this session are RECORD_NOT_IN_SESSION. This function makes no network request: it reads only
 * the session, the bundled table through the Loader port, and the injected clock.
 */
export async function screenLocalPipeline(
  ctx: HandlerContext,
  payload: RequestPayload<'screenLocal'>,
): Promise<OperationResult<'screenLocal'>> {
  const records = ctx.session.get(STUDY_RECORDS);
  if (records === undefined) throw new CoreError('RECORD_NOT_IN_SESSION');
  const byId = new Map(records.map(record => [record.nctId, record] as const));
  const from = await coordinatesForProfile(ctx, payload.profile.location);
  const nowMs = ctx.ports.clock.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new CoreError('INTERNAL_ERROR');
  return {
    results: payload.nctIds.map(nctId => {
      const record = byId.get(nctId);
      if (record === undefined) throw new CoreError('RECORD_NOT_IN_SESSION');
      return screenStudyRecord(record, payload.profile, from, nowMs);
    }),
  };
}
