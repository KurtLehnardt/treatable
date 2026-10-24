# Treatable north star — hackathon MVP

## Objective

A patient can understand which public clinical studies are worth asking about, see source evidence and unknowns, and watch real OpenAI Decisions and Agents API work on an explicitly fictional example. Private free-text profiles remain local; optional real analysis requires a scroll-gated notice and separate exact-payload confirmation for explicitly selected minimized health fields.

Deadline: **October 24, 2026, 3:00 PM Mountain Time (America/Boise)**. Presentation: **3 minutes**.

## Judging rubric

| Category | Points | Concrete evidence |
|---|---:|---|
| Working demo | 30 | Actual Decisions input → validated score → Agents task → observed evidence tool → bounded result and cleanup trace |
| Usefulness | 25 | Public clinical records, visible unknowns, meaningful study-team questions, local condition/age/ZIP screening |
| Tool use | 25 | Actual `get_public_trial_evidence` calls with fixed allowed NCT IDs and returned public evidence |
| Technical execution | 10 | Exact site permissions, deletion-gated volatile sessions, typed stdio bridge, Keychain, strict output/timeout/cancellation gates |
| Presentation | 10 | Calm Version B hierarchy, clearly fictional input, understandable score semantics, concise result and honest limitations |

## Non-negotiable boundaries

- Exact named ClinicalTrials.gov hosts only; no generic prompt/URL proxy.
- No browser patient-profile persistence. Delete legacy own-extension keys without reading them before entry is enabled.
- No raw private profile, notes, exact age/ZIP/coordinates, DOB, names or contact details in API payloads. Optional minimized real data needs current policy acceptance and a pinned exact preview; sensitive previews/traces exist only in panel memory, never logs or caches.
- Fictional fixtures remain default. Optional real operations use explicit public condition IDs, age band/optional state/sex and up to two native public-corpus NCTs; execute accepts only a one-use token/digest/operation/current receipt. No replacement packet is accepted.
- Credentials exist only in the dedicated native Keychain item and transient native memory. No secret in browser/manifest/configuration/arguments, no inherited API-key/proxy routing.
- LLM outputs cannot alter deterministic clinical facts. Render allowlisted evidence/template IDs and relevance indices, not model medical advice.
- API errors, permission denial, missing tool calls, incomplete streams, cancellation and deletion failures remain honest failures. No fabricated live mode or API-name substitution.
- This is not an absolute prompt-injection, OS malware, browser-memory or forensic-erasure guarantee.

Operator: **Kurt Lehnardt - Developer of Treatable**. Privacy contact: **privacy.6vpc5@mailer.me**. These are notice-only, never model input. Minimized health information is not anonymous.

## Worker responsibilities

- Input-validation worker: strict forms, canonical source records, cross-context reply validation and UTF-8 budgets.
- Privacy/UI worker: deletion-only migration, panel memory, session ports, explicit consent/preview/trace, A/B interfaces and lifecycle tests.
- Native/API worker: real documented Decisions/Agents contracts, fixed public tools, Keychain setup, bounded provider cleanup and native protocol tests.
- Independent reviewer: fresh combined security/data-flow/API review and meaningful regressions. Prior visual-only review is not a security approval.

## Three-minute live runbook

Before presentation: build both variants; install the native helper; configure a dedicated Keychain API credential through its terminal prompt; verify account/model permissions with one explicitly consented fictional run. Never paste a key into Chrome or chat. If access is unavailable, say the live path is blocked rather than showing tests as live.

| Time | Action |
|---|---|
| 0:00–0:25 | Open B on ClinicalTrials.gov. Show the fictional banner and exact compiled/public input preview. Explain that real patient forms are separate and local. |
| 0:25–1:10 | Consent and run Decisions scoring. Show real request/completion stages and the fictional relevance index; explicitly say it is not enrollment probability. |
| 1:10–2:10 | Run Agents task. Show evidence-tool request/results for the two public records, then template-based comparison/questions. |
| 2:10–2:40 | Show session cleanup outcome and the incomplete-snapshot/clinical-unknown boundaries. A failed deletion stays visible. |
| 2:40–3:00 | Show local patient screening and End session. Explain no save/remember, deletion-only compatibility cleanup and the browser/OS limits. |

API latency may vary. One fixture and two public records, short schemas, six-tool limit and bounded timeouts keep the presentation focused; these are not a provider billing cap.

## Verified versus not verified

Verified in automated tests: typed framing and bounds; fixed fictional/API payloads; strict source IDs; key redaction; actual session-event handlers in built code; panel-only canaries; abort/delete failure reporting; trusted template rendering.

Not verified here: actual account/API access, live provider execution, Chrome installation/rendered/native handshake, real Chrome hidden/close timing and autofill behavior, or forensic removal from OS/browser memory. Tests use explicit test-mode transports, never fake live completion.

Decisions and Agents are independent operations over the same selected case; the timed demo uses the fictional fixture. The interface joins their display by NCT ID; the Agents task does not consume Decisions scores. No derived-score cache or caller-supplied scores exist.

Optional real walkthrough (outside the three-minute fictional demo): scroll through the health-data notice, acknowledge and accept in memory, select public terms/studies and minimized fields, prepare without a provider call, inspect both exact request bodies, confirm each selected operation, inspect result/cleanup and End session. Declining leaves local search and fictional demo available.
