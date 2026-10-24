/**
 * The full pipeline: Stage 1 retrieval, Stage 2 deterministic screen, Stage 3 provider
 * scoring of the shortlist only. Stage 4 (agent checklist) runs on demand per study.
 * Any provider failure falls back to the clearly labeled unrefined list.
 */
import type {PatientProfile, Study} from './core';
import {retrieveCandidates, screenCandidates, type Candidate, type LocalScreen} from './match';
import {buildEvidence, combineScore, unrefinedScore, type ProviderScoreResult, type ScoreBreakdown, type ScoringProvider, type SharedEvidence} from './scoring';
import {ProviderError, redact} from './openai';

export type MinMatch = 50 | 65 | 80;

export interface ScoredStudy {
  screen: LocalScreen;
  evidence: SharedEvidence;
  breakdown: ScoreBreakdown;
  refined: boolean;
  providerResult?: ProviderScoreResult;
  note?: string;
}

export interface PipelineResult {
  mode: 'refined' | 'unrefined';
  providerId?: 'openai' | 'local';
  providerLabel?: string;
  failure?: string;
  /** Main list, sorted by final score. Excludes near misses and hidden studies. */
  studies: ScoredStudy[];
  nearMiss: ScoredStudy[];
  excludedCount: number;
  shortlistCount: number;
  corpusCount: number;
}

const GLOBAL_FAILURES = new Set(['missing_key', 'consent', 'unauthorized', 'forbidden', 'rate_limited', 'timeout', 'offline', 'server', 'bad_request']);

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface PipelineInput {
  studies: Study[];
  profile: PatientProfile;
  provider?: ScoringProvider;
  /** Use these records instead of Stage 1 retrieval (for example, the study on the current page). */
  forced?: Study[];
  signal?: AbortSignal;
  /** Shown when there is no provider (Send nothing, or not chosen yet). */
  unrefinedReason?: string;
  concurrency?: number;
}

function assemble(scored: ScoredStudy[], base: Omit<PipelineResult, 'studies' | 'nearMiss'>): PipelineResult {
  const byScore = (a: ScoredStudy, b: ScoredStudy) => b.breakdown.final - a.breakdown.final || b.screen.bm25 - a.screen.bm25;
  return {
    ...base,
    studies: scored.filter(s => !s.breakdown.nearMiss && !s.breakdown.hidden && s.breakdown.final >= 50).sort(byScore),
    nearMiss: scored.filter(s => s.breakdown.nearMiss || (!s.breakdown.hidden && s.breakdown.final < 50)).sort(byScore),
  };
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const condition = input.profile.primaryDiagnoses.join(', ');
  const candidates: Candidate[] = input.forced
    ? input.forced.map(study => ({study, bm25: 1, distinctiveHits: ['current page record']}))
    : retrieveCandidates(input.studies, condition, 20);
  const screened = screenCandidates(candidates, input.profile);
  const kept = screened.filter(s => !s.excluded);
  const base = {excludedCount: screened.length - kept.length, shortlistCount: candidates.length, corpusCount: input.studies.length};
  const unrefined = (failure?: string): PipelineResult => assemble(
    kept.map(screen => ({screen, evidence: buildEvidence(input.profile, screen), breakdown: unrefinedScore(screen), refined: false})),
    {...base, mode: 'unrefined', failure, providerId: input.provider?.id, providerLabel: input.provider?.label},
  );
  if (!input.provider) return unrefined(input.unrefinedReason);
  const provider = input.provider;
  const controller = new AbortController();
  const abort = () => controller.abort();
  input.signal?.addEventListener('abort', abort, {once: true});
  let globalFailure: string | undefined;
  try {
    const scored = await mapLimit(kept, input.concurrency ?? (provider.id === 'local' ? 1 : 5), async (screen, i): Promise<ScoredStudy> => {
      const evidence = buildEvidence(input.profile, screen);
      if (i >= provider.scoreLimit || controller.signal.aborted) return {screen, evidence, breakdown: unrefinedScore(screen), refined: false, note: i >= provider.scoreLimit ? `Not scored by ${provider.label}: only the top ${provider.scoreLimit} are refined.` : undefined};
      try {
        const providerResult = await provider.score(evidence, controller.signal);
        return {screen, evidence, breakdown: combineScore(screen, providerResult.answers), refined: true, providerResult};
      } catch (error) {
        if (input.signal?.aborted) throw error;
        const message = redact(error instanceof Error ? error.message : 'Scoring failed.');
        if (error instanceof ProviderError && GLOBAL_FAILURES.has(error.kind)) {
          globalFailure ??= message;
          controller.abort();
        }
        return {screen, evidence, breakdown: unrefinedScore(screen), refined: false, note: `Scoring failed for this study: ${message}`};
      }
    });
    if (input.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const name = provider.id === 'openai' ? 'OpenAI' : 'Local LLM';
    if (globalFailure) return unrefined(`${name} scoring failed: ${globalFailure} Showing unrefined keyword screening instead.`);
    const attempted = Math.min(kept.length, provider.scoreLimit);
    const failed = scored.filter((s, i) => i < provider.scoreLimit && !s.refined);
    if (attempted > 0 && failed.length === attempted) {
      return unrefined(`${name} scoring failed for every study. ${failed[0].note?.replace('Scoring failed for this study: ', '') || ''} Showing unrefined keyword screening instead.`.replace(/\s+/g, ' '));
    }
    const partial = failed.length ? `${name} could not score ${failed.length} of ${attempted} studies; they are shown unrefined. ${failed[0].note?.replace('Scoring failed for this study: ', '') || ''}`.trim() : undefined;
    return assemble(scored, {...base, mode: 'refined', providerId: provider.id, providerLabel: provider.label, failure: partial});
  } finally {
    input.signal?.removeEventListener('abort', abort);
  }
}

/** Threshold changes visibility only; scores never change. */
export function visibleAt(result: PipelineResult, min: MinMatch): {shown: ScoredStudy[]; moreAt50: number} {
  const shown = result.studies.filter(s => s.breakdown.final >= min);
  return {shown, moreAt50: result.studies.length - shown.length};
}

export function countLine(result: PipelineResult, min: MinMatch): string {
  const {shown, moreAt50} = visibleAt(result, min);
  return min === 50 ? `Showing ${shown.length} at 50%+.` : `Showing ${shown.length} at ${min}%+. ${moreAt50} more at 50%+.`;
}

export function emptyMessage(result: PipelineResult, min: MinMatch): string | undefined {
  if (visibleAt(result, min).shown.length) return undefined;
  const label = min === 80 ? 'strong' : min === 65 ? 'possible or stronger' : '';
  return `No ${label ? label + ' ' : ''}matches in the offline snapshot of ${result.corpusCount.toLocaleString('en-US')} studies.`;
}
