import { notFound } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ClaimBadge,
  EmptyState,
  EvidenceList,
  Freshness,
  PriorityBadge,
  ScorePill,
  SectionLabel,
} from "@huntloop/ui";
import { ArrowLeft, ExternalLink, Linkedin, Mail, Send, UserPlus } from "lucide-react";
import { NOW, findOpportunity } from "../../../../../lib/fixtures/opportunities";
import { load } from "../../../../../lib/data/source";
import { AgentPanel } from "./AgentPanel";

/**
 * The §47 company/opportunity page — the screen the product is judged on.
 *
 * Section order follows §47 exactly, and the order is the argument: what the
 * verdict is, why this company, what they do, what's wrong, *what proves it*,
 * why now, who to talk to, what to say. Evidence sits above the outreach
 * angle rather than below it, because a user who reads the angle first has
 * already accepted the claim.
 *
 * Two rules show up here as visible behaviour rather than as prose:
 *
 *   · Any field the research did not establish says so (§78). "Not
 *     established" is rendered as an explicit muted statement, never as an
 *     empty section that reads as though nothing was wrong.
 *   · A contact with no verified address shows no address (§78, "do not
 *     fabricate contact details") and says why the button is disabled.
 *
 * Data comes through lib/data — fixtures until Supabase is configured, with a
 * banner saying so.
 */
export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org, id } = await params;

  const { data: o } = await load(
    async () => {
      throw new Error(
        "Opportunity detail: live query not implemented. Connect Supabase and " +
          "finish getOpportunity() — see lib/data/opportunities.ts.",
      );
    },
    () => findOpportunity(id),
  );

  if (!o) notFound();

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-8 lg:px-8">
      <a
        href={`/${org}/opportunities`}
        className="hl-focusable inline-flex items-center gap-1.5 rounded-sm text-[13px] text-fg-muted transition-colors duration-[120ms] hover:text-fg-secondary"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} />
        All opportunities
      </a>

      {/* ── Header: the verdict, above everything it justifies ─────────── */}
      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[30px] leading-9 font-semibold text-fg">{o.company}</h1>
            <PriorityBadge priority={o.priority} size="md" reason={o.priorityReason} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
            <a
              href={`https://${o.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hl-focusable inline-flex items-center gap-1 rounded-sm font-mono text-fg-secondary underline decoration-line-strong underline-offset-2 hover:text-fg"
            >
              {o.domain}
              <ExternalLink className="size-3" strokeWidth={1.75} />
            </a>
            <span>{o.industry}</span>
            <span>{o.location}</span>
            <span>{o.employees} employees</span>
          </div>
        </div>

        {/* No `shrink-0` here: on a phone this row is wider than the viewport,
            and refusing to shrink pushes the buttons off-screen instead of
            letting them wrap onto their own line. */}
        <div className="flex flex-wrap items-center gap-2">
          <ScorePill
            score={o.score}
            explanation={o.scoreExplanation}
            confidence={o.confidence}
            dimensions={o.dimensions}
          />
          <Badge variant="neutral">{o.status}</Badge>
          <Button variant="secondary" icon={UserPlus}>
            {o.owner ? `Owned by ${o.owner}` : "Assign"}
          </Button>
          <Button variant="primary" icon={Send}>
            Draft outreach
          </Button>
        </div>
      </header>

      {/* Recommended action, immediately under the verdict — §46 asks the
          page to answer "what do I do next" without scrolling. */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-md border border-line-subtle bg-surface px-4 py-3">
        <SectionLabel>Recommended</SectionLabel>
        <span className="text-[14px] text-fg">{o.recommendedAction}</span>
        <Freshness date={o.triggerDate} now={NOW} label="Trigger" className="ml-auto" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── Main column ──────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-6">
          <Prose title="Why this company" body={o.whyThisCompany} />
          <Prose title="What they do" body={o.whatTheyDo} />
          <Prose title="Identified problem" body={o.identifiedProblem} />
          <Prose title="Potential gap" body={o.potentialGap} />
          <Prose
            title="Current approach"
            body={o.currentApproach}
            /* §78: an unknown current approach is a finding, not a blank. */
            fallback="Not established. No evidence on file describes how they solve this today."
          />

          {/* Evidence, before the pitch. */}
          <Card flush>
            <CardHeader
              title="Evidence"
              description="Every claim above traces to one of these."
              actions={
                <span className="text-[12px] text-fg-muted">
                  {plural(o.evidence.filter((e) => e.kind === "fact").length, "fact")} ·{" "}
                  {plural(
                    o.evidence.filter((e) => e.kind === "inference").length,
                    "inference",
                  )}{" "}
                  · {o.evidence.filter((e) => e.kind === "unknown").length} unknown
                </span>
              }
            />
            <CardBody>
              <EvidenceList items={o.evidence} now={NOW} />
            </CardBody>
          </Card>

          <Card flush>
            <CardHeader
              title="Recent triggers"
              description="Newest first. Age is why-now, not decoration."
            />
            <CardBody>
              {o.triggers.length === 0 ? (
                <p className="text-[13px] text-fg-muted">
                  No triggers on file. Nothing has changed at this company that we
                  can see.
                </p>
              ) : (
                <ul className="divide-y divide-line-subtle">
                  {o.triggers.map((t) => (
                    <li
                      key={`${t.type}-${t.date}`}
                      className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span className="text-[13px] text-fg">{t.type}</span>
                      <div className="flex items-center gap-3">
                        {t.strength !== null && (
                          <span className="hl-tabular text-[12px] text-fg-muted">
                            strength {t.strength}
                          </span>
                        )}
                        <Freshness date={t.date} now={NOW} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Prose title="Why now" body={o.whyNow} emphasis />
          <Prose title="Potential use case" body={o.potentialUseCase} />

          <Card flush>
            <CardHeader
              title="Outreach angle"
              description="What to say — and what the evidence will not support."
            />
            <CardBody className="space-y-3">
              <p className="text-[14px] leading-[1.6] text-fg-secondary">
                {o.outreachAngle}
              </p>
              {/* §62 rule 9 and §63: name the speculative parts before the
                  message is written, not after it has been sent. */}
              {o.evidence.some((e) => e.kind === "unknown") && (
                <div className="rounded-md border border-warning-border bg-warning-surface px-3 py-2.5">
                  <p className="text-[12px] leading-[1.5] text-warning">
                    Do not assert these — they are not established:
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {o.evidence
                      .filter((e) => e.kind === "unknown")
                      .map((e) => (
                        <li key={e.claim} className="text-[12px] text-fg-secondary">
                          · {e.claim}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ── Side column ──────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-6">
          <Card flush>
            <CardHeader title="Decision makers" />
            <CardBody>
              {o.buyers.length === 0 ? (
                /* §78: "no verified decision-maker → state that buyer
                   identification is incomplete." */
                <EmptyState
                  title="Buyer identification incomplete"
                  description="No decision maker has been identified for this company yet."
                  className="border-0 bg-transparent py-4"
                />
              ) : (
                <ul className="space-y-4">
                  {o.buyers.map((b) => (
                    <li key={b.name}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium text-fg">
                            {b.name}
                          </div>
                          <div className="truncate text-[12px] text-fg-muted">
                            {b.title}
                          </div>
                        </div>
                        {b.isDecisionMaker && (
                          <Badge variant="brand">Decision maker</Badge>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {b.email ? (
                          <a
                            href={`mailto:${b.email}`}
                            className="hl-focusable inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[12px] text-fg-secondary transition-colors duration-[120ms] hover:border-line-strong hover:text-fg"
                          >
                            <Mail className="size-3" strokeWidth={1.75} />
                            {b.email}
                            {b.emailConfidence && (
                              <span className="text-fg-muted">
                                · {b.emailConfidence}
                              </span>
                            )}
                          </a>
                        ) : (
                          /* No address is a real answer. Rendering a guessed
                             one would be the §78 failure this avoids. */
                          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-line px-2 text-[12px] text-fg-muted">
                            <Mail className="size-3" strokeWidth={1.75} />
                            No verified address
                          </span>
                        )}
                        {b.linkedin && (
                          <a
                            href={b.linkedin}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${b.name} on LinkedIn`}
                            className="hl-focusable inline-flex size-7 items-center justify-center rounded-md border border-line bg-surface text-fg-secondary transition-colors duration-[120ms] hover:border-line-strong hover:text-fg"
                          >
                            <Linkedin className="size-3" strokeWidth={1.75} />
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <AgentPanel company={o.company} />
        </div>
      </div>
    </div>
  );
}

/** "1 fact", "2 facts". `unknown` is a mass noun and never takes this. */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** A titled prose block, with an explicit fallback for unestablished fields. */
function Prose({
  title,
  body,
  fallback,
  emphasis,
}: {
  title: string;
  body: string | null;
  fallback?: string;
  emphasis?: boolean;
}) {
  const established = body !== null && body.trim() !== "";
  return (
    <section>
      <div className="flex items-center gap-2">
        <SectionLabel>{title}</SectionLabel>
        {!established && <ClaimBadge kind="unknown" />}
      </div>
      <p
        className={
          established
            ? emphasis
              ? "mt-2 text-[15px] leading-[1.6] text-fg"
              : "mt-2 text-[14px] leading-[1.6] text-fg-secondary"
            : "mt-2 text-[14px] leading-[1.6] text-fg-muted"
        }
      >
        {established ? body : (fallback ?? "Not established by the evidence on file.")}
      </p>
    </section>
  );
}

export const metadata = {
  title: "Opportunity",
};
