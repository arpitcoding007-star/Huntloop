"use client";

import { useEffect, useState } from "react";

/**
 * "⌘K" on Apple platforms, "Ctrl K" everywhere else — a control should name
 * the key the reader will actually press. Starts as ⌘K so the server and
 * client render the same markup, then corrects itself after hydration.
 */
export function useShortcutLabel() {
  const [label, setLabel] = useState("⌘K");
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
    if (!/mac|iphone|ipad|ipod/i.test(platform)) setLabel("Ctrl K");
  }, []);
  return label;
}
