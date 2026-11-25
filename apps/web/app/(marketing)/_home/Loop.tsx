"use client";

import {
  Activity,
  FileSearch,
  GraduationCap,
  Radar,
  Scale,
  Send,
  User,
  UserSearch,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ClaimBadge, PriorityBadge, ScoreRing } from "@huntloop/ui";
import { BRAND_MARK_DOT_R, BRAND_MARK_PATH, BRAND_MARK_STROKE } from "@huntloop/ui/brand";
import { reducedMotion } from "./motion";

function Li({ children, note, end }: { children: ReactNode; note?: string; end: ReactNode }) {
  return (
    <div className="li">
      <span>
        {children}
        {note && <small>{note}</small>}
      </span>
      {end}
    </div>
  );
}
const Chip = ({ on, children }: { on?: boolean; children: ReactNode }) => (
  <span className={on ? "chip on" : "chip"}>{children}</span>
);

/** One invented prospect, followed through all seven stages. */
const STAGES: { name: string; icon: LucideIcon; note: string; body: ReactNode }[] = [
  {
    name: "Discover",
    icon: Radar,
    note: "From your profile",
    body: (
      <>
        <h3>Funded software companies, 50 to 200 people</h3>
        <Li end={<Chip>Searched</Chip>}>Business database</Li>
        <Li end={<Chip on>1 new role</Chip>}>Public job boards</Li>
        <Li end={<Chip on>1 new round</Chip>}>News and funding feeds</Li>
        <Li note="Cannot be searched for. Reported, not dropped." end={<Chip>Reported</Chip>}>
          No in-house finance lead
        </Li>
      </>
    ),
  },
  {
    name: "Research",
    icon: FileSearch,
    note: "From the source page",
    body: (
      <>
        <p className="sm mut mb-2.5">northwind.example/careers</p>
        <p className="mb-4 text-[18px] leading-[1.6]">
          We closed our Series B in October and now operate three entities. You will{" "}
          <mark>own month-end close across all of them</mark>.
        </p>
        <Li end={<ClaimBadge kind="fact" size="md" />}>Posted a Senior Accountant role</Li>
        <Li end={<ClaimBadge kind="inference" size="md" />}>Close depends on one person</Li>
        <Li end={<ClaimBadge kind="unknown" size="md" />}>Current provider</Li>
      </>
    ),
  },
  {
    name: "Qualify",
    icon: Scale,
    note: "Eight dimensions",
    body: (
      <>
        <div className="row mb-3.5 gap-[18px]">
          <ScoreRing score={92} size="lg" className="size-[84px]" />
          <span>
            <PriorityBadge priority="hot" reason="Fits, with evidence from this week" />
            <br />
            <span className="sec sm">Assessment 84, your rule +8</span>
          </span>
        </div>
        <Li end={<b>95</b>}>Trigger freshness</Li>
        <Li end={<b>90</b>}>Customer profile fit</Li>
        <Li end={<b>66</b>}>Buying likelihood</Li>
        <Li end={<span className="mut">Unknown</span>}>Decision-maker access</Li>
      </>
    ),
  },
  {
    name: "Find contacts",
    icon: UserSearch,
    note: "Ranked by persona",
    body: (
      <>
        <Li note="VP Finance" end={<Chip on>Best fit</Chip>}>
          Dana Okonkwo
        </Li>
        <Li note="Chief Operating Officer" end={<Chip>Possible</Chip>}>
          Ines Marlow
        </Li>
        <Li note="Found by one provider, confirmed by another" end={<ClaimBadge kind="fact" size="md" />}>
          dana@northwind.example
        </Li>
        <Li note="Shared address" end={<Chip>Rejected</Chip>}>
          <s className="mut">info@northwind.example</s>
        </Li>
      </>
    ),
  },
  {
    name: "Reach out",
    icon: Send,
    note: "Waiting for a person",
    body: (
      <>
        <p className="mb-4 text-[17px] leading-[1.6]">
          I saw Northwind is hiring a Senior Accountant right after the Series B. Ledgerline can run the
          month-end close while you recruit.
        </p>
        <Li end={<Chip on>2 facts on file</Chip>}>Cites</Li>
        <Li end={<span>Your own mailbox</span>}>From</Li>
        <Li end={<Chip>Awaiting approval</Chip>}>Status</Li>
      </>
    ),
  },
  {
    name: "Track",
    icon: Activity,
    note: "A reply arrives",
    body: (
      <>
        <p className="mb-4 text-[18px] leading-[1.5]">
          &ldquo;We need multi-entity consolidation. Could we talk Tuesday?&rdquo;
        </p>
        <Li end={<Chip>Stopped</Chip>}>Sequence</Li>
        <Li end={<Chip on>Moved to Replied</Chip>}>Deal</Li>
        <Li end={<Chip on>First in the queue</Chip>}>Needs you</Li>
        <Li end={<Chip>One request added</Chip>}>Demand themes</Li>
      </>
    ),
  },
  /* Learn's body depends on what the visitor has approved. */
  { name: "Learn", icon: GraduationCap, note: "Proposed, not applied", body: null },
];

const N = STAGES.length;
const LAST = N - 1;
const R = 262;
const angle = (p: number) => ((-90 + (p * 360) / N) * Math.PI) / 180;
/* Rounded: the server and the browser may differ in the last digit of a cosine. */
const px = (n: number) => Math.round(n * 100) / 100;
const point = (p: number, r = R) => [px(r * Math.cos(angle(p))), px(r * Math.sin(angle(p)))] as const;
const GATE = point(LAST + 0.5);

const NODES = STAGES.map((stage, i) => {
  const [x, y] = point(i);
  const c = Math.cos(angle(i));
  const level = Math.abs(c) < 0.5;
  return {
    ...stage,
    x,
    y,
    lx: px(x + c * 46),
    ly: px(y + Math.sin(angle(i)) * (level ? 58 : 44) + 7),
    anchor: (level ? "middle" : c > 0 ? "start" : "end") as "middle" | "start" | "end",
  };
});

function arcPath(p: number) {
  if (p >= N - 0.01) return `M0 ${-R}A${R} ${R} 0 1 1 -0.01 ${-R}`;
  if (p < 0.002) return "";
  const [x, y] = point(p);
  return `M0 ${-R}A${R} ${R} 0 ${p > N / 2 ? 1 : 0} 1 ${x} ${y}`;
}

/** How many companies are still travelling into each stage. */
const FLOW = [34, 22, 12, 6, 3, 1];
const easeInOut = (q: number) => (q < 0.5 ? 4 * q ** 3 : 1 - (-2 * q + 2) ** 3 / 2);

/** 0 nothing approved, 1 finding accepted, 2 rule activated. */
type Approved = 0 | 1 | 2;

/**
 * The seven stages on a ring. The traveller can be pressed, dragged or
 * stepped; the last stretch, from Learn back to Discover, does not close
 * until a person accepts the finding and activates its rule.
 *
 * Position is written straight to the SVG; React renders on stage changes.
 */
export function Loop() {
  const svg = useRef<SVGSVGElement>(null);
  const path = useRef<SVGPathElement>(null);
  const traveller = useRef<SVGGElement>(null);
  const crowd = useRef<SVGGElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const pos = useRef(0);
  const frame = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const dragging = useRef(false);
  const stage = useRef(0);

  const [at, setAt] = useState(0);
  const [approved, setApproved] = useState<Approved>(0);
  const [round, setRound] = useState(1);
  const [closed, setClosed] = useState(false);
  const [nudged, setNudged] = useState(false);
  /* The first stage is simply there; only later ones fade in. */
  const [moved, setMoved] = useState(false);

  const paint = useCallback(() => {
    const p = pos.current;
    path.current?.setAttribute("d", arcPath(p));
    const resting = Math.abs(p - Math.round(p)) < 0.04;
    const [x, y] = point(p);
    traveller.current?.setAttribute("transform", `translate(${x} ${y})`);
    if (traveller.current) traveller.current.style.opacity = resting ? "0" : "1";
    svg.current?.querySelectorAll("[data-i]").forEach((node, i) => {
      node.classList.toggle("done", i < p - 0.04 || p > N - 0.01);
      node.classList.toggle("on", resting && i === Math.round(p) % N);
    });
  }, []);

  useEffect(() => {
    paint();
    const pending = timers.current;
    return () => {
      cancelAnimationFrame(frame.current);
      pending.forEach(clearTimeout);
    };
  }, [paint]);

  const halo = (i: number) => {
    if (reducedMotion()) return;
    svg.current?.querySelector(`[data-i="${i % N}"] .halo`)?.animate(
      [
        { opacity: 0.8, r: "27px", strokeWidth: 6 },
        { opacity: 0, r: "66px", strokeWidth: 1 },
      ],
      { duration: 800, easing: "cubic-bezier(.16,1,.3,1)" },
    );
  };

  /** Companies moving between two stages; the ones that do not qualify drift off. */
  const flow = (a: number, b: number) => {
    const group = crowd.current;
    if (!group || reducedMotion() || b <= a) return;
    const total = FLOW[Math.floor(a)] ?? 1;
    const stay = FLOW[Math.floor(a) + 1] ?? 1;
    for (let k = 0; k < total; k++) {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      const off = (Math.random() - 0.5) * 58;
      const start = performance.now() + Math.random() * 420;
      const drops = k >= stay;
      c.setAttribute("r", String(2.5 + Math.random() * 2.5));
      c.setAttribute("fill", "var(--hl-brand-vivid)");
      c.setAttribute("opacity", "0");
      group.append(c);
      const step = (t: number) => {
        const q = Math.min(1, Math.max(0, (t - start) / 820));
        const m = q < 0.5 ? 2 * q * q : 1 - (-2 * q + 2) ** 2 / 2;
        const [x, y] = point(a + (b - a) * m, R + off * (drops ? 1 + q * 2.2 : 1 - q));
        c.setAttribute("cx", String(x));
        c.setAttribute("cy", String(y));
        c.setAttribute("opacity", String(t < start ? 0 : drops ? 0.8 * (1 - q) : 0.9));
        if (q < 1 && c.isConnected) requestAnimationFrame(step);
        else c.remove();
      };
      requestAnimationFrame(step);
    }
  };

  const moveTo = (p: number, done?: () => void) => {
    cancelAnimationFrame(frame.current);
    const a = pos.current;
    const still = reducedMotion();
    const ms = still ? 1 : Math.min(1500, 700 * Math.abs(p - a) || 1);
    if (p > a && !still)
      for (let k = Math.floor(a + 0.05); k < p; k++) {
        const timer = setTimeout(
          () => {
            timers.current.delete(timer);
            flow(Math.max(a, k), Math.min(p, k + 1));
          },
          (ms * Math.max(0, k - a)) / (p - a),
        );
        timers.current.add(timer);
      }
    const t0 = performance.now();
    const step = (t: number) => {
      const q = Math.min(1, Math.max(0, (t - t0) / ms));
      pos.current = q < 1 ? a + (p - a) * easeInOut(q) : p;
      paint();
      if (q < 1) frame.current = requestAnimationFrame(step);
      else done?.();
    };
    frame.current = requestAnimationFrame(step);
  };

  const show = (i: number) => {
    stage.current = i;
    setAt(i);
    setMoved(true);
    setNudged(false);
    setClosed(false);
  };
  const goTo = (i: number) => {
    const k = Math.max(0, Math.min(LAST, i));
    if (k === stage.current && Math.abs(pos.current - k) < 0.01) return;
    show(k);
    moveTo(k, () => halo(k));
  };
  const approve = () => {
    const next = Math.min(2, approved + 1) as Approved;
    setApproved(next);
    setNudged(false);
    if (next === 2)
      moveTo(N, () => {
        halo(0);
        setClosed(true);
        nextButton.current?.focus({ preventScroll: true });
      });
  };
  /* Accepting the finding replaces the button that was pressed; the keyboard
     follows to the one that takes its place. */
  useEffect(() => {
    if (approved === 1) body.current?.querySelector("button")?.focus({ preventScroll: true });
  }, [approved]);

  const restart = () => {
    cancelAnimationFrame(frame.current);
    setRound(round + 1);
    setApproved(0);
    show(0);
    pos.current = 0;
    paint();
    halo(0);
  };
  const nudge = () => {
    setNudged(true);
    if (reducedMotion()) {
      pos.current = LAST;
      return paint();
    }
    const t0 = performance.now();
    const step = (t: number) => {
      const q = (t - t0) / 700;
      pos.current = q >= 1 ? LAST : LAST + 0.34 * Math.sin(Math.max(0, q) * Math.PI) * (1 - q * 0.5);
      paint();
      if (q < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  const place = (e: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 800 - 400;
    const y = ((e.clientY - r.top) / r.height) * 800 - 400;
    return { p: (((Math.atan2(y, x) * 180) / Math.PI + 450) % 360) / (360 / N), far: Math.hypot(x, y) };
  };
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const { p, far } = place(e);
    const gap = Math.abs(p - pos.current);
    if (approved === 2 || Math.abs(far - R) >= 46 || Math.min(gap, N - gap) >= 0.3) return;
    dragging.current = true;
    cancelAnimationFrame(frame.current);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging.current) return;
    let { p } = place(e);
    if (Math.abs(p - pos.current) > N / 2) p = pos.current > N / 2 ? N : 0;
    if (p > LAST) p = LAST + (p - LAST) * 0.3;
    pos.current = Math.max(0, p);
    const k = Math.min(LAST, Math.round(pos.current));
    if (k !== stage.current) {
      if (k > stage.current) flow(stage.current, k);
      show(k);
      halo(k);
    }
    paint();
  };
  const release = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (pos.current > LAST + 0.04) nudge();
    else moveTo(stage.current);
  };

  const press = (e: KeyboardEvent, act: () => void) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    act();
  };
  const onNodeKey = (e: KeyboardEvent, i: number) => {
    press(e, () => goTo(i));
    const d = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
    if (!d) return;
    e.preventDefault();
    const k = Math.max(0, Math.min(LAST, i + d));
    svg.current?.querySelector<SVGGElement>(`[data-i="${k}"]`)?.focus();
    goTo(k);
  };
  const onGate = () => {
    if (at < LAST) goTo(LAST);
    else if (approved < 2) approve();
  };

  const status = closed
    ? "The loop is closed"
    : nudged
      ? "It waits for you here"
      : at === LAST && approved < 2
        ? "Waiting for you"
        : round > 1 && at === 0
          ? `Round ${round}, with your rule`
          : "Intelligence in motion";
  const current = STAGES[at]!;

  return (
    <div className="loopg">
      <svg
        ref={svg}
        className="orbit"
        viewBox="-400 -400 800 800"
        role="group"
        aria-label="The seven-stage loop"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <circle
          r={R}
          fill="none"
          stroke="var(--hl-border-strong)"
          strokeWidth={3}
          strokeDasharray="2 13"
          strokeLinecap="round"
        />
        <path ref={path} fill="none" stroke="var(--hl-brand)" strokeWidth={6} strokeLinecap="round" />
        <g ref={crowd} />
        <g transform="translate(-74 -138) scale(4.6)">
          <path
            d={BRAND_MARK_PATH}
            fill="none"
            stroke="var(--hl-text)"
            strokeWidth={BRAND_MARK_STROKE}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="16" r={BRAND_MARK_DOT_R} fill="var(--hl-mark-dot)" />
        </g>
        <text textAnchor="middle" y={66} fontSize={46} fontWeight={600} letterSpacing={-1.8} fill="var(--hl-text)">
          Huntloop
        </text>
        <text textAnchor="middle" y={104} fontSize={21} fill="var(--hl-text-muted)" data-testid="loop-status">
          {status}
        </text>
        {NODES.map(({ name, icon: Icon, x, y, lx, ly, anchor }, i) => (
          <g
            key={name}
            className="nd"
            data-i={i}
            tabIndex={0}
            role="button"
            aria-label={`${name}, stage ${i + 1} of ${N}`}
            aria-current={i === at ? "step" : undefined}
            onClick={() => goTo(i)}
            onKeyDown={(e) => onNodeKey(e, i)}
          >
            <circle className="halo" cx={x} cy={y} r={27} />
            <circle cx={x} cy={y} r={40} fill="transparent" />
            <circle className="c" cx={x} cy={y} r={27} />
            <Icon className="ico" x={x - 13} y={y - 13} width={26} height={26} strokeWidth={1.8} aria-hidden />
            <text className="lb" x={lx} y={ly} textAnchor={anchor}>
              {name}
            </text>
          </g>
        ))}
        <g
          className="nd"
          tabIndex={0}
          role="button"
          aria-label="Approval gate"
          onClick={onGate}
          onKeyDown={(e) => press(e, onGate)}
        >
          <circle
            className="gate"
            cx={GATE[0]}
            cy={GATE[1]}
            r={20}
            fill={approved === 2 ? "var(--hl-brand)" : "var(--hl-band)"}
            stroke={
              approved === 2 ? "var(--hl-brand)" : approved ? "var(--hl-brand-vivid)" : "var(--hl-border-strong)"
            }
            strokeWidth={2}
          />
          <User x={GATE[0] - 10} y={GATE[1] - 10} width={20} height={20} strokeWidth={1.8} aria-hidden />
        </g>
        <g ref={traveller} className="trav" opacity={0} pointerEvents="none">
          <circle r={11} fill="var(--hl-mark-dot)" stroke="var(--hl-band)" strokeWidth={4} />
        </g>
      </svg>

      <div className="win pan">
        <div className="panh">
          <b>{current.name}</b>
          <span className="mut">{current.note}</span>
        </div>
        <div className="panb" data-moved={moved ? "" : undefined} aria-live="polite" ref={body}>
          <div key={at}>{at === LAST ? <Learn approved={approved} onApprove={approve} /> : current.body}</div>
        </div>
        <div className="panf">
          <span className="prgs" aria-hidden>
            {STAGES.map((s, i) => (
              <i key={s.name} className={i <= at ? "on" : undefined} />
            ))}
          </span>
          <span className="row">
            <button type="button" className="btn s c" disabled={at === 0 || approved === 2} onClick={() => goTo(at - 1)}>
              Back
            </button>
            <button
              type="button"
              className="btn c"
              ref={nextButton}
              disabled={at === LAST && approved < 2}
              onClick={() => (at < LAST ? goTo(at + 1) : restart())}
            >
              {at < LAST ? "Next stage" : approved === 2 ? "Start the next round" : "Approve to continue"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

function Learn({ approved, onApprove }: { approved: Approved; onApprove: () => void }) {
  const button = (label: string) => (
    <button type="button" className="btn c" onClick={onApprove}>
      {label}
    </button>
  );
  return (
    <>
      <h3>Finance roles soon after funding led to replies.</h3>
      <p className="sec mt-1.5 mb-3.5">Proposed rule: raise these companies by 6.</p>
      <Li end={approved > 0 ? <Chip on>Accepted by you</Chip> : button("Accept finding")}>Finding</Li>
      <Li
        end={
          approved > 1 ? (
            <Chip on>Activated by you</Chip>
          ) : approved ? (
            button("Activate rule")
          ) : (
            <span className="mut">Off</span>
          )
        }
      >
        Rule
      </Li>
      <Li
        end={
          <span className={approved > 1 ? undefined : "mut"}>
            {approved > 1 ? "Uses your rule when scored" : "Nothing changes yet"}
          </span>
        }
      >
        Next round
      </Li>
    </>
  );
}
