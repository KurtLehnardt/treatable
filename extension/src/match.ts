/**
 * Stages 1 and 2 of the scoring pipeline. Pure and local: no network, no model.
 *
 * Stage 1: BM25 retrieval over the bundled snapshot with a small synonym table and a
 * distinctive-term gate. A study whose only overlap with the query is a generic word
 * ("disease", "chronic", "pain", ...) or a body-region word ("cervical", "thoracic", ...)
 * is never a candidate.
 *
 * Stage 2: deterministic screen. Structured age/sex contradictions exclude a study
 * entirely. A spine-region mismatch caps the score at 49 and routes the study to the
 * near-miss section. Unparsed free text stays unknown and never excludes.
 */
import {screenStudy} from '../../scaffold/lib/eligibility/hardFilters';
import type {PatientProfile, Study} from './core';

export const GENERIC_TERMS = new Set([
  'disease', 'diseases', 'degenerative', 'degeneration', 'chronic', 'disorder', 'disorders', 'syndrome',
  'pain', 'painful', 'study', 'studies', 'patient', 'patients', 'condition', 'conditions', 'treatment',
  'therapy', 'trial', 'clinical', 'adult', 'adults', 'acute', 'severe', 'low', 'lower', 'upper', 'injury',
  'symptom', 'symptoms', 'problem', 'problems', 'issue', 'issues', 'related', 'associated', 'type',
]);

export type SpineRegion = 'cervical' | 'thoracic' | 'lumbar' | 'sacral';
export const REGION_TERMS = new Set(['cervical', 'thoracic', 'lumbar', 'sacral', 'lumbosacral', 'neck', 'back', 'spine', 'spinal']);
/** Region words that are not condition-defining on their own. "back" stays distinctive for vague back pain. */
const REGION_ONLY = new Set(['cervical', 'thoracic', 'lumbar', 'sacral', 'lumbosacral', 'neck', 'spine', 'spinal']);

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'as', 'is', 'are', 'was',
  'were', 'be', 'been', 'this', 'that', 'it', 'its', 'from', 'into', 'not', 'no', 'my', 'i', 'have', 'has',
  'had', 'who', 'which', 'will', 'can', 'may', 'than', 'after', 'before', 'other', 'any', 'all',
]);

/** Phrase-level synonyms, matched against the normalized patient condition text. */
export const SYNONYMS: Array<[RegExp, string[]]> = [
  [/\bddd\b|degenerative dis[ck] disease|dis[ck] degeneration/, ['degenerative disc disease', 'disc degeneration', 'discogenic', 'intervertebral disc', 'disc disease', 'spondylosis']],
  [/herniat|slipped dis[ck]|bulging dis[ck]/, ['disc herniation', 'herniated disc', 'radiculopathy', 'intervertebral disc']],
  [/sciatica/, ['sciatica', 'radiculopathy', 'lumbar radiculopathy']],
  [/back pain|backache|lumbago/, ['back pain', 'low back pain', 'backache', 'lumbago']],
  [/neck pain/, ['neck pain', 'cervicalgia']],
  [/stenosis/, ['spinal stenosis', 'stenosis']],
  [/fibromyalgia/, ['fibromyalgia']],
  [/knee osteoarthritis|knee oa\b/, ['knee osteoarthritis', 'osteoarthritis knee']],
  [/\bms\b|multiple sclerosis/, ['multiple sclerosis']],
];

export function stem(token: string): string {
  return token.length > 4 && token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('is') ? token.slice(0, -1) : token;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t => t.length > 1 && !STOPWORDS.has(t)).map(stem);
}

export function isGeneric(token: string): boolean {
  return GENERIC_TERMS.has(token) || GENERIC_TERMS.has(token + 's');
}

export interface QueryTerms {
  /** All query tokens (patient words plus synonym expansions), used for BM25 ranking. */
  all: string[];
  /** Tokens that may qualify a study: not generic, not a bare region word. */
  distinctive: string[];
  /** Synonym phrases applied, for display. */
  expansions: string[];
}

export function buildQuery(condition: string): QueryTerms {
  const normalized = condition.toLowerCase().replace(/\s+/g, ' ');
  const expansions: string[] = [];
  for (const [pattern, extra] of SYNONYMS) if (pattern.test(normalized)) expansions.push(...extra);
  const all = [...new Set(tokenize([normalized, ...expansions].join(' ')))];
  const distinctive = all.filter(t => !isGeneric(t) && !REGION_ONLY.has(t));
  return {all, distinctive, expansions: [...new Set(expansions)]};
}

function coreText(s: Study): string {
  return [s.briefTitle, s.officialTitle, s.conditions.join(' '), s.keywords.join(' ')].join(' ');
}

function indexText(s: Study): string {
  // Field weighting by repetition: conditions and title count more than body text.
  return [s.briefTitle, s.briefTitle, s.conditions.join(' '), s.conditions.join(' '), s.conditions.join(' '),
    s.keywords.join(' '), s.keywords.join(' '), s.briefSummary, s.eligibility.criteriaText.slice(0, 3000)].join(' ');
}

export interface BM25Index {
  docs: Array<{study: Study; tf: Map<string, number>; length: number; core: Set<string>}>;
  df: Map<string, number>;
  avgLength: number;
}

const indexCache = new WeakMap<Study[], BM25Index>();

export function buildIndex(studies: Study[]): BM25Index {
  const cached = indexCache.get(studies);
  if (cached) return cached;
  const df = new Map<string, number>();
  let total = 0;
  const docs = studies.map(study => {
    const tokens = tokenize(indexText(study));
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    total += tokens.length;
    return {study, tf, length: tokens.length, core: new Set(tokenize(coreText(study)))};
  });
  const index = {docs, df, avgLength: total / Math.max(1, docs.length)};
  indexCache.set(studies, index);
  return index;
}

export interface Candidate {
  study: Study;
  bm25: number;
  /** Distinctive query tokens found in the study's title, conditions, or keywords. */
  distinctiveHits: string[];
}

/** Stage 1: BM25 rank, then the distinctive-term gate on core fields. */
export function retrieveCandidates(studies: Study[], condition: string, limit = 20): Candidate[] {
  const query = buildQuery(condition);
  if (!query.distinctive.length) return [];
  const index = buildIndex(studies);
  const n = index.docs.length, k1 = 1.5, b = 0.75;
  const scored: Candidate[] = [];
  for (const doc of index.docs) {
    const distinctiveHits = query.distinctive.filter(t => doc.core.has(t));
    if (!distinctiveHits.length) continue; // generic-only or region-only overlap is not a candidate
    let score = 0;
    for (const term of query.all) {
      const f = doc.tf.get(term);
      if (!f) continue;
      const df = index.df.get(term) || 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const weight = isGeneric(term) ? 0.25 : 1;
      score += weight * idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * doc.length / index.avgLength));
    }
    scored.push({study: doc.study, bm25: score, distinctiveHits});
  }
  return scored.sort((a, b) => b.bm25 - a.bm25 || a.study.id.localeCompare(b.study.id)).slice(0, limit);
}

const REGION_PATTERNS: Array<[SpineRegion, RegExp]> = [
  ['cervical', /\bcervical (?:spine|spinal|dis[ck]|spondyl|radicul|myelopath|stenosis|fusion|degenerat|level|vertebra)|\bneck pain\b|\bc[1-7]\s*[-/–]\s*c?[1-7]\b|\bcervicalgia\b|\bacdf\b/],
  ['thoracic', /\bthoracic (?:spine|spinal|dis[ck]|vertebra|level|degenerat|stenosis|myelopath)|\bt(?:[1-9]|1[0-2])\s*[-/–]\s*t?(?:[1-9]|1[0-2])\b|\bmid[- ]back\b/],
  ['lumbar', /\blumbar\b|\blow(?:er)? back\b|\bl[1-5]\s*[-/–]\s*[ls]?[1-5]\b|\blumbosacral\b|\bsciatica\b/],
  ['sacral', /\bsacral\b|\bsacroiliac\b|\bsacrum\b|\bs1\b/],
];

export function extractRegions(text: string): SpineRegion[] {
  const t = text.toLowerCase();
  return REGION_PATTERNS.filter(([, re]) => re.test(t)).map(([region]) => region);
}

/** Patient region from free condition text. A bare "thoracic"/"cervical" with a disc/spine word counts. */
export function patientRegion(condition: string): SpineRegion | 'unspecified' {
  const t = condition.toLowerCase();
  const spineContext = /dis[ck]|spine|spinal|spondyl|vertebra|back|neck|radicul|myelopath|stenosis|sciatica|ddd/.test(t);
  if (!spineContext) return 'unspecified';
  for (const region of ['cervical', 'thoracic', 'lumbar', 'sacral'] as SpineRegion[]) if (new RegExp(`\\b${region}\\b`).test(t)) return region;
  const regions = extractRegions(t);
  return regions.length === 1 ? regions[0] : 'unspecified';
}

export function studyRegions(study: Study): SpineRegion[] {
  const core = extractRegions(coreText(study));
  return core.length ? core : extractRegions(study.briefSummary);
}

export type RegionStatus = 'match' | 'mismatch' | 'unspecified' | 'not_applicable';

export interface LocalScreen {
  study: Study;
  bm25: number;
  distinctiveHits: string[];
  excluded: boolean;
  excludeReason?: string;
  region: {patient: SpineRegion | 'unspecified'; study: SpineRegion[]; status: RegionStatus};
  /** Deterministic ceiling. Model output can lower a score below this, never lift above it. */
  cap: number;
  capReasons: string[];
  /** Unrefined keyword score, 50-79 relative to the best candidate, before caps. */
  keywordScore: number;
  reasonsFor: string[];
  reasonsAgainst: string[];
  screen: ReturnType<typeof screenStudy>;
}

export const REGION_MISMATCH_CAP = 49;
/** Unrefined (keyword-only) results can never display as Strong. */
export const UNREFINED_CAP = 79;

/** Stage 2. */
export function screenCandidates(candidates: Candidate[], profile: PatientProfile): LocalScreen[] {
  const condition = profile.primaryDiagnoses.join(', ');
  const pRegion = patientRegion(condition);
  const top = Math.max(...candidates.map(c => c.bm25), 1e-9);
  return candidates.map(c => {
    const screen = screenStudy(c.study, profile);
    const sRegions = studyRegions(c.study);
    const status: RegionStatus = pRegion === 'unspecified' ? 'not_applicable' : !sRegions.length ? 'unspecified' : sRegions.includes(pRegion) ? 'match' : 'mismatch';
    const reasonsFor: string[] = [`Condition terms found in the study title or conditions: ${c.distinctiveHits.join(', ')}.`];
    const reasonsAgainst: string[] = [];
    const capReasons: string[] = [];
    let cap = 100;
    if (status === 'match') reasonsFor.push(`Same spine region: ${pRegion}.`);
    if (status === 'mismatch') {
      cap = REGION_MISMATCH_CAP;
      capReasons.push(`Spine region mismatch caps the score at ${REGION_MISMATCH_CAP}.`);
      reasonsAgainst.push(`This study is about the ${sRegions.join('/')} spine; you said ${pRegion}.`);
    }
    if (status === 'unspecified') reasonsAgainst.push('The study does not name a spine region. Ask the study team.');
    for (const check of screen.criteria) {
      if (check.status === 'met') reasonsFor.push(`${check.label} fits the structured criteria. ${check.note}`);
      if (check.status === 'unknown') reasonsAgainst.push(`${check.label} could not be checked. ${check.note}`);
    }
    const unmet = screen.criteria.filter(x => x.status === 'unmet');
    const excluded = !screen.visible || unmet.length > 0;
    const excludeReason = !screen.visible ? 'Not recruiting or not open to this profile.' : unmet.length ? unmet.map(x => `${x.label}: ${x.note}`).join(' ') : undefined;
    const keywordScore = Math.round(50 + 29 * (c.bm25 / top));
    return {study: c.study, bm25: c.bm25, distinctiveHits: c.distinctiveHits, excluded, excludeReason, region: {patient: pRegion, study: sRegions, status}, cap, capReasons, keywordScore, reasonsFor, reasonsAgainst, screen};
  });
}
