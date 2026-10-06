"use client";

import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@huntloop/ui";
import { Menu, X } from "lucide-react";

/**
 * The landing page's section links below `md`, where the header row has no
 * room for them (§14.2: they used to simply disappear on a phone). A
 * disclosure rather than a drawer: three anchors do not need an overlay, and
 * it closes itself when one is followed or Escape is pressed.
 */
export function MobileNav({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        className="hl-focusable inline-flex size-9 items-center justify-center rounded-md text-fg-secondary hover:bg-hover hover:text-fg"
      >
        {open ? <X className="size-5" strokeWidth={1.75} /> : <Menu className="size-5" strokeWidth={1.75} />}
      </button>
      {open && (
        <nav
          id="mobile-nav"
          aria-label="Main"
          className="absolute inset-x-0 top-[68px] border-b border-line-subtle bg-panel px-4 py-3 shadow-raised"
        >
          <ul className="flex flex-col">
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="hl-focusable block rounded-md px-2 py-2.5 text-[15px] text-fg-secondary hover:bg-hover hover:text-fg"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-2 border-t border-line-subtle px-2 pt-3">
            <ThemeToggle />
          </div>
        </nav>
      )}
    </div>
  );
}
