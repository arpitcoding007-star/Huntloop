"use client";

import { useEffect, useRef, useState } from "react";
import { BRAND_MARK_DOT_R, BRAND_MARK_PATH, BRAND_MARK_STROKE } from "@huntloop/ui/brand";

/** The mark, drawn once when it is first seen. */
export function ClosingMark() {
  const ref = useRef<SVGSVGElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setSeen(true), { threshold: 0.35 });
    io.observe(ref.current!);
    return () => io.disconnect();
  }, []);
  return (
    <svg ref={ref} className="endmark" data-in={seen ? "" : undefined} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        pathLength={1}
        d={BRAND_MARK_PATH}
        stroke="currentColor"
        strokeWidth={BRAND_MARK_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r={BRAND_MARK_DOT_R} fill="var(--hl-mark-dot)" />
    </svg>
  );
}
