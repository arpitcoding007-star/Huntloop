import { redirect } from "next/navigation";
import { YouForm } from "./YouForm";
import { captureForViewer } from "../../../lib/analytics";
import { resolveDataSource } from "../../../lib/data/source";
import { listMemberships } from "../../../lib/data/destination";
import { canonicalizeDomain } from "@huntloop/db/identity";

/**
 * Step one of the funnel.
 *
 * This used to be "name your organisation" — a text box on an empty screen,
 * asked before Huntloop knew anything, whose answer was then slugified into a
 * permanent URL. It has been replaced for two reasons. The org name is a
 * better *derivation* than a question (the domain in step two yields it), and
 * the question that genuinely had nowhere else to go was this one: who is
 * using this?
 *
 * ── `?new=1` ─────────────────────────────────────────────────────────────
 *
 * The org picker links here with it, to create a second workspace. Without it
 * a user who already has one and lands on `/welcome` is sent onward rather
 * than asked their name a second time — the commonest way to reach this screen
 * unintentionally is the browser's back button.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; d?: string }>;
}) {
  const { new: isNew, d } = await searchParams;
  await captureForViewer("onboarding_step_viewed", { step: "you" });

  /* Carried from `/discover` via signup, so the company step opens with the
     address the visitor already used. Canonicalised rather than passed
     through: it ends up in a URL and then in an input, and a value that is not
     a hostname has no business being either. */
  const domain = d ? canonicalizeDomain(d) : null;
  const carry = domain ? `&d=${encodeURIComponent(domain)}` : "";

  const { db } = await resolveDataSource();

  let initialName = "";

  if (db) {
    const { data: auth } = await db.auth.getUser();

    /* No session and a live database means the guard in `proxy.ts` let a
       request through that it should have bounced. Sending them to sign in is
       the honest response — the form below would fail at the first write. */
    if (!auth.user) redirect("/login?next=/welcome");

    const { data: profile } = await db
      .from("profiles")
      .select("full_name, role")
      .eq("id", auth.user.id)
      .maybeSingle();

    initialName =
      typeof profile?.full_name === "string" ? profile.full_name : "";

    /* Already answered, and not deliberately starting another workspace? Then
       this screen has nothing to ask. Resume wherever the workspace stopped. */
    if (profile?.role && !isNew) {
      const memberships = await listMemberships();
      const first = memberships?.[0];
      if (first) {
        redirect(
          first.completedAt || first.step === "done"
            ? `/${first.slug}/dashboard`
            : `/welcome/company?org=${first.slug}${carry}`,
        );
      }
      redirect(domain ? `/welcome/company?d=${encodeURIComponent(domain)}` : "/welcome/company");
    }
  }

  return (
    <>
      <h1 className="text-[26px] leading-8 font-semibold text-fg">
        First — who are you?
      </h1>
      <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
        Two questions, then we&rsquo;ll read your website and do the rest.
        Huntloop lays itself out around how you work.
      </p>

      <div className="mt-6">
        <YouForm initialName={initialName} carry={carry} />
      </div>
    </>
  );
}

export const metadata = { title: "Set up" };
