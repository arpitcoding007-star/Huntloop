"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  BookOpen,
  Home,
  Keyboard,
  LogIn,
  LogOut,
  Palette,
  Plug,
  Settings,
  ShieldCheck,
} from "lucide-react";
import {
  Avatar,
  Menu,
  Modal,
  THEME_OPTIONS,
  useShortcutLabel,
  useThemePreference,
  type MenuItem,
  type ThemePreference,
} from "@huntloop/ui";
import type { ShellChrome } from "../../../lib/data/chrome";

/**
 * The account menu behind the avatar in the top bar.
 *
 * ── What is in it, and what is not ───────────────────────────────────────
 *
 * Four groups, each answering one question a person asks of the corner of
 * the screen with their face in it:
 *
 *   · Who am I signed in as?        — the header, and Account & privacy
 *   · Which workspace, and its setup — Workspace settings, Integrations,
 *                                      Switch workspace
 *   · How does the app behave for me — Theme, Keyboard shortcuts, Help,
 *                                      the public home page
 *   · Leave                          — Sign out
 *
 * Deliberately absent: billing (there is no billing screen yet, and a menu
 * item onto nothing is the `unbuilt` failure), and a "Profile" page (the
 * only profile fields are the name and address from the identity provider,
 * which the header already states). Help appears only when a help URL is
 * configured — the same rule the top bar already applied to it.
 *
 * ── Demo mode ────────────────────────────────────────────────────────────
 *
 * There is nobody signed in, so the header says so rather than inventing a
 * person, the account item is omitted, and the last row is "Sign in"
 * instead of "Sign out". The avatar shows the workspace's initials, which is
 * the only true thing it can show.
 *
 * This replaces two things: a static "DW" circle that looked clickable and
 * was not, and an account row in the sidebar footer with its own three-item
 * menu. One account menu, where every product puts it.
 */
export function AccountMenu({
  org,
  chrome,
  onSignOut,
}: {
  org: string;
  chrome: ShellChrome;
  onSignOut: () => void;
}) {
  const [theme, setTheme] = useThemePreference();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const account = chrome.account;
  const helpHref = process.env.NEXT_PUBLIC_HELP_URL;

  useShortcutsHotkey(setShortcutsOpen);

  const items: MenuItem[] = [
    ...(account
      ? [{ label: "Account & privacy", icon: ShieldCheck, href: `/${org}/settings/privacy` }]
      : []),
    {
      label: "Workspace settings",
      icon: Settings,
      href: `/${org}/settings`,
      separated: Boolean(account),
    },
    { label: "Integrations", icon: Plug, href: `/${org}/settings/integrations` },
    { label: "Switch workspace", icon: ArrowLeftRight, href: "/orgs" },
    {
      label: "Theme",
      icon: Palette,
      separated: true,
      choices: {
        options: THEME_OPTIONS.map(({ value, label, icon }) => ({
          value,
          label: value === "system" ? "System" : label,
          icon,
        })),
        value: theme,
        onChange: (value) => setTheme(value as ThemePreference),
      },
    },
    {
      label: "Keyboard shortcuts",
      icon: Keyboard,
      hint: "?",
      onSelect: () => setShortcutsOpen(true),
    },
    ...(helpHref
      ? [{ label: "Help & docs", icon: BookOpen, href: helpHref, external: true }]
      : []),
    /* The public site. It renders for signed-in visitors too (with a
       "Continue" back into the workspace), so plain `/` is the way out. */
    { label: "Huntloop home page", icon: Home, href: "/" },
    account
      ? {
          label: "Sign out",
          icon: LogOut,
          tone: "danger" as const,
          separated: true,
          /* `requestSubmit` on the real form in OrgShell rather than a
             fetch: sign-out changes state, so it has to be a POST. */
          onSelect: onSignOut,
        }
      : { label: "Sign in", icon: LogIn, href: "/login", separated: true },
  ];

  return (
    <>
      <Menu
        label="Account"
        align="end"
        linkComponent={Link}
        className="w-[264px]"
        header={
          <div className="flex items-center gap-2.5">
            <Avatar initials={account?.name ?? chrome.orgName} className="size-9 text-[12px]" />
            <div className="min-w-0 leading-[1.3]">
              <p className="truncate text-[13.5px] font-semibold text-fg">
                {account?.name ?? chrome.orgName}
              </p>
              <p className="truncate text-[12px] text-fg-muted">
                {account?.email ?? "Sample data · nobody signed in"}
              </p>
            </div>
          </div>
        }
        items={items}
        trigger={(props) => (
          <button
            type="button"
            {...props}
            aria-label={account ? `Account menu for ${account.name}` : "Account menu"}
            className="hl-focusable group flex shrink-0 items-center rounded-full transition-shadow duration-[120ms] aria-expanded:shadow-[0_0_0_3px_var(--hl-brand-surface)]"
          >
            <Avatar
              initials={account?.name ?? chrome.orgName}
              className="size-9 text-[12px] transition-[filter] duration-[120ms] group-hover:brightness-[0.96]"
            />
          </button>
        )}
      />

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}

/** `?` opens the shortcuts list — anywhere except while typing. */
function useShortcutsHotkey(setOpen: (open: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
}

/**
 * Only shortcuts that exist. A list padded with aspirational bindings is a
 * list the user tests once, finds half of it dead, and never opens again.
 */
function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const jump = useShortcutLabel();
  const rows: { keys: string[]; label: string }[] = [
    { keys: [jump], label: "Search or jump to a page" },
    { keys: ["?"], label: "Show keyboard shortcuts" },
    { keys: ["↑", "↓"], label: "Move through menus and search results" },
    { keys: ["Enter"], label: "Open the highlighted result" },
    { keys: ["Esc"], label: "Close a menu, dialog or the navigation drawer" },
  ];
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="sm">
      <dl className="flex flex-col">
        {rows.map(({ keys, label }, i) => (
          <div
            key={label}
            className={`flex items-center justify-between gap-4 py-2.5 text-[13.5px] ${
              i > 0 ? "border-t border-line-subtle" : ""
            }`}
          >
            <dt className="text-fg-secondary">{label}</dt>
            <dd className="flex shrink-0 gap-1">
              {keys.map((k) => (
                <kbd
                  key={k}
                  className="rounded-[6px] border border-line bg-canvas px-1.5 py-0.5 font-mono text-[11.5px] text-fg"
                >
                  {k}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
