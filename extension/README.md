# Treatable extension MVP

ClinicalTrials.gov study exploration for patients, with a panel-memory local workflow and a separate **fictional-only OpenAI Decisions/Agents demo**. Version B applies [make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better/tree/main/skills/make-interfaces-feel-better). The standalone web prototype on localhost:5556 is separate and unchanged.

## Current build and setup

Requires Chrome **142+** (the documented `sidePanel.onClosed` event), Node 20+, macOS and Xcode command-line tools for the native Keychain helper.

```sh
cd extension
npm ci
npm run build:all
npm run typecheck
node --import tsx --test tests/*.test.ts
node --test native/test/core.test.mjs
```

From the repository root:

```sh
node extension/native/install.mjs --manifest extension/dist-b/manifest.json
node extension/native/credentials-setup.mjs configure
```

The second command securely prompts in a terminal and writes only the dedicated macOS Keychain item. Never put the key in Chrome, a command argument, environment variable, a configuration file, chat, or logs. [Native/API setup](native/API_SETUP.md) describes the exact permissions and retention limits. Setup does not verify API authorization or make a provider request.

Chrome → Extensions → Developer mode → Load unpacked → choose `extension/dist-b` for B or `extension/dist` for A. Both use the same pinned extension ID and native helper; test only one variant in a Chrome profile at a time. No Chrome installation or switching was performed by the agents. Do not uninstall an existing installation as an implicit switching step. Unpacked switching and real Chrome/native handshake remain unverified.

**Current A and B share the new security policy.** Any original A ZIP retained from the earlier prototype is an archived **PRE-PRIVACY BASELINE — NOT CURRENT** artifact. It includes the former storage behavior and is not the current MVP download.

## Real patient workflow

- The temporary `storage` permission exists only to remove the known legacy `treatable.patient.v1` key from extension local and session areas. The migration does not read stored values or write a migration flag.
- Patient entry and API actions remain disabled until deletion succeeds and the panel's session channel is ready. Failures stay visibly blocked with a retry action.
- Profiles, notes, local search results, captured page text and traces live only in the mounted panel. There is no save/remember control, storage sync, browser-history feature, or patient-data cache.
- Search and structured screening use the bundled 2,000-study snapshot and offline ZIP centroids. The snapshot is incomplete and may become stale. Missing facts stay unknown; a distance preference is not medical exclusion.
- Only exact HTTPS `clinicaltrials.gov` and `www.clinicaltrials.gov` hosts can be read. There is no `activeTab`, all-site, cookies, debugger or web-request permission.
- Form submission is prevented before validation; autofill and spellchecking are requested off. Browser/OS honoring of those requests is not guaranteed.

## Fictional API workflow

1. Open **API demo**, choose one of three compiled fictional fixtures, and inspect the full shared request preview.
2. Explicitly consent to sending that fictional profile and its fixed public study excerpts to OpenAI.
3. Run **Decisions scoring**. The displayed index measures relevance for the fictional profile, not eligibility, enrollment probability, safety or benefit.
4. Run the **Agents task**. It must call the allowlisted `get_public_trial_evidence` tool and return only known study/question/caution IDs. The UI renders trusted templates rather than arbitrary model advice.
5. Inspect the actual in-memory request stages, tool calls, result mode and cleanup status. Stubbed test results say `test`; a live success requires validated provider responses.

The native helper accepts only fixture IDs and fixture-allowlisted public NCT IDs, never a browser-supplied real profile, page text, arbitrary prompt, endpoint, credentials or tools. Real profile searches do not choose the demo studies. The stdio helper has no HTTP listener or Ollama daemon. Fixed TLS provider requests occur only after explicit demo consent.

## Session end and limits

**End session**, panel page-hide, hidden-document events, Chrome panel-close events and context unload request clearing and native disconnection. Closing any Treatable panel deliberately ends all registered panel sessions. Reopened/ended panels require a blank session. Each panel owns its native connection; there is no global patient/native session.

These are application lifecycle controls, **not forensic memory erasure**. Same-user malware, an administrator, a compromised browser/OS, swap/crash data, website cookies/history, and arbitrary debugging are outside this guarantee. Actual Chrome close/hide and keyboard behavior have not been integration-tested here because the browser-control connection was unavailable.

Agents keeps provider state until deletion and is not a zero-data-retention endpoint. The helper attempts bounded deletion after completion/cancellation. Deletion may fail; physical cleanup may be asynchronous; creation loss before receiving a session ID may leave unconfirmed state. Only fictional/public data is sent in this MVP. [Provider details](native/API_SETUP.md).

## Verification

The combined checkpoint passed 42 extension tests, 10 native protocol/security tests, typecheck and both builds. Tests include legacy deletion failure, real-profile canary non-egress, no storage reads/writes, malformed messages, distinct panel ownership, real close-event handlers, stale result suppression, form submission, preview/consent and cleanup failures. Provider tests use stub transports; **no live API key/access or actual Chrome installation is verified**. Independent combined security review follows implementation.

[North star and 3-minute demo](NORTHSTAR.md) · [Version B design evidence](VERSION_B_REVIEW.md)

Decisions and Agents are independent operations over the same compiled fictional case. The interface joins their display by NCT ID; the Agents task does not consume Decisions scores. No derived-score cache or caller-supplied scores exist.
