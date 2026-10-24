/**
 * R5-deep — private-company web search (exa), the honest fallback for the
 * "comparable companies" angle when the comparable is a PRIVATE company with no
 * federal award record (feasibility report §2 #5 / §6 Risk 2).
 *
 * KEYED, and deliberately OPTIONAL: it runs only when `EXA_API_KEY` is set. When
 * the key is absent (the default local/CI posture), it returns NOTHING plus a
 * degradation note — the brief simply falls back to federal awardees only,
 * which are keyless and always available. It NEVER blocks the core analysis and
 * NEVER attaches an award to a web profile (the profile type has no amount
 * field — see `WebCompetitorProfileSchema`).
 *
 * (The agent capturing the demo fixture uses the exa MCP tool directly; this
 * module is the request-time equivalent for the live route.)
 */

export interface RawWebProfile {
  company: string;
  sourceUrl: string;
  snippet: string;
  via: "exa";
}

export interface WebSearchResult {
  profiles: RawWebProfile[];
  notes: string[];
}

const EXA_TIMEOUT_MS = Number(process.env.COMPETITOR_WEB_TIMEOUT_MS) || 12_000;

function clip(s: unknown, max = 320): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") + "…" : t;
}

/**
 * Search for comparable PRIVATE companies via exa. Returns [] (with a note) when
 * no key is configured or the call fails — always honest degradation, never a
 * throw that would fail the whole brief.
 */
export async function searchWebCompetitors(opts: {
  query: string;
  numResults?: number;
  signal?: AbortSignal;
}): Promise<WebSearchResult> {
  const key = process.env.EXA_API_KEY;
  if (!key) {
    return {
      profiles: [],
      notes: ["Web competitor search skipped (no EXA_API_KEY configured) — showing federal awardees only."],
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), EXA_TIMEOUT_MS);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort(opts.signal.reason);
    else opts.signal.addEventListener("abort", () => controller.abort(opts.signal!.reason), { once: true });
  }

  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({
        query: opts.query,
        type: "auto",
        category: "company",
        numResults: opts.numResults ?? 5,
        contents: { text: { maxCharacters: 600 } },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { profiles: [], notes: [`Web competitor search failed (HTTP ${res.status}) — federal awardees only.`] };
    }
    const json: any = await res.json();
    const profiles: RawWebProfile[] = [];
    for (const r of json?.results ?? []) {
      const url: string | undefined = r?.url;
      const snippet = clip(r?.text ?? r?.summary ?? r?.title);
      if (!url || !snippet) continue;
      profiles.push({
        company: clip(r?.title || r?.author || url, 120),
        sourceUrl: url,
        snippet,
        via: "exa",
      });
    }
    return { profiles, notes: [] };
  } catch {
    return { profiles: [], notes: ["Web competitor search was unreachable — federal awardees only."] };
  } finally {
    clearTimeout(timer);
  }
}
