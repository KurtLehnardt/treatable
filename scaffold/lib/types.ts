/**
 * lib/types.ts — v1 public type surface, now backed by the §3 contracts.
 *
 * CON-01 migrated the v1 ad-hoc types into `lib/contracts/` (zod schema +
 * inferred type per §3). This file now RE-EXPORTS those contract types so
 * `lib/match.ts`, `lib/claude.ts`, and `components/*` keep importing from
 * `@/lib/types` unchanged.
 *
 * Two presentational constants (`TIER_LABEL`, `TIER_COLOR`) stay here rather
 * than in `lib/contracts/`: they hold raw hex, and CON-01 forbids design values
 * in the contracts module (that is CON-02). Keeping them here is the minimal,
 * non-breaking home for them until the design-token contract lands.
 */

import type { Tier } from "./contracts";
import type {
  Match as MatchContract,
  OpportunityMap as OpportunityMapContract,
} from "./contracts";
import type { EligibilityDeterminationWithFreshness } from "./eligibility/freshness";
import type { SearchCostDebug } from "./metering/meter";

// Re-export the formalized v1 types (and the richer §3 Opportunity superset)
// from the contracts barrel. Same names the v1 code already imports.
export type {
  Tier,
  StartupProfile,
  Opportunity,
  AwardHistory,
  CriterionCheck,
} from "./contracts";

/**
 * ELG-04 — app-facing `Match` is the CON-01 contract `Match` plus its
 * OPTIONAL, additive `eligibility` field: the ELG-01 determination wrapped with
 * its ELG-02 freshness annotation, attached by `buildOpportunityMap`.
 *
 * (schema-reconcile) The zod `MatchSchema` in `lib/contracts/opportunityMap.ts`
 * now DECLARES `eligibility` itself (as an optional field mirroring
 * `EligibilityDeterminationWithFreshness`), rather than staying silently frozen
 * to the v1 shape — so a live map's boundary validation actually reflects what
 * `buildOpportunityMap` produces. This TS type still re-states the field
 * (harmless intersection with the now-matching zod-inferred shape) so it reads
 * standalone; the important cache-safety property is unchanged: it's optional,
 * so cached/precomputed maps (which lack it) validate and type-check exactly
 * as before.
 */
export type Match = MatchContract & {
  eligibility?: EligibilityDeterminationWithFreshness;
};

/**
 * R4b — app-facing `OpportunityMap` additionally carries an OPTIONAL
 * `costDebug`: the per-search token-cost/latency breakdown `buildOpportunityMap`
 * (`lib/match.ts`) attaches only when the `r4b_cost_debug` flag is on (cost
 * figures must never reach the end-user UI without it — see lib/flags/registry.ts).
 *
 * (schema-reconcile) Same as `Match.eligibility` above: the zod
 * `OpportunityMapSchema` now DECLARES `costDebug` itself (optional, mirroring
 * `SearchCostDebug`) so boundary validation matches the live builder's actual
 * output instead of silently drifting from it. Still optional, so
 * cached/precomputed maps (which never carry it) and every live map with the
 * flag off keep validating unchanged.
 */
export type OpportunityMap = Omit<OpportunityMapContract, "matches"> & {
  matches: Match[];
  costDebug?: SearchCostDebug;
};

export const TIER_LABEL: Record<Tier, string> = {
  likely: "Likely Fit",
  verify: "Potential Fit — Verify Eligibility",
  adjacent: "Adjacent Opportunity",
  none: "Probably Not a Fit",
};

export const TIER_COLOR: Record<Tier, string> = {
  likely: "#1E7A4C",
  verify: "#B4801A",
  adjacent: "#C25A2B",
  none: "#6B7280",
};
