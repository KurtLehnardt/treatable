"use client";

import { useEffect, useState } from "react";

/**
 * SSR-safe media-query hook. Returns `defaultValue` during SSR and the first
 * client render (so hydration matches), then reflects the real match after
 * mount and on subsequent changes.
 *
 * The persistent sidebar defaults this to `true` (assume desktop): desktop is
 * the primary experience for a docked sidebar, so desktop users get the correct
 * first paint and only mobile corrects to the overlay presentation after mount.
 */
export function useMediaQuery(query: string, defaultValue = true): boolean {
  const [matches, setMatches] = useState(defaultValue);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);

  return matches;
}
