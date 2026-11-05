import { MEDICAL_NOTICE } from "../lib/brand";
import {
  test,
  expect,
  openApp,
  stubBackend,
  stubMatch,
  stubSearchStatus,
  fillIntake,
  intake,
  results,
  sse,
  fullStream,
  FIXTURE_RESULT,
  NERVE_BLOCK,
  REGISTRY,
  EXPANDED,
  EXCLUDED,
} from "./fixtures";

/**
 * Journey — the clinician summary (/summary). A printable one-page sheet of the
 * situation shared and up to five studies to discuss, in the same order as the
 * results. It reads the last search from sessionStorage only, so it exists only
 * in the tab that ran the search and disappears with "Clear everything".
 */

const NO_SEARCH = "No search is available in this browser tab. Run a search first, then open Clinician summary.";

test("summary: lists the situation shared and up to five studies, in results order", async ({ page }) => {
  // Two more eligible studies (lower scores) make six, so the cap of five and the ordering both show.
  const second = { ...NERVE_BLOCK, id: "NCT90000005", score: 60, study: { ...NERVE_BLOCK.study, id: "NCT90000005", briefTitle: "Topical Capsaicin Patch for Neuropathic Foot Pain" }, reasons: [], whatToVerify: "" };
  const third = { ...NERVE_BLOCK, id: "NCT90000006", score: 50, study: { ...NERVE_BLOCK.study, id: "NCT90000006", briefTitle: "Mindful Movement for Chronic Neuropathic Pain" }, reasons: [], whatToVerify: "" };
  await stubSearchStatus(page);
  await stubMatch(page, () => ({ body: sse(fullStream({ ...FIXTURE_RESULT, matches: [...FIXTURE_RESULT.matches, third, second] })) }));
  await openApp(page);
  await fillIntake(page);
  await intake(page).submit.click();
  await expect(results(page).cards).toHaveCount(6);

  await results(page).section.getByRole("link", { name: "Clinician summary ↗" }).click();
  await expect(page).toHaveURL(/\/summary$/);

  const sheet = page.locator("main.summary-sheet");
  await expect(sheet.getByRole("heading", { level: 1 })).toHaveText("Treatable · care-team summary");
  await expect(sheet.getByRole("complementary", { name: "Medical information notice" })).toContainText(MEDICAL_NOTICE);

  const situation = sheet.locator("section").filter({ has: page.getByRole("heading", { name: "Situation shared" }) });
  await expect(situation.locator("p")).toHaveText([
    "Age 58 · female · Boise, ID, 83702",
    FIXTURE_RESULT.profile.symptomNarrative,
    "Diagnoses: chemotherapy-induced peripheral neuropathy",
    "Symptoms: burning foot pain, numbness",
    "Tried: gabapentin, duloxetine",
  ]);

  const studies = sheet.locator("section").filter({ has: page.getByRole("heading", { name: "Five studies to discuss" }) });
  await expect(studies.locator("article.summary-study h3")).toHaveText([
    `1. ${NERVE_BLOCK.study.briefTitle}`,
    `2. ${second.study.briefTitle}`,
    `3. ${third.study.briefTitle}`,
    `4. ${REGISTRY.study.briefTitle}`,
    `5. ${EXPANDED.study.briefTitle}`,
  ]);
  await expect(studies.getByText(EXCLUDED.study.briefTitle)).toHaveCount(0);

  const first = studies.locator("article.summary-study").first();
  await expect(first.locator("p").nth(0)).toHaveText("NCT90000001 · Matches what you told us · Boise Pain Research Institute");
  await expect(first.locator("p").nth(1)).toHaveText(NERVE_BLOCK.whatToVerify);
  await expect(first.locator("p").nth(2)).toHaveText(NERVE_BLOCK.reasons.join("; "));
  await expect(first.locator("small")).toHaveText("https://clinicaltrials.gov/study/NCT90000001");
  // A study without a model question gets the default reminder.
  const registry = studies.locator("article.summary-study").nth(3);
  await expect(registry.locator("p").nth(0)).toHaveText("NCT90000002 · Ask the study team · Intermountain Neuropathy Network");
  await expect(registry.locator("p").nth(1)).toHaveText(
    "Confirm recruitment, medical requirements, travel, and next steps with the study team.",
  );

  await expect(sheet.locator(".source-note")).toHaveText(
    "Record data fetched 2026-10-24. A match is not a determination of eligibility or a recommendation to enroll.",
  );
});

test("summary: Print summary opens the print dialog with the page controls hidden, and Back returns to the search", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __prints: number }).__prints = 0;
    window.print = () => void ((window as unknown as { __prints: number }).__prints += 1);
  });
  await stubBackend(page);
  await openApp(page);
  await fillIntake(page);
  await intake(page).submit.click();
  await expect(results(page).heading).toBeVisible();
  await results(page).section.getByRole("link", { name: "Clinician summary ↗" }).click();

  // The studies render once the page has hydrated and read this tab's session, so the button is live.
  await expect(page.getByRole("heading", { name: "Five studies to discuss" })).toBeVisible();
  const nav = page.locator("main.summary-sheet nav.no-print");
  await nav.getByRole("button", { name: "Print summary" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(1);

  // On paper only the summary itself is printed.
  await page.emulateMedia({ media: "print" });
  await expect(nav).toBeHidden();
  await expect(page.getByRole("heading", { name: "Five studies to discuss" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Medical information notice" })).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await expect(nav).toBeVisible();

  await nav.getByRole("link", { name: "← Back to Treatable" }).click();
  await expect(page).toHaveURL(/\/$/);
  // The profile is still in this browser, ready to adjust and search again.
  await expect(intake(page).age).toHaveValue("58");
  await expect(intake(page).zip).toHaveValue("83702");
});

test("summary: is empty without a search in this tab, in a new tab, and after Clear everything", async ({ page, context }) => {
  await stubBackend(page);
  await page.goto("/summary");
  const sheet = page.locator("main.summary-sheet");
  await expect(sheet.getByRole("heading", { level: 1 })).toHaveText("Treatable · care-team summary");
  await expect(sheet).toContainText(NO_SEARCH);
  await expect(sheet.getByRole("heading", { name: "Five studies to discuss" })).toHaveCount(0);

  await openApp(page);
  await fillIntake(page);
  await intake(page).submit.click();
  await expect(results(page).heading).toBeVisible();

  // The summary lives in this tab's session only; another tab never sees it.
  const other = await context.newPage();
  await other.goto("/summary");
  await expect(other.locator("main.summary-sheet")).toContainText(NO_SEARCH);
  await other.close();

  await page.goto("/summary");
  await expect(sheet.getByRole("heading", { name: "Five studies to discuss" })).toBeVisible();

  await openApp(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Clear everything" }).click();
  await expect(results(page).section).toHaveCount(0);
  await page.goto("/summary");
  await expect(sheet).toContainText(NO_SEARCH);
});
