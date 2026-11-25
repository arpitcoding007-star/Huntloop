"use client";

import { useEffect, useRef, useState } from "react";

type Item = { name: string; reason?: string; score?: number };

const PLAIN = [
  "Acorn Labs", "Bluefin Co", "Cedar Works", "Delta Press", "Ember Retail", "Foxglove", "Granite Soft",
  "Harbor Tech", "Iris Health", "Juniper Data", "Kite Media", "Lumen Ops", "Maple Legal", "Nimbus Pay",
  "Orchid Bio", "Pine Supply", "Quill Docs", "River Bank", "Slate HR", "Tidal Energy", "Umber Foods",
  "Vale Travel", "Willow Edu", "Yarrow Homes", "Zephyr Air",
];
const KEPT: Item[] = [
  { name: "Northwind Systems", reason: "Hiring finance, 3 days ago", score: 92 },
  { name: "Vertex Labs", reason: "Second office, 6 days ago", score: 89 },
  { name: "Halcyon Cloud", reason: "Series A, 11 days ago", score: 84 },
];

/* A seeded scatter, so the server and the browser agree on the order. */
const ITEMS = (() => {
  let seed = 5;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return [...PLAIN.map((name): Item => ({ name })), ...KEPT]
    .map((item) => ({ ...item, r: rnd(), a: rnd(), b: rnd(), kept: KEPT.findIndex((k) => k.name === item.name) }))
    .sort((p, q) => p.r - q.r);
})();

/** A scattered list of names; the button keeps the three with a reason. */
export function FindReasons() {
  const box = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = box.current!;
    const place = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const cols = w < 600 ? 3 : w < 1000 ? 5 : 7;
      const rows = Math.ceil(ITEMS.length / cols);
      [...el.children].forEach((node, i) => {
        const d = node as HTMLElement;
        const o = ITEMS[i]!;
        const kept = o.kept >= 0;
        let x = ((i % cols) + 0.5 + (o.a - 0.5) * 0.5) * (w / cols) - 60;
        let y = (Math.floor(i / cols) + 0.5 + (o.b - 0.5) * 0.5) * (h / rows) - 20;
        let turn = (o.a - 0.5) * 16;
        x = Math.max(0, Math.min(w - d.offsetWidth - 4, x));
        if (on && kept) {
          const kw = Math.min(560, w);
          x = (w - kw) / 2;
          y = h / 2 - 125 + o.kept * 86;
          turn = 0;
          d.style.width = `${kw}px`;
        } else d.style.width = "";
        d.style.transform = `translate(${x}px,${y}px) rotate(${turn}deg)`;
        d.style.opacity = on && !kept ? "0.1" : "1";
        d.style.transitionDelay = on ? `${kept ? 240 + o.kept * 110 : i * 9}ms` : "0ms";
      });
      el.dataset.ready = "";
    };
    const resized = new ResizeObserver(place);
    resized.observe(el);
    place();
    return () => resized.disconnect();
  }, [on]);

  return (
    <>
      <div className={`mess ${on ? "on" : ""}`} ref={box}>
        {ITEMS.map((o) => (
          <div key={o.name} className={`nm ${o.kept >= 0 ? "k" : ""}`} aria-hidden={on && o.kept < 0 ? true : undefined}>
            <b>{o.name}</b>
            {o.reason && (
              <>
                <span>{o.reason}</span>
                <em className="tn">{o.score}</em>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="row mt-5 justify-center">
        <button type="button" className="btn" onClick={() => setOn(!on)}>
          {on ? "Back to the list" : "Find the reasons"}
        </button>
      </p>
    </>
  );
}
