/**
 * Maps a session record to the public study object that may be sent to OpenAI.
 *
 * Port of publicStudy (extension/native/real.mjs at commit 48c569e): the same field set (A0 section
 * 10.4 allowlist; fetchedAt renamed retrievedAt), with UTF-8 byte caps instead of character slices.
 * Contacts, investigators, sponsor, locations, ZIP codes, coordinates, distance, nearest site, and
 * every other field are left out by construction, and ModelStudySchema rejects any extra key. The
 * mapping is a pure, deterministic function of the record, so the exact study object in a preview
 * can be recomputed from the pinned record version and compared byte for byte (verifyPinnedPreview).
 *
 * Fitting to MAX_MODEL_STUDY_BYTES (5,120): the summary is cut to 1,800 bytes and the criteria to
 * 4,000 bytes (criteriaTruncated is set, as in real.mjs, also when the record's criteria were already
 * shortened while reading the live record); conditions keep at most the first 50 entries, unchanged.
 * If the serialized study is still larger, the criteria, then the summary, are cut further, and as a
 * last step conditions are dropped from the end. Text is never rewritten, only cut, so record text
 * stays inert data inside the JSON string values of the allowlisted fields.
 */
import { truncateUtf8, utf8ByteLength } from '../bytes.ts';
import { CoreError } from '../errors.ts';
import {
  MAX_MODEL_CRITERIA_BYTES,
  MAX_MODEL_STUDY_BYTES,
  MAX_MODEL_SUMMARY_BYTES,
  ModelStudySchema,
  type ModelStudy,
  type StudyRecord,
} from '../protocol.ts';

export const MAX_MODEL_CONDITIONS = 50;

function studyBytes(study: ModelStudy): number {
  return utf8ByteLength(JSON.stringify(study));
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

export function toModelStudy(record: Readonly<StudyRecord>): ModelStudy {
  const summaryCut = truncateUtf8(record.summary, MAX_MODEL_SUMMARY_BYTES);
  const criteriaCut = truncateUtf8(record.eligibility.criteria, MAX_MODEL_CRITERIA_BYTES);
  const make = (conditions: readonly string[], summary: string, criteria: string, criteriaTruncated: boolean): ModelStudy => ({
    id: record.nctId,
    title: record.title,
    conditions: [...conditions],
    status: record.status,
    summary,
    criteria,
    criteriaTruncated,
    minimumAge: record.eligibility.minimumAge,
    maximumAge: record.eligibility.maximumAge,
    sex: record.eligibility.sex,
    sourceUrl: record.sourceUrl,
    retrievedAt: record.retrievedAt,
    lastUpdatePostDate: record.lastUpdatePostDate,
  });
  const fits = (study: ModelStudy) => studyBytes(study) <= MAX_MODEL_STUDY_BYTES;
  const conditions = record.conditions.slice(0, MAX_MODEL_CONDITIONS);
  const criteriaFlag = criteriaCut.truncated || record.truncatedFields.includes('criteria');
  let study = make(conditions, summaryCut.text, criteriaCut.text, criteriaFlag);
  if (!fits(study)) {
    const criteria = criteriaCut.text;
    const n = largest(utf8ByteLength(criteria), k => fits(make(conditions, summaryCut.text, truncateUtf8(criteria, k).text, true)));
    study = make(conditions, summaryCut.text, truncateUtf8(criteria, n).text, true);
  }
  if (!fits(study)) {
    const summary = summaryCut.text;
    const n = largest(utf8ByteLength(summary), k => fits(make(conditions, truncateUtf8(summary, k).text, study.criteria, true)));
    study = make(conditions, truncateUtf8(summary, n).text, study.criteria, true);
  }
  if (!fits(study)) {
    const n = largest(conditions.length, k => fits(make(conditions.slice(0, k), study.summary, study.criteria, true)));
    study = make(conditions.slice(0, n), study.summary, study.criteria, true);
  }
  // Unreachable for a valid StudyRecord (a title is at most 600 characters), kept as a fail-closed guard.
  if (!fits(study)) throw new CoreError('PREVIEW_TOO_LARGE');
  const parsed = ModelStudySchema.safeParse(study);
  if (!parsed.success) throw new CoreError('INTERNAL_ERROR');
  return parsed.data;
}
