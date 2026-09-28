"use client";

import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@huntloop/ui";

/**
 * The six stages on a ring, with the loop advancing from Discover to
 * Qualify.
 *
 * ── What was wrong with the first version ────────────────────────────────
 *
 * The labels sat *on* the ring and the blue arc ended in the middle of
 * "QUALIFY", so the line read as cutting through the diagram rather than
 * arriving anywhere. It was also a fixed 300px box, wider than a 320px
 * phone's content column.
 *
 * Now every stage is a node on the ring, the labels sit outside it on the
 * radius through their node, and the arc starts at Discover's edge and stops
 * at Qualify's — it connects the two, and never crosses either. One SVG in
 * one coordinate space, scaled by its container, so the geometry cannot
 * drift apart at any width.
 *
 * ── The motion ───────────────────────────────────────────────────────────
 *
 * Plays once, when the diagram is scrolled into view: the line draws toward
 * Qualify, and when it arrives the node fills and gives off a single soft
 * halo. Once, not on a loop — a diagram that keeps spinning reads as a
 * loading state, and this one is making a point: the loop moves forward one
 * stage at a time, and a stage is only reached when the work before it is
 * done. `prefers-reduced-motion` gets the finished state, with no motion.
 */

const W = 340;
const H = 320;
const CX = W / 2;
const CY = H / 2;
const R = 100;
const NODE_R = 5;
/** Clearance between a node's edge and the end of the arc. */
const GAP = 3;
const LABEL_OFFSET = 18;

const STAGES = [
  { label: "Discover", angle: -90 },
  { label: "Qualify", angle: -30 },
  { label: "Enrich", angle: 30 },
  { label: "Reach out", angle: 90 },
  { label: "Track", angle: 150 },
  { label: "Learn", angle: 210 },
] as const;

const rad = (deg: number) => (deg * Math.PI) / 180;
const at = (deg: number, radius = R) => ({
  x: +(CX + radius * Math.cos(rad(deg))).toFixed(2),
  y: +(CY + radius * Math.sin(rad(deg))).toFixed(2),
});

/* The arc stops short of each node by the node's radius plus the gap, so
   the line visibly meets the circle rather than running into it. */
const trim = ((NODE_R + GAP) / R) * (180 / Math.PI);
const from = at(STAGES[0].angle + trim);
const to = at(STAGES[1].angle - trim);
const ARC = `M${from.x} ${from.y}A${R} ${R} 0 0 1 ${to.x} ${to.y}`;

function labelProps(angle: number) {
  const cos = Math.cos(rad(angle));
  if (Math.abs(cos) < 0.01) {
    // Top and bottom: centred on the node, above or below it.
    const p = at(angle, R + LABEL_OFFSET + 2);
    return { x: p.x, y: p.y, textAnchor: "middle" as const };
  }
  // Sides: level with the node, reading away from the ring.
  const n = at(angle);
  return {
    x: n.x + (cos > 0 ? 1 : -1) * (NODE_R + 10),
    y: n.y,
    textAnchor: cos > 0 ? ("start" as const) : ("end" as const),
  };
}

export function LoopDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    /* No observer (very old browsers, some test runners): show the result. */
    if (typeof IntersectionObserver === "undefined") {
      setRun(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setRun(true);
          io.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const qualify = at(STAGES[1].angle);

  return (
    <div
      ref={ref}
      data-run={run || undefined}
      className="hl-loop relative mx-auto aspect-[340/320] w-full max-w-[340px]"
    >
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden className="absolute inset-0 size-full overflow-visible">
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          strokeWidth="1.5"
          strokeDasharray="2 6"
          strokeLinecap="round"
          className="stroke-line"
        />

        <path d={ARC} pathLength={1} fill="none" strokeWidth="2.25" strokeLinecap="round" className="hl-loop-arc stroke-brand-vivid" />

        {STAGES.map(({ label, angle }, i) => {
          const n = at(angle);
          const l = labelProps(angle);
          return (
            <g key={label}>
              {i === 1 && (
                <circle cx={qualify.x} cy={qualify.y} r={NODE_R} className="hl-loop-halo fill-brand-vivid" />
              )}
              <circle
                cx={n.x}
                cy={n.y}
                r={NODE_R}
                strokeWidth="1.5"
                className={
                  i === 0
                    ? "fill-brand-vivid stroke-brand-vivid"
                    : i === 1
                      ? "hl-loop-target fill-panel stroke-line-strong"
                      : "fill-panel stroke-line-strong"
                }
              />
              <text
                x={l.x}
                y={l.y}
                textAnchor={l.textAnchor}
                dominantBaseline="middle"
                className={`text-[11px] font-semibold tracking-[0.1em] ${
                  i < 2 ? "fill-fg" : "fill-fg-muted"
                }`}
              >
                {label.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <BrandMark className="size-7 text-fg" />
        <p className="text-[20px] font-semibold tracking-[-0.03em]">Huntloop</p>
      </div>
    </div>
  );
}
