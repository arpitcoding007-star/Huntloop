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

export const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Monitor }[] = [
  { value: "system", label: "Match system", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];
const OPTIONS = THEME_OPTIONS;

/**
 * The current theme preference and a setter that applies it.
 *
 * Starts `null` and hydrates from the `data-theme-preference` attribute the
 * server (or the pre-paint bootstrap script, for "system") already set on
 * <html> — reading `document` during render would fight SSR, and guessing a
 * default would flash the wrong option briefly.
 *
 * Shared by the toggle and the account menu's theme row. Every instance
 * follows the attribute rather than its own state, so two controls on one
 * screen can never disagree about which option is chosen.
 */
export function useThemePreference(): [ThemePreference | null, (pref: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const current = root.getAttribute("data-theme-preference");
      setPreference(current === "light" || current === "dark" ? current : "system");
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme-preference"] });
    return () => observer.disconnect();
  }, []);

  return [
    preference,
    (pref) => {
      applyPreference(pref);
      setPreference(pref);
    },
  ];
}

/**
 * System / Light / Dark switcher. Applies instantly via the DOM + cookie
 * (see applyPreference) — no reload, no server round trip, since the theme
 * is a display preference rather than anything the server needs to know.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [preference, setPreference] = useThemePreference();

  if (!preference) {
    return <div className={cn("h-9 w-[96px] rounded-[10px]", className)} aria-hidden />;
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      /* A raised pill on the chrome, with the chosen option sitting in the
         toolbar-hover tint — the same value a hover lands on, so selecting
         an option reads as the hover staying put. */
      className={cn(
        "inline-flex h-9 items-center gap-0.5 rounded-[10px] border border-line-subtle bg-surface p-[3px] shadow-raised",
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
            onClick={() => setPreference(value)}
            className={cn(
              "hl-focusable flex size-7 items-center justify-center rounded-[7px] transition-colors duration-[120ms]",
              active
                ? "bg-toolbar-hover text-fg"
                : "text-fg-muted hover:bg-toolbar-hover hover:text-fg",
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
