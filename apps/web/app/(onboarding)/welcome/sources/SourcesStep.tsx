"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardBody, CardHeader } from "@huntloop/ui";
import { Check, Plus, X } from "lucide-react";

/**
 * §10 — source discovery.
 *
 * Recommended sources start **accepted**, because a first-run user with an
 * empty source list gets an empty hunt and no way to tell whether the product
 * is broken or just unconfigured. But every one is removable in a single
 * click, and the count is stated plainly — §10 gives the user accept / remove
 * / add, and a default that's hard to undo isn't really a default.
 *
 * Each recommendation carries *why* it was suggested. A list of publication
 * names with no reasoning is unreviewable: the user can only accept it on
 * faith, which is the opposite of what §77 Principle 7 is asking for.
 */

interface Suggestion {
  id: string;
  name: string;
  kind: string;
  why: string;
}

const SUGGESTED: Suggestion[] = [
  {
    id: "the-block",
    name: "The Block",
    kind: "News",
    why: "Covers funding and product launches for crypto trading infrastructure.",
  },
  {
    id: "blockworks",
    name: "Blockworks",
    kind: "News",
    why: "Institutional crypto coverage — your segment's buyers read it.",
  },
  {
    id: "eng-blogs",
    name: "Company engineering blogs",
    kind: "Blog",
    why: "Where your buyers describe the problem in their own words.",
  },
  {
    id: "github",
    name: "GitHub",
    kind: "Code",
    why: "Detects agent and custody work before it's announced.",
  },
  {
    id: "job-boards",
    name: "Job boards",
    kind: "Jobs",
    why: "Hiring for on-chain or custody engineering is one of your triggers.",
  },
  {
    id: "hn",
    name: "Hacker News",
    kind: "Community",
    why: "Founders state problems here that never reach a press release.",
  },
];

export function SourcesStep({ org }: { org: string }) {
  const router = useRouter();
  const [accepted, setAccepted] = useState<string[]>(SUGGESTED.map((s) => s.id));
  const [custom, setCustom] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  const count = accepted.length + custom.length;

  return (
    <>
      <h1 className="text-[26px] leading-8 font-semibold text-fg">
        Where should we look?
      </h1>
      <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
        Suggested from your ideal customer. Remove anything you don&rsquo;t want
        watched, and add your own.
      </p>

      <div className="mt-6 max-w-2xl space-y-4">
        <Card flush>
          <CardHeader
            title="Recommended"
            description="Based on your ICP."
            actions={
              <span className="hl-tabular text-[12px] text-fg-muted">
                {accepted.length}/{SUGGESTED.length} on
              </span>
            }
          />
          <CardBody>
            <ul className="space-y-2">
              {SUGGESTED.map((s) => {
                const on = accepted.includes(s.id);
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium text-fg">{s.name}</span>
                        <Badge variant="neutral">{s.kind}</Badge>
                      </div>
                      <p className="mt-0.5 text-[12px] leading-[1.5] text-fg-muted">
                        {s.why}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={on ? "secondary" : "primary"}
                      icon={on ? Check : Plus}
                      onClick={() =>
                        setAccepted((p) =>
                          on ? p.filter((x) => x !== s.id) : [...p, s.id],
                        )
                      }
                    >
                      {on ? "On" : "Add"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>

        <Card flush>
          <CardHeader
            title="Your own"
            description="A publication, a blog, a subreddit, a competitor's newsroom."
          />
          <CardBody className="space-y-3">
            {custom.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {custom.map((c) => (
                  <li key={c}>
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-active px-2.5 py-1 font-mono text-[12px] text-fg-secondary">
                      {c}
                      <button
                        type="button"
                        aria-label={`Remove ${c}`}
                        onClick={() => setCustom((p) => p.filter((v) => v !== c))}
                        className="hl-focusable rounded-sm text-fg-muted hover:text-fg-secondary"
                      >
                        <X className="size-3" strokeWidth={1.75} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = draft.trim();
                if (!v) return;
                setCustom((p) => (p.includes(v) ? p : [...p, v]));
                setDraft("");
              }}
              className="flex gap-2"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Add your own source"
                placeholder="https://example.com/blog"
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
        {/* A button, not a link wrapping a button. `<a><button disabled>` is
            only half a guard: the anchor stays focusable and Enter navigates
            straight past it, so a keyboard user reaches the dashboard with
            zero sources while a mouse user can't. It is also nested
            interactive content, which no assistive technology reads well. */}
        <Button
          variant="primary"
          size="lg"
          disabled={count === 0}
          onClick={() => router.push(`/${org}/dashboard`)}
        >
          Start hunting
        </Button>
        {count === 0 ? (
          // Not a nag — with no sources there is genuinely nothing to scan, and
          // letting the user through would produce an empty dashboard that
          // looks like a broken product rather than an unconfigured one.
          <span className="text-[13px] text-warning">
            Pick at least one source — with none, there&rsquo;s nothing to scan.
          </span>
        ) : (
          <span className="text-[13px] text-fg-muted">
            {count} source{count === 1 ? "" : "s"} will be monitored.
          </span>
        )}
      </div>
    </>
  );
}
