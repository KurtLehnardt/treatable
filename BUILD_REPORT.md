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
- Final retained suite after reviewed security fixes and compatible dependency patches: **1,561tests/255suites,1,561pass,0fail,0skip,0cancel**,9.09s. Exact output: `/private/tmp/treatable-final-tests.log`.
- SSE completion regressions passed (manual abort, SSE error then normal EOF, incomplete EOF), preserving IDs/order/scores/buckets and clearing provisional flags. The Stop button settles results synchronously to avoid abort timing races.
- Both new paid/patient endpoints enforce same-origin loopback checks, JSON content type, body-size bounds, rate limits, and explicit OpenAI consent. Cross-site text/plain JSON cannot invoke a saved-key provider. Focused endpoint/security/stream tests passed; independent reviewer reran20focused checks successfully.
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
| R-017 | PASS | Session-only summary/top5/print CSS and render tests. Prior rendered review performed; final fixed-build rendered recheck was unavailable (see limits). |
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
- Compatible security patches were applied: Zod4.6.7 (requested range^4.6.6) and source-map-js1.2.2. Final `npm ci` reports5remaining audit findings (3moderate,1high,1critical). Next14 remains on the inherited major; the unused image optimizer is disabled and returns404. See the advisory-surface matrix below. This is not a zero-vulnerability claim; upgrade the framework before public/untrusted-LAN/Windows distribution.
- Root installer/legacy Windows assets remain deferred. App publishing, fresh-machine distribution, live cloud credentials, and clinician acceptance remain unperformed.

## Canonical runtime

- Canonical project: `/Users/LenovoT440p/work/treatable`, feature branch `codex/phase-one`. Production code commit `8965fa8` (subsequent commits only append verification documentation).
- Own locked dependencies installed with `npm ci`; canonical production `npm run build` passed, including type validation and all11static generation steps. No build skip flags.
- Local app: `http://127.0.0.1:5556`, bound only to127.0.0.1. Detached npm process PID55118, log `/private/tmp/treatable-server.log`, PID record `/private/tmp/treatable-server.pid`. The process is independent of worker tool sessions.
- Homepage HTTP200; `/_next/image?url=%2Ficon.svg&w=64&q=75` returns404; compiled Server Actions manifest has0node/0edgeactions (no encryption key copied into this report).
- Canonical search status: builtin, ready,2,000/2,000vectors. Verified ignored search assets: `/Users/LenovoT440p/work/treatable/scaffold/models/nomic-ai/nomic-embed-text-v1.5`.
- Independent final HTTP/API smoke: ordinary non-demo ZIP83702 resolves to Boise43.6322,-116.2052;60candidates have known distances,59are outside the selected radius,0remain provisional; SSE provisional→complete; corpus2,000; builtinsemanticmode. Both paid routes reject cross-site requests403, wrong content type415, and missing OpenAI consent403.
- Final rendered fixed-build browser/screenshot recheck was unavailable because the CUA context failed and one permitted reset did not recover it. No alternate-browser bypass was attempted. Prior rendered review, focused UI regressions and final independent HTTP/API checks provide the recorded evidence; no final screenshot is claimed.
- Source Granted working tree remains clean. Manual git worktrees `codex/domain` and `codex/foundation` are retained for inspection; they are not Codex-managed attachments. Needed search model assets and standalone dependencies are preserved in canonical paths. No credentials, environment files, private logs or patient state were copied.

## Remaining dependency-advisory surfaces

Independent reviewer inspected the primary descriptions for all25Next advisory entries in the audit result. Mitigations reduce active local surfaces; they do not remove the package-level findings.

| Surface | Current handling | Primary evidence |
|---|---|---|
| SVG/AVIF image optimization | No remote images or image component; `images.unoptimized=true`; optimizer runtime404. | [SVG advisory](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [AVIF advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) |
| Windows optimizer paths | Windows distribution deferred; framework upgrade required before enabling it. | [Windows advisory](https://github.com/advisories/GHSA-p293-qw3h-jr36) |
| Server Actions/RSC action deserialization and disclosure | No `use server`/`use cache` actions; compiled node/edgeaction manifests empty. No custom action server or Edge runtime. | Independent primary-advisory review + compiled manifest counts. |
| Rewrite, dynamic-host, middleware and i18n paths | No rewrites/redirects/middleware/i18n configured. | Current next.config and source inventory. |
| CSP nonce, beforeInteractive scripts and shared-cache variants | No nonce integration, beforeInteractive script or shared production cache; patient APIs use no-store. | Current config/source/API headers. |
| WebSocket proxy SSRF | No WebSocket feature; server binds loopback by default. Do not expose this inherited framework on public/untrusted networks; a major upgrade remains required. | [WebSocket advisory](https://github.com/advisories/GHSA-c4j6-fc7j-m34r) |
| Nested PostCSS/source-map parser build paths | Source-map-js patched; remaining nested PostCSS/parser paths process trusted project CSS, with no untrusted CSS/map pipeline. Compatible fixes/major framework work remain follow-up. | [PostCSS advisory](https://github.com/advisories/GHSA-6g55-p6wh-862q), [map advisory](https://github.com/advisories/GHSA-r28c-9q8g-f849), [parser advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) |

