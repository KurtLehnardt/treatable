# Treatable phase-one acceptance checklist

User-approved scope: every phase-one feature together; US-only; OpenAI is the phase-one cloud provider; ship the local Ollama path too. Claude, FCC, and other cloud presets are deferred. Name Treatable; port 5556. Baseline Granted source: `d6e143abfbd57d1f80dc8cf15010e5fa3d87f832`.

The following amendments supersede conflicting source-spec clauses:

- R-003/R-007/R-012: closed studies are excluded from availability; explicit age/sex incompatibility remains visible as Unlikely with a structured reason; distance is a separate preference and out-of-radius section. Missing fields never exclude. `healthyVolunteers=true` alone never establishes healthy-only population.
- R-004: vector cache invalidates on content or model changes, not just study IDs. No-key/offline retrieval falls back to BM25 if query embeddings are unavailable. Shipped real corpus target remains 2,000–8,000 with builtin vectors.
- R-010/R-011: preserve two-pass promotion/fallback behavior; typed adapters and necessary contract updates are allowed. Pass A remains injectable through PassAScorer.
- R-012: model-inferred facts and free-text criteria cannot cause Unlikely; model unmet criteria route to Ask the study team. Model error preserves candidates/rank and reports unknown.
- R-015/R-019/R-030: Treatable branding; bucket label Matches what you told us; explanatory language states structured matching does not establish eligibility.
- R-020/R-023: local mode keeps patient content local throughout embeddings/model/map paths; cloud requires explicit consent. No patient text in server logs, disk, telemetry, or persistent result caches. Clear-all wipes browser patient data/current results.
- R-021/R-022/R-023: enable only OpenAI cloud and local Ollama in phase one; FCC warning/preset parity requirements are deferred along with FCC, rather than shipping misleading controls.
- R-025/R-026: deterministic false-exclusion and safety invariants must pass with zero failures. Broader embedding/relevance comparisons may remain informational.
- R-028/R-029: macOS install/launcher/menu-bar/uninstall all ship. No execution of real install/uninstall against the user's account during verification; use sandbox homes/dry-runs.
- R-030: installer/ is deferred source, so legacy names there are exempt from the active-app branding gate along with attribution/history.
- No future product API names/limits are assumed; leave generic scoring seams only.

All remaining source acceptance criteria below remain in scope. Verification commands are derived from package.json, not executed from the pasted spec. Team works in isolated Git worktrees and opens a PR if hosting is authorized/configured; never pushes main or merges on the user's behalf.

| ID | Requirement | Acceptance criterion |
|---|---|---|
| R-001 | Study contract | `lib/contracts/study.ts` zod schema parses a fixture of 5 real NCT records and rejects one missing `id` |
| R-002 | CT.gov fetch | `npm run data:fetch` writes raw pages for the seed list; unit test mocks one page and asserts pagination follows `nextPageToken` |
| R-003 | Normalize | `npm run data:normalize` → `data/studies.json`; test: an `AVAILABLE` record keeps `studyType=EXPANDED_ACCESS`; a `COMPLETED` record is dropped |
| R-004 | Shipped local vectors | Every shipped study has a 768-dimension pinned builtin vector with matching content hash/config; unchanged content reuses vectors; content/model/config changes re-embed; keyword search works with no model/key/network. |
| R-005 | Patient profile contract | `patientProfile.ts` schema; test: `ageYears` missing → invalid; `fillingOutAs` enum enforced |
| R-006 | Profile extraction never infers identity fields | Test: extraction output containing `ageYears`/`sex`/`location` is discarded for those keys; user-stated values win |
| R-007 | Structured screening | Age boundaries and sex compatibility produce cited Unlikely reasons; missing data never excludes; distance is separate; expanded-access preference is honored; healthyVolunteers=true alone never excludes. |
| R-008 | Stage-1 retrieval | `/api/match` returns ≤60 provisional candidates with no LLM configured; test asserts quotas (≥3 expanded-access when ≥3 survive) |
| R-009 | Fast provisional results | A warm 2,000-record corpus emits provisional results in under 2 seconds; test deterministic no-key path and record local semantic timing. CI hardware timing remains to be run in hosted CI. |
| R-010 | Two-pass behavior | Promotion floor and no-drop fallback behavior are preserved through typed study adapters; new prompts registered; check:prompts passes. |
| R-011 | `PassAScorer` interface | Pass A is called through a named interface; a fake scorer in tests drives promotion |
| R-012 | Four buckets and safety | Inferred facts never exclude; model-unmet criteria route to Ask; LLM errors preserve all candidates/rank as unknown; deterministic tests pass. |
| R-013 | Freshness | Study with `lastUpdatePostDate` > 24 months → `stale: true`, still shown; closed status never in results |
| R-014 | Streaming results | SSE events arrive in order provisional → passA → passB; existing `progressEvent.ts` contract reused |
| R-015 | Study cards | Render bucket, relevance score, the nearest US site paired with its distance, approximate ZIP-distance label, tel/mailto links, collapsed exact criteria, source date, and stage/failure status. |
| R-016 | Call script | Present for every Pass-B study; templated fallback when LLM field empty (test both) |
| R-017 | Clinician summary | Browser-session summary view lists the profile, top five NCT records, and open questions; print CSS hides navigation and uses compact page layout. |
| R-018 | Nothing-fits path | Zero survivors → redirect panel with palliative-care guidance and CT.gov/NCI links (test) |
| R-019 | Not-medical-advice banner | Present on intake and results pages (component test) |
| R-020 | Patient privacy | Profiles stay in browser storage; API handling never persists/logs patient text; clear-all removes Treatable patient and in-memory/session results. Local embeddings and LLM never send patient text externally. |
| R-021 | Phase-one providers | Search-only, OpenAI, and local Ollama paths work; OpenAI requires explicit consent; Claude/FCC/other cloud providers are deferred. |
| R-022 | Outbound consent | Selecting OpenAI exposes an unchecked consent control; sending patient content is blocked until consent; local/search-only require no outbound consent. FCC is deferred. |
| R-023 | Truthful privacy copy | Settings explains local patient-data routing, setup downloads, OpenAI transmission and key storage accurately; no absolute promise about all network activity. |
| R-024 | Deletions complete | No file imports from any DELETE module; `npm run typecheck`, `npm test`, `npm run build` green |
| R-025 | Fictional golden set | Twelve fictional patient profiles validate, cover requested symptom groups, and include at least five structured age/sex/distance/staleness/healthy-volunteer safety scenarios. |
| R-026 | Safety eval | eval:quality uses deterministic scorer/fixtures, prints false-exclusion table, and fails on any false exclusion or safety-invariant violation. |
| R-027 | Instant demos | At least three clearly fictional precomputed patient demos render real study matches without a key. |
| R-028 | install-macos.sh | Shellcheck clean; dry-run flag prints every step; idempotent re-run test in CI (bash, macOS runner optional) |
| R-029 | macOS launcher | `applications-launcher.sh install/uninstall` round-trips: plist written then removed; settings.json path correct (bash test) |
| R-030 | Port and naming | Single APP_PORT runtime source is 5556; active app, data/config namespaces and macOS launcher use Treatable. Historical/source-spec attribution and deferred installer/Windows assets are exempt. |
| R-031 | README | Sections in §10 present; "not medical advice" within the first 20 lines |
| R-032 | LAN binding preserved | `npm run dev:lan` and a documented `START_HOST=0.0.0.0` for `start` exist (phase 3/4 need them) |
