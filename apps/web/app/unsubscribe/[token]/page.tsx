import { UnsubscribeForm } from "./UnsubscribeForm";

/**
 * Where the unsubscribe line in an email lands.
 *
 * ── Why there is a button rather than an immediate unsubscribe ───────────
 *
 * Because arriving here is a GET, and a GET that mutates gets triggered by
 * things that are not people: mail clients prefetch links, and security
 * gateways follow every URL in a message to see where it goes. Acting on the
 * GET would unsubscribe recipients who never clicked, and the software doing
 * it is the software trying to protect them.
 *
 * The mail client's own Unsubscribe button does not come through here at all —
 * that is RFC 8058's one-click POST, handled by `/api/unsubscribe/[token]`,
 * and it acts immediately because it is already an explicit action.
 *
 * ── Why this page says almost nothing ────────────────────────────────────
 *
 * No branding, no "sorry to see you go", no offer to reduce frequency instead.
 * The person reading it asked to stop being emailed by a company they did not
 * ask to hear from. Anything here that delays that is a dark pattern, and one
 * that costs more than it saves: the alternative to a working unsubscribe is a
 * spam report, which is charged to the sending domain and to every other
 * campaign running from it.
 *
 * The token is not validated here. It is validated where it is used, and a
 * page that told a visitor whether a token existed before they pressed
 * anything would be an oracle for probing them.
 */
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col justify-center px-6 py-16">
      <h1 className="text-[24px] leading-8 font-semibold text-fg">Unsubscribe</h1>
      <p className="mt-2 text-[14px] leading-[1.6] text-fg-secondary">
        Confirm below and this sender will stop emailing you. This also stops any
        follow-up messages already scheduled.
      </p>

      <div className="mt-6">
        <UnsubscribeForm token={token} />
      </div>

      <p className="mt-8 text-[12px] leading-[1.6] text-fg-muted">
        You are seeing this because you followed the unsubscribe link in an
        email. No account is needed, and nothing else about you is looked up.
      </p>
    </main>
  );
}

export const metadata = {
  title: "Unsubscribe",
  /* Kept out of search results. The URL contains a single-purpose token, and
     an indexed page carrying one is a page that unsubscribes somebody by
     being crawled. */
  robots: { index: false, follow: false },
};
