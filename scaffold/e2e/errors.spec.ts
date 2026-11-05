import type { Page } from "@playwright/test";
import {
  test,
  expect,
  openApp,
  stubMatch,
  stubSearchStatus,
  fillIntake,
  intake,
  results,
  searchPhase,
  pageError,
  sse,
  fullStream,
  provisionalResult,
  FIXTURE_RESULT,
} from "./fixtures";

/**
 * Journey — when a search goes wrong. A refused or failed request shows a
 * message and leaves the form ready to search again (the retry affordance is
 * the re-enabled "Find studies" button, and the next search clears the
 * message). A stream that breaks after studies arrived keeps those studies and
 * says the explanations are unavailable. A search with no matches shows an
 * empty state with other places to look.
 */

const STREAM_FAILED = "The search could not finish. Keep any results already shown and try again.";
const STOPPED_NOTICE = "Explanations stopped. Retrieved studies and any explanations already received are kept.";
const KEPT_PHASE = "Search results kept; some explanations are unavailable.";

type Reply = { status?: number; contentType?: string; body: string };
const OK: Reply = { body: sse(fullStream()) };

async function search(page: Page, replies: Reply[]) {
  await stubSearchStatus(page);
  const requests = await stubMatch(page, (call) => replies[Math.min(call, replies.length) - 1]);
  await openApp(page);
  await fillIntake(page);
  await intake(page).submit.click();
  return requests;
}

/** The form is idle and ready for another search. */
async function expectReadyToRetry(page: Page) {
  const f = intake(page);
  await expect(f.submit).toBeEnabled();
  await expect(f.submit).toHaveText(/^Find studies/);
  await expect(searchPhase(page).locator(".spinner")).toHaveCount(0);
  await expect(searchPhase(page).getByRole("button", { name: "Stop explanations" })).toHaveCount(0);
}

/** Searching again succeeds, shows the results, and clears the earlier message. */
async function retrySucceeds(page: Page, requests: unknown[]) {
  await intake(page).submit.click();
  await expect(searchPhase(page)).toHaveText("Search complete");
  await expect(results(page).cards).toHaveCount(FIXTURE_RESULT.matches.length);
  await expect(pageError(page)).toHaveCount(0);
  expect(requests).toHaveLength(2);
}

test("errors: a search the server refuses shows its message, and searching again recovers", async ({ page }) => {
  const requests = await search(page, [
    { status: 429, contentType: "application/json", body: JSON.stringify({ error: "Please wait a moment before searching again." }) },
    OK,
  ]);

  await expect(pageError(page)).toHaveText("Please wait a moment before searching again.");
  await expect(results(page).section).toHaveCount(0);
  await expectReadyToRetry(page);
  await retrySucceeds(page, requests);
});

test("errors: a failed response without a JSON message falls back to a plain one", async ({ page }) => {
  const requests = await search(page, [{ status: 502, contentType: "text/html", body: "<html><body>Bad gateway</body></html>" }, OK]);

  await expect(pageError(page)).toHaveText("The search could not start.");
  await expect(results(page).section).toHaveCount(0);
  await expectReadyToRetry(page);
  await retrySucceeds(page, requests);
});

test("errors: a network failure shows an error and the search can be retried", async ({ page }) => {
  await stubSearchStatus(page);
  let calls = 0;
  await page.route("**/api/match", (route) => {
    calls++;
    return calls === 1
      ? route.abort("connectionreset")
      : route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: OK.body });
  });
  await openApp(page);
  await fillIntake(page);
  await intake(page).submit.click();

  await expect(pageError(page)).toBeVisible();
  await expect(pageError(page)).not.toBeEmpty();
  await expect(results(page).section).toHaveCount(0);
  await expectReadyToRetry(page);

  await intake(page).submit.click();
  await expect(searchPhase(page)).toHaveText("Search complete");
  await expect(results(page).cards).toHaveCount(FIXTURE_RESULT.matches.length);
  await expect(pageError(page)).toHaveCount(0);
  expect(calls).toBe(2);
});

test("errors: a stream that fails before any study arrives shows the server's message", async ({ page }) => {
  const requests = await search(page, [{ body: sse([{ type: "error", message: STREAM_FAILED }]) }, OK]);

  await expect(pageError(page)).toHaveText(STREAM_FAILED);
  await expect(results(page).section).toHaveCount(0);
  await expectReadyToRetry(page);
  await retrySucceeds(page, requests);
});

test("errors: a stream that ends before any result asks the person to try again", async ({ page }) => {
  const requests = await search(page, [{ body: "" }, OK]);

  await expect(pageError(page)).toHaveText("The search ended before results arrived. Please try again.");
  await expect(results(page).section).toHaveCount(0);
  await expectReadyToRetry(page);
  await retrySucceeds(page, requests);
});

test("errors: a stream that fails after studies arrive keeps them and says explanations are unavailable", async ({ page }) => {
  await search(page, [{ body: sse([{ type: "provisional", result: provisionalResult() }, { type: "error", message: STREAM_FAILED }]) }]);
  const r = results(page);

  await expect(pageError(page)).toHaveText(STREAM_FAILED);
  await expect(searchPhase(page)).toHaveText(KEPT_PHASE);
  await expect(r.cards).toHaveCount(FIXTURE_RESULT.matches.length);
  // The kept studies stop showing a "Matching" ring once the stream has ended.
  await expect(r.section.locator(".match-status")).toHaveCount(0);
  await expect(r.section.locator("p.notice", { hasText: STOPPED_NOTICE })).toBeVisible();
  await expect(r.summaryLine).not.toContainText("Explanations are arriving…");
  await expectReadyToRetry(page);
});

test("errors: a stream that closes before completing keeps the studies found without an error", async ({ page }) => {
  await search(page, [{ body: sse([{ type: "provisional", result: provisionalResult() }, { type: "passA", result: FIXTURE_RESULT }]) }]);
  const r = results(page);

  await expect(searchPhase(page)).toHaveText(KEPT_PHASE);
  await expect(r.cards).toHaveCount(FIXTURE_RESULT.matches.length);
  await expect(r.section.locator(".match-score")).toHaveCount(FIXTURE_RESULT.matches.length);
  await expect(r.section.locator("p.notice", { hasText: STOPPED_NOTICE })).toBeVisible();
  await expect(pageError(page)).toHaveCount(0);
  await expectReadyToRetry(page);
});

test("errors: a search with no matching studies shows an empty state with other places to look", async ({ page }) => {
  await search(page, [{ body: sse(fullStream({ ...FIXTURE_RESULT, matches: [], notices: [] })) }]);
  const r = results(page);

  await expect(searchPhase(page)).toHaveText("Search complete");
  await expect(r.summaryLine).toHaveText("0 studies from 2,000 records · Keyword matching");
  const empty = r.section.locator(".empty-state");
  await expect(empty.getByRole("heading", { name: "We did not find studies in this search.", level: 3 })).toBeVisible();
  await expect(empty).toContainText("Try a shorter description or a wider travel area.");
  await expect(empty).toContainText("A palliative-care team can also help with pain and other hard-to-control symptoms.");
  await expect(empty.getByRole("link", { name: "Search ClinicalTrials.gov ↗" })).toHaveAttribute("href", "https://clinicaltrials.gov/search");
  await expect(empty.getByRole("link", { name: "Search NCI cancer trials ↗" })).toHaveAttribute(
    "href",
    "https://www.cancer.gov/about-cancer/treatment/clinical-trials/search",
  );
  for (const link of await empty.getByRole("link").all()) await expect(link).toHaveAttribute("target", "_blank");
  // No filters, cards, or map for an empty search; the medical notice and source date still show.
  await expect(r.filters).toHaveCount(0);
  await expect(r.cards).toHaveCount(0);
  await expect(r.section.locator("section.map-panel")).toHaveCount(0);
  await expect(r.section.getByRole("complementary", { name: "Medical information notice" })).toBeVisible();
  await expect(r.section.locator(":scope > p.source-note")).toContainText("ClinicalTrials.gov data fetched 2026-10-24.");
  await expectReadyToRetry(page);
});
