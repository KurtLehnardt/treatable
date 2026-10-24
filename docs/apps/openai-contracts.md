# OpenAI Decisions and Agents API contracts (A0 record)

This document is the dated contract record that the shared core (A1a, A1b, A4, A6) builds against. It records what the official OpenAI documentation said at the time of the check, what the official JavaScript SDK encodes, what a small live probe observed, and every place where the existing extension code disagrees with or goes beyond the documentation. It does not change any product code.

Research information, not medical advice.

## 1. When and how this was checked

| Item | Value |
| --- | --- |
| Documentation fetched | 2026-10-24 between 07:43:49Z and 07:48:00Z (01:43 to 01:48 MDT) |
| Live probe run | 2026-10-24 07:49:21Z to 07:49:45Z |
| Re-check for review round 1 | 2026-10-24 08:06:43Z to 08:08:37Z. The data-controls, Agents errors, rate-limits, Decisions, Agents quickstart, events, multi-agent, API reference overview, streaming-events, and create-session reference pages were fetched again and were byte-identical to the first fetch. The Agents tracing guide and the session-update reference were fetched for the first time. |
| Fetch method | `curl` of each guide page with the `.md` suffix (served as `text/markdown`), plus the HTML of reference pages that have no Markdown twin |
| Earlier local copies | The copies fetched at about 00:02 MDT the same day were compared byte for byte with the live fetch. `decisions.md`, `sessions.md`, `events.md`, the three Agents guide pages, `llms.txt`, and `api/llms.txt` were identical. |
| SDK cross-check | Official `openai` npm package 7.43.0 (`resources/decisions.*`, `resources/beta/agents/**`, `lib/beta/agents/**`) |

Pages read (the hash is the first 12 hex characters of the SHA-256 of the fetched body):

| Page | URL | SHA-256 prefix |
| --- | --- | --- |
| Decisions guide | https://developers.openai.com/api/docs/guides/decisions | `70f106a9a7f1` |
| Create a decision (reference, HTML) | https://developers.openai.com/api/reference/resources/decisions/methods/create | `c387f3763997` |
| Agents API quickstart | https://developers.openai.com/api/docs/guides/agents-api/quickstart | `139335def940` |
| Agents API overview | https://developers.openai.com/api/docs/guides/agents-api/overview | `86d6e3e2d71e` |
| Configuring Agents | https://developers.openai.com/api/docs/guides/agents-api/configuration | `d1ee65500118` |
| Run and continue sessions | https://developers.openai.com/api/docs/guides/agents-api/sessions | `36ca5b56d584` |
| Events and items | https://developers.openai.com/api/docs/guides/agents-api/sessions/events | `bfe4c1f8bb9a` |
| Manage sessions | https://developers.openai.com/api/docs/guides/agents-api/sessions/manage | `ff5da02a2b8d` |
| Functions (Agents) | https://developers.openai.com/api/docs/guides/agents-api/tools/functions | `672f81d3c35e` |
| Errors and recovery (Agents) | https://developers.openai.com/api/docs/guides/agents-api/errors | `c2f053fb7218` |
| Architecture (Agents) | https://developers.openai.com/api/docs/guides/agents-api/architecture | `755df9fa1c04` |
| Agents streaming events (reference) | https://developers.openai.com/api/reference/resources/beta/subresources/agents/streaming-events | `2e47a8f7b0fe` |
| Create session (reference, HTML) | https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/create | `2bbc191da9b3` |
| Data controls ("your data") | https://developers.openai.com/api/docs/guides/your-data | `219b705c34aa` |
| Rate limits | https://developers.openai.com/api/docs/guides/rate-limits | `eef6761e0308` |
| Error codes | https://developers.openai.com/api/docs/guides/error-codes | `47865e119fde` |
| Model page: GPT-6 Luna | https://developers.openai.com/api/docs/models/gpt-6-luna | `2e4861582095` |
| Model page: GPT-6 Astra | https://developers.openai.com/api/docs/models/gpt-6-astra | `b7c19b3bb89e` |
| API reference overview (auth, request IDs, compatibility) | https://developers.openai.com/api/reference/overview | `a046d08b9f57` |
| Tracing (Agents) | https://developers.openai.com/api/docs/guides/agents-api/tracing | `fc21a8bb6a6b` |
| Update session (reference, HTML) | https://developers.openai.com/api/reference/resources/beta/subresources/agents/subresources/sessions/methods/update | `c23463351b24` |

Pages that returned HTTP 404 as Markdown: `/api/docs/guides/agents-api/events` and `/api/docs/guides/agents-api/webhooks` (the live paths are `/sessions/events` and `/sessions/webhooks`), and the `.md` twins of the Decisions and Agents reference method pages (the HTML versions exist and were used).

## 2. Decisions API contract

Status: generally available. The guide opens with "The Decisions API is now generally available." (https://developers.openai.com/api/docs/guides/decisions)

### 2.1 Endpoint and headers

| Item | Documented value |
| --- | --- |
| Method and path | `POST https://api.openai.com/v1/decisions` |
| Required headers | `Authorization: Bearer <key>`, `Content-Type: application/json` |
| Beta header | None. The reference cURL example sends only the two headers above, and SDK 7.43.0 `Decisions.create` posts to `/decisions` with no `OpenAI-Beta` header. |
| Streaming | None documented. The response is a single JSON object. |
| Other Decisions endpoints | None for creating, retrieving, or deleting decisions. `GET /v1/organization/usage/decisions` exists for admin usage reporting and needs an admin key; Treatable must not call it. |

### 2.2 Request body

Top-level fields (reference page "Create a decision" and SDK `DecisionCreateParams`):

| Field | Type | Required | Documented constraints |
| --- | --- | --- | --- |
| `model` | string | yes | "Only gpt-6-luna is supported." |
| `input` | string, or ordered array of input items | yes | Items may be user, developer, system, or assistant messages, function calls and outputs, or custom tool calls and outputs. Files, audio, and item references are not supported. |
| `questions` | array | yes | "Ask 1–400 questions about the input." Answers come back in the same order. |
| `prompt_cache_key` | string or null | no | Up to 64 characters. |
| `prompt_cache_options` | object or null | no | `mode`: `"implicit"` (default) or `"explicit"`; `ttl`: only `"30m"`. |
| `safety_identifier` | string or null | no | Up to 128 characters; an opaque end-user identifier. |

There is no `store`, `metadata`, `stream`, or `id` field in the Decisions request.

User message content parts:

| Part | Fields | Documented constraints |
| --- | --- | --- |
| `input_text` | `text`, optional `prompt_cache_breakpoint` | `text` maxLength 10,485,760 |
| `input_image` | `image_url`, optional `detail` | Base64 data URL or public HTTP(S) URL; `file_id` is not supported |
| `input_json` | `data` (object or array of objects) | "Limited to 32 container levels, 10,000 values, and 256 KiB of compact UTF-8 JSON." `input_json` is allowed only in `user` messages. The guide adds: "JSON keys such as `role` or `image_url` inside `data` are ordinary data: they don't create messages or fetch images." |

Question types (all accept `instructions` as a string or an array of `input_text`, `input_image`, and `input_json` parts, plus an optional `name`):

| Type | Extra fields | Constraints |
| --- | --- | --- |
| `predicate` | none | returns a probability |
| `choice` | `choices: [{value, description?}]` | "Provide between 2 and 255 choices. Each choice must be unique." `value` is a string or boolean. |
| `score` | `levels: [{label, description?}]` | The guide says a score question uses "2–10 ordered `levels`", lowest first. Level indices start at 0. |

Prompt caching: "In explicit mode, a request with no marked boundaries doesn't use prompt caching." The existing code relies on this (see section 8).

### 2.3 Response body

The reference "Returns" block is `Decision { answers, model, usage }`. The Decision object has no `id`, so there is nothing to retrieve, cancel, or delete afterwards.

| Field | Shape |
| --- | --- |
| `model` | string (live probe returned `"gpt-6-luna"`) |
| `answers` | array in question order; each item is one of the shapes below |
| `usage` | `{input_tokens, input_tokens_details: {cached_tokens, cache_write_tokens}, output_tokens, output_tokens_details: {reasoning_tokens}, total_tokens}` |

Answer shapes:

| `type` | Fields |
| --- | --- |
| `predicate` | `name` (string or null), `probability` (number) |
| `choice` | `name`, `choice` (string or boolean), `probabilities: [{value, probability}]`, `confidence` |
| `score` | `name`, `score` (number), `probabilities: [{value (integer), label, probability}]`, `confidence` |
| `refusal` | `name` only. The reference says: "Any question can return a refusal instead of an answer; other questions can still receive answers." |

The guide defines `score` as "the probability-weighted average of the level indices" and says it "can fall between levels". It documents no rounding tolerance.

### 2.4 Errors

Decisions has no endpoint-specific error table. The shared error-code and rate-limit guides apply (section 6).

## 3. Agents API contract

Status: beta. The quickstart says: "Requests require the `OpenAI-Beta: agents=v1` header. The OpenAI SDKs add it automatically; include it explicitly when using cURL." (https://developers.openai.com/api/docs/guides/agents-api/quickstart). The configuration guide mentions "beta and GA API contracts" for session updates, but no GA header value or GA contract is documented. Build against the beta contract only.

### 3.1 Authentication

The quickstart requires an application API key with three permissions: "Grant `api.agents.read` and `api.agents.write` for session operations, plus `api.responses.write` for model inference". The documentation does not specify an API key prefix or format.

### 3.2 Endpoints (session subset)

Every request below carries `Authorization: Bearer <key>` and `OpenAI-Beta: agents=v1`. SDK 7.43.0 adds the beta header to every `beta.agents.*` method.

| Purpose | Method and path | Notes |
| --- | --- | --- |
| Create session (optionally stream first turn) | `POST /v1/agents/sessions` | With `"stream": true` the response is `text/event-stream` (live: HTTP 201). Without it, the session object is returned. |
| Retrieve session | `GET /v1/agents/sessions/{session_id}` | Returns status, agent, environment, `required_actions`. |
| Update session settings | `POST /v1/agents/sessions/{session_id}` | Changes `model`, `reasoning.effort`, `service_tier`, `metadata` for later turns. SDK 7.43.0 `SessionUpdateParams` also accepts `spend_control`; the live update reference does not list it. Treatable does not need this endpoint. |
| List sessions | `GET /v1/agents/sessions` | Project-wide listing. Treatable does not need it. |
| Submit input events | `POST /v1/agents/sessions/{session_id}/events` | Body `{"events": [...]}`; used for messages, tool results, and cancellation. SDK sends `Accept: */*` and an optional `Idempotency-Key`. Live: HTTP 202 with an empty body. |
| Stream session events | `GET /v1/agents/sessions/{session_id}/events` with `Accept: text/event-stream` | Used to follow later turns or reconnect. Streams do not replay missed events. |
| List items / turns | `GET /v1/agents/sessions/{session_id}/items`, `/turns`, `/turns/{turn_id}`, `/turns/{turn_id}/items` | Recovery and history. |
| Delete session | `DELETE /v1/agents/sessions/{session_id}` | Returns `{id, object: "agent.session.deleted", deleted: true}`. |

Saved agents (`/v1/agents`), vaults, artifacts, subagents, traces, environments, and automations also exist under the same namespace. Treatable must not call any of them.

### 3.3 Create-session request body

From SDK 7.43.0 `SessionCreateParamsBase` and the create-session reference:

| Field | Type | Notes |
| --- | --- | --- |
| `environment` | object, required | `{"type": "none"}`, `openai_hosted`, `self_hosted`, or prewarmed. The architecture guide says: "Without an environment, the built-in Bash and apply-patch tools, workspace files, and executor MCPs are unavailable." |
| `agent` | object | Required unless `agent_id` is given ("Without `agent_id`, `model` is required."). |
| `agent.model` | string | See section 5. |
| `agent.instructions` | string or null | SDK: "Additional instructions appended to the agent's default base instructions." The harness base instructions are not under Treatable's control. |
| `agent.tools` | array or null | Function, `tool_search`, `programmatic_tool_calling`, `mcp`, `web_search`, `computer_use`. "The resolved tool list must fit within 3 MiB (3,145,728 bytes) of compact UTF-8 JSON." |
| `agent.reasoning` | object or null | `effort`: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; `summary`: `concise`, `detailed`, `auto`. |
| `agent.multi_agent` | object or null | `{enabled: boolean, max_concurrent_subagents?: number}` (default 6 concurrent). |
| `agent.text` | object or null | `format`: `{"type": "text"}` or `{"type": "json_schema", "schema": {...}}` (no `name` or `strict` field); `verbosity`: `low`, `medium`, `high`. |
| `agent.service_tier` | enum or null | `auto`, `default`, `flex`, `priority`, `fast`, `ultrafast`. |
| `input` | string, array of user messages, or null | "A string is shorthand for a single user message. Required when `environment.type` is `none`, or when `stream` is `true` for an environment that is not `self_hosted`." |
| `stream` | boolean | Defaults to `false`. |
| `metadata` | map or null | Up to 16 string pairs; keys up to 64 and values up to 512 characters. |
| `spend_control` | `{limit: number or null}` or null | SDK 7.43.0 only: "Optional spending limit in USD cents. Omission or null creates an unlimited session." The live create-session reference (fetched twice on 2026-10-24) does not list this field; its body parameters are `environment`, `agent`, `agent_id`, `input`, `metadata`, `stream`, and `vault_ids`. Not live-verified. Treat it as undocumented. |
| `agent_id`, `vault_ids` | | Saved agents and vaults; not used by Treatable. |

Size limits: "The agent runtime accepts requests up to 4 MiB (4,194,304 bytes). Keep the combined size of your `input` and output schema (`agent.text.format.schema`) below this limit." Instructions plus tool configuration must also stay below 4 MiB.

### 3.4 Function tools and the tool-call flow

Definition (Functions guide): `{"type": "function", "name", "description", "parameters": <JSON Schema>}` with optional `defer_loading`. There is no `strict` field in the Agents function tool type.

Flow:

1. The stream emits `agent.session.requires_action`. The event carries `session.required_actions`; the guide also allows retrieving the session and reading `session.required_actions`.
2. A function entry currently has the fields `type: "function_call"`, `turn_id`, `call_id`, `name`, and `arguments` (SDK 7.43.0 type and live probe). OpenAI may add fields later (section 6). In the Agents API, `arguments` is a JSON value (the guide example and the live probe both show an object), not a JSON string as in the Responses API.
3. The application returns the result with `POST /v1/agents/sessions/{id}/events` and body `{"events": [{"type": "agent.session.input.tool_result", "turn_id", "call_id", "success": true, "output": "<string or content array>"}]}`. For failure it sends `success: false` and `error`. The guide says "Serialize JSON objects to strings."
4. "The harness continues the turn after it receives the required results." In the live probe the continuation arrived on the same create-session stream.
5. Tool results must stay below 4 MiB. "Use `required_actions` to decide which calls need results; a `function_call` item in session history alone does not establish that a result is pending."

Other required-action types exist (`environment_connection`, `computer_use_approval_request`). With `environment: none` and only a function tool, Treatable should treat any other type as a protocol failure.

### 3.5 Stream events

The streaming events reference lists these types (all carry `event_id`; most carry `session_id` and `turn_id`; `agent.session.created`, `agent.session.idle`, `agent.session.in_progress`, `agent.session.requires_action`, and `agent.session.failed` carry a full `session` object instead): `agent.session.created`, `agent.session.in_progress`, `agent.session.idle`, `agent.session.requires_action`, `agent.session.failed`, `agent.session.turn.created`, `agent.session.turn.in_progress`, `agent.session.turn.completed`, `agent.session.turn.failed`, `agent.session.turn.cancelled`, `agent.session.turn.item.added`, `agent.session.turn.item.done`, `agent.session.turn.content_part.added`, `agent.session.turn.content_part.done`, `agent.session.turn.output_text.delta`, `agent.session.turn.output_text.done`, the reasoning-summary events, the `agent.session.subagent.*` events, the `agent.session.environment.*` events, `agent.output.command_execution_output.delta`, and `error`.

Documented handling rules (Events and items guide):

- "Append `agent.session.turn.output_text.delta` to the relevant content part. When `agent.session.turn.output_text.done` arrives, replace that part with its complete text. Deltas may be absent." Parts are keyed by `item_id`, `output_index`, and `content_index`.
- The turn outcome is `agent.session.turn.completed`, `agent.session.turn.failed`, or `agent.session.turn.cancelled`. "An idle session or a closed stream alone does not establish success." A completed turn does not establish that every tool call succeeded.
- Assistant messages carry `phase`: `commentary` or `final_answer` (SDK `AgentSessionMessage`). The SDK result collector builds `output_text` only from `agent.session.turn.item.done` events whose item is a completed `message` that is not `commentary`, in `output_index` order, and it also waits for `agent.session.idle`.
- An `error` event has `{type, event_id, session_id, error: {type, code, message, param}}`. In the beta API a session's own `error` field is a string or null. The errors guide adds: "An `error` event or a disconnected stream doesn't confirm the turn's final state."
- Subagent attribution: `agent.session.turn.*` events carry a `turn` object whose `subagent_id` is a string or null (null for the root agent; the live probe saw null). The `agent.session.subagent.created`, `.active`, and `.closed` events carry a `subagent` object instead of a `subagent_id`. Item and text events carry `turn_id` but no subagent field.
- Recovery: open a new stream, retrieve the session and saved items, restore state by item ID, then apply buffered updates.

### 3.6 Session lifecycle

| Step | Documented mechanism |
| --- | --- |
| Create and run | `POST /v1/agents/sessions` with `input` and `stream: true` starts the first turn and streams it. |
| Continue or steer | `POST .../events` with `agent.session.input.message`. A message to an idle session starts a new turn; a message during an active turn steers it. The guide recommends one `Idempotency-Key` per logical message submission. |
| Cancel | `POST .../events` with `{"events":[{"type":"agent.session.input.cancel"}]}`. "Cancel the current turn when you want the agent to stop. The session and its previous work remain available." |
| Delete | `DELETE /v1/agents/sessions/{id}`. "Deletion removes the session from the API. Physical cleanup may continue asynchronously." SDK 7.43.0 adds: "Running execution must be cancelled first." The delete ack field `deleted` is documented as "Always `true`." |

### 3.7 Errors

Request errors listed in the Agents errors guide include: 400 `invalid_request_error`, 400 `invalid_beta` ("The `OpenAI-Beta` header contains an invalid value"), 400 `agent_not_persisted`, 400 `invalid_otlp_endpoint` and `invalid_otlp_header` (tracing configuration), 401 `unauthorized`, 403 `forbidden`, 404 `not_found_error` or `model_not_found`, 409 `conflict_error` ("retrieve the current state before retrying"), 409 `executor_version_incompatible`, 424 `mcp_server_startup_failed`, 429 `files_api_rate_limit_exceeded`, 500 `internal_error`, and 503 `service_unavailable_error` or `server_is_overloaded`. The guide says to "Handle unknown codes and a missing `param` without breaking your error handler."

Turn error codes (no HTTP status of their own) include `invalid_request`, `context_length_exceeded`, `session_budget_exceeded`, `credit_balance_exhausted`, `project_spend_limit_exceeded`, `organization_spend_limit_exceeded`, `organization_usage_limit_exceeded`, `usage_limit_exceeded`, `rate_limit_exceeded`, `server_overloaded`, `flex_unavailable`, `connection_failed`, `request_timeout`, `server_error`, `internal_error`, `authentication_error`, `resource_not_found`, `sandbox_error`, `active_turn_not_steerable`, `cyber_policy`, and `misalignment_policy_violation`. Session errors include `idle_timeout`.

Retry guidance: check the outcome first (a session may already exist), honor `Retry-After` on HTTP responses, and set an attempt limit or deadline.

## 4. Retention, tracing, and data-control statements

From the data-controls endpoint table (https://developers.openai.com/api/docs/guides/your-data; cell values verbatim, the last column heading reworded):

| Endpoint | Data used for training | Abuse monitoring retention | Application state retention | Eligible for Zero Data Retention |
| --- | --- | --- | --- | --- |
| `/v1/decisions` | No | 30 days | None, see below for exceptions | Yes, see below for limitations |
| `/v1/agents` | No | 30 days | Until deleted | No |

- Decisions exception (paraphrased from the `/v1/decisions` notes on the same page): prompt caching may store key/value tensors in GPU-local storage as application state, and that data is not retained after a 24-hour expiration. This is OpenAI's description of its own mechanism, not a Treatable statement.
- Agents overview: "The Agents API retains session state so you can continue work across turns without rebuilding the conversation context. You can delete sessions and published artifacts when you no longer need them. The Agents API currently supports data residency only in the United States and does not support Zero Data Retention (ZDR)." The overview adds (paraphrased) that choosing a self-hosted sandbox does not make the Agents API eligible for Zero Data Retention.
- Abuse monitoring: "Abuse monitoring logs may contain certain customer content, such as prompts and responses, as well as metadata derived from that customer content, such as classifier outputs. By default, abuse monitoring logs are generated for all API feature usage and retained for up to 30 days, unless longer retention is required by law, or is reasonably necessary to protect our services or any third party from harm." The endpoint table lists 30-day abuse-monitoring retention for both `/v1/decisions` and `/v1/agents`. The documentation does not say that deleting an Agents session removes its abuse-monitoring logs, so Treatable must not imply that it does.
- Training: "As of March 1, 2023, data sent to the OpenAI API is not used to train or improve OpenAI models (unless you explicitly opt in to share data with us)." Because each user supplies their own key, the user's own OpenAI organization may have opted in, and Treatable cannot see that setting. The endpoint table's "Data used for training: No" column must therefore always be repeated with the opt-in exception.
- The Decisions guide says ZDR and HIPAA use are available "for eligible customers" with required agreements. Treatable has no such approval or agreement and must not state or imply either.

### 4.1 Agents tracing

The tracing guide (https://developers.openai.com/api/docs/guides/agents-api/tracing) says: "Tracing is enabled by default for new sessions. You can inspect traces in the dashboard or export them through the API." The dashboard at Logs, then Agents, "shows what your agent did, including each step's recorded inputs, outputs, duration, and status". Generation spans record model inputs "such as a user message or a tool result" and outputs; tool spans record "the arguments sent to it, and the result when available". Traces can be exported with `GET /v1/agents/sessions/{session_id}/traces` using `api.traces.read` or `api.agents.read`.

Consequences for Treatable:

- Every Agents operation creates a trace containing the minimized profile, the task input, the evidence tool arguments, the public study fields returned as tool results, and the model output.
- People who can view the logs of the OpenAI project that owns the user's key can view that trace data in the dashboard, and any API key with `api.agents.read` or `api.traces.read` for that project can export it (the guide adds that trace export must be enabled for the organization).
- No per-session tracing opt-out is documented in the tracing guide, the create-session reference, or SDK 7.43.0. The errors guide mentions an OTLP "tracing configuration" but no page read here documents how to turn tracing off.
- The documentation does not say whether deleting a session removes its traces, and the data-controls page does not mention traces. Treatable must not imply that traces are removed by deletion.

### 4.2 Sessions that Treatable cannot clean up

Treatable keeps no persisted record of session IDs. If the app is closed, crashes, loses power, or loses its network connection during an Agents operation, it cannot cancel or delete that session afterwards, and nothing can be shown to the user about it in a later run. The data-controls table says Agents application state is kept "Until deleted", so such a session can remain in the user's OpenAI project indefinitely. The user can see sessions in their own project's Logs, then Agents dashboard, and can delete them with their own key through the documented `GET /v1/agents/sessions` and `DELETE /v1/agents/sessions/{session_id}` endpoints. The core allowlist (section 10.1) deliberately excludes session listing, so Treatable cannot find orphaned sessions itself.

## 5. Model IDs

| Model ID | Used by existing code for | What the docs say | Valid for that use |
| --- | --- | --- | --- |
| `gpt-6-luna` | `POST /v1/decisions` (`extension/native/real.mjs`, `extension/shared/demo-fixtures.mjs`, openai-scoring `openai.ts`) | Decisions guide: "Send requests to `POST /v1/decisions` using `gpt-6-luna`, the only currently supported model." Reference: "Only gpt-6-luna is supported." Model page exists (snapshot `gpt-6-luna`). | Yes. Live probe: HTTP 200, response `model: "gpt-6-luna"`. |
| `gpt-6-astra` | `agent.model` in `POST /v1/agents/sessions` (same files) | Every Agents example (quickstart, overview, configuration, sessions) uses `gpt-6-astra`. Model page exists (snapshot `gpt-6-astra`; `reasoning.effort` supports `low`, `medium`, `high`, `xhigh`, `max`). No page publishes a list of models supported by the Agents API. | Yes, by documented example. Live probe: HTTP 201 stream, turn completed, tool call round trip succeeded. |

Documentation gap (not a code problem): neither model page's endpoint table lists `/v1/decisions` or `/v1/agents`; both list Responses, Chat Completions, and Batch as supported. The Decisions guide is the authority for `gpt-6-luna` on Decisions. The Agents guides use `gpt-6-astra` throughout. The extension uses `reasoning.effort: "low"` with `gpt-6-astra`, which the model page lists as supported.

## 6. Rate limits, Retry-After, and request IDs (shared)

- "`Retry-After` may be present on `429` responses caused by a temporary rate limit and `503` responses caused by temporary model overload. It does not mean that quota, billing, or other errors that require user action can be resolved by retrying." (rate-limits guide)
- "Treat this value as a minimum: wait at least that long and add a small random delay so multiple clients don't retry at the same time."
- "If you're using your own HTTP client, follow `Retry-After` when the header is present and contains a valid value. If it's missing or invalid, fall back to exponential backoff with jitter. Limit both the number of attempts and the total time spent retrying. ... Don't retry quota, billing, or other errors that require you to take action."
- Non-retryable 429 codes (error-codes guide): `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, `organization_usage_limit_exceeded`; "The broader `error.type` can still be `insufficient_quota`." Retryable: 429 `slow_down` (type `rate_limit_error`), 429 "Rate limit reached for requests", 503 `server_is_overloaded`, and 500 after a brief wait.
- Rate-limit headers: `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`, `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, `x-ratelimit-reset-*`, project-token variants. The live probe recorded only two of them, `x-ratelimit-limit-requests` and `x-ratelimit-remaining-requests`. Both were present on the Decisions response, and neither was present on the Agents create response. The probe did not look for the other rate-limit headers.
- Responses normally carry `x-request-id`, but the API reference overview warns that requests which fail before reaching the API (for example with oversized headers) may get no response or no `x-request-id`. A client may send `X-Client-Request-Id` (ASCII, at most 512 characters). Treatable must never place user data in either.
- Compatibility (API reference overview): adding response properties, adding event types, and "Changing the length or format of opaque strings, like resource identifiers" are all listed as backwards-compatible changes.

## 7. Live probe (synthetic, fictional, public-only input)

`OPENAI_API_KEY` was present in the environment. The key was read only by the probe process and was never printed, logged, or written. The probe made exactly 4 HTTP calls with fictional data (study ID `NCT00000000`, a fictional seasonal allergic rhinitis condition, age band `30_44`, no names, contacts, ZIP codes, coordinates, dates of birth, exact ages, or free text from any person). The probe script lives only in the session scratchpad and is not committed. Identifiers below are redacted to their prefixes.

| # | Call | Result |
| --- | --- | --- |
| 1 | `POST /v1/decisions` with the same request shape as `extension/native/real.mjs`: one user message with `input_text` plus `input_json`, one `score` question named with the NCT ID, the four Treatable levels, and `prompt_cache_options: {mode: "explicit"}` | HTTP 200 in 964 ms, `application/json`. Body keys `model`, `answers`, `usage`. Answer `{type: "score", name: "NCT00000000", score: 2.58, probabilities: [{value, label, probability} x4], confidence: 0.58}`. Labels echoed exactly in level order 0 to 3. Probabilities were given to two decimals, summed to exactly 1, and their weighted mean equaled `score` exactly. |
| 2 | `POST /v1/agents/sessions` with `OpenAI-Beta: agents=v1`, `stream: true`, `environment: {type: "none"}`, `agent: {model: "gpt-6-astra", reasoning: {effort: "low"}, multi_agent: {enabled: false}, instructions, tools: [one function tool with an enum argument], text: {format: {type: "json_schema", schema}, verbosity: "low"}}`, and a JSON string `input` (the same configuration shape as `real.mjs`) | HTTP 201, `text/event-stream`; the stream ran about 20.5 s including the tool round trip. Each SSE block carried an `event:` line equal to the JSON `type`. Event order: `agent.session.created` (with `session` object), `turn.created`, `turn.item.added`, `session.in_progress`, `turn.in_progress`, a first assistant message ("I'll call the evidence tool for the fictional study.") as deltas plus `output_text.done` (the probe did not record the item's `phase` field, so calling this message commentary is an inference from its text and position), `turn.item.done`, `agent.session.requires_action` (with `session.required_actions`), more items, the final message as deltas plus `output_text.done` with text `{"nctId":"NCT00000000","ok":true}`, `turn.item.done`, and `agent.session.turn.completed` (top-level keys `event_id`, `session_id`, `turn`, `turn_id`, `type`, `usage`; `turn.subagent_id` was null). The required action had exactly the keys `arguments`, `call_id`, `name`, `turn_id`, `type`, with `arguments` as the object `{"nctId": "NCT00000000"}`. The session ID was `sess_` followed by 50 characters from `[A-Za-z0-9_-]` (55 total). |
| 3 | `POST /v1/agents/sessions/{id}/events` with one `agent.session.input.tool_result` (`success: true`, `output` a JSON string of fictional public fields) | HTTP 202 in 1227 ms, empty body. The turn continued on the original stream. |
| 4 | `DELETE /v1/agents/sessions/{id}` sent right after `turn.completed` | HTTP 200 in 2599 ms, body exactly `{id, object: "agent.session.deleted", deleted: true}`, and `id` matched the session. Deletion was acknowledged by the API; physical cleanup may continue asynchronously per the documentation. |

Not live-verified (call budget): the cancel event's HTTP status; deletion of a session with a running turn, including any 409 response to `DELETE`; `GET /v1/agents/sessions/{id}`; the `phase` values on message items; the contents of `session.agent` and `session.environment` in `agent.session.created`; Decisions refusal answers; `spend_control`; error bodies; `Retry-After` behavior; and model retrieval through `GET /v1/models/{id}`.

## 8. Existing code compared with the documentation

Files compared: `extension/native/transport.mjs`, `extension/native/provider.mjs`, `extension/native/real.mjs`, `extension/shared/demo-fixtures.mjs`, `extension/shared/real-contract.mjs`, `extension/shared/demo-contract.mjs`, and, read-only, `.claude/worktrees/openai-scoring/extension/src/openai.ts`. No extension file was changed.

### 8.1 Points that match the documentation

- Endpoints: `POST /v1/decisions`, `POST /v1/agents/sessions`, `GET /v1/agents/sessions/{id}`, `POST /v1/agents/sessions/{id}/events`, `DELETE /v1/agents/sessions/{id}`, all on `api.openai.com:443`.
- Headers: `OpenAI-Beta: agents=v1` is added for every `/agents/` path and is not sent to `/v1/decisions`.
- Model IDs `gpt-6-luna` (Decisions) and `gpt-6-astra` (Agents).
- Decisions request fields: user message with `input_text` and `input_json` (an object), `score` questions with four levels, NCT ID as `name`, `prompt_cache_options: {mode: "explicit"}` with no breakpoints, which per the guide disables prompt caching for the request. (The request grouping does not match the agreed one-request-per-study rule; see 8.2 item 13.)
- Decisions score answer fields `score`, `confidence`, `probabilities[{value, label, probability}]`.
- Agents create body: `environment: {type: "none"}`, `input` as a string, `stream: true`, `reasoning.effort: "low"`, `multi_agent: {enabled: false}`, a single function tool with `type`, `name`, `description`, `parameters`, and `text.format: {type: "json_schema", schema}` with `verbosity: "low"`.
- Required-action handling: keys `type`, `turn_id`, `call_id`, `name`, `arguments`, with `arguments` as an object.
- Tool result and cancel event bodies, and the delete acknowledgement shape.
- The application's session ID safety bound `^[A-Za-z0-9_-]{1,160}$` (not a documented format) accepts the observed 55-character ID.
- Size caps (96 KiB request, 1 MiB response, 128 KiB SSE buffer, 16,000-byte agent text) are application limits well below every documented limit.

### 8.2 Disagreements and undocumented assumptions

Each item states the documentation, the code, and the effect. None of these is fixed here.

1. **Decisions refusals fail the whole request.** Documentation: any question can return `{type: "refusal", name}` while other questions still receive answers. Code: `scoreValues` in `extension/native/provider.mjs` throws `INVALID_DECISIONS_OUTPUT` when any answer's `type` is not `score`. Effect: one refusal discards every score in that request. A4 should treat a refusal as a per-study "model declined" result.
2. **Decisions consistency tolerances are stricter than anything documented.** Documentation: `score` is the probability-weighted average; no rounding tolerance is stated. Code: rejects when the probabilities sum differs from 1 by more than 0.002 or the weighted mean differs from `score` by more than 0.02. Live: probabilities were two-decimal values; this one response matched exactly. Effect: with four two-decimal probabilities, a legitimate response could be off by up to 0.02 in the sum and about 0.035 in the mean, which the current code would reject. Not observed to fail; it is an untested risk.
3. **Agents final text is not keyed by item or phase.** Documentation: text parts are keyed by `item_id`, `output_index`, and `content_index`; assistant messages carry `phase`; the SDK takes the result only from completed non-commentary `message` items. Code: `runAgentContext` appends every delta of every message into one buffer and overwrites it with each `output_text.done`. Live: the turn produced a first assistant message ("I'll call the evidence tool...", inferred to be commentary; its `phase` was not recorded) before the final JSON message. The code would still pick the final JSON because its `done` event arrived last, but if a final `done` event were missing the buffer would contain commentary plus JSON and parsing would fail (fails closed, not unsafe).
4. **Strict key checks conflict with OpenAI's compatibility policy.** Documentation: "Adding new properties to JSON response objects or event data" is a backwards-compatible change. Code: `exactKeys` rejects any extra key in the delete acknowledgement (`INVALID_DELETE_ACK`, reported as cleanup failed) and in each required action (`INVALID_TOOL_CALL`). Effect: an additive API change would make deletions look failed and tool calls look invalid. The core should validate the fields it reads, ignore extra provider fields, and never forward them.
5. **No use of `Retry-After` or `error.code` in the extension transport.** Documentation: honor `Retry-After` on 429 and 503, back off with jitter, limit attempts, and do not retry billing or quota 429s, which are identified by `error.code`. Code: `transport.mjs` never retries, discards the error body, and maps every 429 to `RATE_LIMITED`. Not retrying is allowed, but the code cannot tell a temporary rate limit from an exhausted credit balance or spend limit.
6. **The openai-scoring retry logic (to be ported) retries earlier than the server allows and retries billing errors.** Documentation: "wait at least that long" and "Don't retry quota, billing, or other errors that require you to take action." Code (`openai-scoring/extension/src/openai.ts`): `parseRetryAfter` caps the wait at 8,000 ms with `Math.min`, then retries, so a `Retry-After` above 8 s produces a retry before the server's minimum; it retries every 429 without reading `error.code`; it adds no jitter; and its `RETRYABLE` set (`openai.ts` line 62) also retries `timeout` and `offline` failures, whose outcome at OpenAI is unknown. The port must not retry when `Retry-After` exceeds the cap, must skip non-retryable codes, should add jitter, and should not retry timeouts or network failures (section 10.6).
7. **The transport allowlist binds paths, not method and path pairs.** Documentation: `POST /v1/agents/sessions/{id}` updates session model and service tier, and `GET /v1/agents/sessions` lists every session in the project. Code: the path regex and method set are checked independently, so `POST /v1/agents/sessions/{id}`, `GET /v1/agents/sessions`, `GET /v1/decisions`, and `DELETE /v1/decisions` all pass the transport check even though no caller uses them. Not a documented-contract error, but the core allowlist should pin exact pairs.
8. **API key format is an undocumented assumption.** Documentation: the Agents API needs an application API key with `api.agents.read`, `api.agents.write`, and `api.responses.write`; no key format is documented. Code: `OpenAITransport` requires `^sk-[A-Za-z0-9_-]{10,500}$`. Effect: a valid key in another format would be rejected locally; a key without the Agents permissions gets 401 or 403 from the API. The live probe did not test the key prefix.
9. **Undocumented event name.** Code treats `environment.failed` as a failure event. The streaming reference has no such type (it has `agent.session.environment.failed`, which the code also handles). Harmless.
10. **Cancellation is not awaited before deletion.** Documentation (SDK): "Running execution must be cancelled first." The errors guide says a 409 `conflict_error` means "retrieve the current state before retrying". Code: sends cancel, then immediately sends `DELETE` with a 1.5 s timeout, then one `GET` and one retry within a 5.5 s budget. This is consistent with the documentation and reports `cleanup: 'failed'` honestly when deletion is not acknowledged, but acceptance of the cancel event (202) does not mean the turn has stopped. Not live-verified.
11. **Model pages omit the endpoints the code uses.** See section 5. Documentation gap, not a code error.
12. **Answer names may be null.** Documentation: answer `name` is "string or null" (null for unnamed questions). Code always names questions, so this is consistent. It is noted because a refusal answer still carries the question name, which the core can use to attribute the refusal to one study.
13. **All selected studies go into one Decisions request.** Agreed rule (orchestrator R4): one Decisions request per study, at most 10 studies per confirmed operation, at most 3 requests at a time. Code: `buildRealAnalysis` in `real.mjs` builds a single `decisionsRequest` whose `input_json` holds every selected study (up to 2) and whose `questions` has one `score` question per study. This is valid against the Decisions contract (1 to 400 questions), but the core must change the request grouping, which also changes the shape of the consent preview (a list of per-study requests instead of one request).
14. **Subagent detection is partial.** Documentation: turn events carry `turn.subagent_id`; `agent.session.subagent.*` events carry a `subagent` object and no `subagent_id`. Code: rejects events with `subagent_id` or `turn.subagent_id`, but would ignore an `agent.session.subagent.created` event. With `multi_agent.enabled: false` no subagent events are expected, so this is defense in depth, not an observed failure.

### 8.3 Claims-scan note

The first version of this record reported that the steering prompt's required sentence "Minimized health information is not anonymous." would fail the claims regex mirrored from openai-scoring, which bans that word with no negation exception. The core claims scan on branch `feature/core-a5` (`core/strings/claims.test.mjs`, commit `eb259e8`) now has a negation exception and lists that exact sentence as allowed, so the conflict is resolved there. The openai-scoring regex itself is unchanged and must not be ported as is.

## 9. Retention wording for disclosures

These sentences describe mechanisms and stay within the claims rules. They may be reused in notices. Each one is traceable to section 4.

- Decisions: "Relevance scoring uses OpenAI's Decisions API. OpenAI's data-controls page lists no stored application state for this endpoint other than prompt caching. Treatable sends these requests in explicit prompt-cache mode with no cache breakpoints, which OpenAI's Decisions guide says turns prompt caching off for the request. OpenAI states that its abuse-monitoring logs, which can include request content, are kept for up to 30 days by default, or longer when required by law or reasonably necessary to protect its services or others from harm."
- Training: "OpenAI states that data sent to its API is not used to train its models unless the account holder has opted in to share data with OpenAI. Treatable uses your own OpenAI key and cannot see whether your OpenAI organization has opted in."
- Agents state: "Study comparison and question planning use OpenAI's Agents API. The Agents API keeps session state, including the conversation and tool results, until the session is deleted. It is not eligible for Zero Data Retention and currently supports data residency only in the United States. Agents requests are also subject to OpenAI's abuse-monitoring logs of up to 30 days, and OpenAI does not say that deleting a session removes those logs."
- Agents tracing: "OpenAI records a trace of each Agents session by default, including the inputs sent to the model, the tool calls and results, and the model's output. People who can view the logs of the OpenAI project that owns your key can see these traces in OpenAI's dashboard, and API keys with trace or agents read permission for that project can export them. OpenAI's documentation does not describe a way to turn this off for a session, and does not say whether deleting the session removes its trace."
- Agents cleanup: "When an Agents operation ends, Treatable attempts to cancel any active turn and to delete the session. OpenAI states that deletion removes the session from the API and that physical cleanup may continue afterwards. If deletion is not confirmed while Treatable is running, Treatable shows that cleanup failed. If Treatable is closed, crashes, or loses power or its connection during an Agents operation, it cannot delete that session afterwards and cannot tell you about it later; the session then stays in your OpenAI project until you delete it there. Treatable cannot promise immediate erasure."
- Payload: "Only a condition term you select from the ClinicalTrials.gov vocabulary, your age band, your sex if you choose to share it, your US state if you choose to share it, and public study fields are sent to OpenAI."
- "Minimized health information is not anonymous."
- "A match score is not a probability of eligibility, enrollment, or treatment benefit."
- "Research information, not medical advice."

Note for the shared strings (task A5, read-only from here): `disclosure.agentsRetention` and `notice.section.05.body` on `feature/core-a5` say that Treatable "reports any failure". That is true only while the app is running; the strings should add the section 4.2 limit and the tracing statement. `disclosure.decisionsRetention` and `notice.section.06.body` are placeholders that point at this record; the Decisions and Training sentences above are the confirmed replacements.

## 10. Build against this (guidance for the shared core)

### 10.1 Host and endpoint allowlist

Pin the host to `api.openai.com`, port 443, HTTPS with certificate validation. Allow exactly these method and path pairs and nothing else:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/decisions` | relevance scoring |
| `POST` | `/v1/agents/sessions` | create session and stream the first turn (`stream: true`) |
| `GET` | `/v1/agents/sessions/{session_id}` | read `required_actions` and status for recovery and cleanup |
| `POST` | `/v1/agents/sessions/{session_id}/events` | only `agent.session.input.tool_result` and `agent.session.input.cancel` events |
| `DELETE` | `/v1/agents/sessions/{session_id}` | cleanup |

`{session_id}` must be the ID received in this operation's own stream, matched against `^[A-Za-z0-9_-]{1,160}$`. That pattern is an application safety bound that keeps the ID a single safe path segment; it is not a documented format. Do not require the observed `sess_` prefix, because OpenAI lists identifier format changes as backwards-compatible. If a received ID does not match, Treatable cannot address the session: it must report cleanup as failed and state that the session may be retained in the user's OpenAI project (section 4.2). Exclude session update (`POST /v1/agents/sessions/{id}`), session listing, saved agents, vaults, artifacts, environments, models, and usage endpoints. A hostile transport port must not be able to widen this set.

### 10.2 Headers

- Every request: `Authorization: Bearer <key>`.
- Requests with a body: `Content-Type: application/json`.
- Every `/v1/agents/*` request: `OpenAI-Beta: agents=v1`. Never send it to `/v1/decisions`. A wrong value produces 400 `invalid_beta`.
- Streaming create: `Accept: text/event-stream`. Check that the response `Content-Type` contains `text/event-stream`.
- Do not send `OpenAI-Organization`, `OpenAI-Project`, `Idempotency-Key`, `X-Client-Request-Id`, or any custom header unless a later reviewed task needs it. If `X-Client-Request-Id` is ever added, it must be a random value with no user data.

### 10.3 Request size cap

Keep a 96 KiB (98,304-byte) cap on every serialized request body. Rationale: it matches the existing `MAX_MESSAGE_BYTES` bound that the extension uses for native messages, including the consent preview; it sits far below every documented limit (Decisions `input_json` 256 KiB and 10,000 values, Agents input 4 MiB, tool list 3 MiB, tool result below 4 MiB); and with the agreed operation limits each single request is small. Agreed limits (orchestrator R4): at most 10 studies per confirmed Decisions operation, one Decisions request per study, at most 3 concurrent Decisions requests; at most 2 studies per Agents operation.

Character limits are not byte limits. `real.mjs` cuts the summary to 1,800 and the criteria to 4,000 JavaScript string units with `slice`. In UTF-8 a string unit can take up to 3 bytes, and `JSON.stringify` writes some control characters as 6-byte escapes, so a record can be several times larger in bytes than its character count suggests. Measured on the extension's bundled 2,000-record public corpus with the `real.mjs` field set and cuts (serialized UTF-8): median 2,521 bytes, 90th percentile 4,917 bytes, maximum 7,861 bytes; 885 records contain non-ASCII characters; the 10 largest records total 65,952 bytes. Live ClinicalTrials.gov records may be larger. The core must therefore:

- measure the serialized UTF-8 byte length of each study record and of each request body, and reject or further shorten a record that exceeds a fixed per-study byte budget, instead of relying on character counts;
- set a byte budget for the whole consent preview. The preview can exceed the message bound: `real.mjs` already rejects a preview reply larger than `MAX_MESSAGE_BYTES - 1024` with `PREVIEW_TOO_LARGE`. With the measured maximum, ten per-study Decisions requests (about 66 KiB of study records plus roughly 1 KiB of fixed template, profile, and question per request) plus the Agents request and two tool results (up to about 16 KiB of study records) would exceed that bound, so A2r and A4 should measure it and either lower the per-study budget or show each study's public fields once in the preview and reference them from each request.

Also cap each tool result at the byte size of the pinned public study record, and keep the existing response caps (1 MiB JSON, 1 MiB total SSE, 128 KiB SSE buffer, 16,000-byte agent text).

### 10.4 Fields to build and validate

Field allowlists (every model-bound object is built only from these keys; anything else is rejected, not dropped silently):

- Profile object: `conditionTerm` (a term the user selected from ClinicalTrials.gov vocabulary, never text the user typed), `ageBand` (one of the fixed bands), optional `sex` (fixed values), optional US `state` (two-letter code), and fixed flags such as `minimizedHealthData: true`.
- Public study object (the `publicStudy` field set in `real.mjs`): `id`, `title`, `conditions`, `status`, `summary`, `criteria`, `criteriaTruncated`, `minimumAge`, `maximumAge`, `sex`, `sourceUrl`, `retrievedAt` (named `fetchedAt` in `real.mjs`), and `lastUpdatePostDate`.
- Never include: central or overall contacts, investigator or official names, emails, phone numbers, sponsor contact details, facility or site lists, site addresses, any distance, nearest-site, or other field computed from the user's location (choosing or filtering sites by the user's location would reveal it), ZIP codes, coordinates, exact age, date of birth, user names, or any text the user typed (symptoms, notes, or search input).

Decisions request (built only in core from pinned consent data, validated with a strict schema; one request per study):

- `model` equals `"gpt-6-luna"`.
- `input` is exactly one `user` message with a fixed `input_text` template and one `input_json` whose `data` holds only the profile object and one public study object.
- `questions` holds exactly one `score` question with the fixed four levels and `name` equal to that study's NCT ID (`^NCT\d{8}$`).
- `prompt_cache_options` is `{mode: "explicit"}` with no breakpoints anywhere.
- No `prompt_cache_key`, `safety_identifier`, images, tool-call items, developer or system messages, or other keys.

Decisions response:

- Read `answers`; require one answer per question, in order, with `name` equal to the question name.
- Accept `type: "score"` and `type: "refusal"`. Treat refusal as "model declined" for that study only.
- For `score`: `score` finite within 0 to 3; `confidence` within 0 to 1; one probability per sent level, so four, with unique integer `value` 0 to 3, `label` equal to the sent label, `probability` within 0 to 1. The one-per-level count is an application expectation taken from the reference example and the live probe; the reference does not state it. Apply consistency checks with tolerances that allow two-decimal rounding (sum within 0.02 of 1, weighted mean within 0.035 of `score`), and document them as application checks, not provider promises.
- Ignore extra response properties such as `usage`; never forward the raw provider response to the UI.

Agents create request:

- `environment` equals `{type: "none"}`.
- `agent.model` equals `"gpt-6-astra"`, `reasoning: {effort: "low"}`, `multi_agent: {enabled: false}`, fixed instructions, exactly one function tool `get_public_trial_evidence` whose `nctId` argument is an enum of this operation's NCT IDs (at most 2), `text.format` a fixed `json_schema`, `verbosity: "low"`.
- `input` is a JSON string whose object holds only: a fixed `task` text, the profile object, `nctIds` (this operation's NCT IDs), the fixed `questionTemplates` and `cautionIds`, and fixed flags. Study text is not placed in `input`; it reaches the model only through tool results. `stream` is `true`.
- No `agent_id`, `vault_ids`, `metadata`, MCP, web search, computer use, or tool search.
- Do not send `spend_control`. It appears only in SDK 7.43.0, not in the live create-session reference, and it has not been live-verified. The link between it and the documented turn error `session_budget_exceeded` ("The session reached its usage budget.") is an inference. Revisit it only if the reference documents it, a live check confirms it, and the consent preview (A2r) shows it.

Agents stream handling:

- Every event must be an object with a string `type`; ignore unknown types (OpenAI lists new event types as backwards-compatible). Bound the number of events.
- Take the session ID from `agent.session.created` (`session.id`) or `session_id`, and require it to stay the same.
- Check `agent.session.created` against what was sent, using the `AgentSession` schema from the reference and SDK (these fields were not captured in the live probe): `session.agent.model` equals the sent model, `session.agent.tools` has exactly one tool and it is the sent function, `session.agent.multi_agent.enabled` is `false`, and `session.environment.type` is `"none"`. On any mismatch, cancel, delete, and fail the operation. Because these fields were not captured live, A4's first live run must confirm them; if the API reports harness-added tools in `session.agent.tools`, relax only the count check (the sent function must be present and no MCP, web search, computer use, tool search, or programmatic tool calling entry may be present) and record that change in this file.
- Subagents: record the root turn ID from the first `agent.session.turn.created` whose `turn.subagent_id` is null. Fail the operation on any `agent.session.turn.*` event whose `turn.subagent_id` is not null, on every `agent.session.subagent.*` event, and on any item, text, or required-action entry whose `turn_id` is not the root turn ID.
- On `agent.session.requires_action`, read `session.required_actions` from the event (or `GET` the session). Accept only entries with `type: "function_call"`, `name: "get_public_trial_evidence"`, string `turn_id` equal to the root turn ID, string `call_id`, and object `arguments` with an `nctId` from this operation's list; ignore extra fields. Any other action type is a protocol failure: cancel, then delete. Deduplicate by `turn_id` and `call_id` and bound the number of calls.
- Return results only as `{events: [{type: "agent.session.input.tool_result", turn_id, call_id, success: true, output: JSON.stringify({public: true, study: <public study object>})}]}` and expect HTTP 202.
- Build the final answer from `agent.session.turn.item.done` events whose `item` is a completed assistant `message` that is not `phase: "commentary"`, concatenating `output_text` parts in `output_index` order. Use `output_text.done` keyed by `item_id` only as a fallback. Parse it against the fixed schema.
- Outcome events: `agent.session.turn.completed` is success, subject to output validation. `agent.session.turn.failed`, `agent.session.turn.cancelled`, `agent.session.failed`, and `agent.session.environment.failed` are failures. An `error` event or a stream that closes before an outcome event is also a failure, but it does not confirm the turn's final state (errors guide), so the turn must be treated as possibly still running: cancel it before deleting (section 10.5).

### 10.5 Cleanup

1. If no `agent.session.turn.completed` was received (including after an `error` event, a protocol failure, a user cancel, or a stream that closed early), send `agent.session.input.cancel`, then wait (bounded) for `agent.session.turn.cancelled` or a retrieved status other than `in_progress`.
2. Send `DELETE /v1/agents/sessions/{id}`. Report `deleted` only when the status is 2xx and the body has `id` equal to the session ID, `object` equal to `"agent.session.deleted"`, and `deleted` equal to `true`. Ignore extra properties.
3. On 409, retrieve the session, wait (bounded), and retry once. Any other outcome is reported as cleanup failed or unconfirmed, with the HTTP status only (no body text).
4. If the stream ended before any session ID was seen, or the ID failed the safety bound in 10.1, report cleanup as unconfirmed and say the session may be retained; do not claim deletion.
5. If the process ends during an operation, none of these steps run (section 4.2). The disclosure must say so; the core cannot recover such sessions because it keeps no session IDs.

### 10.6 Retry policy

- Decisions (no application state is kept, per section 4): at most one retry per study request.
  - Retry only on: 429 whose `error.code` is not one of `credit_balance_exhausted`, `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`, `organization_usage_limit_exceeded`, or `usage_limit_exceeded` and whose `error.type` is not `insufficient_quota`; 503 (documented: follow `Retry-After`, then retry); and 500 (documented: "Retry your request after a brief wait"). Retrying 502 or 504 would be an application choice; no page read here documents it, so do not retry them unless a later reviewed task decides to.
  - Delay: when `Retry-After` is present and valid, wait at least that many seconds plus a small random delay. When it is missing or invalid, use the rate-limits guide's fallback, exponential backoff with jitter, which for a single retry means one short base delay plus jitter. If `Retry-After` exceeds the per-study cap (for example 8 s), do not retry; report a rate-limit failure for that study and keep the deterministic results.
  - The retry resends the byte-identical pinned request body covered by the consent digest. It is not a new request, and it counts against the limit of 3 concurrent Decisions requests while it waits and runs.
  - Do not retry timeouts or network failures automatically. The documentation does not forbid it (the Agents errors guide allows bounded retries of timeouts after checking saved work), but for these failures the outcome at OpenAI is unknown and the request may already have been received, so a retry could send the same data twice without the user seeing it. This is an application choice.
  - Flag for A2r: the consent preview and confirmation text must say that each per-study request may be sent a second time, unchanged, after a temporary rate limit or overload.
- Agents session create: never retry automatically, because a retry could create a second retained session. Report the failure and keep local results.
- Tool result submission: one retry with the same `turn_id` and `call_id` is allowed while the call is still pending.
- Parse provider error bodies with a small size bound, map `error.code` to fixed application codes, and never log or display `error.message`, which can echo request content.

## Appendix A. Baseline extension test results (before any core work)

Run in this worktree (`.claude/worktrees/core-a0`, branch `feature/core-a0`, base `48c569e`) on 2026-10-24 with Node v26.11.0:

| Command | Result |
| --- | --- |
| `cd extension && npm ci` | exit 0. npm warned that two install scripts were not run because they are not covered by `allowScripts`: `esbuild@0.28.2` (`postinstall: node install.js`) and `fsevents@2.3.3`. The build and tests still ran and passed. |
| `npm test` (runs `build:all`, then `tsx --test tests/*.test.ts`) | exit 0; 54 tests, 54 passed, 0 failed |
| `node --test native/test/*.test.mjs` | exit 0; 21 tests, 21 passed, 0 failed |

All of these tests are mocked; none of them calls the OpenAI API. After the run, `git status` was clean and `git diff 48c569e -- extension scaffold` was empty.

## Appendix B. Probe method

The probe was a single Node script run from the session scratchpad with the API key taken from the environment. It printed only HTTP status codes, selected response headers (with `x-request-id` truncated to its prefix), response shapes, and identifier prefixes. It used a hard limit of 4 calls and fictional inputs only. Its output is summarized in section 7; it is not committed because it is not product code.
