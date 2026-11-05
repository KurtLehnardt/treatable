import { readFileSync } from "node:fs";
import { MEDICAL_NOTICE } from "../lib/brand";
import type { PatientProfile } from "../lib/contracts/patientProfile";
import type { StudySearchResult } from "../lib/contracts/studyMatch";
import { test, expect, openApp, stubSearchStatus, intake, results, searchPhase, trackRequests } from "./fixtures";

/**
 * Journey — landing. The first screen a patient or caregiver sees: the brand
 * header, the medical notice, the intake panel, the "how it works" guide, the
 * fictional demos, and the footer source link. No search runs here.
 */

test("landing: renders the header, medical notice, intake panel, and footer without runtime errors", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  await stubSearchStatus(page);
  await openApp(page);

  await expect(page).toHaveTitle("Treatable — Find a study. Find a next step.");

  const header = page.locator("header.site-header");
  await expect(header.getByRole("link", { name: "Treatable home" })).toHaveAttribute("href", "/");
  await expect(header).toContainText("EARLY ACCESS");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "#how-it-works");
  await expect(nav.getByRole("link", { name: "Privacy & models" })).toHaveAttribute("href", "#privacy");
  await expect(nav.getByRole("button", { name: "Clear everything" })).toBeVisible();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("There may be another way forward.", { useInnerText: true });

  // The medical notice sits above the intake form and says exactly what the brand file says.
  const notice = page.getByRole("complementary", { name: "Medical information notice" });
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText(MEDICAL_NOTICE);

  await expect(page.getByRole("heading", { name: "Start with what matters.", level: 2 })).toBeVisible();
  const f = intake(page);
  await expect(f.story).toBeVisible();
  await expect(f.story).toHaveValue("");
  await expect(f.age).toHaveValue("");
  await expect(f.zip).toHaveValue("");
  await expect(f.travel).toHaveValue("100");
  await expect(f.submit).toHaveText(/Find studies/);
  await expect(f.submit).toBeEnabled();
  await expect(page.getByText("Your profile is saved only in this browser. You can clear it at any time.")).toBeVisible();

  const how = page.locator("#how-it-works");
  await expect(how.getByRole("listitem")).toHaveText([/Share your situation/, /Explore possible matches/, /Take the next step together/]);

  // Nothing has been searched yet, so there is no status line and no results.
  await expect(searchPhase(page)).toHaveCount(0);
  await expect(results(page).section).toHaveCount(0);

  const footer = page.locator("footer.site-footer");
  await expect(footer).toContainText("Information for a conversation with your care team.");
  const source = footer.getByRole("link", { name: /Data from ClinicalTrials\.gov/ });
  await expect(source).toHaveAttribute("href", "https://clinicaltrials.gov");
  await expect(source).toHaveAttribute("target", "_blank");
  await expect(source).toHaveAttribute("rel", "noreferrer");

  expect(runtimeErrors).toEqual([]);
});

test("landing: the header links jump to How it works and Privacy & models", async ({ page }) => {
  await stubSearchStatus(page);
  await openApp(page);

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Privacy & models" }).click();
  await expect(page).toHaveURL(/#privacy$/);
  await expect(page.getByRole("heading", { name: "How should we explain the matches?" })).toBeInViewport();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/#how-it-works$/);
  await expect(page.getByRole("heading", { name: /A little less searching/ })).toBeInViewport();
});

type Demo = { name: string; profile: PatientProfile; result?: StudySearchResult };
const DEMOS: Demo[] = JSON.parse(readFileSync(new URL("../data/precomputed.json", import.meta.url), "utf8")).demos;

test("landing: a fictional demo fills the form and shows its precomputed matches without running a search", async ({ page }) => {
  // The demos are the committed data/precomputed.json, served as-is by /api/demos.
  expect(DEMOS.length).toBeGreaterThan(0);
  const demo = DEMOS[0];
  expect(demo.result, "the first demo ships precomputed matches").toBeTruthy();
  const result = demo.result!;

  const matchCalls = trackRequests(page, "/api/match");
  await stubSearchStatus(page);
  await openApp(page);

  const panel = page.locator("section.demo-panel");
  await expect(panel.getByRole("heading", { name: "Try a fictional example" })).toBeVisible();
  await expect(panel.getByRole("button")).toHaveText(DEMOS.slice(0, 3).map((d) => new RegExp(`^${escapeRegExp(d.name)}`)));

  await panel.getByRole("button", { name: demo.name }).click();

  const f = intake(page);
  await expect(f.age).toHaveValue(String(demo.profile.ageYears));
  await expect(f.zip).toHaveValue(demo.profile.location.zip ?? "");
  await expect(f.story).toHaveValue(demo.profile.symptomNarrative);

  await expect(searchPhase(page)).toHaveText("Fictional demo · precomputed matches");
  const r = results(page);
  await expect(r.heading).toBeVisible();
  await expect(r.summaryLine).toHaveText(
    `${result.matches.length} studies from ${result.corpusCount.toLocaleString("en-US")} records · ${
      result.embeddingMode === "keyword" ? "Keyword matching" : "Local search matching"
    }`,
  );
  await expect(r.cards).toHaveCount(result.matches.length);
  for (const m of result.matches) {
    await expect(r.card(m.id).getByRole("heading", { level: 3 })).toContainText(m.study.briefTitle);
  }
  expect(matchCalls, "a precomputed demo must not call /api/match").toHaveLength(0);
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
