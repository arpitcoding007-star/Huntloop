import type { ComponentType, ReactNode } from "react";
import {
  AlertTriangle,
  Inbox,
  Lock,
  RefreshCw,
  Timer,
} from "lucide-react";
import { cn } from "../utils/cn";
import { Button } from "./Button";

/**
 * The five states spec Part 25 requires of every feature, built once here
 * rather than improvised per page — plan §1.4 #14. A page that has to
 * hand-roll its own permission-denied screen will eventually ship without
 * one.
 *
 * They share a frame on purpose: a user who has learned to read one of these
 * has learned to read all five, and the difference between "nothing here yet"
 * and "we could not load this" then reads instantly instead of being buried
 * in prose.
 */

function StateFrame({
  icon: Icon,
  tone = "neutral",
  title,
  description,
  action,
  className,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  tone?: "neutral" | "danger" | "warning";
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-md border border-line-subtle",
        "bg-surface px-6 py-10 text-center",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-md",
          tone === "danger" && "bg-danger-surface text-danger",
          tone === "warning" && "bg-warning-surface text-warning",
          tone === "neutral" && "bg-surface-active text-fg-secondary",
        )}
      >
        <Icon className="size-[18px]" strokeWidth={1.75} />
      </span>

      <p className="mt-3 text-[14px] font-medium text-fg">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-[13px] leading-[1.5] text-fg-muted">
          {description}
        </p>
      )}
      {action && <div className="mt-4 flex items-center gap-2">{action}</div>}
    </div>
  );
}

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon = Inbox,
  action,
  className,
}: EmptyStateProps) {
  return (
    <StateFrame
      icon={icon}
      title={title}
      description={description}
      action={action}
      className={className}
    />
  );
}

export interface ErrorStateProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Shown verbatim under the description — the operator-facing detail. */
  detail?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  description = "The request failed. Nothing was changed.",
  detail,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <StateFrame
      icon={AlertTriangle}
      tone="danger"
      title={title}
      description={
        <>
          {description}
          {detail && (
            <span className="mt-2 block font-mono text-[11px] break-all text-fg-muted">
              {detail}
            </span>
          )}
        </>
      }
      action={
        onRetry && (
          <Button variant="secondary" icon={RefreshCw} onClick={onRetry}>
            Try again
          </Button>
        )
      }
      className={className}
    />
  );
}

export interface PermissionDeniedProps {
  /** What was being accessed, e.g. "this campaign". */
  resource?: string;
  /** The role that would be needed — say it, don't make them guess. */
  requiredRole?: string;
  className?: string;
}

export function PermissionDenied({
  resource = "this page",
  requiredRole,
  className,
}: PermissionDeniedProps) {
  return (
    <StateFrame
      icon={Lock}
      title={`You don't have access to ${resource}`}
      description={
        requiredRole
          ? `This needs the ${requiredRole} role. Ask an organization admin to change your access.`
          : "Ask an organization admin if you think this is a mistake."
      }
      className={className}
    />
  );
}

export interface RateLimitedProps {
  /** When the caller may try again. Rendered as an absolute local time. */
  retryAt?: Date | string;
  description?: ReactNode;
  className?: string;
}

export function RateLimited({ retryAt, description, className }: RateLimitedProps) {
  const at = retryAt
    ? retryAt instanceof Date
      ? retryAt
      : new Date(retryAt)
    : undefined;

  return (
    <StateFrame
      icon={Timer}
      tone="warning"
      title="Too many requests"
      description={
        description ?? (
          <>
            You&rsquo;ve hit the rate limit for this action.
            {at && (
              <>
                {" "}
                Try again after{" "}
                {/* Absolute, not "in 3 minutes": a countdown that stops
                    counting when the tab is backgrounded is worse than no
                    countdown, and this component does not own a timer. */}
                <time dateTime={at.toISOString()} className="text-fg-secondary">
                  {at.toISOString().slice(11, 16)} UTC
                </time>
                .
              </>
            )}
          </>
        )
      }
      className={className}
    />
  );
}

export interface LoadingSkeletonProps {
  /** Number of placeholder rows. */
  rows?: number;
  /** Row height in px — match the real content or the swap will jump. */
  rowHeight?: number;
  className?: string;
}

export function LoadingSkeleton({
  rows = 5,
  rowHeight = 44,
  className,
}: LoadingSkeletonProps) {
  return (
    <div
      // Announced politely rather than rendered as decorative noise: a screen
      // reader user otherwise gets silence while the page appears to do
      // nothing.
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn("flex flex-col gap-2", className)}
    >
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          style={{ height: rowHeight }}
          className={cn(
            "rounded-md bg-surface",
            // The pulse is the one place motion is decorative rather than
            // informative, so it is the first thing to go under
            // prefers-reduced-motion.
            "animate-pulse motion-reduce:animate-none",
          )}
        />
      ))}
    </div>
  );
}
