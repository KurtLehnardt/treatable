# Treatable phase-one build report

Validated locally on 2026-10-23 (America/Boise). New project: `/Users/LenovoT440p/work/treatable`. Feature delivery branch: `codex/phase-one`. No remote repository was created, no code was published, and no PR/main merge occurred.

## Delivered scope

US-only clinical-study finder adapted from Granted. OpenAI is the exposed cloud provider; local Ollama and no-model search are available. All phase-one screens, offline retrieval, contact/print paths, macOS launcher/menu-bar/install scripts, and synthetic safety fixtures are implemented. OpenAI/local explanation quality is separate from deterministic structured eligibility checks.

- 2,000 distinct real ClinicalTrials.gov records; source provenance, freshness, contacts and US sites retained. Includes five expanded-access records in the fetched snapshot.
- Genuine pinned nomic 768-dimensional vectors for every record, with content/model/config invalidation. The clinical embedding configuration uses128tokens and matching query/document prefixes. All vectors and source hashes validate.
- 41,488 GeoNames US ZIP-area centers resolve location locally, including leading-zero ZIPs and ZIP+4. Unknown locations remain unknown; approximate distances are labeled.
- Patient profile stays in browser storage; server routes do not log/cache/persist it. OpenAI requires explicit consent. Local endpoint overrides must remain loopback.
- Every failure/stop path preserves candidates. Nearest-site text is paired with the same distance calculation. Stopped, failed, or incomplete streams settle all matching rings.

## Verification evidence

- Source baseline:2,116tests/342suites passed before domain adaptation.
- Final retained suite before the last targeted SSE completion fix: **1,550tests/255suites,1,550pass,0fail,0skip,0cancel**,9.09s. Exact output: `/private/tmp/treatable-final-tests.log`.
- Last SSE fix: focused **3/3** regressions passed (manual abort, SSE error then normal EOF, and incomplete EOF), preserving IDs/order/scores/buckets and clearing provisional flags. Typecheck passed afterward.
- `npm run check:prompts`: passed; no inline prompts or definitive eligibility claims.
- `npm run eval:quality`: **12fictional profiles,0false exclusions,0bucket mismatches**.
- `npm run typecheck`: passed. Production build passed after required cleanup; canonical final build/runtime evidence is recorded below after assembly.
- Pinned real-model integration verifies a known reference query and fresh embeddings for three shipped study records against their committed vectors at cosine>0.999.
- No-key warm2,000-record deterministic search is asserted<2,000ms. Domain real semantic measurements:990ms cold,54ms/48ms warm; hosted CI latency has not been run.
- Platform:2isolated-HOME launcher/dry-run tests passed; shellcheck clean; native Swift release menu-bar build passed (11.73s). No launcher/Ollama was installed into the user's actual account by verification.
- Local chat smoke: isolated Ollama0.32.1 and qwen2.5:0.5b produced a valid two-candidate adapter result in552ms, retained all IDs and contact templates. Tiny-model narrative quality was poor, so fallback templates remained. A larger local model request timed out; default RAM-based setup choice was preserved. Evidence:`/private/tmp/treatable-local-smoke.json`.
- Standalone locked dependencies installed using `npm ci` in canonical `scaffold/node_modules`; runtime no longer depends on fundFinder's node_modules. Downloaded search weights are preserved under ignored `scaffold/models`.

## Requirement traceability

PASS means implemented and locally tested; PARTIAL marks a verification/deployment boundary rather than hiding it.

| ID | Status | Evidence / limit |
|---|---|---|
| R-001 | PASS | Study zod contract; five live-source fixtures parse; missing NCT ID rejected (`clinical.test.ts`). |
| R-002 | PASS | CTgov fetch script, serial retries, source pages, pagination token test. Live initial fetch completed. |
| R-003 | PASS | Normalizer retains AVAILABLE expanded access, drops COMPLETED, retains US sites. |
| R-004 | PASS |2,000vectors, pinned config/hash coverage and actual-model sample comparison; incremental content/model/config tests. Search-model download remains a setup requirement for a fresh clone; keyword search works without it. |
| R-005 | PASS | Patient schema rejects missing age/invalid actor; required diagnosis-or-symptom/location checks. |
| R-006 | PASS | Extraction cannot overwrite user-stated age, sex, or location; explicit UI button. |
| R-007 | PASS | Structured age/sex, closed status, unknown fields, distance preference, healthy-volunteer semantics and expanded-access tests. |
| R-008 | PASS | No-key provisional results capped60 with3expanded-access/3observational slots when available. |
| R-009 | PARTIAL | Local2,000record timing passed; real semantic warm timing recorded. Hosted CI hardware timing not executed. |
| R-010 | PASS | Shared promotion floor preserved through study adapter; registry checks pass; failures retain candidates. OpenAI calls currently use one configurable model across both passes. |
| R-011 | PASS | Named injectable PassAScorer; fake scores exercise promotion. |
| R-012 | PASS | Four buckets; model/free-text unmet cannot exclude; failures retain candidates; stopped/incomplete streams settle rings. |
| R-013 | PASS | Closed records hidden, records>24months flagged and retained. |
| R-014 | PASS | Provisional→passA→passB→complete SSE, source API tests and browser client. |
| R-015 | PASS | Render tests for contacts, exact collapsed criteria, score/status/bucket; nearest-site regression. |
| R-016 | PASS | Five-line patient-aware fallback and model call-script handling tested. |
| R-017 | PASS | Session-only summary/top5/print CSS; final rendered inspection performed independently. |
| R-018 | PASS | Empty results show care-team/palliative-care guidance and CTgov/NCI links. |
| R-019 | PASS | Standing medical notice appears on intake/results/summary. |
| R-020 | PASS | No-retention guards, route tests, explicit consent, local ZIP/model paths, browser clear-all; no telemetry. |
| R-021 | PARTIAL | OpenAI/local/no-model implemented; cloud request contract tested without a live key. Local runtime was smoke-tested; chat weights are downloaded by setup, not bundled in Git. |
| R-022 | PASS | OpenAI consent control and API enforcement replace deferred FCC confirmation. |
| R-023 | PASS | Truthful local/OpenAI/download privacy copy and missing-model fallback. |
| R-024 | PASS | Explicit competitor/strategy/readiness/analytics/accounts/state-fetch/awards paths removed; their obsolete tests removed with named modules. Provider/security/shared algorithm tests retained; clinical tests replace old corpus/cache tests. Some funding-era compatibility helper types/tests remain for preserved algorithms; no active clinical route uses the removed funding APIs. |
| R-025 | PASS |12fictional golden profiles validate and cover requested structured safety cases. |
| R-026 | PASS | Deterministic quality runner exits nonzero on mismatch/false exclusion; all12pass. |
| R-027 | PASS |3fictional precomputed demos contain real source studies and work without a key. |
| R-028 | PARTIAL | Installer dry-run/idempotence fixtures and shellcheck pass; real fresh-machine prerequisite install not executed. |
| R-029 | PASS | Isolated-HOME launcher install/uninstall round-trip; Swift menu-bar build. Actual user's Applications/LaunchAgents untouched. |
| R-030 | PASS | Central5556runtime constant, active branding/config namespaces adapted; source attribution/deferred assets documented. |
| R-031 | PASS | README contains required sections and prominent medical notice. |
| R-032 | PASS | Loopback default, dev:lan and START_HOST=0.0.0.0 retained/documented. |

## Limits and follow-up

- This registry snapshot is a starting point, not all US studies. Recruitment and contact details require study-team confirmation.
- No real patient data was used. Safety fixtures are deterministic engineering checks, not clinical validation of matching quality.
- Live OpenAI inference was not run because no new credentials were copied or supplied. Full OpenAI-embedding agreement needs a separately generated OpenAI-space corpus; `eval:builtin` currently reports local-semantic/keyword overlap and labels that limitation.
- Local narration depends on the installed model/hardware; the tiny smoke-test model has limited narrative quality. Local chat weights are downloaded by setup rather than committed/bundled.
- Existing dependency versions were preserved. `npm ci` reported7inherited audit findings (3moderate,3high,1critical); dependency upgrades require a separate verified change.
- Root installer/legacy Windows assets remain deferred. App publishing, fresh-machine distribution, live cloud credentials, and clinician acceptance remain unperformed.

## Canonical runtime

Final canonical build, branch commit, detached server PID/log, HTTP smoke, and independent rendered-review evidence are appended after assembly. This report does not substitute for those checks.
