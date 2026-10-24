/**
 * OpenAI provider: Decisions API for scoring (Stage 3), Agents API for the eligibility
 * checklist task (Stage 4). Calls go only to https://api.openai.com.
 *
 * The API key is held in memory by this client and sent only in the Authorization header.
 * It is never logged, never put in page context, and never included in error messages.
 */
import {
  CHECKLIST_INSTRUCTIONS, CHECKLIST_JSON_SCHEMA, checklistInput, decisionsRequest, parseDecisionAnswers,
  ProviderFormatError, validateChecklist,
  type ProviderChecklistResult, type ProviderScoreResult, type ScoringProvider, type SharedEvidence,
} from './scoring';

export const OPENAI_ORIGIN = 'https://api.openai.com';
export const DECISIONS_MODEL = 'gpt-6-luna';
export const AGENT_MODEL = 'gpt-6-astra';

export type FailureKind = 'missing_key' | 'consent' | 'unauthorized' | 'forbidden' | 'rate_limited' | 'timeout' | 'offline' | 'malformed' | 'server' | 'bad_request' | 'agent_failed';

export const FAILURE_MESSAGES: Record<FailureKind, string> = {
  missing_key: 'No OpenAI API key is set. Add your key in Settings, or switch to Local LLM or Send nothing.',
  consent: 'Cloud scoring is off until you accept the OpenAI consent screen.',
  unauthorized: 'OpenAI rejected the API key (401). Check the key in Settings.',
  forbidden: 'This OpenAI key is not allowed to use this API (403). The Agents API needs api.agents.read and api.agents.write.',
  rate_limited: 'OpenAI rate limit or quota reached (429). Try again in a minute.',
  timeout: 'OpenAI did not respond in time.',
  offline: 'Could not reach OpenAI. Check your internet connection.',
  malformed: 'OpenAI returned a response Treatable could not validate.',
  server: 'OpenAI had a server error. Try again shortly.',
  bad_request: 'OpenAI rejected the request (400).',
  agent_failed: 'The OpenAI agent task did not complete.',
};

export class ProviderError extends Error {
  constructor(public kind: FailureKind, detail?: string) {
    super(detail ? `${FAILURE_MESSAGES[kind]} ${detail}` : FAILURE_MESSAGES[kind]);
    this.name = 'ProviderError';
  }
}

/** Strip anything that looks like an API key. Applied to every message that leaves this module. */
export function redact(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_\-]{8,}/g, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}

export interface OpenAIOptions {
  apiKey: string;
  consented: boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  decisionsTimeoutMs?: number;
  agentTimeoutMs?: number;
  /** Delete the agent session after reading its result, so OpenAI does not keep it. */
  deleteSessions?: boolean;
}

const RETRYABLE = new Set<FailureKind>(['rate_limited', 'timeout', 'offline', 'server']);

function classifyStatus(status: number): FailureKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

export class OpenAIProvider implements ScoringProvider {
  readonly id = 'openai' as const;
  readonly label = 'OpenAI (Decisions API + Agents API)';
  readonly scoreLimit = 20;
  private readonly key: string;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private options: OpenAIOptions) {
    if (!options.consented) throw new ProviderError('consent');
    const key = options.apiKey?.trim();
    if (!key) throw new ProviderError('missing_key');
    this.key = key;
    this.doFetch = options.fetch || ((input, init) => fetch(input, init));
    this.sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...extra};
  }

  /** One attempt plus at most one retry with backoff, for transient failures only. */
  private async request(path: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal, retry = true): Promise<Response> {
    let lastError: ProviderError | undefined;
    for (let attempt = 0; attempt < (retry ? 2 : 1); attempt++) {
      if (attempt > 0) await this.sleep(lastError?.kind === 'rate_limited' ? 2000 : 800);
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, {once: true});
      try {
        const response = await this.doFetch(`${OPENAI_ORIGIN}${path}`, {...init, signal: controller.signal});
        if (response.ok) return response;
        lastError = new ProviderError(classifyStatus(response.status));
      } catch (error) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        lastError = new ProviderError(controller.signal.aborted ? 'timeout' : 'offline');
        void error; // the underlying error may echo request details; never surface it
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
      if (!RETRYABLE.has(lastError.kind)) break;
    }
    throw lastError!;
  }

  async score(evidence: SharedEvidence, signal?: AbortSignal): Promise<ProviderScoreResult> {
    const body = decisionsRequest(evidence, DECISIONS_MODEL);
    const response = await this.request('/v1/decisions', {method: 'POST', headers: this.headers(), body: JSON.stringify(body)}, this.options.decisionsTimeoutMs ?? 20000, signal);
    let raw: unknown;
    let bodyTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      raw = await Promise.race([
        response.json(),
        new Promise((_, reject) => { bodyTimer = setTimeout(() => reject(new ProviderError('timeout')), this.options.decisionsTimeoutMs ?? 20000); }),
      ]);
    } catch (error) {
      throw error instanceof ProviderError ? error : new ProviderError('malformed');
    } finally { clearTimeout(bodyTimer); }
    try {
      return {answers: parseDecisionAnswers(raw), requestShown: {endpoint: 'POST /v1/decisions', ...body}, rawShown: raw, model: DECISIONS_MODEL};
    } catch (error) {
      throw new ProviderError('malformed', error instanceof ProviderFormatError ? error.message : undefined);
    }
  }

  async checklist(evidence: SharedEvidence, signal?: AbortSignal): Promise<ProviderChecklistResult> {
    const input = checklistInput(evidence);
    const body = {
      agent: {model: AGENT_MODEL, instructions: CHECKLIST_INSTRUCTIONS, reasoning: {effort: 'low'}, text: {format: {type: 'json_schema', schema: CHECKLIST_JSON_SCHEMA}}},
      environment: {type: 'none'},
      input,
      stream: true,
      metadata: {app: 'treatable-extension'},
    };
    // Session creation is not retried: a retried POST could leave an orphaned session.
    const response = await this.request('/v1/agents/sessions', {method: 'POST', headers: this.headers({'OpenAI-Beta': 'agents=v1', Accept: 'text/event-stream'}), body: JSON.stringify(body)}, this.options.agentTimeoutMs ?? 90000, signal, false);
    const holder: {sessionId?: string} = {};
    let text: string;
    let sessionDeleted = false;
    try {
      text = (await readAgentStream(response, this.options.agentTimeoutMs ?? 90000, signal, holder)).text;
    } finally {
      // Delete on every path, success or failure, once the session ID is known.
      if (holder.sessionId && this.options.deleteSessions !== false) sessionDeleted = await this.deleteSession(holder.sessionId);
    }
    const sessionId = holder.sessionId;
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new ProviderError('malformed', 'The agent did not return valid JSON.'); }
    try {
      return {checklist: validateChecklist(raw, evidence.study.eligibility_text, evidence.study.id), taskShown: {instructions: CHECKLIST_INSTRUCTIONS, input}, model: AGENT_MODEL, sessionId, sessionDeleted};
    } catch (error) {
      throw new ProviderError('malformed', error instanceof ProviderFormatError ? error.message : undefined);
    }
  }

  /** DELETE /v1/agents/sessions/{id}. Returns true only on a 2xx response. */
  private async deleteSession(id: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const r = await this.doFetch(`${OPENAI_ORIGIN}/v1/agents/sessions/${encodeURIComponent(id)}`, {method: 'DELETE', headers: this.headers({'OpenAI-Beta': 'agents=v1'}), signal: controller.signal});
      return r.ok;
    } catch { return false; } finally { clearTimeout(timer); }
  }
}

/** Read an Agents API server-sent event stream until the root turn ends. */
export async function readAgentStream(response: Response, deadlineMs = 90000, signal?: AbortSignal, holder: {sessionId?: string} = {}): Promise<{text: string; sessionId?: string}> {
  if (!response.body) throw new ProviderError('malformed');
  const reader = response.body.getReader();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, deadlineMs);
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', onAbort, {once: true});
  try {
    return await consume(reader, holder);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (timedOut) throw new ProviderError('timeout', 'The agent task took too long.');
  }
}

async function consume(reader: ReadableStreamDefaultReader<Uint8Array>, holder: {sessionId?: string}): Promise<{text: string; sessionId?: string}> {
  const decoder = new TextDecoder();
  let buffer = '', finalText = '', lastText = '', outcome: 'completed' | 'failed' | undefined;
  const handle = (data: string) => {
    let event: any;
    try { event = JSON.parse(data); } catch { return; }
    if (typeof event?.session_id === 'string') holder.sessionId = event.session_id;
    if (event?.type === 'agent.session.created' && typeof event.session?.id === 'string') holder.sessionId = event.session.id;
    if (event?.turn?.subagent_id) return; // only the root turn ends the task
    switch (event?.type) {
      case 'agent.session.turn.output_text.done': if (typeof event.text === 'string') lastText = event.text; break;
      case 'agent.session.turn.item.done':
        if (event.item?.type === 'message' && event.item.phase === 'final_answer') {
          const part = event.item.content?.find((c: any) => c?.type === 'output_text');
          if (typeof part?.text === 'string') finalText = part.text;
        }
        break;
      case 'agent.session.turn.completed': outcome = 'completed'; break;
      case 'agent.session.turn.failed': case 'agent.session.turn.cancelled': case 'agent.session.failed': case 'error': outcome = 'failed'; break;
    }
  };
  const flush = (chunk: string) => {
    const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (data && data !== '[DONE]') handle(data);
  };
  while (!outcome) {
    const {value, done} = await reader.read();
    if (done) { flush(buffer.replace(/\r\n?/g, '\n')); buffer = ''; break; }
    buffer = (buffer + decoder.decode(value, {stream: true})).replace(/\r\n?/g, '\n');
    let cut;
    while (!outcome && (cut = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      flush(chunk);
    }
  }
  void reader.cancel().catch(() => {});
  if (outcome !== 'completed') throw new ProviderError('agent_failed', outcome === 'failed' ? undefined : 'The stream closed before the task finished.');
  const text = finalText || lastText;
  if (!text) throw new ProviderError('malformed', 'The agent returned no output.');
  return {text, sessionId: holder.sessionId};
}
