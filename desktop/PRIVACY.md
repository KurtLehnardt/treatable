# Treatable Desktop privacy notes

Research information, not medical advice.

Treatable operates no servers. The project has no account system, no analytics, and no telemetry. What the app does with your input depends on the provider mode you choose.

## Send nothing

Scoring makes no network requests. Retrieval and screening run on this computer against the bundled snapshot. Results are unrefined and capped at 79.

## Local LLM

Scoring sends study text and a reduced version of your profile to a local Ollama process on 127.0.0.1 that the app starts. It does not go to a remote server. Only models with complete local weights are offered; cloud-hosted model names are refused.

## OpenAI

Only after you consent, the app sends scrubbed evidence to api.openai.com under your own API key and OpenAI's terms. The evidence is an age band, sex, the condition text with obvious identifiers removed, and the study record. It does not include your ZIP code, your notes, or your name. Not PHI-ready: use synthetic or non-identifying information only. Only the main process contacts OpenAI; the user interface has no network access.

## Your API key

The key is stored via Electron safeStorage (OS-level encryption where available). If that is unavailable, the key is kept in session memory only and is gone when you quit. The user interface only ever sees whether a key exists and its last four characters.

## What is stored on disk

The app uses the userData folder named "Treatable Desktop". It holds settings, your consent choice, and the stored key if safeStorage is available. Your profile stays in memory unless you tick Remember. "Clear all" removes the key, consent, settings, and any remembered profile.

## Updates

The app does not update itself. An update check, if you run it, only shows a download link to open in your browser.

## Your responsibility

You are responsible for legal and regulatory compliance in your own use of this software. This document is not legal advice.
