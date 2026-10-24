# Treatable Chrome extension

Private study finding for patients with medical conditions. **Research information, not medical advice.** Matching does not establish eligibility or predict treatment benefit. Confirm details with the study team and your care team.

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
- Search the shipped 2,000-study US snapshot and resolve ZIP distances locally.
- Read selected or rendered text on the active page after your click.
- Recognize ClinicalTrials.gov study IDs and use the matching offline record when available.
- Show clearly unverified ClinicalTrials.gov page excerpts when no offline structured record is available.
- Save studies, view source criteria/contacts, and clear all stored patient data.
- Add optional local model explanations through the native helper.

This first release supports only `https://clinicaltrials.gov/*` and `https://www.clinicaltrials.gov/*`. It has no all-sites access or activeTab permission. The single `sites.json` allowlist drives packed host permissions and exact runtime origin checks before page injection. Other domains, lookalikes, arbitrary subdomains, and HTTP pages are rejected. Forms, editable controls, hidden text and script content are excluded, including selected text in editable fields. A study outside the snapshot remains unverified rather than being fabricated. Dedicated support for other registries is deferred.

## Release artifact

`npm run build` creates the loadable `dist/` folder. The local delivery also includes `treatable-extension.zip`, with the built manifest at its root; extract it before using Load unpacked. Native helper installation is separate and explicit.

## Local AI

See [native helper setup](NATIVE_SETUP.md). The native helper is required only for model explanations. Deterministic search and source checks work without it. No OpenAI key or cloud provider is used. Local model quality and speed depend on hardware/model; weak or unavailable output leaves source results intact.

## Privacy boundaries

- Host permissions name only the two ClinicalTrials.gov HTTPS origins. No all-sites access, cloud requests, analytics, remote executable code, or `storage.sync` use.
- Extension CSP permits data loading only from itself. Patient details are never injected into the website or sent as a study-search/ZIP query.
- Profile defaults to `chrome.storage.session`; Remember uses `chrome.storage.local`. Both are restricted to trusted extension contexts. This is local storage, not Treatable-managed encryption at rest.
- Ordinary browsing and opening source links still make normal website requests. The privacy guarantee concerns extension processing, not the browser's preexisting website traffic.
- Page text is untrusted evidence. It cannot invoke native operations or change deterministic eligibility checks. Model output is a draft, not verified medical information. A conservative English-language check rejects obvious eligibility/benefit promises and unverified citations; it is an engineering guard, not clinical validation. Source checks remain visible if narration is rejected.
- Clear all removes the extension's patient profile/saved IDs and resets the active page/analysis/results. It does not erase browser history, website data, downloaded model weights, or operating-system backups.

## Source and limits

Bundled study records preserve ClinicalTrials.gov URLs, fetch timestamps, and source-update dates. This is an incomplete registry snapshot; recruiting status and contacts can change. Distance is approximate, measured from GeoNames ZIP-area centers (CC BY 4.0), and remains a travel preference. Missing data never becomes medical exclusion. Only structured contradictory age/sex facts can produce Unlikely; unverified free-text criteria stay unknown.

The browser bundle reuses the existing Treatable patient/study contracts and deterministic screening module. It does not import the Next server or saved cloud-provider configuration. Source modules are imported at build time; the built extension is standalone.

## Version B interface

[Version B](VERSION_B.md) provides a separately built panel using the make-interfaces-feel-better skill. Build with `npm run build:b` from `extension/`; load `dist-b`. Version A remains the default `dist` build. Both use the same extension ID/native helper and must be compared one at a time. See the B instructions for a reload workflow that does not require uninstalling the extension.
