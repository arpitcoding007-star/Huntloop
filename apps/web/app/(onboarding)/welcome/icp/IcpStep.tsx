"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ClaimBadge,
  ErrorState,
  LoadingSkeleton,
  RateLimited,
} from "@huntloop/ui";
import { Plus, Sparkles, X } from "lucide-react";
import type { IcpDraft } from "@huntloop/ai";
import { LookAlikeResult } from "../../../_components/LookAlikeResult";
import type { LookAlikePreview } from "../../../../lib/data/look-alike-preview";
import { REGION_OPTIONS, SIZE_BANDS } from "../../../../lib/onboarding/steps";
import { saveIcp } from "../actions";
import {
  draftIcpAction,
  estimateReachAction,
  previewLookAlikesAction,
  type DraftState,
  type ReachState,
} from "./actions";

/**
 * §9 — the ideal customer profile.
 *
 * ── What this screen used to be ──────────────────────────────────────────
 *
 * `ICP-02`. It opened with `useState(["Crypto trading desks"])`, four fixed
 * segment options, and three hardcoded triggers including "Shipped an
 * autonomous agent that moves funds" — under a heading that read *"Drafted
 * from your website."*
 *
 * It was not. The research from the previous step arrived as a single `sells`
 * string and nothing on the page touched it. Every customer, whatever they
 * sold, was shown one crypto-infrastructure company's profile and invited to
 * correct it — and the ones who accepted it wholesale, which is exactly what a
 * pre-filled form invites, walked away with an ICP describing somebody else's
 * business. Then it was thrown away, because nothing here saved.
 *
 * ── The three things that make it honest now ─────────────────────────────
 *
 *   1. **The draft is real.** `draft_icp` reads the research this workspace
 *      actually stored, and every field it returns quotes the sentence it
 *      followed from. The schema closes that citation to the research, so a
 *      criterion justified by something the site never said cannot come back.
 *   2. **Absence is shown as absence.** A field the research did not support
 *      arrives empty and unbadged rather than pre-filled with a plausible
 *      default. That is the honest state, and it is the one a user can act on.
 *   3. **The market answers back.** The reach counter is a provider's own
 *      count for this exact profile — never an estimate — and the criteria no
 *      provider can express are listed beside it rather than silently dropped.
 */

/* ── The editable field ──────────────────────────────────────────────────── */

interface ChipFieldProps {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  /** The research sentence this was drafted from, when it was drafted. */
  basis?: string | null;
  confidence?: "high" | "medium" | "low" | null;
  /** A closed set renders as toggles; an open one gets a text input. */
  options?: readonly string[];
  placeholder?: string;
  hint?: string;
}

function ChipField({
  label,
  values,
  onChange,
  basis,
  confidence,
  options,
  placeholder,
  hint,
}: ChipFieldProps) {
  const [entry, setEntry] = useState("");

  const toggle = (value: string) =>
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
          {label}
        </span>
        {/* Only when the field was actually drafted. An empty field carries no
            badge, because "we concluded nothing here" and "we concluded this
            with low confidence" are different and a badge on both would erase
            the difference. */}
        {basis && (
          <ClaimBadge kind="inference" confidence={confidence ?? undefined} />
        )}
      </div>

      {hint && <p className="mt-1 text-[12px] leading-[1.5] text-fg-muted">{hint}</p>}

      {options ? (
        <div role="group" aria-label={label} className="mt-2 flex flex-wrap gap-1.5">
          {options.map((option) => {
            const on = values.includes(option);
            return (
              <button
                key={option}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(option)}
                className={[
                  "hl-focusable h-8 rounded-md border px-3 text-[13px] transition-colors duration-[120ms]",
                  on
                    ? "border-brand-border bg-brand-surface text-brand-text"
                    : "border-line bg-surface text-fg-secondary hover:border-line-strong hover:text-fg",
                ].join(" ")}
              >
                {option}
              </button>
            );
          })}
        </div>
      ) : (
        <>
          {values.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {values.map((v) => (
                <li key={v}>
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-active px-2.5 py-1 text-[13px] text-fg-secondary">
                    {v}
                    <button
                      type="button"
                      aria-label={`Remove ${v}`}
                      onClick={() => onChange(values.filter((x) => x !== v))}
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
              const v = entry.trim();
              if (!v || values.includes(v)) return;
              onChange([...values, v]);
              setEntry("");
            }}
            className="mt-2 flex gap-2"
          >
            <input
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              aria-label={`Add to ${label}`}
              placeholder={placeholder ?? "Add…"}
              maxLength={400}
              className="hl-focusable h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-[13px] text-fg placeholder:text-fg-muted"
            />
            <Button type="submit" size="sm" variant="secondary" icon={Plus}>
              Add
            </Button>
          </form>
        </>
      )}

      {/* What makes the draft checkable rather than merely plausible: it names
          the sentence from the user's own site that put this here. */}
      {basis && (
        <p className="mt-1.5 text-[11px] leading-[1.5] text-fg-muted">
          <span className="text-fg-secondary">Because your site says:</span> {basis}
        </p>
      )}
    </div>
  );
}

/* ── The screen ──────────────────────────────────────────────────────────── */

type Phase = "loading" | "ready" | "error";

interface Fields {
  segments: string[];
  industries: string[];
  sizes: string[];
  regions: string[];
  triggers: string[];
  technologies: string[];
  businessModels: string[];
  painPoints: string[];
  useCases: string[];
  exampleCompanies: string[];
  exclusions: string[];
  personaName: string;
  titles: string[];
  seniority: string[];
  departments: string[];
  excludeTitles: string[];
}

const EMPTY: Fields = {
  segments: [], industries: [], sizes: [], regions: [], triggers: [],
  technologies: [], businessModels: [], painPoints: [], useCases: [],
  exampleCompanies: [], exclusions: [], personaName: "", titles: [],
  seniority: [], departments: [], excludeTitles: [],
};

export function IcpStep({ org }: { org: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [state, setState] = useState<DraftState>({});
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [reach, setReach] = useState<ReachState | null>(null);
  const [reachPending, setReachPending] = useState(false);

  /* The look-alike preview (`ONB-22`). Deliberately *not* debounced like the
     reach counter beside it: a reach estimate is one search call for a count,
     while this is up to five metered enrichments, and a call that costs
     credits on a pause in typing is a call the user never agreed to make. */
  const [lookAlike, setLookAlike] = useState<LookAlikePreview | null>(null);
  const [lookAlikeError, setLookAlikeError] = useState<string | null>(null);
  const [lookAlikePending, setLookAlikePending] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /* Drafting costs a model call. StrictMode mounts effects twice in
     development, and without this every visit would quietly bill for two runs
     — invisible until the first real invoice. `run` doubles as the retry
     handler, so a deliberate retry still works. */
  const started = useRef(false);

  const run = useCallback(async () => {
    setPhase("loading");
    setState({});
    const next = await draftIcpAction(org);
    setState(next);
    if (next.result) {
      setFields(fromDraft(next.result.draft));
      setPhase("ready");
    } else {
      setPhase("error");
    }
  }, [org]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  /* The reach count, debounced.
   *
   * 900ms because each run is a paid provider call and a user editing chips
   * produces a burst of changes — a per-keystroke count would bill for every
   * intermediate profile on the way to the one they meant. */
  const payload = useCallback(() => toPayload(fields), [fields]);

  useEffect(() => {
    if (phase !== "ready") return;
    const criteria = payload();
    // Nothing a provider could act on yet. Skipped rather than sent, so the
    // first render of an empty draft does not spend a credit to be told so.
    if (
      criteria.segments.length === 0 &&
      criteria.industries.length === 0 &&
      criteria.sizes.length === 0 &&
      criteria.regions.length === 0 &&
      criteria.technologies.length === 0
    ) {
      setReach(null);
      return;
    }

    let cancelled = false;
    setReachPending(true);
    const timer = setTimeout(async () => {
      const result = await estimateReachAction(org, criteria);
      if (cancelled) return;
      setReachPending(false);
      setReach(result.ok ? result.data : null);
    }, 900);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setReachPending(false);
    };
  }, [phase, org, payload]);

  async function runLookAlike() {
    setLookAlike(null);
    setLookAlikeError(null);
    setLookAlikePending(true);
    const result = await previewLookAlikesAction(org, payload());
    setLookAlikePending(false);
    if (result.ok) setLookAlike(result.data);
    else setLookAlikeError(result.error);
  }

  const set = <K extends keyof Fields>(key: K) => (value: Fields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const drafted = state.result?.draft;
  const basisOf = (key: keyof IcpDraft) => {
    const field = drafted?.[key];
    return field && typeof field === "object" && "basis" in field ? field.basis : null;
  };
  const confidenceOf = (key: keyof IcpDraft) => {
    const field = drafted?.[key];
    return field && typeof field === "object" && "confidence" in field
      ? field.confidence
      : null;
  };

  async function save() {
    setSaving(true);
    setSaveError(null);
    const result = await saveIcp(org, {
      ...toPayload(fields),
      personaName: fields.personaName,
      titles: fields.titles,
      seniority: fields.seniority,
      departments: fields.departments,
      excludeTitles: fields.excludeTitles,
      exclusions: fields.exclusions,
      ...(reach?.total !== null && reach?.total !== undefined
        ? { addressableEstimate: reach.total }
        : {}),
    });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    router.push(`/welcome/sources?org=${org}`);
  }

  if (phase === "loading") {
    return (
      <>
        <h1 className="text-[26px] leading-8 font-semibold text-fg">
          Working out who you should be selling to…
        </h1>
        <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
          Reading back what your site said, and turning it into a profile
          Huntloop can search with.
        </p>
        <LoadingSkeleton className="mt-6 max-w-2xl" rows={4} rowHeight={96} />
      </>
    );
  }

  if (phase === "error") {
    return (
      <>
        <h1 className="text-[26px] leading-8 font-semibold text-fg">
          Who should we hunt for?
        </h1>
        {/* No fallback profile. A plausible ICP substituted for a failed draft
            is the one error here nobody would ever catch — it would look like
            a considered answer and would send every search after the wrong
            companies. Building one by hand is offered instead. */}
        {state.rateLimited ? (
          <RateLimited
            className="mt-6 max-w-2xl"
            retryAt={state.rateLimited.retryAt ?? undefined}
            description="Nothing was saved. You can build the profile yourself below in the meantime."
          />
        ) : (
          <ErrorState
            className="mt-6 max-w-2xl"
            title="We couldn't draft your profile"
            description="Nothing was saved. You can try again, or fill it in yourself."
            detail={state.error}
            onRetry={() => void run()}
          />
        )}
        <div className="mt-4">
          <Button variant="secondary" onClick={() => setPhase("ready")}>
            Build it myself
          </Button>
        </div>
      </>
    );
  }

  const ready = fields.segments.length > 0 || fields.industries.length > 0;
  const canSave = ready && fields.sizes.length > 0 && fields.regions.length > 0
    && fields.triggers.length > 0 && fields.titles.length > 0;

  return (
    <>
      <h1 className="text-[26px] leading-8 font-semibold text-fg">
        Who should we hunt for?
      </h1>
      <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
        Drafted from your website — every line says which sentence it came from.
        Correct anything that&rsquo;s wrong. This decides what counts as a good
        opportunity.
      </p>

      {state.result?.source === "unconfigured" && (
        <p
          role="status"
          className="mt-4 max-w-2xl rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-[13px] leading-[1.5] text-fg-secondary"
        >
          <span className="font-medium text-warning">No model is connected.</span>{" "}
          This is a worked example showing the shape of an answer — no model
          drafted it for your business. Add{" "}
          <span className="font-mono text-[12px] text-fg">ANTHROPIC_API_KEY</span> to{" "}
          <span className="font-mono text-[12px] text-fg">apps/web/.env.local</span> to
          make this real.
        </p>
      )}

      {/* Two different things can be an example here, and conflating them would
          tell a user with a real site reading that nothing is real. */}
      {state.researchWasExample && state.result?.source !== "unconfigured" && (
        <p
          role="status"
          className="mt-4 max-w-2xl rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-[13px] leading-[1.5] text-fg-secondary"
        >
          This was drafted from a worked example rather than a real reading of
          your site — the research step ran without a model connected. Go back
          and re-run it for a profile grounded in your own pages.
        </p>
      )}

      <ReachBar reach={reach} pending={reachPending} />

      <div className="mt-6 max-w-2xl space-y-4">
        <Card flush>
          <CardHeader title="Who they are" />
          <CardBody className="space-y-6">
            <ChipField
              label="Segments"
              values={fields.segments}
              onChange={set("segments")}
              basis={basisOf("segments")}
              confidence={confidenceOf("segments")}
              placeholder="e.g. crypto trading desks"
              hint="How you'd describe the market out loud. The most-used field in practice."
            />
            <ChipField
              label="Industries"
              values={fields.industries}
              onChange={set("industries")}
              basis={basisOf("industries")}
              confidence={confidenceOf("industries")}
              placeholder="e.g. Financial Services"
              hint="Formal names, used as an exact filter when we search."
            />
            <ChipField
              label="Company size"
              values={fields.sizes}
              onChange={set("sizes")}
              basis={basisOf("sizes")}
              confidence={confidenceOf("sizes")}
              options={SIZE_BANDS}
              hint="The single most effective search filter."
            />
            <ChipField
              label="Regions"
              values={fields.regions}
              onChange={set("regions")}
              basis={basisOf("regions")}
              confidence={confidenceOf("regions")}
              options={REGION_OPTIONS}
            />
          </CardBody>
        </Card>

        <Card flush>
          <CardHeader
            title="What makes them ready to buy"
            description="The events that turn a fit into an opportunity. This is what 'why now' is built from."
          />
          <CardBody>
            <ChipField
              label="Buying triggers"
              values={fields.triggers}
              onChange={set("triggers")}
              basis={basisOf("triggers")}
              confidence={confidenceOf("triggers")}
              placeholder="e.g. Raised funding in the last 90 days"
              hint="Events that happen at a point in time — not standing characteristics."
            />
          </CardBody>
        </Card>

        <Card flush>
          <CardHeader
            title="Who to reach"
            description="Job titles, as a contact search would find them."
          />
          <CardBody className="space-y-6">
            <ChipField
              label="Job titles"
              values={fields.titles}
              onChange={set("titles")}
              basis={drafted?.persona?.basis ?? null}
              confidence={null}
              placeholder="e.g. Head of Platform"
              hint="Be specific. 'VP of Engineering' is searchable; 'decision maker' is not."
            />
            <ChipField
              label="Titles that look right but aren't"
              values={fields.excludeTitles}
              onChange={set("excludeTitles")}
              placeholder="e.g. VP of Sales"
              hint="Optional. Stops a near-match title pulling in the wrong person."
            />
          </CardBody>
        </Card>

        <Card flush>
          <CardHeader
            title="Who is never a fit"
            description="Huntloop will mark these IGNORE no matter how strong the trigger."
          />
          <CardBody>
            <ChipField
              label="Exclusions"
              values={fields.exclusions}
              onChange={set("exclusions")}
              basis={basisOf("exclusions")}
              confidence={confidenceOf("exclusions")}
              placeholder="e.g. Consumer-facing products"
            />
          </CardBody>
        </Card>

        {/* Collapsed by default. Every field below sharpens the profile and
            none of them is needed to produce a first result — putting them
            behind one click is what keeps the required path short without
            hiding them from the people who want them. */}
        <Card flush>
          <CardHeader
            title="Sharpen it further"
            description="Optional. Each of these makes the search or the qualification more precise."
            actions={
              <Button size="sm" variant="ghost" onClick={() => setShowMore((v) => !v)}>
                {showMore ? "Hide" : "Show"}
              </Button>
            }
          />
          {showMore && (
            <CardBody className="space-y-6">
              <ChipField
                label="Technologies they use"
                values={fields.technologies}
                onChange={set("technologies")}
                basis={basisOf("technologies")}
                confidence={confidenceOf("technologies")}
                placeholder="e.g. Kubernetes"
                hint="A precise filter when it applies."
              />
              <ChipField
                label="Business model"
                values={fields.businessModels}
                onChange={set("businessModels")}
                basis={basisOf("businessModels")}
                confidence={confidenceOf("businessModels")}
                placeholder="e.g. B2B SaaS"
              />
              <ChipField
                label="Pain points you solve"
                values={fields.painPoints}
                onChange={set("painPoints")}
                basis={basisOf("painPoints")}
                confidence={confidenceOf("painPoints")}
                placeholder="The problem, in their words"
              />
              <ChipField
                label="What they'd use it for"
                values={fields.useCases}
                onChange={set("useCases")}
                basis={basisOf("useCases")}
                confidence={confidenceOf("useCases")}
              />
              {/* Now the highest-leverage optional field, because it is the
                  only one that turns into filters Huntloop derives rather than
                  ones the user types. Domains, not names — `look-alike.ts`
                  refuses to guess that "Stripe" means stripe.com, and the hint
                  has to say so or the field silently does nothing. */}
              <ChipField
                label="Companies that are obviously right"
                values={fields.exampleCompanies}
                onChange={(values) => {
                  set("exampleCompanies")(values);
                  /* A preview describes the list that produced it. Leaving it
                     up while that list changes underneath is the screen
                     asserting something that is no longer true. */
                  setLookAlike(null);
                  setLookAlikeError(null);
                }}
                placeholder="e.g. stripe.com"
                hint="Dream accounts or existing customers, as domains. We read them and widen the search to match what they have in common."
              />

              {/* ONB-22. This is the one field on the screen whose effect is
                  invisible: everything else the user types becomes a filter
                  they can read back, while these become filters Huntloop
                  derives. Without this, the first sight of what they did is a
                  discovery run that has already happened. */}
              <div className="rounded-md border border-line bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void runLookAlike()}
                    disabled={lookAlikePending || fields.exampleCompanies.length === 0}
                  >
                    {lookAlikePending ? "Reading them…" : "Preview what these add"}
                  </Button>
                  <span className="text-[12px] text-fg-muted">
                    Reads up to five. Nothing is saved.
                  </span>
                </div>

                {lookAlikeError && (
                  <p role="alert" className="mt-2 text-[12px] text-danger">
                    {lookAlikeError}
                  </p>
                )}

                {lookAlike && <LookAlikeResult preview={lookAlike} />}
              </div>
              <ChipField
                label="Seniority"
                values={fields.seniority}
                onChange={set("seniority")}
                placeholder="e.g. Director"
              />
              <ChipField
                label="Departments"
                values={fields.departments}
                onChange={set("departments")}
                placeholder="e.g. Engineering"
              />
            </CardBody>
          )}
        </Card>
      </div>

      {saveError && (
        <p role="alert" className="mt-4 max-w-2xl text-[13px] text-danger">
          {saveError}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" disabled={saving || !canSave} onClick={save}>
          {saving ? "Saving…" : "Continue to sources"}
        </Button>
        {!canSave && (
          /* Named rather than a generic "complete the form". Five required
             fields on a long screen is exactly the case where "something is
             missing" makes a user re-read all of it. */
          <span className="text-[13px] text-warning">
            Still needed:{" "}
            {[
              !ready && "a segment or industry",
              fields.sizes.length === 0 && "a size band",
              fields.regions.length === 0 && "a region",
              fields.triggers.length === 0 && "a trigger",
              fields.titles.length === 0 && "a job title",
            ]
              .filter(Boolean)
              .join(", ")}
            .
          </span>
        )}
        <Badge variant="neutral">Editable later in Settings → ICP</Badge>
      </div>
    </>
  );
}

/* ── The reach counter ───────────────────────────────────────────────────── */

function ReachBar({ reach, pending }: { reach: ReachState | null; pending: boolean }) {
  if (!reach && !pending) return null;

  return (
    <div className="mt-4 max-w-2xl rounded-md border border-line-subtle bg-panel px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles aria-hidden className="size-4 text-brand" strokeWidth={1.75} />
        {pending ? (
          <span className="text-[13px] text-fg-muted">Counting matching companies…</span>
        ) : reach?.total !== null && reach?.total !== undefined ? (
          <span className="text-[13px] text-fg">
            About{" "}
            <span className="hl-tabular font-semibold">
              {reach.total.toLocaleString()}
            </span>{" "}
            companies match
            {reach.provider ? (
              <span className="text-fg-muted"> · per {reach.provider}</span>
            ) : null}
          </span>
        ) : reach?.configured === false ? (
          /* A configuration state, not a failure, and emphatically not zero.
             "0 companies match" would send a user to edit a profile that is
             fine — the single most damaging confusion available here. */
          <span className="text-[13px] text-fg-muted">
            No company-search provider is connected, so we can&rsquo;t count the
            market yet. Your profile still works for everything else.
          </span>
        ) : (
          <span className="text-[13px] text-fg-muted">{reach?.error}</span>
        )}
      </div>

      {/* Not an apology. The difference between a customer knowing their
          "hiring a VP of Data" trigger is applied at qualification, and a
          customer quietly believing the count above honours it. */}
      {reach && reach.unmapped.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-line-subtle pt-2">
          {reach.unmapped.slice(0, 4).map((u) => (
            <li key={u.field} className="text-[12px] leading-[1.5] text-fg-muted">
              <span className="text-fg-secondary">{u.values.slice(0, 2).join(", ")}</span>
              {u.values.length > 2 && ` +${u.values.length - 2}`} — {u.reason}
              {u.handledElsewhere && (
                <span className="text-fg-secondary"> {u.handledElsewhere}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Both directions of "this profile will not work", said while editing
          is still free rather than a week later from an empty pipeline. */}
      {reach?.total !== null && reach?.total !== undefined && reach.total > 50_000 && (
        <p className="mt-2 text-[12px] leading-[1.5] text-warning">
          That&rsquo;s very broad — Huntloop will surface a lot that isn&rsquo;t
          a fit. Adding an industry or a size band narrows it sharply.
        </p>
      )}
      {reach?.total !== null && reach?.total !== undefined && reach.total > 0 && reach.total < 50 && (
        <p className="mt-2 text-[12px] leading-[1.5] text-fg-muted">
          That&rsquo;s a small, precise market. Fine for account-based selling —
          you may also want to import your target list directly.
        </p>
      )}
    </div>
  );
}

/* ── Mapping ─────────────────────────────────────────────────────────────── */

/** The draft, flattened into editable state. */
function fromDraft(draft: IcpDraft): Fields {
  const v = (f: { values: string[] } | null | undefined) => f?.values ?? [];
  return {
    segments: v(draft.segments),
    industries: v(draft.industries),
    sizes: v(draft.sizes),
    regions: v(draft.regions),
    triggers: v(draft.triggers),
    technologies: v(draft.technologies),
    businessModels: v(draft.businessModels),
    painPoints: v(draft.painPoints),
    useCases: v(draft.useCases),
    exampleCompanies: [],
    exclusions: v(draft.exclusions),
    personaName: draft.persona?.name ?? "",
    titles: draft.persona?.titles ?? [],
    seniority: draft.persona?.seniority ?? [],
    departments: draft.persona?.departments ?? [],
    excludeTitles: [],
  };
}

/** The criteria half of the payload, shared by the counter and the save. */
function toPayload(f: Fields) {
  return {
    segments: f.segments,
    industries: f.industries,
    sizes: f.sizes,
    regions: f.regions,
    triggers: f.triggers,
    technologies: f.technologies,
    businessModels: f.businessModels,
    painPoints: f.painPoints,
    useCases: f.useCases,
    exampleCompanies: f.exampleCompanies,
    exclusions: f.exclusions,
  };
}
