import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Badge, Button, Card, CardBody } from "@huntloop/ui";
import { Plus } from "lucide-react";
import {
  LAST_ORG_COOKIE,
  listMemberships,
  stepPath,
} from "../../../lib/data/destination";
import { listWorkspaceUsage } from "../../../lib/data/directory";

/**
 * Which workspace?
 *
 * ── Why this screen exists ───────────────────────────────────────────────
 *
 * Three groups of people cannot use Huntloop without it, and all three were
 * previously stuck:
 *
 *   · anyone invited to a second organisation — there was no way to reach it
 *     short of typing the slug
 *   · agencies, whose whole model is one workspace per client
 *   · anyone who created a second workspace for a second product
 *
 * `resolveDestination` sends a single-workspace user straight past this page,
 * so the common case never sees it. It only appears when there is a genuine
 * choice — and then it is the *right* answer rather than a guess, which is why
 * the resolver does not pick the alphabetically-first and call it a default.
 *
 * ── The cookie ───────────────────────────────────────────────────────────
 *
 * Choosing writes `huntloop.org`, and the resolver honours it on the next
 * sign-in. So the cost of this screen is one click, once — not one click every
 * time. The resolver re-checks membership before trusting it, because a user
 * removed from an org would otherwise be sent to a 404 by their own cookie
 * forever.
 */
export default async function OrgsPage() {
  const memberships = await listMemberships();

  // No database. There is nothing to choose between, and the demo workspace is
  // the only thing that exists — sending a reviewer to an empty picker would
  // be a dead end where a working screen is one redirect away.
  if (memberships === null) redirect("/acme/dashboard");

  if (memberships.length === 0) redirect("/welcome");
  if (memberships.length === 1) {
    const only = memberships[0]!;
    redirect(
      only.completedAt || only.step === "done"
        ? `/${only.slug}/dashboard`
        : stepPath(only.slug, only.step),
    );
  }

  const store = await cookies();
  const last = store.get(LAST_ORG_COOKIE)?.value;

  /*
   * What each workspace has cost this month.
   *
   * The reason this page exists for agencies rather than only as a switcher:
   * ten clients is ten usage screens and no way to answer "what do I invoice
   * this one for". It is not billing — there is none — but it is the number an
   * agency actually needs, from counters the schema already keeps.
   *
   * Only rendered when there is more than one workspace, which is guaranteed
   * by the redirects above.
   */
  const usage = await listWorkspaceUsage(memberships.map((m) => m.orgId));

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line-subtle bg-panel">
        <div className="mx-auto flex max-w-[720px] items-center gap-2 px-6 py-3">
          <span className="flex size-6 items-center justify-center rounded-md bg-brand-surface text-[13px] font-bold text-brand">
            H
          </span>
          <span className="text-[13px] font-semibold text-fg">Huntloop</span>
        </div>
      </header>

      <div className="mx-auto max-w-[720px] px-6 py-10">
        <h1 className="text-[26px] leading-8 font-semibold text-fg">
          Which workspace?
        </h1>
        <p className="mt-1.5 text-[14px] leading-[1.6] text-fg-muted">
          You belong to {memberships.length} organisations. Each has its own
          customer profile, sources and pipeline.
        </p>

        <ul className="mt-6 space-y-2">
          {memberships.map((m) => {
            const setUp = Boolean(m.completedAt) || m.step === "done";
            return (
              <li key={m.orgId}>
                <Card flush>
                  <CardBody>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-surface text-[15px] font-semibold text-brand">
                        {m.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-medium text-fg">
                            {m.name}
                          </span>
                          <Badge variant="neutral">{m.role}</Badge>
                          {last === m.slug && (
                            <Badge variant="neutral">Last used</Badge>
                          )}
                          {/* Said plainly rather than hidden. A half-configured
                              workspace behaves differently — discovery is
                              paused until it has an ICP — and a picker that
                              did not distinguish them would make that look
                              like a fault in one of them. */}
                          {!setUp && <Badge variant="warning">Setup unfinished</Badge>}
                        </div>
                        <p className="mt-0.5 font-mono text-[12px] text-fg-muted">
                          /{m.slug}
                        </p>
                        {/* Only the metrics that have actually been used.
                            Rendering "0 opportunities · 0 AI runs" for a
                            workspace nobody has opened states a fact about
                            nothing, and it would sit under every row of a new
                            agency's list looking like a fault. */}
                        {usage.get(m.orgId) && (
                          <p className="mt-1 text-[12px] text-fg-muted">
                            {METRIC_LABELS.filter(
                              ([metric]) => (usage.get(m.orgId)?.used[metric] ?? 0) > 0,
                            )
                              .map(
                                ([metric, label]) =>
                                  `${usage.get(m.orgId)!.used[metric]!.toLocaleString()} ${label}`,
                              )
                              .join(" · ") || "Nothing used this month"}
                            <span className="text-fg-muted"> this month</span>
                          </p>
                        )}
                      </div>
                      <Button
                        variant={setUp ? "primary" : "secondary"}
                        href={
                          setUp ? `/${m.slug}/dashboard` : stepPath(m.slug, m.step)
                        }
                        linkComponent={Link}
                      >
                        {setUp ? "Open" : "Finish setup"}
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>

        <div className="mt-6">
          <Button
            variant="ghost"
            icon={Plus}
            href="/welcome?new=1"
            linkComponent={Link}
          >
            Create another workspace
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The metrics worth showing on a switcher, and what to call them.
 *
 * The same four names `increment_usage` writes and `plans.limits` is keyed on,
 * so a number here and a number on the usage screen inside a workspace cannot
 * disagree about what they are counting.
 */
const METRIC_LABELS: readonly [string, string][] = [
  ["opportunities", "opportunities"],
  ["ai_runs", "AI runs"],
  ["enrich", "enrichments"],
  ["emails", "emails"],
];

export const metadata = { title: "Choose a workspace" };

/* Membership is per-request and the cookie is read here, so there is nothing
   to cache and caching it would show one user another's workspace list. */
export const dynamic = "force-dynamic";
