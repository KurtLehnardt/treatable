# Treatable Chrome extension — local-first patient prototype

> Update: the scoring pipeline branch adds an opt-in OpenAI provider (Decisions API and Agents API) behind a consent screen, and adds `https://api.openai.com/*` to host permissions and CSP `connect-src`. Page reading remains ClinicalTrials.gov-only. See README.md for the current privacy boundaries; statements below describe the earlier local-only build.

## Delivered

- ClinicalTrials.gov only: exact `https://clinicaltrials.gov/*` and `https://www.clinicaltrials.gov/*` host permissions. No activeTab, all-sites, optional all-hosts, or cloud-provider permissions. `sites.json` drives the packed permissions and runtime allowlist.
- Patient profile, offline search over 2,000 real US studies, local ZIP-center distance, deterministic structured age/sex checks, source criteria/contacts/questions, saved studies, and current-page reading.
- Exact supported-origin validation before injection, within the serialized page reader, and during source parsing. Study IDs require a complete eight-digit NCT route. Other sites and malformed identifiers are rejected.
- Session-only patient storage by default; explicit Remember uses extension-local storage. Both areas restrict access to trusted extension contexts. Clear all removes patient/saved state, cancels pending generation, and disconnects the helper-owned local daemon.
- Optional native-messaging Ollama helper with a pinned extension origin, typed bounded messages, positively verified local model weights, no remote aliases, dedicated temporary loopback daemon, `OLLAMA_NO_CLOUD=1`, direct HTTP transport that ignores poisoned proxies, no cloud fallback, and no prompt logs.
- Local narration is a separate unverified draft. It cannot replace deterministic checks. Unsupported citations and obvious English-language eligibility/benefit promises are rejected, preserving source results. This guard is not clinical validation.

## Verification

- Standalone extension dependency install and lockfile; package audit reported zero vulnerabilities. No Next server/framework code is bundled.
- Typecheck and production bundle passed.
- 20 extension/core/storage/cancellation/site/reader tests passed, zero failures/skips. Packed manifest is checked against the site allowlist.
- Actual bundled service-worker testing captures the injected function, serializes it as Chrome does, and evaluates it in an isolated DOM context: no module-closure references are required. Unsupported tabs are rejected before injection.
- Reader regressions cover ordinary selected article text, selected editable-field text, selections crossing editable controls, filtered DOM fallback, and runtime origin rejection.
- Nine native behavior tests passed, including framing/size/schema/origin/local-weight validation, isolated-home install/uninstall, real protocol transport with poisoned proxies, cancellation, and refusal to trust an unrelated daemon.
- Native worker reported a real installed Ollama local-model status/generation smoke using a dedicated helper-owned daemon; no patient data or cloud service was used. Model quality remains dependent on the selected local model.
- Independent reviewer reran the checks and inspected all three initially reported issues: malformed NCT prefix acceptance, unsafe narration claims, and selected-form-text bypass. All fixes passed fresh review.

## Install

From `extension/`, run `npm ci` then `npm run build`. In Chrome's `chrome://extensions`, enable Developer mode, Load unpacked, and choose `extension/dist`. A separate ZIP of the built folder is supplied as `extension/treatable-extension.zip`; extract it before loading.

For local model explanations, from the repository root:

```sh
node extension/native/install.mjs --manifest extension/dist/manifest.json
```

See `NATIVE_SETUP.md` for Ollama/model prerequisites and uninstall. Stable development ID: `lmgmjeabbalehlcakdbolielnfgchojf`. Only the public manifest key is committed.

## Limits

- The extension and native helper were not installed in the user's actual Chrome profile. The actual Chrome UI/unpacked-extension round-trip remains unverified because browser control was unavailable; VM tests are not a substitute for a real Chrome test.
- The installer targets macOS. Other operating-system native-host installation is deferred.
- Existing Ollama/software and suitable local chat weights are prerequisites; weights are not in the extension ZIP. Small models may produce weak or rejected narration; larger models can exceed the 60-second deadline. Deterministic search remains usable without inference.
- The corpus is an incomplete snapshot; recruiting status/contacts need confirmation. Page reading does not fetch new ClinicalTrials.gov API records or send condition/ZIP queries. Ordinary website browsing still makes the browser's normal website requests.
- Medical matching is research information, not clinical advice or a prediction of eligibility/benefit. No real patient data was used for verification.
- No store publication, remote repository push, or PR/main merge was performed. The existing web application remains separate and its source is unchanged.
