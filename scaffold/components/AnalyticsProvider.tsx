'use client';

/**
 * AnalyticsProvider.tsx — React context over lib/analytics/track.
 *
 * Wrap your app once in app/layout.tsx:
 *   <AnalyticsProvider>{children}</AnalyticsProvider>
 *
 * This is a passive context: no network calls, no rendered UI, no state of
 * its own. `useAnalytics()` just hands feature code a stable `track` function
 * plus the 19 typed funnel-event builders, so there is exactly ONE place in
 * the app that ever imports `lib/analytics/track` directly. Everything is
 * still gated behind the `r10_analytics` flag and the CON-01 contract inside
 * `track()` itself — this provider adds no gating of its own, it's purely a
 * convenience surface (mirrors `AuthProvider.tsx` / `useAuth()`).
 */

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import {
  track as trackEvent,
  landingView,
  descriptionStarted,
  descriptionSubmitted,
  interviewShown,
  interviewCompleted,
  interviewSkipped,
  searchStarted,
  firstResultRendered,
  runCompleted,
  runAbandoned,
  cancelClicked,
  verifyClicked,
  verificationCompleted,
  enhanceOpened,
  enhanceCompleted,
  upgradeViewed,
  upgradeStarted,
  upgradeCompleted,
  runRevisited,
  type AnalyticsSink,
} from '@/lib/analytics/track';
import type { AnalyticsEvent, AnalyticsId, AnalyticsPayload } from '@/lib/contracts/analyticsEvent';

type AnalyticsContextValue = {
  /** Validate + (maybe) emit a fully-formed event. Prefer the named builders below. */
  track: (event: AnalyticsEvent) => void;
  landingView: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  descriptionStarted: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  descriptionSubmitted: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  interviewShown: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  interviewCompleted: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  interviewSkipped: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  searchStarted: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  firstResultRendered: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  runCompleted: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  /** "The single most important event" (R10.1) — elapsed_ms is required. */
  runAbandoned: (elapsed_ms: number, payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  cancelClicked: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  verifyClicked: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  verificationCompleted: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  enhanceOpened: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  enhanceCompleted: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  upgradeViewed: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  upgradeStarted: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  upgradeCompleted: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
  runRevisited: (payload?: AnalyticsPayload, session_id?: AnalyticsId) => void;
};

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

/**
 * Optional injectable sink, for host apps/tests that want to observe or
 * redirect delivery. Not used by the default export path — `<AnalyticsProvider>`
 * with no props behaves exactly like calling `track()` directly.
 */
export function AnalyticsProvider({
  children,
  sink,
}: {
  children: ReactNode;
  sink?: AnalyticsSink;
}) {
  const track = useCallback((event: AnalyticsEvent) => trackEvent(event, sink), [sink]);

  const value = useMemo<AnalyticsContextValue>(
    () => ({
      track,
      landingView: (payload, session_id) => track(landingView(payload, session_id)),
      descriptionStarted: (payload, session_id) => track(descriptionStarted(payload, session_id)),
      descriptionSubmitted: (payload, session_id) => track(descriptionSubmitted(payload, session_id)),
      interviewShown: (payload, session_id) => track(interviewShown(payload, session_id)),
      interviewCompleted: (payload, session_id) => track(interviewCompleted(payload, session_id)),
      interviewSkipped: (payload, session_id) => track(interviewSkipped(payload, session_id)),
      searchStarted: (payload, session_id) => track(searchStarted(payload, session_id)),
      firstResultRendered: (payload, session_id) => track(firstResultRendered(payload, session_id)),
      runCompleted: (payload, session_id) => track(runCompleted(payload, session_id)),
      runAbandoned: (elapsed_ms, payload, session_id) =>
        track(runAbandoned(elapsed_ms, payload, session_id)),
      cancelClicked: (payload, session_id) => track(cancelClicked(payload, session_id)),
      verifyClicked: (payload, session_id) => track(verifyClicked(payload, session_id)),
      verificationCompleted: (payload, session_id) => track(verificationCompleted(payload, session_id)),
      enhanceOpened: (payload, session_id) => track(enhanceOpened(payload, session_id)),
      enhanceCompleted: (payload, session_id) => track(enhanceCompleted(payload, session_id)),
      upgradeViewed: (payload, session_id) => track(upgradeViewed(payload, session_id)),
      upgradeStarted: (payload, session_id) => track(upgradeStarted(payload, session_id)),
      upgradeCompleted: (payload, session_id) => track(upgradeCompleted(payload, session_id)),
      runRevisited: (payload, session_id) => track(runRevisited(payload, session_id)),
    }),
    [track],
  );

  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}

export function useAnalytics(): AnalyticsContextValue {
  const ctx = useContext(AnalyticsContext);
  if (!ctx) throw new Error('useAnalytics must be used inside <AnalyticsProvider>');
  return ctx;
}
