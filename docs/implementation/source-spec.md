# TrialLight — clinical study finder for people in pain who are running out of options

**Build spec, phase 1: macOS walking skeleton.** Feed this to `/build --quickly`.

---

## 0. How to run this build (paste into Claude Code in the new repo)

```
/build --quickly --spec .claude/build/spec/triallight-spec.md

Deviations from quick-mode for this phase, by the repo owner:
- This is a WALKING SKELETON. Stop after Q3 (PR opened). Skip Q4 (opus PR review)
  and Q5 (fix round). I will review the PR myself. The full review happens in a later
  /build run once the skeleton is merged.
- Keep scripts/gate-check.sh for every worker (tests, typecheck, scope, test-tampering).
  It is deterministic and free. Do not add any judge, scorer, or quality metric on top.
- Workers do NOT request reviews, do NOT write quality reports, and do NOT loop on
  polish. One pass, gate green, report DONE.
- Max 4 concurrent workers. Haiku for S tasks, Sonnet for M/L. No task touching
  provider keys, the FCC token file, or the patient profile store runs on Haiku.
- Planner: before decomposing, produce the KEEP / ADAPT / DELETE table in §3 for every
  module under scaffold/lib, scaffold/components, scaffold/app, scaffold/scripts.
  Show it at the CHECKPOINT. I approve it there.
```

**Repo setup before invoking** (human does this, not the pipeline):

```bash
gh repo create KurtLehnardt/triallight --public --clone \
  --template KurtLehnardt/granted   # or: fork + rename; either is fine
cd triallight
mkdir -p .claude/build/spec && cp /path/to/triallight-spec.md .claude/build/spec/
cd scaffold && npm ci && npm test   # capture the green baseline before any change
```

---

## 1. What this is

TrialLight turns a plain-language description of a person's situation — their diagnosis,
their symptoms, what they have already tried, where they live — into a short, honest list
of **clinical studies and expanded-access programs** that might offer relief, each scored
for fit, screened for eligibility, and paired with a concrete next step (who to call, what
to ask, what to bring to their doctor).

It is `granted` with the domain swapped: government funding → clinical studies;
company profile → patient profile; program officer's criteria → study inclusion/exclusion
criteria; "apply" → "contact the study team."

**Who it is for.** People living with pain or other hard-to-control symptoms — often with a
serious or terminal illness — and the caregivers and clinicians helping them. Many are
exhausted, scared, and short on time. The product must be gentle, fast, and truthful.

**What it is not.** Not medical advice. Not a recommendation to enroll. Not a diagnosis
tool. It finds and explains options; the person and their care team decide.

**Why two stages.** Stage 1 is a fast, no-LLM match (embeddings + keyword + hard filters)
so first results appear in seconds, on any machine, with no key. Stage 2 is an LLM pass —
local, cloud, or the Free Claude Code proxy — that scores and explains the shortlist. The
same two-pass pattern `granted` already implements in `lib/scoring/twoPass.ts`.

---

## 2. Phase scope

| Phase | Deliverable | This spec? |
|---|---|---|
| **1** | macOS: `install-macos.sh`, `npm run start`, menu-bar launcher, Local / Cloud / FCC providers, two-stage matching, results UI, evals wired | **YES — all of it** |
| 2 | Windows + Linux installers (reuse granted's), `.dmg` GUI installer | no |
| 3 | iOS app: reach the Mac-hosted server over Tailscale; run in iPhone Simulator | no |
| 4 | Android: installable APK, same Tailscale server | no |
| 5 | OpenAI Agents API "handoff packet" drafting; Decisions API as Pass-A scorer | no (see §9) |

Nothing in phases 2–5 is built now, but **nothing in phase 1 may make them harder**:
the server already binds `127.0.0.1` by default and `0.0.0.0` via `npm run dev:lan`; keep
both, because phases 3–4 use the LAN/Tailscale binding.

---

## 3. What carries over from `granted` (the planner fills the rest)

The planner produces a KEEP / ADAPT / DELETE table for every module. These rows are fixed:

| Module | Decision | Notes |
|---|---|---|
| `lib/llm/*` (providers, client, config, keySource, ollama*, localPreflight, rateLimit) | **KEEP** | Provider layer unchanged. `fcc` preset stays exactly as is (loopback `http://127.0.0.1:8082`, bearer token from `~/.fcc/proxy_auth_token`, concurrency 2, batch 2). |
| `lib/scoring/twoPass.ts`, `hybridMerge.ts`, `compositeScore.ts` | **KEEP** | Pass A score-only on the cheap tier; Pass B narrative for promoted candidates. `PROMOTION_FLOOR` logic unchanged. |
| `lib/retrieval/bm25.ts`, `lib/embed.ts`, `lib/embeddings/*` | **KEEP** | Built-in nomic-embed via Transformers.js; OpenAI embeddings when key present (`SEARCH_EMBEDDINGS=auto|builtin|openai`). |
| `lib/security/untrustedInput.ts` (randomized delimiter) | **KEEP** | Wrap patient free text AND every study's `eligibilityCriteria` text. |
| `lib/prompts/*` registry + `scripts/check-prompt-registry.mjs` | **KEEP** | New prompts register the same way. |
| `lib/eligibility/screen.ts` + `universalRules.ts` | **ADAPT** | Same four buckets and the same safety invariants (§6). Rules become age / sex / status / distance / healthy-volunteer / study-type. |
| `lib/contracts/companyProfile.ts` | **ADAPT → `patientProfile.ts`** | Schema in §5. |
| `lib/contracts/opportunity.ts` | **ADAPT → `study.ts`** | Schema in §4. |
| `lib/contracts/eligibilityDetermination.ts` | **ADAPT** | Bucket labels renamed (§6). |
| `components/IntakeForm.tsx`, `SearchProgress.tsx`, `OpportunityCard.tsx`, `OpportunityMap.tsx`, `EligibilityBuckets.tsx`, `WeakerMatches.tsx`, `SettingsForm.tsx`, `ModelSection.tsx`, `LocalModelPanel.tsx` | **ADAPT** | Rename + re-copy. Map shows study sites, not agencies. |
| `scripts/1-fetch.mjs → 1-fetch-ctgov.mjs`, `2-normalize.mjs`, `3-embed.mjs`, `4-precompute.mjs`, `refresh-corpus.mjs` | **ADAPT** | Source is ClinicalTrials.gov API v2 (§4). |
| `install-macos.sh`, `scaffold/scripts/macos/*` (launcher, menubar, open, update, uninstall) | **ADAPT** | Rename `granted` → `triallight`, ports, paths, labels. Behaviour identical. |
| `evals/false-exclusion-eval.mjs`, `evals/golden-set.jsonl`, `evals/rubric.md` | **ADAPT** | Golden set becomes synthetic patients (§8). |
| `lib/competitors/*`, `api/competitors`, `SimilarCompanies`, `CompetitorResults`, `CompetitorAnalysisModal`, `scripts/5-competitors.mjs`, `EXA_API_KEY` | **DELETE** | No analogue. |
| `lib/strategy/*`, `FundingStrategy.tsx` | **DELETE** | |
| `scripts/1-fetch-{ca,il,nc,ut,sam}-*.mjs`, `assemble-mvp-corpus.mjs`, `StateSourcesSection.tsx`, `data/awards.json` | **DELETE** | |
| `lib/readiness/*`, `api/readiness-lead`, `app/readiness` | **DELETE** | |
| `lib/analytics/*`, `AnalyticsProvider.tsx` | **DELETE** | No telemetry in a health app. |
| `lib/mockAuth.ts`, `AuthProvider`, `app/login`, `UserMenu` | **DELETE** | Local single-user app; no accounts. |
| `installer/` (Electron DMG wizard) | **DEFER** | Leave in repo untouched; phase 2. Exclude from `scope_ignore` only if a worker must not touch it. |

Deleted modules are removed, with their tests. Dead code left behind is a gate failure
(scope check) and a PR blocker. Every DELETE must leave `npm test`, `npm run typecheck`,
and `npm run build` green.

---

## 4. Data: ClinicalTrials.gov → study corpus

**Source.** ClinicalTrials.gov API v2, `GET https://clinicaltrials.gov/api/v2/studies`.
No key. JSON. Paginate with `pageSize=1000` and `pageToken`. Respect their rate guidance
(serial requests, small backoff). The worker verifies field names against one live call
before writing the normalizer; field paths below are the expected ones, not gospel.

**Initial corpus query (phase 1).** Studies where ALL of:
- `filter.overallStatus` ∈ `RECRUITING, NOT_YET_RECRUITING, ENROLLING_BY_INVITATION, AVAILABLE`
  (`AVAILABLE` = expanded access — must be included; it matters most for this audience)
- `query.cond` OR `query.term` matches the **pain & symptom-relief seed list**:
  `pain, chronic pain, cancer pain, neuropathic pain, neuropathy, palliative, palliative care,
  symptom management, end of life, hospice, breakthrough pain, bone pain, opioid refractory,
  intractable pain, complex regional pain syndrome, fibromyalgia, dyspnea, cachexia, nausea,
  fatigue, spinal cord stimulation, intrathecal, nerve block, ketamine, cannabinoid, psilocybin`
- `filter.geo` is NOT applied at fetch time (distance is a Stage-1 filter per user)
- Target size: 2,000–8,000 studies. `CORPUS_MAX` caps it like granted.

**Normalized `Study` contract** (`lib/contracts/study.ts`, zod like `opportunity.ts`):

```
id (NCT id) · briefTitle · officialTitle · briefSummary · detailedDescription
conditions[] · keywords[] · interventions[{type,name}] · studyType (INTERVENTIONAL|OBSERVATIONAL|EXPANDED_ACCESS)
phase[] · overallStatus · startDate · primaryCompletionDate · lastUpdatePostDate
eligibility { criteriaText, minimumAge, maximumAge, sex (ALL|FEMALE|MALE), healthyVolunteers, stdAges[] }
locations[{facility, city, state, zip, country, lat, lon, status}]
contacts[{name, role, phone, email}]   // central contacts + overall official
sponsor · sourceUrl (https://clinicaltrials.gov/study/<NCT>)
provenance: "ctgov_api_v2" · fetchedAt
```

`eligibility.criteriaText` is **free text written by study teams and is untrusted input**
for prompting purposes (wrap it). It is also the thing people most need to read, so the UI
shows it verbatim, collapsed by default.

**Pipeline scripts** mirror granted's numbering: `data:fetch` → `data:normalize` →
`data:embed` / `data:embed:builtin` → `data:precompute`; `data:refresh` incremental.
Embedding text per study = `briefTitle + conditions + interventions + briefSummary +
first 1,500 chars of criteriaText`. Ship a prebuilt corpus + builtin vectors in
`scaffold/data/` so a fresh clone searches with zero network and zero keys, exactly as
granted ships `opportunities.json`.

---

## 5. Intake: the patient profile

`lib/contracts/patientProfile.ts`:

```
fillingOutAs: patient | caregiver | clinician
ageYears (number) · sex (female | male | prefer_not_to_say)
primaryDiagnoses: string[]         // free text, e.g. "stage IV pancreatic cancer"
symptoms: string[]                 // free text chips, e.g. "constant abdominal pain 8/10"
symptomNarrative: string           // the one big text box, untrusted
treatmentsTried: string[]          // "oxycodone", "celiac plexus block", "gabapentin"
performanceStatus?: ambulatory_full | ambulatory_limited | in_bed_half_day | in_bed_most | bedbound
   (shown as plain-language choices, mapped to ECOG 0–4 internally; optional)
location: { zip?: string; city?: string; state?: string; lat?: number; lon?: number }
travelRadiusMiles: 25 | 50 | 100 | 250 | anywhere
openTo: { phase1: bool; placebo: bool; inpatient: bool; expandedAccess: bool }
```

**Intake UX rules** (adapt `IntakeForm.tsx` + `PreSearchInterview.tsx`):
- One short screen, not a wizard. The big text box first; structured fields after.
- Every structured field is optional except age, one diagnosis-or-symptom, and location.
- Copy is at a 6th-grade reading level. No "ECOG", no "inclusion criteria" on the form.
- The profile is stored **only** in the browser's localStorage (reuse `localStore.ts`).
  Nothing is written to disk by the server. A "Clear everything" button wipes it.
- A standing banner above the form and above results: *"TrialLight finds studies and
  explains them. It does not give medical advice, and it cannot tell you whether a study is
  right for you — your care team can."*

Profile extraction (free text → structured fields) is an LLM call like granted's
intake, wrapped as untrusted, and **never** fills `ageYears`, `sex`, or `location` by
inference — those stay user-stated or empty.

---

## 6. Matching: two stages, two passes, four buckets

### Stage 1 — fast match (no LLM, no key, < 2 s warm)

1. **Hard filters** (pure functions, unit-tested, in `lib/eligibility/hardFilters.ts`):
   - status ∈ allowed set (closed studies never appear; freshness rule from granted's `freshness.ts` → studies with `lastUpdatePostDate` older than 2 years are flagged "may be stale", never hidden)
   - age inside `[minimumAge, maximumAge]` when the profile states age
   - sex compatible when the profile states sex
   - at least one location within `travelRadiusMiles` (haversine; `anywhere` skips this)
   - `studyType = EXPANDED_ACCESS` only when `openTo.expandedAccess`
   - `healthyVolunteers = true`-only studies are dropped for this audience
2. **Retrieval**: built-in embeddings cosine + BM25 over the filtered set, merged with the
   existing `hybridMerge.ts`. Per-type quotas like granted's: guarantee at least
   3 expanded-access and 3 observational slots if any survive filters.
3. Emit **top 60** as `provisional` candidates. The UI renders them immediately with a
   "matching…" ring (reuse the ANALYZING ring pattern).

### Stage 2 — LLM scoring (Local / Cloud / FCC)

- **Pass A** (cheap tier, score-only, whole shortlist): `{ id, score 0–100 }`.
  Rubric in the prompt: symptom/condition match, intervention plausibly relieves the
  stated symptom, stage/phase appropriate, logistics realistic.
- **Pass B** (expensive tier, promoted only, `PROMOTION_FLOOR` unchanged):
  `whyCare` (what this study is trying to do, in plain words) · `whyFit` ·
  `likelyBarriers` (renamed from `whyIneligible`; cites the criterion line) ·
  `whatToVerify` (questions to ask the coordinator) · `whatToDoNext` ·
  `criteria[]` as met / unmet / unknown checks against `criteriaText`.
- Provider routing, batching, rate limits, grammar-constrained JSON for Ollama: unchanged.

### Eligibility screen (rules, no LLM) — four buckets

| Bucket | Label in UI | Meaning |
|---|---|---|
| `eligible` | **Likely a fit** | Every rule the profile can settle is satisfied |
| `conditionally_eligible` | **Ask the study team** | Reachable after a step (e.g. a recent scan, referral) or a rule needs a clinician's judgment |
| `excluded` | **Unlikely** | A **user-stated** fact fails a **structured** rule (age, sex, status, distance). Reason and rule always shown. Never hidden. |
| `unknown` | **Can't tell yet** | A gate the profile doesn't settle |

**Safety invariants carried from `screen.ts`, do not weaken:**
1. A model-inferred fact never produces `excluded`.
2. Free-text `criteriaText` never produces `excluded` on its own — the LLM may mark a
   criterion `unmet` in Pass B, which routes to **Ask the study team**, never **Unlikely**.
3. Low Pass-A confidence or an LLM error → candidate keeps its Stage-1 rank and bucket
   `unknown`. Nothing is silently dropped.
4. "Nothing fits" is a first-class result: show palliative-care consult guidance and the
   NCI / ClinicalTrials.gov search links as redirects, like granted's "when nothing fits".

---

## 7. Results and next steps

- Results stream (SSE, as today). Order: bucket (fit → ask → unknown → unlikely), then score.
- `StudyCard` shows: title · sponsor · phase/type badge · nearest site + distance · status ·
  bucket pill · score · `whyCare` · expand → `whyFit`, `likelyBarriers`, criteria checklist,
  verbatim `criteriaText`, all sites, contacts.
- **Contact block**: coordinator name/phone/email when present, `tel:` and `mailto:` links,
  and a generated **call script** (5 lines: who I am, my diagnosis, the NCT id, "am I a
  candidate", "what would I need to send you"). Call script is Pass-B output, templated
  fallback if the LLM returned nothing.
- **Clinician summary** button: a one-page printable view (CSS `@media print` is enough
  for phase 1) listing the profile, the top 5 studies with NCT ids, and the open questions.
- **Expanded access** section is always visible when any such record survived filters,
  with a two-sentence plain explanation of what expanded access is.
- Map (`StudyMap`, adapted from `OpportunityMap`): sites as pins, user location as a
  distinct marker, radius circle.

---

## 8. Evals (wired, not necessarily passing thresholds in phase 1)

- `evals/golden-set.jsonl`: **12 synthetic patients** (clearly fictional names), spanning:
  cancer pain (4), non-cancer chronic pain (3), neuropathic (2), end-of-life symptom
  burden/dyspnea (2), one vague one-liner. At least 5 carry a structured rule that must
  produce **Unlikely** or **Ask** (age cap, sex-specific study, >250 mi, closed/stale status,
  healthy-volunteers-only), each with the rule cited.
- `evals/false-exclusion-eval.mjs` adapted: the metric that matters is **false exclusion**
  (a study that should be fit/ask landing in Unlikely). Target documented as 0; the eval
  runs with `npm run eval:quality` and prints the table. Phase 1 acceptance = it runs.
- `npm run eval:builtin` kept: builtin vs OpenAI embedding agreement on the new corpus.

---

## 9. Providers and the hackathon hooks

**Settings → Model** keeps granted's three modes verbatim:

| Mode | How | Privacy line shown in Settings |
|---|---|---|
| **Local (Ollama)** | `npm run setup:local` picks a model by RAM; any OpenAI-compatible server via `LLM_BASE_URL` | "Nothing leaves this computer." |
| **Cloud** | Anthropic · OpenAI · Gemini · OpenRouter · Groq · Mistral · other | Provider's note + "Your description is sent to <provider>. Don't include names or record numbers." |
| **Free Claude Code proxy** (`fcc`) | loopback `http://127.0.0.1:8082`, bearer token from `~/.fcc/proxy_auth_token` | **Stronger than granted's:** "Your description is forwarded to free third-party providers that may log or train on it. Do not enter anything that identifies a real person." Shown as a confirm dialog the first time FCC is selected, not just a note. |

Setup flow stays: `npm run setup` (cloud) / `npm run setup:local` (Ollama) / Settings UI.
`.env.example` documents `LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`LLM_BASE_URL`, `SEARCH_EMBEDDINGS`, `CORPUS_MAX`, and the FCC pair.

**Deferred to phase 5 — but leave the seam:** Pass A is already an interface
(`PassAScore[]` from a function). Name that interface `PassAScorer` so an OpenAI
**Decisions API** scorer (one `score` question per candidate, ≤400 per request) and an
**Agents API** "handoff packet" drafter can be added behind flags without touching
`twoPass.ts`. Do not implement them now.

---

## 10. macOS install and run (phase 1 deliverable)

Mirror granted's macOS path exactly, renamed:

1. One-liner: `bash -c "$(curl -fsSL https://raw.githubusercontent.com/KurtLehnardt/triallight/main/install-macos.sh)"`
   — installs Node 22+ and git (Homebrew → fallback to Xcode CLT + nodejs.org pkg), clones
   to `./triallight`, `npm ci`, downloads the built-in embedding model, installs Ollama by
   the method the macOS version supports (incl. the CLI-tarball path for ≤13). Idempotent.
2. `cd triallight/scaffold && npm run build && npm run start` → `http://127.0.0.1:5556`
   (pick a port that doesn't collide with granted's; put it in one constant).
3. `bash scripts/macos/applications-launcher.sh install --add-to-dock` → `~/Applications/TrialLight.app`,
   per-user LaunchAgent `com.triallight.server` (RunAtLoad off, no KeepAlive), menu-bar
   icon with Open / status / Show log / Restart / Quit, app-mode Chrome/Edge window,
   settings at `~/Library/Application Support/TrialLight/settings.json`.
4. `scripts/macos/uninstall.sh` removes all of the above and nothing else.
5. The 12 golden-set patients double as the **demo searches that work with no key**
   (granted ships 4 precomputed samples; ship `data/precomputed.json` for at least 3 of
   ours so the first launch shows real results instantly).

README: rewrite granted's README structure for TrialLight — Quick links · Install on
macOS (GUI installer row says "coming in a later release") · Windows / Linux sections kept
as **"same commands; installers in a later release"** stubs · What you need · Which local
model · How search works · How it works (two stages, four buckets, safety invariants) ·
Privacy · Troubleshooting · **"This is not medical advice"** near the top, not buried.

---

## 11. Requirements checklist (the planner turns this into R-IDs; every row is testable)

| ID | Requirement | Acceptance criterion |
|---|---|---|
| R-001 | Study contract | `lib/contracts/study.ts` zod schema parses a fixture of 5 real NCT records and rejects one missing `id` |
| R-002 | CT.gov fetch | `npm run data:fetch` writes raw pages for the seed list; unit test mocks one page and asserts pagination follows `nextPageToken` |
| R-003 | Normalize | `npm run data:normalize` → `data/studies.json`; test: an `AVAILABLE` record keeps `studyType=EXPANDED_ACCESS`; a `COMPLETED` record is dropped |
| R-004 | Embed + ship | `data/vectors/` builtin vectors exist for every study; `npm run data:embed:builtin` is incremental (unchanged ids skipped — test with a 2-record diff) |
| R-005 | Patient profile contract | `patientProfile.ts` schema; test: `ageYears` missing → invalid; `fillingOutAs` enum enforced |
| R-006 | Profile extraction never infers identity fields | Test: extraction output containing `ageYears`/`sex`/`location` is discarded for those keys; user-stated values win |
| R-007 | Hard filters | Pure functions with tests for each rule in §6 Stage 1 (age edge at exactly min/max, sex ALL, radius 50 mi haversine, expanded-access toggle, healthy-volunteers drop) |
| R-008 | Stage-1 retrieval | `/api/match` returns ≤60 provisional candidates with no LLM configured; test asserts quotas (≥3 expanded-access when ≥3 survive) |
| R-009 | Stage-1 latency | Integration test: warm corpus of ≥2,000 studies → provisional results in <2,000 ms on CI hardware (assert, with a generous skip on first cold load) |
| R-010 | Pass A / Pass B reuse | `twoPass.ts` unchanged (diff-empty check in gate scope); new prompts registered; `npm run check:prompts` green |
| R-011 | `PassAScorer` interface | Pass A is called through a named interface; a fake scorer in tests drives promotion |
| R-012 | Four buckets + invariants | Tests: model-inferred fact cannot yield `excluded`; LLM `unmet` criterion → `conditionally_eligible`; LLM error → `unknown`, candidate still present |
| R-013 | Freshness | Study with `lastUpdatePostDate` > 24 months → `stale: true`, still shown; closed status never in results |
| R-014 | Streaming results | SSE events arrive in order provisional → passA → passB; existing `progressEvent.ts` contract reused |
| R-015 | StudyCard | Renders bucket pill, score, nearest site + distance, contacts with `tel:`/`mailto:`, collapsed verbatim criteria (component test) |
| R-016 | Call script | Present for every Pass-B study; templated fallback when LLM field empty (test both) |
| R-017 | Clinician summary | `/summary` print view lists profile + top 5 NCT ids; `@media print` hides nav (snapshot test) |
| R-018 | Nothing-fits path | Zero survivors → redirect panel with palliative-care guidance and CT.gov/NCI links (test) |
| R-019 | Not-medical-advice banner | Present on intake and results pages (component test) |
| R-020 | Profile stays local | Server never persists profile: grep-test that no API route writes profile fields to disk; localStorage "Clear everything" empties keys |
| R-021 | Providers unchanged | `lib/llm/providers.ts` preset list identical to granted's (snapshot); FCC loopback-only http still enforced (existing tests pass) |
| R-022 | FCC confirm dialog | Selecting `fcc` the first time shows the §9 warning dialog; dismissed state stored in settings (test) |
| R-023 | Privacy lines | Each mode shows its §9 privacy string in Settings (test) |
| R-024 | Deletions complete | No file imports from any DELETE module; `npm run typecheck`, `npm test`, `npm run build` green |
| R-025 | Golden set | `evals/golden-set.jsonl` has 12 entries validating against `patientProfile.ts` + expected bucket per listed NCT; ≥5 structured-rule cases |
| R-026 | Eval runner | `npm run eval:quality` runs end-to-end against a fake `PassAScorer` and prints the false-exclusion table |
| R-027 | Precomputed demos | ≥3 golden patients have `data/precomputed.json` entries; fresh clone with no key renders them |
| R-028 | install-macos.sh | Shellcheck clean; dry-run flag prints every step; idempotent re-run test in CI (bash, macOS runner optional) |
| R-029 | macOS launcher | `applications-launcher.sh install/uninstall` round-trips: plist written then removed; settings.json path correct (bash test) |
| R-030 | Port + naming | Single `APP_PORT` constant; no string `granted`/`Granted` remains outside `CHANGELOG`/attribution (grep gate) |
| R-031 | README | Sections in §10 present; "not medical advice" within the first 20 lines |
| R-032 | LAN binding preserved | `npm run dev:lan` and a documented `START_HOST=0.0.0.0` for `start` exist (phase 3/4 need them) |

---

## 12. Out of scope for phase 1 (planner must not schedule these)

Windows/Linux installer scripts beyond stubs · Electron `.dmg` wizard · iOS · Android ·
Tailscale docs beyond one README sentence · Decisions/Agents API scorers · accounts ·
analytics · PDF export library · any new dependency not already in granted's lockfile
unless a task cannot complete without it (then say so at the CHECKPOINT).

---

## 13. Name

Working name **TrialLight**. One constant (`lib/brand.ts`, as granted has) controls it;
renaming later is a one-line change plus the launcher labels.