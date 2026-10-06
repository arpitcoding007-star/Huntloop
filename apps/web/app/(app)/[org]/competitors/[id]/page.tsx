import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, ClaimBadge, EmptyState } from "@huntloop/ui";
import { ArrowLeft, Building2 } from "lucide-react";
import {
  getCompetitor,
  type CompetitorProfileView,
  type ProfileClaim,
  type Relationship,
} from "../../../../../lib/data/competitor-intel";
import { canSpend, canWrite, currentViewer } from "../../../../../lib/data/membership";
import { uuidSchema } from "../../../../../lib/validation";
import { DemoFigures } from "../../DemoFigures";
import { TIER_LABEL } from "../CompetitorList";
import { CompetitorEditor } from "./CompetitorEditor";

const RELATIONSHIP_LABEL: Record<Relationship, string> = {
  uses: "Uses them",
  evaluating: "Evaluating them",
  former: "Left them",
  mentions: "Mentioned them",
  partner: "Partners with them (not competitive)",
};

/**
 * One competitor: what they say about themselves (each field with its claim
 * kind and the page it came from), the positioning a person wrote, where they
 * show up among prospects, and the deals lost to them. Sourced or silent — a
 * field research could not establish is shown as unknown, never filled in.
 */
export default async function CompetitorPage({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org, id } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();
  if (!id.startsWith("demo-") && !uuidSchema.safeParse(id).success) notFound();

  const { data: competitor, source } = await getCompetitor(org, id);
  if (!competitor) notFound();

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8 lg:px-8">
      <Link
        href={`/${org}/competitors`}
        className="hl-focusable inline-flex items-center gap-1.5 rounded-sm text-[13px] text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.75} /> Competitors
      </Link>

      <header className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="hl-heading text-fg">{competitor.name}</h1>
        {competitor.tier && <Badge variant="neutral">{TIER_LABEL[competitor.tier]}</Badge>}
        {competitor.status !== "active" && (
          <Badge variant="warning">{competitor.status === "proposed" ? "Proposed" : "Dismissed"}</Badge>
        )}
      </header>
      {competitor.domain && (
        <p className="mt-1 text-[13px] text-fg-muted">
          <a
            href={`https://${competitor.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hl-focusable rounded-sm underline underline-offset-2"
          >
            {competitor.domain}
          </a>
        </p>
      )}

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="This is an example competitor, not one on your account." />
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <ProfileCard profile={competitor.profile} researchedAt={competitor.lastResearchedAt} />

          <Card>
            <CardHeader
              title="Among your prospects"
              description="Relationships found in what your sources said. Only those with evidence count in scoring rules."
            />
            <CardBody>
              {competitor.companies.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title="Not seen among your prospects yet"
                  description="When a source says a prospect uses, is evaluating or left them, it appears here."
                />
              ) : (
                <ul className="divide-y divide-line-subtle">
                  {competitor.companies.map((c) => (
                    <li key={`${c.companyId}:${c.relationship}`} className="flex flex-wrap items-center gap-2 py-2">
                      {c.opportunityId ? (
                        <Link
                          href={`/${org}/opportunities/${c.opportunityId}`}
                          className="hl-focusable rounded-sm text-[13px] font-medium text-fg hover:underline"
                        >
                          {c.name}
                        </Link>
                      ) : (
                        <Link
                          href={`/${org}/companies/${c.companyId}`}
                          className="hl-focusable rounded-sm text-[13px] font-medium text-fg hover:underline"
                        >
                          {c.name}
                        </Link>
                      )}
                      <span className="text-[12px] text-fg-muted">{RELATIONSHIP_LABEL[c.relationship]}</span>
                      {!c.hasEvidence && <Badge variant="neutral">No evidence yet</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Deals lost to them" description="Recorded when a deal is closed as lost to this competitor." />
            <CardBody>
              {competitor.lossList.length === 0 ? (
                <p className="text-[13px] text-fg-muted">None recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {competitor.lossList.map((loss, i) => (
                    <li key={`${loss.opportunityId ?? "loss"}-${i}`} className="text-[13px]">
                      {loss.opportunityId ? (
                        <Link
                          href={`/${org}/opportunities/${loss.opportunityId}`}
                          className="hl-focusable rounded-sm font-medium text-fg hover:underline"
                        >
                          {loss.companyName ?? "An opportunity"}
                        </Link>
                      ) : (
                        <span className="font-medium text-fg">{loss.companyName ?? "An opportunity"}</span>
                      )}
                      <span className="text-fg-muted"> · {new Date(loss.occurredAt).toLocaleDateString()}</span>
                      {loss.reason && <p className="mt-0.5 text-fg-secondary">{loss.reason}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <CompetitorEditor
          org={org}
          competitor={competitor}
          canWrite={canWrite(viewer)}
          canSpend={canSpend(viewer)}
        />
      </div>
    </div>
  );
}

const FIELDS: { key: keyof CompetitorProfileView; claim: string; label: string }[] = [
  { key: "positioning", claim: "positioning", label: "How they position themselves" },
  { key: "valueProp", claim: "value_prop", label: "Their headline promise" },
  { key: "targetMarkets", claim: "target_markets", label: "Who they say they sell to" },
  { key: "products", claim: "products", label: "What they sell" },
  { key: "differentiators", claim: "differentiators", label: "What they claim sets them apart" },
  { key: "pricingModel", claim: "pricing_model", label: "How they charge" },
  { key: "strengths", claim: "strengths", label: "What they demonstrably do well" },
];

function ProfileCard({
  profile,
  researchedAt,
}: {
  profile: CompetitorProfileView | null;
  researchedAt: string | null;
}) {
  if (!profile) {
    return (
      <Card>
        <CardHeader title="What they say about themselves" />
        <CardBody>
          <p className="text-[13px] text-fg-muted">
            Not researched yet. Add their website and press Research — Huntloop reads their own
            pages and records each finding with the page it came from.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="What they say about themselves"
        description={`Read from their own site${researchedAt ? ` on ${new Date(researchedAt).toLocaleDateString()}` : ""}. Their claims, not verified facts about them.`}
      />
      <CardBody className="space-y-4">
        {FIELDS.map(({ key, claim, label }) => {
          const value = profile[key];
          const text = Array.isArray(value) ? value.join(" · ") : typeof value === "string" ? value : "";
          const c = profile.claims[claim];
          if (!text && !c) return null;
          return (
            <div key={claim}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium tracking-label text-fg-muted uppercase">{label}</span>
                {c && <ClaimBadge kind={c.kind} confidence={c.confidence ?? undefined} />}
              </div>
              <p className="mt-1 text-[13px] text-fg">{text || c?.note || "Could not be established from their site."}</p>
              <Sources claim={c} />
            </div>
          );
        })}

        {profile.customerExamples.length > 0 && (
          <div>
            <span className="text-[11px] font-medium tracking-label text-fg-muted uppercase">Customers they name</span>
            <p className="mt-1 text-[13px] text-fg">{profile.customerExamples.map((c) => c.value).join(" · ")}</p>
            <Sources claim={profile.claims.customer_examples} />
          </div>
        )}

        {profile.icpOverlap.length > 0 && (
          <div className="rounded-md border border-brand-border bg-brand-surface px-3 py-2 text-[13px] text-fg">
            Overlaps your profile on: {profile.icpOverlap.join(", ")}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Sources({ claim }: { claim: ProfileClaim | undefined }) {
  const links = claim?.evidence.filter((e) => e.sourceUrl) ?? [];
  if (!links.length) return null;
  return (
    <p className="mt-0.5 text-[12px] text-fg-muted">
      Source:{" "}
      {links.map((e, i) => (
        <span key={e.id}>
          {i > 0 && ", "}
          <a
            href={e.sourceUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="hl-focusable rounded-sm underline underline-offset-2"
          >
            {hostAndPath(e.sourceUrl!)}
          </a>
        </span>
      ))}
    </p>
  );
}

function hostAndPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}
