"use client";
import { useId, useMemo } from "react";
import type { OpportunityMap as MapT } from "@/lib/types";
import {
  buildOpportunityGraph,
  type GraphNode,
  type GraphNodeKind,
  type OpportunityGraphModel,
} from "@/lib/graph/buildOpportunityGraph";

/**
 * D4 — Opportunity Graph.
 *
 * Compact node-link visualization of the SAME data already on the map:
 *
 *   Startup -> Technology -> Agency(s) -> Program(s) -> Award(s)
 *
 * Self-contained: plain SVG/CSS/React only, no external/CDN libraries, no new
 * npm dependency. The graph MODEL comes from the pure, hermetically-tested
 * `buildOpportunityGraph()` (`lib/graph/buildOpportunityGraph.ts`) — this
 * file only lays that model out and draws it, mirroring the existing
 * split between `lib/similar/aggregate.ts` (pure) and `SimilarCompanies.tsx`
 * (render), and between `AgencyMap.tsx`'s exported `deriveAgencyRelevance`
 * and its own default-exported render function.
 *
 * Theme-consistent: every fill/stroke/text color below is a CON-02 design
 * token (Tailwind `fill-*`/`stroke-*`/`text-*` classes backed by
 * `lib/design/tokens.ts`'s CSS variables) — never a raw hex literal, and
 * every color PAIRING used (white on structure fill, foreground on
 * canvas-alt, on-semantic ink on info/success/warning fills) is one already
 * verified AA by `scripts/design/contrast-check.mjs`'s REQUIRED_PAIRINGS.
 *
 * Accessible: the decorative SVG is `aria-hidden` (a node-link diagram has no
 * single equivalent "alt text"); a parallel, visually-hidden (`sr-only`)
 * nested list carries the SAME startup -> technology -> agency -> program ->
 * award structure as real DOM content, so screen-reader users get the full
 * hierarchy, not a one-line summary. A visible caption states what the graph
 * shows for sighted users who skip the diagram.
 */

// ---------------------------------------------------------------------------
// Layout constants (plain SVG, no layout library)
// ---------------------------------------------------------------------------

const NODE_WIDTH = 156;
const NODE_HEIGHT = 50;
const COLUMN_GAP = 48;
const ROW_GAP = 14;
const MARGIN = 18;

const KIND_ORDER: GraphNodeKind[] = ["startup", "technology", "agency", "program", "award"];

const KIND_LABEL: Record<GraphNodeKind, string> = {
  startup: "Your company",
  technology: "Technology",
  agency: "Agency",
  program: "Program",
  award: "Similar company funded",
};

type NodeStyle = { rect: string; label: string; sublabel: string };

const DEFAULT_STYLE: NodeStyle = {
  rect: "fill-canvas-alt stroke-structure-on-canvas",
  label: "fill-foreground",
  sublabel: "fill-foreground",
};

/** Fixed per-kind styling. `program` is further refined by tier below — see `styleFor`. */
const KIND_STYLE: Record<GraphNodeKind, NodeStyle> = {
  startup: { rect: "fill-structure", label: "fill-token-white", sublabel: "fill-token-white" },
  technology: DEFAULT_STYLE,
  agency: DEFAULT_STYLE,
  program: DEFAULT_STYLE,
  award: DEFAULT_STYLE,
};

/** Program nodes are color-coded by tier, reusing the SAME fg/bg pairings
 *  `contrast-check.mjs` already verifies AA for (badge ink on info/success/
 *  warning fill) — no new pairing is introduced. */
const TIER_STYLE: Record<string, NodeStyle> = {
  likely: { rect: "fill-success", label: "fill-on-semantic", sublabel: "fill-on-semantic" },
  verify: { rect: "fill-warning", label: "fill-on-semantic", sublabel: "fill-on-semantic" },
  adjacent: { rect: "fill-info", label: "fill-on-semantic", sublabel: "fill-on-semantic" },
};

function styleFor(node: GraphNode): NodeStyle {
  if (node.kind === "program" && typeof node.meta?.tier === "string") {
    return TIER_STYLE[node.meta.tier] ?? KIND_STYLE.program;
  }
  return KIND_STYLE[node.kind];
}

type LayoutNode = GraphNode & { x: number; y: number };

interface Layout {
  layoutNodes: LayoutNode[];
  nodesById: Map<string, LayoutNode>;
  width: number;
  height: number;
}

/** Simple column-per-kind layout: nodes of a kind are stacked vertically in
 *  their own column, each column vertically centered against the tallest
 *  one. No external layout library — just arithmetic. */
function layoutGraph(model: OpportunityGraphModel): Layout {
  const columns = KIND_ORDER.filter((k) => model.nodes.some((n) => n.kind === k));
  const byColumn = new Map<GraphNodeKind, GraphNode[]>();
  for (const node of model.nodes) {
    const list = byColumn.get(node.kind);
    if (list) list.push(node);
    else byColumn.set(node.kind, [node]);
  }

  const columnHeight = (k: GraphNodeKind) => {
    const n = byColumn.get(k)?.length ?? 0;
    return n * NODE_HEIGHT + Math.max(0, n - 1) * ROW_GAP;
  };
  const maxHeight = columns.reduce((max, k) => Math.max(max, columnHeight(k)), 0);

  const layoutNodes: LayoutNode[] = [];
  columns.forEach((kind, ci) => {
    const list = byColumn.get(kind) ?? [];
    const startY = MARGIN + (maxHeight - columnHeight(kind)) / 2;
    list.forEach((node, ri) => {
      layoutNodes.push({
        ...node,
        x: MARGIN + ci * (NODE_WIDTH + COLUMN_GAP),
        y: startY + ri * (NODE_HEIGHT + ROW_GAP),
      });
    });
  });

  const width = MARGIN * 2 + columns.length * NODE_WIDTH + Math.max(0, columns.length - 1) * COLUMN_GAP;
  const height = MARGIN * 2 + maxHeight;
  const nodesById = new Map(layoutNodes.map((n) => [n.id, n]));
  return { layoutNodes, nodesById, width: Math.max(width, NODE_WIDTH + MARGIN * 2), height: Math.max(height, NODE_HEIGHT + MARGIN * 2) };
}

/** A smooth horizontal connector between the right edge of `from` and the
 *  left edge of `to` (a flattened cubic bezier — no path-drawing library). */
function connectorPath(from: LayoutNode, to: LayoutNode): string {
  const x1 = from.x + NODE_WIDTH;
  const y1 = from.y + NODE_HEIGHT / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_HEIGHT / 2;
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

// ---------------------------------------------------------------------------
// Accessible fallback tree (sr-only DOM mirror of the same structure)
// ---------------------------------------------------------------------------

function childrenOf(model: OpportunityGraphModel): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const e of model.edges) {
    const list = map.get(e.source);
    if (list) list.push(e.target);
    else map.set(e.source, [e.target]);
  }
  return map;
}

function AccessibleNode({
  nodeId,
  nodesById,
  childrenMap,
}: {
  nodeId: string;
  nodesById: Map<string, GraphNode>;
  childrenMap: Map<string, string[]>;
}) {
  const node = nodesById.get(nodeId);
  if (!node) return null;
  const kids = childrenMap.get(nodeId) ?? [];
  return (
    <li>
      {KIND_LABEL[node.kind]}: {node.label}
      {node.sublabel ? ` — ${node.sublabel}` : ""}
      {kids.length > 0 && (
        <ul>
          {kids.map((id) => (
            <AccessibleNode key={id} nodeId={id} nodesById={nodesById} childrenMap={childrenMap} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function eyebrowClass(extra = "") {
  return `font-mono text-[11px] uppercase tracking-eyebrow text-structure-on-canvas ${extra}`.trim();
}

export default function OpportunityGraph({ map }: { map: MapT }) {
  const headingId = useId();
  const captionId = useId();

  const model = useMemo(() => buildOpportunityGraph(map), [map]);
  const layout = useMemo(() => layoutGraph(model), [model]);

  // Nothing but the startup root — no agency/program reached the bar, so
  // there is no graph worth drawing (matches OpportunityMap.tsx's own
  // "never show an empty band" rule for the stat cells above it).
  if (model.nodes.length <= 1) return null;

  const nodesById = new Map<string, GraphNode>(model.nodes.map((n) => [n.id, n]));
  const childrenMap = childrenOf(model);

  return (
    <section aria-labelledby={headingId} className="mt-10 border-t border-structure-on-canvas pt-7">
      <p id={headingId} className={eyebrowClass("mb-1")}>
        Your opportunity graph
      </p>
      <p id={captionId} className="mt-1.5 max-w-2xl text-pretty font-body text-[13px] leading-relaxed text-foreground">
        How your company connects to the agencies, programs, and similar funded companies above —
        traced from your profile through your strongest matches.
      </p>

      <figure className="mt-4">
        <div className="overflow-x-auto rounded-lg border border-structure-on-canvas bg-canvas-alt p-4 shadow-card">
          <svg
            role="presentation"
            aria-hidden="true"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            className="block"
          >
            <g>
              {model.edges.map((edge) => {
                const from = layout.nodesById.get(edge.source);
                const to = layout.nodesById.get(edge.target);
                if (!from || !to) return null;
                return (
                  <path
                    key={edge.id}
                    d={connectorPath(from, to)}
                    className="stroke-structure-on-canvas"
                    strokeOpacity={0.4}
                    strokeWidth={1.5}
                    fill="none"
                  />
                );
              })}
            </g>
            <g>
              {layout.layoutNodes.map((node) => {
                const style = styleFor(node);
                const hasSub = Boolean(node.sublabel);
                return (
                  <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                    <rect
                      width={NODE_WIDTH}
                      height={NODE_HEIGHT}
                      rx={8}
                      strokeWidth={1}
                      className={style.rect}
                    />
                    <text
                      x={10}
                      y={hasSub ? 20 : NODE_HEIGHT / 2 + 4}
                      className={`${style.label} font-body text-[12px] font-medium`}
                    >
                      {clip(node.label, 22)}
                    </text>
                    {hasSub && (
                      <text x={10} y={36} className={`${style.sublabel} font-mono text-[10px]`}>
                        {clip(node.sublabel!, 26)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        <figcaption className="sr-only">
          Opportunity graph, from your company through to similar funded companies.
          <ul>
            <AccessibleNode nodeId="startup" nodesById={nodesById} childrenMap={childrenMap} />
          </ul>
        </figcaption>
      </figure>
    </section>
  );
}

/** SVG has no text-wrapping, so labels are hard-clipped to a character count
 *  on top of the model's own truncation (which targets a longer, DOM-safe
 *  length). Ellipsis keeps a clipped label recognizable as partial. */
function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
