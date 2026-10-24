/**
 * D4 — Opportunity Graph: pure graph-model builder.
 *
 * Turns the EXISTING `OpportunityMap` shape (`lib/types.ts`) into a compact
 * node-link model — `{ nodes, edges }` — for `components/OpportunityGraph.tsx`
 * to render as plain SVG. This module does no rendering and has no React/DOM
 * dependency, so it is hermetically unit-testable (mirrors the
 * `lib/similar/aggregate.ts` / `components/AgencyMap.tsx#deriveAgencyRelevance`
 * pattern: a pure derivation next to its presentational consumer).
 *
 * Graph shape (a fixed pipeline, columns only appear when they have data):
 *
 *   Startup -> Technology -> Agency(s) -> Program(s) -> Award(s)
 *
 * - Startup: `map.profile` (always present — one node).
 * - Technology: `profile.technology`, when set (zero or one node).
 * - Agency: agencies behind the shown matches, ordered by
 *   `agencyIntelligence` relevance where available, falling back to
 *   strongest-match order; capped to `maxAgencies`.
 *   docs (D2's `AgencyMap.tsx`).
 * - Program: the top matches per shown agency (by score), capped to
 *   `maxProgramsPerAgency`.
 * - Award: verified award recipients ("similar companies that got funded")
 *   for a shown program — sourced from `match.history` and run back through
 *   the EXISTING `aggregateSimilarCompanies()` (`lib/similar/aggregate.ts`)
 *   so this graph reuses the same dedupe/verified-sourceUrl/deterministic-
 *   sort guarantees as the D1 panel rather than re-implementing them.
 *
 * Every match with `tier === "none"` is excluded, same as `OpportunityMap.tsx`'s
 * own `shown` derivation — this graph never surfaces a "not a fit" opportunity.
 *
 * Deliberately dependency-light: only `MapLike`/`MatchLike`/etc. structural
 * types are required (no zod contract import), so a caller can hand this a
 * real `OpportunityMap`, a test fixture, or any structurally-compatible object.
 */

import { aggregateSimilarCompanies, type MatchLike as AggregateMatchLike } from "@/lib/similar/aggregate";

// ---------------------------------------------------------------------------
// Public graph-model types
// ---------------------------------------------------------------------------

export type GraphNodeKind = "startup" | "technology" | "agency" | "program" | "award";

export interface GraphNode {
  /** Stable, unique within the graph. */
  id: string;
  kind: GraphNodeKind;
  /** Primary label rendered on the node. */
  label: string;
  /** Optional secondary line (count, tier, amount, etc). */
  sublabel?: string;
  /** Extra structured data a renderer may want (tier, score, sourceUrl, ...). */
  meta?: Record<string, string | number | undefined>;
}

export interface GraphEdge {
  /** Stable, unique within the graph. */
  id: string;
  source: string;
  target: string;
}

export interface OpportunityGraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Minimal structural input types (dependency-light — no zod import)
// ---------------------------------------------------------------------------

export type ProfileLike = {
  description?: string;
  industry?: string;
  technology?: string;
};

export type OpportunityLike = {
  id?: string;
  program: string;
  agency: string;
  kind?: string;
};

export type RecipientLike = {
  company: string;
  program: string;
  agency: string;
  amount: number;
  year: number;
  sourceUrl?: string;
};

export type MatchLike = {
  opportunity: OpportunityLike;
  tier?: string;
  score?: number;
  history?: { recipients?: RecipientLike[] };
};

export type AgencyIntelLike = {
  agency: string;
  opportunityCount?: number;
};

export type MapLike = {
  profile?: ProfileLike;
  matches?: MatchLike[];
  agencyIntelligence?: AgencyIntelLike[];
};

export interface BuildOpportunityGraphOptions {
  /** Max distinct agency nodes shown. Default 4. */
  maxAgencies?: number;
  /** Max program nodes shown per agency. Default 2. */
  maxProgramsPerAgency?: number;
  /** Max award nodes shown per program. Default 2. */
  maxAwardsPerProgram?: number;
  /** Max award nodes shown in total across the whole graph. Default 8. */
  maxAwardsTotal?: number;
}

const DEFAULT_MAX_AGENCIES = 4;
const DEFAULT_MAX_PROGRAMS_PER_AGENCY = 2;
const DEFAULT_MAX_AWARDS_PER_PROGRAM = 2;
const DEFAULT_MAX_AWARDS_TOTAL = 8;

const TIER_TEXT: Record<string, string> = {
  likely: "Likely fit",
  verify: "Verify eligibility",
  adjacent: "Adjacent",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slug(s: string): string {
  const cleaned = s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "x";
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…` : t;
}

function money(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** Order-preserving de-dupe. */
function dedupe<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function agencyProgramKey(agency: string, program: string): string {
  return `${agency.trim().toLowerCase()}|${program.trim().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Builds a compact node-link graph model from an `OpportunityMap`-shaped
 * object. Pure and side-effect-free: safe to call on the server, in a test,
 * or from a client component's render.
 */
export function buildOpportunityGraph(
  map: MapLike | null | undefined,
  opts?: BuildOpportunityGraphOptions,
): OpportunityGraphModel {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  if (!map || typeof map !== "object") return { nodes, edges };

  const maxAgencies = opts?.maxAgencies ?? DEFAULT_MAX_AGENCIES;
  const maxProgramsPerAgency = opts?.maxProgramsPerAgency ?? DEFAULT_MAX_PROGRAMS_PER_AGENCY;
  const maxAwardsPerProgram = opts?.maxAwardsPerProgram ?? DEFAULT_MAX_AWARDS_PER_PROGRAM;
  const maxAwardsTotal = opts?.maxAwardsTotal ?? DEFAULT_MAX_AWARDS_TOTAL;

  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();

  function addNode(node: GraphNode): void {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  }

  function addEdge(source: string, target: string): void {
    if (!nodeIds.has(source) || !nodeIds.has(target)) return;
    const key = `${source}->${target}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ id: key, source, target });
  }

  // --- Startup (always present — the graph's single root). ---
  const description = map.profile?.description?.trim();
  const startupLabel = description ? truncate(description, 56) : "Your company";
  addNode({
    id: "startup",
    kind: "startup",
    label: startupLabel,
    sublabel: map.profile?.industry?.trim() || undefined,
  });
  let rootId = "startup";

  // --- Technology (optional single node). ---
  const technology = map.profile?.technology?.trim();
  if (technology) {
    addNode({ id: "technology", kind: "technology", label: truncate(technology, 40) });
    addEdge("startup", "technology");
    rootId = "technology";
  }

  // Real fits only — mirrors OpportunityMap.tsx's own `shown` filter (never
  // surface a "not a fit" opportunity on the graph), best-scoring first.
  const matches = (Array.isArray(map.matches) ? map.matches : [])
    .filter((m): m is MatchLike => !!m && !!m.opportunity && m.tier !== "none")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  if (matches.length === 0) return { nodes, edges };

  // --- Agency(s). Prefer the existing agencyIntelligence relevance order
  // (D2's own ranking), restricted to agencies actually behind a shown
  // match; fall back to strongest-match order for any agency intelligence
  // didn't cover. Capped to maxAgencies. ---
  const matchAgenciesByScore = dedupe(matches.map((m) => m.opportunity.agency));
  const intelAgencies = (Array.isArray(map.agencyIntelligence) ? map.agencyIntelligence : []).map(
    (a) => a.agency,
  );
  const agencyOrder = dedupe([
    ...intelAgencies.filter((a) => matchAgenciesByScore.includes(a)),
    ...matchAgenciesByScore,
  ]).slice(0, maxAgencies);

  // Verified award recipients, globally deduped/sorted by the EXISTING D1
  // aggregator — generous internal limit so awards for every shown program
  // (not just the globally-top 10) have a chance to surface; the per-program
  // and per-graph caps below do the actual trimming for display.
  const verifiedRecipients = aggregateSimilarCompanies(matches as AggregateMatchLike[], {
    limit: Math.max(maxAwardsTotal * 4, 40),
  });
  const recipientsByParentKey = new Map<string, RecipientLike[]>();
  for (const r of verifiedRecipients) {
    const key = agencyProgramKey(r.agency, r.program);
    const bucket = recipientsByParentKey.get(key);
    if (bucket) bucket.push(r);
    else recipientsByParentKey.set(key, [r]);
  }

  let awardsRendered = 0;

  for (const agency of agencyOrder) {
    const agencyId = `agency:${slug(agency)}`;
    const agencyMatches = matches.filter((m) => m.opportunity.agency === agency);
    addNode({
      id: agencyId,
      kind: "agency",
      label: agency,
      sublabel: `${agencyMatches.length} ${agencyMatches.length === 1 ? "opportunity" : "opportunities"}`,
    });
    addEdge(rootId, agencyId);

    const topPrograms = agencyMatches.slice(0, maxProgramsPerAgency);
    for (const m of topPrograms) {
      const program = m.opportunity.program;
      const programId = `program:${m.opportunity.id ? slug(m.opportunity.id) : slug(`${agency}|${program}`)}`;
      addNode({
        id: programId,
        kind: "program",
        label: truncate(program, 48),
        sublabel: m.tier ? TIER_TEXT[m.tier] ?? m.tier : undefined,
        meta: { tier: m.tier, score: m.score },
      });
      addEdge(agencyId, programId);

      if (awardsRendered >= maxAwardsTotal) continue;
      const recipients = recipientsByParentKey.get(agencyProgramKey(agency, program)) ?? [];
      for (const r of recipients.slice(0, maxAwardsPerProgram)) {
        if (awardsRendered >= maxAwardsTotal) break;
        const awardId = `award:${slug(r.company)}:${slug(r.program)}:${r.year}`;
        const isNew = !nodeIds.has(awardId);
        addNode({
          id: awardId,
          kind: "award",
          label: truncate(r.company, 36),
          sublabel: [money(r.amount), String(r.year)].filter(Boolean).join(" · "),
          meta: { amount: r.amount, year: r.year, sourceUrl: r.sourceUrl },
        });
        addEdge(programId, awardId);
        if (isNew) awardsRendered += 1;
      }
    }
  }

  return { nodes, edges };
}
