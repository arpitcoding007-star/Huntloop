"use client";

import { useEffect } from "react";
import { seenCookieName } from "../../../../lib/changes-window";

/**
 * Records this visit, after the page has rendered with the previous one.
 * The next Command Center load counts changes from `at` (the server's clock
 * for this render, so the two windows meet without a gap). A year, lax,
 * path-wide; it holds a timestamp and nothing else.
 */
export function MarkSeen({ org, at }: { org: string; at: string }) {
  useEffect(() => {
    try {
      document.cookie = `${seenCookieName(org)}=${encodeURIComponent(at)}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* A browser that refuses cookies gets the 7-day window every time. */
    }
  }, [org, at]);
  return null;
}
