# Consented OpenAI native bridge

This native helper has no HTTP listener and no Ollama daemon. It accepts only the pinned Chrome extension origin over native-messaging stdio. Raw patient form values, notes, page text, arbitrary prompts, URLs, tool definitions and credentials are not accepted operations. The default demo remains fictional. The separately consented real-data path accepts only a coarse age band, optional US state/sex, explicitly selected IDs from the public condition-label catalog, and at most two selected public NCT IDs.

## Setup on macOS

Build the extension, then run from the repository root:

```sh
node extension/native/install.mjs --manifest extension/dist-b/manifest.json
node extension/native/credentials-setup.mjs configure
```

The second command uses the final installed helper binary when available, prompts in a terminal with echo disabled, and stores the API key only in the dedicated macOS Keychain item (`com.treatable.hackathon.openai`, account `api-key`). Do not pass a key in an argument, environment variable, browser, chat or configuration file. Neither command makes a provider request. Keychain may prompt for native access; rebuilding/replacing the helper can require access approval again.

`credentials-setup.mjs status` checks metadata, not API authorization. `credentials-setup.mjs remove` removes only that dedicated item. `credentials-setup.mjs build` compiles without accessing credentials.

The native status response distinguishes helper readiness and credential presence from API authentication/access. Actual API access remains unverified until the user configures a dedicated key and explicitly starts a previewed fictional run. The key needs Decisions access plus Agents `api.agents.read`, `api.agents.write` and `api.responses.write` permissions. Account/model/API availability has not been tested.

## Live flow and limits

- `scoreDemo`: one `POST https://api.openai.com/v1/decisions`, `gpt-6-luna`, two fixed public records and one clearly fictional profile. The score is a weighted rubric index, not enrollment probability or treatment benefit.
- `agentDemo`: `POST /v1/agents/sessions`, `OpenAI-Beta: agents=v1`, `gpt-6-astra`, `environment.type: none`, one read-only `get_public_trial_evidence` function. Tool arguments can only name the fixture's public NCT records. The helper posts matching `agent.session.input.tool_result` events, requires observed evidence-tool results for every study plus a completed turn, and accepts only known NCT/question/caution IDs.
- No Responses-API substitution or locally fabricated “live” result. Stubbed tests return `mode: test`; production transport returns `mode: live` only after validated API responses.
- Decisions timeout: 25 seconds. Agent timeout: 90 seconds. At most six tool calls, 16 KB final agent JSON, bounded HTTP/SSE bodies. The documented Agents create schema has no max-output-token field; no unsupported parameter is invented. Low reasoning/verbosity, short schema, output-byte/time limits and two-study scope bound the demo, but are not a provider billing hard cap.
- Provider requests go directly to the fixed TLS host with certificate verification and no redirects. The launcher starts Node in an empty environment with only non-secret HOME/PATH, preventing inherited proxy/Node/TLS flags.
- Cancel/stdio EOF aborts work and requests cancellation for incomplete/active turns with a fresh cleanup budget, then attempts session DELETE with bounded polling/retries (at most 5.5 seconds total). Cancellation acceptance is not completion. The helper validates the exact deletion acknowledgement before labeling it deleted. No untrusted session-ID path component is used. A successful API DELETE is not a promise of immediate physical erasure. Agents retains provider state until deletion and is not a ZDR endpoint. If creation disconnects before the session ID is received, deletion cannot target that unknown session; cleanup is marked unconfirmed. Cleanup failure is explicit in the in-memory trace; after a panel closes there is no retained trace/history.
- The default demo sends only fictional/public data. The real-data path is separately policy-gated: `prepareReal` is local-only, validates the minimized packet and current policy receipt, loads native-owned public records, and pins both exact API request bodies plus public tool evidence. It returns a SHA-256 digest and an opaque five-minute RAM token. `executeReal` accepts only that token/digest/current receipt and one operation; it cannot replace the prepared data. Each operation is one-use. New preparation, revocation, cancellation, panel disconnect and TTL expiry clear the cache and abort relevant work. Unknown/private fields, stale policy, unknown conditions or studies, changed receipts and replay fail before credentials or network access. Conditions require explicit selection; the 3,514 public snapshot labels are not a MeSH ontology or automated diagnosis mapping. The native catalog contains the same 2,000 records and source hash as the UI. Minimized health data is still sensitive and is not claimed anonymous, HIPAA-certified or legally certified.

## Evidence and limits

The Swift Security helper was compiled after Apple documentation lookup; local Xcode documentation bridge was unavailable, so official Apple Security documentation supplied API behavior. Tests use fake Keychain executables and stub provider transports. No user credential was read, no Chrome/native registration was changed outside isolated test homes, and no live API request was made.

JavaScript/OS memory cannot be promised forensically erased, nor can this design defend against same-user administrator malware or a compromised browser/OS.

Official contracts: [Decisions](https://developers.openai.com/api/docs/guides/decisions), [create decision](https://developers.openai.com/api/reference/resources/decisions/methods/create), [Agents create](https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/create), [functions](https://developers.openai.com/api/docs/guides/agents-api/tools/functions), [events](https://developers.openai.com/api/docs/guides/agents-api/sessions/events), [session deletion](https://developers.openai.com/api/docs/guides/agents-api/sessions/manage), [data controls](https://developers.openai.com/api/docs/guides/your-data).

## Real-data verification

Seven additional tests cover the full catalog hash, strict packet boundaries, pinned two-operation previews, policy/digest/token replay and TTL rejection, and actual native stdio through the intercepted HTTPS serializer. Six generated API requests match only the exact consented bodies/public tool evidence; caller RPC IDs, tokens, digest, operator/contact text and unauthorized canaries are absent. This is intercepted test traffic with fake credentials, not a live OpenAI run. Existing 14 native lifecycle/protocol tests remain passing.
