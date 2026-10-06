/**
 * `cluster_demand` — group what prospects said into themes. COMMAND.md §16.3-I.
 *
 * Input: statements prospects made (from replies, loss reasons and notes),
 * each with an id, and the workspace's existing themes. Output: which existing
 * theme each statement belongs to, and new themes for statements that share a
 * need — every reference closed over the ids sent, by schema and again in
 * `parse`.
 *
 * Nothing here becomes roadmap by itself. New themes are *proposals* a person
 * accepts, merges or rejects; the model never sets a status.
 */
import { definePrompt } from "../prompt.ts";
import type { LLMTask } from "../task.ts";
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from "../untrusted.ts";

export const MAX_CLUSTER_SIGNALS = 120;
export const MAX_NEW_THEMES = 12;

export type DemandKind = "request" | "objection" | "blocker";

export interface ClusterInput {
  /** What the workspace sells, one line, so "integration" means something. */
  weSell: string;
  signals: { id: string; kind: DemandKind; statement: string }[];
  themes: { id: string; title: string; kind: DemandKind }[];
}

export interface ClusterOutput {
  assignments: { signalId: string; themeId: string }[];
  newThemes: { title: string; kind: DemandKind; description: string; signalIds: string[] }[];
}

const KINDS: DemandKind[] = ["request", "objection", "blocker"];

const PROMPT = definePrompt(
  "cluster_demand",
  `
You group what prospects told a sales team into themes — the needs, objections
and blockers that keep coming up — so the team can see what to build or fix.

${UNTRUSTED_CONTENT_RULE}

## What you are given

Statements, each with an id, paraphrasing something a prospect said. And the
workspace's existing themes, each with an id.

## What to do

1. Put a statement in an existing theme when it is plainly the same need or
   objection. Different words for one need belong together ("SSO", "single
   sign-on with Okta"); a different need does not, however close the topic.
2. Propose a new theme only for two or more statements that share a need no
   existing theme covers. A single statement stays ungrouped — one mention is
   not a pattern.
3. Leave out anything you are unsure about. An ungrouped statement costs
   nothing; a wrong grouping misleads a roadmap.

A theme's title is a short noun phrase naming the need, e.g. "Salesforce
integration" or "Price too high for small teams" — not a sentence, not a
company name, no person's name. The description is one sentence saying what
the statements have in common.
`,
);

export const clusterDemand: LLMTask<ClusterInput, ClusterOutput> = {
  name: "cluster_demand",
  prompt: PROMPT,
  maxTokens: 8_000,

  schema: (input) => {
    const signalIds = input.signals.slice(0, MAX_CLUSTER_SIGNALS).map((s) => s.id);
    const themeIds = input.themes.map((t) => t.id);
    const idEnum = (ids: string[]) => ({ type: "string", enum: ids });
    return {
      type: "object",
      additionalProperties: false,
      required: ["assignments", "newThemes"],
      properties: {
        assignments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["signalId", "themeId"],
            properties: { signalId: idEnum(signalIds), themeId: idEnum(themeIds.length ? themeIds : ["none"]) },
          },
        },
        newThemes: {
          type: "array",
          maxItems: MAX_NEW_THEMES,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "kind", "description", "signalIds"],
            properties: {
              title: { type: "string" },
              kind: { type: "string", enum: KINDS },
              description: { type: "string" },
              signalIds: { type: "array", items: idEnum(signalIds), minItems: 2 },
            },
          },
        },
      },
    };
  },

  renderInput: (input) => {
    const signals = input.signals
      .slice(0, MAX_CLUSTER_SIGNALS)
      .map((s) => `[${s.id}] (${s.kind}) ${s.statement}`)
      .join("\n");
    const themes = input.themes.length
      ? input.themes.map((t) => `[${t.id}] (${t.kind}) ${t.title}`).join("\n")
      : "(none yet)";
    return [
      `We sell: ${input.weSell || "(not recorded)"}`,
      "",
      wrapUntrusted("existing themes", themes),
      "",
      /* Untrusted: paraphrases of what prospects wrote, which can contain
         anything a reply contained. */
      wrapUntrusted("statements to group", signals),
      "",
      "Use ids exactly as shown in brackets.",
    ].join("\n");
  },

  entity: () => ({ type: "organization", id: null }),

  parse: (json, input) => {
    if (!json || typeof json !== "object") throw new Error("cluster_demand: response was not an object.");
    const raw = json as Record<string, unknown>;
    const signalIds = new Set(input.signals.slice(0, MAX_CLUSTER_SIGNALS).map((s) => s.id));
    const themeIds = new Set(input.themes.map((t) => t.id));
    const used = new Set<string>();

    const assignments: ClusterOutput["assignments"] = [];
    for (const item of Array.isArray(raw.assignments) ? raw.assignments : []) {
      const a = item as Record<string, unknown>;
      const signalId = String(a?.signalId ?? "");
      const themeId = String(a?.themeId ?? "");
      if (!signalIds.has(signalId) || !themeIds.has(themeId) || used.has(signalId)) continue;
      used.add(signalId);
      assignments.push({ signalId, themeId });
    }

    const newThemes: ClusterOutput["newThemes"] = [];
    for (const item of Array.isArray(raw.newThemes) ? raw.newThemes : []) {
      const t = item as Record<string, unknown>;
      const title = typeof t?.title === "string" ? t.title.trim().replace(/\s+/g, " ").slice(0, 80) : "";
      const kind = KINDS.includes(t?.kind as DemandKind) ? (t.kind as DemandKind) : null;
      const description = typeof t?.description === "string" ? t.description.trim().slice(0, 300) : "";
      const ids = (Array.isArray(t?.signalIds) ? t.signalIds : [])
        .map(String)
        .filter((id) => signalIds.has(id) && !used.has(id));
      // One mention is not a pattern: a theme needs two statements of its own.
      if (!title || !kind || ids.length < 2) continue;
      for (const id of ids) used.add(id);
      newThemes.push({ title, kind, description, signalIds: [...new Set(ids)] });
      if (newThemes.length === MAX_NEW_THEMES) break;
    }

    return { assignments, newThemes };
  },
};
