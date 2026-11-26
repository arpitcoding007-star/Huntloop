import { Flame, Gauge, ScanSearch, Search, Telescope } from "lucide-react";
import type { JumpToItem } from "@huntloop/ui";

/**
 * Verbs for the jump-to palette (UX-15).
 *
 * The original finding: a dozen of the product's verbs (analyze a URL, filter
 * to Hot, find a company) had no shortcut, and a palette could host them. Each
 * verb here is a link to a screen that already accepts the input as a query
 * parameter, so a verb can never drift from the screen it opens and needs no
 * server action of its own.
 *
 * ── Why nothing here spends ─────────────────────────────────────────────
 *
 * "Analyze acme.com" opens Analyze with the address filled in and waits for
 * a click. Analyze would start a run on `?run=1` from a same-origin link
 * (PANEL-216), and a palette is a place people press Enter quickly. A model
 * call that costs money is not one keystroke away from a typo.
 */

const MAX_QUERY = 200;

/** A bare domain or a URL, with no spaces: what someone pastes to analyze. */
export function looksLikeUrl(query: string): boolean {
  const q = query.trim();
  if (!q || /\s/.test(q) || q.length > 2048) return false;
  return /^(https?:\/\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(q);
}

/** Verbs that need no input, offered when the query names them. */
const STANDING: { label: string; path: string; words: string[]; icon: JumpToItem["icon"] }[] = [
  { label: "Show hot opportunities", path: "opportunities?priority=hot", words: ["hot", "priority", "opportunities", "show"], icon: Flame },
  { label: "Show warm opportunities", path: "opportunities?priority=warm", words: ["warm", "priority", "opportunities", "show"], icon: Gauge },
  { label: "Show watch-list opportunities", path: "opportunities?priority=watch", words: ["watch", "watch-list", "priority", "opportunities", "show"], icon: Telescope },
];

export function paletteActions(org: string, query: string): JumpToItem[] {
  const q = query.trim().slice(0, MAX_QUERY);
  if (q.length < 2) return [];
  const base = `/${encodeURIComponent(org)}`;
  const out: JumpToItem[] = [];

  if (looksLikeUrl(q)) {
    out.push({
      label: `Analyze ${q}`,
      href: `${base}/analyze?url=${encodeURIComponent(q)}`,
      group: "Action",
      icon: ScanSearch,
    });
  }

  out.push({
    label: `Opportunities at “${q}”`,
    href: `${base}/opportunities?company=${encodeURIComponent(q)}`,
    group: "Action",
    icon: Search,
  });

  const lower = q.toLowerCase();
  for (const verb of STANDING) {
    if (verb.words.some((w) => w.startsWith(lower)) || verb.label.toLowerCase().includes(lower)) {
      out.push({ label: verb.label, href: `${base}/${verb.path}`, group: "Action", icon: verb.icon });
    }
  }
  return out;
}
