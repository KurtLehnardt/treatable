# Treatable Chrome extension

Local-first study finder for patients. OpenAI scoring is opt-in; see [PRIVACY.md](PRIVACY.md) for what is sent to whom in each mode. **Research information, not medical advice.** Matching does not establish eligibility or predict treatment benefit. Confirm details with the study team and your care team.

## Build and load

From this repository's `extension/` directory, with Node 20+:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository's `extension/dist` folder. The extension public key gives the stable development ID `lmgmjeabbalehlcakdbolielnfgchojf`. It does not contain the signing key. No store publication is performed.

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

Choose one in Settings. In Phase 1 (demo), OpenAI is preselected, but nothing is sent until you accept the consent screen and add a key; until then results stay unrefined. In Phase 2, Local LLM is the default and OpenAI needs the organization policy gate.

- **Local LLM.** Stages 3 and 4 run through the native helper and a model on this computer. Requests are sent to the local helper on this device, and no API key is needed. This keeps requests on this device. In the demo build, still enter synthetic data only. See [native helper setup](NATIVE_SETUP.md).
- **OpenAI (opt-in).** Stage 3 uses the OpenAI Decisions API (`POST /v1/decisions`, model `gpt-6-luna`), one request per shortlisted study. Stage 4 uses the OpenAI Agents API (`POST /v1/agents/sessions`, model `gpt-6-astra`, no sandbox environment, JSON-schema output). You paste your own API key. Agents API use needs a key with `api.agents.read` and `api.agents.write`.
- **Send nothing.** Stages 1 and 2 only, labeled "Unrefined: keyword screening only." Nothing can display as Strong in this mode.

If a provider fails (missing key, 401, 403, 429, timeout, malformed response, offline, or a local model error), the panel shows a specific message and falls back to the clearly labeled unrefined list. Each OpenAI request is retried at most once, with backoff, and only for transient failures.

## Release phases

`src/config.ts` holds one constant, `PHASE`. Changing it is a one-line switch.

- **Phase 1, `PHASE = 'demo'` (current build).** OpenAI is the default provider. A persistent banner says this is a synthetic demo: enter synthetic example data only. The consent screen and key entry still come first; nothing is sent without consent.
- **Phase 2, `PHASE = 'hipaa'`.** Local LLM is the default, and a first-run screen says so. OpenAI mode unlocks only through **an organization-policy check plus your confirmation**. In this phase the default provider is Local LLM, not OpenAI (enforced by tests).

To switch to Phase 2, set `export const PHASE: Phase = 'hipaa';` in `src/config.ts`, then run `npm run build`.

### What the Phase 2 gate checks, and what it does not

OpenAI documents no API that tells a client whether an API key's organization has an executed BAA, Modified Retention, or confirmed endpoint coverage. The check therefore does **not** verify a BAA. It is an organization-policy check plus your confirmation. It requires all of the following, and any missing, malformed, or mismatched input keeps OpenAI locked and falls back to Local LLM with a message:

1. A managed policy deployed by an IT admin through Chrome enterprise policy (`chrome.storage.managed`, schema in `managed_schema.json`), with `hipaaOpenAIEnabled: true` and `allowedOpenAIOrgIds` (OpenAI organization IDs, `org-...`).
2. The user ticks the BAA attestation checkbox. In Phase 2 an unchecked attestation keeps OpenAI locked. The organization check runs only after OpenAI consent.
3. The API key belongs to an allowed organization. Treatable sends one synthetic Decisions request (no patient data) per listed organization ID, until one matches, with the documented `OpenAI-Organization` request header; OpenAI rejects a key from another organization with `401 mismatched_organization`. Every later request is pinned to that organization with the same header. The result is cached in memory for the panel session only. A network or API error keeps the gate locked.

In Phase 2 the Agents API checklist is turned off for OpenAI, because OpenAI's data-controls table lists `/v1/agents` as not eligible for Zero Data Retention or Private Retention. Use Local LLM for the checklist.

### Deploying the managed policy (IT admin)

The extension ID is `lmgmjeabbalehlcakdbolielnfgchojf`. Set the policy under Chrome's `3rdparty` extension policy for that ID. Example policy value:

```json
{
  "hipaaOpenAIEnabled": {"Value": true},
  "allowedOpenAIOrgIds": {"Value": ["org-YourOrganizationId"]}
}
```

- Google Admin console: Devices > Chrome > Apps & extensions > select the extension > Policy for extensions, and paste the JSON without the `Value` wrappers: `{"hipaaOpenAIEnabled": true, "allowedOpenAIOrgIds": ["org-..."]}`.
- Windows: registry key `HKLM\Software\Policies\Google\Chrome\3rdparty\extensions\lmgmjeabbalehlcakdbolielnfgchojf\policy`, with a `hipaaOpenAIEnabled` DWORD and an `allowedOpenAIOrgIds` subkey holding numbered string values.
- macOS: a configuration profile for the `com.google.Chrome.extensions.lmgmjeabbalehlcakdbolielnfgchojf` domain with the two keys.

Check the result at `chrome://policy`. Setting this policy is the organization's statement that its OpenAI agreement and configuration cover this use. The extension makes no HIPAA compliance claim.

## Data handling

- **OpenAI mode is opt-in.** It stays off until you accept a consent screen. That screen lists exactly what is sent: your condition as typed (email addresses and runs of five or more digits are removed first), a five-year age band (not your exact age), your sex for study criteria, your spine region, and the public study text. ZIP code, notes, and saved studies are not included in requests (enforced by tests), and the extension does not ask for your name.
- **OpenAI mode is not set up for protected health information. HIPAA use of the OpenAI API requires an executed BAA and Modified Retention on your organization, and endpoint coverage must be confirmed with OpenAI. Without those, use only synthetic or non-identifying information, or use Local LLM mode.** You are responsible for confirming your own BAA and endpoint coverage before entering real health details. This extension makes no HIPAA compliance claim, and makes no claim that the Decisions API or the Agents API is eligible for protected health information.
- In Phase 1 (demo) there is no attestation box. OpenAI mode always shows the persistent banner: "Not PHI-ready: use synthetic or non-identifying information only." In Phase 2 the consent screen has an optional, unchecked box: "My organization has an executed OpenAI BAA with Modified Retention, and this API key belongs to that organization." Unchecked, the banner stays. Checked, the panel shows: "You are responsible for confirming your own BAA and that the Decisions and Agents endpoints are covered by it. Treatable does not check this." The extension does not check the attestation. It is stored only with the key (session storage by default) and is forgotten with the key.
- Data sent in OpenAI mode goes to OpenAI and is subject to OpenAI's terms for your API key's account. Treatable asks OpenAI to delete each agent session (`DELETE /v1/agents/sessions/{id}`) after the task ends, whether it succeeded or failed, and the checklist shows whether OpenAI confirmed the deletion.
- Your OpenAI key is stored in `chrome.storage.session` by default and in `chrome.storage.local` only if you select Remember. It is sent in the Authorization header to `https://api.openai.com`. Tests check that it does not appear in console output, request bodies, or error messages. It is not placed in page context. Clear all removes it.
- OpenAI responses are kept in the panel's memory for the current view only. They are not written to storage or logs.
- Host permissions name the two ClinicalTrials.gov HTTPS origins for page reading plus `https://api.openai.com/*` for API calls. The extension CSP allows connections only to itself and `https://api.openai.com`. Page reading still runs only on ClinicalTrials.gov; there is no all-sites access, activeTab permission, analytics, remote executable code, or `storage.sync` use.
- In Local LLM mode, requests are sent to the local helper on this device. In Send nothing mode, no model requests are made. Tests check that the Local provider makes no network requests. Patient details are not injected into the website or sent as a study-search or ZIP query.
- Profile defaults to `chrome.storage.session`; Remember uses `chrome.storage.local`. Both are restricted to trusted extension contexts. This is local storage, not Treatable-managed encryption at rest.
- Ordinary browsing and opening source links still make normal website requests.
- Page text and study text are untrusted evidence. They cannot invoke native operations or change deterministic exclusions. Model output can lower a score but cannot lift it past a deterministic cap (enforced by tests), and it does not remove a study's structured checks.
- Clear all removes the patient profile, saved IDs, results, and the OpenAI key. It does not erase browser history, website data, downloaded model weights, or operating-system backups.

## Tests and live smoke test

`npm test` runs hermetic tests with mocked OpenAI and local-model calls, plus a synthetic golden set (`evals/golden-set.jsonl`). With your own key in the environment, `npx tsx scripts/smoke.ts "thoracic degenerative disc disease" 40 male` runs one live pass against the OpenAI APIs with that synthetic profile.

## Source and limits

Bundled study records preserve ClinicalTrials.gov URLs, fetch timestamps, and source-update dates. This is an incomplete registry snapshot; recruiting status and contacts can change. Distance is approximate, measured from GeoNames ZIP-area centers (CC BY 4.0), and remains a travel preference. Missing data never becomes medical exclusion. Only structured contradictory age/sex facts exclude a study; unverified free-text criteria stay unknown. Model scores are research aids, not eligibility decisions. Local model quality and speed depend on hardware and model.

The browser bundle reuses the existing Treatable patient/study contracts and deterministic screening module. It does not import the Next server or saved cloud-provider configuration. Source modules are imported at build time; the built extension is standalone.

## Disclaimer

- **Research information, not medical advice.** A match score does not establish eligibility, recommend a treatment, or predict benefit. Confirm everything with the study team and your clinician.
- The project operates no servers. Depending on the mode you choose, data goes to OpenAI under your own API key, to the local helper on your device, or nowhere. See [PRIVACY.md](PRIVACY.md).
- You are responsible for legal and regulatory compliance for your use, including confirming your own BAA and OpenAI endpoint coverage before any use with protected health information. This is not legal advice.
- The extension is not clinically validated and makes no HIPAA compliance claim.
- No warranty. The software is provided "as is", without warranty of any kind, under the MIT License in the repository's `LICENSE` file.
