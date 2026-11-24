import Link from "next/link";
import { notFound } from "next/navigation";
import { exchangeMetadata, isExchangeEnabled } from "../../../../../lib/exchange/flag";
import { Badge, Card, CardHeader } from "@huntloop/ui";
import { countMyIntakeSessions, getRevealLog, listMyNeeds } from "../../../../../lib/data/exchange";
import { canWrite, currentViewer } from "../../../../../lib/data/membership";
import { VISIBILITY } from "../../../../../lib/exchange/requirement";
import { PrivacyControls } from "./PrivacyControls";
import { ExportButton } from "./ExportButton";

/**
 * Exchange privacy (build plan DN-57): what a supplier can see of each
 * request, the firewall's promise in plain words, and the controls to change
 * or remove what was shared.
 */
export default async function ExchangePrivacyPage({ params }: { params: Promise<{ org: string }> }) {
  if (!isExchangeEnabled()) notFound();
  const { org } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();
  const [{ data: needs }, { data: sessions }, { data: reveals }] = await Promise.all([
    listMyNeeds(org),
    countMyIntakeSessions(org),
    getRevealLog(org),
  ]);

  return (
    <div className="mx-auto w-full max-w-[900px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="hl-heading text-fg">Exchange privacy</h1>
        <p className="mt-1 text-[13px] text-fg-muted">What suppliers can see of your requests, and how to change it</p>
      </header>

      <div className="mt-6 space-y-6">
        <Card>
          <CardHeader title="What we promise" />
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[13px] text-fg">
            <li>
              What you tell the Exchange is used to match you with suppliers, and for nothing else. It is never enriched with data about you from other sources, never added to an outreach sequence, and never synced to a CRM.
            </li>
            <li>Your name and workspace are never shown to a supplier unless you approve an introduction.</li>
            <li>Every answer is stored as you gave it. A field you skipped is recorded as unknown, not guessed.</li>
            <li>You can change who sees a request, or remove it, at any time. Removing a request removes its matches.</li>
            <li>
              A removed request is deleted for good after 30 days. Questionnaire transcripts are deleted after 90 days, or 30 if you never finished them. This log is kept for a year.
            </li>
          </ul>
        </Card>

        <Card>
          <CardHeader title="Visibility levels" />
          <dl className="mt-3 space-y-3 text-[13px]">
            {VISIBILITY.map((v) => (
              <div key={v.level}>
                <dt className="font-medium text-fg">{v.label}</dt>
                <dd className="text-fg-muted">{v.detail}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <PrivacyControls
          org={org}
          needs={needs.map((n) => ({ id: n.id, summary: n.summary, visibility: n.visibility }))}
          sessions={sessions}
          canWrite={canWrite(viewer)}
        />

        <Card>
          <CardHeader
            title="Who has seen your requests"
            description="Every time a matched supplier was shown one of your requests, and at which level. Kept for a year."
          />
          <div className="mt-3">
            {reveals.length === 0 ? (
              <p className="text-[13px] text-fg-muted">No supplier has seen any of your requests.</p>
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="text-[11px] tracking-label text-fg-muted uppercase">
                    <th className="py-1 pr-3 font-semibold">Request</th>
                    <th className="py-1 pr-3 font-semibold">Supplier</th>
                    <th className="py-1 pr-3 font-semibold">Saw</th>
                    <th className="py-1 font-semibold">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {reveals.map((r) => (
                    <tr key={`${r.needId}-${r.viewer}-${r.day}-${r.what}`}>
                      <td className="max-w-[260px] truncate py-2 pr-3 text-fg">{r.needSummary ?? "A removed request"}</td>
                      <td className="py-2 pr-3 text-fg">{r.viewer ?? "A supplier with no public profile"}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={r.level >= 3 ? "brand" : "neutral"}>{r.level >= 3 ? "Card with your words" : "Anonymous card"}</Badge>
                      </td>
                      <td className="py-2 text-fg-muted">
                        {new Date(r.day).toLocaleDateString("en", { dateStyle: "medium", timeZone: "UTC" })}
                        {r.views > 1 ? ` · ${r.views} views` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Your data" description="Your requests, their matches, your questionnaire transcripts, your introductions and their messages, and this log, as one JSON file." />
          <div className="mt-3">
            <ExportButton org={org} />
          </div>
        </Card>

        <p className="text-[12px] text-fg-muted">
          For the rest of your workspace&apos;s data, see{" "}
          <Link href={`/${org}/settings/privacy`} className="hl-focusable underline">
            Data &amp; privacy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

export const generateMetadata = exchangeMetadata("Exchange privacy");
