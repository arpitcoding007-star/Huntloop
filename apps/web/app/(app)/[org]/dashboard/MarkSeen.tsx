"use client";

import { useEffect } from "react";
import { seenCookieName } from "../../../../lib/changes-window";

/**
 * Records this visit when it ends. PANEL-104: written on mount, any refresh or
 * action re-rendered the page against the visit it was still in, and the card
 * emptied itself. `pagehide` fires when the tab closes or leaves the site.
 *
 * The next Command Center load counts changes from `at` (the server's clock
 * for this render, so the two windows meet without a gap). A year, lax,
 * path-wide; it holds a timestamp and nothing else.
 */
export function MarkSeen({ org, at }: { org: string; at: string }) {
  useEffect(() => {
    const record = () => {
      try {
        document.cookie = `${seenCookieName(org)}=${encodeURIComponent(at)}; path=/; max-age=31536000; samesite=lax`;
      } catch {
        /* A browser that refuses cookies gets the 7-day window every time. */
      }
    };
    window.addEventListener("pagehide", record);
    return () => window.removeEventListener("pagehide", record);
  }, [org, at]);
  return null;
}
