"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ClaimBadge,
  ErrorState,
  RateLimited,
  LoadingSkeleton,
} from "@huntloop/ui";
import { Globe, Pencil } from "lucide-react";
import {
  researchCompanyAction,
  saveCompanyAction,
  type ResearchState,
} from "./actions";
import { slugify } from "../../../../lib/slug";
import { JoinExisting } from "./JoinExisting";
import type { DiscoverableWorkspace } from "../../../../lib/data/directory";

/**
 * §8 — the first real input is a company website, and Huntloop researches it.
 *
 * Everything the research produces is shown as an editable field, not as a
 * finished profile. Two reasons, and the second is the one that matters:
 *
 *   · §77 Principle 7 gives the user control over what the engine believes.
 *   · This output feeds the ICP, which feeds source selection, which feeds
 *     every opportunity after it. An error here is not a cosmetic error on one
 *     screen — it propagates through the whole loop, and it gets harder to
 *     spot at every step.
 *
 * Fields carry a claim kind for the same reason they do everywhere else: what
 * a website states outright and what a model concluded from it are different
 * things, and the difference stops being visible the moment they're rendered
 * as the same grey text.
 *
 * ── What changed when this stopped being `ProductStep` ───────────────────
 *
 * It saves. The previous version put the confirmed reading into
 * `sessionStorage` and the flow deleted it four screens later (`ONB-01`), so
 * the careful editing above produced nothing durable. `Looks right` now writes
 * a `products` row — the one `qualify`, `why_now` and `personalize_message`
 * all read — before it navigates.
 *
 * It also creates the workspace, from the domain rather than from a name typed
 * on a screen that no longer exists. See `actions.ts` for why the org has to
 * exist before the research runs.
 */

type Kind = "fact" | "inference" | "unknown";

interface Finding {
  field: string;
  label: string;
  kind: Kind;
  value: string;
  sourceUrl: string | null;
  confidence: "high" | "medium" | "low" | null;
}

/**
 * The workspace address, previewed as the user types.
 *
 * Shown for the same reason the old org form showed it: the slug becomes part
 * of every URL in the product and is not editable afterwards. Deriving it from
 * the domain rather than from a typed name means it is usually exactly what
 * the user would have chosen, spelled the way their own domain spells it.
 */
function slugPreview(input: string): string {
  const trimmed = input.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const host = trimmed.split(/[/?#]/)[0] ?? "";
  const label = host.split(".")[0] ?? "";
  return slugify(label);
}

export function CompanyStep({
  org,
  prefill,
  isAgency = false,
  discoverable = [],
}: {
  org?: string;
  /**
   * The domain this visitor already had read on the landing page.
   *
   * It pre-fills the field and nothing more — it does not auto-submit. The
   * research is the most expensive call in the product, and starting it from a
   * URL parameter would mean a stray link, a bookmark or a back-button press
   * spends money without anybody choosing to. The user presses the button.
   */
  prefill?: string | null;
  /** Whether to ask *whose* website this is. See `page.tsx`. */
  isAgency?: boolean;
  /** Workspaces already at this person's email domain. See `JoinExisting`. */
  discoverable?: DiscoverableWorkspace[];
}) {
  const router = useRouter();
  const [url, setUrl] = useState(prefill ?? "");

  /**
   * Whose website is going in the box.
   *
   * Only asked of agencies, and it changes nothing that is stored — the
   * workspace is built from whatever domain is entered either way. What it
   * changes is which domain gets entered, which is the entire point: an agency
   * owner who types their own address gets a profile for selling agency
   * services, coherently and wrongly.
   *
   * Defaults to `client`, because an agency reaching this screen is far more
   * often setting up the workspace they will work a client's market in than
   * one for their own new business.
   */
  const [subject, setSubject] = useState<"client" | "own">("client");
  const forClient = isAgency && subject === "client";
  const [phase, setPhase] = useState<"input" | "researching" | "review" | "saving">(
    "input",
  );
  const [state, setState] = useState<ResearchState>({});
  const [findings, setFindings] = useState<Finding[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function runResearch(e: React.FormEvent) {
    e.preventDefault();
    setPhase("researching");
    setState({});
    startTransition(async () => {
      const next = await researchCompanyAction(url, org);
      setState(next);
      if (next.result) {
        setFindings(next.result.understanding.findings as Finding[]);
        setCompanyName(next.result.understanding.companyName);
        setPhase("review");
      } else {
        // A failed run returns to the input step rather than to a demo profile.
        // Substituting the worked example here would show invented findings to
        // someone who has every reason to believe a model produced them.
        setPhase("input");
      }
    });
  }

  function save() {
    const result = state.result;
    const slug = state.org ?? org;
    if (!result || !slug) return;

    setPhase("saving");
    setSaveError(null);
    startTransition(async () => {
      const saved = await saveCompanyAction(
        slug,
        {
          ...result.understanding,
          companyName: companyName.trim() || result.understanding.companyName,
          findings,
        },
        // Whether a model actually read the site, carried from the run that
        // produced this. `0026` stores it so nothing downstream promotes the
        // labelled worked example to a real reading.
        result.source === "live",
      );

      if (!saved.ok) {
        setSaveError(saved.error);
        setPhase("review");
        return;
      }
      router.push(`/welcome/goals?org=${slug}`);
    });
  }

  if (phase === "input") {
    const preview = slugPreview(url);

    return (
      <>
        <h1 className="text-[26px] leading-8 font-semibold text-fg">
          {forClient ? "What does your client sell?" : "What does your company sell?"}
        </h1>
        <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
          {forClient
            ? "Give us their website and Huntloop will read it — what they sell, who buys it, and what problem it solves. This workspace hunts for their customers, and you can set up another client later."
            : "Give us your website and Huntloop will read it — what you sell, who buys it, and what problem it solves. You’ll check the result before anything else happens."}
        </p>

        {isAgency && (
          <fieldset className="mt-5">
            <legend className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
              Who is this workspace for?
            </legend>
            <div role="group" className="mt-2 flex flex-wrap gap-1.5">
              {(
                [
                  ["client", "A client"],
                  ["own", "My own agency"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={subject === value}
                  onClick={() => setSubject(value)}
                  className={[
                    "hl-focusable h-8 rounded-md border px-3 text-[13px] transition-colors duration-[120ms]",
                    subject === value
                      ? "border-brand-border bg-brand-surface text-brand-text"
                      : "border-line bg-surface text-fg-secondary hover:border-line-strong hover:text-fg",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] leading-[1.5] text-fg-muted">
              Each client gets its own workspace, profile and pipeline. You
              switch between them from the workspace menu.
            </p>
          </fieldset>
        )}

        {state.rateLimited ? (
          <RateLimited
            className="mt-6 max-w-lg"
            retryAt={state.rateLimited.retryAt ?? undefined}
          />
        ) : state.error ? (
          <ErrorState
            className="mt-6 max-w-lg"
            title="That didn't work"
            description={state.error}
          />
        ) : null}

        {/* Above the form on purpose: this is the last screen before
            `createWorkspace` runs, and an offer shown afterwards would be an
            offer to somebody who has already made the duplicate. */}
        <JoinExisting workspaces={discoverable} />

        <form onSubmit={runResearch} className="mt-6 max-w-lg">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-0 flex-1">
              <Globe
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
                strokeWidth={1.75}
              />
              <input
                type="text"
                required
                /* Same reasoning as the other single-input onboarding steps:
                   nothing above the field to skip past. */
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-label={forClient ? "Your client's website" : "Your company website"}
                placeholder={forClient ? "https://theirclient.com" : "https://yourcompany.com"}
                className="hl-focusable h-10 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-[14px] text-fg placeholder:text-fg-muted"
              />
            </div>
            <Button type="submit" variant="primary" size="lg">
              {forClient ? "Research this client" : "Research my company"}
            </Button>
          </div>

          {/* Only before the workspace exists. Once `org` is set the address is
              already fixed, and showing a preview of something unchangeable
              reads as an offer to change it. */}
          {!org && preview && (
            <p className="mt-2 text-[12px] text-fg-muted">
              Your workspace will be{" "}
              <span className="font-mono text-fg-secondary">/{preview}</span>
              {" — this can't be changed later."}
            </p>
          )}
        </form>
      </>
    );
  }

  if (phase === "researching") {
    return (
      <>
        <h1 className="text-[26px] leading-8 font-semibold text-fg">
          Reading {url || "your website"}…
        </h1>
        <p className="mt-1.5 text-[14px] text-fg-muted">
          Working out what you sell, who buys it, and why. This reads several
          pages, so it takes a moment.
        </p>
        <LoadingSkeleton className="mt-6 max-w-2xl" rows={5} rowHeight={72} />
      </>
    );
  }

  const result = state.result;

  return (
    <>
      <h1 className="text-[26px] leading-8 font-semibold text-fg">
        Here&rsquo;s what we understood
      </h1>
      <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
        Fix anything that&rsquo;s wrong. Everything after this — your ideal
        customer, your sources, every opportunity — is built on it.
      </p>

      {/* The screen never lets a worked example pass for a real reading. */}
      {result?.source === "unconfigured" && (
        <p
          role="status"
          className="mt-4 max-w-2xl rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-[13px] leading-[1.5] text-fg-secondary"
        >
          <span className="font-medium text-warning">No model is connected.</span>{" "}
          These are worked examples, not a reading of your site — nothing fetched{" "}
          {url || "your website"}. Add{" "}
          <span className="font-mono text-[12px] text-fg">ANTHROPIC_API_KEY</span> to{" "}
          <span className="font-mono text-[12px] text-fg">apps/web/.env.local</span> to
          make this real.
        </p>
      )}

      <Card flush className="mt-6 max-w-2xl">
        <CardHeader
          title={
            /* Editable, because the research reads the company's name off its
               own site and sites are inconsistent about it — "Acme" versus
               "Acme, Inc." versus a tagline. This string becomes the workspace
               name and appears in email signatures. */
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              aria-label="Company name"
              maxLength={200}
              className="hl-focusable -mx-1 w-full rounded-sm bg-transparent px-1 text-[15px] font-semibold text-fg"
            />
          }
          description={result?.understanding.canonicalDomain ?? url}
          actions={
            <Button size="sm" variant="ghost" onClick={() => setPhase("input")}>
              Start over
            </Button>
          }
        />
        <CardBody className="space-y-5">
          {findings.map((f, i) => (
            <div key={f.field}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
                  {f.label}
                </span>
                <ClaimBadge kind={f.kind} confidence={f.confidence ?? undefined} />
                {editing !== i && (
                  <button
                    type="button"
                    onClick={() => setEditing(i)}
                    className="hl-focusable ml-auto inline-flex items-center gap-1 rounded-sm text-[12px] text-fg-muted transition-colors duration-[120ms] hover:text-fg-secondary"
                  >
                    <Pencil className="size-3" strokeWidth={1.75} />
                    Edit
                  </button>
                )}
              </div>

              {editing === i ? (
                <textarea
                  /* The textbook correct use: the control the user pressed is
                     now gone from the DOM, and without moving focus here a
                     keyboard user has to tab from the top of the page to reach
                     the field they asked for. */
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  rows={3}
                  aria-label={f.label}
                  value={f.value}
                  onChange={(e) =>
                    setFindings((prev) =>
                      prev.map((p, j) => (j === i ? edited(p, e.target.value, result) : p)),
                    )
                  }
                  onBlur={() => setEditing(null)}
                  className="hl-focusable mt-2 w-full resize-y rounded-md border border-line bg-surface px-2.5 py-2 text-[14px] leading-[1.6] text-fg"
                />
              ) : (
                <p className="mt-1.5 text-[14px] leading-[1.6] text-fg-secondary">
                  {f.value}
                </p>
              )}

              {/* A fact names where it was read. Showing the link is what makes
                  the fact/inference split checkable rather than decorative. */}
              {f.kind === "fact" && f.sourceUrl && editing !== i && (
                <a
                  href={f.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hl-focusable mt-1 inline-block truncate rounded-sm font-mono text-[12px] text-fg-muted underline decoration-dotted underline-offset-2 transition-colors duration-[120ms] hover:text-fg-secondary"
                >
                  {f.sourceUrl}
                </a>
              )}
            </div>
          ))}
        </CardBody>
      </Card>

      {saveError && (
        <p role="alert" className="mt-4 max-w-2xl text-[13px] text-danger">
          {saveError}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="lg"
          disabled={phase === "saving"}
          onClick={save}
        >
          {phase === "saving" ? "Saving…" : "Looks right — continue"}
        </Button>
      </div>
    </>
  );
}

/**
 * A human edit turns a finding into a first-party statement.
 *
 * It stops being a model's conclusion the moment the person who runs the
 * company corrects it, and mislabelling that as an inference would understate
 * what we actually know. The citation is the company's own site because that is
 * precisely what a first-party claim about a company cites — and §7 needs a
 * fact to name a source, so an edit that produced a sourceless fact would be a
 * claim this codebase's own validator rejects.
 */
function edited(
  finding: Finding,
  value: string,
  result: ResearchState["result"],
): Finding {
  return {
    ...finding,
    value,
    kind: "fact",
    sourceUrl: finding.sourceUrl ?? result?.understanding.url ?? null,
    confidence: "high",
  };
}
