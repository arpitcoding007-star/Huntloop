import { notFound } from "next/navigation";
import { isEncryptionConfigured } from "@huntloop/db";
import { configuredProviders } from "@huntloop/jobs";
import { canWrite, currentViewer } from "../../../../lib/data/membership";
import { getOutreach } from "../../../../lib/data/outreach";
import { DemoFigures } from "../DemoFigures";
import { OutreachManager } from "./OutreachManager";

/**
 * Outreach — master context §46.
 *
 * Campaigns, their sequences and the mailboxes they would send from, on one
 * screen because they are one question: what would go out, to whom, and does
 * anybody read it first.
 *
 * ── Why the connect control's availability is decided here ───────────────
 *
 * Three separate things have to be true before a mailbox can be connected: a
 * database to store it in, OAuth credentials for at least one provider, and an
 * encryption key for the tokens. All three are deployment facts, none is
 * knowable in the browser, and a button that starts a flow which cannot finish
 * is worse than one that explains itself — §7. So the page works out which of
 * them is missing and hands the client the sentence to show.
 */
export default async function OutreachPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org } = await params;
  const query = await searchParams;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: outreach, source } = await getOutreach(org);

  const providers = source === "live" ? configuredProviders() : [];
  const unavailable =
    source !== "live"
      ? "This deployment has no database connected, so there is nowhere to store a mailbox connection."
      : providers.length === 0
        ? "No Google or Microsoft OAuth credentials are configured on this deployment, so no mailbox can be connected yet. See .env.example."
        : !isEncryptionConfigured()
          ? "MAILBOX_ENCRYPTION_KEY is not set, so the access tokens could only be stored in plain text. Connecting is refused until it is."
          : null;

  /* The two halves of the OAuth flow report back through the URL, because they
     are redirects and have nowhere else to say anything. */
  const connected = single(query.mailbox_connected);
  const failed = single(query.mailbox_error);
  const notice = failed
    ? ({ ok: false, error: failed } as const)
    : connected
      ? ({ ok: true, message: `${connected} is connected and can send.` } as const)
      : null;

  return (
    <div className="mx-auto w-full max-w-[1000px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="text-[30px] leading-9 font-semibold text-fg">Outreach</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          {org} · what would go out, and who approves it first
        </p>
      </header>

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="This is an example campaign, not one on your account." />
        </div>
      )}

      <div className="mt-6">
        <OutreachManager
          org={org}
          outreach={outreach}
          canWrite={canWrite(viewer)}
          providers={providers}
          connectUnavailable={unavailable}
          notice={notice}
        />
      </div>
    </div>
  );
}

/** A query parameter repeated is a crafted URL, not a value to concatenate. */
function single(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export const metadata = { title: "Outreach" };
