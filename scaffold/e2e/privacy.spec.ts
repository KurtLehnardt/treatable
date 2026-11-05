import type { Page } from "@playwright/test";
import {
  test,
  expect,
  openApp,
  stubMatch,
  stubSearchStatus,
  searchStatus,
  fillIntake,
  intake,
  results,
  pageError,
  gate,
} from "./fixtures";

/**
 * Journey — Privacy & models. Search works with no model and no key ("Search
 * only", the default). "On this computer" uses a local model; "OpenAI" sends
 * the profile to OpenAI only after explicit consent, which resets whenever the
 * choice changes. An OpenAI key can be saved on this computer. The "Search"
 * status line reports the built-in search model and lets the person download
 * it, or retry a failed download.
 */

function settings(page: Page) {
  const section = page.locator("section.model-settings");
  return {
    section,
    option: (name: "Search only" | "On this computer" | "OpenAI") => section.getByRole("radio", { name: new RegExp(`^${name}`) }),
    consent: section.getByRole("checkbox", { name: /I agree to send this profile to OpenAI/ }),
    status: section.getByTestId("search-status"),
  };
}

test("privacy: Search only is the default, and the three choices explain what leaves the computer", async ({ page }) => {
  await stubSearchStatus(page);
  await openApp(page);
  const s = settings(page);

  await expect(s.section.getByRole("heading", { name: "How should we explain the matches?" })).toBeVisible();
  await expect(s.section).toContainText("Search works without a model or an API key.");
  await expect(s.option("Search only")).toBeChecked();
  await expect(s.option("On this computer")).not.toBeChecked();
  await expect(s.option("OpenAI")).not.toBeChecked();
  await expect(s.section.locator(".provider-option small")).toHaveText([
    "Fast matching. No patient text sent to a model.",
    "Ollama explains matches locally. A model download may be needed.",
    "Sends your description and study details to OpenAI after your consent.",
  ]);
  await expect(s.consent).toHaveCount(0);
  await expect(s.section.locator(".provider-detail")).toHaveCount(0);
});

test("privacy: OpenAI needs explicit consent before a search, and consent resets when the choice changes", async ({ page }) => {
  await stubSearchStatus(page);
  const requests = await stubMatch(page);
  await openApp(page);
  const s = settings(page);
  await fillIntake(page);

  await s.option("OpenAI").check();
  await expect(s.consent).toBeVisible();
  await expect(s.consent).not.toBeChecked();

  await intake(page).submit.click();
  await expect(pageError(page)).toHaveText("Please agree to send this profile to OpenAI, or choose Search only / On this computer.");
  await expect(results(page).section).toHaveCount(0);
  expect(requests).toHaveLength(0);

  await s.consent.check();
  await intake(page).submit.click();
  await expect(results(page).heading).toBeVisible();
  await expect(pageError(page)).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ provider: "openai", cloudConsent: true });

  // Changing the choice withdraws consent; it must be given again.
  await s.option("Search only").check();
  await expect(s.consent).toHaveCount(0);
  await s.option("OpenAI").check();
  await expect(s.consent).not.toBeChecked();
});

test("privacy: On this computer explains the local setup and searches with the local model", async ({ page }) => {
  await stubSearchStatus(page);
  const requests = await stubMatch(page);
  await openApp(page);
  const s = settings(page);

  await s.option("On this computer").check();
  const detail = s.section.locator(".provider-detail");
  await expect(detail).toContainText("Patient text stays on this computer.");
  await expect(detail.locator("code")).toHaveText("npm run setup:local");
  await expect(s.consent).toHaveCount(0);

  await fillIntake(page);
  await intake(page).submit.click();
  await expect(results(page).heading).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ provider: "local", cloudConsent: false });
});

test("privacy: an OpenAI key is saved on this computer, and a rejected key shows why", async ({ page }) => {
  await stubSearchStatus(page);
  const hold = gate();
  const saves: unknown[] = [];
  await page.route("**/api/llm/config", async (route) => {
    saves.push(route.request().postDataJSON());
    if (saves.length === 1) {
      await hold.wait;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "That key was not accepted." }) });
  });
  await openApp(page);
  const s = settings(page);
  await s.option("OpenAI").check();

  const keySetup = s.section.locator(".provider-detail details");
  await keySetup.locator("summary", { hasText: "Set up an OpenAI key" }).click();
  const key = keySetup.getByLabel("API key");
  const save = keySetup.getByRole("button", { name: /Save key|Saving…/ });
  await expect(key).toHaveAttribute("type", "password");
  await expect(save).toBeDisabled();

  await key.fill("e2e-placeholder-key");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(save).toHaveText("Saving…");
  await expect(save).toBeDisabled();
  hold.release();

  await expect(keySetup.getByRole("status")).toHaveText("OpenAI key saved on this computer. It is never added to your profile.");
  await expect(key).toHaveValue("");
  await expect(save).toHaveText("Save key");
  expect(saves[0]).toEqual({
    operationMode: "cloud",
    provider: "cloud",
    cloud: { providerId: "openai", keySource: { type: "inline", key: "e2e-placeholder-key" } },
  });
  // The key goes to the local config route only, never into the saved profile.
  const stored = await page.evaluate(() => JSON.stringify(Object.entries(window.localStorage)));
  expect(stored).not.toContain("e2e-placeholder-key");

  await key.fill("e2e-rejected-key");
  await save.click();
  await expect(keySetup.getByRole("status")).toHaveText("That key was not accepted.");
  expect(saves).toHaveLength(2);
});

test("privacy: the search status line reports a ready built-in model", async ({ page }) => {
  await stubSearchStatus(page, () => searchStatus({ state: "ready" }));
  await openApp(page);
  const status = settings(page).status;

  await expect(status).toHaveAttribute("data-space", "builtin");
  await expect(status).toHaveAttribute("data-state", "ready");
  await expect(status.locator("p")).toHaveText([
    "Search: Built-in, on this computer",
    "nomic-embed-text-v1.5. No key needed, and it works offline.",
  ]);
  await expect(status.getByRole("button")).toHaveCount(0);
});

test("privacy: a missing search model can be downloaded, with progress, until it is ready", async ({ page }) => {
  let phase: "missing" | "downloading" | "ready" = "missing";
  let polls = 0;
  const calls = await stubSearchStatus(
    page,
    () => {
      if (phase === "missing") return searchStatus({ state: "missing" });
      // The page polls while downloading: report 75%, then ready.
      polls++;
      if (polls === 1) return searchStatus({ state: "downloading", pct: 75 });
      phase = "ready";
      return searchStatus({ state: "ready" });
    },
    () => {
      phase = "downloading";
      return { status: 202, body: { started: true, status: searchStatus({ state: "downloading", pct: 40 }) } };
    },
  );
  await openApp(page);
  const status = settings(page).status;

  await expect(status).toHaveAttribute("data-state", "missing");
  await expect(status).toContainText(
    "The search model (about 137 MB) isn't downloaded yet. Keyword search works now. Choose Download now to enable local semantic matching.",
  );
  await status.getByRole("button", { name: "Download now" }).click();

  const progress = status.getByRole("progressbar", { name: "Search model download progress" });
  await expect(progress).toHaveAttribute("aria-valuenow", "40");
  await expect(status.locator("p").first()).toHaveText("Search: Built-in, on this computer. Downloading the search model: 40%");
  await expect(status).toContainText("A one-time download of about 137 MB. Searches start as soon as it finishes.");
  await expect(status.getByRole("button")).toHaveCount(0);

  await expect(progress).toHaveAttribute("aria-valuenow", "75");
  await expect(status).toHaveAttribute("data-state", "ready");
  await expect(progress).toHaveCount(0);
  await expect(status.locator("p").first()).toHaveText("Search: Built-in, on this computer");
  expect(calls.posts).toBe(1);
});

test("privacy: a failed search model download offers Retry, and reports a retry that cannot start", async ({ page }) => {
  let posts = 0;
  await stubSearchStatus(
    page,
    // Once a retry starts, the status the page polls reports the download in progress.
    () =>
      posts < 2
        ? searchStatus({ state: "failed", error: "the download server could not be reached" })
        : searchStatus({ state: "downloading", pct: 5 }),
    () => {
      posts++;
      return posts === 1
        ? { status: 500, body: { error: "Couldn't start the download: the disk is full" } }
        : { status: 202, body: { started: true, status: searchStatus({ state: "downloading", pct: 5 }) } };
    },
  );
  await openApp(page);
  const status = settings(page).status;

  await expect(status).toHaveAttribute("data-state", "failed");
  await expect(status.locator("p")).toHaveText([
    "The download server could not be reached.",
    "Until this is fixed, search runs in keyword-only mode.",
  ]);

  await status.getByRole("button", { name: "Retry" }).click();
  await expect(status).toContainText("Couldn't start the download: the disk is full");
  await expect(status.getByRole("button", { name: "Retry" })).toBeEnabled();

  await status.getByRole("button", { name: "Retry" }).click();
  await expect(status.getByRole("progressbar", { name: "Search model download progress" })).toHaveAttribute("aria-valuenow", "5");
  await expect(status).not.toContainText("Couldn't start the download");
  expect(posts).toBe(2);
});
