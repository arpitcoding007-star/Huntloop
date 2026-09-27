"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { cn } from "../utils/cn";
import { Modal } from "./Modal";

export interface JumpToItem {
  label: string;
  href: string;
  /** The nav group it lives in. Shown beside the label, and searched too. */
  group?: string;
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
}

export interface JumpToProps {
  open: boolean;
  onClose: () => void;
  items: JumpToItem[];
  /**
   * Performs the navigation — the app passes its router's `push`, so a jump
   * is a client-side transition rather than a full document load.
   */
  onNavigate: (href: string) => void;
}

/**
 * "Search or jump to" — a filter over the destinations the sidebar already
 * lists, and nothing more.
 *
 * ── Why it is this small ────────────────────────────────────────────────
 *
 * The Meridian sidebar draws a ⌘K search row, and for most of this app's life
 * the answer to "should the row exist" was no: a search box for a palette
 * that does not exist teaches a habit and then breaks it (audit UX-02, and
 * NAV-03 fails the build on a control with no behaviour). This is the version
 * that makes the row honest without promising more than is here — it finds
 * pages, not records. Searching companies or opportunities from here is a
 * real feature that needs a real index, and it should arrive as one.
 *
 * Built on `Modal`, so focus trapping, Escape, inertness behind it and the
 * top layer all come from the native `<dialog>` rather than being rewritten.
 * The list is the ARIA combobox pattern: focus stays in the input, and the
 * highlighted option is announced through `aria-activedescendant`.
 */
export function JumpTo({ open, onClose, items, onNavigate }: JumpToProps) {
  const id = useId();
  const listId = `${id}-list`;
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  /* A fresh palette every time it opens: a stale query from the last jump
     would hide the very list the user opened it to see. */
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    /* Modal's own effect has already called `showModal()` by now — effects
       run child-first — so the input is focusable. Without this the dialog
       focuses its first tabbable element, which is the Close button. */
    input.current?.focus();
  }, [open]);

  const results = useMemo(() => rank(items, query), [items, query]);

  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(results.length - 1, 0)));
  }, [results.length]);

  const go = (item: JumpToItem | undefined) => {
    if (!item) return;
    onClose();
    onNavigate(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  };

  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <Modal open={open} onClose={onClose} title="Jump to" size="md" className="max-h-[min(560px,100%)]">
      <div className="-mx-5 -my-4 flex min-h-0 flex-col">
        <label className="flex items-center gap-2.5 border-b border-line-subtle px-5">
          <Search aria-hidden className="size-4 shrink-0 text-fg-muted" strokeWidth={1.7} />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? optionId(active) : undefined}
            aria-label="Search pages"
            placeholder="Search pages"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-muted"
          />
        </label>

        {results.length ? (
          <ul id={listId} role="listbox" aria-label="Pages" className="overflow-y-auto p-2">
            {results.map((item, i) => {
              const Icon = item.icon;
              const on = i === active;
              return (
                /* eslint-disable-next-line jsx-a11y/click-events-have-key-events --
                   The combobox pattern: focus never leaves the input, which
                   owns Arrow/Enter for every option. An option is never
                   focused, so a key handler on it could never fire. */
                <li
                  key={item.href}
                  id={optionId(i)}
                  role="option"
                  aria-selected={on}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(item)}
                  className={cn(
                    "flex h-9 cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 text-[13.5px]",
                    on ? "bg-nav-active text-fg shadow-nav-active" : "text-fg-secondary",
                  )}
                >
                  {Icon && (
                    <Icon
                      className={cn("size-4 shrink-0", on ? "text-brand-vivid" : "text-fg-faint")}
                      strokeWidth={1.6}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.group && (
                    <span className="shrink-0 text-[12px] text-fg-muted">{item.group}</span>
                  )}
                  {on && (
                    <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-fg-muted" strokeWidth={1.7} />
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p id={listId} role="status" className="px-5 py-8 text-center text-[13px] text-fg-muted">
            No page matches “{query}”.
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * Labels that start with the query first, then labels containing it, then
 * items whose group matches — so "in" puts Inbox above Intelligence above
 * everything in "Engage", and typing a group name lists the whole group.
 * Stable within each tier, so the order still reads as the sidebar's.
 */
export function rank(items: JumpToItem[], query: string): JumpToItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const tier = (item: JumpToItem) => {
    const label = item.label.toLowerCase();
    if (label.startsWith(q)) return 0;
    if (label.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    if (label.includes(q)) return 2;
    if (item.group?.toLowerCase().includes(q)) return 3;
    return -1;
  };
  return items
    .map((item, i) => ({ item, i, t: tier(item) }))
    .filter((r) => r.t >= 0)
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((r) => r.item);
}
