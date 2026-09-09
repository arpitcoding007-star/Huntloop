import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PriorityBadge,
  ScorePill,
} from "@huntloop/ui";
import { Binoculars, Mail, Upload, Users } from "lucide-react";
import { listOpportunities } from "../../../../lib/data/opportunities";
import { getOnboardingState } from "../../../../lib/data/onboarding";
import { listRules } from "../../../../lib/data/scoring";
import { captureForViewer } from "../../../../lib/analytics";
import { FinishButton } from "./FinishButton";

/**
 * The payoff.
 *
 * ── Why this screen exists rather than a redirect to the dashboard ───────
 *
 * Because the dashboard is a workspace and this is an answer. A new user
 * dropped into the Command Center has to work out what they are looking at
 * before they can tell whether it is any good; this screen puts three
 * companies in front of them and answers, for each one, the question the whole
 * product is organised around: **who should I pursue next, why are they a good
 * fit, and what should I do about it?**
 *
 * It is also the only place in the flow where Huntloop's actual difference is
 * visible. Every card carries a decomposed score and cited evidence, which is
 * the thing that is hard to copy and impossible to see on a feature list.
 *
 * ── Why "nothing found" is a full screen rather than an error ────────────
 *
 * Because it is a legitimate outcome with several distinct causes, and the
 * user can act on every one of them. Silently forwarding somebody to an empty
 * dashboard is how a working product gets mistaken for a broken one.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  if (!org) redirect("/welcome/company");

  await captureForViewer("onboarding_step_viewed", { step: "review" });

  const [{ data: opportunities }, state, { data: rules }] = await Promise.all([
    listOpportunities(org),
    getOnboardingState(org),
    listRules(org),
  ]);

  /* Three, not all of them. The screen's job is to demonstrate the answer, and
     a wall of twenty-five cards is the dashboard — which is one click away and
     is the right place for that. */
  const top = opportunities.slice(0, 3);

  const goals = state?.goals ?? [];

  return (
    <>
      <h1 className="text-[26px] leading-8 font-semibold text-fg">
        {top.length > 0
          ? "Here's who to pursue next"
          : "Your workspace is set up"}
      </h1>
      <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
        {top.length > 0
          ? "Judged against the profile you just built. Every score breaks down into the criteria it matched, and every claim names where it was read."
          : "Everything you told us is saved and the search is running on a schedule."}
      </p>

      {top.length === 0 ? (
        <EmptyState
          className="mt-6 max-w-2xl"
          icon={Binoculars}
          title="Nothing has cleared the bar yet"
          description="That is usually one of three things: no company-search provider is connected, the profile needs a criterion a search can act on, or the qualification bar is genuinely high. None of them means anything is broken — your profile is saved and the scheduled search keeps looking."
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                href={`/${org}/settings/icp`}
                linkComponent={Link}
              >
                Review my profile
              </Button>
              <Button variant="secondary" href={`/${org}/imports`} linkComponent={Link}>
                Import my own list
              </Button>
            </div>
          }
        />
      ) : (
        <div className="mt-6 max-w-2xl space-y-3">
          {top.map((o) => (
            <Card key={o.id} flush>
              <CardHeader
                title={o.company}
                description={o.domain}
                actions={
                  <div className="flex items-center gap-2">
                    {/* Both components require the *reason* alongside the
                        verdict, and that is the right requirement: a badge or a
                        number with no explanation behind it is exactly the
                        unexplained judgement this product exists not to make.
                        The API makes it impossible to render one. */}
                    <PriorityBadge priority={o.priority} reason={o.priorityReason} />
                    <ScorePill
                      score={o.score}
                      confidence={o.confidence}
                      explanation={o.scoreExplanation}
                    />
                  </div>
                }
              />
              <CardBody className="space-y-3">
                {/* Why now. The trigger and the date it happened — which the
                    schema distinguishes from the date we saw it, and which is
                    the difference between news and an anniversary. */}
                {o.trigger && (
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
                      Why now
                    </p>
                    <p className="mt-1 text-[13px] leading-[1.6] text-fg-secondary">
                      {o.trigger}
                    </p>
                  </div>
                )}

                {/* Why a fit. The verdict's own reason, not a restatement of
                    the score — a number repeated in words explains nothing. */}
                {o.priorityReason && (
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
                      Why a fit
                    </p>
                    <p className="mt-1 text-[13px] leading-[1.6] text-fg-secondary">
                      {o.priorityReason}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {/* The count, by kind. What separates a cited judgement from
                      a confident one, in the smallest space it can be said.

                      Pluralised properly rather than with a bare "(s)": this
                      badge sits under a claim about rigour, and "1 inferences"
                      undercuts it more than the space is worth. */}
                  {o.evidence.length > 0 && (
                    <Badge variant="neutral">
                      {countOf(o.evidence, "fact", "fact", "facts")} ·{" "}
                      {countOf(o.evidence, "inference", "inference", "inferences")}
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    href={`/${org}/opportunities/${o.id}`}
                    linkComponent={Link}
                  >
                    See the working
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* The rules the building step drafted, surfaced here or nowhere.
          They land inactive by design, which means nothing on any screen
          changes because they exist — so a user who is never told has a set of
          proposals sitting in a settings page they have no reason to open.
          Saying it here, once, is the whole of the handover. */}
      {rules.proposed.length > 0 && (
        <div className="mt-6 max-w-2xl rounded-md border border-line-subtle bg-panel p-4">
          <p className="text-[13px] leading-[1.6] text-fg-secondary">
            <span className="font-medium text-fg">
              We also drafted {rules.proposed.length} scoring{" "}
              {rules.proposed.length === 1 ? "rule" : "rules"} from your triggers.
            </span>{" "}
            None of them is active — each one would run against every company
            from then on, so they wait until you have read them.
          </p>
          <div className="mt-3">
            <Button
              size="sm"
              variant="secondary"
              href={`/${org}/settings/scoring`}
              linkComponent={Link}
            >
              Read the proposed rules
            </Button>
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <FinishButton org={org} />

        {/* One contextual next step, chosen from what they said they wanted.
            Offering all four here would put the decision back on somebody who
            has just made five. */}
        {goals.includes("reach_out") && (
          <Button
            variant="secondary"
            icon={Mail}
            href={`/${org}/settings`}
            linkComponent={Link}
          >
            Connect a mailbox
          </Button>
        )}
        {goals.includes("qualify") && !goals.includes("reach_out") && (
          <Button
            variant="secondary"
            icon={Upload}
            href={`/${org}/imports`}
            linkComponent={Link}
          >
            Import my accounts
          </Button>
        )}
        {!goals.includes("reach_out") && !goals.includes("qualify") && (
          <Button
            variant="secondary"
            icon={Users}
            href={`/${org}/team`}
            linkComponent={Link}
          >
            Invite a teammate
          </Button>
        )}
      </div>
    </>
  );
}

export const metadata = { title: "What we found" };

/** "2 facts" / "1 inference". English, rather than "1 inference(s)". */
function countOf(
  evidence: { kind: string }[],
  kind: string,
  singular: string,
  plural: string,
): string {
  const n = evidence.filter((e) => e.kind === kind).length;
  return `${n} ${n === 1 ? singular : plural}`;
}
