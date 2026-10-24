# Treatable Chrome extension

Version B is the primary Treatable interface. Its toolbar button opens a search-first overlay on **ClinicalTrials.gov only**. Submit website filters, work with the currently loaded study cards, and expand inline matching for explicitly consented OpenAI analysis. A separate compact trusted window confirms only the final send; the profile, preview and results remain inline.

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
4. The overlay reopens compact after the search. Expand it to check loaded cards, load fresh public records, or start private matching. Treatable opens in the **Popup** display by default: a centered window, with the page behind it inert until the window is collapsed. The top-right settings gear offers Popup, Overlay (a bounded card that leaves the rest of the page interactive, with no dimming or opacity control) or in-page Sidebar, plus System, Light or Dark themes. A saved choice always wins over the default; native Chrome side panels stay disabled.

US ZIP codes resolve from approximate offline postal centers, with a default 50-mile distance. Editing location text discards prior coordinates. Other addresses, cities, states or countries require the website’s own location controls; collapse/close Treatable to use them, then reopen it on the resulting search. Treatable refuses an unresolved location rather than pretending the filter was applied. Table/map views and unknown card layouts remain read-only.

## Guided walkthroughs

Both walkthroughs use [SweetAlert2](https://sweetalert2.github.io/) 11.26.25, bundled into the extension (no CDN, no remote code). Its dialogs are mounted in the extension's own shadow root and carry their own stylesheet, so ClinicalTrials.gov styles do not reach them and theirs do not reach the site. A guide only points: it never ticks, types into, submits or clicks anything for you, and it removes its highlight and dialog when it ends or is skipped.

- **Show me how to search** (Treatable panel, search pages only) walks through two website filters. It collapses the panel, highlights **Recruiting** under Study Status and waits for you to tick it, then does the same for **Interventional** under Study Type, explaining that interventional studies test a treatment and observational studies do not assign one. If the filters are hidden (the Hide/Show panel on a wide screen, or the Focus Your Search drawer on a narrow one) it highlights the button that opens them. If a box cannot be found it shows plain instructions instead.
- **Intro tour** starts by itself the first time Treatable is opened, and **Replay intro** (panel footer) runs it again. Steps: welcome, how to change the look of Treatable (Popup, Overlay, Sidebar, theme), starting on ClinicalTrials.gov search, where to type your condition and location, optional filter help (the walkthrough above), opening a study, then Treatable's study tools: Understand this study, Generate study brief, Personalize your email, the editable draft, and Copy full email / Open draft in my email app. The tour points at the existing consent and confirmation steps; it does not approve or bypass them. Treatable never sends the email; you do.

The tour keeps two values, nothing else, and never anything you type, any search term or any study ID: `treatable.onboardingVersion` (the number 1, in extension-local storage, set when the tour is finished or skipped) and `treatable.onboardingStep` (a bare step number in session storage, so the tour can resume after the page navigates; removed when the tour ends). All access lives in `src/guide-state.ts`, uses the existing `storage` permission, and the deletion-only legacy patient-data cleanup removes only its own key. No network request, new permission or host change is involved. sweetalert2 releases after 11.4.9 on some lines shipped locale- and domain-gated "protestware"; the pinned 11.26.25 has none, and a test fails if a vendor update adds any.

## Match the loaded cards

1. The accepting-only filter defaults to recruiting and available expanded-access studies; optional checkboxes include opening soon or invitation-only studies. Fresh public status also filters already loaded cards. Unknown or unavailable status stays visible and labeled unverified. Turn accepting-only off to use other study-status selections; this does not load studies absent from the current website results.
2. Use the website’s **10-results page size** or a current set with at most ten visible studies after public filtering. Treatable ranks this page only. Expand **Find my matches** to enter a session-only profile inline; fresh official records and verified titles come from the current NCT IDs, not the bundled snapshot.
3. Scroll the Privacy + Health Data Notice to its bottom, acknowledge and accept. Choose an age band, optional state/sex and 1–6 public condition labels. The optional study-team questions task reviews one or two selected studies independently of scoring.
4. **Find my matches** prepares and pins the exact native requests locally, then opens a compact trusted final confirmation. Its visible summary and collapsed exact JSON describe the specific OpenAI operation. Only this registered top-level confirmation can authorize native execution; embedded main-frame native execute requests are rejected. The profile and results stay inline.
5. After a validated Decisions result, the prominent **Apply matches to this page** action moves actual visible cards and adds private percentage badges. Percentages are normalized relevance, not eligibility or enrollment odds. Every analyzed target must have a current score; known structured age/sex mismatches stay behind unknown compatibility.
6. Distances use all eligible US facility coordinates, pairing the nearest facility with its approximate straight-line miles. A verified search-location coordinate or optional offline ZIP override stays local and is excluded from OpenAI packets. Explicit Apply may hide studies known outside the chosen radius; missing coordinates or uncertain recruitment keep distance unknown rather than falsely excluding a study. Origin/radius edits invalidate prior results.
7. Restore removes owned ranking, distance visibility and badge changes. End also restores public-status visibility. Cleanup affects still-connected nodes and never resurrects cards removed by the website. Applied derived summaries have a fixed five-minute lease.

The website can observe changed card order and visibility. Scores, profile details, private ZIP/origin and distance summaries are not copied into its DOM text, attributes or frame URLs. Public NCT IDs identify fixed-size badge frames. Actual Chrome rendering, placement and the complete inline-to-confirmation-to-Apply interaction still require final browser verification; offline node tests and native API checks are separate evidence.

## Privacy and session lifetime

The OpenAI packet contains no names, patient contact information, DOB, exact age, ZIP, coordinates or freeform notes. The optional ZIP and resolved origin remain local to the active extension session. Explicit condition labels, age bands and optional state/sex remain sensitive and potentially identifying: **minimized is not anonymous**. Consent is required before sending those fields to OpenAI. The notice’s Operator and privacy contact section identifies **Kurt Lehnardt - Developer of Treatable**, **privacy.6vpc5@mailer.me**; these notice details are never model input.

Settings → **Your details** holds an optional name, a description of the illness, condition, symptoms or reason for seeking treatment, and an "anything else" note. These values only fill the patient's own local email draft, call script and follow-up message, which stay editable. They live in the overlay frame's memory, are never written to extension storage, web storage, IndexedDB, files or cookies, and are never sent to OpenAI, the native helper, ClinicalTrials.gov, traces or logs; only the patient-started mailto handoff or copy carries them out. Clear my details, End and clear my details, closing Treatable and any ended session wipe them. The call script and follow-up list each phone contact from the official record with a **Call** (`tel:`) link and **Copy number**; links are built only from structured contact fields as E.164 numbers with an optional `;ext=`, and numbers that do not check out show as text without buttons.

There is no Save/Remember control or patient-history feature. The `storage` permission removes known legacy patient keys from extension local/session storage without reading their contents or writing a migration flag; private entry stays blocked until removal succeeds. The only value it writes is one non-health preference record, `treatable.uiPrefs` in `chrome.storage.local`, holding the display mode (`overlay`, `popup` or `sidebar`) and theme (`system`, `light` or `dark`) and nothing else. The intro tour adds exactly two more non-health values, described under Guided walkthroughs: a done flag and a step number. Clear all and End session clear patient data but keep these display preferences.

Raw profile, local origin, preview, tokens, results and traces stay in the authorized inline extension/native session and clear when it ends or becomes hidden. Explicitly applied NCT IDs, derived scores, fixed compatibility buckets and nearest-site/distance summaries may remain in tab-scoped extension RAM for **up to five minutes** after matching details close. End page matching, source query/navigation changes, hidden pages, lost connections and lease expiry clear badges and restore still-connected cards. Visible search and matching use nonsensitive ten-second heartbeats; they do not extend their five-minute ceilings. There is no storage fallback for service-worker suspension.

The stdio-only native helper has no localhost HTTP inference listener. Credentials stay in the dedicated Keychain item and transient native memory. Browser OpenAI requests, arbitrary model/tool/URL proxies, cookies and telemetry are absent. Model output is bounded to validated IDs and trusted templates; this reduces authority but cannot promise that untrusted text never influences a permitted choice.

Agents retains provider application state until deletion and is not a ZDR endpoint. Cleanup is attempted and its outcome shown; acknowledged deletion does not promise immediate physical erasure. Creation loss before receiving a session ID may leave unconfirmed state. Default abuse monitoring may retain content for up to 30 days, subject to exceptions; API data is not used for training by default. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

Application clearing is not forensic memory erasure. A compromised browser/OS, same-user malware, administrator access, swap/crash data and arbitrary debugging remain outside these guarantees. No anonymity, HIPAA certification or legal sufficiency is claimed. See [HHS de-identification guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html).

## Retained reference workflows

Version A and B retain the earlier protected panel with local screening and a clearly fictional API demo. Local screening uses the incomplete bundled 2,000-study ClinicalTrials.gov snapshot and offline ZIP data; those results may be stale. The older optional real-analysis path uses snapshot labels and at most two studies. These reference paths are distinct from the toolbar’s fresh current-page matching path above. The retained panel entry is `chrome-extension://lmgmjeabbalehlcakdbolielnfgchojf/panel.html`; its actual Chrome access still needs verification. They use the same notice, pinned-confirmation and no-browser-persistence boundaries; the Keychain credential is deliberately persistent.

## Verification status

At integration checkpoint `4ee6635`, independent automated gates pass: **145 extension tests, 55 native tests, typecheck and all three builds**. Coverage includes validation, scoped permissions, search encoding, protected consent, current-page binding, actual-node reorder logic, legacy-key deletion failure, stale reply rejection, private canaries, provider errors/cleanup and service-worker lease expiry. Native/API tests use explicit test transports; they are not live provider acceptance.

The installed helper’s direct stdio status and a public Gov `liveCatalog` fetch pass; all 14 installed native/shared files match source. The user securely configured the dedicated key; metadata reports `configured: true`. The Keychain helper binary was unchanged during the later source refresh.

Authorized live checks used fictional profiles and public evidence: **one Decisions request and two Agents tasks total**. Decisions returned a validated live score. Both Agents tasks made the required evidence call and returned valid study/template IDs. The first session produced no validated deletion acknowledgment, so its deletion remains **unconfirmed** with an unknown cause. The later session received a strict valid deletion acknowledgment after two attempts; task completion took 10.925 seconds and cleanup 2.872 seconds. Its success does not establish deletion of the first session. No Decisions request was repeated and no further authenticated calls were made.

The current B archive path remains `extension/artifacts/treatable-version-b-current.zip`; final packaging verifies default B, compatible B and extracted archive parity. Direct native checks do not establish the complete Chrome inline/confirmation/Apply workflow. Historical security reports apply to their named commits and must not be treated as runtime verification of this page path.

Default recruitment-query evidence: the current official [filter definitions](https://clinicaltrials.gov/chunk-N3WLMKWZ.js) map `rec` to Recruiting and `ava` to Available in the expanded-access group; their native `not rec` preset uses space-separated statuses. The official [query serializer](https://clinicaltrials.gov/chunk-N5W3TRDQ.js) writes sorted `key:value` entries into `aggFilters`. This verifies encoding, while actual browser filter-chip behavior remains a separate check.

[Three-minute demo and acceptance checks](NORTHSTAR.md) · [Native setup](native/API_SETUP.md) · [Security review](SECURITY_REVIEW.md) · [Version B design evidence](VERSION_B_REVIEW.md)
