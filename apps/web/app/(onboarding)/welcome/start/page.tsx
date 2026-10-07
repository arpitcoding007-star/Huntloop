import { redirect } from "next/navigation";
import { canonicalizeDomain } from "@huntloop/db/identity";
import { StartStep } from "./StartStep";
import { captureForViewer } from "../../../../lib/analytics";
import { resolveDataSource } from "../../../../lib/data/source";
import { listMemberships, stepPath } from "../../../../lib/data/destination";

/**
 * "What do you want to get done first?" — between step one and everything
 * else (K1, COMMAND.md §16.3-K).
 *
 * The old flow sent everybody to "Research my company". That is the right
 * first screen for someone setting up a team to hunt for customers and the
 * wrong one for a person who wants to look into one account, work a list
 * they already have, or just see what Huntloop does. Asking which it is costs
 * one click, and three of the four answers skip company setup entirely.
 *
 * Reached only from step one. Somebody who already has a workspace and lands
 * here by accident (the back button) is sent where `/welcome` would send them;
 * `?new=1` is how the picker asks for another one on purpose.
 */
export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; d?: string }>;
}) {
  const { new: isNew, d } = await searchParams;
  await captureForViewer("onboarding_step_viewed", { step: "first_job" });

  const domain = d ? canonicalizeDomain(d) : null;
  let isAgency = false;

  const { db } = await resolveDataSource();
  if (db) {
    const { data: auth } = await db.auth.getUser();
    if (!auth.user) redirect("/login?next=/welcome");

    const { data: profile } = await db
      .from("profiles")
      .select("role")
      .eq("id", auth.user.id)
      .maybeSingle();
    // Step one comes first: this screen's copy depends on the answer.
    if (!profile?.role) redirect("/welcome");
    isAgency = profile.role === "agency";

    if (!isNew) {
      const first = (await listMemberships())?.[0];
      if (first) {
        redirect(
          first.completedAt || first.step === "done"
            ? `/${first.slug}/dashboard`
            : first.step === "you" || first.step === "company"
              ? `/welcome/company?org=${first.slug}`
              : stepPath(first.slug, first.step),
        );
      }
    }
  }

  return (
    <>
      <h1 className="hl-title text-fg">What do you want to get done first?</h1>
      <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
        Pick one. Huntloop asks for anything else it needs when you get there, and
        learns how you like to work as you use it.
      </p>
      <div className="mt-6">
        <StartStep prefill={domain} isAgency={isAgency} />
      </div>
    </>
  );
}

export const metadata = { title: "Get started" };
