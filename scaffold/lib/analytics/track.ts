/**
 * track.ts — application-level analytics emitter (PLT-03 / R10.1).
 *
 * Framework-agnostic: no React, no Next.js imports. The React layer sits on
 * top in `components/AnalyticsProvider.tsx`, mirroring how `lib/mockAuth.ts`
 * is a plain module with `components/AuthProvider.tsx` on top of it.
 *
 * This module is the ONLY place feature code should call to emit a funnel
 * event. It exists to make the R10.1 guarantee ("Analytics events carry no
 * description content, ever") hold not just at the contract layer
 * (`lib/contracts/analyticsEvent.ts`) but at every real call site:
 *
 *  - `track()` re-validates against `AnalyticsEventSchema` at the boundary,
 *    so even a value that slipped past TypeScript (e.g. an `as` cast, JSON
 *    from a non-TS source) is caught at runtime.
 *  - The 19 funnel-event builders below give call sites a typed function per
 *    event name instead of a hand-typed `{ name: "..." }` string literal, so
 *    a typo'd event name or a smuggled free-text payload is a compile error
 *    at the call site itself, not just on the raw `AnalyticsEvent` type.
 *  - Everything here is gated behind the `r10_analytics` flag (CON-03,
 *    default OFF) and is a total no-op — never throws — when the flag is
 *    off, when validation fails, or if the sink itself misbehaves. A bad
 *    analytics call must never crash the app it's instrumenting.
 *
 * There is no real analytics backend yet, so the default sink just
 * console-logs the validated event for local/dev visibility.
 */

import {
  AnalyticsEventSchema,
  AnalyticsEventNameSchema,
  type AnalyticsEvent,
  type AnalyticsEventName,
  type AnalyticsPayload,
  type AnalyticsId,
} from "../contracts/analyticsEvent";
import { isFlagEnabled } from "../flags";

/** Every funnel event name (R10.1), re-exported for callers/tests that want to iterate them. */
export const ANALYTICS_EVENT_NAMES = AnalyticsEventNameSchema.options;

/**
 * Where a validated event goes. Injectable so call sites (and tests) can
 * observe/replace delivery without touching global `console`.
 */
export type AnalyticsSink = (event: AnalyticsEvent) => void;

function defaultSink(event: AnalyticsEvent): void {
  // TODO: real destination (PostHog/Segment/etc.) when one exists.
  // Dev-visible stub only: never persists, never leaves the local process.
  console.debug("[analytics]", event);
}

/**
 * Consent gate (§5.3 / R10.1). Analytics is PRIVATE BY DEFAULT: even with the
 * `r10_analytics` flag on, `track()` stays inert until the visitor has opted in
 * ("Opt in to sharing anonymized usage data"). This is a SECOND, independent
 * gate from the flag — an event reaches the sink only when the flag is on AND
 * consent is granted.
 *
 * It lives here (the framework-agnostic choke point every event passes through)
 * rather than only in the React provider, so a future direct `track()` caller
 * can't bypass the opt-in. `AuthProvider` — the localStorage-backed source of
 * truth for consent — keeps this in sync via `setAnalyticsConsent()`.
 */
let analyticsConsent = false;

/** Sync the analytics consent gate with the user's opt-in. Defaults to false. */
export function setAnalyticsConsent(granted: boolean): void {
  analyticsConsent = granted;
}

/**
 * Validate + (maybe) deliver a single analytics event.
 *
 * - Flag off (`r10_analytics`) → fully inert, sink is never invoked.
 * - Consent not granted → fully inert, sink is never invoked (opt-in required,
 *   private by default; see `setAnalyticsConsent`).
 * - Flag on + consent granted + event fails `AnalyticsEventSchema` → silent
 *   no-op, sink is never invoked. This is the runtime backstop for
 *   description/free-text content that slipped past TypeScript (e.g. via a cast).
 * - Flag on + consent granted + event valid → `sink(event)` is called (default:
 *   console.debug stub). Any error anywhere in this path is swallowed — a bad
 *   call site must never crash the app.
 */
export function track(event: AnalyticsEvent, sink: AnalyticsSink = defaultSink): void {
  try {
    if (!isFlagEnabled("r10_analytics")) return;
    if (!analyticsConsent) return; // opt-in required — private by default (§5.3)

    const result = AnalyticsEventSchema.safeParse(event);
    if (!result.success) return; // never reaches the sink

    sink(event);
  } catch {
    // Never throw out of track() — see module doc comment.
  }
}

// ---------------------------------------------------------------------------
// Funnel-event builders (R10.1) — one per name in AnalyticsEventNameSchema,
// so call sites never hand-type the string enum. Each returns a plain
// `AnalyticsEvent` ready to pass to `track()`:
//
//   track(landingView());
//   track(runAbandoned(elapsedMs, { results_shown: 3 }));
//
// `payload`/`session_id` go through the same compile-time-enforced
// `AnalyticsPayload`/`AnalyticsId` types as the raw contract, so a
// description/free-text value is a type error right here at the builder call
// site, not only on the underlying `AnalyticsEvent` type.
// ---------------------------------------------------------------------------

function buildEvent(
  name: AnalyticsEventName,
  payload?: AnalyticsPayload,
  session_id?: AnalyticsId,
): AnalyticsEvent {
  const event: AnalyticsEvent = { name, ts: Date.now() };
  if (session_id !== undefined) event.session_id = session_id;
  if (payload !== undefined) event.payload = payload;
  return event;
}

export function landingView(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("landing_view", payload, session_id);
}

export function descriptionStarted(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("description_started", payload, session_id);
}

export function descriptionSubmitted(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("description_submitted", payload, session_id);
}

export function interviewShown(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("interview_shown", payload, session_id);
}

export function interviewCompleted(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("interview_completed", payload, session_id);
}

export function interviewSkipped(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("interview_skipped", payload, session_id);
}

export function searchStarted(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("search_started", payload, session_id);
}

export function firstResultRendered(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("first_result_rendered", payload, session_id);
}

export function runCompleted(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("run_completed", payload, session_id);
}

/**
 * run_abandoned — "the single most important event" (R10.1). `elapsed_ms` is
 * a REQUIRED parameter (not folded into the optional `payload` bag) so a
 * call site cannot accidentally emit this event without the one number that
 * makes it useful.
 */
export function runAbandoned(
  elapsed_ms: number,
  payload?: AnalyticsPayload,
  session_id?: AnalyticsId,
): AnalyticsEvent {
  // Spreading an `AnalyticsPayload` (whose forbidden keys are typed `never`)
  // into a fresh object literal confuses TS's index-signature check with
  // spurious `?: undefined` members; the cast re-asserts the already-checked
  // shape rather than weakening it (`payload` itself stays fully typed above).
  const merged = { ...(payload ?? {}), elapsed_ms } as unknown as AnalyticsPayload;
  return buildEvent("run_abandoned", merged, session_id);
}

export function cancelClicked(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("cancel_clicked", payload, session_id);
}

export function verifyClicked(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("verify_clicked", payload, session_id);
}

export function verificationCompleted(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("verification_completed", payload, session_id);
}

export function enhanceOpened(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("enhance_opened", payload, session_id);
}

export function enhanceCompleted(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("enhance_completed", payload, session_id);
}

export function upgradeViewed(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("upgrade_viewed", payload, session_id);
}

export function upgradeStarted(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("upgrade_started", payload, session_id);
}

export function upgradeCompleted(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("upgrade_completed", payload, session_id);
}

export function runRevisited(payload?: AnalyticsPayload, session_id?: AnalyticsId): AnalyticsEvent {
  return buildEvent("run_revisited", payload, session_id);
}
