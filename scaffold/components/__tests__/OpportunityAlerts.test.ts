import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import type { OpportunityMap } from "../../lib/types";
import OpportunityAlerts from "../OpportunityAlerts";

/**
 * D5 — Opportunity Alerts component. Covers:
 *  - a rendered smoke test (no jsdom needed; renderToStaticMarkup only needs
 *    React — same technique as components/__tests__/ApplicationChecklist.test.ts).
 *    Effects (the localStorage read/diff/write in useEffect) don't run under
 *    SSR, so this exercises exactly the pre-hydration render: the component
 *    must render nothing rather than flashing stale/wrong content before
 *    mount.
 *  - a static source-scan proving OpportunityMap.tsx's insertion is (a) gated
 *    behind isFlagEnabled("d5_alerts") and (b) a single, minimal insertion —
 *    the same repo-local static-scan technique lib/__tests__/noServerRetention.test.ts
 *    uses to guard a wiring invariant without needing a live flag-flip render.
 */

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const EMPTY_MAP: OpportunityMap = {
  profile: { description: "We build AI diagnostics for rural clinics." },
  followUps: [],
  summary: { highPotential: 0, fundingIdentified: 0, agencies: 0, closingIn90Days: 0 },
  matches: [],
  agencyIntelligence: [],
};

describe("<OpportunityAlerts/> render", () => {
  test("renders nothing before hydration (SSR-safe: no effects run, alerts start empty)", () => {
    const html = renderToStaticMarkup(React.createElement(OpportunityAlerts, { map: EMPTY_MAP }));
    assert.equal(html, "");
  });

  test("does not throw on a malformed/empty map", () => {
    assert.doesNotThrow(() =>
      renderToStaticMarkup(
        React.createElement(OpportunityAlerts, { map: {} as unknown as OpportunityMap }),
      ),
    );
  });
});

describe("OpportunityMap.tsx wires OpportunityAlerts behind the d5_alerts flag", () => {
  const source = readFileSync(join(__dirname, "..", "OpportunityMap.tsx"), "utf8");

  test("imports OpportunityAlerts", () => {
    assert.match(source, /import OpportunityAlerts from ["']\.\/OpportunityAlerts["'];?/);
  });

  test("renders it exactly once, gated behind isFlagEnabled(\"d5_alerts\")", () => {
    const gateMatches = source.match(/isFlagEnabled\("d5_alerts"\)\s*&&\s*<OpportunityAlerts\s+map=\{map\}\s*\/>/g);
    assert.ok(gateMatches, "expected OpportunityMap.tsx to contain the d5_alerts flag gate");
    assert.equal(gateMatches!.length, 1, "expected exactly one d5_alerts gated insertion");
  });

  test("<OpportunityAlerts appears nowhere else un-gated in the file", () => {
    const allUsages = source.match(/<OpportunityAlerts\b/g) ?? [];
    assert.equal(allUsages.length, 1, "OpportunityAlerts should be rendered exactly once");
  });
});
