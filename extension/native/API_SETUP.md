# Consented OpenAI native bridge

The Chrome extension’s matching window uses a stdio-only native helper registered for its pinned extension ID. There is no localhost HTTP inference listener or Ollama daemon. The browser cannot provide credentials, prompts, endpoints, model settings or tool definitions.

## Setup on macOS

Use a functioning Node 20+ runtime. Build the extension, then run from the repository root:

```sh
node extension/native/install.mjs --manifest extension/dist/manifest.json
node extension/native/credentials-setup.mjs configure
node extension/native/credentials-setup.mjs status
```

`extension/dist` is the primary Version B build; `dist-b` has the same identity and interface. Install the final helper **before** credential configuration. The installer copies the current bridge code, compiles the Keychain helper, registers `com.treatable.local` and pins `process.execPath` in its launcher. Reinstall after replacing or moving that Node executable or updating native source. It changes only Treatable’s own registration/helper and retains the dedicated Keychain item.

Credential setup prompts in an interactive terminal with echo disabled. It stores only the dedicated macOS Keychain item (`com.treatable.hackathon.openai`, account `api-key`), using the installed helper when present. Never pass a key in an argument, environment variable, browser, chat, configuration file or logs. Installation and configuration do not make provider requests. Keychain may request access; replacing the helper can require access approval again.

`credentials-setup.mjs status` reads metadata only; `configured: true` is not API authentication. `remove` removes only this dedicated item. `build` compiles without reading credentials. Actual account/API/model access needs an explicitly consented live request. The key needs Decisions access plus Agents `api.agents.read`, `api.agents.write` and `api.responses.write` permissions.

### This checkout’s runtime prerequisite

The prior installed Homebrew Node executable could not start because its `libcrypto.4.dylib` dependency was missing. The native installation has been refreshed using the working bundled Node 24.22.1 runtime. Native stdio status is now successful and reports provider `openai`. The user has securely configured the dedicated key; safe metadata reports **`configured: true`**. Configuration does not need to be repeated. The bounded live-check results are recorded below.

For a future fresh setup or deliberate credential replacement, this checkout’s secure configuration command is independent of the terminal’s working directory:

```sh
/Users/LenovoT440p/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /Users/LenovoT440p/work/treatable/extension/native/credentials-setup.mjs configure
```

That path is machine-specific. On another computer, use its working Node runtime. Do not copy a key into this command; the helper requests it privately in the terminal.

## Current-page analysis

The protected `private-match.html` window is non-web-accessible and must match its registered top-level window/document/source context. The website overlay and badge frames cannot invoke native model operations.

- `liveCatalog` fetches fresh official ClinicalTrials.gov records for **all loaded current-page NCT IDs, maximum 10**. It checks TLS, strict record/response IDs, byte/time bounds and bounded concurrency. Immutable public evidence snapshots expire after five minutes. Condition labels come from these records, not the older bundled corpus. Missing facts stay unknown; truncation is visible.
- `prepareLive` requires the current policy receipt and a strict minimized packet: age band, optional US state/sex, 1–6 explicitly selected public condition IDs, every loaded NCT ID for Decisions, and 1–2 selected NCT IDs for Agents. No provider call occurs. The helper pins both exact API bodies and public tool outputs to a digest and opaque five-minute token bound to the source snapshot/query/profile.
- `executeLive` accepts only that pinned token/digest/current receipt and an operation. It cannot replace the packet, evidence or tools. Each operation is one-use. Changed form/source, revocation, expiry, disconnect and cancellation invalidate relevant state. Model request bodies exclude local authorization/binding IDs, tokens, digest, operator/contact text and patient identity fields.
- `scoreLive` makes one `POST https://api.openai.com/v1/decisions` with `gpt-6-luna` and one typed relevance question per loaded record. The index is neither eligibility, enrollment probability, safety nor benefit. Apply requires a full validated score map for the same page; larger/partial pages are not ranked.
- `agentLive` uses `POST https://api.openai.com/v1/agents/sessions`, `OpenAI-Beta: agents=v1`, `gpt-6-astra`, `environment.type: none` and one read-only `get_public_trial_evidence` function restricted to the selected 1–2 NCT IDs. It must read each study, complete its turn, and return known study/question/caution IDs. Trusted templates render the result. Agents does not consume Decisions scores.

There is no Responses-API substitution or fabricated live mode. Stub transports return `mode: test`; production results require validated provider responses. Public text is untrusted data and model authority is bounded; this is not an absolute guarantee against influence on allowed choices.

## Retained fictional and snapshot paths

The older protected panel retains `scoreDemo`/`agentDemo`: one compiled fictional profile and two fixed public study excerpts, with explicit preview and consent. The separate `prepareReal`/`executeReal` path uses up to two native-owned snapshot records and the matching 3,514-label vocabulary from the bundled 2,000-record corpus. That path’s snapshot limit does **not** apply to current-page matching.

Both paths reject arbitrary raw patient text, notes, page text, names, exact age/ZIP/coordinates, endpoints, prompts, tools and credentials. Minimized health labels, age band and optional state/sex remain sensitive and potentially identifying; no anonymity, HIPAA certification or legal sufficiency is claimed.

## Provider and lifecycle limits

Decisions has a 25-second timeout; Agents has 90 seconds, at most six tool calls, bounded HTTP/SSE bodies and at most 16 KB final JSON. Low reasoning/verbosity, short schemas, output-byte/time bounds and two-study scope bound work; they are not a provider billing cap. No unsupported max-output-token parameter is invented.

Requests go to the fixed TLS provider host with certificate verification and no redirects. The launcher starts Node in an empty environment with only non-secret HOME/PATH, avoiding inherited proxy/Node/TLS routing flags. Keys exist only in the dedicated Keychain item and transient native memory; status does not expose the value.

Stop/stdio EOF aborts work, requests cancellation for incomplete/active turns with a fresh cleanup budget, then attempts session DELETE with bounded polling/retries (at most 5.5 seconds). Cancellation acceptance is not completion. Only the validated deletion acknowledgment is labeled deleted. Agents stores application state until deletion and is not a ZDR endpoint; successful DELETE does not promise immediate physical erasure. Creation failure before receiving a session ID leaves cleanup unconfirmed. Failure stays visible in the in-memory trace; no history is retained after the private window ends. Cleanup diagnostics contain only an allowlisted reason, bounded HTTP status and 0–2 deletion attempts. They exclude response bodies, headers, URLs and provider session IDs.

OpenAI default abuse monitoring may retain content for up to 30 days, subject to legal exceptions; API data is not used for training by default. The notice and exact-payload confirmation precede real-data sends. Closing local UI cannot retract data already sent to the provider.

Raw private state ends with the protected window/native session. After explicit Apply, only validated NCT IDs, derived scores and fixed compatibility buckets remain in tab-bound extension RAM for at most five minutes. No browser profile or credential persistence, and no service-worker storage fallback, is used. The dedicated OS Keychain credential deliberately persists until removed. Application clearing is not forensic erasure and cannot defend against a compromised browser/OS, same-user malware or administrator access.

## Verification

At source checkpoint `2acc6a2`, 55 native tests pass alongside 118 extension tests, typecheck and all three builds. Tests use fake Keychain helpers and intercepted provider transports, including strict request serialization, source/packet/token binding, replay/expiry, unknown-field rejection, key/canary non-egress, required evidence calls, fatal/incomplete event handling and cleanup failures. These are automated boundary checks, not live API acceptance.

On the current machine, repaired native stdio status passes; the securely configured key reports `configured: true`. The installed helper fetched public Gov record `NCT06567886` through its real `liveCatalog` operation, and all 14 installed native/shared files match source. The diagnostic-source refresh preserved the Keychain helper binary’s hash, inode and modification time. Both B build folders and the refreshed B archive match across all 18 files.

Authorized live checks used fictional profile values and public evidence: **one Decisions request and two Agents tasks total**. The initial `45_59` / female example with a public condition label returned a validated live Decisions score for one study. Its Agents task completed the required public-evidence call and valid study/template output, but produced **no validated deletion acknowledgment**. Deletion of that first session remains unconfirmed; its original trace did not identify an HTTP status or failure cause.

A separately authorized Agents-only probe then completed one required evidence call, validated its study/question IDs and received the exact deletion acknowledgment after two attempts. Task request to completion took 10.925 seconds; cleanup took 2.872 seconds; request to result took 13.798 seconds. The later session is acknowledged deleted; this does not establish deletion of the first session or explain its failure. No Decisions request was repeated. No further authenticated calls were made.

Actual Chrome rendering and the Chrome-to-native handshake remain outstanding. Any further live check requires an explicit bounded scope; identify fictional inputs clearly and inspect the exact preview. The current-page transport remains labeled as real analysis even when the presenter enters fictional example values. Show request and cleanup failures honestly.

Official contracts: [Decisions](https://developers.openai.com/api/docs/guides/decisions), [create decision](https://developers.openai.com/api/reference/resources/decisions/methods/create), [Agents create](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/create), [functions](https://developers.openai.com/api/docs/guides/agents-api/tools/functions), [events](https://developers.openai.com/api/docs/guides/agents-api/sessions/events), [session deletion](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage), [data controls](https://developers.openai.com/api/docs/guides/your-data).
