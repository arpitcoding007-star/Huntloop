import type { PerformanceFact } from "@huntloop/ai";
import type { Performance } from "./compute";

/**
 * The Performance screen, as the closed list of facts the narrative may cite.
 *
 * Each fact is a sentence Huntloop writes from computed figures — the model
 * never sees a raw table, so it cannot misread one, and `explain_performance`
 * rejects any number in its output that these sentences do not contain.
 * Ordered by importance, so the first facts survive `MAX_FACTS`.
 */
const pct = (r: number | null) => (r === null ? "no" : `${Math.round(r * 100)}%`);

export function performanceFacts(p: Performance): PerformanceFact[] {
  const facts: string[] = [];
  const c = p.cohort;
  const prev = p.previousCohort;

  // Interpretations first: they are what a summary should lead with.
  for (const insight of p.insights) facts.push(`${insight.headline} ${insight.basis}`);
  if (c.contacted === 0) {
    facts.push(
      prev.contacted === 0
        ? "No company was first contacted in this period or the one before."
        : `No company was first contacted in this period, against ${prev.contacted} in the previous one.`,
    );
  } else {
    facts.push(
      `Reply rate: ${pct(c.replyRate)} of ${c.contacted} companies first contacted` +
        (prev.contacted ? ` (previous period ${pct(prev.replyRate)} of ${prev.contacted}).` : "."),
    );
    facts.push(`Meeting rate: ${pct(c.meetingRate)} of ${c.contacted} first contacted.`);
  }

  const f = p.funnel;
  const pf = p.previousFunnel;
  facts.push(
    `Found ${f.discovered} companies (${pf.discovered} before), ${f.qualified} rated hot or warm (${pf.qualified} before).`,
  );
  facts.push(`Meetings recorded: ${f.meetings} (${pf.meetings} before). Won: ${f.won} (${pf.won} before). Lost: ${f.lost}. Ruled out as not a fit: ${f.disqualified}.`);
  if (c.medianDaysToReply !== null) facts.push(`Median time from first touch to reply: ${Math.round(c.medianDaysToReply * 10) / 10} days.`);

  const closed = [...p.reasons.lost, ...p.reasons.disqualified].filter((t) => t.key !== "unspecified");
  if (closed.length) facts.push(`Reasons deals ended: ${closed.slice(0, 4).map((t) => `${t.label} (${t.count})`).join(", ")}.`);

  const channels = p.breakdowns.channel.filter((s) => s.contacted > 0);
  if (channels.length) {
    facts.push(
      `By first channel: ${channels.map((s) => `${s.label} ${s.replied} of ${s.contacted} replied`).join("; ")}.`,
    );
  }
  if (p.cost.perMeetingCents !== null) {
    facts.push(`Model spend was $${(p.cost.aiCents / 100).toFixed(2)}, about $${(p.cost.perMeetingCents / 100).toFixed(2)} per meeting.`);
  }

  return facts.map((text, i) => ({ id: `f${i + 1}`, text }));
}
