"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "../utils/cn";

export type ThemePreference = "system" | "light" | "dark";

/**
 * Kept in sync with the cookie name `apps/web/app/layout.tsx` reads
 * server-side to render the correct `data-theme` with zero flash. A shared
 * constants module for one string that crosses a package boundary would be
 * more machinery than the duplication it avoids.
 */
const COOKIE_NAME = "hl-theme";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function resolveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Mirrors the bootstrap script in layout.tsx — same attributes, same cookie. */
function applyPreference(pref: ThemePreference) {
  const root = document.documentElement;
  root.setAttribute("data-theme-preference", pref);
  root.setAttribute("data-theme", resolveTheme(pref));
  document.cookie = `${COOKIE_NAME}=${pref}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Monitor }[] = [
  { value: "system", label: "Match system", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/**
 * System / Light / Dark switcher. Applies instantly via the DOM + cookie
 * (see applyPreference) — no reload, no server round trip, since the theme
 * is a display preference rather than anything the server needs to know.
 */
export function ThemeToggle({ className }: { className?: string }) {
  /* Starts unknown and hydrates from the `data-theme-preference` attribute
     the server (or the pre-paint bootstrap script, for "system") already
     set on <html> — reading `document` during render would fight SSR, and
     guessing a default here would flash the wrong option briefly. */
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme-preference");
    setPreference(current === "light" || current === "dark" ? current : "system");
  }, []);

  if (!preference) {
    return <div className={cn("h-8 w-[84px] rounded-md", className)} aria-hidden />;
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex h-8 items-center gap-0.5 rounded-md border border-line bg-surface p-0.5",
        className,
      )}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={label}
            onClick={() => {
              applyPreference(value);
              setPreference(value);
            }}
            className={cn(
              "hl-focusable flex size-7 items-center justify-center rounded-[5px] transition-colors duration-[120ms]",
              active ? "bg-surface-active text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
