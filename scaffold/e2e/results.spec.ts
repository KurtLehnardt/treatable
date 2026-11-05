import type { Page } from "@playwright/test";
import { MEDICAL_NOTICE } from "../lib/brand";
import type { StudySearchResult } from "../lib/contracts/studyMatch";
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
  sse,
  fullStream,
  FIXTURE_RESULT,
  NERVE_BLOCK,
  REGISTRY,
  EXPANDED,
  EXCLUDED,
} from "./fixtures";

/**
 * Journey — reading the results. After a (stubbed) search completes, each study
 * card shows its matching status, score, sponsor, type, phase, recruiting
 * status, nearest site and distance, and why it came up; the details panel
 * holds the next steps, the checks to discuss, the study team's contacts, a
 * call script, the sites, and the exact requirements. Studies are ordered by
 * matching status, can be filtered by it, and studies beyond the travel
 * preference are tucked away separately.
 */

async function searchWith(page: Page, result: StudySearchResult = FIXTURE_RESULT) {
  await stubSearchStatus(page);
  await stubMatch(page, () => ({ body: sse(fullStream(result)) }));
  await openApp(page);
  await fillIntake(page);
  await intake(page).submit.click();
  await expect(searchPhase(page)).toHaveText("Search complete");
}

test("results: the header summarises the search and links to the clinician summary", async ({ page }) => {
  await searchWith(page);
  const r = results(page);

  await expect(r.heading).toBeVisible();
  await expect(r.section.locator(".section-kicker").first()).toHaveText("OPTIONS TO EXPLORE WITH YOUR CARE TEAM");
  await expect(r.summaryLine).toHaveText("4 studies from 2,000 records · Keyword matching");
  await expect(r.section.getByRole("link", { name: "Clinician summary ↗" })).toHaveAttribute("href", "/summary");
  // The medical notice is repeated with the results, next to the server's notices and the score caveat.
  await expect(r.section.getByRole("complementary", { name: "Medical information notice" })).toContainText(MEDICAL_NOTICE);
  await expect(r.section.locator("p.notice").first()).toHaveText(FIXTURE_RESULT.notices[0]);
  await expect(r.section.locator(".match-explainer")).toContainText("Match scores describe relevance to what you shared.");
  await expect(r.section.locator(".match-explainer")).toContainText("The study team confirms eligibility.");
  await expect(r.section.locator(":scope > p.source-note")).toHaveText(
    "ClinicalTrials.gov data fetched 2026-10-24. Listings can change. Confirm details directly with the study team.",
  );
});

test("results: studies are ordered by matching status, and those beyond the travel preference are listed separately", async ({ page }) => {
  await searchWith(page);
  const r = results(page);

  // The stream lists them as Unlikely, Can't tell yet, Ask the study team, Matches; the page reorders them.
  await expect(r.nearCards).toHaveCount(3);
  expect(await r.nearCards.evaluateAll((cards) => cards.map((c) => c.id))).toEqual([NERVE_BLOCK.id, EXPANDED.id, EXCLUDED.id]);
  await expect(r.nearCards.locator(".result-number")).toHaveText(["01", "02", "03"]);
  await expect(r.nearCards.locator(".bucket-pill")).toHaveText(["Matches what you told us", "Can't tell yet", "Unlikely"]);
  // A higher score does not lift an Unlikely study above the others.
  await expect(r.card(EXCLUDED.id).locator(".match-score")).toHaveText("70/100 match");
  await expect(r.card(EXPANDED.id).locator(".match-score")).toHaveText("40/100 match");

  await expect(r.fartherSummary).toHaveText("1 studies beyond your travel preference");
  await expect(r.card(REGISTRY.id)).toBeHidden();
  await r.fartherSummary.click();
  await expect(r.farther).toContainText("Distance affects travel. It does not determine medical eligibility.");
  const registry = r.card(REGISTRY.id);
  await expect(registry).toBeVisible();
  await expect(registry.locator(".result-number")).toHaveText("04");
  await expect(registry.locator(".bucket-pill")).toHaveText("Ask the study team");
});

test("results: a study card shows its key facts at a glance", async ({ page }) => {
  await searchWith(page);
  const card = results(page).card(NERVE_BLOCK.id);

  await expect(card.locator(".bucket-pill")).toHaveText("Matches what you told us");
  await expect(card.locator(".match-score")).toHaveText("82/100 match");
  const title = card.getByRole("heading", { level: 3 }).getByRole("link");
  await expect(title).toContainText(NERVE_BLOCK.study.briefTitle);
  await expect(title).toHaveAttribute("href", "https://clinicaltrials.gov/study/NCT90000001");
  await expect(title).toHaveAttribute("target", "_blank");
  await expect(card.locator(".sponsor")).toHaveText("Boise Pain Research Institute");
  await expect(card.locator(".study-badges span")).toHaveText(["Interventional", "PHASE2", "recruiting"]);
  await expect(card.locator(".site-line")).toHaveText(
    "⌖ Boise Pain Research Institute, Boise, ID · about 3 miles (from approximate ZIP center)",
  );
  await expect(card.locator(".why-care")).toHaveText(NERVE_BLOCK.whyCare);
  await expect(card.locator(".rule-reasons li")).toHaveText(NERVE_BLOCK.reasons);
  await expect(card.locator(".warning")).toHaveCount(0);

  // A stale record and the study's own warnings are flagged on the card.
  await results(page).fartherSummary.click();
  const registry = results(page).card(REGISTRY.id);
  await expect(registry.locator(".study-badges span")).toHaveText(["Observational", "not yet recruiting"]);
  await expect(registry.locator(".site-line")).toContainText("Salt Lake Neuro Clinic, Salt Lake City, UT · about 291 miles");
  await expect(registry.locator(".warning")).toHaveText([
    "This record may be stale. Ask whether the study is still open.",
    "Requires a referral from an oncologist.",
  ]);

  // A study with no sites or explanation falls back to plain, honest defaults.
  const expanded = results(page).card(EXPANDED.id);
  await expect(expanded.locator(".study-badges span")).toHaveText(["Expanded access", "available"]);
  await expect(expanded.locator(".site-line")).toHaveText("⌖ Ask the study team about locations · distance not available");
  await expect(expanded.locator(".why-care")).toHaveText(EXPANDED.study.briefSummary);
});

test("results: Study details & next steps opens the questions, checks, contacts, call script, sites, and exact requirements", async ({ page }) => {
  await searchWith(page);
  const card = results(page).card(NERVE_BLOCK.id);
  const details = card.locator("details.study-details");
  const body = details.locator(".detail-body");

  await expect(body).toBeHidden();
  await details.locator(":scope > summary").click();
  await expect(body).toBeVisible();

  const section = (heading: string) => body.locator("section").filter({ has: page.getByRole("heading", { name: heading, level: 4, exact: true }) });
  await expect(section("Why it came up")).toContainText(NERVE_BLOCK.whyFit);
  await expect(section("Possible barriers")).toContainText(NERVE_BLOCK.likelyBarriers);
  await expect(section("What to ask").locator("p")).toHaveText([NERVE_BLOCK.whatToVerify, NERVE_BLOCK.whatToDoNext]);

  const checks = section("Checks to discuss").locator(".criteria-checks li");
  await expect(checks).toHaveCount(2);
  await expect(checks.nth(0).locator("span")).toHaveText("✓");
  await expect(checks.nth(0).locator("span")).toHaveAttribute("aria-label", "met");
  await expect(checks.nth(0)).toContainText("Age 18 to 75");
  await expect(checks.nth(0)).toContainText("You shared that you are 58.");
  await expect(checks.nth(0).locator("small")).toHaveText("Source: Minimum age 18, maximum age 75");
  await expect(checks.nth(1).locator("span")).toHaveText("?");
  await expect(checks.nth(1).locator("span")).toHaveAttribute("aria-label", "unknown");

  const contact = body.locator(".contact");
  await expect(contact.locator("strong")).toHaveText("Dana Whitfield, RN");
  await expect(contact).toContainText("Study coordinator");
  await expect(contact.getByRole("link", { name: "(208) 555-0142" })).toHaveAttribute("href", "tel:2085550142");
  await expect(contact.getByRole("link", { name: "neuro-study@example.org" })).toHaveAttribute("href", "mailto:neuro-study@example.org");
  await expect(body.locator("pre.call-script")).toHaveText(NERVE_BLOCK.callScript);

  await expect(section("Study sites").locator("li")).toHaveText([
    "Boise Pain Research Institute, Boise, ID, 83702, United States — recruiting",
  ]);

  const verbatim = body.locator("details.verbatim-criteria");
  await expect(verbatim.locator(".criteria-text")).toBeHidden();
  await verbatim.locator("summary").click();
  await expect(verbatim.locator(".criteria-text")).toHaveText(NERVE_BLOCK.study.eligibility.criteriaText);

  const footer = body.locator("footer.source-note");
  await expect(footer.getByRole("link", { name: "NCT90000001 · ClinicalTrials.gov ↗" })).toHaveAttribute(
    "href",
    "https://clinicaltrials.gov/study/NCT90000001",
  );
  await expect(footer).toContainText("Record updated 2026-09-30 · fetched 2026-10-24");
});

test("results: a record with no contacts, sites, or requirements still gives a way forward", async ({ page }) => {
  await searchWith(page);
  const card = results(page).card(EXPANDED.id);
  await card.locator("details.study-details > summary").click();
  const body = card.locator(".detail-body");

  await expect(body).toContainText("Is this study still recruiting? Which requirements should my care team check?");
  await expect(body).toContainText("Talk with your care team, then contact the study team.");
  await expect(body).toContainText("No contact is listed in this record.");
  await expect(body.getByRole("link", { name: "Check the ClinicalTrials.gov record" })).toHaveAttribute(
    "href",
    "https://clinicaltrials.gov/study/NCT90000003",
  );
  // With no script from the model, the card writes a plain call script around the study number.
  await expect(body.locator("pre.call-script")).toContainText("The study number is NCT90000003.");
  await expect(body).toContainText("No sites are listed. Ask the study team.");
  await body.locator("details.verbatim-criteria > summary").click();
  await expect(body.locator(".criteria-text")).toHaveText("Requirements were not provided in this record.");
  await expect(body.getByRole("heading", { name: "Checks to discuss" })).toHaveCount(0);
});

test("results: filtering by matching status shows only that group, with counts", async ({ page }) => {
  await searchWith(page);
  const r = results(page);
  const filter = (name: string) => r.filters.getByRole("button", { name: new RegExp(`^${name}`) });

  await expect(r.filters.getByRole("button")).toHaveText([
    "All studies 4",
    "Matches what you told us 1",
    "Ask the study team 1",
    "Can't tell yet 1",
    "Unlikely 1",
  ]);
  await expect(filter("All studies")).toHaveAttribute("aria-pressed", "true");

  await filter("Unlikely").click();
  await expect(filter("Unlikely")).toHaveAttribute("aria-pressed", "true");
  await expect(filter("All studies")).toHaveAttribute("aria-pressed", "false");
  expect(await r.nearCards.evaluateAll((cards) => cards.map((c) => c.id))).toEqual([EXCLUDED.id]);
  await expect(r.farther).toHaveCount(0);

  // The only "Ask the study team" study is beyond the travel preference, so it stays in that list.
  await filter("Ask the study team").click();
  await expect(r.nearCards).toHaveCount(0);
  await expect(r.fartherSummary).toHaveText("1 studies beyond your travel preference");
  await expect(r.section.getByText("No studies are in this group.")).toHaveCount(0);

  await filter("All studies").click();
  await expect(r.nearCards).toHaveCount(3);
  await expect(r.farther).toHaveCount(1);
});

test("results: an empty matching group says so instead of showing a blank list", async ({ page }) => {
  await searchWith(page, { ...FIXTURE_RESULT, matches: [NERVE_BLOCK] });
  const r = results(page);

  await expect(r.filters.getByRole("button", { name: /^Unlikely/ })).toHaveText("Unlikely 0");
  await r.filters.getByRole("button", { name: /^Unlikely/ }).click();
  await expect(r.cards).toHaveCount(0);
  await expect(r.section.locator("p.notice", { hasText: "No studies are in this group." })).toHaveText(
    "No studies are in this group. Choose another matching status.",
  );
});

test("results: expanded-access programs are called out and linked to their cards", async ({ page }) => {
  await searchWith(page);
  const r = results(page);

  const aside = r.section.locator("aside.expanded-access");
  await expect(aside.getByRole("heading", { name: "Expanded access", level: 3 })).toBeVisible();
  await expect(aside).toContainText("a listing does not mean the treatment is available to you now");
  await expect(aside).toContainText("1 program in these results.");
  await expect(aside.getByRole("link", { name: "See programs ↓" })).toHaveAttribute("href", "#expanded-programs");

  const index = r.section.locator("#expanded-programs");
  await expect(index.getByRole("heading", { name: "Expanded-access programs in this search" })).toBeVisible();
  await expect(index.locator("li")).toHaveText([`${EXPANDED.study.briefTitle} · Can't tell yet`]);
  await index.getByRole("link", { name: EXPANDED.study.briefTitle }).click();
  await expect(page).toHaveURL(new RegExp(`#${EXPANDED.id}$`));
  await expect(r.card(EXPANDED.id)).toBeInViewport();
});

test("results: the map is drawn locally with every US study site and the patient's approximate location", async ({ page }) => {
  await searchWith(page);
  const map = results(page).section.locator("section.map-panel");

  await expect(map.getByRole("heading", { name: "Where the studies are" })).toBeVisible();
  // NERVE_BLOCK, REGISTRY, and EXCLUDED each list one US site with coordinates; EXPANDED lists none.
  const svg = map.getByRole("img", { name: "3 study sites on an approximate United States map. Full addresses are listed on each study card." });
  await expect(svg).toBeVisible();
  await expect(svg.locator("a")).toHaveCount(3);
  expect(await svg.locator("a").evaluateAll((links) => links.map((a) => a.getAttribute("href")).sort())).toEqual(
    [`#${NERVE_BLOCK.id}`, `#${REGISTRY.id}`, `#${EXCLUDED.id}`].sort(),
  );
  await expect(svg.locator("a title").first()).toHaveText(`${NERVE_BLOCK.study.briefTitle} — Boise Pain Research Institute, Boise, ID`);
  await expect(svg.locator("path > title")).toHaveText("Your approximate location");
  // The dashed travel-radius ring is drawn because the travel preference is not "anywhere".
  await expect(svg.locator("circle[stroke-dasharray]")).toHaveCount(1);
  await expect(map.locator(".map-note")).toContainText("This map is drawn on your computer. No patient location is sent to a map service.");
  await expect(map.locator(".map-note")).not.toContainText("Your location marker and travel radius will appear");
});
