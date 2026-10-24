"use client";
import type { OpportunityMap as MapT, Match } from "@/lib/types";

/**
 * D2 — "Agencies most relevant to you" view.
 *
 * Pure presentation layer on top of the EXISTING `agencyIntelligence` already
 * computed by `buildOpportunityMap` (`lib/match.ts`, ~line 368). This
 * component does not recompute scoring, matching, or agency selection — it
 * only derives a richer why-relevant explanation from fields already present
 * on the map it's handed:
 *   - `agencyIntelligence[].why` / `.opportunityCount` (already computed)
 *   - `matches[].opportunity.program` / `.industryTags` (already on every
 *     match — see `lib/contracts/opportunity.ts`)
 *
 * No new fields are added to the pipeline or the `opportunityMap.ts`
 * contract; everything here is derived client-side from data the map already
 * carries.
 */

export type AgencyIntel = MapT["agencyIntelligence"][number];

/** Minimal agency-intelligence shape the pure derivation needs — matches
 *  `AgencyIntel` structurally without importing the zod contract, so
 *  `deriveAgencyRelevance` stays a dependency-light, hermetically-testable
 *  module (mirrors `lib/similar/aggregate.ts`'s `MatchLike` pattern). */
export type AgencyIntelLike = {
  agency: string;
  why: string;
  opportunityCount: number;
};

/** Minimal match shape the pure derivation needs — a subset of `Match`. */
export type MatchLike = {
  tier?: string;
  score?: number;
  opportunity?: {
    agency?: string;
    program?: string;
    industryTags?: string[];
  };
};

export type AgencyRelevance = AgencyIntelLike & {
  /** Distinct matched program names for this agency, highest-score first. */
  programs: string[];
  /** Distinct industry/sector tags across this agency's matched programs. */
  sectors: string[];
  /** The rendered why-relevant line: the LLM-authored `why` when present,
   *  otherwise a fallback synthesized from count/programs/sectors so the
   *  view never renders a blank explanation. */
  headline: string;
};

const MAX_SUPPORTING_ITEMS = 3;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Stable de-dupe, order-preserving, capped. */
function dedupeCapped(items: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

function synthesizeHeadline(count: number, programs: string[], sectors: string[]): string {
  const countPhrase = `${count} matching ${count === 1 ? "opportunity" : "opportunities"}`;
  const programPhrase = programs.length > 0 ? ` including ${programs.join(", ")}` : "";
  const sectorPhrase = sectors.length > 0 ? ` in ${sectors.join(", ")}` : "";
  return `${countPhrase}${programPhrase}${sectorPhrase}.`;
}

/**
 * Pure, hermetic derivation (no rendering) so it's independently testable
 * without a DOM. For each agency already surfaced by `agencyIntelligence`,
 * pulls the strong (likely/verify) matches under that agency — the same
 * population `lib/match.ts` used to compute `why`/`opportunityCount` — and
 * extracts the concrete program names + sector tags already sitting on
 * `match.opportunity`. When the LLM-authored `why` is empty (the contract
 * defaults narrative strings to `""`, see `opportunityMap.ts`), a fallback
 * headline is synthesized from that same evidence so the view never shows a
 * blank why-relevant line.
 */
export function deriveAgencyRelevance(
  agencyIntelligence: AgencyIntelLike[] | null | undefined,
  matches: MatchLike[] | null | undefined,
): AgencyRelevance[] {
  const safeIntel = Array.isArray(agencyIntelligence) ? agencyIntelligence : [];
  const safeMatches = Array.isArray(matches) ? matches : [];

  return safeIntel.map((a) => {
    const agencyMatches = safeMatches
      .filter(
        (m) =>
          m &&
          m.opportunity?.agency === a.agency &&
          (m.tier === "likely" || m.tier === "verify"),
      )
      .sort((x, y) => (y.score ?? 0) - (x.score ?? 0));

    const programs = dedupeCapped(
      agencyMatches.map((m) => m.opportunity?.program).filter(isNonEmptyString),
      MAX_SUPPORTING_ITEMS,
    );
    const sectors = dedupeCapped(
      agencyMatches.flatMap((m) => m.opportunity?.industryTags ?? []).filter(isNonEmptyString),
      MAX_SUPPORTING_ITEMS,
    );

    const headline = isNonEmptyString(a.why)
      ? a.why
      : synthesizeHeadline(a.opportunityCount, programs, sectors);

    return { ...a, programs, sectors, headline };
  });
}

/** Shared "eyebrow"-style mono label (matches OpportunityMap/EligibilityBuckets). */
function eyebrowClass(extra = "") {
  return `font-mono text-[11px] uppercase tracking-eyebrow text-structure-on-canvas ${extra}`.trim();
}

export default function AgencyMap({
  agencyIntelligence,
  matches,
}: {
  agencyIntelligence: AgencyIntel[];
  matches: Match[];
}) {
  const items = deriveAgencyRelevance(agencyIntelligence, matches);
  if (items.length === 0) return null;

  return (
    <section className="mt-10 border-t border-structure-on-canvas pt-7">
      <p className={eyebrowClass("mb-4")}>Agencies most relevant to you</p>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((a) => (
          <div key={a.agency}>
            <p className="text-balance font-display text-[15px] font-medium">{a.agency}</p>
            <p className="font-mono text-[11px] text-foreground tabular-nums">
              {a.opportunityCount} {a.opportunityCount === 1 ? "opportunity" : "opportunities"}
            </p>
            <p className="mt-1.5 text-pretty font-body text-[13px] leading-relaxed text-foreground">
              {a.headline}
            </p>
            {isNonEmptyString(a.why) && (a.programs.length > 0 || a.sectors.length > 0) && (
              <p className="mt-1 font-mono text-[11px] text-foreground">
                {a.programs.length > 0 && <>Programs: {a.programs.join(", ")}</>}
                {a.programs.length > 0 && a.sectors.length > 0 && " · "}
                {a.sectors.length > 0 && <>Sectors: {a.sectors.join(", ")}</>}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
