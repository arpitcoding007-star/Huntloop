"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { cn } from "../utils/cn";

export type ToastTone = "success" | "danger" | "info";

export interface ToastOptions {
  title: string;
  /** One line of detail. Anything longer belongs on the page, not in a toast. */
  description?: string;
  tone?: ToastTone;
  /** Milliseconds. `null` keeps it until dismissed — see the note below. */
  duration?: number | null;
  /** A single follow-up, e.g. "Undo". */
  action?: { label: string; onClick: () => void };
}

interface ToastRecord extends ToastOptions {
  id: number;
}

interface ToastApi {
  /** Returns the id, so a caller can dismiss its own toast early. */
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Transient confirmations.
 *
 * ── What a toast is for here ────────────────────────────────────────────
 *
 * Confirming something the user just did, when the page cannot show it
 * happened on its own. That is a narrow brief on purpose. A toast is the
 * worst place in an interface to put information: it appears away from
 * whatever the user is looking at, it leaves on a timer, and a screen
 * reader gets one pass at it. Anything the user must read, act on, or be
 * able to find again belongs on the page — `FormMessage` for a save that
 * failed, `ErrorState` for a screen that could not load.
 *
 * ── Why errors do not auto-dismiss ──────────────────────────────────────
 *
 * `duration` defaults to null for the `danger` tone. A success message the
 * user misses costs nothing; a failure message on a four-second timer is
 * how a silent data loss gets shipped. A failure stays until dismissed.
 *
 * ── The live region ─────────────────────────────────────────────────────
 *
 * One region, rendered whether or not there are toasts in it, because a
 * live region has to exist *before* content is put into it — an
 * `aria-live` element that appears at the same moment as its text is
 * commonly not announced at all. `polite` for confirmations, and each
 * failure carries `role="alert"` so it interrupts.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = next.current++;
      const tone = options.tone ?? "info";
      const duration =
        options.duration === undefined ? (tone === "danger" ? null : 5000) : options.duration;

      setToasts((list) => {
        /* Three is the point past which the stack covers the corner of the
           page it is meant to sit in. Oldest goes. */
        const trimmed = list.length >= 3 ? list.slice(1) : list;
        return [...trimmed, { ...options, tone, id }];
      });

      if (duration !== null) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  /* Clear pending timers on unmount, so a navigation away does not leave a
     setState scheduled against a gone component. */
  const pending = timers.current;
  useEffect(() => () => pending.forEach(clearTimeout), [pending]);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Throws when there is no provider, rather than returning a no-op.
 *
 * A silent no-op here means a confirmation that never appears, in exactly
 * the situation where the developer believed it would — which is discovered
 * by a user, in production, wondering whether their click registered.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error("useToast must be used inside <ToastProvider>.");
  }
  return api;
}

const TONES: Record<ToastTone, { icon: typeof Check; className: string }> = {
  success: { icon: Check, className: "text-success-text" },
  danger: { icon: AlertTriangle, className: "text-danger-text" },
  info: { icon: Info, className: "text-info-text" },
};

function ToastCard({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  const { icon: Icon, className } = TONES[toast.tone ?? "info"];

  return (
    <div
      role={toast.tone === "danger" ? "alert" : "status"}
      className={cn(
        // `pointer-events-auto` because the container turns them off — the
        // region spans the bottom of the viewport and must not swallow
        // clicks meant for the page behind it.
        "pointer-events-auto flex w-full max-w-[380px] items-start gap-3 rounded-lg border border-line bg-surface p-3 shadow-popover",
        "motion-safe:animate-[hl-toast-in_var(--hl-duration-slow)_var(--hl-ease-emphasis)]",
      )}
    >
      <Icon className={cn("mt-px size-4 shrink-0", className)} strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-fg">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-[12px] leading-[1.5] text-fg-muted">
            {toast.description}
          </p>
        )}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick();
              onDismiss();
            }}
            className="hl-focusable mt-2 rounded-sm text-[12px] font-medium text-brand-text underline underline-offset-2"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="hl-focusable -mt-0.5 -mr-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted transition-colors duration-[120ms] hover:bg-hover hover:text-fg"
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
