import type { Page } from "@playwright/test";
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
  searchPhase,
  sse,
  fullStream,
  gate,
  trackRequests,
  FIXTURE_PROFILE,
  FIXTURE_RESULT,
  INTAKE,
} from "./fixtures";

/**
 * Journey — the patient intake form. Age and a US ZIP are required (the
 * browser blocks submission until they are valid), the profile needs at least
 * a description, diagnosis, or symptom, and the search button is disabled only
 * while a search is running. The profile is kept in this browser only, survives
 * a reload, and "Clear everything" removes it.
 */

/** Whether the browser's own constraint validation marks the control invalid. */
async function validity(locator: ReturnType<typeof intake>["age"]) {
  return locator.evaluate((el: HTMLInputElement) => ({
    valueMissing: el.validity.valueMissing,
    patternMismatch: el.validity.patternMismatch,
    rangeOverflow: el.validity.rangeOverflow,
    valid: el.validity.valid,
  }));
}

async function openPage(page: Page) {
  await stubSearchStatus(page);
  await openApp(page);
  await expect(intake(page).story).toBeVisible();
}

test("intake: age and ZIP are required, and an empty form never starts a search", async ({ page }) => {
  const matchCalls = trackRequests(page, "/api/match");
  await openPage(page);
  const f = intake(page);

  await expect(f.age).toHaveAttribute("required", "");
  await expect(f.zip).toHaveAttribute("required", "");
  await f.submit.click();

  expect(await validity(f.age)).toMatchObject({ valueMissing: true, valid: false });
  expect(await validity(f.zip)).toMatchObject({ valueMissing: true, valid: false });
  // The browser focuses the first invalid control instead of submitting.
  await expect(f.age).toBeFocused();
  await expect(searchPhase(page)).toHaveCount(0);
  expect(matchCalls).toHaveLength(0);
});

test("intake: an out-of-range age and a malformed ZIP are rejected before any search", async ({ page }) => {
  const matchCalls = trackRequests(page, "/api/match");
  await openPage(page);
  const f = intake(page);
  await fillIntake(page, { age: "130", zip: "8370" });

  await f.submit.click();
  expect(await validity(f.age)).toMatchObject({ rangeOverflow: true, valid: false });
  expect(await validity(f.zip)).toMatchObject({ patternMismatch: true, valid: false });

  await f.age.fill(INTAKE.age);
  await f.submit.click();
  expect(await validity(f.age)).toMatchObject({ valid: true });
  expect(await validity(f.zip)).toMatchObject({ patternMismatch: true, valid: false });
  await expect(f.zip).toBeFocused();

  expect(matchCalls).toHaveLength(0);
});

test("intake: a profile with no description, diagnosis, or symptom shows a message instead of searching", async ({ page }) => {
  const matchCalls = trackRequests(page, "/api/match");
  await openPage(page);
  const f = intake(page);
  await f.age.fill(INTAKE.age);
  await f.zip.fill(INTAKE.zip);

  await f.submit.click();
  await expect(f.error).toHaveText("Describe one diagnosis or symptom");
  await expect(searchPhase(page)).toHaveCount(0);
  expect(matchCalls).toHaveLength(0);

  // A symptom alone is enough; the message clears once the search starts.
  await stubMatch(page);
  await f.details.locator("summary").click();
  await f.symptoms.fill("burning foot pain");
  await f.submit.click();
  await expect(f.error).toHaveCount(0);
  await expect(results(page).heading).toBeVisible();
});

test("intake: submitting sends the whole profile to the local search, with the ZIP trimmed to five digits", async ({ page }) => {
  await stubSearchStatus(page);
  const requests = await stubMatch(page);
  await openApp(page);
  const f = intake(page);

  await f.story.fill(INTAKE.narrative);
  await f.fillingOutAs.selectOption("caregiver");
  await f.age.fill("58");
  await f.sex.selectOption("female");
  await f.zip.fill("83702-1234");
  await f.city.fill("Boise");
  await f.state.fill("ID");
  await f.travel.selectOption("250");

  // The optional details stay collapsed until asked for.
  await expect(f.diagnoses).toBeHidden();
  await f.details.locator("summary").click();
  await expect(f.diagnoses).toBeVisible();
  await f.diagnoses.fill("chemotherapy-induced peripheral neuropathy");
  await f.symptoms.fill("burning foot pain, numbness");
  await f.tried.fill("gabapentin; duloxetine");
  await f.usualDay.selectOption("ambulatory_limited");
  await page.getByRole("checkbox", { name: "A study that may use a placebo" }).uncheck();

  await f.submit.click();
  await expect(results(page).heading).toBeVisible();

  expect(requests).toHaveLength(1);
  expect(requests[0]).toEqual({
    profile: {
      fillingOutAs: "caregiver",
      ageYears: 58,
      sex: "female",
      primaryDiagnoses: ["chemotherapy-induced peripheral neuropathy"],
      symptoms: ["burning foot pain", "numbness"],
      symptomNarrative: INTAKE.narrative,
      treatmentsTried: ["gabapentin", "duloxetine"],
      performanceStatus: "ambulatory_limited",
      location: { zip: "83702", city: "Boise", state: "ID" },
      travelRadiusMiles: 250,
      openTo: { phase1: true, placebo: false, inpatient: true, expandedAccess: true },
    },
    provider: "none",
    cloudConsent: false,
  });
});

test("intake: the search button is disabled while a search runs and re-enabled when it finishes", async ({ page }) => {
  await stubSearchStatus(page);
  const hold = gate();
  await stubMatch(page, async () => {
    await hold.wait;
    return { body: sse(fullStream()) };
  });
  await openApp(page);
  const f = intake(page);
  await fillIntake(page);
  await f.details.locator("summary").click();
  await expect(f.helpFill).toBeEnabled();
  await expect(f.submit).toBeEnabled();
  await expect(f.submit).toHaveText(/^Find studies/);

  await f.submit.click();
  await expect(f.submit).toBeDisabled();
  await expect(f.submit).toHaveText("Finding studies…");
  await expect(searchPhase(page)).toContainText("Searching the study list…");
  await expect(f.helpFill).toBeDisabled();

  hold.release();
  await expect(searchPhase(page)).toHaveText("Search complete");
  await expect(f.submit).toBeEnabled();
  await expect(f.submit).toHaveText(/^Find studies/);
  await expect(f.helpFill).toBeEnabled();
});

test("intake: the profile is kept in this browser across a reload", async ({ page }) => {
  await stubBackend(page);
  await openApp(page);
  const f = intake(page);
  await fillIntake(page);
  await f.travel.selectOption("250");
  await f.submit.click();
  await expect(results(page).heading).toBeVisible();

  const saved = await page.evaluate(() => JSON.parse(window.localStorage.getItem("treatable:patient") ?? "null"));
  expect(saved).toMatchObject({ ageYears: 58, symptomNarrative: INTAKE.narrative, location: { zip: "83702", city: "Boise", state: "ID" } });

  await page.reload();
  await expect(f.story).toHaveValue(INTAKE.narrative);
  await expect(f.age).toHaveValue("58");
  await expect(f.zip).toHaveValue("83702");
  await expect(f.city).toHaveValue("Boise");
  await expect(f.state).toHaveValue("ID");
  await expect(f.travel).toHaveValue("250");
  // Results are never persisted to localStorage, so a reload starts without them.
  await expect(results(page).section).toHaveCount(0);
});

test("intake: Clear everything empties the form, the results, and every saved Treatable value", async ({ page }) => {
  await stubBackend(page);
  await openApp(page);
  const f = intake(page);
  await fillIntake(page);
  await f.submit.click();
  await expect(results(page).cards).toHaveCount(FIXTURE_RESULT.matches.length);

  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Clear everything" }).click();

  await expect(f.story).toHaveValue("");
  await expect(f.age).toHaveValue("");
  await expect(f.zip).toHaveValue("");
  await expect(f.city).toHaveValue("");
  await expect(results(page).section).toHaveCount(0);
  await expect(searchPhase(page)).toHaveCount(0);
  const stored = await page.evaluate(() => ({
    local: Object.keys(window.localStorage).filter((k) => k.startsWith("treatable:")),
    summary: window.sessionStorage.getItem("treatable:summary"),
  }));
  expect(stored).toEqual({ local: [], summary: null });

  await page.reload();
  await expect(f.story).toHaveValue("");
  await expect(f.age).toHaveValue("");
});

test("intake: Help fill details asks for a model first, and for consent before using OpenAI", async ({ page }) => {
  const profileCalls = trackRequests(page, "/api/profile");
  await openPage(page);
  const f = intake(page);
  await fillIntake(page);
  await f.details.locator("summary").click();

  await f.helpFill.click();
  await expect(f.error).toHaveText("Choose a model in Privacy & models to help fill in details, or fill them in yourself.");

  await page.getByRole("radio", { name: /OpenAI/ }).check();
  await f.helpFill.click();
  await expect(f.error).toHaveText("Please agree to send your profile to OpenAI in Privacy & models first.");

  expect(profileCalls).toHaveLength(0);
});

test("intake: Help fill details reads the note with the local model and fills the optional fields", async ({ page }) => {
  await stubSearchStatus(page);
  const hold = gate();
  const bodies: unknown[] = [];
  await page.route("**/api/profile", async (route) => {
    bodies.push(route.request().postDataJSON());
    await hold.wait;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: {
          ...FIXTURE_PROFILE,
          primaryDiagnoses: ["chemotherapy-induced peripheral neuropathy"],
          symptoms: ["burning foot pain", "numbness"],
          treatmentsTried: ["gabapentin", "duloxetine"],
          performanceStatus: "ambulatory_limited",
        },
      }),
    });
  });
  await openApp(page);
  const f = intake(page);
  await page.getByRole("radio", { name: /On this computer/ }).check();
  await f.details.locator("summary").click();

  // Age, location, and a description come first; they are never guessed.
  await f.helpFill.click();
  await expect(f.error).toHaveText("Enter your age, US location, and a short description first.");
  expect(bodies).toHaveLength(0);

  await fillIntake(page);
  await f.helpFill.click();
  await expect(f.helpFill).toHaveText("Reading your note…");
  await expect(f.helpFill).toBeDisabled();
  hold.release();

  await expect(f.diagnoses).toHaveValue("chemotherapy-induced peripheral neuropathy");
  await expect(f.symptoms).toHaveValue("burning foot pain, numbness");
  await expect(f.tried).toHaveValue("gabapentin, duloxetine");
  await expect(f.usualDay).toHaveValue("ambulatory_limited");
  await expect(f.helpFill).toHaveText("Help fill details from my note");
  await expect(f.error).toHaveCount(0);
  // Age and location the person typed are left exactly as they were.
  await expect(f.age).toHaveValue(INTAKE.age);
  await expect(f.zip).toHaveValue(INTAKE.zip);

  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({
    provider: "local",
    cloudConsent: false,
    profile: { ageYears: 58, symptomNarrative: INTAKE.narrative, location: { zip: "83702", city: "Boise", state: "ID" } },
  });
});

test("intake: a failed Help fill details call shows its message and keeps what was typed", async ({ page }) => {
  await stubSearchStatus(page);
  await page.route("**/api/profile", (route) =>
    route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "Please wait a moment before trying again." }) }),
  );
  await openApp(page);
  const f = intake(page);
  await page.getByRole("radio", { name: /On this computer/ }).check();
  await fillIntake(page);
  await f.details.locator("summary").click();
  await f.symptoms.fill("numbness");

  await f.helpFill.click();
  await expect(f.error).toHaveText("Please wait a moment before trying again.");
  await expect(f.symptoms).toHaveValue("numbness");
  await expect(f.story).toHaveValue(INTAKE.narrative);
  await expect(f.helpFill).toBeEnabled();
});
