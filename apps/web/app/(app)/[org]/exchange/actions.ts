"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  completeness,
  mergeTurn,
  nextKeys,
  MAX_INTAKE_TEXT,
  type IntakeDirection,
  type Requirement,
} from "@huntloop/ai";
import { classify, turn } from "../../../../lib/ai/intake";
import { listExchangeCategories, type ExchangeCategory } from "../../../../lib/data/exchange";
import { fail, mutate, ok, type ActionResult, type TenantClient } from "../../../../lib/data/org";
import { isExchangeEnabled } from "../../../../lib/exchange/flag";
import type { IntakeState, NeedSubmission } from "../../../../lib/exchange/intake-state";
import {
  confirmedRequirement,
  isVisibility,
  needColumns,
  NEED_STATUSES,
} from "../../../../lib/exchange/requirement";
import { uuidSchema } from "../../../../lib/validation";
import { scoreIntent } from "../../../../lib/exchange/intent";

/**
 * Exchange writes (0060), all through the session client — RLS decides who
 * may write what, and `exchange_matches` has no write policy at all, so the
 * shortlist goes through `exchange_set_match_state`.
 *
 * Nothing here enqueues a job. `enqueue()` writes with the service role, and a
 * Server Action is a public POST endpoint (see `lib/data/engine.ts`). A new
 * need is picked up by the hourly `schedule_matching` sweeper, which matches
 * every open need that has never been matched.
 */

const CLOSED = "The Exchange is not switched on for this deployment.";
const MAX_TRANSCRIPT = 40;

function revalidate(org: string) {
  revalidatePath(`/${org}/exchange`, "layout");
}

const textSchema = z.string().trim().min(3, "Say a little more about what you need.").max(MAX_INTAKE_TEXT);

function base(over: Partial<IntakeState> & Pick<IntakeState, "summary">): IntakeState {
  return {
    sessionId: null,
    mode: "form",
    direction: "buy",
    categoryId: null,
    categoryPath: null,
    attributes: [],
    known: {},
    question: null,
    quickReplies: [],
    askKeys: [],
    ready: false,
    reason: "incomplete",
    turns: 0,
    notice: null,
    transcript: [],
    ...over,
  };
}

/** Start the questionnaire from one free-text description. */
export async function startIntakeAction(org: string, text: string): Promise<ActionResult<IntakeState>> {
  if (!isExchangeEnabled()) return fail(CLOSED);
  const parsed = textSchema.safeParse(text);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That could not be read.");
  const said = parsed.data;

  return mutate(org, "startIntake", async ({ db, orgId }) => {
    const categories = (await listExchangeCategories()).data;
    const transcript: IntakeState["transcript"] = [{ role: "user", text: said }];

    const read = await classify(org, { text: said, categories: categories.map((c) => ({ id: c.id, path: c.path })) });
    if (!read.ok) return ok(base({ summary: said, transcript, notice: `${read.error} The form below asks the same questions.` }));
    if (!read.live) {
      return ok(
        base({
          summary: said,
          transcript,
          notice: "No AI model is configured on this deployment, so the questions are a form instead of a conversation.",
        }),
      );
    }

    const { direction, categoryId, summary } = read.output;
    if (direction === "sell") return ok(base({ mode: "sell", direction, summary: summary || said, transcript }));

    const category = categoryId ? categories.find((c) => c.id === categoryId) ?? null : null;
    const { data: session, error } = await db
      .from("exchange_intake_sessions")
      .insert({ org_id: orgId, direction, category_id: category?.id ?? null, requirement: {}, transcript, turns: 0 })
      .select("id")
      .single();
    if (error || !session) return fail(`The questionnaire could not be started: ${error?.message ?? "no row"}`);

    const state = base({
      sessionId: String(session.id),
      mode: "chat",
      direction,
      summary: (summary || said).slice(0, 500),
      transcript,
    });
    if (!category) {
      return ok({
        ...state,
        question: "Which category fits best? Pick one and the questions will follow.",
      });
    }
    return ok(await step(db, org, { ...state, ...withCategory(category) }, said, []));
  });
}

function withCategory(c: ExchangeCategory): Pick<IntakeState, "categoryId" | "categoryPath" | "attributes"> {
  return { categoryId: c.id, categoryPath: c.path, attributes: c.attributes };
}

/**
 * One turn: merge what the person said (and any skips), and ask the next
 * question unless the deterministic controller says the summary is due.
 * A model failure mid-way falls back to the form with everything kept.
 */
async function step(
  db: TenantClient,
  org: string,
  state: IntakeState,
  answer: string | null,
  skipped: string[],
): Promise<IntakeState> {
  let known: Requirement = mergeTurn(state.known, [], skipped, state.attributes);
  let transcript = [...state.transcript];
  const turns = state.turns + (answer || skipped.length ? 1 : 0);
  let gate = completeness(state.attributes, known, turns);
  let question: string | null = null;
  let quickReplies: string[] = [];
  let askKeys: string[] = [];
  let notice: string | null = null;
  let mode: IntakeState["mode"] = "chat";

  if (!gate.ready || answer) {
    const asking = nextKeys(state.attributes, known);
    const out = await turn(org, {
      direction: state.direction,
      categoryName: state.categoryPath,
      summary: state.summary,
      attributes: state.attributes,
      known,
      askKeys: asking,
      profile: [],
      lastAnswer: answer,
    });
    if (out.ok && out.live) {
      known = mergeTurn(known, out.output.extracted, out.output.skipped, state.attributes);
      gate = completeness(state.attributes, known, turns);
      if (!gate.ready) {
        question = out.output.question;
        quickReplies = out.output.quickReplies;
        askKeys = nextKeys(state.attributes, known);
        transcript.push({ role: "assistant", text: question });
      }
    } else {
      mode = "form";
      notice = out.ok
        ? "No AI model is configured, so the rest is a form."
        : `${out.error} Everything you said so far is kept below.`;
    }
  }

  transcript = transcript.slice(-MAX_TRANSCRIPT);
  if (state.sessionId) {
    await db
      .from("exchange_intake_sessions")
      .update({ category_id: state.categoryId, requirement: known, transcript, turns })
      .eq("id", state.sessionId);
  }
  return { ...state, mode, known, transcript, turns, question, quickReplies, askKeys, ready: gate.ready, reason: gate.reason, notice };
}

const answerSchema = z.object({
  sessionId: uuidSchema,
  answer: z.string().trim().max(2_000).optional(),
  skip: z.boolean().optional(),
  categoryId: uuidSchema.optional(),
});

/** Answer the current question, skip it, or (first) choose the category. */
export async function answerIntakeAction(
  org: string,
  input: { sessionId: string; answer?: string; skip?: boolean; categoryId?: string },
): Promise<ActionResult<IntakeState>> {
  if (!isExchangeEnabled()) return fail(CLOSED);
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That answer could not be read.");
  const { sessionId, answer, skip, categoryId } = parsed.data;

  return mutate(org, "answerIntake", async ({ db }) => {
    const { data: s, error } = await db
      .from("exchange_intake_sessions")
      .select("id, direction, category_id, requirement, transcript, turns, status")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) return fail(`That questionnaire could not be read: ${error.message}`);
    if (!s || s.status !== "active") return fail("That questionnaire has finished. Start a new request.");

    const categories = (await listExchangeCategories()).data;
    const chosen = categories.find((c) => c.id === (categoryId ?? s.category_id));
    if (!chosen) return fail("Choose a category first.");

    const transcript = (Array.isArray(s.transcript) ? s.transcript : []) as IntakeState["transcript"];
    const summary = transcript.find((t) => t.role === "user")?.text ?? "";
    const state = base({
      sessionId,
      mode: "chat",
      direction: s.direction as IntakeDirection,
      summary: summary.slice(0, 500),
      known: (s.requirement ?? {}) as Requirement,
      turns: Number(s.turns ?? 0),
      transcript,
      ...withCategory(chosen),
    });

    const said = answer?.trim() || null;
    if (said) state.transcript = [...transcript, { role: "user", text: said }];
    const skipped = skip ? nextKeys(state.attributes, state.known) : [];
    if (skip) state.transcript = [...state.transcript, { role: "user", text: "Skip" }];
    /* Choosing the category is not an answer: ask the first question about it,
       reading what was already said in the opening description. */
    const lastAnswer = said ?? (categoryId && !s.category_id ? summary : null);
    return ok(await step(db, org, state, lastAnswer, skipped));
  });
}

const submissionSchema = z.object({
  sessionId: uuidSchema.nullable(),
  kind: z.enum(["buy", "partner"]),
  summary: z.string().trim().min(3, "Describe the request in a few words.").max(500),
  categoryId: uuidSchema.nullable(),
  fields: z.record(z.string(), z.string().max(300)),
  country: z.string().regex(/^[A-Z]{2}$/).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  budgetMax: z.number().nonnegative().finite().nullable(),
  visibility: z.number().int(),
});

/** File the request as the person confirmed it on the summary card. */
export async function submitNeedAction(org: string, input: NeedSubmission): Promise<ActionResult<{ needId: string }>> {
  if (!isExchangeEnabled()) return fail(CLOSED);
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That request could not be read.");
  const v = parsed.data;
  if (!isVisibility(v.visibility)) return fail("Choose who may see this request.");
  if (v.budgetMax !== null && !v.currency) return fail("A budget needs a currency.");

  return mutate(org, "submitNeed", async ({ db, orgId }) => {
    const categories = (await listExchangeCategories()).data;
    const category = v.categoryId ? categories.find((c) => c.id === v.categoryId) : undefined;
    if (v.categoryId && !category) return fail("That category is no longer offered.");

    const requirement = confirmedRequirement(category?.attributes ?? [], v.fields);
    const columns = needColumns(requirement, {
      country: v.country,
      currency: v.currency,
      budgetMax: v.budgetMax,
      visibility: v.visibility as 0 | 1 | 2 | 3,
    });

    const intent = scoreIntent(category?.attributes ?? [], requirement, columns);
    const { data, error } = await db
      .from("exchange_needs")
      .insert({
        org_id: orgId,
        kind: v.kind,
        category_id: category?.id ?? null,
        summary: v.summary,
        requirement,
        ...columns,
        intent_dimensions: intent.dimensions,
        intent_band: intent.band,
        status: "open",
      })
      .select("id")
      .single();
    if (error || !data) return fail(`The request could not be saved: ${error?.message ?? "no row"}`);
    const needId = String(data.id);

    if (v.sessionId) {
      await db
        .from("exchange_intake_sessions")
        .update({ status: "completed", need_id: needId, requirement })
        .eq("id", v.sessionId);
    }
    revalidate(org);
    const when = category?.matchingEnabled
      ? "Suppliers are matched within the hour."
      : "Matching is not open for this category yet; the request is saved and counted.";
    return ok({ needId }, `Request saved. ${when}`);
  });
}

/** Shortlist or dismiss a match — the one thing a buyer may change on one. */
export async function setMatchStateAction(
  org: string,
  matchId: string,
  state: "new" | "shortlisted" | "dismissed",
): Promise<ActionResult<undefined>> {
  if (!isExchangeEnabled()) return fail(CLOSED);
  const id = uuidSchema.safeParse(matchId);
  if (!id.success) return fail("That match reference isn't valid.");
  if (!["new", "shortlisted", "dismissed"].includes(state)) return fail("That isn't a state a match can have.");

  return mutate(org, "setMatchState", async ({ db }) => {
    const { error } = await db.rpc("exchange_set_match_state", { p_match: id.data, p_state: state });
    if (error) return fail(`That could not be changed: ${error.message}`);
    revalidate(org);
    return ok(undefined, state === "shortlisted" ? "Shortlisted." : state === "dismissed" ? "Dismissed." : "Restored.");
  });
}

/** Change who may see a request, or its status. */
export async function updateNeedAction(
  org: string,
  needId: string,
  change: { visibility?: number; status?: string },
): Promise<ActionResult<undefined>> {
  if (!isExchangeEnabled()) return fail(CLOSED);
  const id = uuidSchema.safeParse(needId);
  if (!id.success) return fail("That request reference isn't valid.");
  const patch: Record<string, unknown> = {};
  if (change.visibility !== undefined) {
    if (!isVisibility(change.visibility)) return fail("That isn't a visibility level.");
    patch.visibility = change.visibility;
  }
  if (change.status !== undefined) {
    const s = NEED_STATUSES.find((x) => x === change.status);
    if (!s) return fail("That isn't a status a request can have.");
    patch.status = s;
    if (s === "open") patch.last_confirmed_at = new Date().toISOString();
  }
  if (!Object.keys(patch).length) return fail("Nothing to change.");

  return mutate(org, "updateNeed", async ({ db, orgId }) => {
    const { data, error } = await db
      .from("exchange_needs")
      .update(patch)
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) return fail(`That could not be changed: ${error.message}`);
    if (!data) return fail("That request no longer exists.");
    revalidate(org);
    return ok(undefined, "Saved.");
  });
}

/** Remove a request. Its matches go with it; nothing about it was ever shared beyond its visibility. */
export async function deleteNeedAction(org: string, needId: string): Promise<ActionResult<undefined>> {
  if (!isExchangeEnabled()) return fail(CLOSED);
  const id = uuidSchema.safeParse(needId);
  if (!id.success) return fail("That request reference isn't valid.");

  return mutate(org, "deleteNeed", async ({ db, orgId }) => {
    const { error } = await db
      .from("exchange_needs")
      .update({ deleted_at: new Date().toISOString(), status: "withdrawn", visibility: 0 })
      .eq("id", id.data)
      .eq("org_id", orgId);
    if (error) return fail(`That request could not be removed: ${error.message}`);
    revalidate(org);
    return ok(undefined, "Request removed.");
  });
}

/** Delete this person's questionnaire transcripts. The requests they filed stay. */
export async function deleteMyIntakeSessionsAction(org: string): Promise<ActionResult<undefined>> {
  if (!isExchangeEnabled()) return fail(CLOSED);
  return mutate(
    org,
    "deleteMyIntakeSessions",
    async ({ db, orgId }) => {
      const { error } = await db.from("exchange_intake_sessions").delete().eq("org_id", orgId);
      if (error) return fail(`The transcripts could not be deleted: ${error.message}`);
      revalidate(org);
      return ok(undefined, "Your questionnaire transcripts are deleted.");
    },
    { minRole: "viewer" },
  );
}

/* ── Supplier side ─────────────────────────────────────────────────────── */

const blank = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

const profileSchema = z.object({
  name: z.string().trim().min(1, "Give the profile a name.").max(200),
  kind: z.enum(["company", "individual"]),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((d) => d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, ""))
    .pipe(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "That doesn't look like a domain, e.g. example.com."))
    .nullable(),
  description: z.string().trim().max(2_000).nullable(),
  country: z.string().regex(/^[A-Z]{2}$/).nullable(),
});

/** Create or update this workspace's supplier profile. Admins only (0060). */
export async function saveProviderProfileAction(org: string, form: FormData): Promise<ActionResult<undefined>> {
  if (!isExchangeEnabled()) return fail(CLOSED);
  const parsed = profileSchema.safeParse({
    name: blank(form.get("name")) ?? "",
    kind: blank(form.get("kind")) ?? "company",
    domain: blank(form.get("domain")),
    description: blank(form.get("description")),
    country: blank(form.get("country")),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That profile could not be read.");
  const profileId = blank(form.get("id"));

  return mutate(
    org,
    "saveProviderProfile",
    async ({ db, orgId }) => {
      if (profileId) {
        const { error } = await db
          .from("exchange_provider_profiles")
          .update(parsed.data)
          .eq("id", profileId)
          .eq("org_id", orgId);
        if (error) return fail(`The profile could not be saved: ${error.message}`);
      } else {
        const { error } = await db.from("exchange_provider_profiles").insert({
          ...parsed.data,
          org_id: orgId,
          source: "claimed",
          claimed_at: new Date().toISOString(),
        });
        if (error) return fail(`The profile could not be created: ${error.message}`);
      }
      revalidate(org);
      return ok(undefined, "Supplier profile saved.");
    },
    { minRole: "admin" },
  );
}

const AVAILABILITY = ["in_stock", "made_to_order", "available", "limited", "unavailable"] as const;
const PRICE_MODELS = ["fixed", "range", "quote", "subscription", "hourly"] as const;

/** A number typed into a form: blank is null, commas are ignored, anything else is refused. */
const money = z
  .string()
  .nullable()
  .transform((s, ctx) => {
    if (s === null) return null;
    const n = Number(s.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: "custom", message: "Prices and quantities are plain non-negative numbers." });
      return z.NEVER;
    }
    return n;
  });

const offeringSchema = z
  .object({
    title: z.string().trim().min(1, "Give the offering a title.").max(200),
    description: z.string().trim().max(4_000).nullable(),
    category_id: uuidSchema.nullable(),
    price_model: z.enum(PRICE_MODELS).nullable(),
    price_from: money,
    price_to: money,
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    moq: money,
    availability: z.enum(AVAILABILITY).nullable(),
    serves_global: z.boolean(),
    serves_countries: z.array(z.string().regex(/^[A-Z]{2}$/, "Countries are two-letter codes, e.g. DE, US.")).max(250),
    status: z.enum(["draft", "active", "paused"]),
    product_id: uuidSchema.nullable(),
  })
  .refine((o) => o.price_from === null || o.price_to === null || o.price_from <= o.price_to, {
    message: "The lowest price is above the highest.",
  })
  .refine((o) => (o.price_from === null && o.price_to === null) || o.currency !== null, {
    message: "A price needs a currency.",
  })
  .refine((o) => o.moq === null || o.moq > 0, { message: "A minimum order must be above zero." });

/** Create or update one offering. Members may list; the provider profile must exist. */
export async function saveOfferingAction(org: string, form: FormData): Promise<ActionResult<undefined>> {
  if (!isExchangeEnabled()) return fail(CLOSED);
  const parsed = offeringSchema.safeParse({
    title: blank(form.get("title")) ?? "",
    description: blank(form.get("description")),
    category_id: blank(form.get("category_id")),
    price_model: blank(form.get("price_model")),
    price_from: blank(form.get("price_from")),
    price_to: blank(form.get("price_to")),
    currency: blank(form.get("currency")),
    moq: blank(form.get("moq")),
    availability: blank(form.get("availability")),
    serves_global: form.get("serves_global") === "on",
    serves_countries: (blank(form.get("serves_countries")) ?? "")
      .toUpperCase()
      .split(/[\s,]+/)
      .filter(Boolean),
    status: blank(form.get("status")) ?? "draft",
    product_id: blank(form.get("product_id")),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That offering could not be read.");
  const offeringId = blank(form.get("id"));
  const row = {
    ...parsed.data,
    // Stated availability carries the date it was stated (0060); matching ignores it after 30 days.
    availability_as_of: parsed.data.availability ? new Date().toISOString() : null,
  };

  return mutate(org, "saveOffering", async ({ db, orgId }) => {
    const { data: profile } = await db
      .from("exchange_provider_profiles")
      .select("id")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (!profile) return fail("Create the supplier profile first; every offering belongs to one.");

    if (offeringId) {
      const { error } = await db.from("exchange_offerings").update(row).eq("id", offeringId).eq("org_id", orgId);
      if (error) return fail(`The offering could not be saved: ${error.message}`);
    } else {
      const { error } = await db.from("exchange_offerings").insert({ ...row, provider_id: profile.id });
      if (error) return fail(`The offering could not be created: ${error.message}`);
    }
    revalidate(org);
    return ok(undefined, row.status === "active" ? "Offering saved and listed." : "Offering saved.");
  });
}

/** Remove an offering from the Exchange. Its matches go with it. */
export async function deleteOfferingAction(org: string, offeringId: string): Promise<ActionResult<undefined>> {
  if (!isExchangeEnabled()) return fail(CLOSED);
  const id = uuidSchema.safeParse(offeringId);
  if (!id.success) return fail("That offering reference isn't valid.");
  return mutate(org, "deleteOffering", async ({ db, orgId }) => {
    const { error } = await db
      .from("exchange_offerings")
      .update({ deleted_at: new Date().toISOString(), status: "paused" })
      .eq("id", id.data)
      .eq("org_id", orgId);
    if (error) return fail(`The offering could not be removed: ${error.message}`);
    revalidate(org);
    return ok(undefined, "Offering removed.");
  });
}

/** "Still needed": reopens a paused request and dates the confirmation (DN-63). */
export async function reconfirmNeedAction(org: string, needId: string): Promise<ActionResult<undefined>> {
  if (!isExchangeEnabled()) return fail(CLOSED);
  const id = uuidSchema.safeParse(needId);
  if (!id.success) return fail("That request reference isn't valid.");
  return mutate(org, "reconfirmNeed", async ({ db, orgId }) => {
    const { data, error } = await db
      .from("exchange_needs")
      .update({ status: "open", last_confirmed_at: new Date().toISOString() })
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("status", ["open", "paused", "expired"])
      .select("id")
      .maybeSingle();
    if (error) return fail(`That could not be confirmed: ${error.message}`);
    if (!data) return fail("That request can no longer be reopened.");
    revalidate(org);
    return ok(undefined, "Confirmed — suppliers see it as current.");
  });
}

const evidenceSchema = z
  .object({
    offering_id: uuidSchema,
    claim: z.string().trim().min(3, "Say what the page shows.").max(500),
    kind: z.enum(["fact", "inference"]),
    source_url: z
      .string()
      .trim()
      .max(2048)
      .regex(/^https?:\/\//, "A source is a web address starting with https://")
      .nullable(),
    source_title: z.string().trim().max(200).nullable(),
  })
  .refine((e) => e.kind !== "fact" || e.source_url !== null, {
    message: "A fact needs the page that shows it. Without one, save it as a claim.",
  });

/** Add public proof behind an offering (DN-26): an authorised-partner page, a price list. */
export async function addEvidenceAction(org: string, form: FormData): Promise<ActionResult<undefined>> {
  if (!isExchangeEnabled()) return fail(CLOSED);
  const parsed = evidenceSchema.safeParse({
    offering_id: blank(form.get("offering_id")) ?? "",
    claim: blank(form.get("claim")) ?? "",
    kind: blank(form.get("kind")) ?? "fact",
    source_url: blank(form.get("source_url")),
    source_title: blank(form.get("source_title")),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That evidence could not be read.");
  return mutate(org, "addEvidence", async ({ db }) => {
    const { error } = await db.from("exchange_offering_evidence").insert(parsed.data);
    if (error) return fail(`The evidence could not be saved: ${error.message}`);
    revalidate(org);
    return ok(undefined, "Evidence added. Matching reads it on the next run.");
  });
}

export async function deleteEvidenceAction(org: string, evidenceId: string): Promise<ActionResult<undefined>> {
  if (!isExchangeEnabled()) return fail(CLOSED);
  const id = uuidSchema.safeParse(evidenceId);
  if (!id.success) return fail("That evidence reference isn't valid.");
  return mutate(org, "deleteEvidence", async ({ db, orgId }) => {
    const { error } = await db.from("exchange_offering_evidence").delete().eq("id", id.data).eq("org_id", orgId);
    if (error) return fail(`The evidence could not be removed: ${error.message}`);
    revalidate(org);
    return ok(undefined, "Evidence removed.");
  });
}

/**
 * Everything the Exchange holds about this workspace as a buyer (DN-69):
 * requests as confirmed, their matches, this person's questionnaire
 * transcripts, and who has seen each request. Read through the session, so
 * it is exactly what RLS lets this person read.
 */
export async function exportExchangeDataAction(org: string): Promise<ActionResult<{ json: string }>> {
  if (!isExchangeEnabled()) return fail(CLOSED);
  return mutate(
    org,
    "exportExchangeData",
    async ({ db, orgId }) => {
      const [needs, matches, sessions, reveals] = await Promise.all([
        db
          .from("exchange_needs")
          .select(
            "id, kind, summary, requirement, quantity, unit, budget_max, currency, country, deliver_to, timeline, " +
              "visibility, status, intent_band, intent_dimensions, created_at, last_confirmed_at, deleted_at",
          )
          .eq("org_id", orgId),
        db.from("exchange_matches").select("need_id, score, dimensions, explanation, buyer_state, computed_at").eq("org_id", orgId),
        db.from("exchange_intake_sessions").select("id, direction, requirement, transcript, turns, status, created_at, updated_at").eq("org_id", orgId),
        db.from("exchange_reveal_log").select("need_id, viewer_name, level, what, day, views, first_seen_at, last_seen_at").eq("org_id", orgId),
      ]);
      const failed = [needs, matches, sessions, reveals].find((r) => r.error);
      if (failed?.error) return fail(`The export could not be read: ${failed.error.message}`);
      const json = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          requests: needs.data ?? [],
          matches: matches.data ?? [],
          questionnaireTranscripts: sessions.data ?? [],
          whoHasSeenYourRequests: reveals.data ?? [],
        },
        null,
        2,
      );
      return ok({ json }, "Export ready.");
    },
    { minRole: "viewer" },
  );
}
