import { cn } from "../utils/cn";

/**
 * Master context §7 — the distinction Huntloop is not allowed to blur:
 *
 *   FACT       observed at a source, with a URL behind it
 *   INFERENCE  a model's conclusion from those facts
 *   UNKNOWN    not established — and saying so is a valid answer
 *
 * "HuntLoop must never silently convert an inference into a fact." A UI that
 * renders both as plain prose is exactly that silent conversion, so every
 * intelligence claim on a company or opportunity page carries one of these.
 */
export type ClaimKind = "fact" | "inference" | "unknown";

/** §52 — confidence travels with the claim, never as a bare percentage. */
export type Confidence = "high" | "medium" | "low";

export interface ClaimBadgeProps {
  kind: ClaimKind;
  confidence?: Confidence;
  size?: "sm" | "md";
  className?: string;
}

/* Colour follows the token rule rather than a new palette: green = observed
   system state, violet = a model produced this, gray = nothing on file. */
const STYLES: Record<ClaimKind, string> = {
  fact: "bg-success-surface border-success-border text-brand-text",
  inference: "bg-ai-surface border-ai-border text-ai-text",
  unknown: "bg-surface-active border-line text-fg-muted",
};

const MEANING: Record<ClaimKind, string> = {
  fact: "Fact — observed at a cited source",
  inference: "Inference — concluded by a model, not directly observed",
  unknown: "Unknown — not established by the evidence on file",
};

export function ClaimBadge({
  kind,
  confidence,
  size = "sm",
  className,
}: ClaimBadgeProps) {
  return (
    <span
      title={MEANING[kind]}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border font-medium",
        "tracking-label whitespace-nowrap uppercase",
        size === "sm" ? "h-[18px] px-1.5 text-[10px]" : "h-[22px] px-2 text-[11px]",
        STYLES[kind],
        className,
      )}
    >
      <span className="sr-only">{MEANING[kind]}</span>
      <span aria-hidden>{kind}</span>
      {/* Confidence is a word, not a number. §16: "do not create fake
          precision" — "medium" is honest where "63%" would not be. */}
      {confidence && (
        /*
         * De-emphasised by weight, not by opacity.
         *
         * This was `opacity-70`, which is the reflex for "secondary" and is
         * the one form of de-emphasis that cannot be checked by looking at
         * the palette: it silently multiplies whatever contrast the pair
         * already had. On the light theme's success surface the ink starts
         * at 5.17:1, so 70% took it to 2.96:1 — well under AA, on the label
         * that says how sure the system is.
         *
         * Dropping to `font-normal` against the badge's `font-medium` gives
         * the same "this is the secondary half" reading at full contrast.
         * Caught by axe; see `e2e/a11y.spec.ts`.
         */
        <span aria-hidden className="font-normal">
          · {confidence}
        </span>
      )}
      {confidence && <span className="sr-only">, {confidence} confidence</span>}
    </span>
  );
}
