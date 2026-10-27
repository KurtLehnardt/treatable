# Consented OpenAI native bridge

The Chrome extension’s matching window uses a stdio-only native helper registered for its pinned extension ID. The helper has no HTTP listener of its own. When the user chooses Settings → Model provider → Local model, the helper starts a private `ollama serve` for that purpose only (see [Local model](#local-model-ollama-on-this-device)); it never uses the user's own Ollama daemon. The browser cannot provide credentials, prompts, endpoints, model settings or tool definitions.

## Setup on macOS

Use a functioning Node 20+ runtime. Build the extension, then run from the repository root:

```sh
node extension/native/install.mjs --manifest extension/dist/manifest.json
node extension/native/credentials-setup.mjs configure
node extension/native/credentials-setup.mjs status
```

`extension/dist` is the only build. Install the final helper **before** credential configuration. The installer copies the current bridge code, compiles the Keychain helper, registers `com.treatable.local` and pins `process.execPath` in its launcher. Reinstall after replacing or moving that Node executable or updating native source. It changes only Treatable’s own registration/helper and retains the dedicated Keychain item.

Credential setup prompts in an interactive terminal with echo disabled. It stores only the dedicated macOS Keychain item (service `com.treatable.openai`, account `api-key`, label “Treatable OpenAI API key”, not synchronized to other devices), using the installed helper when present. Never pass a key in an argument, environment variable, browser, chat, configuration file or logs. Installation and configuration do not make provider requests. Keychain may request access; replacing the helper can require access approval again.

`credentials-setup.mjs status` reads metadata only; `configured: true` is not API authentication. `migrate` moves a key saved by an earlier version (see below). `remove` removes only this dedicated item and any item left by an earlier version. `build` compiles without reading credentials. Actual account/API/model access needs an explicitly consented live request. The key needs Decisions access plus Agents `api.agents.read`, `api.agents.write` and `api.responses.write` permissions.

### Upgrading from an earlier version: Keychain item rename

Earlier versions stored the key in a Keychain item under a different service name. The current helper moves it to `com.treatable.openai`; nothing has to be re-entered.

1. After updating the source, rebuild the extension and **reinstall the native helper**: `node extension/native/install.mjs --manifest extension/dist/manifest.json`. A helper installed by an earlier version keeps using the earlier item, and `credentials-setup.mjs` refuses to run `configure`, `migrate` or `remove` with it until it is reinstalled.
2. `node extension/native/credentials-setup.mjs status` reports `configured: true` when either item exists and says whether a migration is pending.
3. Run `node extension/native/credentials-setup.mjs migrate` once. If you skip this, the helper migrates on its next key read when only the earlier item exists.
4. macOS may prompt for Keychain access, usually once, asking whether `treatable-keychain` may use the earlier item, because the reinstalled helper is a new binary. Allow it to complete the migration. If you decline, nothing changes. During an analysis request the key read times out after 15 seconds, so an unanswered prompt fails that request with the missing-key message; running `migrate` in Terminal avoids this.

The helper copies the key into the new item with the same attributes `configure` uses (a generic password that is not synchronizable), reads it back to verify it, and only then deletes the earlier item. If the copy or its verification fails, the earlier item stays in place and Treatable keeps using it; run `migrate` again later. If only the deletion of the earlier item fails or is interrupted, Treatable uses the new item, and `status` reports a pending migration until `migrate` or `configure` removes the earlier item. If the earlier item does not hold an accepted key, nothing is moved and `migrate` asks you to run `configure`. The key moves only inside the helper process: it is never printed, logged, written to a file, or passed through arguments or environment variables. `configure` writes only the new item and then removes the earlier one.

### Node runtime prerequisite

The installer pins the Node executable that ran it (`process.execPath`) in its launcher. If that executable later fails to start, for example because a package-manager Node lost a shared library such as `libcrypto`, rerun the installer with a working Node 20+ from your `PATH`.

`credentials-setup.mjs` does not depend on the terminal’s working directory, so it can also be run with an absolute path to your checkout:

```sh
node "$HOME/path/to/treatable/extension/native/credentials-setup.mjs" configure
```

Replace the path with your checkout’s location. Do not copy a key into this command; the helper requests it privately in the terminal.

## Current-page analysis

The protected `private-match.html` window is non-web-accessible and must match its registered top-level window/document/source context. The website overlay and badge frames cannot invoke native model operations.

- `liveCatalog` fetches fresh official ClinicalTrials.gov records for **all loaded current-page NCT IDs, maximum 10**. It checks TLS, strict record/response IDs, byte/time bounds and bounded concurrency. Immutable public evidence snapshots expire after five minutes. Condition labels come from these records, not the older bundled corpus. Missing facts stay unknown; truncation is visible.
- `prepareLive` requires the current policy receipt and a strict minimized packet: age band, optional US state/sex, 1–6 explicitly selected public condition IDs, every loaded NCT ID for Decisions, and 1–2 selected NCT IDs for Agents. No provider call occurs. The helper pins both exact API bodies and public tool outputs to a digest and opaque five-minute token bound to the source snapshot/query/profile.
- `executeLive` accepts only that pinned token/digest/current receipt and an operation. It cannot replace the packet, evidence or tools. Each operation is one-use. Changed form/source, revocation, expiry, disconnect and cancellation invalidate relevant state. Model request bodies exclude local authorization/binding IDs, tokens, digest, operator/contact text and patient identity fields.
- `scoreLive` makes one `POST https://api.openai.com/v1/decisions` with `gpt-6-luna` and one typed relevance question per loaded record. The index is neither eligibility, enrollment probability, safety nor benefit. Apply requires a full validated score map for the same page; larger/partial pages are not ranked.
- `agentLive` uses `POST https://api.openai.com/v1/agents/sessions`, `OpenAI-Beta: agents=v1`, `gpt-6-astra`, `environment.type: none` and one read-only `get_public_trial_evidence` function restricted to the selected 1–2 NCT IDs. It must read each study, complete its turn, and return known study/question/caution IDs. Trusted templates render the result. Agents does not consume Decisions scores.

### AI-matched results ranking

- `prepareRank` accepts 1–10 visible NCT IDs, a minimized profile and an optional provider: 1–6 condition terms (at most 80 characters; digits only inside a name such as `COVID-19` or after words such as Type or Stage; no standalone numbers, dates, three-digit runs or age phrases) and nothing else (the profile is exactly `{conditions}`; an age band, sex or any other key is refused, and the extension keeps age and sex for on-device record checks), and `provider: "local"` with an installed Ollama `model` name. Nothing else is accepted. The helper fetches the public records itself, builds the provider request, and pins it to a digest and a one-use five-minute token. No model call occurs.
- `executeRank` accepts only that token and digest. With OpenAI it makes one `POST https://api.openai.com/v1/decisions` with `gpt-6-luna` and one score question per study (four levels); the reply must hold exactly one score per study with level probabilities that add up to 1. With the local provider it reads no key and runs `local-rank.mjs` on this device, one study per request; a study it cannot score carries only a `failure` code. The result is `{nctId, score 0-100, reasonId, probabilities?}` or `{nctId, failure}` per study. `revokeRank` drops the pinned request.
- The extension shows the first OpenAI ranking of a browser session in a separate confirmation window before `executeRank`. The local provider needs no confirmation because nothing leaves the device.

There is no Responses-API substitution or fabricated live mode. Stub transports return `mode: test`; production results require validated provider responses. Public text is untrusted data and model authority is bounded; this is not an absolute guarantee against influence on allowed choices.

## Local model (Ollama on this device)

The `localModels` operation takes no input. It finds Ollama only at `/opt/homebrew/bin/ollama`, `/usr/local/bin/ollama` or `/Applications/Ollama.app/Contents/Resources/ollama` (never through PATH), profiles the machine (total memory, CPU brand and architecture, Apple Silicon unified memory, free disk), lists installed models that can generate text and recommends one, or suggests an `ollama pull` command. It never downloads anything.

A local brief is prepared like an OpenAI brief (`prepareStudyBrief` with `provider: 'local'` and an installed model name), and the first local request is pinned and digested at preparation. Execution reads no credential. The helper starts `ollama serve` through `local-watchdog.mjs` with `OLLAMA_HOST=127.0.0.1:<ephemeral port>`, `OLLAMA_NO_CLOUD=1`, `OLLAMA_NOPRUNE=1`, `OLLAMA_MODELS=~/.ollama/models`, one loaded model, a minimal environment (`PATH=/usr/bin:/bin` and a private empty `HOME`), and checks with `lsof` that the listening socket on that port belongs to the process it started before every request. Requests go straight to that loopback port with no proxy. Step 1 has a 150-second limit and step 2 a 75-second limit, both capped by `budgetMs`, which the browser broker sets to the time left in its study session (it refuses to start a local brief with less than 45 seconds left); Stop cancels the request. `serve` runs in its own process group. The watchdog stops that whole group (including model runners) and removes the private home when the helper's pipe closes, so a helper that Chrome kills leaves nothing behind; the helper also stops the runtime after five idle minutes. The check needs Ollama 0.5 or later for JSON-schema structured outputs; an older runtime is listed without a recommendation. Memory fit counts the weights, the key/value cache for a 24K-token context (from the runtime's `model_info`, or 15% of the weights when unknown) and compute buffers: comfortable at up to half of memory, never recommended above 60%.

Reinstall the helper after updating native source so the local model files are copied:

```sh
node extension/native/install.mjs --manifest extension/dist/manifest.json
```

## Retained fictional and snapshot paths

The helper retains `scoreDemo`/`agentDemo` from the retired protected panel (no extension page calls them now): one compiled fictional profile and two fixed public study excerpts, with explicit preview and consent. The separate `prepareReal`/`executeReal` path uses up to two native-owned snapshot records and the matching 3,514-label vocabulary from the bundled 2,000-record corpus. That path’s snapshot limit does **not** apply to current-page matching.

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

Actual Chrome rendering and the Chrome-to-native handshake remain outstanding. Any further live check requires an explicit bounded scope; identify fictional inputs clearly and inspect the exact preview. The current-page transport remains labeled as real analysis even when the operator enters fictional example values. Show request and cleanup failures honestly.

Official contracts: [Decisions](https://developers.openai.com/api/docs/guides/decisions), [create decision](https://developers.openai.com/api/reference/resources/decisions/methods/create), [Agents create](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/create), [functions](https://developers.openai.com/api/docs/guides/agents-api/tools/functions), [events](https://developers.openai.com/api/docs/guides/agents-api/sessions/events), [session deletion](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage), [data controls](https://developers.openai.com/api/docs/guides/your-data).
