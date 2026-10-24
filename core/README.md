# Treatable shared core

Research information, not medical advice.

`core/` is the runtime-neutral TypeScript core that every Treatable app runs: the desktop helper (Node, task A6a) and the mobile app (Hermes). It owns the host <-> core protocol, request and output validation, session state, the consent-receipt machinery, deterministic local screening, and the outbound transport gate. Platform UIs only send protocol messages and show what comes back; they never build OpenAI payloads and never decide whether a payload may be sent.

## Layout

| Path | Contents |
| --- | --- |
| `src/protocol.ts` | Versioned contract (`CONTRACT_VERSION` 0.1.0, pre-freeze): strict, bounded zod schemas for every request, response, error, trace event, and credential message; model-bound allowlists; fixed model-bound texts; size and count bounds. |
| `src/dispatcher.ts` | `createCore(ports, options)` returning `handle(request, { onEvent })`. Validates every input and output, owns the record index writes, builds the preview, and hands pipelines only narrowed contexts. |
| `src/records.ts` | The session record index: the public records that searchTrials returned, their digests, the record-set digest (the consent subject), and byte-exact condition-term lookup. Pipelines get a read-only view. |
| `src/session.ts` | In-memory session: prepared consent, the record index, running operations, seen request IDs, typed slots. `wipe()` drops everything. |
| `src/consent/` | Prepared-consent store (pinned preview and request pins, SHA-256 digest through the port, five-minute one-use tokens, invalidation) and the policy receipt. |
| `src/preview.ts` | Deterministic builders for the exact outbound preview, `projectModelStudy` (held record to model-bound study), and the record checks that bind a preview to the held records. |
| `src/outbound.ts` | The OpenAI send capability: the only path from an executeReal pipeline to OpenAI. It sends the pinned bytes of the consented preview to the allowlisted endpoints under the delivery policy. |
| `src/screening.ts` | Deterministic local screening (task A1b): age, sex, status, and staleness checks; haversine distance to the nearest located site (informational, never an exclusion); screens the records held in the session record index; a site without coordinates leaves the radius status unknown. |
| `src/zip.ts` | Offline ZIP-to-centroid lookup (task A1b): bundled table loaded through the Loader port and pinned by SHA-256, cached per session, and used only inside the app for approximate local distance. APO/FPO ZIPs (no state in the table) are refused, as in the extension. |
| `src/transport-gate.ts` | The outbound transport gate (task A1b): one frozen table of exact request rules (the five OpenAI method-and-path pairs and the ClinicalTrials.gov search), the OpenAI request builder, and a guard that checks each request against the table before the host's transport port is called. |
| `data/zip-centroids.v1.json` | The bundled ZIP centroid table (41,488 entries; CC BY 4.0, GeoNames), byte-identical to the scaffold source and pinned by SHA-256 in `src/zip.ts`. |
| `src/ports.ts` | Port interfaces: Transport, Sha256, TokenSource, Clock, Loader. |
| `src/bytes.ts`, `src/json.ts`, `src/cancel.ts`, `src/resources.ts` | Neutral helpers: UTF-8 without host encoders, canonical JSON (RFC 8785 ordering), cancellation, bounded resource loading. |
| `node/ports.node.ts` | Node reference implementations of the ports. Never imported by `src/`. |
| `tests/` | Mocked test suites (no network). `tests/support/` holds fakes, fixtures, and the import scanner. |
| `scripts/drift-check.mjs` | Reports changes to the ported extension sources since 48c569e. |
| `PROVENANCE.md` | What was ported from where, what changed and why, and dependency versions. |

## Ports

Everything with an effect goes through a port that the host injects. Each port's contract is documented in `src/ports.ts`; the core treats port results as untrusted and validates them.

- **Transport**: `request({ method, url, headers, body: Uint8Array, signal }) -> { status, headers, body: Uint8Array | AsyncIterable<Uint8Array> }`. HTTPS with certificate validation, no redirects. The core reads bodies with its own byte cap. Before the port is called, `src/transport-gate.ts` (task A1b) checks the request against an exact rule table: `POST /v1/decisions`, `POST /v1/agents/sessions`, `GET` and `DELETE /v1/agents/sessions/{id}`, and `POST /v1/agents/sessions/{id}/events` on `https://api.openai.com` (each with Authorization required and its own body, OpenAI-Beta, and Accept rules), and `GET https://clinicaltrials.gov/api/v2/studies` with a bounded query, no body, and `Accept: application/json` as its only header. The request body cap and the header rules apply to every request. The guard reads each request field once, calls the port only with a rebuilt, frozen request that has a fresh copy of the body, and does not call the port for a refused request. What the port does with a request that matched (certificate validation, no redirects, no rewriting) is the host's responsibility.
- **Sha256**: `digestHex(bytes) -> hex` (sync or async).
- **TokenSource**: `randomBytes(n)` from the operating system's cryptographic generator.
- **Clock**: `now()` (wall time for display), `monotonic()` (expiry decisions), `schedule(ms, fn) -> cancel`.
- **Loader**: `load(resourceId, maxBytes)` for bundled public resources, by allowlisted ID, never by path.

`core/src` cannot reach host APIs: `npm run typecheck` checks `src/` with no ambient Node or DOM types (so `process`, `Buffer`, `fetch`, `setTimeout`, `TextEncoder`, and similar names do not exist there), and `tests/import-graph.test.ts` scans every file for `node:*` and bare built-in imports, `require`, dynamic `import()`, `import.meta`, host globals (including web objects such as `URL`, `atob`, and `Intl` that some target runtimes lack), `eval` and `Function` (also aliased or reached through a constructor property), Chrome extension identity (`chrome.*`, `EXTENSION_ID`, `HOST_NAME`, `validateOrigin`), and imports outside `core/src` other than `zod`. Its self-test plants each violation in a temporary tree and proves the scan catches it.

## Operations

| Operation | Direction | State in this build |
| --- | --- | --- |
| `status` | host -> core | implemented |
| `searchTrials` | host -> core | record index merge implemented; `NOT_IMPLEMENTED` until task A2 supplies the live ClinicalTrials.gov pipeline |
| `screenLocal` | host -> core | implemented (task A1b): the dispatcher's held-record check, then deterministic screening of the held records |
| `prepareReal` | host -> core | implemented in the core (record rules, exact preview, pins, consent); answers `NOT_IMPLEMENTED` until an executeReal pipeline exists |
| `executeReal` | host -> core | consent gate, credential handling, and the send capability implemented; `NOT_IMPLEMENTED` until task A4 supplies the provider pipeline |
| `revokeReal` | host -> core | implemented |
| `cancel` | host -> core | implemented |
| `endSession` | host -> core | implemented |
| `credential.request` | core -> host | message schemas and gating implemented; task A6b finalizes the semantics |

Every request is `{ v, type: "request", id, op, payload }`; every response is `{ v, type: "response", id, op, ok: true, result }` or the constant-shape error `{ v, type: "response", id, op?, ok: false, error: { code } }`. Trace events for an `executeReal` arrive before its response as `{ v, type: "event", id, event: "trace", trace }` with a `mocked` or `live` label. Requests, events, credential messages, and the `prepareReal` response are capped at 96 KiB (`MAX_MESSAGE_BYTES`); search and screening responses at 1 MiB.

### Consent

`prepareReal` is handled by the core itself; there is no preview pipeline. It requires every NCT ID in the packet to be a record the session holds and the condition term to equal, byte for byte, a `conditions` or `meshTerms` entry of a held record. It then builds the exact outbound preview from the held records (one Decisions body per score study, at most 10; one Agents request over at most 2 studies; the tool results; every study object is `projectModelStudy` of its record), verifies it again against the records, computes the SHA-256 of every byte string that may be sent (the canonical JSON of each body and of each tool result), and returns an opaque 43-character token, a SHA-256 digest over the canonical JSON of `{ operations, pins, policyVersion, preview, subjectDigest }`, and an expiry five minutes ahead. The subject digest is the record-set digest, so any change to the held records clears the preparation.

`executeReal` checks the receipt before anything else and lets each authorized operation run once per token. The core then asks the host for the credential, once, and gives it to the send capability, not to the pipeline. The pipeline receives the frozen preview, a trace emitter, and the capability: it can ask for a consented body to be sent by reference, and the capability serializes it, checks it against its pin, sends it to the fixed URL with fixed headers, applies the delivery policy shown in the preview (one Decisions retry with identical bytes after a temporary rate limit or overload, at most three Decisions requests at a time, one Agents create, at most two sends per tool call), and refuses everything else. A refused attempt fails the operation, and the result must match what was actually sent. Preparing again, revoking, cancelling, any invalid request including a rejected receipt, any change of the held records, `endSession`, and expiry all clear the preparation and abort running real-data work; after an abort the capability allows Agents cleanup for at most 10 seconds and then closes. All texts in model-bound bodies are contract constants and every study object is capped at 5 KiB, so the largest possible preview fits the message bound by construction (measured in `tests/protocol.test.ts`).

## Testing

```sh
cd core
npm ci
npm test            # tsx --test over tests/**/*.test.ts, plus strings/*.test.mjs when present
npm run typecheck   # whole package with Node types, then src/ alone with no host types
npm run drift-check # same as node scripts/drift-check.mjs
```

All tests are mocked: they use fake or injected ports and make no network requests. No OpenAI or ClinicalTrials.gov call is made by this package's tests.
