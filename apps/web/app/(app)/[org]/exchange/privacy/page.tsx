import Link from "next/link";
import { notFound } from "next/navigation";
import { exchangeMetadata, isExchangeEnabled } from "../../../../../lib/exchange/flag";
import { Card, CardHeader } from "@huntloop/ui";
import { countMyIntakeSessions, listMyNeeds } from "../../../../../lib/data/exchange";
import { canWrite, currentViewer } from "../../../../../lib/data/membership";
import { VISIBILITY } from "../../../../../lib/exchange/requirement";
import { PrivacyControls } from "./PrivacyControls";

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
  const [{ data: needs }, { data: sessions }] = await Promise.all([listMyNeeds(org), countMyIntakeSessions(org)]);

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
