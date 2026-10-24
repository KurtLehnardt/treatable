# Treatable Chrome extension

Version B is the primary Treatable interface. Its toolbar button opens a search-first overlay on **ClinicalTrials.gov only**. Submit website filters, work with the currently loaded study cards, and optionally open a separate protected matching window for explicitly consented OpenAI analysis.

The standalone prototype on localhost:5556 and the native/mobile app work are separate projects. This extension iteration does not include application submission, researcher profiles, literature search or early-results synthesis.

## Build and install

Requires Chrome **142+**, a working Node **20+** runtime, macOS and Xcode command-line tools for the native Keychain helper. Search and public records do not require an API key. Private Decisions/Agents analysis requires the installed native helper and an authorized OpenAI key.

```sh
cd extension
npm ci
npm run build:all
npm run typecheck
node --import tsx --test tests/*.test.ts
node --test native/test/*.test.mjs
```

The build folders are:

| Folder | Interface |
|---|---|
| `extension/dist` | Current Version B; default build |
| `extension/dist-b` | Identical Version B compatibility build |
| `extension/dist-a` | Preserved Version A reference |

Chrome → Extensions → Developer mode → Load unpacked → choose **`extension/dist`**. After an update, Reload the extension and refresh the ClinicalTrials.gov tab. All variants share a pinned extension ID; use only one in a Chrome profile at a time. The current B archive is `extension/artifacts/treatable-version-b-current.zip`, with the manifest at its root. Extract into a dedicated folder before loading unpacked. Earlier A archives marked **PRE-PRIVACY BASELINE — NOT CURRENT** are historical artifacts.

From the repository root, install the native helper before configuring its credential:

```sh
node extension/native/install.mjs --manifest extension/dist/manifest.json
node extension/native/credentials-setup.mjs configure
node extension/native/credentials-setup.mjs status
```

The installer pins the Node executable used to run it. Use a functioning runtime; rerun the installer after moving or replacing that runtime. Credential setup prompts with terminal echo disabled and saves only the dedicated macOS Keychain item. Never put the key in Chrome, arguments, environment variables, configuration files, chat or logs. `status` checks metadata; it does not verify account authorization. See [native setup and runtime recovery](native/API_SETUP.md).

## Search the website

1. Open `https://clinicaltrials.gov` or `https://www.clinicaltrials.gov` and click Treatable in Chrome’s toolbar. Other hosts and HTTP pages are unsupported; there is no globally enabled Treatable side panel.
2. Enter condition/disease, other terms, intervention/treatment or location. More filters starts collapsed and contains all 28 logical fields: status, eligibility and age ranges, phase/type, results/documents, funder, six date ranges and additional search fields.
3. Search navigates to the registry’s own results URL. Search terms and website filters go to ClinicalTrials.gov and may appear in browser history. This action makes **no OpenAI request**.
4. The overlay reopens compact after the search. Expand it to check loaded cards, load fresh public records, or start private matching. Collapse or Close/Escape makes the website available; the background-opacity control leaves text opaque.

US ZIP codes resolve from approximate offline postal centers, with a default 50-mile distance. Editing location text discards prior coordinates. Other addresses, cities, states or countries require the website’s own location controls; collapse/close Treatable to use them, then reopen it on the resulting search. Treatable refuses an unresolved location rather than pretending the filter was applied. Table/map views and unknown card layouts remain read-only.

## Match the loaded cards

1. Use the website’s **10-results page size**. Treatable detects only the cards currently loaded on that page, including offscreen cards. It does not rank the full registry or other result pages. More than 10 loaded studies is explicitly refused before matching; partial pages are never reordered.
2. Choose **Set up private matching**. The registered, non-web-accessible extension window fetches fresh official API records for every loaded NCT ID. It does not use the bundled 2,000-study snapshot or its condition vocabulary. Fetch failures remain failures; missing public facts stay unknown.
3. Read the Privacy + Health Data Notice to its bottom, acknowledge and accept for this session. Select an age band, optional US state/sex, and 1–6 public condition labels from the fetched studies. Choose 1–2 studies for the independent Agents evidence review.
4. **Prepare request preview** makes no OpenAI call. The native helper pins both exact request bodies and public tool outputs to a five-minute, one-use authorization. The concise payload summary stays visible; exact technical JSON starts collapsed. Confirm the specific operation separately before sending.
5. Run **Score with Decisions** and/or **Review with Agents**. Decisions scores every loaded study; Agents reads allowlisted public evidence and selects study-team question templates. Agents does not consume Decisions scores. A relevance index is neither eligibility nor an enrollment probability.
6. **Apply matches to this page** accepts only a validated current analysis ID. It moves the website’s actual cards and places scores in extension-origin frames over the cards. Every current card must have a score from the same query, source snapshot and profile. Known structured age/sex mismatches rank behind unknown compatibility; topical relevance cannot override them. Restore original order is available.

The website can observe changed card order. Scores, profile details and score classifications are not copied into its DOM text, attributes or frame URLs. Public NCT IDs identify badge frames. Actual Chrome mounting, positioning, focus and native handshake still require browser integration proof; source and mocked tests alone do not prove them.

## Privacy and session lifetime

Private fields contain no names, patient contact information, DOB, exact age, ZIP, coordinates or freeform notes. Explicit condition labels, age bands and optional state/sex remain sensitive and potentially identifying: **minimized is not anonymous**. Consent is required before sending those fields to OpenAI. The notice’s Operator and privacy contact section identifies **Kurt Lehnardt - Developer of Treatable**, **privacy.6vpc5@mailer.me**; these notice details are never model input.

There is no Save/Remember control or patient-history feature. The temporary `storage` permission only removes known legacy patient keys from extension local/session storage; it does not read their contents or write a migration flag. Private entry stays blocked until removal succeeds.

Raw profile, preview, tokens, results and traces stay in the protected window/native session and clear when it ends or becomes hidden. Explicitly applied NCT IDs, derived scores and fixed compatibility buckets may remain in tab-scoped extension RAM for **up to five minutes** after the private window closes. End page matching, source query/navigation changes, hidden pages, lost connections and lease expiry clear badges and restore still-connected cards. Visible search and matching use nonsensitive ten-second heartbeats; they do not extend their five-minute ceilings. There is no storage fallback for service-worker suspension.

The stdio-only native helper has no localhost HTTP inference listener. Credentials stay in the dedicated Keychain item and transient native memory. Browser OpenAI requests, arbitrary model/tool/URL proxies, cookies and telemetry are absent. Model output is bounded to validated IDs and trusted templates; this reduces authority but cannot promise that untrusted text never influences a permitted choice.

Agents retains provider application state until deletion and is not a ZDR endpoint. Cleanup is attempted and its outcome shown; acknowledged deletion does not promise immediate physical erasure. Creation loss before receiving a session ID may leave unconfirmed state. Default abuse monitoring may retain content for up to 30 days, subject to exceptions; API data is not used for training by default. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

Application clearing is not forensic memory erasure. A compromised browser/OS, same-user malware, administrator access, swap/crash data and arbitrary debugging remain outside these guarantees. No anonymity, HIPAA certification or legal sufficiency is claimed. See [HHS de-identification guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html).

## Retained reference workflows

Version A and B retain the earlier protected panel with local screening and a clearly fictional API demo. Local screening uses the incomplete bundled 2,000-study ClinicalTrials.gov snapshot and offline ZIP data; those results may be stale. The older optional real-analysis path uses snapshot labels and at most two studies. These reference paths are distinct from the toolbar’s fresh current-page matching path above. The retained panel entry is `chrome-extension://lmgmjeabbalehlcakdbolielnfgchojf/panel.html`; its actual Chrome access still needs verification. They use the same notice, pinned-confirmation and no-browser-persistence boundaries; the Keychain credential is deliberately persistent.

## Verification status

At source checkpoint `2acc6a2`, automated gates pass: **118 extension tests, 55 native tests, typecheck and all three builds**. Coverage includes validation, scoped permissions, search encoding, protected consent, current-page binding, actual-node reorder logic, legacy-key deletion failure, stale reply rejection, private canaries, provider errors/cleanup and service-worker lease expiry. Native/API tests use explicit test transports; they are not live provider acceptance.

The installed helper’s direct stdio status and a public Gov `liveCatalog` fetch pass; all 14 installed native/shared files match source. The user securely configured the dedicated key; metadata reports `configured: true`. The Keychain helper binary was unchanged during the later source refresh.

Authorized live checks used fictional profiles and public evidence: **one Decisions request and two Agents tasks total**. Decisions returned a validated live score. Both Agents tasks made the required evidence call and returned valid study/template IDs. The first session produced no validated deletion acknowledgment, so its deletion remains **unconfirmed** with an unknown cause. The later session received a strict valid deletion acknowledgment after two attempts; task completion took 10.925 seconds and cleanup 2.872 seconds. Its success does not establish deletion of the first session. No Decisions request was repeated and no further authenticated calls were made.

The refreshed B build and archive have matching 18-file contents. Archive SHA-256: `a2ef726b9b81296e04dc92be27f926f644b9c716d2b9807c49e34ef3524b66c3`. These direct native checks do not prove Chrome-to-native communication. Actual Chrome rendering, website filter/card behavior and its native handshake remain outstanding. Historical security reports apply to their named commits and must not be treated as runtime verification of this page path.

[Three-minute demo and acceptance checks](NORTHSTAR.md) · [Native setup](native/API_SETUP.md) · [Security review](SECURITY_REVIEW.md) · [Version B design evidence](VERSION_B_REVIEW.md)
