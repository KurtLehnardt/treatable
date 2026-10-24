# Treatable north star — hackathon MVP

A patient searches ClinicalTrials.gov through Treatable’s Version B overlay, reviews fresh public records for the loaded results, explicitly consents to a minimized profile, and applies validated relevance scores to the actual website cards. Decisions scores topical relevance; Agents independently reads bounded public evidence and selects questions for the study team.

Deadline: **October 24, 2026, 3:00 PM Mountain Time (America/Boise)**. Presentation: **3 minutes**.

## Judging evidence

| Category | Points | Evidence to show |
|---|---:|---|
| Working demo | 30 | Website search → loaded cards → exact minimized API input → validated result → actual card reorder and score frames |
| Usefulness | 25 | Patient-facing filters, current public records, visible unknowns and useful study-team questions |
| OpenAI tools | 25 | Real Decisions request/result; real Agents task with observed `get_public_trial_evidence` calls and template-based output |
| Technical quality | 10 | Input errors, missing record/API failure handling, protected consent, current-page binding and cleanup status |
| Presentation | 10 | Explain the user, problem, outcome and remaining limitations within three minutes |

## Acceptance checks

- Toolbar opens the overlay only on the two named Gov HTTPS hosts; no global side panel. Version B is `extension/dist`; `dist-b` is the compatible B copy and `dist-a` the A reference.
- A submitted query opens the registry’s search URL. All 28 logical filter fields are present; advanced sections start collapsed. US ZIP uses approximate offline coordinates; unresolved address/city/state/country location requires the website’s controls and is never falsely marked applied.
- Card discovery accepts only a verified list layout and strict public NCT IDs. Ten loaded studies is the matching ceiling. Larger pages are refused before API analysis; no partial page is reordered.
- The protected registered matching window fetches all current records from the official API. Snapshot corpus limits do not apply to this path. Source/query/profile changes invalidate analysis.
- The scroll-gated notice, acknowledgment and separate exact-payload confirmation precede real data transmission. Exact request JSON starts collapsed. No exact age, ZIP, coordinates, notes, DOB, name or patient contact is sent.
- Decisions accepts only validated score output. Agents has one bounded public-evidence function, no shell/files/browser/MCP tools, and returns IDs rendered through trusted templates. It does not consume Decisions scores.
- Apply accepts a validated analysis ID rather than caller-supplied scores, moves real cards only when every loaded card is scored, preserves ties/focus, and overlays scores inside extension-origin frames. Known structured age/sex mismatches cannot be hidden by topical scores.
- Restore, End, hidden pages, navigation, lease expiry and lost connections remove badges and restore still-connected cards. Raw private state ends with the protected window; only explicitly applied derived scores remain in tab-bound RAM for at most five minutes.
- Native stdio, dedicated Keychain credentials, fixed TLS endpoints, no patient persistence/telemetry/cookies/localhost inference server, and explicit cleanup failures remain intact. Clearing state does not claim forensic erasure or absolute prompt-injection protection.

Operator: **Kurt Lehnardt - Developer of Treatable**. Privacy contact: **privacy.6vpc5@mailer.me**. Notice details are never model input. Minimized health fields remain sensitive and potentially identifying.

## Before the presentation

1. Run the [README gates](README.md) and build Version B. Install `extension/dist`; reload the extension and refresh the Gov tab.
2. Install the native helper using a functioning Node 20+ runtime, then configure the dedicated Keychain key through its hidden terminal prompt. The installer pins that executable; an old broken Node pin must be repaired by rerunning the installer. Never paste a key into Chrome or chat.
3. Verify account/API access through the toolbar → current results → protected matching window using a **clearly fictional entered profile** and public studies. State aloud that the example is fictional. The transport is the real-analysis path and its preview labels that path accordingly; do not claim it is a compiled fictional fixture. Inspect the preview and explicitly confirm at most one Decisions batch and one Agents task initially. `test` results cannot stand in for `live` success. Missing credentials or API permissions are blockers, not successful demos.
4. Rehearse the same website path: search, 10-card detection, protected window, full Decisions result, Agents evidence calls, Apply, badges, Restore and End. Keep fictional example inputs throughout rehearsal. Real patient use requires that person’s explicit notice and payload consent; do not send another person’s health details for a demo.
5. Check native/API and Chrome proof separately. Automated transports, an HTML preview and public bundle inspection cannot prove installed browser behavior.

## Three-minute website walkthrough

Use a clearly fictional entered profile, identified as fictional to the audience. Preflight includes the full privacy notice and explicit consent with the presenter. Never skip those gates in the product. Network latency may require a brief prepared recording clearly labeled as such; do not present recordings or test output as a live request.

| Time | Action |
|---|---|
| 0:00–0:25 | Explain the patient and problem. Open Treatable on Gov; submit a condition and show the website’s own results and detected-card count. |
| 0:25–1:05 | Open private matching. Show the minimized packet summary, exact input on demand and explicit operation confirmation. Run Decisions; explain relevance is not eligibility or enrollment probability. |
| 1:05–2:05 | Run the independent Agents review for one or two studies. Show actual public-evidence tool calls and rendered study-team questions. |
| 2:05–2:40 | Apply the complete score map. Show actual card movement, private score frames, known mismatches/unknowns and Restore original order. |
| 2:40–3:00 | Show cleanup outcome and End page matching. State 10-card/current-page scope, address handoff and unconfirmed clinical eligibility. |

The older panel source retains compiled fictional fixtures and two fixed public records for API boundary tests. Its access route from the new toolbar has not been verified; the walkthrough above does not depend on that reference panel.

## Evidence ledger

At `e95f8d0`, recorded automated gates pass: **116 extension tests, 52 native tests, typecheck and all three builds**. They cover strict framing, query/filter encoding, consent/token replay/expiry, current-page/result binding, scoped runtime handlers, DOM-node reorder logic, failure reporting, canary non-egress and visible-session/derived-score lease expiry.

Direct native runtime checks pass: repaired installed stdio status, public Gov `liveCatalog` fetch for `NCT06567886`, and 14/14 installed native/shared source parity. After the user securely configured the key, metadata reports `configured: true`. A bounded authorized fictional-profile smoke made exactly one Decisions request and one Agents task. Decisions returned a validated live score. Agents completed one required public-evidence call and valid study/template output, but bounded cleanup produced no validated deletion acknowledgment; provider-state deletion is **unconfirmed** and the underlying cause is unknown. No additional authenticated diagnostic calls were made.

Not yet demonstrated by those checks: actual Chrome mounting/positioning/keyboard behavior, current Gov rendered card compatibility, the Chrome-to-native handshake, successful Agents deletion cleanup, real Chrome close/hide timing, browser autofill behavior or forensic memory removal. API task success does not establish cleanup success. See [native setup](native/API_SETUP.md) for the exact runtime evidence and limits.

Agents application state remains until deletion; cleanup is bounded and may fail. No ZDR, HIPAA compliance, anonymity or instant physical deletion guarantee is claimed. Public source records and recruitment can change. Broader literature/researcher views and automatic applications are outside this iteration.
