import type { Page } from "@playwright/test";
import {
  test,
  expect,
  openApp,
  controlMatchStream,
  pushToStream,
  closeStream,
  stubSearchStatus,
  fillIntake,
  intake,
  results,
  searchPhase,
  sse,
  provisionalResult,
  FIXTURE_RESULT,
  NERVE_BLOCK,
  INTAKE,
} from "./fixtures";

/**
 * Journey — a search that streams. /api/match answers with server-sent events:
 * a provisional shortlist first (cards appear with a "Matching" ring and no
 * score), then passA/passB refinements, then "complete". These journeys write
 * the stream frame by frame (see controlMatchStream in fixtures.ts) so each
 * intermediate state the patient sees is asserted, not just the end state.
 */

const ARRIVING = "Explanations are arriving…";
const STOPPED_NOTICE = "Explanations stopped. Retrieved studies and any explanations already received are kept.";

async function startSearch(page: Page) {
  await controlMatchStream(page);
  await stubSearchStatus(page);
  await openApp(page);
  await fillIntake(page);
  await intake(page).submit.click();
  await page.waitForFunction(() => (window as unknown as { __matchRequests: unknown[] }).__matchRequests.length === 1);
}

test("search: provisional matches appear first, then scores and explanations stream in until complete", async ({ page }) => {
  await startSearch(page);
  const f = intake(page);
  const r = results(page);
  const phase = searchPhase(page);
  const stop = phase.getByRole("button", { name: "Stop explanations" });

  const sent = await page.evaluate(() => (window as unknown as { __matchRequests: unknown[] }).__matchRequests[0]);
  expect(sent).toMatchObject({ provider: "none", cloudConsent: false, profile: { ageYears: 58, symptomNarrative: INTAKE.narrative } });

  // Waiting for the first event: a spinner, the stop control, and no results yet.
  await expect(phase).toContainText("Searching the study list…");
  await expect(phase.locator(".spinner")).toBeVisible();
  await expect(stop).toBeVisible();
  await expect(f.submit).toBeDisabled();
  await expect(r.section).toHaveCount(0);

  // 1. Provisional: every study card renders, still matching, with no score.
  await pushToStream(page, sse([{ type: "provisional", result: provisionalResult() }]));
  await expect(phase).toContainText("Studies found. Adding explanations…");
  await expect(r.cards).toHaveCount(FIXTURE_RESULT.matches.length);
  await expect(r.summaryLine).toContainText(ARRIVING);
  await expect(r.nearCards.locator(".match-status")).toHaveText(["Matching", "Matching", "Matching"]);
  await expect(r.section.locator(".match-score")).toHaveCount(0);

  // 2. passA, delivered in two chunks that split one frame: nothing changes until the frame is whole.
  const passA = sse([{ type: "passA", result: FIXTURE_RESULT }]);
  const cut = Math.floor(passA.length / 2);
  await pushToStream(page, passA.slice(0, cut));
  await expect(phase).toContainText("Studies found. Adding explanations…");
  await expect(r.card(NERVE_BLOCK.id).locator(".match-status")).toBeVisible();
  await pushToStream(page, passA.slice(cut));
  await expect(phase).toContainText("Checking the shortlist…");
  await expect(r.card(NERVE_BLOCK.id).locator(".match-score")).toHaveText("82/100 match");
  await expect(r.card(NERVE_BLOCK.id).locator(".why-care")).toHaveText(NERVE_BLOCK.whyCare);
  await expect(r.section.locator(".match-status")).toHaveCount(0);

  // 3. passB.
  await pushToStream(page, sse([{ type: "passB", result: FIXTURE_RESULT }]));
  await expect(phase).toContainText("Adding next steps…");
  await expect(stop).toBeVisible();

  // 4. Complete: the search settles and the form is usable again.
  await pushToStream(page, sse([{ type: "complete", result: FIXTURE_RESULT }]));
  await closeStream(page);
  await expect(phase).toHaveText("Search complete");
  await expect(stop).toHaveCount(0);
  await expect(phase.locator(".spinner")).toHaveCount(0);
  await expect(r.summaryLine).toHaveText("4 studies from 2,000 records · Keyword matching");
  await expect(f.submit).toBeEnabled();
  await expect(r.section.locator(".notice")).not.toContainText(STOPPED_NOTICE);

  // The completed result is what the clinician summary will show.
  const summary = await page.evaluate(() => JSON.parse(window.sessionStorage.getItem("treatable:summary") ?? "null"));
  expect(summary.matches.map((m: { id: string }) => m.id)).toEqual(FIXTURE_RESULT.matches.map((m) => m.id));
});

test("search: Stop explanations keeps every study already found and stops the matching rings", async ({ page }) => {
  await startSearch(page);
  const r = results(page);
  const phase = searchPhase(page);

  await pushToStream(page, sse([{ type: "provisional", result: provisionalResult() }]));
  await expect(r.nearCards.locator(".match-status")).toHaveCount(3);

  await phase.getByRole("button", { name: "Stop explanations" }).click();

  await expect(phase).toHaveText("Search stopped. Results already found are kept.");
  await expect(phase.getByRole("button", { name: "Stop explanations" })).toHaveCount(0);
  await expect(r.cards).toHaveCount(FIXTURE_RESULT.matches.length);
  await expect(r.section.locator(".match-status")).toHaveCount(0);
  await expect(r.card(NERVE_BLOCK.id).locator(".match-score")).toHaveText("82/100 match");
  await expect(r.section.locator(".notice", { hasText: STOPPED_NOTICE })).toBeVisible();
  await expect(r.summaryLine).not.toContainText(ARRIVING);
  await expect(intake(page).submit).toBeEnabled();
  // Stopping ends this search without starting another one.
  expect(await page.evaluate(() => (window as unknown as { __matchRequests: unknown[] }).__matchRequests.length)).toBe(1);
});

test("search: a new search replaces the previous results", async ({ page }) => {
  await startSearch(page);
  const r = results(page);
  await pushToStream(page, sse([{ type: "complete", result: FIXTURE_RESULT }]));
  await closeStream(page);
  await expect(r.cards).toHaveCount(4);

  const onlyOne = { ...FIXTURE_RESULT, matches: [NERVE_BLOCK] };
  await intake(page).submit.click();
  await page.waitForFunction(() => (window as unknown as { __matchRequests: unknown[] }).__matchRequests.length === 2);
  // The old results are cleared as soon as the new search starts.
  await expect(r.section).toHaveCount(0);
  await expect(searchPhase(page)).toContainText("Searching the study list…");

  await pushToStream(page, sse([{ type: "complete", result: onlyOne }]));
  await closeStream(page);
  await expect(searchPhase(page)).toHaveText("Search complete");
  await expect(r.cards).toHaveCount(1);
  await expect(r.summaryLine).toHaveText("1 studies from 2,000 records · Keyword matching");
});
