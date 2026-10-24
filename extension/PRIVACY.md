# Treatable extension: what is sent, and to whom

This page describes the extension's observable behavior in each mode. The project operates no servers and receives no data. This is not legal advice. You are responsible for legal and regulatory compliance for your use.

## Stored on your device

- Patient profile: `chrome.storage.session` by default; `chrome.storage.local` if you select Remember.
- OpenAI API key and your BAA confirmation: stored together, `chrome.storage.session` by default; `chrome.storage.local` if you select Remember. Clear all removes them.
- Settings (provider choice, consent, Minimum match): `chrome.storage.local`. These contain no health details.
- Scores, decisions, and checklists: held in the side panel's memory for the current view. They are not written to storage.

## Local LLM mode

- Requests go to the Treatable native helper on this device, which runs a local Ollama model. See NATIVE_SETUP.md.
- Sent to the helper: your condition, a five-year age band, sex, spine region, and the public study text.
- Tests check that this mode makes no network requests from the extension.

## Send nothing mode

- No model requests are made. Results come from local keyword retrieval and structured checks and are labeled "Unrefined: keyword screening only".

## OpenAI mode (opt-in)

- Off until you accept the consent screen. Uses your own API key.
- Sent to OpenAI at `https://api.openai.com`:
  - your condition as typed,
  - a five-year age band (for example 40-44), not your exact age,
  - your sex for study criteria,
  - your spine region, if your condition names one,
  - the public ClinicalTrials.gov text of each shortlisted study.
- Not included in requests (enforced by tests): ZIP code, notes, and saved studies. The extension does not ask for your name.
- Endpoints: `POST /v1/decisions` for scoring; `POST /v1/agents/sessions` for the eligibility checklist, followed by `DELETE /v1/agents/sessions/{id}`. The checklist shows whether OpenAI confirmed the deletion.
- OpenAI handles this data under the terms of your API key's account. OpenAI's data-controls documentation lists `/v1/agents` as not eligible for Zero Data Retention.
- OpenAI mode is not set up for protected health information. HIPAA use of the OpenAI API requires an executed BAA and Modified Retention on your organization, and endpoint coverage must be confirmed with OpenAI. Without those, use only synthetic or non-identifying information, or use Local LLM mode. You are responsible for confirming your own BAA and endpoint coverage.

## Organization-policy check (Phase 2 builds only)

When an organization deploys the managed policy, OpenAI mode requires an organization-policy check plus your confirmation. The extension sends one synthetic request with the `OpenAI-Organization` header to confirm that the key belongs to an allowed organization. This does not verify a BAA. OpenAI documents no API for that.

## Web pages

- The extension reads ClinicalTrials.gov pages only after you click Analyze. Browsing and opening source links make normal website requests.
