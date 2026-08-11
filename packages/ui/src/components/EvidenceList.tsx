import { ExternalLink } from "lucide-react";
import { cn } from "../utils/cn";
import { ClaimBadge, type ClaimKind, type Confidence } from "./ClaimBadge";
import { Freshness } from "./Freshness";

/**
 * Master context §52 — the evidence record behind an intelligence claim, so
 * the AI agent can answer "why do you think this?" with a source instead of
 * unsupported reasoning. Field names track §52 one-for-one on purpose; when
 * the `evidence` table lands, a row should map onto this prop without a
 * translation layer in between.
 */
export interface EvidenceItem {
  /** The assertion being made, in the product's own words. */
  claim: string;
  kind: ClaimKind;
  confidence?: Confidence;
  /** Publication or platform, e.g. "TechCrunch", "GitHub", "Careers page". */
  source?: string;
  sourceUrl?: string;
  /** When the thing happened. Drives freshness. */
  eventDate?: Date | string;
  /** When Huntloop saw it. Not the same as eventDate and shown separately. */
  observedAt?: Date | string;
  /** Verbatim excerpt supporting the claim — quoted, never paraphrased. */
  excerpt?: string;
}

export interface EvidenceListProps {
  items: EvidenceItem[];
  /** Server clock, forwarded to Freshness. See FreshnessProps.now. */
  now?: Date | string;
  className?: string;
}

function formatDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  // ISO, sliced — not `toLocaleDateString("en-CA")`. That also yields
  // YYYY-MM-DD, but renders in the *runtime's* timezone: a server on UTC and
  // a reader on UTC-5 disagree about which day an evidence timestamp fell on,
  // which is both a hydration mismatch and, on a provenance record, wrong.
  return d.toISOString().slice(0, 10);
}

export function EvidenceList({ items, now, className }: EvidenceListProps) {
  if (items.length === 0) {
    // §78 "No strong signals" — an empty evidence list is a real answer and
    // says so, rather than rendering nothing and implying the claim stands.
    return (
      <p className={cn("text-[13px] text-fg-muted", className)}>
        No evidence on file. Nothing here is established.
      </p>
    );
  }

  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {items.map((item, i) => (
        <li
          key={`${item.claim}-${i}`}
          className="rounded-md border border-line-subtle bg-surface p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <ClaimBadge kind={item.kind} confidence={item.confidence} />
            {item.eventDate && <Freshness date={item.eventDate} now={now} />}
          </div>

          <p className="mt-2 text-[13px] leading-[1.5] text-fg">{item.claim}</p>

          {item.excerpt && (
            <blockquote className="mt-2 border-l-2 border-line pl-3 text-[12px] leading-[1.5] text-fg-secondary italic">
              {item.excerpt}
            </blockquote>
          )}

          {(item.source || item.observedAt) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-muted">
              {item.source &&
                (item.sourceUrl ? (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    // Source URLs are third-party by definition; never hand
                    // them a window.opener handle back into the app.
                    rel="noopener noreferrer nofollow"
                    className="hl-focusable inline-flex items-center gap-1 rounded-sm text-fg-secondary underline decoration-line-strong underline-offset-2 transition-colors duration-[120ms] hover:text-fg"
                  >
                    {item.source}
                    <ExternalLink className="size-3" strokeWidth={1.75} />
                  </a>
                ) : (
                  <span>{item.source}</span>
                ))}
              {item.observedAt && (
                <span className="hl-tabular">
                  Observed {formatDate(item.observedAt)}
                </span>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
