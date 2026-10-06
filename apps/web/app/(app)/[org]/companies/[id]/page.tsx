import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, EmptyState, PriorityBadge } from "@huntloop/ui";
import { ArrowLeft, ExternalLink, Linkedin, Target } from "lucide-react";
import { getCompany } from "../../../../../lib/data/company";
import { getCompanyIntel } from "../../../../../lib/data/company-intel";
import { getCompanyRelations } from "../../../../../lib/data/company-page";
import { getTimeline } from "../../../../../lib/data/activity";
import { currentViewer } from "../../../../../lib/data/membership";
import { statusLabel } from "../../../../../lib/data/opportunity-map";
import { DemoFigures } from "../../DemoFigures";
import { FitCard, ProblemsCard, WhatTheyUseCard } from "../../opportunities/[id]/BriefSections";

/**
 * One company, across every profile it fits — §14.2's missing company page.
 *
 * The hub for a company with several opportunities: each opportunity is one
 * (company, profile) pair, and the relationship's history is one timeline.
 * The brief sections are the opportunity page's, computed for the company.
 */
export default async function CompanyPage({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org, id } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: company, source } = await getCompany(org, id);
  if (!company) notFound();

  const live = source === "live";
  const [{ data: intel }, { data: relations }, { data: timeline }] = await Promise.all([
    live ? getCompanyIntel(org, id) : Promise.resolve({ data: null }),
    getCompanyRelations(org, id),
    live
      ? getTimeline(org, id, { scope: "company" })
      : Promise.resolve({ data: { items: [], hasMore: false, ledgerStartedAt: null } }),
  ]);

  const facts = [
    company.industry,
    company.region ?? company.country,
    company.employeeCount === null ? null : `${company.employeeCount.toLocaleString()} employees`,
    company.businessModel,
  ].filter(Boolean);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-8 lg:px-8">
      <Link
        href={`/${org}/companies`}
        className="hl-focusable inline-flex items-center gap-1.5 rounded-sm text-[13px] text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} /> Companies
      </Link>

      <header className="mt-4">
        <h1 className="hl-heading text-fg">{company.name}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
          <a
            href={`https://${company.canonicalDomain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hl-focusable inline-flex items-center gap-1 rounded-sm font-mono text-fg-secondary underline underline-offset-2"
          >
            {company.canonicalDomain}
            <ExternalLink className="size-3" strokeWidth={1.75} />
          </a>
          {facts.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
        {company.description && (
          <p className="mt-3 max-w-3xl text-[14px] leading-[1.6] text-fg-secondary">{company.description}</p>
        )}
      </header>

      {!live && (
        <div className="mt-6">
          <DemoFigures what="This is an example company, not one on your account." />
        </div>
      )}

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card flush>
            <CardHeader
              title="Opportunities"
              description="One per customer profile this company fits."
            />
            <CardBody>
              {relations.opportunities.length === 0 ? (
                <EmptyState
                  icon={Target}
                  title="Not qualified yet"
                  description="Once research and scoring run, the opportunity appears here."
                  className="border-0 bg-transparent py-4"
                />
              ) : (
                <ul className="divide-y divide-line-subtle">
                  {relations.opportunities.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0 last:pb-0">
                      <Link
                        href={`/${org}/opportunities/${o.id}`}
                        className="hl-focusable min-w-0 flex-1 rounded-sm text-[13px] font-medium text-fg hover:underline"
                      >
                        {o.icpName ?? "No profile"}
                      </Link>
                      <PriorityBadge priority={o.priority} reason="The verdict on this opportunity. Open it for the evidence behind it." />
                      <Badge variant="neutral">{statusLabel(o.status)}</Badge>
                      {o.score !== null && <span className="hl-tabular text-[12px] text-fg-muted">score {o.score}</span>}
                      {o.estimatedValueCents !== null && (
                        <span className="hl-tabular text-[12px] text-fg-muted">
                          ${Math.round(o.estimatedValueCents / 100).toLocaleString()}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {intel && <FitCard org={org} intel={intel} />}
          {intel && <WhatTheyUseCard org={org} intel={intel} />}
          {intel && <ProblemsCard intel={intel} />}

          <Card flush>
            <CardHeader title="History" description="Every touch and change, across all of this company's opportunities." />
            <CardBody>
              {timeline.items.length === 0 ? (
                <p className="text-[13px] text-fg-muted">Nothing has happened with this company yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {timeline.items.map((item) => (
                    <li key={item.id} className="text-[13px]">
                      <span className="text-fg">{item.summary}</span>
                      <span className="text-fg-muted">
                        {" "}
                        · {item.actor ?? (item.actorType === "contact" ? "Them" : "Huntloop")} ·{" "}
                        {new Date(item.occurredAt).toLocaleDateString()}
                      </span>
                      {item.detail && <p className="text-[12px] text-fg-muted">{item.detail}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card flush>
            <CardHeader title="People on file" />
            <CardBody>
              {relations.people.length === 0 ? (
                <p className="text-[13px] text-fg-muted">No contacts found yet.</p>
              ) : (
                <ul className="space-y-3">
                  {relations.people.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-fg">{p.name}</div>
                        <div className="truncate text-[12px] text-fg-muted">{p.title ?? "Title unknown"}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {p.isDecisionMaker && <Badge variant="brand">Decision maker</Badge>}
                        {p.linkedin && (
                          <a
                            href={p.linkedin}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${p.name} on LinkedIn`}
                            className="hl-focusable inline-flex size-7 items-center justify-center rounded-md border border-line bg-surface text-fg-secondary hover:bg-hover"
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

          {intel && (intel.funding || intel.leadership.length > 0) && (
            <Card flush>
              <CardHeader title="Funding and leadership" />
              <CardBody className="space-y-2 text-[13px]">
                {intel.funding && (
                  <p className="text-fg-secondary">
                    {[
                      intel.funding.stage,
                      intel.funding.totalRaisedUsd
                        ? `$${Math.round(intel.funding.totalRaisedUsd / 1_000_000).toLocaleString()}M raised`
                        : null,
                      intel.funding.lastRoundAt
                        ? `last round ${new Date(intel.funding.lastRoundAt).toLocaleDateString()}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Funding on file, details unknown."}
                  </p>
                )}
                {intel.leadership.length > 0 && (
                  <ul className="space-y-1">
                    {intel.leadership.map((l) => (
                      <li key={l.name} className="text-fg-secondary">
                        {l.name}
                        {l.title && <span className="text-fg-muted"> · {l.title}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export const metadata = { title: "Company" };
