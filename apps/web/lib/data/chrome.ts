import "server-only";
import { cache } from "react";
import { requireOrgId } from "./org";
import { getOrganization } from "./organization";
import { listPlans } from "./plans";
import { getDefaultNeedsYou } from "./needs-you";
import { load } from "./source";

/**
 * What the app shell itself needs to render — as opposed to what any one
 * page needs.
 *
 * The redesigned sidebar ends in a plan readout and an account row, and both
 * are facts about the signed-in session rather than decoration. That is the
 * whole reason this module exists: the alternative was a footer with
 * "Growth plan · 8 / 1,000" typed into JSX, which is a number that can
 * disagree with the product, and the first person to notice the
 * disagreement would be a customer who has just hit a limit the sidebar said
 * they were nowhere near.
 *
 * Everything here is optional on purpose. In demo mode there is no session
 * and no usage, so the fields come back null and the footer renders the
 * pieces it has rather than inventing the ones it does not — same rule as
 * the `unbuilt` nav flag, applied to data.
 */

export interface ShellChrome {
  /** Display name of the workspace. Falls back to the slug. */
  orgName: string;
  /** e.g. "Growth plan". Null when no plan is resolvable. */
  planLabel: string | null;
  /**
   * The one quota worth putting in permanent chrome. Opportunities, because
   * it is the unit of the product (§1) and the limit a user actually runs
   * into; the rest live on the billing screen where they can be read
   * together. Null when unlimited or unknown — a meter with no maximum is a
   * bar that can only ever be empty.
   */
  quota: { label: string; used: number; limit: number } | null;
  /** The signed-in person. Null in demo mode, where there is nobody. */
  account: { name: string; email: string } | null;
  /**
   * How many "Needs you" items this person has, with their default filter.
   * The same number the dashboard rail shows, from the same cached call.
   */
  needsYou: number;
}

/**
 * Cached per request. The org layout renders on every navigation and this is
 * the only caller, but `cache` costs nothing and makes it safe for a page
 * inside the layout to ask the same question without paying twice.
 */
export const getShellChrome = cache(async (orgSlug: string): Promise<ShellChrome> => {
  const [{ data: org }, { data: plans }, session, needsYou] = await Promise.all([
    getOrganization(orgSlug),
    listPlans(),
    loadSession(),
    /* A failure here costs the badge, never the shell: chrome renders on every
       page, and a sidebar that threw because a count did would take the whole
       workspace down with it. */
    getDefaultNeedsYou(orgSlug).then((r) => r.data.items.length).catch(() => 0),
  ]);

  const plan = org?.planId ? plans.find((p) => p.id === org.planId) : undefined;
  const limit = plan?.limits.opportunities ?? null;

  return {
    orgName: org?.name ?? orgSlug,
    planLabel: plan ? `${plan.name} plan` : null,
    /* `limit === null` is "unlimited", which is a real answer and not a
       missing one — but it is not a meter, so the chrome shows nothing
       rather than a bar at 0%. */
    quota:
      limit === null || limit === 0
        ? null
        : {
            label: "Opportunities",
            used: org ? await countOpportunities(orgSlug) : 0,
            limit,
          },
    account: session,
    needsYou,
  };
});

/**
 * Head count rather than a page of rows: the footer needs the number, and
 * selecting the opportunities themselves to call `.length` on them is the
 * shape of query that is fine at 8 rows and a problem at 10,000.
 *
 * Deliberately not `checkQuota`. That reads `usage_counters`, which is the
 * *metered* figure for the current billing month; the sidebar is answering
 * "how full is this workspace", which is the stored total. The two differ
 * after a month rolls over, and showing the metered number under a heading
 * that says "Opportunities" would be the more confusing of the two.
 */
async function countOpportunities(orgSlug: string): Promise<number> {
  const { data } = await load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "countOpportunities");

      /* `head: true` sends no rows at all — PostgREST answers with the
         Content-Range header and nothing else. Scoped by `org_id` as well
         as by RLS, because RLS admits every org the caller belongs to and
         this number is about one of them. */
      const { count, error } = await db
        .from("opportunities")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .is("deleted_at", null);

      if (error) throw new Error(`countOpportunities: ${error.message}`);
      return count ?? 0;
    },
    () => 0,
  );
  return data;
}

/**
 * The signed-in user, as a name and an address.
 *
 * Supabase puts whatever the identity provider supplied in `user_metadata`,
 * so `full_name` is present for a Google sign-in and absent for an
 * email/password one. The local part of the address is the fallback rather
 * than "User" — it is at least something the person recognises as theirs.
 */
async function loadSession(): Promise<ShellChrome["account"]> {
  const { data } = await load(
    async (db) => {
      const { data: auth } = await db.auth.getUser();
      const user = auth.user;
      if (!user?.email) return null;

      const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
      const named = typeof metadata.full_name === "string" ? metadata.full_name.trim() : "";

      return {
        name: named || user.email.split("@")[0],
        email: user.email,
      };
    },
    () => null,
  );
  return data;
}
