# Shared user-facing strings

`strings.en.json` is the single source of wording for notices, disclosures, disclaimers, errors, consent steps, trace labels, and operator details in every Treatable platform UI (iOS and Android through the Expo app, macOS, Windows, and Linux). Platforms render these strings. They do not reword them. This keeps the privacy and health-data wording identical everywhere.

## Rules for platforms

- Never edit, shorten, paraphrase, or translate a string inside a platform folder. To change wording, change `core/strings/strings.en.json` and run the test below. A platform build must copy the file byte for byte. A platform test may compare its bundled copy to this file by SHA-256 digest.
- Look strings up by key. Do not search for text, and do not depend on the order of keys in the file. JSON object order is not part of the contract.
- Skip every key that starts with `_todo.`. Those keys are notes for maintainers about wording that is still waiting for a source. They are not user-facing.
- Do not add platform-only copies of disclosures, error messages, or disclaimers. If a platform needs a new string, add a key here.
- A control label that only one platform needs (for example a window title) may live in that platform. Anything that states what data goes where, what is retained, what a result means, or what an error did to the user's data must come from this file.

## Format

- One flat JSON object. Every key is a dotted path and every value is a plain string.
- Values are printable ASCII on a single line, with no HTML, no Markdown, and no leading or trailing spaces. Platforms add their own line breaks between the strings they show.
- Placeholders, if one is ever added, use the form `{name}` with a lower camel case name. The current file has none.
- The file is English only (`strings.en.json`). A future translation would add a sibling file with the same keys.

## Key naming

Keys use lower camel case segments joined by dots. The first segment is the namespace.

| Namespace | Use |
| --- | --- |
| `app` | Product name and one-line purpose. |
| `disclaimer` | Statements that must always be reachable: the persistent line, what a score means, distance, unknown eligibility, draft-only participation help, and the limits on any health or compliance claim. |
| `operator` | Operator name and privacy contact. These are for display only and are never model input. |
| `disclosure` | Short statements of what ClinicalTrials.gov receives, what OpenAI receives, provider retention, the credential store, and the limits of the protections. |
| `notice` | The scrollable privacy and health-data notice: title, numbered sections, end marker, and the acknowledgment controls. |
| `consent` | Request preview, digest, expiry, separate send confirmation, and send or stop controls. |
| `payload` | Labels for the fields a person chooses to share. |
| `credential` | The user's own OpenAI API key and the operating system credential store. |
| `error` | User-facing failure messages. |
| `trace` | The session-only trace: Mocked and Live labels, stage labels, and cleanup outcomes. |
| `session` | End session wording and what is and is not cleared. |
| `cache` | The public study data cache label. |
| `record` | Labels for the source link and retrieval time shown on each study record. |

Notice sections are numbered so that every platform shows them in the same order: `notice.section.01.heading`, `notice.section.01.body`, `notice.section.02.heading`, and so on. A platform renders all sections it finds, sorted by the two-digit number, followed by `notice.endMarker`. The acknowledgment control stays disabled until the person has scrolled to the end marker.

Several sentences are intentionally repeated: a notice section contains the exact text of the matching `disclosure.*`, `disclaimer.*`, or `operator.*` key. The test checks that the copies stay identical. Edit the source key and the notice section together.

## The persistent line

`disclaimer.persistent` ("Research information, not medical advice.") must stay visible on every screen that shows study results or the OpenAI flow. Pair it with `disclaimer.matchingLimits` where space allows.

## Open items

These keys hold placeholder wording because the source facts are not confirmed yet. Each has a `_todo.*` note.

- `disclosure.decisionsRetention` and `notice.section.06.body`: how long OpenAI retains Decisions API data, including default abuse-monitoring retention and model-training use. The wording is deliberately limited to saying that Treatable has not confirmed it. Confirm against `docs/apps/openai-contracts.md` (task A0), then replace it. The older extension notice stated a 30-day abuse-monitoring period and a default of no model training; that text was not carried over because it has not been re-checked against the current documentation.
- `disclosure.ctgov.body` and `notice.section.02.body`: confirm with task A2 that the live ClinicalTrials.gov request carries only search terms, the country, and at most a US state.

## The claims scan

`claims.test.mjs` has no dependencies. Run it from the repository root:

```sh
node --test core/strings/claims.test.mjs
```

It does three things.

1. It checks `strings.en.json`: every value is a non-empty plain string, keys are unique and follow the naming rules, all required keys exist, the required wording is present, and repeated sentences match their source.
2. It scans `strings.en.json` and every `.md`, `.json`, `.xcstrings`, `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.swift`, `.kt`, `.cs`, `.xaml`, `.ui`, `.blp`, `.iss`, `.desktop`, `.plist`, `.xml`, `.strings`, `.resx`, `.html`, `.txt`, and `.rtf` file under `core/`, `desktop-helper/`, `docs/apps/`, and, when they exist, `mobile/`, `macos/`, `windows/`, and `linux/`. It skips `node_modules`, `dist`, `build`, other build and tool directories, `package-lock.json`, and the test file that defines the rules.
3. It runs a self-test that shows every banned pattern is caught on sample text and every allowed negation passes.

What the scan looks for: HIPAA and other compliance labels, protected-health-information readiness labels, wording that presents a business associate agreement check as verified, wording that calls the app or its storage safe or protected, assurance words, clinical-validity and certification claims, anonymity and de-identification claims, statements that data stays on a device, encryption claims, marketing claims about privacy or accuracy, and the common word for non-public used as prose. The exact patterns and their samples are in the test file. Describe mechanisms, not assurances.

How the scan reads each file type:

- A statement that denies the claim passes. The sentence "Not PHI-ready by default." and the phrase "is not anonymous" are allowed because a negator sits directly before the claim in the same sentence. Absolute statements that data stays on a device, and the safe or protected wording, are never excused by a negator. A list such as "not X, Y, or Z" excuses only X, so negate each phrase or reword the sentence.
- Source code files (`.ts`, `.swift`, `.kt`, `.cs`, and similar) are scanned only inside string literals and comments. Keywords and identifiers, including the `private` modifier, are not claims.
- JSON files are scanned by their string values and by keys that hold text or objects. Keys whose value is a boolean, number, or null (for example `"private": true` in a package file) are configuration flags and are skipped.
- Markdown code fences and inline code may show source keywords. All other rules still apply inside them.
- Recorded public registry responses can quote study sponsors in words this scan bans. A reviewer may add the exact repository-relative path of such a JSON file to `EXEMPT_RECORDED_PUBLIC_DATA` in the test file. The list starts empty, and strings and documents are never exempt.
- A short list of mechanism names is allowed because it names an operating system or library feature, not a promise: `expo-secure-store`, the platform secure storage, enclave, context, and random-number names, and encrypted EBS volumes for test infrastructure. The list is in `MECHANISM_NAMES` in the test file, with samples.

If the scan flags wording you believe is legitimate, change the wording to describe the mechanism. Do not weaken a rule without a review of the claims policy. The scan is a guard against known phrases. It is not a legal or compliance review, and a clean result does not mean the wording is accurate.
