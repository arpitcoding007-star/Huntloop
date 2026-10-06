import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, ClaimBadge } from "@huntloop/ui";
import type { CompanyIntel } from "../../../../../lib/data/company-intel";
import type { FitStatus } from "../../../../../lib/icp-fit";
import { ResearchThisButton } from "./ResearchThisButton";

/**
 * The decision brief's company-level sections — COMMAND.md §16.3-C:
 * why they fit (computed from the profile, not written), what they use today
 * (competitor signals, each with its evidence), the problems and gaps research
 * recorded, and what would make the verdict firmer.
 *
 * Every line is sourced, computed, or labelled unknown.
 */

const RELATIONSHIP: Record<string, string> = {
  uses: "Uses",
  evaluating: "Evaluating",
  former: "Left",
  mentions: "Mentions",
  partner: "Partners with",
};

const STATUS_LABEL: Record<FitStatus, string> = { match: "Fits", miss: "Doesn't fit", unknown: "Unknown" };

export function FitCard({ org, intel }: { org: string; intel: CompanyIntel }) {
  return (
    <Card flush>
      <CardHeader
        title="Why they fit"
        description={
          intel.icpName
            ? `Checked against ${intel.icpName}, criterion by criterion.`
            : "No active customer profile to check against."
        }
      />
      <CardBody>
        {intel.fit.length === 0 ? (
          <p className="text-[13px] text-fg-muted">
            {intel.icpName ? (
              "Your profile states nothing this can be checked against."
            ) : (
              <>
                <Link href={`/${org}/settings/icp`} className="hl-focusable rounded-sm underline underline-offset-2">
                  Define a customer profile
                </Link>{" "}
                to see why each company fits.
              </>
            )}
          </p>
        ) : (
          <ul className="divide-y divide-line-subtle">
            {intel.fit.map((row) => {
              const exclusion = row.criterion === "Not a fit";
              const status: FitStatus = row.status;
              return (
                <li key={row.criterion} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                  <span className="w-32 shrink-0 text-[12px] font-medium text-fg-muted">{row.criterion}</span>
                  <span className="min-w-0 flex-1 text-[13px] text-fg-secondary">
                    {exclusion
                      ? row.actual
                        ? `Matches “${row.actual}”, which your profile lists as not a fit.`
                        : "Matches nothing on your not-a-fit list."
                      : row.actual
                        ? `${row.actual} — wanted ${row.wanted.slice(0, 4).join(", ")}`
                        : `Not on file — wanted ${row.wanted.slice(0, 4).join(", ")}`}
                  </span>
                  <Badge variant={status === "match" ? "success" : status === "miss" ? (exclusion ? "danger" : "warning") : "neutral"}>
                    {exclusion ? (status === "miss" ? "Excluded" : "Clear") : STATUS_LABEL[status]}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function WhatTheyUseCard({ org, intel }: { org: string; intel: CompanyIntel }) {
  return (
    <Card flush>
      <CardHeader
        title="What they use today"
        description="Competitors your sources connect them to. Partners are not competitive and say so."
      />
      <CardBody className="space-y-3">
        {intel.techStack.length > 0 && (
          <p className="text-[13px] text-fg-secondary">
            <span className="text-fg-muted">Detected stack: </span>
            {intel.techStack.slice(0, 12).join(", ")}
          </p>
        )}
        {intel.competitors.length === 0 ? (
          <p className="text-[13px] text-fg-muted">
            No competitor seen at this company.{" "}
            <Link href={`/${org}/competitors`} className="hl-focusable rounded-sm underline underline-offset-2">
              Manage competitors
            </Link>
          </p>
        ) : (
          <ul className="space-y-3">
            {intel.competitors.map((c) => (
              <li key={`${c.competitorId}:${c.relationship}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-fg">
                    {RELATIONSHIP[c.relationship]}{" "}
                    <Link
                      href={`/${org}/competitors/${c.competitorId}`}
                      className="hl-focusable rounded-sm font-medium underline-offset-2 hover:underline"
                    >
                      {c.name}
                    </Link>
                  </span>
                  {c.relationship === "partner" ? (
                    <Badge variant="neutral">Not competitive</Badge>
                  ) : c.hasEvidence ? (
                    <ClaimBadge kind="fact" />
                  ) : (
                    <ClaimBadge kind="unknown" />
                  )}
                </div>
                {c.claim && (
                  <p className="mt-0.5 text-[12px] leading-[1.5] text-fg-muted">
                    “{c.claim}”
                    {c.sourceUrl && (
                      <>
                        {" "}
                        <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="hl-focusable rounded-sm underline underline-offset-2">
                          source
                        </a>
                      </>
                    )}
                  </p>
                )}
                {c.angle && (
                  <p className="mt-1 rounded-md border border-brand-border bg-brand-surface px-2.5 py-1.5 text-[12px] text-fg">
                    Displacement angle, in your words: {c.angle}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export function ProblemsCard({ intel }: { intel: CompanyIntel }) {
  if (intel.problems.length === 0 && intel.gaps.length === 0) return null;
  return (
    <Card flush>
      <CardHeader title="Problems and gaps on file" description="Recorded by research, each with the page it came from." />
      <CardBody className="space-y-4">
        {intel.problems.length > 0 && (
          <ul className="space-y-2">
            {intel.problems.map((p, i) => (
              <li key={`p-${i}`} className="text-[13px]">
                <span className="text-fg">{p.text}</span>
                {p.severity !== null && <span className="ml-2 text-[12px] text-fg-muted">severity {p.severity}</span>}
                <SourceLine url={p.sourceUrl} excerpt={p.excerpt} />
              </li>
            ))}
          </ul>
        )}
        {intel.gaps.length > 0 && (
          <ul className="space-y-2">
            {intel.gaps.map((g, i) => (
              <li key={`g-${i}`} className="text-[13px]">
                <span className="text-fg">{g.text}</span>
                {g.detail && <p className="text-[12px] text-fg-muted">Today: {g.detail}</p>}
                <SourceLine url={g.sourceUrl} excerpt={g.excerpt} />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function SourceLine({ url, excerpt }: { url: string | null; excerpt: string | null }) {
  if (!url && !excerpt) return null;
  return (
    <p className="mt-0.5 text-[12px] leading-[1.5] text-fg-muted">
      {excerpt && <>“{excerpt}” </>}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="hl-focusable rounded-sm underline underline-offset-2">
          source
        </a>
      )}
    </p>
  );
}

/**
 * The research to-do list: everything the verdict rests on that is not
 * established yet. Built from the unknowns the page already shows, so it
 * cannot claim a gap the rest of the page does not.
 */
export function RaiseConfidenceCard({
  org,
  opportunityId,
  intel,
  unknownClaims,
  unmeasured,
  canSpend,
}: {
  org: string;
  opportunityId: string;
  intel: CompanyIntel;
  unknownClaims: string[];
  unmeasured: string[];
  canSpend: boolean;
}) {
  const items = [
    ...intel.fit.filter((r) => r.status === "unknown").map((r) => `${r.criterion} is not on file`),
    ...unmeasured.map((d) => `${d} has not been measured`),
    ...unknownClaims.slice(0, 5),
  ];

  return (
    <Card flush>
      <CardHeader title="What would raise confidence" />
      <CardBody className="space-y-3">
        {items.length === 0 ? (
          <p className="text-[13px] text-fg-muted">Nothing outstanding — every criterion and dimension is established.</p>
        ) : (
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item} className="text-[13px] text-fg-secondary">
                · {item}
              </li>
            ))}
          </ul>
        )}
        {canSpend && (
          <ResearchThisButton
            org={org}
            opportunityId={opportunityId}
            queued={Boolean(intel.researchAskedAt)}
            lastResearchedAt={intel.lastResearchedAt}
          />
        )}
      </CardBody>
    </Card>
  );
}
