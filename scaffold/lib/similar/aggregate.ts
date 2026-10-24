/**
 * D1 — free "Similar companies funded" aggregate panel.
 *
 * Pure, hermetic aggregation over the award-history recipients already
 * attached to each `Match` by `lib/match.ts` (`historyFromRows()`). That
 * function is the primary A3-lite provenance gate: it drops any award row
 * without a real `sourceUrl` before it ever reaches a `Match.history`.
 *
 * This module is DEFENSE-IN-DEPTH, not a re-fetch: it independently re-checks
 * `sourceUrl` on every recipient before it can render here, so a recipient can
 * never reach the free panel without provenance regardless of how it arrived
 * (a future data refresh, a bad merge, a stale cached map, a test fixture).
 * No network calls, no fabrication — only rows already carrying a verifiable
 * public source link are ever returned.
 */

/** Minimal recipient shape this module needs — matches `AwardHistory.recipients`
 *  entries (`lib/contracts/opportunityMap.ts`) without importing the zod
 *  contract, so this stays a pure, dependency-light module. */
export type RecipientLike = {
  company: string;
  program: string;
  agency: string;
  amount: number;
  year: number;
  sourceUrl?: string;
};

/** Minimal match shape this module needs — a subset of `Match` (`lib/types.ts`). */
export type MatchLike = {
  tier?: string;
  history?: {
    recipients?: RecipientLike[];
  };
};

/** A recipient that has cleared the verified-only gate: `sourceUrl` is
 *  guaranteed present and non-empty. */
export type VerifiedRecipient = {
  company: string;
  program: string;
  agency: string;
  amount: number;
  year: number;
  sourceUrl: string;
};

const DEFAULT_LIMIT = 10;

/** Dedupe key: company+program+agency+year+amount, case-insensitive on the
 *  text fields so trivial casing differences across matches still collapse. */
function recipientKey(r: VerifiedRecipient): string {
  return [
    r.company.trim().toLowerCase(),
    r.program.trim().toLowerCase(),
    r.agency.trim().toLowerCase(),
    r.year,
    r.amount,
  ].join("|");
}

/**
 * Aggregates the provenance-verified award recipients across a set of
 * matches into a deduped, deterministically-sorted, capped list for the free
 * "Similar companies funded" panel.
 *
 * - Prefers recipients from strong matches (tier "likely" / "verify"); if
 *   that set has zero verified recipients, falls back to ALL matches so the
 *   free panel can still render honest verified data on a weaker result set.
 * - Drops any recipient without a non-empty `sourceUrl` (defense-in-depth on
 *   top of `historyFromRows()`'s own provenance gate).
 * - Dedupes identical awards that show up under more than one match.
 * - Sorts deterministically: amount desc, then company/program/agency/year
 *   as tie-breakers (never sort by array insertion order alone).
 * - Caps to `limit` (default 10).
 */
export function aggregateSimilarCompanies(
  matches: MatchLike[] | null | undefined,
  opts?: { limit?: number },
): VerifiedRecipient[] {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  if (!Array.isArray(matches) || matches.length === 0) return [];

  const collect = (pool: MatchLike[]): VerifiedRecipient[] => {
    const out: VerifiedRecipient[] = [];
    for (const m of pool) {
      const recipients = m?.history?.recipients;
      if (!Array.isArray(recipients)) continue;
      for (const r of recipients) {
        if (!r) continue;
        if (typeof r.sourceUrl !== "string" || r.sourceUrl.trim().length === 0) continue;
        if (!r.company || !r.program || !r.agency) continue;
        out.push({
          company: r.company,
          program: r.program,
          agency: r.agency,
          amount: r.amount,
          year: r.year,
          sourceUrl: r.sourceUrl,
        });
      }
    }
    return out;
  };

  const strong = matches.filter((m) => m && (m.tier === "likely" || m.tier === "verify"));
  let verified = collect(strong);
  if (verified.length === 0) {
    // Honest fallback: no verified recipients among strong matches — try the
    // full match set rather than showing nothing when verified data exists
    // elsewhere on the map.
    verified = collect(matches);
  }

  const dedupedByKey = new Map<string, VerifiedRecipient>();
  for (const r of verified) {
    const key = recipientKey(r);
    if (!dedupedByKey.has(key)) dedupedByKey.set(key, r);
  }

  const deduped = Array.from(dedupedByKey.values());
  deduped.sort((a, b) => {
    if (b.amount !== a.amount) return b.amount - a.amount;
    const byCompany = a.company.localeCompare(b.company);
    if (byCompany !== 0) return byCompany;
    const byProgram = a.program.localeCompare(b.program);
    if (byProgram !== 0) return byProgram;
    const byAgency = a.agency.localeCompare(b.agency);
    if (byAgency !== 0) return byAgency;
    return a.year - b.year;
  });

  return deduped.slice(0, limit);
}
