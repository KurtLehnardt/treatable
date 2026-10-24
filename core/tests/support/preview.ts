/**
 * Fictional, public-only fixtures for building exact previews in tests with the core's own builders
 * (src/preview.ts). The studies are invented; no real record or person appears here.
 */
import {
  MAX_MODEL_CRITERIA_BYTES,
  MAX_MODEL_STUDY_BYTES,
  MAX_MODEL_SUMMARY_BYTES,
  type ModelPacket,
  type ModelStudy,
  type Preview,
} from '../../src/protocol.ts';
import { truncateUtf8, utf8ByteLength } from '../../src/bytes.ts';
import { buildPreview } from '../../src/preview.ts';

export const FICTIONAL_IDS = ['NCT90000001', 'NCT90000002', 'NCT90000003', 'NCT90000004', 'NCT90000005', 'NCT90000006', 'NCT90000007', 'NCT90000008', 'NCT90000009', 'NCT90000010'] as const;

export function basePacket(overrides: Partial<ModelPacket> = {}): ModelPacket {
  return {
    conditionTerm: 'Seasonal Allergic Rhinitis',
    ageBand: '45_59',
    sex: 'female',
    state: 'ID',
    scoreNctIds: [FICTIONAL_IDS[0], FICTIONAL_IDS[1]],
    agentNctIds: [FICTIONAL_IDS[0], FICTIONAL_IDS[1]],
    ...overrides,
  };
}

const maxStudies = new Map<string, ModelStudy>();

export function makeStudy(id: string, size: 'typical' | 'max' = 'typical'): ModelStudy {
  const study: ModelStudy = {
    id,
    title: `Fictional study ${id} of nasal spray timing for seasonal allergic rhinitis`,
    conditions: ['Seasonal Allergic Rhinitis', 'Rhinitis, Allergic, Seasonal'],
    status: 'RECRUITING',
    summary: 'This fictional public summary describes a study of spray timing during pollen season.',
    criteria: 'Inclusion Criteria:\n\n* Fictional adult volunteers\n\nExclusion Criteria:\n\n* Fictional exclusion',
    criteriaTruncated: false,
    minimumAge: '18 Years',
    maximumAge: null,
    sex: 'ALL',
    sourceUrl: `https://clinicaltrials.gov/study/${id}`,
    retrievedAt: '2026-10-24T08:00:00.000Z',
    lastUpdatePostDate: '2026-09-30',
  };
  if (size === 'typical') return study;
  const cached = maxStudies.get(id);
  if (cached) return JSON.parse(JSON.stringify(cached)) as ModelStudy;
  // Worst case: multi-byte text and JSON escapes, filled exactly to the byte budgets.
  const filler = 'Fictional criterion — pollen exposure “high”\n\t* naïve dosing "quoted" \\ über alles. ';
  study.summary = truncateUtf8(filler.repeat(200), MAX_MODEL_SUMMARY_BYTES).text;
  study.title = `Fictional study ${id} ${'with a very long public title '.repeat(30)}`.slice(0, 600);
  study.criteriaTruncated = true;
  study.criteria = '';
  // Grow criteria to the largest prefix whose serialized study still fits (escapes count double).
  let low = 0;
  let high = MAX_MODEL_CRITERIA_BYTES;
  const source = filler.repeat(400);
  const fits = (n: number) => {
    study.criteria = truncateUtf8(source, n).text;
    return utf8ByteLength(JSON.stringify(study)) <= MAX_MODEL_STUDY_BYTES;
  };
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  fits(low);
  // Pad with ASCII to land exactly on the budget when the last character did not fit.
  while (utf8ByteLength(JSON.stringify(study)) < MAX_MODEL_STUDY_BYTES && utf8ByteLength(study.criteria) < MAX_MODEL_CRITERIA_BYTES) study.criteria += '.';
  maxStudies.set(id, JSON.parse(JSON.stringify(study)) as ModelStudy);
  return study;
}

export function makePreview(packet: ModelPacket, studyOf: (id: string) => ModelStudy = id => makeStudy(id)): Preview {
  return buildPreview(packet, studyOf);
}
