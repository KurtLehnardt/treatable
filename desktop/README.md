# Treatable Desktop

Treatable Desktop is a local-first desktop app that helps you look through an offline snapshot of 2,000 ClinicalTrials.gov studies. It is built with Electron and reuses the scoring pipeline from the Treatable browser extension without modifying it.

Research information, not medical advice.

## How it works

1. You describe a condition, age, sex, and optionally a ZIP code and travel radius.
2. The app retrieves candidate studies from the bundled snapshot and applies deterministic screening on this computer.
3. You choose how scoring is refined:
   - Send nothing: keyword screening only. Scores are unrefined and capped at 79.
   - Local LLM: a model running in an Ollama process on this computer scores the shortlist.
   - OpenAI: opt-in, behind a consent screen, using your own API key. Not PHI-ready: use synthetic or non-identifying information only.
4. Minimum match (80, 65, or 50) changes which studies are visible. It never changes a score.

The snapshot is incomplete and recruitment status may have changed. Always confirm details with the study team.

## Layout

- `src/main`: main process. Owns consent, the API key, the provider choice, and settings. Only this process makes network requests.
- `src/main/core/extensionCore.ts`: the single adapter that imports the extension and scaffold code.
- `src/preload`: a narrow, typed `window.treatable` bridge.
- `src/renderer`: the user interface. It has no network access and no direct access to the key.
- `src/shared/ipc.ts`: the typed IPC contract.

## Development

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run guard
```

`npm run guard` fails if a change touches `extension/`, `scaffold/`, `installer/`, or the root install scripts.

## Disclaimer

Research information, not medical advice. Treatable Desktop does not diagnose, recommend treatment, or determine whether you are eligible for any study. Scores are a sorting aid and can be wrong.

No warranty. The software is provided as is.

This document is not legal advice. You are responsible for legal and regulatory compliance in your own use of this software.
