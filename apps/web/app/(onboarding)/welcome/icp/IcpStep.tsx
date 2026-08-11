"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardBody, CardHeader } from "@huntloop/ui";
import { Plus, X } from "lucide-react";

/**
 * §9 — the ICP.
 *
 * Two things here are requirements rather than design choices:
 *
 *   · **A small number of high-value questions.** §9 says so explicitly. The
 *     temptation is a long form, because more fields feel like more precision
 *     — but a 30-field form gets abandoned or filled with guesses, and guesses
 *     entered as criteria are indistinguishable from knowledge once stored.
 *
 *   · **Negative criteria are their own thing.** §9 asks "what companies are
 *     NOT a fit?" as its own question, and the schema gives it its own column.
 *     Folding it into the positive list loses the distinction that lets §78
 *     stop a strong trigger dragging a poor-fit company up the list.
 */

const SEGMENTS = ["Crypto trading desks", "AI infrastructure", "Fintech", "Enterprise SaaS"];
const SIZES = ["1–10", "11–50", "51–200", "201–1000", "1000+"];
const REGIONS = ["North America", "Europe", "APAC", "Global"];

function Chips({
  options,
  selected,
  onToggle,
  label,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o)}
            className={[
              "hl-focusable h-8 rounded-md border px-3 text-[13px] transition-colors duration-[120ms]",
              on
                ? "border-brand-border bg-brand-surface text-brand-text"
                : "border-line bg-surface text-fg-secondary hover:border-line-strong hover:text-fg",
            ].join(" ")}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function IcpStep({ org }: { org: string }) {
  const router = useRouter();
  const [segments, setSegments] = useState<string[]>(["Crypto trading desks"]);
  const [sizes, setSizes] = useState<string[]>(["11–50", "51–200"]);
  const [regions, setRegions] = useState<string[]>(["North America", "Europe"]);
  const [triggers, setTriggers] = useState<string[]>([
    "Raised funding in the last 90 days",
    "Shipped an autonomous agent that moves funds",
    "Hiring for on-chain or custody engineering",
  ]);
  const [exclusions, setExclusions] = useState<string[]>([
    "Consumer-facing products",
    "Companies with no engineering team",
  ]);
  const [draft, setDraft] = useState("");
  const [draftExclusion, setDraftExclusion] = useState("");

  const toggle = (set: (fn: (p: string[]) => string[]) => void) => (v: string) =>
    set((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));

  return (
    <>
      <h1 className="text-[26px] leading-8 font-semibold text-fg">
        Who should we hunt for?
      </h1>
      <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
        Drafted from your website. Change anything — this decides what counts as
        a good opportunity, and you can edit it again later.
      </p>

      <div className="mt-6 max-w-2xl space-y-4">
        <Card flush>
          <CardHeader title="Who they are" />
          <CardBody className="space-y-5">
            <div>
              <p className="mb-2 text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
                Segment
              </p>
              <Chips
                label="Segment"
                options={SEGMENTS}
                selected={segments}
                onToggle={toggle(setSegments)}
              />
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
                Company size
              </p>
              <Chips
                label="Company size"
                options={SIZES}
                selected={sizes}
                onToggle={toggle(setSizes)}
              />
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
                Region
              </p>
              <Chips
                label="Region"
                options={REGIONS}
                selected={regions}
                onToggle={toggle(setRegions)}
              />
            </div>
          </CardBody>
        </Card>

        <Card flush>
          <CardHeader
            title="What makes them ready to buy"
            description="The events that turn a fit into an opportunity."
          />
          <CardBody className="space-y-3">
            <ul className="space-y-2">
              {triggers.map((t) => (
                <li
                  key={t}
                  className="flex items-start justify-between gap-2 rounded-md border border-line-subtle bg-surface px-3 py-2"
                >
                  <span className="text-[13px] leading-[1.5] text-fg-secondary">{t}</span>
                  <button
                    type="button"
                    aria-label={`Remove trigger: ${t}`}
                    onClick={() => setTriggers((p) => p.filter((x) => x !== t))}
                    className="hl-focusable shrink-0 rounded-sm p-0.5 text-fg-muted hover:text-fg-secondary"
                  >
                    <X className="size-3.5" strokeWidth={1.75} />
                  </button>
                </li>
              ))}
            </ul>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.trim()) return;
                setTriggers((p) => [...p, draft.trim()]);
                setDraft("");
              }}
              className="flex gap-2"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Add a buying trigger"
                placeholder="Add a trigger…"
                className="hl-focusable h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-[13px] text-fg placeholder:text-fg-muted"
              />
              <Button type="submit" size="sm" variant="secondary" icon={Plus}>
                Add
              </Button>
            </form>
          </CardBody>
        </Card>

        {/* Its own card, its own column in the schema. §9 asks this as a
            separate question and §78 relies on the answer. */}
        <Card flush>
          <CardHeader
            title="Who is never a fit"
            description="Huntloop will mark these IGNORE no matter how strong the trigger."
          />
          <CardBody className="space-y-3">
            <ul className="flex flex-wrap gap-1.5">
              {exclusions.map((x) => (
                <li key={x}>
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-active px-2.5 py-1 text-[13px] text-fg-secondary">
                    {x}
                    <button
                      type="button"
                      aria-label={`Remove exclusion: ${x}`}
                      onClick={() => setExclusions((p) => p.filter((v) => v !== x))}
                      className="hl-focusable rounded-sm text-fg-muted hover:text-fg-secondary"
                    >
                      <X className="size-3" strokeWidth={1.75} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!draftExclusion.trim()) return;
                setExclusions((p) => [...p, draftExclusion.trim()]);
                setDraftExclusion("");
              }}
              className="flex gap-2"
            >
              <input
                value={draftExclusion}
                onChange={(e) => setDraftExclusion(e.target.value)}
                aria-label="Add an exclusion"
                placeholder="Add an exclusion…"
                className="hl-focusable h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-[13px] text-fg placeholder:text-fg-muted"
              />
              <Button type="submit" size="sm" variant="secondary" icon={Plus}>
                Add
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          onClick={() => router.push(`/welcome/sources?org=${org}`)}
        >
          Continue to sources
        </Button>
        <Badge variant="neutral">Editable later in Settings → ICP</Badge>
      </div>
    </>
  );
}
