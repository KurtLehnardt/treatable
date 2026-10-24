# Treatable shared core

Research information, not medical advice.

`core/` is the runtime-neutral TypeScript core that every Treatable app runs: the desktop helper (Node, task A6a) and the mobile app (Hermes). It owns the host <-> core protocol, request and output validation, session state, and the consent-receipt machinery. Platform UIs only send protocol messages and show what comes back; they never build OpenAI payloads and never decide whether a payload may be sent.

## Layout

| Path | Contents |
| --- | --- |
| `src/protocol.ts` | Versioned contract (`CONTRACT_VERSION` 0.1.0, pre-freeze): strict, bounded zod schemas for every request, response, error, trace event, and credential message; model-bound allowlists; fixed model-bound texts; size and count bounds. |
| `src/dispatcher.ts` | `createCore(ports, options)` returning `handle(request, { onEvent })`. Validates every input and output. |
| `src/session.ts` | In-memory session: prepared consent, running operations, seen request IDs, pinned subject digest, typed slots. `wipe()` drops everything. |
| `src/consent/` | Prepared-consent store (pinned preview, SHA-256 digest through the port, five-minute one-use tokens, invalidation) and the policy receipt. |
| `src/preview.ts` | Deterministic builders for the exact outbound preview. |
| `src/ports.ts` | Port interfaces: Transport, Sha256, TokenSource, Clock, Loader. |
| `src/bytes.ts`, `src/json.ts`, `src/cancel.ts`, `src/resources.ts` | Neutral helpers: UTF-8 without host encoders, canonical JSON (RFC 8785 ordering), cancellation, bounded resource loading. |
| `node/ports.node.ts` | Node reference implementations of the ports. Never imported by `src/`. |
| `tests/` | Mocked test suites (no network). `tests/support/` holds fakes, fixtures, and the import scanner. |
| `scripts/drift-check.mjs` | Reports changes to the ported extension sources since 48c569e. |
| `PROVENANCE.md` | What was ported from where, what changed and why, and dependency versions. |

## Ports

Everything with an effect goes through a port that the host injects. Each port's contract is documented in `src/ports.ts`; the core treats port results as untrusted and validates them.

- **Transport**: `request({ method, url, headers, body: Uint8Array, signal }) -> { status, headers, body: Uint8Array | AsyncIterable<Uint8Array> }`. HTTPS with certificate validation, no redirects. The core reads bodies with its own byte cap. Endpoint allowlist, host pinning, and request caps around this port are task A1b.
- **Sha256**: `digestHex(bytes) -> hex` (sync or async).
- **TokenSource**: `randomBytes(n)` from the operating system's cryptographic generator.
- **Clock**: `now()` (wall time for display), `monotonic()` (expiry decisions), `schedule(ms, fn) -> cancel`.
- **Loader**: `load(resourceId, maxBytes)` for bundled public resources, by allowlisted ID, never by path.

`core/src` cannot reach host APIs: `npm run typecheck` checks `src/` with no ambient Node or DOM types (so `process`, `Buffer`, `fetch`, `setTimeout`, `TextEncoder`, and similar names do not exist there), and `tests/import-graph.test.ts` scans every file for `node:*` and bare built-in imports, `require`, dynamic `import()`, `import.meta`, host globals, Chrome extension identity (`chrome.*`, `EXTENSION_ID`, `HOST_NAME`, `validateOrigin`), and imports outside `core/src` other than `zod`. Its self-test plants each violation in a temporary tree and proves the scan catches it.

## Operations

| Operation | Direction | State in this build |
| --- | --- | --- |
| `status` | host -> core | implemented |
| `searchTrials` | host -> core | `NOT_IMPLEMENTED` until task A2 (live ClinicalTrials.gov client and record-set subject) |
| `screenLocal` | host -> core | `NOT_IMPLEMENTED` until task A1b (deterministic screening) |
| `prepareReal` | host -> core | consent gate implemented; `NOT_IMPLEMENTED` until tasks A2 and A4 supply the preview pipeline |
| `executeReal` | host -> core | consent gate and credential gating implemented; `NOT_IMPLEMENTED` until task A4 supplies the provider pipeline |
| `revokeReal` | host -> core | implemented |
| `cancel` | host -> core | implemented |
| `endSession` | host -> core | implemented |
| `credential.request` | core -> host | message schemas and gating implemented; task A6b finalizes the semantics |

Every request is `{ v, type: "request", id, op, payload }`; every response is `{ v, type: "response", id, op, ok: true, result }` or the constant-shape error `{ v, type: "response", id, op?, ok: false, error: { code } }`. Trace events for an `executeReal` arrive before its response as `{ v, type: "event", id, event: "trace", trace }` with a `mocked` or `live` label. Requests, events, credential messages, and the `prepareReal` response are capped at 96 KiB (`MAX_MESSAGE_BYTES`); search and screening responses at 1 MiB.

### Consent

`prepareReal` pins the exact outbound preview (one Decisions body per score study, at most 10; one Agents request over at most 2 studies; the tool results) and returns an opaque 43-character token, a SHA-256 digest over the canonical JSON of `{ operations, policyVersion, preview, subjectDigest }`, and an expiry five minutes ahead. `executeReal` checks the receipt before anything else, lets each authorized operation run once per token, and only then may the provider pipeline ask the host for the credential, once. Preparing again, revoking, cancelling, any invalid request, any change of the pinned subject, `endSession`, and expiry all clear the preparation and abort running real-data work. All texts in model-bound bodies are contract constants and every study object is capped at 5 KiB, so the largest possible preview fits the message bound by construction (measured in `tests/protocol.test.ts`).

## Testing

```sh
cd core
npm ci
npm test            # tsx --test over tests/**/*.test.ts, plus strings/*.test.mjs when present
npm run typecheck   # whole package with Node types, then src/ alone with no host types
npm run drift-check # same as node scripts/drift-check.mjs
```

All tests are mocked: they use fake or injected ports and make no network requests. No OpenAI or ClinicalTrials.gov call is made by this package's tests.
