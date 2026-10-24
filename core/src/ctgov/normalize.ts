/**
 * Strict normalization of one ClinicalTrials.gov API v2 study into the StudyRecord shown to the user.
 *
 * Port of normalizeStudy (scaffold/scripts/lib/ctgov.mjs at commit 48c569e), rewritten for hostile
 * input. Every value from ClinicalTrials.gov is untrusted:
 *   - required fields (NCT ID, title, status) must be valid, or the record is skipped;
 *   - free text is sanitized: control characters other than tab and line feed, bidirectional
 *     override and isolate characters, and lone surrogates are removed or replaced; single-line fields
 *     have line breaks turned into spaces; long text is cut by UTF-8 bytes, never by characters;
 *   - condition and condition MeSH terms are kept only when they are already clean single-line text
 *     of at most 300 characters, and are never changed, because a consented condition term must equal
 *     one of them byte for byte (record-set pinning, docs/apps/record-set-pinning.md);
 *   - structured values (dates, ages, roles, ZIP codes, coordinates, emails) must match strict patterns
 *     or are dropped, so missing information stays unknown;
 *   - only United States locations are kept, and a record without one (or, when a state was chosen,
 *     without one in that state) is skipped, even if ClinicalTrials.gov returned it;
 *   - sourceUrl is built from the NCT ID, never taken from the response;
 *   - text that reads like instructions (prompt injection) is kept as inert data: it is never
 *     interpreted, and it can only appear inside the bounded fields above.
 * Each record is fitted to MAX_STUDY_RECORD_BYTES; every field shortened on the way is listed in
 * truncatedFields.
 */
import { truncateUtf8, utf8ByteLength } from '../bytes.ts';
import {
  CTGOV_DATE_PATTERN,
  ELIGIBILITY_SEX,
  MAX_STUDY_RECORD_BYTES,
  NCT_ID_PATTERN,
  OVERALL_STATUSES,
  PHASES,
  STUDY_RECORD_TRUNCATABLE_FIELDS,
  STUDY_TYPES,
  StudyRecordSchema,
  isSafeText,
  type StudyRecord,
} from '../protocol.ts';
import { CTGOV_COUNTRY } from './query.ts';

export const MAX_RECORD_TITLE_CHARS = 600;
export const MAX_RECORD_SUMMARY_BYTES = 6000;
export const MAX_RECORD_CRITERIA_BYTES = 14000;
export const MAX_RECORD_TERMS = 100;
export const MAX_RECORD_TERM_CHARS = 300;
export const MAX_RECORD_LOCATIONS = 500;
export const MAX_RECORD_CONTACTS = 20;

type TruncatableField = StudyRecord['truncatedFields'][number];
type StudyLocation = StudyRecord['locations'][number];
type StudyContact = StudyRecord['contacts'][number];

export type SkipReason = 'not_object' | 'nct_id' | 'title' | 'status' | 'no_us_location' | 'state' | 'too_large' | 'schema';

export type NormalizeResult = { readonly ok: true; readonly record: StudyRecord } | { readonly ok: false; readonly reason: SkipReason };

export interface NormalizeContext {
  /** ISO timestamp of the moment the page holding this record was received. */
  readonly retrievedAt: string;
  /** Statuses that were requested; any other status is skipped. */
  readonly statuses: readonly string[];
  /** Full ClinicalTrials.gov state name when the user chose a state. */
  readonly stateName?: string | undefined;
}

type Raw = Record<string, unknown>;

function obj(value: unknown): Raw | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : undefined;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// C0 and C1 controls except tab, line feed, and carriage return; bidirectional embeddings, overrides,
// and isolates. Mirrors the characters isSafeText rejects.
const UNSAFE_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

function fixSurrogates(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i]! + text[i + 1]!;
        i += 1;
      } else out += '�';
    } else if (unit >= 0xdc00 && unit <= 0xdfff) out += '�';
    else out += text[i]!;
  }
  return out;
}

/** Cuts to at most `max` UTF-16 units without splitting a surrogate pair. */
function truncateChars(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end).trimEnd();
}

/** Single-line display text: controls removed, line breaks and tabs become spaces, runs of spaces collapse. */
export function sanitizeLine(value: unknown, maxChars: number): { text: string; truncated: boolean } | undefined {
  if (typeof value !== 'string') return undefined;
  const text = fixSurrogates(value).replace(/[\r\n\t]+/g, ' ').replace(UNSAFE_CHARS, '').replace(/ {2,}/g, ' ').trim();
  if (!text) return undefined;
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: truncateChars(text, maxChars), truncated: true };
}

/** Multi-line display text: controls removed, CR LF and CR become LF, cut to `maxBytes` UTF-8 bytes. */
export function sanitizeMultiline(value: unknown, maxBytes: number): { text: string; truncated: boolean } {
  if (typeof value !== 'string') return { text: '', truncated: false };
  const text = fixSurrogates(value).replace(/\r\n?/g, '\n').replace(UNSAFE_CHARS, '').trim();
  const cut = truncateUtf8(text, maxBytes);
  return { text: cut.truncated ? cut.text.trimEnd() : cut.text, truncated: cut.truncated };
}

/**
 * Condition and MeSH terms are kept exactly as published or not at all: a term is kept only if it is
 * a string of 1 to 300 characters that is already safe single-line text. Exact duplicates are dropped.
 */
function exactTerms(values: unknown[]): { terms: string[]; dropped: boolean } {
  const terms: string[] = [];
  let dropped = false;
  for (const value of values) {
    if (typeof value !== 'string' || value.length < 1 || value.length > MAX_RECORD_TERM_CHARS || !isSafeText(value) || !value.trim()) {
      dropped = true;
      continue;
    }
    if (terms.includes(value)) continue;
    if (terms.length >= MAX_RECORD_TERMS) {
      dropped = true;
      continue;
    }
    terms.push(value);
  }
  return { terms, dropped };
}

const AGE_PATTERN = /^\d{1,3}(?:\.\d{1,2})? (?:Years?|Months?|Weeks?|Days?|Hours?|Minutes?)$/;
const ROLE_PATTERN = /^[A-Z][A-Z_]{0,59}$/;
const LOCATION_STATUS_PATTERN = /^[A-Z][A-Z_]{0,39}$/;
const ZIP_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]{0,19}$/;
const EMAIL_PATTERN = /^[^\s@<>()"',;:]{1,64}@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]+$/;

function age(value: unknown): string | null {
  return typeof value === 'string' && AGE_PATTERN.test(value) ? value : null;
}

function geo(value: unknown): StudyLocation['geo'] | undefined {
  const point = obj(value);
  const lat = point?.lat;
  const lon = point?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return undefined;
  return { lat, lon };
}

function location(raw: Raw): { location: StudyLocation; truncated: boolean } {
  let truncated = false;
  const line = (value: unknown, max: number): string | undefined => {
    const cleaned = sanitizeLine(value, max);
    if (cleaned?.truncated) truncated = true;
    return cleaned?.text;
  };
  const facility = line(raw.facility, 300);
  const city = line(raw.city, 120);
  const state = line(raw.state, 80);
  const zip = typeof raw.zip === 'string' && ZIP_PATTERN.test(raw.zip) ? raw.zip : undefined;
  const status = typeof raw.status === 'string' && LOCATION_STATUS_PATTERN.test(raw.status) ? raw.status : undefined;
  const point = geo(raw.geoPoint);
  return {
    location: {
      ...(facility !== undefined ? { facility } : {}),
      ...(city !== undefined ? { city } : {}),
      ...(state !== undefined ? { state } : {}),
      ...(zip !== undefined ? { zip } : {}),
      country: CTGOV_COUNTRY,
      ...(status !== undefined ? { status } : {}),
      ...(point !== undefined ? { geo: point } : {}),
    },
    truncated,
  };
}

function contact(raw: Raw): StudyContact | undefined {
  const name = sanitizeLine(raw.name, 200)?.text;
  const role = typeof raw.role === 'string' && ROLE_PATTERN.test(raw.role) ? raw.role : undefined;
  const phoneText = sanitizeLine(raw.phone, 60);
  const phone = phoneText && !phoneText.truncated && /\d/.test(phoneText.text) ? phoneText.text : undefined;
  const extText = sanitizeLine(raw.phoneExt, 20);
  const phoneExt = phone !== undefined && extText && !extText.truncated ? extText.text : undefined;
  const email = typeof raw.email === 'string' && raw.email.length <= 254 && EMAIL_PATTERN.test(raw.email) ? raw.email : undefined;
  if (name === undefined && phone === undefined && email === undefined) return undefined;
  return {
    ...(name !== undefined ? { name } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(phoneExt !== undefined ? { phoneExt } : {}),
    ...(email !== undefined ? { email } : {}),
  };
}

function recordBytes(record: StudyRecord): number {
  return utf8ByteLength(JSON.stringify(record));
}

/** Largest n in [0, max] for which ok(n) holds, assuming ok is monotonic (true up to some n). */
function largest(max: number, ok: (n: number) => boolean): number {
  let low = 0;
  let high = max;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ok(mid)) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Shrinks a record to MAX_STUDY_RECORD_BYTES in a fixed order: locations (keeping locations in the
 * chosen state first), then criteria, summary, contacts, MeSH terms, and conditions. Returns undefined
 * when even that does not fit.
 */
function fitRecord(record: StudyRecord, stateName: string | undefined, flags: Set<TruncatableField>): StudyRecord | undefined {
  if (recordBytes(record) <= MAX_STUDY_RECORD_BYTES) return record;
  let current = record;
  const fits = (candidate: StudyRecord) => recordBytes(candidate) <= MAX_STUDY_RECORD_BYTES;

  const ordered =
    stateName === undefined
      ? current.locations
      : [...current.locations.filter(l => l.state === stateName), ...current.locations.filter(l => l.state !== stateName)];
  const withLocations = (n: number): StudyRecord => ({ ...current, locations: ordered.slice(0, n) });
  const keepLocations = largest(ordered.length, n => fits(withLocations(n)));
  if (keepLocations < ordered.length) {
    flags.add('locations');
    current = withLocations(keepLocations);
  }
  if (fits(current)) return current;

  const criteria = current.eligibility.criteria;
  const withCriteria = (n: number): StudyRecord => ({
    ...current,
    eligibility: { ...current.eligibility, criteria: truncateUtf8(criteria, n).text },
  });
  const criteriaBytes = largest(utf8ByteLength(criteria), n => fits(withCriteria(n)));
  if (criteriaBytes < utf8ByteLength(criteria)) {
    current = withCriteria(criteriaBytes);
    flags.add('criteria');
  }
  if (fits(current)) return current;

  const summary = current.summary;
  const withSummary = (n: number): StudyRecord => ({ ...current, summary: truncateUtf8(summary, n).text });
  const summaryBytes = largest(utf8ByteLength(summary), n => fits(withSummary(n)));
  if (summaryBytes < utf8ByteLength(summary)) {
    current = withSummary(summaryBytes);
    flags.add('summary');
  }
  if (fits(current)) return current;

  for (const field of ['contacts', 'meshTerms', 'conditions'] as const) {
    const values = current[field] as unknown[];
    const withList = (n: number): StudyRecord => ({ ...current, [field]: values.slice(0, n) }) as StudyRecord;
    const keep = largest(values.length, n => fits(withList(n)));
    if (keep < values.length) {
      flags.add(field);
      current = withList(keep);
    }
    if (fits(current)) return current;
  }
  return undefined;
}

const ALL_FLAGS: readonly TruncatableField[] = STUDY_RECORD_TRUNCATABLE_FIELDS;

function orderedFlags(flags: ReadonlySet<TruncatableField>): TruncatableField[] {
  return ALL_FLAGS.filter(field => flags.has(field));
}

export function normalizeStudy(raw: unknown, context: NormalizeContext): NormalizeResult {
  const study = obj(raw);
  const protocol = obj(study?.protocolSection);
  if (!study || !protocol) return { ok: false, reason: 'not_object' };
  const identification = obj(protocol.identificationModule);
  const nctId = identification?.nctId;
  if (typeof nctId !== 'string' || !NCT_ID_PATTERN.test(nctId)) return { ok: false, reason: 'nct_id' };

  const flags = new Set<TruncatableField>();
  const title = sanitizeLine(identification?.briefTitle, MAX_RECORD_TITLE_CHARS) ?? sanitizeLine(identification?.officialTitle, MAX_RECORD_TITLE_CHARS);
  if (!title) return { ok: false, reason: 'title' };
  if (title.truncated) flags.add('title');

  const statusModule = obj(protocol.statusModule);
  const status = statusModule?.overallStatus;
  if (
    typeof status !== 'string' ||
    !(OVERALL_STATUSES as readonly string[]).includes(status) ||
    !context.statuses.includes(status)
  ) {
    return { ok: false, reason: 'status' };
  }

  const contactsModule = obj(protocol.contactsLocationsModule);
  const usRawLocations = arr(contactsModule?.locations)
    .map(obj)
    .filter((l): l is Raw => l !== undefined && l.country === CTGOV_COUNTRY);
  if (!usRawLocations.length) return { ok: false, reason: 'no_us_location' };
  if (context.stateName !== undefined && !usRawLocations.some(l => l.state === context.stateName)) return { ok: false, reason: 'state' };

  const locations: StudyLocation[] = [];
  for (const rawLocation of usRawLocations) {
    if (locations.length >= MAX_RECORD_LOCATIONS) {
      flags.add('locations');
      break;
    }
    const result = location(rawLocation);
    if (result.truncated) flags.add('locations');
    locations.push(result.location);
  }

  // Contacts are shown locally only; they never enter a model-bound payload (ModelStudySchema has no
  // such field). Sources: central contacts, overall officials, and contacts of US locations.
  const contactSources = [
    ...arr(contactsModule?.centralContacts),
    ...arr(contactsModule?.overallOfficials),
    ...usRawLocations.flatMap(l => arr(l.contacts)),
  ];
  const contacts: StudyContact[] = [];
  const seen = new Set<string>();
  for (const value of contactSources) {
    const rawContact = obj(value);
    const parsed = rawContact ? contact(rawContact) : undefined;
    if (!parsed) continue;
    const key = JSON.stringify([parsed.name ?? '', parsed.phone ?? '', parsed.email ?? ''].map(v => v.toLowerCase()));
    if (seen.has(key)) continue;
    seen.add(key);
    if (contacts.length >= MAX_RECORD_CONTACTS) {
      flags.add('contacts');
      break;
    }
    contacts.push(parsed);
  }

  const conditions = exactTerms(arr(obj(protocol.conditionsModule)?.conditions));
  if (conditions.dropped) flags.add('conditions');
  const meshes = arr(obj(obj(study.derivedSection)?.conditionBrowseModule)?.meshes).map(m => obj(m)?.term);
  const meshTerms = exactTerms(meshes);
  if (meshTerms.dropped) flags.add('meshTerms');

  const summary = sanitizeMultiline(obj(protocol.descriptionModule)?.briefSummary, MAX_RECORD_SUMMARY_BYTES);
  if (summary.truncated) flags.add('summary');
  const eligibilityModule = obj(protocol.eligibilityModule);
  const criteria = sanitizeMultiline(eligibilityModule?.eligibilityCriteria, MAX_RECORD_CRITERIA_BYTES);
  if (criteria.truncated) flags.add('criteria');
  const sexValue = eligibilityModule?.sex;
  const sex = (ELIGIBILITY_SEX as readonly unknown[]).includes(sexValue) ? (sexValue as StudyRecord['eligibility']['sex']) : 'UNKNOWN';
  const healthy = eligibilityModule?.healthyVolunteers;

  const sponsor = sanitizeLine(obj(obj(protocol.sponsorCollaboratorsModule)?.leadSponsor)?.name, 300);
  if (sponsor?.truncated) flags.add('sponsor');

  const design = obj(protocol.designModule);
  const studyType = (STUDY_TYPES as readonly unknown[]).includes(design?.studyType) ? (design?.studyType as StudyRecord['studyType']) : null;
  const phases: StudyRecord['phases'] = [];
  for (const phase of arr(design?.phases)) {
    if ((PHASES as readonly unknown[]).includes(phase) && !phases.includes(phase as StudyRecord['phases'][number])) {
      phases.push(phase as StudyRecord['phases'][number]);
    }
  }
  const lastUpdate = obj(statusModule?.lastUpdatePostDateStruct)?.date;

  const record: StudyRecord = {
    nctId,
    title: title.text,
    status: status as StudyRecord['status'],
    studyType,
    phases,
    conditions: conditions.terms,
    meshTerms: meshTerms.terms,
    summary: summary.text,
    eligibility: {
      criteria: criteria.text,
      minimumAge: age(eligibilityModule?.minimumAge),
      maximumAge: age(eligibilityModule?.maximumAge),
      sex,
      healthyVolunteers: typeof healthy === 'boolean' ? healthy : null,
    },
    sponsor: sponsor?.text ?? null,
    locations,
    contacts,
    lastUpdatePostDate: typeof lastUpdate === 'string' && CTGOV_DATE_PATTERN.test(lastUpdate) ? lastUpdate : null,
    sourceUrl: `https://clinicaltrials.gov/study/${nctId}`,
    retrievedAt: context.retrievedAt,
    // Measured with every flag present, so adding the real (shorter) list can never exceed the budget.
    truncatedFields: orderedFlags(new Set(ALL_FLAGS)),
  };
  const fitted = fitRecord(record, context.stateName, flags);
  if (!fitted) return { ok: false, reason: 'too_large' };
  const parsed = StudyRecordSchema.safeParse({ ...fitted, truncatedFields: orderedFlags(flags) });
  if (!parsed.success) return { ok: false, reason: 'schema' };
  return { ok: true, record: parsed.data };
}
