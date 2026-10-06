import { currentViewer } from "../../../../../lib/data/membership";
import { getPerformance } from "../../../../../lib/data/performance";
import { toCsv, type CsvValue } from "../../../../../lib/csv-write";
import { PERIODS, type Period } from "../../../../../lib/performance/compute";

/**
 * Performance as CSV — every table on the screen, for the update a manager
 * asked for. GET `/{org}/performance/export?period=30d&table=segments`.
 *
 * Membership is checked here as well as by RLS underneath: a route handler is
 * not wrapped by the workspace layout's 404, and a non-member must get the same
 * answer as for a workspace that does not exist.
 */

const TABLES = ["funnel", "segments", "reasons", "stalled"] as const;
type Table = (typeof TABLES)[number];

export async function GET(request: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const period = (PERIODS as readonly string[]).includes(url.searchParams.get("period") ?? "")
    ? (url.searchParams.get("period") as Period)
    : "30d";
  const table = (TABLES as readonly string[]).includes(url.searchParams.get("table") ?? "")
    ? (url.searchParams.get("table") as Table)
    : "segments";

  const { data } = await getPerformance(org, period);
  const p = data.performance;
  const rate = (r: number | null) => (r === null ? null : Math.round(r * 1000) / 10);

  let header: string[];
  let rows: CsvValue[][];
  switch (table) {
    case "funnel":
      header = ["measure", "this period", "previous period"];
      rows = (Object.keys(p.funnel) as (keyof typeof p.funnel)[]).map((k) => [k, p.funnel[k], p.previousFunnel[k]]);
      rows.push(
        ["reply rate % (cohort)", rate(p.cohort.replyRate), rate(p.previousCohort.replyRate)],
        ["meeting rate % (cohort)", rate(p.cohort.meetingRate), rate(p.previousCohort.meetingRate)],
        ["median days to reply", p.cohort.medianDaysToReply, p.previousCohort.medianDaysToReply],
        ["median days to meeting", p.cohort.medianDaysToMeeting, p.previousCohort.medianDaysToMeeting],
        ["ai spend (cents)", p.cost.aiCents, null],
        ["provider credits", p.cost.providerCredits, null],
      );
      break;
    case "segments":
      header = ["split by", "group", "contacted", "replied", "reply rate %", "range low %", "range high %", "meetings"];
      rows = (Object.entries(p.breakdowns) as [string, typeof p.breakdowns.channel][]).flatMap(([by, segments]) =>
        segments.map((s) => [
          by,
          s.label,
          s.contacted,
          s.replied,
          rate(s.replyRate),
          s.interval ? rate(s.interval[0]) : null,
          s.interval ? rate(s.interval[1]) : null,
          s.meetings,
        ]),
      );
      break;
    case "reasons":
      header = ["kind", "reason", "count"];
      rows = [
        ...p.reasons.lost.map((t) => ["lost", t.label, t.count]),
        ...p.reasons.disqualified.map((t) => ["not a fit", t.label, t.count]),
        ...p.reasons.competitors.map((t) => ["lost to competitor", t.label, t.count]),
      ];
      break;
    case "stalled":
      header = ["company", "stage", "days without activity"];
      rows = p.stalled.map((s) => [s.company, s.stage, s.idleDays]);
      break;
  }

  return new Response(toCsv(header, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="huntloop-${org}-${table}-${period}.csv"`,
      "cache-control": "no-store",
    },
  });
}
