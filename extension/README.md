# Treatable extension MVP

ClinicalTrials.gov study exploration for patients, with a panel-memory local workflow and a default **fictional OpenAI Decisions/Agents demo** and optional explicitly consented real-data analysis. Version B applies [make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better/tree/main/skills/make-interfaces-feel-better). The standalone web prototype on localhost:5556 is separate and unchanged.

## Current build and setup

Requires Chrome **142+** (the documented `sidePanel.onClosed` event), Node 20+, macOS and Xcode command-line tools for the native Keychain helper.

```sh
cd extension
npm ci
npm run build:all
npm run typecheck
node --import tsx --test tests/*.test.ts
node --test native/test/*.test.mjs
```

From the repository root:

```sh
node extension/native/install.mjs --manifest extension/dist-b/manifest.json
node extension/native/credentials-setup.mjs configure
```

The second command securely prompts in a terminal and writes only the dedicated macOS Keychain item. Never put the key in Chrome, a command argument, environment variable, a configuration file, chat, or logs. [Native/API setup](native/API_SETUP.md) describes the exact permissions and retention limits. Setup does not verify API authorization or make a provider request.

Chrome → Extensions → Developer mode → Load unpacked → choose `extension/dist-b` for B or `extension/dist` for A. Both use the same pinned extension ID and native helper; test only one variant in a Chrome profile at a time. No Chrome installation or switching was performed by the agents. Do not uninstall an existing installation as an implicit switching step. Unpacked switching and real Chrome/native handshake remain unverified.

Built packages: `artifacts/treatable-version-a-current.zip` and `artifacts/treatable-version-b-current.zip` (manifest at archive root). Extract into a dedicated folder before loading unpacked.

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

Fictional operations accept only fixture IDs and fixture-allowlisted public NCT IDs. Real operations accept a separate strict minimized packet; arbitrary free text, page content, prompts, endpoints, credentials and tools are rejected. Real profile searches do not choose the demo studies. The stdio helper has no HTTP listener or Ollama daemon. Fixed TLS provider requests occur only after the applicable explicit consent. Real-data preparation itself makes no provider call.

## Optional real-data analysis

1. Open **Optional real analysis**. Read the embedded Privacy + Health Data Notice to its bottom, check the acknowledgment, then accept for this panel session. Local search and the fictional demo work without acceptance.
2. Explicitly choose a broad age band (including 90+), optional state and sex, 1–6 public condition/symptom labels and 1–2 public studies. The 3,514 labels come from ClinicalTrials.gov's snapshot, not a medical diagnosis ontology. Unknown terms can stay private in local search.
3. **Prepare exact request preview** sends only that minimized packet to the native helper; it does not call OpenAI. The helper pins both API bodies and public tool outputs to a digest and opaque five-minute token.
4. Review the sensitive exact preview and separately confirm the operation to send. Execution contains only the pinned token, digest, operation and current policy receipt; it cannot replace the packet. Every operation consumes its own confirmation and can run only once per prepared token. Any form or selection change discards the preview and confirmation.
5. End/hide/close clears packet, acknowledgment, tokens, previews, results and traces in panel memory. A fresh session needs fresh policy acceptance. Already sent data cannot be retracted by clearing this panel.

Exact age, ZIP, coordinates, notes, DOB, names and patient contact details are excluded. Explicit health labels, state and age bands are still sensitive and potentially identifying: **minimized is not anonymous**. No HIPAA compliance or legal sufficiency is claimed; see [HHS de-identification guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html). UI/native public corpus hashes must match at build time.

Operator: **Kurt Lehnardt - Developer of Treatable**. Privacy contact: **privacy.6vpc5@mailer.me**. This notice information is local product text, never model input. Contact details have not been independently verified. No patient request/identity history is retained to locate prior provider records.

## Session end and limits

**End session**, panel page-hide, hidden-document events, Chrome panel-close events and context unload request clearing and native disconnection. Closing any Treatable panel deliberately ends all registered panel sessions. Reopened/ended panels require a blank session. Each panel owns its native connection; there is no global patient/native session.

These are application lifecycle controls, **not forensic memory erasure**. Same-user malware, an administrator, a compromised browser/OS, swap/crash data, website cookies/history, and arbitrary debugging are outside this guarantee. Actual Chrome close/hide and keyboard behavior have not been integration-tested here because the browser-control connection was unavailable.

Agents keeps provider state until deletion and is not a zero-data-retention endpoint. The helper attempts bounded deletion after completion/cancellation. Deletion may fail; physical cleanup may be asynchronous; creation loss before receiving a session ID may leave unconfirmed state. Default abuse-monitoring retention may include content for up to 30 days, subject to legal exceptions. API data is not used for training by default. Explicitly confirmed minimized real health information may be sent through the optional real path. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). [Provider details](native/API_SETUP.md).

## Verification

The combined real-consent checkpoint passes 49 extension tests, 21 native tests, typecheck and both builds. Gates include scroll/checkbox, exact-token, expiry, one-use, canary and lifecycle regressions. Tests include legacy deletion failure, real-profile canary non-egress, no storage reads/writes, malformed messages, distinct panel ownership, real close-event handlers, stale result suppression, form submission, preview/consent and cleanup failures. Provider tests use stub transports; **no live API key/access or actual Chrome installation is verified**. Fresh independent source and automated-boundary review passed; see [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

[North star and 3-minute demo](NORTHSTAR.md) · [Version B design evidence](VERSION_B_REVIEW.md)

Decisions and Agents are independent operations over the same selected case (fictional by default, explicitly consented real packet optionally). The interface joins their display by NCT ID; the Agents task does not consume Decisions scores. No derived-score cache or caller-supplied scores exist.
