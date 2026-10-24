import { z } from "zod";

/**
 * §3.11 / R10.1 — AnalyticsEvent
 *
 * The funnel event enum + payload shape, with a **schema-level guarantee that
 * free-text description content cannot be attached** (§5.3, R10.1: "Analytics
 * events carry no description content, ever. Event names, IDs, timings, and
 * counts only.").
 *
 * The guarantee is enforced at COMPILE TIME by the TypeScript type, two ways:
 *
 *  1. Payload *values* may only be `number | boolean | AnalyticsId`. A raw
 *     `string` (i.e. free text) is not assignable — so you cannot put a
 *     description anywhere in the payload, under any key. IDs are a branded
 *     string type you must mint via `analyticsId(...)`, which keeps opaque ids
 *     (run id, opportunity id) legal while free text stays illegal.
 *
 *  2. A denylist of content-ish keys (`description`, `text`, `content`, ...) is
 *     forced to `never`, so even a branded-string value under one of those keys
 *     is a type error.
 *
 * `npx tsc --noEmit` is the checker: the contract test uses `@ts-expect-error`
 * on `{ payload: { description: "..." } }`, so if this guarantee ever weakens,
 * the expected error disappears and tsc fails.
 *
 * Zod cannot express "no free-text string" in an inferred type (a branded
 * string is a plain string at runtime), so `AnalyticsEvent` is hand-authored
 * for the compile-time guarantee, and `AnalyticsEventSchema` provides a
 * best-effort RUNTIME guard (it rejects the denylisted keys).
 */

// --- Branded opaque id (the only legal "string" in a payload) ---
declare const ANALYTICS_ID_BRAND: unique symbol;
export type AnalyticsId = string & { readonly [ANALYTICS_ID_BRAND]: true };

/**
 * Id-shape: 1..64 chars, no whitespace, restricted to id-ish characters
 * (letters, digits, `_ . : -`). This is what stops free text from smuggling
 * through as a "branded id". A company description has spaces, punctuation, and
 * length — none of which pass this.
 */
export const ANALYTICS_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * Mint an opaque analytics id (run/opportunity/session id — never free text).
 * THROWS if `id` is not id-shaped, so a description cast to an id fails loudly
 * rather than leaking into the analytics pipeline (§5.3 / R10.1).
 */
export const analyticsId = (id: string): AnalyticsId => {
  if (!ANALYTICS_ID_RE.test(id)) {
    throw new Error(
      `Invalid analytics id ${JSON.stringify(id.slice(0, 24))}${id.length > 24 ? "…" : ""}: ` +
        `must match ${ANALYTICS_ID_RE} (opaque id, not free-text content).`,
    );
  }
  return id as AnalyticsId;
};

// --- The funnel events (R10.1) ---
export const AnalyticsEventNameSchema = z.enum([
  "landing_view",
  "description_started",
  "description_submitted",
  "interview_shown",
  "interview_completed",
  "interview_skipped",
  "search_started",
  "first_result_rendered",
  "run_completed",
  "run_abandoned", // carries elapsed_ms — the single most important event (R10.1)
  "cancel_clicked",
  "verify_clicked",
  "verification_completed",
  "enhance_opened",
  "enhance_completed",
  "upgrade_viewed",
  "upgrade_started",
  "upgrade_completed",
  "run_revisited",
]);
export type AnalyticsEventName = z.infer<typeof AnalyticsEventNameSchema>;

/**
 * Keys that would smuggle description content. Forced to `never` so they can
 * never appear on a payload, regardless of value type.
 */
export type ForbiddenContentKey =
  | "description"
  | "text"
  | "content"
  | "raw"
  | "raw_text"
  | "rawText"
  | "body"
  | "notes"
  | "prompt"
  | "query"
  | "company"
  | "company_description"
  | "companyDescription";

/** Runtime list mirroring `ForbiddenContentKey` for the zod guard. */
export const FORBIDDEN_CONTENT_KEYS: readonly string[] = [
  "description",
  "text",
  "content",
  "raw",
  "raw_text",
  "rawText",
  "body",
  "notes",
  "prompt",
  "query",
  "company",
  "company_description",
  "companyDescription",
];

/**
 * Payload: names, ids, timings, counts, flags — never free text. Values are
 * `number | boolean | AnalyticsId`; the denylisted keys are `never`.
 */
export type AnalyticsPayload = {
  [key: string]: number | boolean | AnalyticsId;
} & Partial<Record<ForbiddenContentKey, never>>;

export type AnalyticsEvent = {
  name: AnalyticsEventName;
  /** Epoch milliseconds. */
  ts: number;
  /** Opaque session/run id (branded — not free text). */
  session_id?: AnalyticsId;
  payload?: AnalyticsPayload;
};

/**
 * Runtime guard — value-aware, not just key-aware. Values may be
 * number | boolean | id-shaped-string. Branded ids erase to plain strings at
 * runtime, so string values are allowed ONLY if they match `ANALYTICS_ID_RE`;
 * that is what makes a free-text value under a benign key
 * (`{ blurb: "we build AI for hospitals, pre-filing IP" }`) fail `safeParse`.
 * The denylisted keys are additionally rejected as defense in depth.
 */
export const AnalyticsPayloadSchema = z
  .record(
    z.string(),
    z.union([z.number(), z.boolean(), z.string().regex(ANALYTICS_ID_RE)]),
  )
  .refine(
    (p) => Object.keys(p).every((k) => !FORBIDDEN_CONTENT_KEYS.includes(k)),
    { message: "Analytics payload must not carry description/free-text content." },
  );

export const AnalyticsEventSchema = z.object({
  name: AnalyticsEventNameSchema,
  ts: z.number().int().nonnegative(),
  // id-shaped at runtime too, so it can't be a free-text smuggle vector.
  session_id: z.string().regex(ANALYTICS_ID_RE).optional(),
  payload: AnalyticsPayloadSchema.optional(),
});
