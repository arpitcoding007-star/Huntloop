"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { BRAND_MARK_PATH } from "@huntloop/ui/brand";
import { reducedMotion } from "./motion";

/** Invented companies. Most have no reason yet; that is the point. */
const QUIET = [
  "Acorn Labs", "Bluefin Co", "Cedar Works", "Delta Press", "Ember Retail", "Foxglove", "Granite Soft",
  "Harbor Tech", "Iris Health", "Juniper Data", "Kite Media", "Lumen Ops", "Maple Legal", "Orchid Bio",
  "Pine Supply", "Quill Docs", "River Bank", "Slate HR", "Umber Foods", "Vale Travel",
];
type Company = { name: string; reason?: { text: string; score: number } };
const FOUND: Record<number, Company> = {
  2: { name: "Northwind Systems", reason: { text: "Posted a Senior Accountant role 3 days ago", score: 92 } },
  7: { name: "Vertex Labs", reason: { text: "Opened a second office 6 days ago", score: 89 } },
  12: { name: "Halcyon Cloud", reason: { text: "Closed a Series A 11 days ago", score: 84 } },
  17: { name: "Pioneer Tech", reason: { text: "Entering two new countries, 9 days ago", score: 78 } },
};
const COMPANIES: Company[] = (() => {
  let k = 0;
  return Array.from({ length: 24 }, (_, i) => FOUND[i] ?? { name: QUIET[k++]! });
})();

const N = COMPANIES.length;
const STEP = 7.5; // degrees between dots
const PLACES = 360 / STEP; // the set goes round twice
const START = 2;
const mod = (a: number, m: number) => ((a % m) + m) % m;
const at = (p: number) => COMPANIES[mod(Math.round(p), N)]!;
/** Signed distance, in places, from dot `i` to the top of the dial. */
const offset = (i: number, pos: number) => mod(i - pos + PLACES / 2, PLACES) - PLACES / 2;

/**
 * The hero: one large arc of companies under the mark, which holds the one at
 * the top and says whether there is a reason to contact it.
 *
 * Positions are written straight to the DOM on each frame; React renders only
 * when the company under the mark changes.
 */
export function Dial({ note }: { note: string }) {
  const arc = useRef<HTMLDivElement>(null);
  const pos = useRef(START);
  const to = useRef(START);
  const frame = useRef(0);
  const drag = useRef<{ x: number; from: number; moved: number } | null>(null);
  const [shown, setShown] = useState(START);
  /* The first company is simply there; only later ones fade in. */
  const [moved, setMoved] = useState(false);

  const lay = useCallback(() => {
    const el = arc.current;
    if (!el) return;
    const r = el.offsetWidth / 2;
    [...el.children].forEach((node, i) => {
      const dot = node as HTMLElement;
      const d = offset(i, pos.current);
      const near = Math.abs(d) < 11;
      dot.style.visibility = near ? "visible" : "hidden";
      if (!near) return;
      const a = ((d * STEP - 90) * Math.PI) / 180;
      dot.style.transform = `translate(${r * Math.cos(a)}px, ${r * Math.sin(a)}px)`;
      dot.classList.toggle("at", Math.abs(d) < 0.4);
    });
  }, []);

  const go = useCallback(
    (p: number) => {
      to.current = p;
      setShown(mod(Math.round(p), N));
      if (p !== START) setMoved(true);
      const tick = () => {
        frame.current = 0;
        const ease = reducedMotion() ? 1 : drag.current ? 0.5 : 0.11;
        pos.current += (to.current - pos.current) * ease;
        if (Math.abs(to.current - pos.current) < 0.002) pos.current = to.current;
        lay();
        if (pos.current !== to.current) frame.current = requestAnimationFrame(tick);
      };
      if (!frame.current) frame.current = requestAnimationFrame(tick);
    },
    [lay],
  );

  useEffect(() => {
    const resized = new ResizeObserver(lay);
    resized.observe(arc.current!);
    if (!reducedMotion()) pos.current = START - 6;
    lay();
    const arrive = setTimeout(() => go(to.current), 250);
    return () => {
      resized.disconnect();
      clearTimeout(arrive);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [go, lay]);

  const nextReason = (d: 1 | -1) => {
    let p = Math.round(to.current);
    do p += d;
    while (!at(p).reason);
    go(p);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const d = ({ ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 } as Record<string, number>)[e.key];
    if (!d) return;
    e.preventDefault();
    go(Math.round(to.current) + d);
  };
  const onPointerDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, from: to.current, moved: 0 };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    d.moved = Math.max(d.moved, Math.abs(dx));
    if (d.moved < 6) return;
    /* Captured only once it is a drag: capturing on press would retarget the
       release, and a press on a dot could no longer be told from empty space. */
    e.currentTarget.setPointerCapture(e.pointerId);
    const perPlace = ((arc.current!.offsetWidth / 2) * STEP * Math.PI) / 180;
    go(d.from - dx / perPlace);
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved >= 6) return go(Math.round(to.current));
    const i = (e.target as HTMLElement).dataset.i;
    if (i !== undefined) go(Math.round(pos.current + offset(Number(i), pos.current)));
  };
  const settle = () => {
    if (!drag.current) return;
    drag.current = null;
    go(Math.round(to.current));
  };

  const { name, reason } = COMPANIES[shown]!;
  return (
    <div className="dial">
      <div
        className="turner"
        role="slider"
        tabIndex={0}
        aria-label="Example companies"
        aria-valuemin={1}
        aria-valuemax={N}
        aria-valuenow={shown + 1}
        aria-valuetext={reason ? `${name}. ${reason.text}. Score ${reason.score}.` : `${name}. No reason yet.`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={settle}
        onPointerLeave={settle}
      >
        <div className="arc" ref={arc}>
          {Array.from({ length: PLACES }, (_, i) => (
            <span key={i} data-i={i} className={at(i).reason ? "y" : undefined} />
          ))}
        </div>
      </div>
      <span className={`hold ${reason ? "y" : ""}`} aria-hidden>
        <svg viewBox="0 0 32 32" fill="none">
          <path
            pathLength={1}
            d={BRAND_MARK_PATH}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <div className="say" data-moved={moved ? "" : undefined} data-testid="dial-company" aria-live="polite">
        <div key={shown}>
          <p className={reason ? "nm2" : "nm2 q"}>{name}</p>
          <p className={reason ? "rs" : "rs q"}>{reason?.text ?? "No reason yet"}</p>
          {reason && (
            <p className="pl">
              <b className="tn">{reason.score}</b>
              <span>A reason to reach out, with its source</span>
            </p>
          )}
        </div>
      </div>
      <div className="turn">
        <button type="button" className="ib" aria-label="Previous company with a reason" onClick={() => nextReason(-1)}>
          <ArrowLeft aria-hidden className="size-[18px]" strokeWidth={1.8} />
        </button>
        <span className="sm mut">{note}</span>
        <button type="button" className="ib" aria-label="Next company with a reason" onClick={() => nextReason(1)}>
          <ArrowRight aria-hidden className="size-[18px]" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
