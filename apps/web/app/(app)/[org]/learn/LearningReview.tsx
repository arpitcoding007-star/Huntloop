"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ClaimBadge,
  EmptyState,
  FormMessage,
  SectionLabel,
} from "@huntloop/ui";
import { Check, Lightbulb, Play, X } from "lucide-react";
import type { LearningFinding, LearningRun } from "../../../../lib/data/learning";
import {
  approveFindingAction,
  rejectFindingAction,
  requestAnalysisAction,
} from "./actions";

/**
 * Reviewing what an analysis concluded.
 *
 * ── The one design decision everything else follows from ─────────────────
 *
 * There is no "approve all". Every finding is accepted or declined on its own,
 * and the screen is built so that reading one and deciding on it is the
 * cheapest available action.
 *
 * The reference system Huntloop is a second draft of had the opposite: an
 * analysis was one row of free-text arrays with a single Approve button that
 * bulk-inserted every proposed rule as immediately active. A report with one
 * good idea and four bad ones offered a choice between all five and none, and
 * because the good idea was usually in there, the answer was reliably all
 * five. A review screen whose fastest path is "yes to everything" is a
 * confirmation dialog that takes longer to read.
 *
 * ── What is rendered, and why each part is on screen ─────────────────────
 *
 *   the working      `detail` — the numbers behind the claim. A conclusion a
 *                    person cannot check is one they can only believe.
 *   both counts      supporting *and* contradicting. Nine-for and eight-against
 *                    is not a pattern, and only showing the nine hides that.
 *   the citations    real rows, linked where there is somewhere to go. This is
 *                    what makes "which ones do you mean?" answerable.
 *   the proposal     exactly what accepting will do, before it is done.
 *
 * A finding with no proposal is common and correct — the task is told to
 * propose nothing where the honest recommendation is "look at this" — so the
 * screen has to make approving one feel like a complete action rather than a
 * broken one.
 */
export function LearningReview({
  org,
  runs,
  canWrite,
  engineRunning,
}: {
  org: string;
  runs: LearningRun[];
  canWrite: boolean;
  engineRunning: boolean;
}) {
  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);
  const [pending, start] = useTransition();

  const latest = runs[0] ?? null;
  const open = latest?.status === "requested" || latest?.status === "running";

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader
          title="Analyse what happened"
          description="Reads the outcomes you've recorded, the qualifications you overrode or rated, and how each source has performed. Proposes changes; applies none of them."
        />
        <CardBody className="space-y-4">
          {!engineRunning && (
            <p className="rounded-md border border-warning-border bg-warning-surface px-3 py-2 text-[12px] text-fg">
              Nothing is running the engine on this deployment, so a requested
              analysis would sit in the queue indefinitely. Set{" "}
              <code className="font-mono">CRON_SECRET</code> and schedule{" "}
              <code className="font-mono">/api/jobs/tick</code> first.
            </p>
          )}

          {canWrite && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                icon={Play}
                disabled={pending || open || !engineRunning}
                onClick={() =>
                  start(async () => {
                    const res = await requestAnalysisAction(org, 90);
                    setResult(
                      res.ok
                        ? { ok: true, message: res.message }
                        : { ok: false, error: res.error },
                    );
                  })
                }
              >
                {pending ? "Requesting…" : "Run an analysis"}
              </Button>
              <span className="text-[12px] text-fg-muted">
                {open
                  ? "One is already running. It will appear below when it finishes."
                  : "Looks at the last 90 days."}
              </span>
            </div>
          )}

          <FormMessage result={result} />
        </CardBody>
      </Card>

      {runs.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={Lightbulb}
              title="Nothing analysed yet"
              description="Once you've recorded a handful of outcomes on opportunities — replies, meetings, wins, losses — Huntloop can look for what the ones that worked had in common."
            />
          </CardBody>
        </Card>
      ) : (
        runs.map((run) => (
          <RunSection
            key={run.id}
            org={org}
            run={run}
            canWrite={canWrite}
            onResult={setResult}
          />
        ))
      )}
    </div>
  );
}

function RunSection({
  org,
  run,
  canWrite,
  onResult,
}: {
  org: string;
  run: LearningRun;
  canWrite: boolean;
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
}) {
  const pending = run.findings.filter((f) => f.status === "pending");
  const decided = run.findings.filter((f) => f.status !== "pending");

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <SectionLabel>
          {run.createdAt ? new Date(run.createdAt).toLocaleDateString() : "Latest analysis"}
        </SectionLabel>
        <span className="text-[12px] text-fg-muted">
          {run.outcomesConsidered} outcome{run.outcomesConsidered === 1 ? "" : "s"} ·{" "}
          {run.decisionsConsidered} override{run.decisionsConsidered === 1 ? "" : "s"} ·{" "}
          {run.ratingsConsidered} rating{run.ratingsConsidered === 1 ? "" : "s"}
          {run.trigger === "scheduled" && " · scheduled"}
        </span>
      </div>

      {/* Each non-ready state says what it means rather than showing a status
          word. "insufficient" in particular is not a failure and must not read
          as one — the customer has done nothing wrong. */}
      {run.status === "requested" && (
        <Card>
          <CardBody>
            <p className="text-[13px] text-fg-muted">
              Queued. It starts on the next engine tick.
            </p>
          </CardBody>
        </Card>
      )}
      {run.status === "running" && (
        <Card>
          <CardBody>
            <p className="text-[13px] text-fg-muted">Running. This takes a minute or two.</p>
          </CardBody>
        </Card>
      )}
      {run.status === "insufficient" && (
        <Card>
          <CardBody>
            <p className="text-[13px] text-fg">{run.error ?? "Not enough has happened yet."}</p>
          </CardBody>
        </Card>
      )}
      {run.status === "failed" && (
        <Card>
          <CardBody className="space-y-1">
            <p className="text-[13px] font-medium text-fg">This analysis did not finish.</p>
            <p className="font-mono text-[12px] break-words text-fg-muted">{run.error}</p>
          </CardBody>
        </Card>
      )}

      {run.summary && (
        <Card>
          <CardBody>
            <p className="text-[13px] whitespace-pre-wrap text-fg">{run.summary}</p>
          </CardBody>
        </Card>
      )}

      {run.status === "ready" && run.findings.length === 0 && (
        <Card>
          <CardBody>
            <p className="text-[13px] text-fg-muted">
              Nothing specific enough to act on in this period. That is a real
              answer, and a more useful one than three findings drawn from a
              handful of records.
            </p>
          </CardBody>
        </Card>
      )}

      {pending.map((finding) => (
        <FindingCard
          key={finding.id}
          org={org}
          finding={finding}
          canWrite={canWrite}
          onResult={onResult}
        />
      ))}

      {decided.map((finding) => (
        <FindingCard
          key={finding.id}
          org={org}
          finding={finding}
          canWrite={canWrite}
          onResult={onResult}
        />
      ))}
    </section>
  );
}

const KIND_LABEL: Record<LearningFinding["kind"], string> = {
  source_performance: "Sources",
  scoring_adjustment: "Scoring",
  style_guidance: "Outreach",
  icp_refinement: "Profile",
};

function FindingCard({
  org,
  finding,
  canWrite,
  onResult,
}: {
  org: string;
  finding: LearningFinding;
  canWrite: boolean;
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
}) {
  const [pending, start] = useTransition();
  const decided = finding.status !== "pending";

  return (
    <Card className={decided ? "opacity-60" : undefined}>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">{KIND_LABEL[finding.kind]}</Badge>
          {finding.confidence && (
            /* An analysis is a conclusion drawn from records, never an
               observation — so it renders as an inference with its confidence,
               the same badge everything else in the product uses for the same
               distinction. */
            <ClaimBadge kind="inference" confidence={finding.confidence} />
          )}
          {finding.status === "approved" && <Badge variant="success">Approved</Badge>}
          {finding.status === "rejected" && <Badge variant="neutral">Declined</Badge>}
        </div>

        <div>
          <p className="text-[15px] font-medium text-fg">{finding.headline}</p>
          <p className="mt-1 text-[13px] whitespace-pre-wrap text-fg-secondary">
            {finding.detail}
          </p>
        </div>

        <p className="text-[13px] text-fg">{finding.recommendation}</p>

        {/* Both numbers, always. Showing only the supporting count is how a
            nine-against-eight coin flip reads as a finding. */}
        <p className="text-[12px] text-fg-muted">
          {finding.supportingCount} record{finding.supportingCount === 1 ? "" : "s"} support
          this
          {finding.contradictingCount > 0
            ? `, ${finding.contradictingCount} contradict${finding.contradictingCount === 1 ? "s" : ""} it`
            : ""}
          .
        </p>

        {finding.citations.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
              Based on
            </span>
            {finding.citations.map((c) =>
              c.href ? (
                <Link
                  key={c.id}
                  href={c.href}
                  className="hl-focusable rounded text-[12px] text-brand underline underline-offset-2"
                >
                  {c.label}
                </Link>
              ) : (
                <span key={c.id} className="text-[12px] text-fg-secondary">
                  {c.label}
                </span>
              ),
            )}
            {finding.missingCitations > 0 && (
              /* Reported rather than hidden. A cited row can be deleted between
                 the run and the review, and a reviewer seeing a shorter list
                 with no explanation would assume the finding rested on less. */
              <span className="text-[12px] text-fg-muted">
                (+{finding.missingCitations} no longer available)
              </span>
            )}
          </div>
        )}

        {finding.proposal && <Proposal proposal={finding.proposal} />}

        {!finding.proposal && !decided && (
          <p className="text-[12px] text-fg-muted">
            Nothing to apply automatically — accepting this just records that
            you read it and agreed.
          </p>
        )}

        {finding.status === "approved" && finding.appliedType === "scoring_rule" && (
          <p className="text-[12px] text-fg-muted">
            A rule was created and is{" "}
            <Link
              href={`/${org}/settings/scoring`}
              className="hl-focusable rounded text-brand underline underline-offset-2"
            >
              waiting under Settings → Scoring
            </Link>
            . It is not applying to anything until you activate it there.
          </p>
        )}
        {finding.status === "approved" && finding.appliedType === "memory" && (
          <p className="text-[12px] text-fg-muted">
            Added to{" "}
            <Link
              href={`/${org}/memory`}
              className="hl-focusable rounded text-brand underline underline-offset-2"
            >
              Memory
            </Link>
            .
          </p>
        )}

        {canWrite && !decided && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              icon={Check}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await approveFindingAction(org, finding.id);
                  onResult(
                    res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                  );
                })
              }
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={X}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await rejectFindingAction(org, finding.id);
                  onResult(
                    res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                  );
                })
              }
            >
              Decline
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * What accepting will actually do, spelled out before it is done.
 *
 * The rule case renders the generated English sentence rather than the JSON.
 * That sentence comes from `describeRule` against the stored shape — the same
 * function the scoring screen uses — so it cannot drift from what the engine
 * will evaluate, which is the property that makes showing prose instead of the
 * expression honest rather than convenient.
 */
function Proposal({ proposal }: { proposal: NonNullable<LearningFinding["proposal"]> }) {
  if (proposal.type === "memory") {
    return (
      <div className="rounded-md border border-line-subtle bg-surface px-3 py-2">
        <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
          Accepting adds this to Memory
        </p>
        <p className="mt-1 text-[13px] text-fg">{proposal.content}</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-line-subtle bg-surface px-3 py-2">
      <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
        Accepting creates this rule, inactive
      </p>
      <p className="mt-1 text-[13px] font-medium text-fg">{proposal.name}</p>
      <p className="mt-0.5 text-[13px] text-fg-secondary">{proposal.summary}</p>
    </div>
  );
}
