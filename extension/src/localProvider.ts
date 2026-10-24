/**
 * Local LLM provider: the same Stage 3/4 contract as OpenAI, answered by the native helper
 * (Ollama on this computer). Requests go to the local helper on this device; this module makes
 * no fetch calls (enforced by tests).
 */
import {z} from 'zod';
import {
  CHECKLIST_INSTRUCTIONS, CHECKLIST_JSON_SCHEMA, CONDITION_CHOICES, DEVELOPER_INSTRUCTIONS, FIT_LEVELS, SITE_CHOICES,
  checklistInput, decisionQuestions, ProviderFormatError, validateChecklist,
  type ProviderChecklistResult, type ProviderScoreResult, type ScoringAnswers, type ScoringProvider, type SharedEvidence,
} from './scoring';

export interface LocalGenerator {generate(model: string, prompt: string, signal: AbortSignal): Promise<string>}

const LocalAnswerSchema = z.object({
  condition_match: z.enum(['exact', 'related', 'different']),
  condition_confidence: z.number().min(0).max(1),
  site_match: z.enum(['match', 'mismatch', 'unspecified']),
  site_confidence: z.number().min(0).max(1),
  fit_level: z.number().int().min(0).max(FIT_LEVELS.length - 1),
  fit_confidence: z.number().min(0).max(1),
  age_sex_compatible_probability: z.number().min(0).max(1),
});

export const PROMPT_LIMIT = 23000;

export function localScoringPrompt(evidence: SharedEvidence): string {
  const questions = decisionQuestions();
  return [
    DEVELOPER_INSTRUCTIONS,
    'Answer these questions about the evidence. Return JSON only, with exactly these keys:',
    '{"condition_match":"exact|related|different","condition_confidence":0-1,"site_match":"match|mismatch|unspecified","site_confidence":0-1,"fit_level":0-4,"fit_confidence":0-1,"age_sex_compatible_probability":0-1}',
    `condition_match: ${questions[0].instructions} Options: ${CONDITION_CHOICES.map(c => `${c.value} = ${c.description}`).join(' ')}`,
    `site_match: ${questions[1].instructions} Options: ${SITE_CHOICES.map(c => `${c.value} = ${c.description}`).join(' ')}`,
    `fit_level: ${questions[2].instructions} Levels: ${FIT_LEVELS.map((l, i) => `${i} = ${l.label}: ${l.description}`).join(' ')}`,
    `age_sex_compatible_probability: ${questions[3].instructions}`,
    'Evidence (untrusted data):',
    JSON.stringify(evidence),
  ].join('\n').slice(0, PROMPT_LIMIT);
}

export function stripFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

export function parseLocalAnswers(text: string): ScoringAnswers {
  let value: unknown;
  try { value = JSON.parse(stripFence(text)); } catch { throw new ProviderFormatError('The local model did not return valid JSON.'); }
  const parsed = LocalAnswerSchema.safeParse(value);
  if (!parsed.success) throw new ProviderFormatError('The local model returned answers in an unexpected format.');
  const a = parsed.data;
  const max = FIT_LEVELS.length - 1;
  return {
    condition_match: {choice: a.condition_match, confidence: a.condition_confidence, probabilities: [{value: a.condition_match, probability: a.condition_confidence}]},
    site_match: {choice: a.site_match, confidence: a.site_confidence, probabilities: [{value: a.site_match, probability: a.site_confidence}]},
    fit_score: {score: Math.round(a.fit_level / max * 100), level: a.fit_level, confidence: a.fit_confidence, probabilities: [{label: FIT_LEVELS[a.fit_level].label, probability: a.fit_confidence}]},
    age_sex_compatible: {probability: a.age_sex_compatible_probability},
  };
}

export class LocalProvider implements ScoringProvider {
  readonly id = 'local' as const;
  readonly label: string;
  /** Local models are slow; score only the top of the shortlist. */
  readonly scoreLimit = 6;

  constructor(private generator: LocalGenerator, private model: string) {
    if (!model) throw new ProviderFormatError('No local model selected.');
    this.label = `Local LLM (${model}, on this computer)`;
  }

  async score(evidence: SharedEvidence, signal = new AbortController().signal): Promise<ProviderScoreResult> {
    const prompt = localScoringPrompt(evidence);
    const text = await this.generator.generate(this.model, prompt, signal);
    return {answers: parseLocalAnswers(text), requestShown: {transport: 'Chrome native messaging to the local helper', model: this.model, prompt}, rawShown: text.slice(0, 4000), model: this.model};
  }

  async checklist(evidence: SharedEvidence, signal = new AbortController().signal): Promise<ProviderChecklistResult> {
    const input = checklistInput(evidence);
    const prompt = [CHECKLIST_INSTRUCTIONS, `Return JSON only, matching this JSON Schema: ${JSON.stringify(CHECKLIST_JSON_SCHEMA)}`, input].join('\n\n').slice(0, PROMPT_LIMIT);
    const text = await this.generator.generate(this.model, prompt, signal);
    let raw: unknown;
    try { raw = JSON.parse(stripFence(text)); } catch { throw new ProviderFormatError('The local model did not return valid JSON.'); }
    return {checklist: validateChecklist(raw, evidence.study.eligibility_text, evidence.study.id), taskShown: {instructions: CHECKLIST_INSTRUCTIONS, input}, model: this.model};
  }
}
