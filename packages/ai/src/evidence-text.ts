import type { QualificationEvidence } from "./tasks/qualify-opportunity.ts";

export const bulletList = (values: string[]) =>
  values.length ? values.map((v) => `  - ${v}`).join("\n") : "  (none given)";

/** Evidence as the model reads it. The kind leads, so a guess never reads as a fact. */
export const evidenceText = (evidence: QualificationEvidence[]) =>
  evidence.length
    ? evidence
        .map((e) => {
          const parts = [`[${e.kind.toUpperCase()}] ${e.claim}`];
          if (e.confidence) parts.push(`    confidence: ${e.confidence}`);
          if (e.sourceUrl) parts.push(`    source: ${e.sourceUrl}`);
          if (e.excerpt) parts.push(`    excerpt: ${e.excerpt}`);
          return parts.join("\n");
        })
        .join("\n\n")
    : "(no evidence on file)";
