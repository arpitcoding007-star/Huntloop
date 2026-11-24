"use client";

import { useEffect, useRef } from "react";
import { markExchangeNoticesReadAction } from "../actions";

/**
 * Marks the feed read once it has been shown. In an effect rather than during
 * the server render, so a link prefetch never marks anything read.
 */
export function MarkRead({ org }: { org: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void markExchangeNoticesReadAction(org);
  }, [org]);
  return null;
}
