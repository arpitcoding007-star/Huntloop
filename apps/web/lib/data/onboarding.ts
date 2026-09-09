import "server-only";
import { revalidatePath } from "next/cache";
import {
  parseIcp,
  scoreIcp,
  serializeCriteria,
  serializeExclusions,
  type Icp,
  type IcpCriteria,
  type IcpExclusions,
} from "@huntloop/db/icp";
import type { CompanyUnderstanding } from "@huntloop/ai";
import { fail, mutate, ok, type ActionResult } from "./org";
import { currentViewer } from "./membership";
import { resolveDataSource } from "./source";
import { hasOnboardingSchema } from "./onboarding-schema";
import {
  ONBOARDING_STEPS as STEPS,
  GOALS as GOAL_VALUES,
  USER_ROLES as ROLE_VALUES,
  isBefore as stepIsBefore,
  type Goal,
  type OnboardingStep,
  type OutreachChannel,
  type UserRole,
} from "../onboarding/steps";
import type { TenantClient } from "@huntloop/db";

/**
 * Onboarding, as rows rather than as a wizard.
 *
 * ── The defect this module exists to fix ─────────────────────────────────
 *
 * `ONB-01`. The `/welcome` flow asked four screens of questions and wrote two
 * rows — `organizations` and `memberships`. Everything else lived in
 * `sessionStorage` (`lib/onboarding/draft.ts`) and was **deleted** by the last
 * step, which called `clearDraft()` on its way to the dashboard.
 *
 * So the product research, the ICP, and the accepted sources were collected,
 * shown back to the user, used to justify the next screen — and then thrown
 * away. A user who answered every question arrived at a workspace that knew
 * their organisation's name and nothing else, and every screen that asks "what
 * is your ICP?" answered "none defined".
 *
 * ── The rule this module is built on ─────────────────────────────────────
 *
 * **Every step writes on submit, to the table the product actually reads.**
 *
 * Not to a staging table, not to a draft blob. `products`, `icps`, `personas`
 * and `sources` have existed since `0002`; the settings screens read them, the
 * engine reads them, and the job runner reads them. An onboarding flow that
 * writes anywhere else creates a second source of truth that has to be
 * reconciled, and the reconciliation is where the answers get lost.
 *
 * The consequence, which is a feature: leaving halfway through leaves a
 * *partially configured workspace*, not a lost session. The ICP screen in
 * settings shows what you entered. Nothing is waiting in a tab.
 *
 * ── Why progress lives on the organisation ───────────────────────────────
 *
 * `0024` puts `onboarding_step` on `organizations`, and the reasoning is worth
 * repeating here because it governs every function below: onboarding
 * configures a *workspace*. One ICP, one product, one set of sources. If
 * progress were per-user, the second person to join would be walked through
 * company research again and would produce a second, contradictory ICP —
 * which is `ICP-01` re-committed through the front door.
 *
 * Role is the exception and goes on `profiles`, because it lays out one
 * person's dashboard and an SDR must not inherit the founder's.
 */

/* ── The vocabulary ──────────────────────────────────────────────────────── */

/*
 * Re-exported rather than defined here.
 *
 * The words live in `lib/onboarding/steps.ts`, which has no dependencies, so
 * that the client step screens and `lib/validation.ts` can import them without
 * dragging this `server-only` module into a browser bundle. This file is the
 * writes; that one is the vocabulary they are written in.
 */
export {
  ONBOARDING_STEPS,
  GOALS,
  USER_ROLES,
  OUTREACH_CHANNELS,
  isBefore,
  nextStep,
} from "../onboarding/steps";

export type {
  Goal,
  OnboardingStep,
  OutreachChannel,
  UserRole,
} from "../onboarding/steps";

/* ── Demo mode ───────────────────────────────────────────────────────────── */

/**
 * True when there is no database to write to.
 *
 * ── Why the save steps succeed instead of refusing ───────────────────────
 *
 * The instinct is to refuse: nothing was saved, so reporting success is a lie,
 * and this codebase is unusually strict about exactly that.
 *
 * The strictness is about *presenting the unverified as established* — an
 * invented company profile, a fabricated market size, an inference wearing a
 * fact's badge. This is a different thing. Onboarding is five screens that
 * feed each other, and refusing at step one makes the remaining four
 * unreachable on the configuration every reviewer and every fresh checkout
 * runs. The original `createOrganisation` made this call explicitly and it was
 * right: "blocking here would make the whole flow unreviewable before the
 * migrations are applied."
 *
 * What keeps it honest is that the deployment says so, loudly and everywhere:
 * `DataSourceBanner` is in the org layout, the research and ICP screens carry
 * their own "no model is connected" notices, and nothing in demo mode claims a
 * row exists. The user is not misled about what happened; they are allowed to
 * walk through a flow that cannot persist.
 *
 * The moment a database *is* connected, every one of these writes for real.
 */
async function isDemoMode(): Promise<boolean> {
  const { db } = await resolveDataSource();
  return db === null;
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

export interface OnboardingState {
  orgId: string;
  orgSlug: string;
  orgName: string;
  step: OnboardingStep;
  goals: Goal[];
  completedAt: string | null;
  /** The caller's own role and name — from `profiles`, not the org. */
  role: UserRole | null;
  fullName: string | null;
  /** What has actually been configured, as opposed to what step we are on. */
  hasProduct: boolean;
  hasIcp: boolean;
  sourceCount: number;
}

/**
 * Where this workspace is, and what it already has.
 *
 * Returns null in demo mode and for a non-member — the same two cases every
 * loader in this directory treats as "there is nothing to read", and both are
 * handled by the caller rather than papered over with a default state. A
 * fabricated "you are on step one" for a deployment with no database would
 * send a demo visitor into a flow that cannot save anything.
 *
 * ── Why `hasIcp` is asked separately from `step` ─────────────────────────
 *
 * Because they can disagree, and when they do the rows win. A user can reach
 * `sources` and then delete their ICP from the settings screen; a user can
 * complete onboarding in 2025 and be looked at by code written after `0024`
 * added the column. The step is a *hint about where to send someone*; the rows
 * are what the product actually has. Screens that gate on capability — "is
 * there anything to discover with?" — must ask the rows.
 */
export async function getOnboardingState(
  orgSlug: string,
): Promise<OnboardingState | null> {
  const { db } = await resolveDataSource();
  if (!db) return null;

  const viewer = await currentViewer(orgSlug);
  if (!viewer || viewer.kind !== "member") return null;

  /* Before `0024` there is no onboarding state to read, and selecting the
     columns fails the whole query rather than the one field. Absent is the
     honest answer, and every caller already handles it: the setup card hides
     itself and the dashboard falls back to the balanced layout. */
  if (!(await hasOnboardingSchema(db))) return null;

  const [org, profile, product, icp, sources] = await Promise.all([
    db
      .from("organizations")
      .select("id, name, slug, onboarding_step, onboarding_completed_at, goals")
      .eq("id", viewer.orgId)
      .maybeSingle(),
    db.auth.getUser().then(async ({ data }) => {
      if (!data.user) return null;
      const { data: row } = await db
        .from("profiles")
        .select("full_name, role")
        .eq("id", data.user.id)
        .maybeSingle();
      return row;
    }),
    db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("org_id", viewer.orgId)
      .is("deleted_at", null),
    db
      .from("icps")
      .select("id", { count: "exact", head: true })
      .eq("org_id", viewer.orgId)
      .eq("is_active", true)
      .is("deleted_at", null),
    db
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("org_id", viewer.orgId)
      .eq("is_enabled", true)
      .is("deleted_at", null),
  ]);

  if (!org.data) return null;

  const row = org.data as {
    id: string;
    name: string;
    slug: string;
    onboarding_step: string | null;
    onboarding_completed_at: string | null;
    goals: string[] | null;
  };

  return {
    orgId: row.id,
    orgSlug: row.slug,
    orgName: row.name,
    // A value outside the set means the enum moved and this file did not.
    // Falling back to the *start* is the safe direction: it offers setup to
    // someone who may not need it, rather than skipping setup for someone who
    // does and leaving them with an empty workspace and no explanation.
    step: isStep(row.onboarding_step) ? row.onboarding_step : "you",
    goals: (row.goals ?? []).filter(isGoal),
    completedAt: row.onboarding_completed_at,
    role: isRole(profile?.role) ? profile.role : null,
    fullName: typeof profile?.full_name === "string" ? profile.full_name : null,
    hasProduct: (product.count ?? 0) > 0,
    hasIcp: (icp.count ?? 0) > 0,
    sourceCount: sources.count ?? 0,
  };
}

function isStep(v: unknown): v is OnboardingStep {
  return typeof v === "string" && (STEPS as readonly string[]).includes(v);
}

function isGoal(v: unknown): v is Goal {
  return typeof v === "string" && (GOAL_VALUES as readonly string[]).includes(v);
}

function isRole(v: unknown): v is UserRole {
  return typeof v === "string" && (ROLE_VALUES as readonly string[]).includes(v);
}

/* ── Advancing ───────────────────────────────────────────────────────────── */

/**
 * Moves the workspace to a step, through `0024`'s function.
 *
 * The RPC rather than a direct update, because `org_write` in `0001` requires
 * admin — it also guards the organisation's *name* — and advancing your own
 * onboarding is not an administrative act. An invited member finishing setup
 * is the ordinary case, and loosening `org_write` to let them would also let
 * them rename the workspace.
 *
 * Never moves *backwards*. Revisiting the ICP screen from settings must not
 * reset a finished workspace to step four, and the guard lives here rather
 * than in each caller because every caller would otherwise have to remember
 * it.
 */
async function advance(
  db: TenantClient,
  orgId: string,
  current: OnboardingStep,
  target: OnboardingStep,
  goals?: Goal[],
): Promise<void> {
  const step = stepIsBefore(current, target) ? target : current;
  const { error } = await db.rpc("advance_onboarding", {
    p_org: orgId,
    p_step: step,
    p_goals: goals ?? null,
  });
  // Reported rather than thrown. The user's actual answer is already saved by
  // the time this runs; failing the whole action because a progress marker did
  // not move would discard a good write to record a bookkeeping problem.
  if (error) console.error(`advance_onboarding(${step}): ${error.message}`);
}

/** The current step, read cheaply for the `advance` guard above. */
async function currentStep(db: TenantClient, orgId: string): Promise<OnboardingStep> {
  const { data } = await db
    .from("organizations")
    .select("onboarding_step")
    .eq("id", orgId)
    .maybeSingle();
  const step = (data as { onboarding_step?: string } | null)?.onboarding_step;
  return isStep(step) ? step : "you";
}

/* ── Step 1 · You ────────────────────────────────────────────────────────── */

/**
 * The person, not the workspace.
 *
 * Writes `profiles` directly rather than through an RPC, because
 * `profile_self_write` in `0007` already permits exactly this — `for update
 * using (id = auth.uid())` covers the columns `0024` added, since a policy is
 * over rows rather than columns. A user owns their profile row; nobody owns
 * the organisation row alone, which is why the org needs a function and this
 * does not.
 *
 * Takes no org: this step runs *before* the workspace exists for a founder,
 * and *after* it exists for an invited teammate. Coupling it to an org would
 * make the first case impossible.
 */
export async function saveYouStep(
  fullName: string,
  role: UserRole,
): Promise<ActionResult<undefined>> {
  const { db } = await resolveDataSource();
  // Demo mode walks the flow without persisting. See `isDemoMode`.
  if (!db) return ok(undefined);

  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return fail("Your session expired. Sign in again.");

  /* `role` and `onboarded_at` arrive with `0024`. Before it the name is still
     worth saving — it is what every email signature uses — and losing the whole
     write in order to record a column that does not exist yet would be the
     wrong trade. The role is simply asked again once the migration lands,
     because `profiles.role` is then null and `/welcome` reads null as
     never-asked rather than as declined. */
  const migrated = await hasOnboardingSchema(db);

  const { error } = await db
    .from("profiles")
    .update(
      migrated
        ? { full_name: fullName, role, onboarded_at: new Date().toISOString() }
        : { full_name: fullName },
    )
    .eq("id", auth.user.id);

  if (error) return fail(`Your details could not be saved: ${error.message}`);
  return ok(undefined);
}

/* ── Step 2 · Your company ───────────────────────────────────────────────── */

/**
 * What the research established, as a product row.
 *
 * ── Both mapped *and* kept whole ─────────────────────────────────────────
 *
 * The prose is mapped into the columns the engine reads — `description` is
 * what `qualify`, `why_now` and `personalize_message` all take, and a blob
 * each of them had to reduce to one sentence would be three chances to reduce
 * it differently.
 *
 * The whole `CompanyUnderstanding` is *also* stored, in `products.research`
 * (migration `0026`). That column exists because writing this function
 * revealed the gap: research establishes five things and `products` had a
 * column for one. `draft_icp`'s entire honesty mechanism is a closed set of
 * citations built from those five sentences, so persisting two of them would
 * mean a re-draft — after an edit, on another device, a month later — silently
 * produced a thinner profile than the first run did.
 *
 * It is deliberately not written to `evidence`. `evidence.subject_id`
 * references a subject, and `company` there means a row in `companies`, which
 * holds *prospects*. Inventing one for the customer's own company would put a
 * fabricated prospect in every workspace — and it would then be scored,
 * ranked and possibly contacted.
 */
export async function saveCompanyStep(
  orgSlug: string,
  understanding: CompanyUnderstanding,
  isLive = false,
): Promise<ActionResult<{ productId: string }>> {
  // Demo mode walks the flow without persisting. See `isDemoMode`.
  if (await isDemoMode()) return ok({ productId: "demo-product" });

  return mutate(orgSlug, "saveCompanyStep", async ({ db, orgId }) => {
    const find = (field: string) =>
      understanding.findings.find((f) => f.field === field);

    // An `unknown` finding asserts nothing. Writing its `value` — which is
    // prose about what the site did NOT establish — into `description` would
    // hand the qualifier a sentence about absence and let it reason from it.
    const usable = (field: string) => {
      const f = find(field);
      return f && f.kind !== "unknown" ? f.value.trim() : "";
    };

    const description = usable("sells");
    const problem = usable("problem");

    const base = {
      org_id: orgId,
      name: understanding.companyName,
      website: understanding.url,
      description,
      // `value_props` is a jsonb array of strings — the same shape
      // `productSchema` validates and the settings form writes.
      value_props: problem ? [problem] : [],
    };

    /* The three `0026` columns, when they exist.
       Gated rather than assumed, because code and migrations do not land
       together: writing a column PostgREST has never heard of fails the whole
       insert, and this is the step that creates the product row every later
       screen reads. Losing that to record provenance would be the wrong trade
       — and the prose still lands in `description`, so the only thing missing
       before the migration is the ability to re-draft the ICP later. */
    const row = (await hasOnboardingSchema(db))
      ? {
          ...base,
          // The whole reading, so `draft_icp` can cite all five sentences
          // rather than the two that fit in columns.
          research: understanding as unknown as Record<string, unknown>,
          researched_at: new Date().toISOString(),
          /* False means "no model was configured and this is the labelled
             worked example". Storing it is what stops the demo profile being
             promoted to a real one by the next thing that reads the row — the
             same rule the screens enforce visually, made durable. */
          research_is_live: isLive,
        }
      : base;

    /* Upsert by hand rather than with `onConflict`: there is no unique
       constraint on `(org_id, name)` and adding one would be wrong — an org
       may genuinely sell two products. "The product this org onboarded with"
       is the first one, so that is the one re-run research updates. */
    const { data: existing } = await db
      .from("products")
      .select("id")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    let productId: string;

    if (existing?.id) {
      productId = String(existing.id);
      const { error } = await db
        .from("products")
        .update(row)
        .eq("id", productId)
        .eq("org_id", orgId);
      if (error) return fail(`Your company details could not be saved: ${error.message}`);
    } else {
      const { data, error } = await db
        .from("products")
        .insert(row)
        .select("id")
        .single();
      if (error) return fail(`Your company details could not be saved: ${error.message}`);
      productId = String(data.id);
    }

    /* The organisation takes the researched name. The slug is deliberately
       NOT touched: it is in every URL the user has open, it was shown to them
       for confirmation when the workspace was created, and `0001` makes it
       unique — a rename here could collide with another tenant's slug and
       fail a write that has already half-succeeded. */
    await db
      .from("organizations")
      .update({ name: understanding.companyName })
      .eq("id", orgId);

    await advance(db, orgId, await currentStep(db, orgId), "goals");
    revalidatePath(`/${orgSlug}`, "layout");
    return ok({ productId });
  });
}

/* ── Step 3 · What you want ──────────────────────────────────────────────── */

export async function saveGoalsStep(
  orgSlug: string,
  goals: Goal[],
  channel: OutreachChannel,
): Promise<ActionResult<undefined>> {
  if (await isDemoMode()) return ok(undefined);

  return mutate(orgSlug, "saveGoalsStep", async ({ db, orgId }) => {
    /* `0024` caps this at two in a CHECK, and the form caps it at two in the
       UI. Trimmed here as well because this is the boundary between them —
       a request that arrives with five would otherwise fail at Postgres with
       a constraint name instead of at the edge with a sentence. */
    const capped = [...new Set(goals)].slice(0, 2);

    /* The channel goes in `settings`, not in a column, because unlike `goals`
       nothing scheduled reads it — it decides whether a *screen* offers
       mailbox OAuth. `settings` is read by a form; `goals` is read by a job at
       three in the morning, and that difference is the whole reason one is a
       column and the other is not. */
    const { data: org } = await db
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .maybeSingle();

    const settings = ((org as { settings?: Record<string, unknown> } | null)?.settings ??
      {}) as Record<string, unknown>;
    const outreach = (settings.outreach ?? {}) as Record<string, unknown>;

    const { error } = await db
      .from("organizations")
      .update({ settings: { ...settings, outreach: { ...outreach, channel } } })
      .eq("id", orgId);
    if (error) return fail(`That could not be saved: ${error.message}`);

    await advance(db, orgId, await currentStep(db, orgId), "icp", capped);
    revalidatePath(`/${orgSlug}`, "layout");
    return ok(undefined);
  });
}

/* ── Step 4 · Who you sell to ────────────────────────────────────────────── */

export interface PersonaDraft {
  name: string;
  titlePatterns: string[];
  seniority: string[];
  departments: string[];
  excludeTitles: string[];
  painPoints: string[];
}

export interface IcpStepInput {
  criteria: IcpCriteria;
  exclusions: IcpExclusions;
  persona: PersonaDraft | null;
  /** From the reach counter, when a provider answered. Never inferred. */
  addressable: { estimate: number; at: string } | null;
}

/**
 * The ICP, its personas, and version 1 — the write onboarding exists for.
 *
 * ── Three writes that have to agree ──────────────────────────────────────
 *
 * The `icps` row, the `personas` row, and the immutable snapshot in
 * `icp_versions`. The snapshot is taken *last*, by `bump_icp_version_for_org`,
 * because `0013`'s function reads the personas back out of the table to build
 * it — so a persona written after the bump would be missing from the version
 * that every score computed afterwards claims to have been judged against.
 *
 * That ordering is the entire reason this is one function rather than three
 * actions the screen calls in sequence.
 *
 * ── Why the full v2 criteria and not the v1 four ─────────────────────────
 *
 * `0013` gave `criteria` fifteen typed keys and `translateIcp()` maps every
 * one of them to a provider filter or reports it as unmappable. Writing only
 * `{segments, sizes, regions, triggers}` — which is what the settings screen
 * still does — means discovery searches on a quarter of what the user told us,
 * silently. `serializeCriteria` omits absent keys, so a profile that genuinely
 * has only the four stores only the four.
 */
export async function saveIcpStep(
  orgSlug: string,
  input: IcpStepInput,
): Promise<ActionResult<{ icpId: string; quality: number }>> {
  /* The quality score is computed rather than faked, because it is
     deterministic and depends only on what the user just typed — so the number
     the demo shows is the number a real save would store. */
  if (await isDemoMode()) {
    return ok({
      icpId: "demo-icp",
      quality: scoreIcp({ criteria: input.criteria, exclusions: input.exclusions }).score,
    });
  }

  return mutate(orgSlug, "saveIcpStep", async ({ db, orgId }) => {
    const icp: Icp = { criteria: input.criteria, exclusions: input.exclusions };
    const quality = scoreIcp(icp);

    const { data: product } = await db
      .from("products")
      .select("id")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const row = {
      org_id: orgId,
      product_id: product?.id ?? null,
      /* Named after the segments rather than "Default", because this string is
         what the ICP picker, the version history and every score's "judged
         against" line will show for the life of the workspace. "Default" tells
         a user nothing about which profile a score used once there are two. */
      name: icpName(input.criteria),
      criteria: serializeCriteria(input.criteria),
      negative_criteria: serializeExclusions(input.exclusions),
      quality_score: quality.score,
      ...(input.addressable
        ? {
            addressable_estimate: input.addressable.estimate,
            // 'provider' and not 'manual': this number came from a provider's
            // own count for a zero-row search. `0013` is emphatic that a
            // market size a model invented must never be stored here, and the
            // provenance column is how a reader tells the difference.
            addressable_source: "provider" as const,
            addressable_at: input.addressable.at,
          }
        : {}),
    };

    const { data: existing } = await db
      .from("icps")
      .select("id")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    let icpId: string;

    if (existing?.id) {
      icpId = String(existing.id);
      const { error } = await db
        .from("icps")
        .update(row)
        .eq("id", icpId)
        .eq("org_id", orgId);
      if (error) return fail(`Your customer profile could not be saved: ${error.message}`);
    } else {
      const { data, error } = await db
        .from("icps")
        .insert({ ...row, is_active: true })
        .select("id")
        .single();
      if (error) return fail(`Your customer profile could not be created: ${error.message}`);
      icpId = String(data.id);
    }

    /* Personas, before the version bump. See the note above — `0013`'s
       function reads them out of the table to build the snapshot. */
    if (input.persona && input.persona.titlePatterns.length > 0) {
      const personaRow = {
        org_id: orgId,
        icp_id: icpId,
        name: input.persona.name || "Primary buyer",
        title_patterns: input.persona.titlePatterns,
        seniority: input.persona.seniority,
        departments: input.persona.departments,
        exclude_titles: input.persona.excludeTitles,
        pain_points: input.persona.painPoints,
        priority: 1,
        is_primary: true,
      };

      const { data: existingPersona } = await db
        .from("personas")
        .select("id")
        .eq("org_id", orgId)
        .eq("icp_id", icpId)
        .is("deleted_at", null)
        .order("priority", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (existingPersona?.id) {
        await db
          .from("personas")
          .update(personaRow)
          .eq("id", existingPersona.id)
          .eq("org_id", orgId);
      } else {
        await db.from("personas").insert(personaRow);
      }
    }

    /* The snapshot. Failure here is reported and does not fail the action:
       the profile itself is saved, and refusing the user's work because the
       history could not be written would be the wrong trade. It does mean a
       score could cite a version that does not exist, which is why it is
       logged loudly rather than swallowed. */
    const { error: bumpError } = await db.rpc("bump_icp_version_for_org", {
      p_org: orgId,
      p_icp: icpId,
      p_diff: { reason: "onboarding" },
      p_quality: quality.score,
    });
    if (bumpError) {
      console.error(`bump_icp_version_for_org: ${bumpError.message}`);
    }

    await advance(db, orgId, await currentStep(db, orgId), "sources");
    revalidatePath(`/${orgSlug}`, "layout");
    return ok({ icpId, quality: quality.score });
  });
}

/**
 * A name for the profile, from what it says.
 *
 * Falls back through segments → industries → a plain label, because a profile
 * built from a thin site may have neither and a blank name would fail the
 * `not null` column.
 */
function icpName(criteria: IcpCriteria): string {
  const first = criteria.segments?.[0] ?? criteria.industries?.[0];
  if (!first) return "Ideal customer";
  const extra =
    (criteria.segments?.length ?? 0) + (criteria.industries?.length ?? 0) - 1;
  return extra > 0 ? `${first} +${extra}` : first;
}

/* ── Step 5 · Where to look ──────────────────────────────────────────────── */

export interface SourceDraft {
  name: string;
  kind: string;
  url: string | null;
  /** `system` for an accepted recommendation, `user` for one they typed. */
  recommendedBy: "system" | "user";
}

const SOURCE_KINDS = new Set([
  "news", "blog", "jobs", "social", "github", "funding",
  "regulatory", "community", "podcast", "custom",
]);

/**
 * The accepted sources.
 *
 * `recommended_by` is the interesting column and it has never been written.
 * `0002` added it so the learning loop could later ask whether the system's
 * picks or the user's produced better opportunities — a question that is
 * unanswerable retroactively, because once the provenance is lost it cannot be
 * reconstructed from the row. Every source written here carries it.
 */
export async function saveSourcesStep(
  orgSlug: string,
  sources: SourceDraft[],
): Promise<ActionResult<{ created: number }>> {
  if (await isDemoMode()) return ok({ created: sources.length });

  return mutate(orgSlug, "saveSourcesStep", async ({ db, orgId }) => {
    const { data: icp } = await db
      .from("icps")
      .select("id")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    /* Already-known sources are skipped rather than duplicated. There is no
       unique constraint on `(org_id, url)` — two feeds of the same publication
       are legitimately two sources — so "already there" is decided here, by
       URL, which is the identity a user would recognise. */
    const { data: existing } = await db
      .from("sources")
      .select("url, name")
      .eq("org_id", orgId)
      .is("deleted_at", null);

    const seenUrls = new Set(
      (existing ?? [])
        .map((s) => (s as { url: string | null }).url)
        .filter((u): u is string => Boolean(u))
        .map((u) => u.toLowerCase()),
    );
    const seenNames = new Set(
      (existing ?? []).map((s) => String((s as { name: string }).name).toLowerCase()),
    );

    const rows = sources
      .filter((s) => {
        const url = s.url?.toLowerCase();
        if (url && seenUrls.has(url)) return false;
        if (!url && seenNames.has(s.name.toLowerCase())) return false;
        if (url) seenUrls.add(url);
        else seenNames.add(s.name.toLowerCase());
        return true;
      })
      .map((s) => ({
        org_id: orgId,
        icp_id: icp?.id ?? null,
        // The column is a Postgres enum. A value outside it fails the insert
        // with a type error rather than a message, so unknown kinds become
        // `custom` — which is what the enum has a `custom` member for.
        kind: SOURCE_KINDS.has(s.kind) ? s.kind : "custom",
        name: s.name,
        url: s.url,
        recommended_by: s.recommendedBy,
        is_enabled: true,
      }));

    if (rows.length > 0) {
      const { error } = await db.from("sources").insert(rows);
      if (error) return fail(`Your sources could not be saved: ${error.message}`);
    }

    await advance(db, orgId, await currentStep(db, orgId), "building");
    revalidatePath(`/${orgSlug}`, "layout");
    return ok({ created: rows.length });
  });
}

/* ── Finishing ───────────────────────────────────────────────────────────── */

export async function completeOnboarding(
  orgSlug: string,
): Promise<ActionResult<undefined>> {
  if (await isDemoMode()) return ok(undefined);

  return mutate(orgSlug, "completeOnboarding", async ({ db, orgId }) => {
    await advance(db, orgId, await currentStep(db, orgId), "done");
    revalidatePath(`/${orgSlug}`, "layout");
    return ok(undefined);
  });
}

/**
 * Moves a workspace to a step directly, for the screens that need to.
 *
 * The `building` screen advances to `review` when its work finishes, and the
 * review screen advances to `done`. Both are legitimate and neither is a form
 * submission, so they need a way in that is not one of the `save*` functions.
 */
export async function setOnboardingStep(
  orgSlug: string,
  target: OnboardingStep,
): Promise<ActionResult<undefined>> {
  if (await isDemoMode()) return ok(undefined);

  return mutate(orgSlug, "setOnboardingStep", async ({ db, orgId }) => {
    await advance(db, orgId, await currentStep(db, orgId), target);
    revalidatePath(`/${orgSlug}`, "layout");
    return ok(undefined);
  });
}

/* ── Claiming the anonymous reading ──────────────────────────────────────── */

export interface ClaimedResearch {
  domain: string;
  understanding: CompanyUnderstanding;
  isLive: boolean;
}

/**
 * The research done for this person's company before they had an account.
 *
 * ── Why it takes no argument ─────────────────────────────────────────────
 *
 * `claim_research()` in `0025` derives the domain from the caller's own
 * verified email address rather than accepting one. That is the load-bearing
 * decision: an argument could be tampered with, and a signed-in user who could
 * name any domain would get a free read of what Huntloop understood about
 * somebody else's business. Deriving it inside a SECURITY DEFINER function
 * means there is nothing to tamper with.
 *
 * The consequence is that this only works for a work email. Somebody who
 * signed up from Gmail after researching their employer's site gets nothing
 * here and pays for the reading again — which is the correct failure, because
 * a Gmail address is not evidence of employment anywhere.
 *
 * Claiming is idempotent by construction: the function marks the row claimed
 * in the same statement it reads it, so a second call returns nothing.
 */
export async function claimResearch(): Promise<ClaimedResearch | null> {
  const { db } = await resolveDataSource();
  if (!db) return null;

  const { data, error } = await db.rpc("claim_research");
  if (error || !Array.isArray(data) || data.length === 0) return null;

  const row = data[0] as {
    research_domain: string;
    understanding: unknown;
    is_live: boolean;
  };

  const understanding = row.understanding as CompanyUnderstanding | null;
  // A row whose blob is not a usable understanding is treated as absent. It
  // came from a table the tenant cannot read and an older shape is possible;
  // failing onboarding over it would be the wrong trade.
  if (!understanding || !Array.isArray(understanding.findings)) return null;

  return {
    domain: row.research_domain,
    understanding,
    isLive: Boolean(row.is_live),
  };
}

/* ── What the ICP step drafts from ───────────────────────────────────────── */

export interface StoredResearch {
  companyName: string;
  sells: string;
  buyers: string;
  problem: string;
  trigger: string;
  /** False when the row holds the labelled worked example rather than a reading. */
  isLive: boolean;
}

/**
 * The demo reading.
 *
 * Word-for-word the `example()` in `lib/ai/research.ts`, minus the `unknown`
 * finding — which is deliberately absent here rather than empty, because
 * `getStoredResearch` drops unknowns for a real row too: their text is prose
 * about what a site did *not* establish, and handing that to `draft_icp` as a
 * citable premise would let it derive a criterion from an absence.
 *
 * Kept identical to the research step's example so a reviewer walking the flow
 * sees one company described one way, rather than two fictional businesses
 * that appear to contradict each other.
 */
const DEMO_RESEARCH: StoredResearch = {
  companyName: "Example Co",
  sells:
    "Policy and permissioning infrastructure for autonomous agents that hold or move funds.",
  buyers: "Crypto trading desks, funds, and AI infrastructure companies.",
  problem:
    "Institutions will not let software hold unconstrained signing authority over capital.",
  trigger:
    "Shipping an autonomous agent that touches real funds, especially just after raising.",
  isLive: false,
};

/**
 * The five research sentences, read back for `draft_icp`.
 *
 * Every field a drafted profile returns has to quote one of these, and the
 * JSON Schema closes the citation to exactly this set — so what this function
 * returns *is* the vocabulary the model is allowed to justify itself with. A
 * sentence missing here is a criterion that becomes unrepresentable, which is
 * why `0026` exists.
 *
 * An `unknown` finding is dropped rather than returned. Its `value` is prose
 * about what the site did *not* establish ("no pricing is published anywhere")
 * and handing that to the drafter as a citable premise would let it derive an
 * ICP field from an absence.
 */
export async function getStoredResearch(
  orgSlug: string,
): Promise<StoredResearch | null> {
  const { db } = await resolveDataSource();

  /* Demo mode returns the same worked example `lib/ai/research.ts` shows, for
     the same reason `lib/data/icp.ts` keeps a FIXTURE: without it the ICP step
     dead-ends on "we have no reading of your website", and the screen this
     work exists to fix is the one nobody can look at.

     `isLive: false` is what keeps it honest — the step renders a banner saying
     this was drafted from a worked example rather than a real reading, so the
     demo is labelled by the same mechanism a live deployment with no API key
     is labelled by. */
  if (!db) return DEMO_RESEARCH;

  const viewer = await currentViewer(orgSlug);
  if (!viewer || viewer.kind !== "member") return null;

  /* `0026`'s columns, when they exist. Before the migration the product row
     still has a `description`, which is what `sells` falls back to — so the
     ICP can still be drafted, from one sentence rather than four. A thinner
     draft is a much better outcome than a failed query. */
  const columns = (await hasOnboardingSchema(db))
    ? "name, description, research, research_is_live"
    : "name, description";

  const { data } = await db
    .from("products")
    .select(columns)
    .eq("org_id", viewer.orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  /* Through `unknown`, because the column list is chosen at runtime and
     PostgREST's types infer the result shape from a *literal* select string.
     Handed a variable it produces a `ParserError`, which is the type system
     correctly reporting that it cannot know — not a mistake to paper over.
     Every field below is read defensively regardless, since the two shapes
     genuinely differ. */
  const row = data as unknown as {
    name: string;
    description: string | null;
    research?: unknown;
    research_is_live?: boolean | null;
  };

  const research = (row.research ?? {}) as Record<string, unknown>;
  const findings = Array.isArray(research.findings) ? research.findings : [];

  const value = (field: string): string => {
    const found = findings.find(
      (f): f is Record<string, unknown> =>
        Boolean(f) && typeof f === "object" && (f as Record<string, unknown>).field === field,
    );
    if (!found || found.kind === "unknown") return "";
    return typeof found.value === "string" ? found.value.trim() : "";
  };

  return {
    companyName:
      typeof research.companyName === "string" && research.companyName
        ? research.companyName
        : row.name,
    /* `description` is the fallback for `sells` because the settings form
       writes that column directly and does not touch `research`. A workspace
       whose product was edited by hand still has something to draft from. */
    sells: value("sells") || (row.description ?? ""),
    buyers: value("buyers"),
    problem: value("problem"),
    trigger: value("trigger"),
    isLive: Boolean(row.research_is_live),
  };
}

/**
 * The ICP as the engine reads it, for the screens that need to show it back.
 *
 * A thin read rather than a re-export of `lib/data/icp.ts`'s loader, because
 * that one flattens to `IcpSummary` — the five lists a *prompt* takes — and
 * the onboarding screens need the full typed criteria so they can render the
 * v2 fields the prompt does not use.
 */
export async function getOnboardingIcp(orgSlug: string): Promise<Icp | null> {
  const { db } = await resolveDataSource();
  if (!db) return null;

  const viewer = await currentViewer(orgSlug);
  if (!viewer || viewer.kind !== "member") return null;

  const { data } = await db
    .from("icps")
    .select("criteria, negative_criteria")
    .eq("org_id", viewer.orgId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  try {
    return parseIcp(
      (data as { criteria: unknown }).criteria,
      (data as { negative_criteria: unknown }).negative_criteria,
    );
  } catch {
    // A profile written by something that never read the schema. Reported as
    // absent rather than thrown: the screen offers to build one, which is a
    // better outcome than a 500 on the setup flow.
    return null;
  }
}
