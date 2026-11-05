import { test as base, expect, type Page, type Request } from "@playwright/test";
import type { PatientProfile } from "../lib/contracts/patientProfile";
import type { Study } from "../lib/contracts/study";
import type { StudyMatch, StudySearchResult, StudyStreamEvent } from "../lib/contracts/studyMatch";
import type { SearchStatus } from "../lib/embeddings/searchStatus";

/**
 * Shared fixtures for the Treatable journeys.
 *
 * Every journey runs against the real production build, but the routes that
 * would reach a model provider or download a model (/api/match, /api/profile,
 * /api/llm/*) are stubbed at the network layer with page.route, so each run is
 * deterministic and spends nothing. /api/demos is left real: it only serves
 * the committed data/precomputed.json file.
 *
 * The extended `test` below also enforces the app's privacy promise for every
 * journey: any request the page makes to a host other than the local server is
 * blocked and fails the test, so no patient text or location can leave the
 * computer during a journey without the suite noticing.
 */
export const test = base.extend<{ outboundRequests: string[] }>({
  outboundRequests: [
    async ({ context }, use) => {
      const outbound: string[] = [];
      // On the context, so every page and tab a journey opens is covered too.
      await context.route(
        (url) => url.hostname !== "127.0.0.1" && url.hostname !== "localhost",
        (route) => {
          outbound.push(route.request().url());
          return route.abort("blockedbyclient");
        },
      );
      await use(outbound);
      expect(outbound, "the page must not contact any host other than the local server").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

/** The profile the server echoes back in a result (it resolves the ZIP to coordinates). */
export const FIXTURE_PROFILE: PatientProfile = {
  fillingOutAs: "patient",
  ageYears: 58,
  sex: "female",
  primaryDiagnoses: ["chemotherapy-induced peripheral neuropathy"],
  symptoms: ["burning foot pain", "numbness"],
  symptomNarrative:
    "Burning pain and numbness in both feet since chemotherapy ended last year. Gabapentin helped a little, but walking is still hard.",
  treatmentsTried: ["gabapentin", "duloxetine"],
  location: { zip: "83702", city: "Boise", state: "ID", lat: 43.615, lon: -116.2023 },
  travelRadiusMiles: 250,
  openTo: { phase1: true, placebo: true, inpatient: true, expandedAccess: true },
};

/** Values typed into the intake form; they line up with FIXTURE_PROFILE. */
export const INTAKE = {
  narrative: FIXTURE_PROFILE.symptomNarrative,
  age: "58",
  zip: "83702",
  city: "Boise",
  state: "ID",
};

const FETCHED_AT = "2026-10-24T03:43:48.920Z";

function study(overrides: Partial<Study> & Pick<Study, "id" | "briefTitle">): Study {
  return {
    officialTitle: "",
    briefSummary: "",
    detailedDescription: "",
    conditions: [],
    keywords: [],
    interventions: [],
    studyType: "INTERVENTIONAL",
    phase: [],
    overallStatus: "RECRUITING",
    eligibility: { criteriaText: "", stdAges: [] },
    locations: [],
    contacts: [],
    sponsor: "",
    sourceUrl: `https://clinicaltrials.gov/study/${overrides.id}`,
    provenance: "ctgov_api_v2",
    fetchedAt: FETCHED_AT,
    ...overrides,
  };
}

function match(overrides: Partial<StudyMatch> & Pick<StudyMatch, "id" | "study" | "bucket" | "score">): StudyMatch {
  return {
    reasons: [],
    criteria: [],
    outOfRadius: false,
    stale: false,
    provisional: false,
    final: true,
    whyCare: "",
    whyFit: "",
    likelyBarriers: "",
    whatToVerify: "",
    whatToDoNext: "",
    callScript: "",
    warnings: [],
    ...overrides,
  };
}

/** Matches what you told us: a nearby recruiting trial with every detail filled in. */
export const NERVE_BLOCK = match({
  id: "NCT90000001",
  bucket: "eligible",
  score: 82,
  distanceMiles: 3.2,
  study: study({
    id: "NCT90000001",
    briefTitle: "Low-Dose Nerve Block for Chemotherapy-Induced Neuropathic Pain",
    briefSummary: "Tests a low-dose nerve block for burning foot pain after chemotherapy.",
    studyType: "INTERVENTIONAL",
    phase: ["PHASE2"],
    overallStatus: "RECRUITING",
    sponsor: "Boise Pain Research Institute",
    lastUpdatePostDate: "2026-09-30",
    eligibility: {
      criteriaText: "Inclusion: adults 18 to 75 with painful neuropathy for at least 3 months after chemotherapy.",
      stdAges: ["ADULT"],
    },
    locations: [
      {
        facility: "Boise Pain Research Institute",
        city: "Boise",
        state: "ID",
        zip: "83702",
        country: "United States",
        lat: 43.62,
        lon: -116.2,
        status: "RECRUITING",
      },
    ],
    contacts: [
      { name: "Dana Whitfield, RN", role: "Study coordinator", phone: "(208) 555-0142", email: "neuro-study@example.org" },
    ],
  }),
  reasons: ["Lists neuropathic pain after chemotherapy, which you described", "Recruiting about 3 miles away"],
  criteria: [
    { label: "Age 18 to 75", status: "met", note: "You shared that you are 58.", source: "Minimum age 18, maximum age 75", provenance: "structured" },
    { label: "No change to pain medicines in the last 30 days", status: "unknown", note: "Your care team can confirm this.", provenance: "model_inferred" },
  ],
  whyCare: "A nearby study for the burning foot pain that has stayed after chemotherapy.",
  whyFit: "It enrolls adults with painful neuropathy that began with chemotherapy.",
  likelyBarriers: "Weekly visits for the first month.",
  whatToVerify: "Ask whether gabapentin use affects eligibility.",
  whatToDoNext: "Share this study with your oncologist, then call the coordinator.",
  callScript: "Hello, I am calling about study NCT90000001 for neuropathic pain after chemotherapy.",
});

/** Ask the study team: an observational study beyond the 250-mile travel preference, with a stale record. */
export const REGISTRY = match({
  id: "NCT90000002",
  bucket: "conditionally_eligible",
  score: 64,
  distanceMiles: 291,
  outOfRadius: true,
  stale: true,
  study: study({
    id: "NCT90000002",
    briefTitle: "Mountain West Neuropathy Symptom Registry",
    studyType: "OBSERVATIONAL",
    overallStatus: "NOT_YET_RECRUITING",
    sponsor: "Intermountain Neuropathy Network",
    locations: [
      { facility: "Salt Lake Neuro Clinic", city: "Salt Lake City", state: "UT", country: "United States", lat: 40.76, lon: -111.89 },
    ],
  }),
  whyCare: "A registry that follows neuropathy symptoms over time.",
  warnings: ["Requires a referral from an oncologist."],
});

/** Can't tell yet: an expanded-access program with no sites or contacts listed. */
export const EXPANDED = match({
  id: "NCT90000003",
  bucket: "unknown",
  score: 40,
  study: study({
    id: "NCT90000003",
    briefTitle: "Expanded Access to an Investigational Sodium-Channel Blocker",
    briefSummary: "Provides an investigational sodium-channel blocker outside a clinical trial.",
    studyType: "EXPANDED_ACCESS",
    overallStatus: "AVAILABLE",
    sponsor: "Example Therapeutics",
  }),
});

/** Unlikely: a higher score than the others, but a structured unmet requirement puts it last. */
export const EXCLUDED = match({
  id: "NCT90000004",
  bucket: "excluded",
  score: 70,
  distanceMiles: 340,
  study: study({
    id: "NCT90000004",
    briefTitle: "Spinal Cord Stimulation for Painful Diabetic Neuropathy",
    studyType: "INTERVENTIONAL",
    phase: ["PHASE3"],
    sponsor: "Cascade Neuromodulation",
    locations: [
      { facility: "Portland Spine Center", city: "Portland", state: "OR", country: "United States", lat: 45.52, lon: -122.68 },
    ],
  }),
  criteria: [{ label: "Diagnosis of diabetes", status: "unmet", note: "You did not list diabetes.", provenance: "structured" }],
});

/**
 * A completed search. The matches are deliberately out of display order so the
 * journeys prove the page sorts them (by matching status, then score).
 */
export const FIXTURE_RESULT: StudySearchResult = {
  profile: FIXTURE_PROFILE,
  matches: [EXCLUDED, EXPANDED, REGISTRY, NERVE_BLOCK],
  corpusCount: 2000,
  fetchedAt: FETCHED_AT,
  embeddingMode: "keyword",
  notices: ["Showing keyword matches while the local search model is unavailable."],
};

/** The same matches as they look in the first, provisional event: no scores or explanations yet. */
export function provisionalResult(result: StudySearchResult = FIXTURE_RESULT): StudySearchResult {
  return {
    ...result,
    matches: result.matches.map((m) => ({ ...m, provisional: true, final: false, whyCare: "", whyFit: "", whatToVerify: "", callScript: "" })),
  };
}

/** Serialize events as the server-sent-event frames /api/match streams. */
export function sse(events: StudyStreamEvent[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

/** The full stream a successful search produces. */
export function fullStream(result: StudySearchResult = FIXTURE_RESULT): StudyStreamEvent[] {
  return [
    { type: "provisional", result: provisionalResult(result) },
    { type: "passA", result },
    { type: "passB", result },
    { type: "complete", result },
  ];
}

/** Every POST body the page sent to /api/match during the test. */
export type MatchRequestBody = { profile: PatientProfile; provider: string; cloudConsent: boolean };

/**
 * Stub POST /api/match with a server-sent-event body. `respond` can return a
 * different stream (or an HTTP error) per call, so a journey can fail first and
 * succeed on retry. Returns the list of request bodies, filled in as they arrive.
 */
export async function stubMatch(
  page: Page,
  respond: (call: number) => { status?: number; contentType?: string; body: string } | Promise<{ status?: number; contentType?: string; body: string }> = () => ({
    body: sse(fullStream()),
  }),
): Promise<MatchRequestBody[]> {
  const requests: MatchRequestBody[] = [];
  await page.route("**/api/match", async (route) => {
    requests.push(route.request().postDataJSON() as MatchRequestBody);
    const reply = await respond(requests.length);
    await route.fulfill({
      status: reply.status ?? 200,
      headers: { "content-type": reply.contentType ?? "text/event-stream", "cache-control": "no-store" },
      body: reply.body,
    });
  });
  return requests;
}

/** A built-in search status as GET /api/llm/embeddings reports it. */
export function searchStatus(builtin: Partial<SearchStatus["builtin"]> = {}): SearchStatus {
  return {
    space: "builtin",
    label: "Built-in, on this computer",
    model: "nomic-embed-text-v1.5 (128 tokens)",
    reason: "Treatable keeps all patient search embeddings on this computer",
    setting: "builtin",
    builtin: { state: "ready", model: "nomic-embed-text-v1.5", totalBytes: 137_000_000, ...builtin },
  };
}

/**
 * Stub the Settings "Search" line (GET/POST /api/llm/embeddings) so it never
 * reads or downloads the real model. `get` is called on every poll.
 */
export async function stubSearchStatus(
  page: Page,
  get: () => SearchStatus = () => searchStatus(),
  post?: () => { status: number; body: unknown },
): Promise<{ posts: number }> {
  const calls = { posts: 0 };
  await page.route("**/api/llm/embeddings", async (route) => {
    if (route.request().method() === "POST") {
      calls.posts++;
      const reply = post ? post() : { status: 202, body: { started: true, status: get() } };
      return route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(get()) });
  });
  return calls;
}

/**
 * The standard backend for a journey: a ready search status and a successful
 * /api/match stream. Returns the /api/match request bodies.
 */
export async function stubBackend(page: Page): Promise<MatchRequestBody[]> {
  await stubSearchStatus(page);
  return stubMatch(page);
}

/** A gate that holds a stubbed response until the journey releases it. */
export function gate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => (release = resolve));
  return { wait, release };
}

/**
 * Replace the page's fetch for /api/match with a stream the journey writes to
 * frame by frame (window.__matchStream.push / .close), and record each request
 * body in window.__matchRequests. page.route can only fulfill a whole body at
 * once, so this is the only way to watch the page update between events the
 * way it does against the real streaming server. The stream errors with an
 * AbortError when the page aborts the request, exactly like a real fetch.
 */
export async function controlMatchStream(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __matchRequests: unknown[];
      __matchStream?: { push: (text: string) => void; close: () => void };
    };
    w.__matchRequests = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(href, location.href).pathname !== "/api/match") return realFetch(input, init);
      w.__matchRequests.push(JSON.parse(String(init?.body ?? "{}")));
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
      const encoder = new TextEncoder();
      w.__matchStream = { push: (text) => controller.enqueue(encoder.encode(text)), close: () => controller.close() };
      init?.signal?.addEventListener("abort", () => {
        try {
          controller.error(new DOMException("The user aborted a request.", "AbortError"));
        } catch {
          /* already closed */
        }
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
  });
}

/** Write raw text to the controlled /api/match stream (see controlMatchStream). */
export async function pushToStream(page: Page, text: string): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as { __matchStream?: unknown }).__matchStream));
  await page.evaluate((t) => (window as unknown as { __matchStream: { push: (s: string) => void } }).__matchStream.push(t), text);
}

/** Close the controlled /api/match stream. */
export async function closeStream(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __matchStream: { close: () => void } }).__matchStream.close());
}

/**
 * Open the home page and wait until React has hydrated it. The intake form only
 * renders after a client effect has read the saved profile, so once it is
 * visible every control on the page responds to clicks; clicking a server-
 * rendered button before that would silently do nothing.
 */
export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("form.intake-form")).toBeVisible();
}

/** The intake form's controls, by their visible labels. */
export function intake(page: Page) {
  const form = page.locator("form.intake-form");
  return {
    form,
    story: form.getByLabel("What would you like help with?"),
    fillingOutAs: form.getByLabel(/^I’m filling this out as/),
    age: form.getByLabel(/^Age/),
    sex: form.getByLabel(/^Sex listed in medical records/),
    zip: form.getByLabel(/^US ZIP code/),
    city: form.getByLabel("City", { exact: true }),
    state: form.getByLabel("State", { exact: true }),
    travel: form.getByLabel("How far could you travel?"),
    details: form.locator("details.optional-details"),
    diagnoses: form.getByLabel("Diagnoses, separated by commas"),
    symptoms: form.getByLabel("Symptoms, separated by commas"),
    tried: form.getByLabel("Treatments tried, separated by commas"),
    usualDay: form.getByLabel("How is a usual day?"),
    helpFill: form.getByRole("button", { name: /Help fill details from my note|Reading your note/ }),
    submit: form.getByRole("button", { name: /Find studies|Finding studies/ }),
    error: form.getByRole("alert"),
  };
}

/** Fill the minimum a search needs: a description, an age, and a ZIP (plus city and state). */
export async function fillIntake(page: Page, values: Partial<typeof INTAKE> = {}): Promise<void> {
  const v = { ...INTAKE, ...values };
  const f = intake(page);
  await f.story.fill(v.narrative);
  await f.age.fill(v.age);
  await f.zip.fill(v.zip);
  await f.city.fill(v.city);
  await f.state.fill(v.state);
}

/** Track requests to a path so a journey can prove a call was, or was not, made. */
export function trackRequests(page: Page, path: string): Request[] {
  const seen: Request[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === path) seen.push(request);
  });
  return seen;
}

/** The results section, and a study card inside it by NCT id. */
export function results(page: Page) {
  const section = page.locator("section.results-section");
  return {
    section,
    heading: section.getByRole("heading", { name: "A starting point, together.", level: 2 }),
    summaryLine: section.locator(".results-heading p"),
    card: (id: string) => section.locator(`article.study-card#${id}`),
    cards: section.locator("article.study-card"),
    nearCards: section.locator(".study-list > article.study-card"),
    farther: section.locator("details.farther-studies"),
    fartherSummary: section.locator("details.farther-studies > summary"),
    filters: section.getByLabel("Filter studies by matching status"),
  };
}

/** The page-level search status line ("Searching the study list…", "Search complete", ...). */
export function searchPhase(page: Page) {
  return page.locator(".search-live");
}

/** The page-level error banner (separate from the form's own validation message). */
export function pageError(page: Page) {
  return page.locator("main > .error-message[role=alert]");
}
