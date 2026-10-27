# Security policy

Treatable's primary product is a Chrome MV3 extension ([`extension/`](extension/README.md)) with a local Node native-messaging host and a Swift macOS Keychain helper ([`extension/native/`](extension/native/API_SETUP.md)). It helps patients explore public clinical studies and handles personal health information that people type into it. It is a minimum viable product maintained by one developer.

Treatable is not a HIPAA-covered product. No Business Associate Agreement exists with OpenAI, no HIPAA compliance or certification is claimed, and minimized health information is not anonymous. Design details, trust boundaries and accepted risks are in the [threat model](docs/security/THREAT_MODEL.md).

## Supported versions

| Component | Version | Supported |
|---|---|---|
| Chrome extension (`dist/`) | 0.1.0, latest commit of the release branch | Yes |
| Native host and Keychain helper (`extension/native/`) | Same commit as the extension build | Yes, only with a matching extension build (public catalog hash must match) |
| Archived "PRE-PRIVACY BASELINE — NOT CURRENT" A ZIP | Any | No |
| Legacy web app `scaffold/`, `installer/`, root `install-*` scripts | Any | No (not part of the demo; reports handled best effort) |

Fixes land on the latest commit only. There are no backports.

## Reporting a vulnerability

Email **privacy.6vpc5@mailer.me** with the subject `Treatable security: <short title>`. Operator: Kurt Lehnardt - Developer of Treatable.

Please include:

- the component and commit SHA, or extension version;
- macOS, Chrome and Node versions;
- steps to reproduce, a proof of concept, and expected versus actual behavior;
- the impact: which data or capability an attacker gains;
- whether a real API key or real health information was involved.

Please **do not** send real health information, real API keys or other people's data; use the fictional fixtures and redact keys. Do not open a public GitHub issue for an unfixed vulnerability.

What to expect (best effort from a single maintainer):

| Step | Target |
|---|---|
| Acknowledgement | 3 business days |
| Triage and severity | 7 days |
| Fix or mitigation | Critical/high: 14 days. Others: next release |
| Disclosure | Coordinated; on fix or after 90 days, whichever comes first. Credit if you want it |

## Safe harbor

We will not pursue or support legal action against good-faith security research that:

- tests **only your own installation**: your own Chrome profile, your own native-host registration, your own Keychain item and your own OpenAI project and key;
- uses fictional data, never real people's health information;
- does not access, change or keep other people's data, and stops and reports if you encounter any;
- does not degrade or attack third-party services (OpenAI, ClinicalTrials.gov, Google, Apple), which have their own policies that we cannot waive;
- gives us reasonable time to fix before public disclosure.

If you are unsure whether something is in bounds, email first.

## Scope

In scope:

- toolbar overlay, background service worker, manifest and CSP (`extension/src/`, `extension/manifest.json`);
- shared request/response contracts (`extension/shared/`);
- native host, transport, provider client, consent store, installer and Keychain helper (`extension/native/`);
- build script and CI gate (`extension/scripts/`, `.github/workflows/extension-security.yml`).

Especially interesting: data leaving the extension beyond the documented minimized packets; API key exposure outside the accepted same-user risk; bypassing the notice, exact-payload confirmation, token, digest, TTL or one-use checks; model output reaching the UI as free text; native-host origin or sender spoofing; prompt injection that causes anything beyond the documented enum and template outputs; unexpected network destinations.

Out of scope (documented in [threat model §9](docs/security/THREAT_MODEL.md#9-residual-risks-and-limitations)):

- a process running as the same macOS user obtaining the key through the Keychain helper (accepted risk);
- OS malware, administrator or root access, malicious browser extensions with broad permissions, a compromised Chrome or OS, physical access;
- recovery from memory, swap or crash dumps;
- OpenAI's own retention and processing (the Agents API is not ZDR) and provider availability;
- relevance-score or wording disagreements with no security impact (report as normal bugs);
- the legacy `scaffold/`, `installer/` and root install scripts;
- denial of service against your own machine, social engineering, missing headers without demonstrated impact.

## Release gate

Our pre-release practice is inspired by Anthropic's **Project Glasswing**, a restricted-access program in which partners use the Claude Mythos model to find and patch vulnerabilities before release. Treatable is not a Glasswing partner and did not use Mythos, which is not publicly available. We emulate the practice: **AI-assisted adversarial review plus SAST, dependency audit and secret scanning as a gate before each release.**

A release (a build for distribution, a ZIP under `extension/artifacts/`, or a merge to the release branch) requires all of:

1. The CI job [`extension-security`](.github/workflows/extension-security.yml) is green: `npm ci`, typecheck, both builds, extension tests, native tests, `npm audit --audit-level=high`, gitleaks over the full history, and Semgrep (`p/javascript`, `p/typescript`, `p/secrets`, `--error`).
2. An AI-assisted adversarial review of the diff against the [threat model](docs/security/THREAT_MODEL.md) (trust boundaries, STRIDE rows, OWASP LLM mapping), with every finding triaged true or false positive with file:line, and either fixed or recorded as an accepted risk.
3. The threat model is updated when a boundary, payload field, permission, endpoint, tool, model or retention behavior changes.
4. No new claims of HIPAA compliance, certification, anonymity, eligibility or benefit; the repository's claim-filter tests pass.
5. Manual check: manifest permissions and host permissions unchanged or justified; CSP unchanged or stricter; native `allowed_origins` still a single exact origin.
6. Before running a build against a live OpenAI project, the operator uses a dedicated project with a restricted key and a low budget, and revokes or rotates the key afterwards (see [API setup](extension/native/API_SETUP.md)).

The gate lowers risk. It does not prove the absence of vulnerabilities. The 2026-10-24 baseline results are in [threat model §10](docs/security/THREAT_MODEL.md#10-release-gate-and-baseline-scans).
