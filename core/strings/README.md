# Shared user-facing strings

`strings.en.json` is the single source of wording for notices, disclosures, disclaimers, errors, consent steps, trace labels, and operator details in every Treatable platform UI (iOS and Android through the Expo app, macOS, Windows, and Linux). Platforms render these strings. They do not reword them. This keeps the privacy and health-data wording identical everywhere.

## Rules for platforms

- Never edit, shorten, paraphrase, or translate a string inside a platform folder. To change wording, change `core/strings/strings.en.json` and run the test below. A platform build must copy the file byte for byte. A platform test may compare its bundled copy to this file by SHA-256 digest.
- Look strings up by key. Do not search for text, and do not depend on the order of keys in the file. JSON object order is not part of the contract.
- Skip every key that starts with `_todo.`. Those keys are notes for maintainers about wording that still waits for a source or a decision. They are not user-facing.
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
| `disclaimer` | Statements that must always be reachable: the persistent line, what a score means, distance, unknown eligibility, draft-only participation help, that model-written comparisons can be wrong, and the limits on any health or compliance claim. |
| `operator` | Operator name and privacy contact. These are for display only and are never model input. |
| `disclosure` | Short statements of what ClinicalTrials.gov receives, what OpenAI receives, provider retention, tracing, logs, training, the credential system, and the limits of the protections. |
| `notice` | The scrollable privacy and health-data notice: title, numbered sections, end marker, and the acknowledgment controls. |
| `consent` | Request preview, digest, expiry, separate send confirmation, and send or stop controls. |
| `payload` | Labels for the fields a person chooses to share. |
| `credential` | The user's own OpenAI API key and the storage that uses the operating system's credential system. |
| `error` | User-facing failure messages. |
| `trace` | The session-only trace: Mocked and Live labels, stage labels, and cleanup outcomes. |
| `session` | End session wording and what is and is not removed. |
| `cache` | The public study data cache label. |
| `record` | Labels for the source link and retrieval time shown on each study record. |

Notice sections are numbered so that every platform shows them in the same order: `notice.section.01.heading`, `notice.section.01.body`, `notice.section.02.heading`, and so on. A platform renders all sections it finds, sorted by the two-digit number, followed by `notice.endMarker`. The acknowledgment control stays disabled until the person has scrolled to the end marker.

Several sentences are intentionally repeated: a notice section contains the exact text of the matching `disclosure.*`, `disclaimer.*`, `consent.*`, or `operator.*` key. The test checks that the copies stay identical. Edit the source key and the notice section together.

## The persistent line

`disclaimer.persistent` ("Research information, not medical advice.") must stay visible on every screen that shows study results or the OpenAI flow. Pair it with `disclaimer.matchingLimits` where space allows.

## Where the provider wording comes from

The OpenAI retention wording follows the contract record in `docs/apps/openai-contracts.md` (task A0, sections 4 and 9) and was checked again on 2026-10-24 against OpenAI's data controls page (`/api/docs/guides/your-data`) and the Agents tracing page (`/api/docs/guides/agents-api/tracing`). The strings state what OpenAI documents and say plainly where the documentation is silent: whether deleting an Agents session removes its trace or its abuse-monitoring log entries is not documented, so the strings do not claim it.

## Open items

Each of these has a `_todo.*` note in the strings file. A release build can be forced to fail while any remain by running the test with `RELEASE=1`.

- `disclosure.ctgov.body` and `notice.section.02.body`: confirm with task A2 that the live ClinicalTrials.gov request carries only the typed search words, the country, and at most a US state.
- `disclosure.decisionsRetention` and `notice.section.06.body`: if task A4 sends Decisions requests in explicit prompt-cache mode with no cache breakpoints, add the sentence about it from `docs/apps/openai-contracts.md` section 9.
- `consent.expiryNote`: confirm with task A4 whether one confirmation covers both the Decisions send and the Agents send. The reviewed extension required one confirmation per operation.
- `cache.description`: confirm with task A2 whether the public study cache outlives the session and whether it stores anything derived from searches. If it does, add that to `session.endNotCleared` and `notice.section.08.body`.

## The claims scan

`claims.test.mjs` has no dependencies. Run it from the repository root:

```sh
node --test core/strings/claims.test.mjs
RELEASE=1 node --test core/strings/claims.test.mjs
```

The second form also fails while any `_todo.*` key remains. The test does three things.

1. It checks `strings.en.json`: every value is a non-empty plain string, keys are unique and follow the naming rules, all required keys exist, the required wording is present, and repeated sentences match their source.
2. It scans `strings.en.json` and the text files under `core/`, `desktop-helper/`, `docs/apps/`, `mobile/`, `macos/`, `windows/`, and `linux/`, plus any root-level file that is not one of the older extension-era files. Folder names are matched without regard to case. A top-level folder, or a folder under `docs/`, that is in neither the scan list nor the list of older work fails the test, so a platform folder with an unexpected name cannot be skipped. The same is true of a file extension: the test lists scanned, non-text, and build-configuration extensions, and fails on any other extension until someone classifies it.
3. It runs a self-test that shows every banned pattern is caught on sample text and every allowed negation passes.

What the rules cover (the patterns and their samples are in the `RULES` array of the test file): compliance and certification labels such as HIPAA and similar names, including noun and reversed forms; readiness labels for protected health information; wording that presents a business associate agreement check as verified; the word for being protected, in adjective and adverb form; assurance words; clinical-validity and testing claims; certification; anonymity and de-identification claims; statements that data is kept only on a device; cryptographic-protection claims; promises about how quickly or how completely data is removed; Zero Data Retention eligibility claims; marketing claims about privacy, grade, accuracy, or regulatory clearance; and the everyday word for non-public used as prose. Describe mechanisms, not assurances.

How the scan reads text:

- Before any rule runs, the text is normalized. Look-alike characters (non-breaking and zero-width characters, soft hyphens, other dashes, full-width letters, curly quotes), HTML entities, Markdown emphasis marks, and HTML comment markers are removed or mapped, and multi-word rules accept hyphens, spaces, and line breaks, so a phrase cannot be hidden by formatting.
- A statement that denies the claim passes. The sentence "Not PHI-ready." and the phrase "is not anonymous" are allowed because a negator (no, not, never, cannot, without, and similar) sits directly before the claim in the same sentence, with at most four short filler words between them. A sentence ends at a period, semicolon, colon, question mark, exclamation mark, or blank line, but not at a single hard line break. A list such as "not X, Y, or Z" excuses only X, so negate each phrase or reword the sentence.
- Some rules are never excused by a negator: the word for being protected, and statements that data is kept only on a device. Reword these to describe the mechanism.
- Source code files are scanned only inside string literals and comments, and for `.tsx` and `.jsx` files also in the text between JSX tags. Keywords and identifiers, including the `private` modifier, are not claims. The word for non-public is still flagged inside a string or a comment, so write "internal" in a code comment.
- JSON files are scanned by their string values and their keys. The one exception is the package field `"private": true`.
- Markdown code fences and inline code may show source keywords. All other rules still apply inside them.
- A short list of mechanism names is allowed because it names an operating system or library feature, not a promise: `expo-secure-store`, the phrases platform secure storage and operating system secure storage, Secure Enclave, secure context, secure random, and encrypted EBS volumes for test infrastructure. The list is `MECHANISM_NAMES` in the test file, with samples, and each allowance is tested to make sure it is not wider than intended.
- Generated and third-party folders (`node_modules`, and build output such as `core/dist`, `mobile/android/app/build`, or `windows/App/bin`) are ignored by exact path. A source folder that merely has a name like `bin` or `build` somewhere else, for example `desktop-helper/bin`, is still scanned.
- Recorded public registry responses and hostile-input test files can quote wording this scan bans. A reviewer may add the exact path of such a test or fixture file to `EXEMPT_FILES` in the test file, with a written reason. Strings and documents are never exempt, and the test checks every entry.

If the scan flags wording you believe is legitimate, change the wording to describe the mechanism. Do not weaken a rule without a review of the claims policy. The scan is a guard against known phrases. It is not a legal or compliance review, and a clean result does not mean the wording is accurate.
