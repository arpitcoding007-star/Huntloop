import type { ComponentType, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Lock } from "lucide-react";
import { cn } from "../utils/cn";

export type NoteTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface NoteProps {
  children: ReactNode;
  tone?: NoteTone;
  /**
   * Overrides the tone's default icon. Pass `null` for no icon — right for a
   * one-line aside where a glyph is louder than the sentence beside it.
   */
  icon?: ComponentType<{ className?: string; strokeWidth?: number }> | null;
  className?: string;
}

/**
 * An inline notice, in the flow of a form or a panel.
 *
 * ── What it is not ──────────────────────────────────────────────────────
 *
 * Not `EmptyState` / `PermissionDenied` (States.tsx), which are full
 * centred frames that stand in for content that is not there. This is a
 * strip that sits *beside* content that is there — "you can read this but
 * not change it", "this needs a model connected", "we are showing demo
 * figures".
 *
 * ── Why it exists ───────────────────────────────────────────────────────
 *
 * Seven screens had rendered the identical string
 *
 *   "rounded-md border border-line bg-surface px-3 py-2 text-[13px]
 *    text-fg-muted"
 *
 * around a sentence explaining that the reader's role is read-only. Seven
 * copies is not a pattern, it is seven chances to disagree — and they had
 * already begun to: the two warning-toned variants elsewhere in the app
 * used `px-4 py-3` and a different text size for the same job.
 *
 * ── Tone, and why neutral is the default ────────────────────────────────
 *
 * "You may not edit this" is not a warning. Nothing has gone wrong, nothing
 * needs attention, and painting it amber spends the colour that means
 * "look at this" on a fact the reader can act on by asking someone. Amber
 * and red are reserved for a state that is degraded or about to be.
 */
const TONES: Record<
  NoteTone,
  { frame: string; icon: string; fallback: ComponentType<{ className?: string; strokeWidth?: number }> }
> = {
  neutral: {
    frame: "border-line bg-field text-fg-muted",
    icon: "text-fg-muted",
    fallback: Lock,
  },
  info: {
    frame: "border-info-border bg-info-surface text-info-text",
    icon: "text-info-text",
    fallback: Info,
  },
  success: {
    frame: "border-success-border bg-success-surface text-success-text",
    icon: "text-success-text",
    fallback: CheckCircle2,
  },
  warning: {
    frame: "border-warning-border bg-warning-surface text-warning-text",
    icon: "text-warning-text",
    fallback: AlertTriangle,
  },
  danger: {
    frame: "border-danger-border bg-danger-surface text-danger-text",
    icon: "text-danger-text",
    fallback: AlertTriangle,
  },
};

export function Note({ children, tone = "neutral", icon, className }: NoteProps) {
  const spec = TONES[tone];
  const Icon = icon === null ? null : (icon ?? spec.fallback);

  return (
    <div
      /* `status` rather than `alert` even for the danger tone: a Note is
         rendered with the page, not in response to something the user just
         did, and `alert` interrupts whatever a screen reader was saying.
         The component that *does* interrupt is Toast. */
      role="status"
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px] leading-[1.55]",
        spec.frame,
        className,
      )}
    >
      {Icon && (
        <Icon
          aria-hidden
          className={cn("mt-px size-3.5 shrink-0", spec.icon)}
          strokeWidth={1.75}
        />
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
