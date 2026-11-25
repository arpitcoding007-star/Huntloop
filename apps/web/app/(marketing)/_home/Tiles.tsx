"use client";

import { Check } from "lucide-react";
import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ScoreRing } from "@huntloop/ui";

/** Five benefits, each a small thing to try. */
export function Tiles() {
  return (
    <div className="tiles">
      <Scores />
      <Limit />
      <Edits />
      <Replies />
      <Consent />
    </div>
  );
}

const DIMENSIONS = ["Profile fit", "Problem", "Freshness", "Right person"];
const FACTS = ["Senior Accountant role", "Series B in October"];
/** Keyed by which facts are kept. `null` is Unknown, never zero. */
const READINGS: Record<string, { score: number; values: (number | null)[] }> = {
  "true,true": { score: 92, values: [90, 72, 95, null] },
  "true,false": { score: 71, values: [86, 70, 95, null] },
  "false,true": { score: 76, values: [90, null, 74, null] },
  "false,false": { score: 41, values: [78, null, null, null] },
};

function Scores() {
  const [kept, setKept] = useState([true, true]);
  const { score, values } = READINGS[kept.join()]!;
  return (
    <article className="win tl lead2">
      <div className="tx">
        <h3>Scores you can question</h3>
        <p className="sec">Remove a fact. See what still stands.</p>
      </div>
      <div className="tv">
        <div className="ew">
          <ScoreRing score={score} size="lg" className="size-[112px]" />
          <div>
            {DIMENSIONS.map((d, i) => {
              const v = values[i] ?? null;
              return (
                <div key={d} className={`eb ${v === null ? "u" : ""}`}>
                  <span>{d}</span>
                  <i>
                    <b style={{ width: `${v ?? 0}%` }} />
                  </i>
                  <span className="tn">{v ?? "Unknown"}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="row wrap facts">
          {FACTS.map((f, i) => (
            <button
              key={f}
              type="button"
              aria-pressed={kept[i]}
              onClick={() => setKept(kept.map((k, j) => (j === i ? !k : k)))}
            >
              <Check aria-hidden className="size-[15px]" strokeWidth={1.8} />
              {f}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

const UNATTENDED = "Sends without approval. Set by an owner or admin.";
const LEVELS = [
  "Draft only. Every message waits for a person.",
  "Approve each. A person approves every message.",
  "Approve the first. Follow-ups then send.",
  `Exceptions. ${UNATTENDED}`,
  `Notify only. ${UNATTENDED}`,
  `Autonomous. ${UNATTENDED}`,
];

function Limit() {
  const [level, setLevel] = useState(0);
  const group = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    const d = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
    if (!d) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(LEVELS.length - 1, level + d));
    setLevel(next);
    (group.current!.children[next] as HTMLElement).focus();
  };
  return (
    <article className="win tl">
      <div className="tx">
        <h3>You set the limit</h3>
        <p className="sec" aria-live="polite">
          {LEVELS[level]}
        </p>
      </div>
      <div className="tv">
        <div className="lvl" role="radiogroup" aria-label="Autonomy level" ref={group}>
          {LEVELS.map((l, i) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={i === level}
              aria-label={`Level ${i}. ${l}`}
              tabIndex={i === level ? 0 : -1}
              className={i < level ? "fill" : undefined}
              style={{ height: `${30 + i * 14}%` }}
              onClick={() => setLevel(i)}
              onKeyDown={onKeyDown}
            >
              {i}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

function Edits() {
  const [cut, setCut] = useState(false);
  return (
    <article className="win tl">
      <div className="tx">
        <h3>It learns your edits</h3>
        <p className="sec" aria-live="polite">
          {cut ? "Cut it a few times and drafts drop it. Press to undo." : "Press the highlighted line to cut it."}
        </p>
      </div>
      <div className="tv">
        <p className="dr">
          Hi Dana,
          <br />
          <button type="button" className="cut" aria-pressed={cut} onClick={() => setCut(!cut)}>
            Hope you are well.
          </button>{" "}
          Northwind is hiring a Senior Accountant after its Series B.
        </p>
      </div>
    </article>
  );
}

function Replies() {
  const [gathered, setGathered] = useState(false);
  return (
    <article className="win tl">
      <div className="tx">
        <h3>Replies become direction</h3>
        <p className="sec" aria-live="polite">
          {gathered ? "Three replies, one theme." : "Press to see what they share."}
        </p>
      </div>
      <button
        type="button"
        className="pile"
        aria-pressed={gathered}
        aria-label="Gather three replies into one theme: multi-entity consolidation"
        onClick={() => setGathered(!gathered)}
      >
        <span>Multi-entity, please</span>
        <span>Need UK consolidation</span>
        <span>Lost: single entity</span>
        <b>Multi-entity consolidation</b>
      </button>
    </article>
  );
}

const CONSENT = [
  "Private. Suppliers see nothing.",
  "Counted. Only in groups of ten or more.",
  "Anonymous. Approximate details.",
  "Open. Your words, still no name.",
  "Accepted. You shared your name.",
];

/* A hidden value is not in the document, so nothing can read it early. */
function Covered({ children, shown }: { children: string; shown: boolean }) {
  return <span className={`cv ${shown ? "o" : ""}`}>{shown ? children : <span className="sr-only">Hidden</span>}</span>;
}

function Consent() {
  const [step, setStep] = useState(2);
  return (
    <article className="win tl">
      <div className="tx">
        <h3>Buyers, by consent</h3>
        <p className="sec" aria-live="polite">
          {CONSENT[step]}
        </p>
      </div>
      <div className="tv">
        <div className="idc">
          <p>
            <span className="mut">Need</span>
            <Covered shown={step > 0}>{step > 2 ? "Monthly bookkeeping" : "Accounting"}</Covered>
          </p>
          <p>
            <span className="mut">Size</span>
            <Covered shown={step > 1}>{step > 2 ? "12 people" : "10 to 20 people"}</Covered>
          </p>
          <p>
            <span className="mut">Name</span>
            <Covered shown={step > 3}>Fieldnote</Covered>
          </p>
        </div>
        <input
          type="range"
          min={0}
          max={4}
          value={step}
          aria-label="How much a supplier may see"
          aria-valuetext={CONSENT[step]}
          style={{ "--v": `${step * 25}%` } as CSSProperties}
          onChange={(e) => setStep(Number(e.target.value))}
        />
      </div>
    </article>
  );
}
