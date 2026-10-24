"use client";
import type { OpportunityMap as MapT } from "@/lib/types";
import { buildFundingStrategy, type FundingStrategyItem } from "@/lib/strategy/fundingStrategy";

/**
 * D3 — "Your 12-month funding strategy".
 *
 * Presentation only. All sequencing lives in the pure, hermetically-tested
 * `lib/strategy/fundingStrategy.ts`; this component just renders the plan it
 * returns. It reads the EXISTING `OpportunityMap` the pipeline already produced
 * — no new fields, no re-matching, no scoring. Gated behind the default-off
 * `d3_funding_strategy` flag by its caller (`components/OpportunityMap.tsx`).
 *
 * Honest framing: "programs to investigate," never a promise of an award; a
 * deadline is shown only when the program actually carries a real one.
 */

/** Shared "eyebrow"-style mono label (matches OpportunityMap / AgencyMap). */
function eyebrowClass(extra = "") {
  return `font-mono text-[11px] uppercase tracking-eyebrow text-structure-on-canvas ${extra}`.trim();
}

function programTitle(it: FundingStrategyItem): string {
  const o = it.opportunity;
  return o.title ?? o.program ?? o.agency ?? "Program";
}

export default function FundingStrategy({ map }: { map: MapT }) {
  if (!map || typeof map !== "object") return null;

  const plan = buildFundingStrategy(map);
  if (plan.items.length === 0) return null;

  return (
    <section className="mt-10 border-t border-structure-on-canvas pt-7">
      <p className={eyebrowClass("mb-1")}>Your 12-month funding strategy</p>
      <p className="mt-1.5 max-w-2xl text-pretty font-body text-[13px] leading-relaxed text-foreground">
        {plan.intro}
      </p>

      {plan.registrationNote && (
        <p className="mt-4 rounded-lg bg-canvas-alt px-4 py-3 text-pretty font-body text-[13px] leading-relaxed text-foreground shadow-card">
          <span className={eyebrowClass("mr-2")}>Act now</span>
          {plan.registrationNote}
        </p>
      )}

      <ol className="mt-5 space-y-3">
        {plan.items.map((it, i) => (
          <li
            key={it.opportunity.id ?? i}
            className="rounded-lg bg-canvas-alt px-5 py-4 text-foreground shadow-card"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-balance font-display text-[16px] font-medium leading-snug">
                <span className="mr-2 font-mono text-[12px] tabular-nums text-structure-on-canvas">
                  {i + 1}.
                </span>
                {programTitle(it)}
              </p>
              <p className="font-mono text-[11px] uppercase tracking-eyebrow tabular-nums text-structure-on-canvas">
                {it.window.label}
              </p>
            </div>

            {it.opportunity.agency && (
              <p className="mt-0.5 font-mono text-[11px] text-foreground">{it.opportunity.agency}</p>
            )}

            <p className="mt-2 text-pretty font-body text-[13px] leading-relaxed text-foreground">
              {it.rationale}
            </p>
          </li>
        ))}
      </ol>

      <p className="mt-5 text-pretty font-body text-[12px] leading-relaxed text-foreground">
        These are programs to investigate, sequenced by fit and timing — not eligibility
        determinations or a promise of funding. Confirm each program&rsquo;s current deadline and
        requirements with its program officer before you invest time in an application.
      </p>
    </section>
  );
}
