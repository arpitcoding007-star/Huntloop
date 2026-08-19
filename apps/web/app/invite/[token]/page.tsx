import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "../../../lib/data/source";
import { AcceptInvite } from "./AcceptInvite";

/**
 * Where an invitation link lands.
 *
 * Outside every route group on purpose. `(app)` requires an org in the path
 * and a membership the visitor does not have yet; `(auth)` is for people
 * without a session, and this page needs one. It is its own thing: a signed-in
 * user, not yet a member, about to become one.
 *
 * The proxy's guard already does the hard part — an anonymous visitor is sent
 * to `/login?next=/invite/<token>` and returns here afterwards — so this page
 * only has to handle the case where the guard let somebody through because
 * Supabase is unconfigured, which it does by saying so.
 *
 * ── What it deliberately does not show ───────────────────────────────────
 *
 * The organisation's name. Reading it would need an invitation lookup by
 * token from a caller who is not a member, and the only way to offer that is
 * a SECURITY DEFINER read — which turns the token into an oracle for "does
 * this org exist and what is it called", answerable by anyone who guesses a
 * uuid. The org names itself on the page you land on after accepting.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const db = await getDb();
  if (!db) {
    return (
      <Shell title="No database connected">
        <p className="text-[13px] text-fg-secondary">
          This deployment is running on demo data, so there are no
          organisations to join. Connect Supabase and run the migrations
          first — see SETUP.md.
        </p>
      </Shell>
    );
  }

  const { data } = await db.auth.getUser();
  if (!data.user) {
    // Belt and braces: the proxy sends anonymous visitors to /login already,
    // but it passes everything through when the schema probe says the
    // migrations have not run, and this page can then be reached signed out.
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  return (
    <Shell title="You have been invited">
      <p className="text-[13px] text-fg-secondary">
        You are signed in as{" "}
        <span className="font-medium text-fg">{data.user.email}</span>. An
        invitation can only be accepted by the address it was sent to — if that
        is not this one,{" "}
        <Link
          href="/auth/signout"
          className="hl-focusable rounded-sm text-brand-text underline underline-offset-2"
        >
          sign out
        </Link>{" "}
        and sign in as the invited address first.
      </p>

      <AcceptInvite token={token} />
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-brand-surface text-[15px] font-bold text-brand">
            H
          </span>
          <span className="text-[15px] font-semibold text-fg">Huntloop</span>
        </div>
        <h1 className="text-[24px] leading-8 font-semibold text-fg">{title}</h1>
        <div className="mt-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}

export const metadata = {
  title: "Invitation",
  // An invitation URL is a credential. It must never be indexed, and it must
  // not travel in a Referer header to whatever the invitee clicks next.
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
