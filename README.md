# Treatable

> **Demoed product:** the Treatable Chrome extension in [`extension/`](extension/README.md), with its local native host in [`extension/native/`](extension/native/API_SETUP.md). The rest of this README describes the legacy `scaffold/` web app, which is not part of the demo.
>
> **Security:** [SECURITY.md](SECURITY.md) (vulnerability reporting, scope, release gate) · [Threat model](docs/security/THREAT_MODEL.md) · [Demo-day checklist](docs/security/DEMO_DAY_CHECKLIST.md). Treatable is not a HIPAA-covered product, no compliance or certification is claimed, and minimized health data is not anonymous.

Find US clinical studies and expanded-access programs that may relate to pain and hard-to-control symptoms.

**Treatable does not give medical advice. It cannot decide whether a study is right for you. Your care team and the study team must check.** A match score measures search relevance, not eligibility, benefit, or a chance of enrollment.

## Quick links

[ClinicalTrials.gov](https://clinicaltrials.gov/) · [NCI trial search](https://www.cancer.gov/about-cancer/treatment/clinical-trials/search) · [Privacy](#privacy) · [Troubleshooting](#troubleshooting)

## Install on macOS

From this checkout:

```bash
bash install-macos.sh --dry-run
cd scaffold
npm ci
npm run model:fetch
npm run build
npm run start
```

Open http://127.0.0.1:5556. The installer installs prerequisites, dependencies, the pinned local search model and a per-user launcher; it can be rerun. Run it only from the published Treatable repository when available. A graphical DMG installer is coming in a later release.

```bash
bash scripts/macos/applications-launcher.sh install --add-to-dock
bash scripts/macos/treatable-tray.sh start --open-browser
bash scripts/macos/treatable-tray.sh status
```

The launcher is `~/Applications/Treatable.app`. Its server uses `com.treatable.server` with RunAtLoad disabled and no KeepAlive. Settings live at `~/Library/Application Support/Treatable/settings.json`. The menu bar offers Open, status, Show log, Restart and Quit. Chrome/Edge app windows are supported. `scripts/macos/uninstall.sh --check` previews removal; uninstall refuses unmarked developer checkouts and removes only this installation's resources. It can retain a key backup only when selected; do not back up patient profiles.

## Windows / Linux

Use the same `npm ci`, build and start commands. Platform installers are deferred. The legacy Electron installer directory is retained for future work.

## What you need

Node22+, npm, and roughly 1GB for dependencies and the 275MB local search model. No key is required for keyword search or the three clearly fictional demos. The shipped corpus contains 2,000 real US study records from ClinicalTrials.gov, including all expanded-access records present in the source snapshot; the corpus is a starting point, not every available study. Verify current recruitment on the source record.

## Which local model

`npm run setup:local -- --yes` detects memory and guides Ollama installation and model selection. Chat model weights require a download and are not committed. The pinned nomic search model is separate from the chat model. After model downloads, Local chat and search use this computer. Without a chat model, keyword/semantic results and contact scripts still work. Phase one exposes OpenAI and Local; Claude and other providers are deferred.

## How search works

Describe symptoms in one screen, add age and a US location, then choose travel preferences. Patient inputs are stored only in browser localStorage. Clear everything removes these inputs and current results. A shipped GeoNames postal-code table resolves US ZIP and ZIP+4 locally to an approximate area center; notices label those distances approximate. Unknown ZIPs stay unknown. City/state alone require a ZIP for distances. The app never sends your ZIP to a geocoder.

Stage 1 combines local semantic vectors with keyword retrieval and renders up to 60 candidates. If the local model is missing, keyword results still work offline. Stage 2 optionally uses two passes: a score-only sweep, then explanations for promoted studies. Model failures retain the original candidates and mark uncertainty. Preference choices produce warnings rather than medical exclusions.

## How it works

Four buckets: Matches what you told us, Ask the study team, Can't tell yet, Unlikely. Only explicit user facts against structured age/sex fields can yield Unlikely. Missing fields and model-inferred criteria never exclude. Closed studies are omitted; records older than two years are flagged, retained and linked to their source. Accepting healthy volunteers never means healthy-only. Distance is a travel preference. Expanded access is shown separately when enabled and relevant records exist.

Each card includes sites, contact details, source freshness, verbatim study requirements, a five-line call script and open questions. The clinician summary prints the profile and top five studies. Search results do not promise a place in a study or access to an experimental treatment.

## Privacy

Local mode sends patient text only to the Ollama loopback endpoint. Search embeddings always run locally, even if an OpenAI key exists. Keyword mode makes no model calls. Selecting OpenAI requires explicit consent before your profile and selected study text are sent to OpenAI. Avoid names and record numbers. Provider settings and keys may be saved on disk; patient profiles, searches and results are not logged or cached by the server. Static study data is public registry data. Model downloads, study refreshes, external source links and software updates contact their respective services. The map is drawn locally without a remote tile service. The app binds 127.0.0.1 by default; use `npm run dev:lan` or `START_HOST=0.0.0.0 npm run start` only on a trusted network. Future mobile clients may use Tailscale; mobile apps are deferred.

## Data refresh and validation

```bash
npm run data:fetch
npm run data:normalize
npm run data:embed:builtin
npm run data:precompute
npm test
npm run typecheck
npm run check:prompts
npm run eval:quality
npm run eval:builtin
npm run build
```

The fetch pipeline paginates the official API, records fetchedAt, keeps US sites and deduplicates NCT IDs. A deterministic NCT hash sample caps the shipped corpus at 2,000 while preserving expanded-access records. Vectors use pinned nomic fp16, 128-token truncation, mean pooling/L2 normalization and matching query/document prefixes. Content hashes and the whole preprocessing configuration invalidate changed vectors; checkpoint writes are atomic and restartable. A warm local-model query is measured separately from fast keyword retrieval. Safety evals use 12 fictional profiles; false exclusions must be zero. Broader embedding agreement is informational and OpenAI comparison needs a separately configured key.

## Troubleshooting

- No local search model: run `npm run model:fetch`, or keep using keyword search.
- No local chat model: run `npm run setup:local -- --yes`; results remain available without it.
- No OpenAI explanations: add a key in Settings and explicitly consent to sending health text.
- Unknown distance: check your US ZIP or ask the study team about sites.
- No relevant studies: discuss palliative-care and symptom-management support with your care team; use the registry and NCI links above to broaden the search.
- Port occupied: stop the other Treatable instance before starting. The configured application port is shared by the server and launchers.

## Attribution

Adapted from Granted/fundFinder, source baseline d6e143abfbd57d1f80dc8cf15010e5fa3d87f832. ClinicalTrials.gov supplies source records; Treatable is an independent project.

Postal centroids: [GeoNames postal codes](https://download.geonames.org/export/zip/), [CC BY4.0](https://creativecommons.org/licenses/by/4.0/), approximate public data, downloaded2026-10-24.
