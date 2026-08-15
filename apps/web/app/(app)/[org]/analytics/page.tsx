import { notFound } from "next/navigation";
import {
  BreakdownList,
  Card,
  CardHeader,
  SectionLabel,
  StatCard,
  StatGrid,
} from "@huntloop/ui";
import { AlertTriangle, Coins, Gauge, Timer } from "lucide-react";
import { currentViewer } from "../../../../lib/data/membership";
import { getSpend } from "../../../../lib/data/spend";
import { SpendTable } from "./SpendTable";

/**
 * What the AI actually cost.
 *
 * ANL-02, and the reason it was worth doing early: `ai_runs` has captured
 * task, model, prompt version, input hash, tokens, cost and latency from the
 * first migration, the row is written *before* the model call — which is the
 * invariant separating a cost dashboard from a cost guess, since the expensive
 * calls are exactly the ones that fail halfway — and nothing read the table.
 *
 * Three things on this screen are not ordinary dashboard furniture:
 *
 *   **Stranded runs.** A row still reading `started` is a call that was billed
 *   and never reported an outcome. On any other dashboard that row would be
 *   missing entirely; here it is counted, because "we paid for something and
 *   don't know what happened" is the single most useful number on the page.
 *
 *   **Cache hit rate.** The system prompt is byte-identical across every
 *   company researched under one ICP, so cache reads should dominate from the
 *   second call onward. If this collapses, prompt caching has broken and the
 *   bill is about to be roughly ten times larger. It is shown rather than
 *   assumed for the same reason `estimateCostCents` models cache pricing:
 *   if caching breaks, the cost number is how you find out.
 *
 *   **No forecast.** There is deliberately no "projected monthly spend". A
 *   projection from a few days of a new tenant's usage is noise presented as a
 *   conclusion, which is the §7 failure aimed at ourselves — the same
 *   reasoning that keeps the learning phase from claiming an insight below 200
 *   outcomes. The window and the total are facts; the extrapolation would not
 *   be.
 */

const CENTS = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

/** Anthropic bills in USD; `cost_cents` is cents of that. */
const money = (cents: number) => CENTS.format(cents / 100);

const TASK_LABELS: Record<string, string> = {
  research_company: "Company research",
  recommend_sources: "Source recommendations",
  qualify_opportunity: "Qualification",
  explain_why_now: "Why now",
  extract_signals: "Signal extraction",
  personalize_message: "Message drafting",
  classify_reply: "Reply classification",
  sales_agent: "Agent conversation",
  analyze_performance: "Performance analysis",
};

const label = (task: string) => TASK_LABELS[task] ?? task;

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  /*
   * Every role sees this, including `viewer`.
   *
   * Deliberate: spend is not a write action, and an organisation that gives
   * someone read access to its prospect research has already given them the
   * more sensitive thing. Hiding the bill from the people asked to work within
   * it is how budgets get blown.
   */
  const orgId = viewer.kind === "member" ? viewer.orgId : org;
  const { data: spend } = await getSpend(orgId);


  return (
    <div className="mx-auto w-full max-w-[1600px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="text-[30px] leading-9 font-semibold text-fg">AI spend</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          Every model call this organisation has made in the last 30 days, and what
          it cost. Recorded before the call runs, so a crash still shows up here.
        </p>
      </header>

      <section className="mt-8">
        <SectionLabel>Last 30 days</SectionLabel>
        <StatGrid className="mt-3">
          <StatCard
            label="Total spend"
            value={money(spend.totalCents)}
            icon={Coins}
            tone="brand"
            hint={`${spend.runs.length} run${spend.runs.length === 1 ? "" : "s"}`}
          />
          <StatCard
            label="Cache hit rate"
            value={
              spend.cacheHitRate === null
                ? "—"
                : `${Math.round(spend.cacheHitRate * 100)}%`
            }
            icon={Gauge}
            tone={
              spend.cacheHitRate !== null && spend.cacheHitRate < 0.5 ? "warning" : "success"
            }
            hint={
              spend.cacheHitRate === null
                ? "No runs yet"
                : "Of input tokens served from cache"
            }
          />
          <StatCard
            label="Failed"
            value={spend.failedCount}
            icon={AlertTriangle}
            tone={spend.failedCount > 0 ? "danger" : "neutral"}
            hint="Reported an error"
          />
          <StatCard
            label="No outcome"
            value={spend.strandedCount}
            icon={Timer}
            tone={spend.strandedCount > 0 ? "warning" : "neutral"}
            hint="Billed, never reported back"
          />
        </StatGrid>
      </section>

      {spend.runs.length > 0 && (
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Spend by task" />
            <BreakdownList
              className="px-5 pb-4"
              items={spend.byTask.map((entry) => ({
                label: `${label(entry.task)} · ${entry.runs} run${entry.runs === 1 ? "" : "s"}`,
                value: entry.cents,
              }))}
              formatValue={money}
            />
          </Card>

          <Card>
            <CardHeader title="Spend by model" />
            <BreakdownList
              className="px-5 pb-4"
              items={spend.byModel.map((entry) => ({
                label: `${entry.model} · ${entry.runs} run${entry.runs === 1 ? "" : "s"}`,
                value: entry.cents,
              }))}
              formatValue={money}
            />
          </Card>
        </div>
      )}

      <section className="mt-10">
        <SectionLabel>Runs</SectionLabel>
        {/* Money and task labels are formatted here and handed over as plain
            maps: everything crossing into a Client Component has to be
            serialisable, and a formatter is a function. */}
        <SpendTable
          runs={spend.runs}
          now={new Date().toISOString()}
          formatMoney={Object.fromEntries(
            spend.runs.map((run) => [run.id, money(run.costCents)]),
          )}
          labelForTask={TASK_LABELS}
        />
      </section>
    </div>
  );
}

export const metadata = { title: "AI spend" };
