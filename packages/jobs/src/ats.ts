/**
 * Hiring signals from a company's own job board (P2-5).
 *
 * Apollo's job postings need a paid key and a provider id, and lag the
 * source. Most companies publish openings through one of four applicant
 * tracking systems, each with a public, unauthenticated JSON endpoint — so a
 * link from the company's own site to its board is a fresher, free, citable
 * source. Every posting keeps the board's own URL as its citation.
 *
 * Pure parsing here; the fetching (through the SSRF-guarded `fetchPage`) is in
 * `fetch_company_signals`.
 */

export type AtsKind = "greenhouse" | "lever" | "ashby" | "workable";

export interface AtsBoard {
  kind: AtsKind;
  slug: string;
}

export interface AtsPosting {
  id: string;
  title: string;
  url: string;
  location: string | null;
  department: string | null;
  postedAt: string | null;
}

const BOARD_PATTERNS: { kind: AtsKind; pattern: RegExp }[] = [
  { kind: "greenhouse", pattern: /https?:\/\/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([A-Za-z0-9_-]+)/g },
  { kind: "lever", pattern: /https?:\/\/jobs(?:\.eu)?\.lever\.co\/([A-Za-z0-9_.-]+)/g },
  { kind: "ashby", pattern: /https?:\/\/jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/g },
  { kind: "workable", pattern: /https?:\/\/apply\.workable\.com\/([A-Za-z0-9_-]+)/g },
];

/* Paths on the board hosts that are not a company's board. */
const NOT_A_SLUG = new Set(["embed", "api", "v1", "j", "jobs", "careers", "static", "assets"]);

/** Every distinct board the page links to. */
export function findAtsBoards(html: string): AtsBoard[] {
  const seen = new Map<string, AtsBoard>();
  for (const { kind, pattern } of BOARD_PATTERNS) {
    for (const match of html.matchAll(pattern)) {
      const slug = decodeURIComponent(match[1] ?? "").toLowerCase();
      if (!slug || NOT_A_SLUG.has(slug)) continue;
      seen.set(`${kind}:${slug}`, { kind, slug });
    }
  }
  return [...seen.values()];
}

/** The board's public JSON endpoint. */
export function atsApiUrl(board: AtsBoard): string {
  const slug = encodeURIComponent(board.slug);
  switch (board.kind) {
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
    case "lever":
      return `https://api.lever.co/v0/postings/${slug}?mode=json`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
    case "workable":
      return `https://apply.workable.com/api/v1/widget/accounts/${slug}`;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const date = (v: unknown): string | null => {
  if (typeof v === "number") return new Date(v).toISOString();
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** The board's JSON, normalised. Unknown shapes produce no postings rather than an error. */
export function parseAtsPostings(kind: AtsKind, body: unknown): AtsPosting[] {
  const out: AtsPosting[] = [];
  const push = (p: Partial<AtsPosting>) => {
    if (p.id && p.title && p.url) {
      out.push({ id: p.id, title: p.title, url: p.url, location: p.location ?? null, department: p.department ?? null, postedAt: p.postedAt ?? null });
    }
  };
  const obj = (body ?? {}) as Record<string, unknown>;

  switch (kind) {
    case "greenhouse":
      for (const j of (Array.isArray(obj.jobs) ? obj.jobs : []) as Record<string, unknown>[]) {
        push({
          id: String(j.id ?? ""),
          title: str(j.title) ?? undefined,
          url: str(j.absolute_url) ?? undefined,
          location: str((j.location as Record<string, unknown> | undefined)?.name),
          department: str(((j.departments as Record<string, unknown>[] | undefined) ?? [])[0]?.name),
          postedAt: date(j.first_published ?? j.updated_at),
        });
      }
      break;
    case "lever":
      for (const j of (Array.isArray(body) ? body : []) as Record<string, unknown>[]) {
        const cat = (j.categories ?? {}) as Record<string, unknown>;
        push({
          id: String(j.id ?? ""),
          title: str(j.text) ?? undefined,
          url: str(j.hostedUrl) ?? undefined,
          location: str(cat.location),
          department: str(cat.department) ?? str(cat.team),
          postedAt: date(j.createdAt),
        });
      }
      break;
    case "ashby":
      for (const j of (Array.isArray(obj.jobs) ? obj.jobs : []) as Record<string, unknown>[]) {
        if (j.isListed === false) continue;
        push({
          id: String(j.id ?? ""),
          title: str(j.title) ?? undefined,
          url: str(j.jobUrl) ?? undefined,
          location: str(j.location),
          department: str(j.department) ?? str(j.team),
          postedAt: date(j.publishedAt),
        });
      }
      break;
    case "workable":
      for (const j of (Array.isArray(obj.jobs) ? obj.jobs : []) as Record<string, unknown>[]) {
        const where = [str(j.city), str(j.country)].filter(Boolean).join(", ");
        push({
          id: String(j.shortcode ?? j.id ?? ""),
          title: str(j.title) ?? undefined,
          url: str(j.url) ?? str(j.application_url) ?? undefined,
          location: where || null,
          department: str(j.department),
          postedAt: date(j.published_on ?? j.created_at),
        });
      }
      break;
  }
  return out;
}

/** Where a company's job-board link is usually found, in the order worth trying. */
export function careersPages(domain: string): string[] {
  return [`https://${domain}/careers`, `https://${domain}/jobs`, `https://${domain}/`];
}
