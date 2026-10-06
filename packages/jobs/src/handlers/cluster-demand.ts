/**
 * `cluster_demand` — group a workspace's unthemed demand signals (0042).
 *
 * Reads the statements nobody has grouped yet and the existing themes, asks
 * `cluster_demand` to assign or propose, and writes the result: assignments
 * to existing themes, and new themes as *proposed* — a person accepts, merges
 * or rejects them on the Demand screen. Every considered signal is marked
 * clustered, so a rejected proposal is not proposed again until new
 * statements arrive.
 */
import { clusterDemand, MAX_CLUSTER_SIGNALS } from "@huntloop/ai";
import { AiUnavailable, runForOrg } from "../ai.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

/** Fewer than this many new statements is not worth a call. */
export const MIN_SIGNALS = 3;

export async function clusterDemandJob(ctx: JobContext): Promise<JobOutcome> {
  const { scope, now } = ctx;

  const { data: signals, error } = await scope
    .select("demand_signals", "id, kind, statement")
    .is("clustered_at", null)
    .is("theme_id", null)
    .order("created_at", { ascending: true })
    .limit(MAX_CLUSTER_SIGNALS);
  if (error) return { ok: false, error: `cluster_demand: ${error.message}` };

  const rows = (signals ?? []) as { id: string; kind: "request" | "objection" | "blocker"; statement: string }[];
  const finish = async () =>
    scope.upsert(
      "demand_state",
      { last_clustered_at: now.toISOString(), requested_at: null },
      { onConflict: "org_id" },
    );

  if (rows.length < MIN_SIGNALS) {
    await finish();
    return { ok: true, result: { skipped: `only ${rows.length} new statement(s)` } };
  }

  const [{ data: themes }, { data: product }] = await Promise.all([
    scope
      .select("demand_themes", "id, title, kind")
      .in("status", ["proposed", "open", "planned", "shipped", "wont"])
      .order("updated_at", { ascending: false })
      .limit(80),
    scope
      .select("products", "description, name")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  let output;
  try {
    const run = await runForOrg(scope, clusterDemand, {
      weSell: String(product?.description ?? product?.name ?? ""),
      signals: rows.map((r) => ({ id: String(r.id), kind: r.kind, statement: String(r.statement) })),
      themes: ((themes ?? []) as { id: string; title: string; kind: "request" | "objection" | "blocker" }[]).map((t) => ({
        id: String(t.id),
        title: String(t.title),
        kind: t.kind,
      })),
    });
    output = run.output;
  } catch (e) {
    if (e instanceof AiUnavailable) return { ok: true, result: { skipped: e.message } };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  for (const a of output.assignments) {
    await scope.update("demand_signals", { theme_id: a.themeId }).eq("id", a.signalId);
  }

  let proposed = 0;
  for (const theme of output.newThemes) {
    const { data: created } = await scope
      .insert("demand_themes", {
        title: theme.title,
        kind: theme.kind,
        description: theme.description || null,
        status: "proposed",
        origin: "model",
      })
      .select("id")
      .single();
    if (!created?.id) continue;
    await scope.update("demand_signals", { theme_id: String(created.id) }).in("id", theme.signalIds);
    proposed++;
  }

  await scope
    .update("demand_signals", { clustered_at: now.toISOString() })
    .in("id", rows.map((r) => String(r.id)));
  await finish();

  return {
    ok: true,
    result: { considered: rows.length, assigned: output.assignments.length, proposed },
  };
}
