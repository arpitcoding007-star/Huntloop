import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, EmptyState, Note } from "@huntloop/ui";
import { Bell, Settings2 } from "lucide-react";
import { exchangeMetadata, isExchangeEnabled } from "../../../../../lib/exchange/flag";
import { getExchangeNotices } from "../../../../../lib/data/exchange";
import { currentViewer } from "../../../../../lib/data/membership";
import { MarkRead } from "./MarkRead";

const KIND_LABEL: Record<string, string> = {
  match_alert: "Matching request",
  intro_requested: "Asks to talk",
  intro_accepted: "Introduced",
  intro_declined: "Declined",
  new_message: "Message",
  reconfirm: "Re-confirm",
};

/**
 * Updates (build plan DN-78): everything the Exchange told this person, read
 * or not, whether or not it was also emailed. Opening it marks it read.
 */
export default async function ExchangeUpdatesPage({ params }: { params: Promise<{ org: string }> }) {
  if (!isExchangeEnabled()) notFound();
  const { org } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();
  const { data: notices, source } = await getExchangeNotices(org);
  const unread = notices.filter((n) => !n.readAt).length;

  return (
    <div className="mx-auto w-full max-w-[900px] px-6 py-8 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="hl-heading text-fg">Updates</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            {unread ? `${unread} new since you last looked.` : "Matching requests, introductions, messages and reminders."}
          </p>
        </div>
        <Button variant="ghost" icon={Settings2} href={`/${org}/exchange/notifications`} linkComponent={Link}>
          Notification settings
        </Button>
      </header>
      {source !== "live" && (
        <div className="mt-6">
          <Note tone="info">There is no database on this deployment, so there are no updates to show.</Note>
        </div>
      )}
      <div className="mt-6 space-y-2">
        {notices.length === 0 ? (
          <EmptyState icon={Bell} title="Nothing yet" description="When a request matches your offerings, or someone asks to talk, it appears here." />
        ) : (
          notices.map((n) => (
            <Card key={n.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={n.href} className="hl-focusable text-[14px] font-semibold text-fg hover:underline">
                    {n.title}
                  </Link>
                  {n.body && <p className="mt-0.5 text-[12px] text-fg-muted">{n.body}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {!n.readAt && <Badge variant="brand">New</Badge>}
                  <Badge variant="neutral">{KIND_LABEL[n.kind] ?? n.kind}</Badge>
                  <span className="text-[11px] text-fg-muted">
                    {new Date(n.createdAt).toLocaleDateString("en", { dateStyle: "medium", timeZone: "UTC" })}
                  </span>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
      {unread > 0 && <MarkRead org={org} />}
    </div>
  );
}

export const generateMetadata = exchangeMetadata("Updates");
