/**
 * `recommend_sources` — given an ICP, name the places this org's future
 * customers become visible (master context §10).
 *
 * §10 gives the user three verbs — accept, remove, add — and all three are
 * review actions. That makes reviewability the design constraint rather than a
 * nicety: a list of publication names the user can only accept on faith is
 * indistinguishable from a list the model made up, and the user has no way to
 * tell which one they got.
 *
 * So every recommendation carries two things it would be easier to leave out:
 *
 *   · `why` — what this source will surface, in terms of this ICP.
 *   · `basis` — the ICP element it comes from, quoted from the ICP we sent.
 *
 * `basis` is the rule with teeth. It is constrained to a closed set built from
 * the input, so a recommendation justified by a criterion the user never wrote
 * cannot be returned — and the failure mode this catches is the specific one
 * this task invites. Asked for sources, a model will reliably produce
 * TechCrunch, Hacker News and GitHub for *any* ICP, because those are the
 * highest-prior answers to "name some sources" and they are never obviously
 * wrong. Making each one point at a segment or a trigger is what separates a
 * recommendation from a plausible list.
 *
 * This task does not fetch. It cannot: `fetchDomains` is omitted, so the model
 * has no web tool at all. That is a deliberate limitation with a visible
 * consequence — see the note on `url` below — and it is the right trade, since
 * a recommender that browses is a recommender that can be walked onto an
 * arbitrary host by a page it was reading.
 */
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { InvalidUrlError, normalizeUrl } from "../url.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";

/**
 * The `source_kind` enum from migration 0002, repeated here because a
 * recommendation that does not fit it cannot be stored.
 *
 * Keeping the two in sync by hand is a real cost. The alternative — accepting
 * free-text kinds and mapping them on insert — moves the failure from this
 * boundary, where it names the offending recommendation, to a Postgres enum
 * error during onboarding, where it does not.
 */
export const SOURCE_KINDS = [
  "news",
  "blog",
  "jobs",
  "social",
  "github",
  "funding",
  "regulatory",
  "community",
  "podcast",
  "custom",
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * The ICP, as much of it as source selection can actually use.
 *
 * `sells` comes from `research_company`. The rest is what §9 asks the user on
 * the ICP step. Exclusions are carried but are deliberately *not* a valid
 * basis — see `icpElements`.
 */
export interface IcpSummary {
  /** One sentence on what the org sells. */
  sells: string;
  segments: string[];
  sizes: string[];
  regions: string[];
  triggers: string[];
  exclusions: string[];
}

export interface SourceRecommendation {
  /** What to call it on screen. A publication, or a named category. */
  name: string;
  kind: SourceKind;
  /**
   * The site, when the model knows the address — otherwise null.
   *
   * Null is expected and common. Two different things produce it: a
   * recommendation that is a *category* ("company engineering blogs") has no
   * single address, and a specific publication whose URL the model is not sure
   * of should say so rather than guess. Since this task cannot fetch, a URL it
   * emits is recalled, not checked, and a confidently wrong address is worse
   * than none — it fails silently at scan time looking like an outage.
   */
  url: string | null;
  canonicalDomain: string | null;
  /** What this source will surface for this ICP. Never empty. */
  why: string;
  /** The ICP element this comes from, verbatim from the input. */
  basis: string;
}

/**
 * Upper bound on the list.
 *
 * Not a token limit — a review limit. Every source here is something the user
 * is being asked to approve, and a 30-item list gets accepted wholesale, which
 * is the same as not asking.
 */
export const MAX_RECOMMENDATIONS = 12;

/**
 * The ICP elements a recommendation may cite.
 *
 * Exclusions are absent on purpose. "Who is never a fit" shapes what the model
 * should *avoid* recommending, and the prompt says so, but a source justified
 * by an exclusion is incoherent — nobody watches a publication because of the
 * companies they do not want to hear about.
 */
export function icpElements(icp: IcpSummary): string[] {
  const all = [icp.sells, ...icp.segments, ...icp.sizes, ...icp.regions, ...icp.triggers]
    .map((value) => value.trim())
    .filter(Boolean);
  // Deduped because a JSON Schema enum with repeats is legal but pointless, and
  // because the user can enter the same phrase in two places.
  return [...new Set(all)];
}

const PROMPT = definePrompt(
  "recommend_sources",
  `
You are Huntloop's source scout. You are given one company's ideal customer
profile, and you name the public places where companies matching it become
visible — before they are ready to buy, not after.

${UNTRUSTED_CONTENT_RULE}

You have no web access on this task. Everything you return comes from what you
already know.

## What counts as a source

Anything public that publishes regularly and would mention a company matching
this ICP: a news publication, an industry newsletter, a funding tracker, a job
board, a subreddit or forum, a GitHub org or topic, a regulatory filing feed, a
conference programme, a podcast, or a category like "engineering blogs of
companies in this segment".

Give each one a kind from this closed list, chosen by what the source *is*:

  news        A publication with an editorial desk.
  blog        A company or individual writing about their own work.
  jobs        Job boards and postings.
  social      X, LinkedIn, and similar.
  github      Code hosting — repositories, orgs, topics, releases.
  funding     Funding and investment trackers.
  regulatory  Government filings, registers, enforcement notices.
  community   Forums, subreddits, Discords, Hacker News.
  podcast     Podcasts and recorded interviews.
  custom      A real source that is genuinely none of the above.

## The rule that matters most

Every recommendation names the one ICP element it comes from, copied exactly
from the profile you were given. If you cannot point at a specific segment,
size band, region or trigger that makes a source worth watching, do not
recommend it.

This exists to stop one particular answer. Asked to name sources, it is very
easy to produce the largest publications in the general vicinity — TechCrunch,
Hacker News, GitHub — because they are never quite wrong. They are also what
you would have said for any other ICP, which means they carry no information
about this one. A source that would appear on every customer's list is worth
less than a niche newsletter that only makes sense for this segment.

Prefer the specific over the large. If a trigger is "hiring for on-chain or
custody engineering", the source is the job boards and career pages where that
appears — not a general tech news site that will occasionally mention it.

Six sources you can each defend is a better answer than twelve where four are
filler. Return at most ${MAX_RECOMMENDATIONS}. If the profile is too thin to
support anything specific, return only what it does support, even if that is
two or three.

## Addresses

Give a url only when you are confident of the address. A category has no single
address, and a publication whose URL you are unsure of should carry null rather
than a guess — you cannot check it, and a wrong address does not fail visibly.
It fails at scan time, looking like an outage. Null is not a worse answer.

## Exclusions

The profile lists who is never a fit. Do not recommend a source whose coverage
is mostly those companies. Do not treat an exclusion as a reason *for* a source.

## Style

Write \`why\` as one plain sentence saying what this source will surface for
this ICP — "posts hiring for custody engineers, which is one of your triggers",
not "a leading industry publication". Name what shows up there, not the
source's reputation.
`,
);

export const recommendSources: LLMTask<IcpSummary, SourceRecommendation[]> = {
  name: "recommend_sources",
  prompt: PROMPT,
  // No fetching, and the output is a short list, so this only has to cover
  // adaptive thinking over the profile. Well clear of what the task needs.
  maxTokens: 16_000,

  schema: (icp) => {
    const elements = icpElements(icp);
    if (!elements.length) {
      // An enum with no members is not a valid schema and would come back as a
      // 400 with nothing useful in it. Failing here says what is actually
      // wrong: there is no profile to recommend from.
      throw new Error(
        "recommend_sources: the ICP is empty. There is nothing to recommend from.",
      );
    }
    return {
      type: "object",
      additionalProperties: false,
      required: ["sources"],
      properties: {
        sources: {
          type: "array",
          maxItems: MAX_RECOMMENDATIONS,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "kind", "url", "why", "basis"],
            properties: {
              name: { type: "string" },
              kind: { type: "string", enum: [...SOURCE_KINDS] },
              url: { anyOf: [{ type: "string" }, { type: "null" }] },
              why: { type: "string" },
              // The closed set that makes an invented justification
              // unrepresentable rather than merely detectable.
              basis: { type: "string", enum: elements },
            },
          },
        },
      },
    };
  },

  /**
   * The profile goes in the user turn, not the system prompt — it is per-call,
   * and §7.2's cache only pays if the system block stays byte-identical across
   * every org.
   *
   * It is wrapped as untrusted even though the user typed most of it, because
   * some of it did not start with them: `sells` is written by a model that read
   * a website, and the ICP step pre-fills from the same place. Text that has
   * been through a fetched page is untrusted for the rest of its life, whoever
   * has edited it since.
   */
  renderInput: (icp) => {
    const list = (values: string[]) =>
      values.length ? values.map((v) => `  - ${v}`).join("\n") : "  (none given)";

    const profile = [
      `What they sell: ${icp.sells || "(not stated)"}`,
      "",
      "Segments:",
      list(icp.segments),
      "",
      "Company sizes:",
      list(icp.sizes),
      "",
      "Regions:",
      list(icp.regions),
      "",
      "Buying triggers:",
      list(icp.triggers),
      "",
      "Never a fit:",
      list(icp.exclusions),
    ].join("\n");

    return [
      "Recommend sources for this ideal customer profile.",
      "",
      wrapUntrusted("ideal customer profile", profile),
      "",
      "Copy each `basis` exactly from the segments, sizes, regions, triggers, " +
        "or the what-they-sell line above.",
    ].join("\n");
  },

  // No fetchDomains: this task gets no web tool at all.

  entity: () => ({ type: "icp", id: null }),

  parse: (json, icp) => {
    if (!json || typeof json !== "object") {
      throw new Error("recommend_sources: response was not an object.");
    }
    const raw = (json as { sources?: unknown }).sources;
    if (!Array.isArray(raw)) {
      throw new Error("recommend_sources: response carried no sources array.");
    }
    if (raw.length > MAX_RECOMMENDATIONS) {
      throw new Error(
        `recommend_sources: ${raw.length} recommendations, more than the ` +
          `${MAX_RECOMMENDATIONS} a person will actually review.`,
      );
    }

    // Matched case- and whitespace-insensitively. The rule being enforced is
    // "this justification is one the user actually wrote", and a model that
    // recased a segment has not broken that rule.
    const allowed = new Map(
      icpElements(icp).map((element) => [normalize(element), element]),
    );
    if (!allowed.size) {
      throw new Error(
        "recommend_sources: the ICP is empty. There is nothing to recommend from.",
      );
    }

    const seen = new Set<string>();
    const sources: SourceRecommendation[] = [];

    for (const item of raw as RawRecommendation[]) {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!name) {
        throw new Error("recommend_sources: a recommendation has no name.");
      }

      const kind = item.kind;
      if (typeof kind !== "string" || !isSourceKind(kind)) {
        throw new Error(
          `recommend_sources: ${name} has an unknown kind ${JSON.stringify(kind)}. ` +
            `A kind outside source_kind cannot be stored.`,
        );
      }

      const why = typeof item.why === "string" ? item.why.trim() : "";
      if (!why) {
        // §10's accept/remove/add are review actions, and a recommendation
        // with no stated reason cannot be reviewed — only trusted.
        throw new Error(
          `recommend_sources: ${name} carries no reason. A source the user ` +
            `cannot evaluate is one they can only accept on faith.`,
        );
      }

      const basis = typeof item.basis === "string" ? item.basis.trim() : "";
      const matched = allowed.get(normalize(basis));
      if (!matched) {
        throw new Error(
          `recommend_sources: ${name} is justified by ${JSON.stringify(basis)}, ` +
            `which is not in this ICP. A recommendation that cites a criterion ` +
            `the user never wrote is not traceable to anything.`,
        );
      }

      // Normalised rather than trusted as given, so the dedupe key below and
      // the stored row agree on what "the same source" means (§59/§60).
      let url: string | null = null;
      let canonicalDomain: string | null = null;
      if (typeof item.url === "string" && item.url.trim()) {
        try {
          const normalized = normalizeUrl(item.url);
          url = normalized.url;
          canonicalDomain = normalized.canonicalDomain;
        } catch (error) {
          if (error instanceof InvalidUrlError) {
            throw new Error(
              `recommend_sources: ${name} gave ${JSON.stringify(item.url)} as its ` +
                `address, which is not one. The prompt asks for null when the ` +
                `URL is not known.`,
            );
          }
          throw error;
        }
      }

      // A source recommended twice is not a preference to be silently
      // collapsed — it means the list is shorter than it appears, and the
      // count shown on the review screen would be wrong.
      const key = canonicalDomain ?? `name:${normalize(name)}`;
      if (seen.has(key)) {
        throw new Error(`recommend_sources: ${name} was recommended twice.`);
      }
      seen.add(key);

      sources.push({ name, kind, url, canonicalDomain, why, basis: matched });
    }

    // An empty list is allowed. A profile too thin to support a specific
    // recommendation should produce nothing rather than the generic list, and
    // the sources screen already refuses to continue with none — which is the
    // honest outcome, not a broken one.
    return sources;
  },
};

interface RawRecommendation {
  name?: unknown;
  kind?: unknown;
  url?: unknown;
  why?: unknown;
  basis?: unknown;
}

function isSourceKind(value: string): value is SourceKind {
  return (SOURCE_KINDS as readonly string[]).includes(value);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
