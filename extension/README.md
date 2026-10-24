# Treatable Chrome extension

Study finding for patients with medical conditions. Nothing leaves your computer unless you opt in to OpenAI scoring. **Research information, not medical advice.** Matching does not establish eligibility or predict treatment benefit. Confirm details with the study team and your care team.

## Build and load

From this repository's `extension/` directory, with Node 20+:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository's `extension/dist` folder. The extension public key gives the stable development ID `lmgmjeabbalehlcakdbolielnfgchojf`. It does not contain a private signing key. No store publication is performed.

Click the Treatable toolbar icon while viewing an HTTPS ClinicalTrials.gov page. The side panel can:

- Store a patient profile for the browser session, or remember it locally after explicit selection.
- Find studies in the shipped 2,000-study US snapshot with a staged, conservative scoring pipeline (below).
- Read selected or rendered text on the active ClinicalTrials.gov page after your click, and score the matching offline record.
- Show, for every study, a "How this was scored" panel with the exact request sent, the decision returned, the caps applied, and the final score.
- Build an eligibility checklist for a study: each criterion, your status (met, not met, unknown) with the quoted source line, and questions for the study team.
- Save studies, view source criteria and contacts, and clear all stored patient data and the OpenAI key.

## How studies are scored

1. **Local retrieval (no network).** BM25 over title, conditions, keywords, summary, and eligibility text, with a small synonym table. A study qualifies only if a distinctive condition term appears in its title, conditions, or keywords. Generic words (disease, degenerative, chronic, disorder, syndrome, pain, study, patients) and bare region words never qualify a study on their own. The top 20 form the shortlist.
2. **Deterministic screen (no network).** A structured age or sex contradiction removes the study. The spine region (cervical, thoracic, lumbar, sacral, or unspecified) is extracted from your condition and the study; a region mismatch caps the score at 49 and moves the study to "Related research you likely don't qualify for." Unparsed free text stays unknown and never excludes.
3. **Scoring of the shortlist only.** Each study gets the same four questions over the same shared evidence: `condition_match` (exact, related, different), `site_match` (match, mismatch, unspecified), `fit_score` (0-4 ordered scale shown as 0-100), and `age_sex_compatible` (probability). The final score is the minimum of the model's fit score and every cap. A model can lower or confirm a cap but never lift a study past one. Low model confidence drops the study one tier.
4. **Eligibility checklist.** For Strong and Possible matches, an agent task reads the study's eligibility criteria and returns a schema-validated checklist. Any item whose quoted source line is not found in the study text is dropped.

Tiers: 80+ Strong, 65-79 Possible, 50-64 Weak. "Matches what you told us" appears only at 80+. The **Minimum match** setting (50, 65, or 80; default 80) changes only what is shown, never the scores. When nothing reaches the threshold the panel says so: "No strong matches in the offline snapshot of 2,000 studies." It never pads the list.

## Providers

Choose one in Settings. Until you choose, results stay unrefined and nothing is sent anywhere. If the local helper is detected, Local LLM is selected by default.

- **Local LLM.** Stages 3 and 4 run through the native helper and a model on this computer. Nothing leaves the device and no API key is needed. **Use this mode for real health details.** See [native helper setup](NATIVE_SETUP.md).
- **OpenAI (opt-in).** Stage 3 uses the OpenAI Decisions API (`POST /v1/decisions`, model `gpt-6-luna`), one request per shortlisted study. Stage 4 uses the OpenAI Agents API (`POST /v1/agents/sessions`, model `gpt-6-astra`, no sandbox environment, JSON-schema output). You paste your own API key. Agents API use needs a key with `api.agents.read` and `api.agents.write`.
- **Send nothing.** Stages 1 and 2 only, labeled "Unrefined: keyword screening only." Nothing can display as Strong in this mode.

If a provider fails (missing key, 401, 403, 429, timeout, malformed response, offline, or a local model error), the panel shows a specific message and falls back to the clearly labeled unrefined list. Each OpenAI request is retried at most once, with backoff, and only for transient failures.

## Privacy boundaries

- **OpenAI mode is opt-in.** It stays off until you accept a consent screen. That screen lists exactly what is sent: your condition as typed, a five-year age band (not your exact age), your sex for study criteria, your spine region, and the public study text. Treatable never sends your ZIP code, name, notes, or saved studies.
- **OpenAI mode is not set up for protected health information. HIPAA use of the OpenAI API requires an executed BAA and Modified Retention on your organization, and endpoint coverage must be confirmed with OpenAI. Without those, use only synthetic or non-identifying information, or use Local LLM mode.** You are responsible for meeting those requirements before entering real health details. This extension makes no HIPAA compliance claim, and makes no claim that the Decisions API or the Agents API is eligible for protected health information.
- The consent screen has an optional, unchecked box: "My organization has an executed OpenAI BAA with Modified Retention, and this API key belongs to that organization." Unchecked, OpenAI mode still works but shows a persistent banner: "Not PHI-ready: use synthetic or non-identifying information only." Checked, the panel shows: "You are responsible for confirming that the Decisions and Agents endpoints are covered by your BAA." The extension does not verify the attestation. It is stored only with the key (session storage by default) and is forgotten with the key.
- Data sent in OpenAI mode goes to OpenAI and is subject to OpenAI's terms for your API key's account. Treatable asks OpenAI to delete each agent session after reading its checklist.
- Your OpenAI key is stored in `chrome.storage.session` by default and in `chrome.storage.local` only if you select Remember. It is sent only in the Authorization header to `https://api.openai.com`. It is never logged, never placed in page context, and never included in error messages. Clear all removes it.
- OpenAI responses are kept in the panel's memory for the current view only. They are not written to storage or logs.
- Host permissions name the two ClinicalTrials.gov HTTPS origins for page reading plus `https://api.openai.com/*` for API calls. The extension CSP allows connections only to itself and `https://api.openai.com`. Page reading still runs only on ClinicalTrials.gov; there is no all-sites access, activeTab permission, analytics, remote executable code, or `storage.sync` use.
- Local LLM and Send nothing modes make no cloud requests. Patient details are never injected into the website or sent as a study-search or ZIP query.
- Profile defaults to `chrome.storage.session`; Remember uses `chrome.storage.local`. Both are restricted to trusted extension contexts. This is local storage, not Treatable-managed encryption at rest.
- Ordinary browsing and opening source links still make normal website requests.
- Page text and study text are untrusted evidence. They cannot invoke native operations or change deterministic exclusions. Model output can lower a score but never lift past a deterministic cap, and it never removes a study's structured checks.
- Clear all removes the patient profile, saved IDs, results, and the OpenAI key. It does not erase browser history, website data, downloaded model weights, or operating-system backups.

## Tests and live smoke test

`npm test` runs hermetic tests with mocked OpenAI and local-model calls, plus a synthetic golden set (`evals/golden-set.jsonl`). With your own key in the environment, `npx tsx scripts/smoke.ts "thoracic degenerative disc disease" 40 male` runs one live pass against the OpenAI APIs with that synthetic profile.

## Source and limits

Bundled study records preserve ClinicalTrials.gov URLs, fetch timestamps, and source-update dates. This is an incomplete registry snapshot; recruiting status and contacts can change. Distance is approximate, measured from GeoNames ZIP-area centers (CC BY 4.0), and remains a travel preference. Missing data never becomes medical exclusion. Only structured contradictory age/sex facts exclude a study; unverified free-text criteria stay unknown. Model scores are research aids, not eligibility decisions. Local model quality and speed depend on hardware and model.

The browser bundle reuses the existing Treatable patient/study contracts and deterministic screening module. It does not import the Next server or saved cloud-provider configuration. Source modules are imported at build time; the built extension is standalone.
