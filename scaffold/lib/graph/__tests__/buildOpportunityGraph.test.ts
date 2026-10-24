import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildOpportunityGraph,
  type MapLike,
  type MatchLike,
  type GraphNode,
} from "../buildOpportunityGraph";

/**
 * D4 — Opportunity Graph.
 *
 * Mirrors the existing lib test style (node:test + assert, no network, no
 * DOM — see lib/similar/__tests__/aggregate.test.ts and
 * components/__tests__/AgencyMap.test.ts). Exercises the pure
 * `buildOpportunityGraph` model builder only; rendering lives in
 * components/OpportunityGraph.tsx and is untested here by design (this
 * module has no React/DOM dependency).
 */

function nodesOfKind(nodes: GraphNode[], kind: GraphNode["kind"]): GraphNode[] {
  return nodes.filter((n) => n.kind === kind);
}

describe("buildOpportunityGraph", () => {
  test("handles empty/missing input without throwing", () => {
    assert.deepEqual(buildOpportunityGraph(null), { nodes: [], edges: [] });
    assert.deepEqual(buildOpportunityGraph(undefined), { nodes: [], edges: [] });
    assert.deepEqual(buildOpportunityGraph({}), {
      nodes: [{ id: "startup", kind: "startup", label: "Your company", sublabel: undefined }],
      edges: [],
    });
  });

  test("a map with only none-tier matches yields no agency/program/award nodes", () => {
    const map: MapLike = {
      profile: { description: "We build things." },
      matches: [{ opportunity: { program: "P1", agency: "NASA" }, tier: "none", score: 10 }],
    };
    const result = buildOpportunityGraph(map);
    assert.equal(result.nodes.length, 1);
    assert.equal(result.nodes[0].kind, "startup");
    assert.equal(result.edges.length, 0);
  });

  test("a startup with a technology but no viable (non-none) matches still shows the technology node", () => {
    const map: MapLike = {
      profile: { description: "We build things.", technology: "Widgets" },
      matches: [{ opportunity: { program: "P1", agency: "NASA" }, tier: "none", score: 10 }],
    };
    const result = buildOpportunityGraph(map);
    assert.deepEqual(
      result.nodes.map((n) => n.kind),
      ["startup", "technology"],
    );
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].source, "startup");
    assert.equal(result.edges[0].target, "technology");
  });

  test("always includes a single startup node, labeled from profile.description", () => {
    const map: MapLike = {
      profile: { description: "  A rural telehealth AI platform.  ", industry: "Health IT" },
      matches: [{ opportunity: { program: "Rural Health Grant", agency: "HHS" }, tier: "likely", score: 90 }],
    };
    const result = buildOpportunityGraph(map);
    const startup = result.nodes.find((n) => n.id === "startup")!;
    assert.equal(startup.label, "A rural telehealth AI platform.");
    assert.equal(startup.sublabel, "Health IT");
  });

  test("falls back to a generic startup label when profile.description is missing/blank", () => {
    const result = buildOpportunityGraph({ profile: { description: "   " } });
    assert.equal(result.nodes[0].label, "Your company");
  });

  test("truncates a very long startup description", () => {
    const longDesc = "A".repeat(200);
    const result = buildOpportunityGraph({ profile: { description: longDesc } });
    const startup = result.nodes[0];
    assert.ok(startup.label.length <= 56);
    assert.ok(startup.label.endsWith("…"));
  });

  test("adds a technology node between startup and agency only when profile.technology is set", () => {
    const withTech: MapLike = {
      profile: { description: "Co A", technology: "Battery chemistry" },
      matches: [{ opportunity: { program: "P1", agency: "DOE" }, tier: "likely", score: 80 }],
    };
    const r1 = buildOpportunityGraph(withTech);
    assert.equal(nodesOfKind(r1.nodes, "technology").length, 1);
    assert.ok(r1.edges.some((e) => e.source === "startup" && e.target === "technology"));
    assert.ok(r1.edges.some((e) => e.source === "technology" && e.target === "agency:doe"));

    const withoutTech: MapLike = {
      profile: { description: "Co A" },
      matches: [{ opportunity: { program: "P1", agency: "DOE" }, tier: "likely", score: 80 }],
    };
    const r2 = buildOpportunityGraph(withoutTech);
    assert.equal(nodesOfKind(r2.nodes, "technology").length, 0);
    assert.ok(r2.edges.some((e) => e.source === "startup" && e.target === "agency:doe"));
  });

  test("dedupes agencies across multiple matches into a single node", () => {
    const map: MapLike = {
      profile: { description: "Co A" },
      matches: [
        { opportunity: { program: "P1", agency: "NSF" }, tier: "likely", score: 90 },
        { opportunity: { program: "P2", agency: "NSF" }, tier: "verify", score: 60 },
      ],
    };
    const result = buildOpportunityGraph(map);
    assert.equal(nodesOfKind(result.nodes, "agency").length, 1);
    const agency = nodesOfKind(result.nodes, "agency")[0];
    assert.equal(agency.label, "NSF");
    assert.equal(agency.sublabel, "2 opportunities");
    assert.equal(nodesOfKind(result.nodes, "program").length, 2);
  });

  test("orders agencies by agencyIntelligence relevance, falling back to score order for the rest", () => {
    const matches: MatchLike[] = [
      { opportunity: { program: "P-nasa", agency: "NASA" }, tier: "likely", score: 95 },
      { opportunity: { program: "P-doe", agency: "DOE" }, tier: "likely", score: 90 },
      { opportunity: { program: "P-nsf", agency: "NSF" }, tier: "verify", score: 50 },
    ];
    const map: MapLike = {
      profile: { description: "Co A" },
      // Intelligence explicitly ranks NSF above NASA/DOE despite lower score.
      agencyIntelligence: [{ agency: "NSF" }, { agency: "NASA" }],
      matches,
    };
    const result = buildOpportunityGraph(map);
    const agencyOrder = nodesOfKind(result.nodes, "agency").map((n) => n.label);
    // NSF and NASA (in agencyIntelligence order) come first, then DOE
    // (score-order fallback, not covered by agencyIntelligence).
    assert.deepEqual(agencyOrder, ["NSF", "NASA", "DOE"]);
  });

  test("caps agencies to maxAgencies and programs to maxProgramsPerAgency", () => {
    const matches: MatchLike[] = [
      { opportunity: { program: "A1", agency: "Agency1" }, tier: "likely", score: 99 },
      { opportunity: { program: "A2", agency: "Agency1" }, tier: "likely", score: 98 },
      { opportunity: { program: "A3", agency: "Agency1" }, tier: "likely", score: 97 },
      { opportunity: { program: "B1", agency: "Agency2" }, tier: "likely", score: 96 },
      { opportunity: { program: "B2", agency: "Agency2" }, tier: "likely", score: 95 },
      { opportunity: { program: "C1", agency: "Agency3" }, tier: "likely", score: 94 },
    ];
    const result = buildOpportunityGraph(
      { profile: { description: "Co" }, matches },
      { maxAgencies: 2, maxProgramsPerAgency: 2 },
    );
    assert.equal(nodesOfKind(result.nodes, "agency").length, 2);
    assert.equal(nodesOfKind(result.nodes, "program").length, 4); // 2 agencies x 2 programs
  });

  test("attaches verified award recipients (via aggregateSimilarCompanies) under the matching program node", () => {
    const matches: MatchLike[] = [
      {
        opportunity: { id: "opp-1", program: "SBIR Phase I", agency: "NIH" },
        tier: "likely",
        score: 90,
        history: {
          recipients: [
            {
              company: "Acme Biotech",
              program: "SBIR Phase I",
              agency: "NIH",
              amount: 250000,
              year: 2023,
              sourceUrl: "https://www.sbir.gov/awards?firm=acme",
            },
          ],
        },
      },
    ];
    const result = buildOpportunityGraph({ profile: { description: "Co" }, matches });
    const awardNodes = nodesOfKind(result.nodes, "award");
    assert.equal(awardNodes.length, 1);
    assert.equal(awardNodes[0].label, "Acme Biotech");
    assert.ok(awardNodes[0].sublabel?.includes("2023"));

    const programNode = nodesOfKind(result.nodes, "program")[0];
    assert.ok(result.edges.some((e) => e.source === programNode.id && e.target === awardNodes[0].id));
  });

  test("never renders an award recipient without a verified sourceUrl (defense-in-depth via aggregateSimilarCompanies)", () => {
    const matches: MatchLike[] = [
      {
        opportunity: { program: "P1", agency: "NIH" },
        tier: "likely",
        score: 90,
        history: {
          recipients: [
            { company: "Unverified Co", program: "P1", agency: "NIH", amount: 100000, year: 2022 }, // no sourceUrl
          ],
        },
      },
    ];
    const result = buildOpportunityGraph({ profile: { description: "Co" }, matches });
    assert.equal(nodesOfKind(result.nodes, "award").length, 0);
  });

  test("caps total award nodes to maxAwardsTotal across the whole graph", () => {
    const makeRecipients = (agency: string, program: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        company: `${agency} Co ${i}`,
        program,
        agency,
        amount: 100000 + i,
        year: 2020 + i,
        sourceUrl: `https://www.sbir.gov/awards?firm=${agency}-${i}`,
      }));

    const matches: MatchLike[] = [
      {
        opportunity: { program: "P1", agency: "Agency1" },
        tier: "likely",
        score: 90,
        history: { recipients: makeRecipients("Agency1", "P1", 5) },
      },
      {
        opportunity: { program: "P2", agency: "Agency2" },
        tier: "likely",
        score: 85,
        history: { recipients: makeRecipients("Agency2", "P2", 5) },
      },
    ];
    const result = buildOpportunityGraph(
      { profile: { description: "Co" }, matches },
      { maxAwardsPerProgram: 5, maxAwardsTotal: 3 },
    );
    assert.equal(nodesOfKind(result.nodes, "award").length, 3);
  });

  test("every edge references nodes that exist in the graph (no dangling edges)", () => {
    const matches: MatchLike[] = [
      {
        opportunity: { id: "opp-1", program: "SBIR Phase I", agency: "NIH" },
        tier: "likely",
        score: 90,
        history: {
          recipients: [
            {
              company: "Acme Biotech",
              program: "SBIR Phase I",
              agency: "NIH",
              amount: 250000,
              year: 2023,
              sourceUrl: "https://www.sbir.gov/awards?firm=acme",
            },
          ],
        },
      },
      { opportunity: { program: "Other", agency: "DOE" }, tier: "verify", score: 40 },
    ];
    const result = buildOpportunityGraph({
      profile: { description: "Co", technology: "Tech" },
      agencyIntelligence: [{ agency: "NIH" }],
      matches,
    });
    const ids = new Set(result.nodes.map((n) => n.id));
    for (const edge of result.edges) {
      assert.ok(ids.has(edge.source), `dangling edge source: ${edge.source}`);
      assert.ok(ids.has(edge.target), `dangling edge target: ${edge.target}`);
    }
    // No duplicate edges.
    assert.equal(new Set(result.edges.map((e) => e.id)).size, result.edges.length);
  });

  test("is deterministic — re-running against the same input yields an identical graph", () => {
    const map: MapLike = {
      profile: { description: "Co A", technology: "Widgets" },
      agencyIntelligence: [{ agency: "NSF" }],
      matches: [
        { opportunity: { program: "P1", agency: "NSF" }, tier: "likely", score: 90 },
        { opportunity: { program: "P2", agency: "DOE" }, tier: "verify", score: 60 },
      ],
    };
    const a = buildOpportunityGraph(map);
    const b = buildOpportunityGraph(map);
    assert.deepEqual(a, b);
  });
});
