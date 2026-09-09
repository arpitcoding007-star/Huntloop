"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  RateLimited,
  LoadingSkeleton,
} from "@huntloop/ui";
import { Check, Compass, Plus, X } from "lucide-react";
import type { SourceKind, SourceRecommendation } from "@huntloop/ai";
import { recommendSourcesAction, type SourcesState } from "./actions";
import { saveSources } from "../actions";

/**
 * §10 — source discovery.
 *
 * Recommended sources start **accepted**, because a first-run user with an
 * empty source list gets an empty hunt and no way to tell whether the product
 * is broken or just unconfigured. But every one is removable in a single
 * click, and the count is stated plainly — §10 gives the user accept / remove
 * / add, and a default that's hard to undo isn't really a default.
 *
 * Each recommendation carries *why* it was suggested and *which* part of the
 * ICP it came from. A list of publication names with no reasoning is
 * unreviewable: the user can only accept it on faith, which is the opposite of
 * what §77 Principle 7 is asking for. The basis is the stronger of the two —
 * "because you said you sell to crypto trading desks" is checkable against
 * something the user typed, where a reason written by the model is only
 * plausible.
 *
 * ── Two changes from the version that did not save ───────────────────────
 *
 * **It writes rows.** The previous step called `clearDraft()` and navigated to
 * the dashboard, so the sources a user had just reviewed were discarded
 * (`ONB-01`). Each accepted source is now a `sources` row carrying
 * `recommended_by`, which `0002` added specifically so the learning loop could
 * later ask whether system picks or user picks produced better opportunities —
 * a question that is unanswerable retroactively.
 *
 * **The gate moved.** Continue used to be disabled with zero sources, which
 * was right when `scan_source` was the only way a company could enter the
 * system. It is wrong now: with `discover_companies` and an ICP that maps to a
 * provider search, a workspace can have no sources and a full pipeline.
 * Sources are how you catch a *trigger*; discovery is how you find the
 * company. Requiring one to reach the other would block the user whose market
 * has no trade press.
 */

/**
 * Presentation for the closed `source_kind` set.
 *
 * Local to the screen rather than imported from `@huntloop/ai`: that package
 * pulls in the Anthropic SDK and `node:crypto`, neither of which belongs in a
 * browser bundle. Typing it as a total Record over the union keeps the two in
 * step anyway — a new kind that nobody labelled fails the build here.
 */
const KIND_LABELS: Record<SourceKind, string> = {
  news: "News",
  blog: "Blog",
  jobs: "Jobs",
  social: "Social",
  github: "Code",
  funding: "Funding",
  regulatory: "Regulatory",
  community: "Community",
  podcast: "Podcast",
  custom: "Other",
};

type Phase = "loading" | "ready" | "error" | "no-icp";

/** Stable identity for a recommendation, matching how the task dedupes. */
function keyOf(source: SourceRecommendation): string {
  return source.canonicalDomain ?? `name:${source.name.toLowerCase()}`;
}

export function SourcesStep({ org }: { org: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [state, setState] = useState<SourcesState>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Recommending costs a model call. In development, StrictMode mounts effects
  // twice, and without this every visit to this screen would quietly bill for
  // two runs — the kind of thing that is invisible until the first real
  // invoice. `run` is also the retry handler, so a deliberate retry still
  // works.
  const started = useRef(false);

  const run = useCallback(async () => {
    setPhase("loading");
    setState({});
    const next = await recommendSourcesAction(org);
    setState(next);
    setPhase(next.noIcp ? "no-icp" : next.result ? "ready" : "error");
  }, [org]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  async function finish() {
    const accepted = (state.result?.recommendations ?? []).filter(
      (s) => !removed.includes(keyOf(s)),
    );

    setSaving(true);
    setSaveError(null);

    const result = await saveSources(org, [
      ...accepted.map((s) => ({
        name: s.name,
        kind: s.kind,
        url: s.url,
        recommendedBy: "system" as const,
      })),
      ...custom.map((url) => ({
        // Named by host, because a source list of bare URLs is unreadable and
        // `sources.name` is `not null`. The user can rename it in settings.
        name: hostOf(url) ?? url,
        kind: "custom",
        url,
        recommendedBy: "user" as const,
      })),
    ]);

    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    router.push(`/welcome/building?org=${org}`);
  }

  if (phase === "no-icp") {
    return (
      <>
        <h1 className="text-[26px] leading-8 font-semibold text-fg">
          Where should we look?
        </h1>
        <EmptyState
          className="mt-6 max-w-2xl"
          icon={Compass}
          title="We don't know who you're hunting for yet"
          description="Sources are chosen from your ideal customer profile. Describe that first and this step fills itself in."
          action={
            <Button
              variant="primary"
              onClick={() => router.push(`/welcome/icp?org=${org}`)}
            >
              Build my ideal customer
            </Button>
          }
        />
      </>
    );
  }

  if (phase === "loading") {
    return (
      <>
        <h1 className="text-[26px] leading-8 font-semibold text-fg">
          Finding where your buyers show up…
        </h1>
        <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
          Working through your segments and triggers, one source at a time.
        </p>
        <LoadingSkeleton className="mt-6 max-w-2xl" rows={5} rowHeight={64} />
      </>
    );
  }

  if (phase === "error") {
    return (
      <>
        <h1 className="text-[26px] leading-8 font-semibold text-fg">
          Where should we look?
        </h1>
        {/* No fallback list. A plausible-looking set of publication names
            substituted for a failed run is the one error here nobody would
            ever catch — the names would be real, and the hunt would simply
            never surface anything. */}
        {/* No onRetry on the rate-limited branch: retrying is exactly what
            will not work, and offering the button invites the user to keep
            spending a budget that is already gone. */}
        {state.rateLimited ? (
          <RateLimited
            className="mt-6 max-w-2xl"
            retryAt={state.rateLimited.retryAt ?? undefined}
            description="Nothing was saved. You can add your own sources below, or carry on — discovery works from your profile either way."
          />
        ) : (
          <ErrorState
            className="mt-6 max-w-2xl"
            title="We couldn't work out your sources"
            description="Nothing was saved. You can try again, add your own below, or carry on without them."
            detail={state.error}
            onRetry={() => void run()}
          />
        )}
        <div className="mt-4">
          <Button variant="secondary" onClick={() => void finish()} disabled={saving}>
            {saving ? "Saving…" : "Carry on without sources"}
          </Button>
        </div>
      </>
    );
  }

  const result = state.result;
  const recommendations = result?.recommendations ?? [];
  const accepted = recommendations.filter((s) => !removed.includes(keyOf(s)));
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

      {/* The screen never lets a worked example pass for a real recommendation. */}
      {result?.source === "unconfigured" && (
        <p
          role="status"
          className="mt-4 max-w-2xl rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-[13px] leading-[1.5] text-fg-secondary"
        >
          <span className="font-medium text-warning">No model is connected.</span>{" "}
          These are worked examples showing the shape of an answer — no model
          chose them for your business. Add{" "}
          <span className="font-mono text-[12px] text-fg">ANTHROPIC_API_KEY</span> to{" "}
          <span className="font-mono text-[12px] text-fg">apps/web/.env.local</span> to
          make this real.
        </p>
      )}

      <div className="mt-6 max-w-2xl space-y-4">
        <Card flush>
          <CardHeader
            title="Recommended"
            description="Based on your ICP."
            actions={
              <span className="hl-tabular text-[12px] text-fg-muted">
                {accepted.length}/{recommendations.length} on
              </span>
            }
          />
          <CardBody>
            {recommendations.length === 0 ? (
              // A short list is a real answer — the task returns nothing rather
              // than padding a thin profile with the generic sources it would
              // give anyone. Saying so beats an empty card.
              <p className="text-[13px] leading-[1.6] text-fg-muted">
                Nothing specific enough to recommend from this profile yet. Add
                your own sources below, or go back and add a buying trigger —
                triggers are what make a source worth watching.
              </p>
            ) : (
              <ul className="space-y-2">
                {recommendations.map((s) => {
                  const key = keyOf(s);
                  const on = !removed.includes(key);
                  return (
                    <li
                      key={key}
                      className="flex flex-wrap items-center gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium text-fg">
                            {s.name}
                          </span>
                          <Badge variant="neutral">{KIND_LABELS[s.kind]}</Badge>
                        </div>
                        <p className="mt-0.5 text-[12px] leading-[1.5] text-fg-muted">
                          {s.why}
                        </p>
                        {/* What makes the recommendation checkable rather than
                            merely plausible: it names the thing the user wrote
                            that put it here. */}
                        <p className="mt-1 text-[11px] leading-[1.5] text-fg-muted">
                          <span className="text-fg-secondary">Because you said:</span>{" "}
                          {s.basis}
                        </p>
                        {s.url && (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hl-focusable mt-1 inline-block truncate rounded-sm font-mono text-[11px] text-fg-muted underline decoration-dotted underline-offset-2 transition-colors duration-[120ms] hover:text-fg-secondary"
                          >
                            {s.canonicalDomain ?? s.url}
                          </a>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={on ? "secondary" : "primary"}
                        icon={on ? Check : Plus}
                        onClick={() =>
                          setRemoved((p) =>
                            on ? [...p, key] : p.filter((x) => x !== key),
                          )
                        }
                      >
                        {on ? "On" : "Add"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
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
                maxLength={2048}
                className="hl-focusable h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-[13px] text-fg placeholder:text-fg-muted"
              />
              <Button type="submit" size="sm" variant="secondary" icon={Plus}>
                Add
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>

      {saveError && (
        <p role="alert" className="mt-4 max-w-2xl text-[13px] text-danger">
          {saveError}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {/* A button, not a link wrapping a button. `<a><button disabled>` is
            only half a guard: the anchor stays focusable and Enter navigates
            straight past it, so a keyboard user reaches the dashboard with
            zero sources while a mouse user can't. It is also nested
            interactive content, which no assistive technology reads well. */}
        <Button variant="primary" size="lg" disabled={saving} onClick={() => void finish()}>
          {saving ? "Saving…" : "Start hunting"}
        </Button>
        {count === 0 ? (
          /* Not a block. Sources catch triggers; discovery finds companies, and
             a workspace with a searchable profile has a full pipeline without
             a single feed. Saying what is lost is more useful than refusing. */
          <span className="text-[13px] text-fg-muted">
            No sources — we&rsquo;ll still find companies from your profile, but
            we won&rsquo;t catch news about them. You can add sources any time.
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

/** The host of a pasted URL, for a readable source name. Null when unparseable. */
function hostOf(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return null;
  }
}
