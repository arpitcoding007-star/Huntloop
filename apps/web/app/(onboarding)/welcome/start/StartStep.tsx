"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@huntloop/ui";
import { FIRST_JOB_OPTIONS, type FirstJob } from "../../../../lib/onboarding/steps";
import { startFirstJob } from "../actions";

/**
 * The first-job fork (K1). One choice; `research` also takes the address to
 * read, so the person lands on a result rather than on another form.
 */
export function StartStep({ prefill, isAgency }: { prefill: string | null; isAgency: boolean }) {
  const router = useRouter();
  const [job, setJob] = useState<FirstJob | null>(null);
  const [url, setUrl] = useState(prefill ?? "");
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = job !== null && (job !== "research" || url.trim().length > 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!job || !ready) return;
    setError(null);
    setUrlError(null);
    startTransition(async () => {
      const result = await startFirstJob({ job, url: job === "research" ? url : undefined });
      if (!result.ok) {
        setError(result.fieldErrors?.url ? null : result.error);
        setUrlError(result.fieldErrors?.url ?? null);
        return;
      }
      /* The company path keeps the address /discover already read. */
      const next =
        result.data.next === "/welcome/company" && prefill
          ? `/welcome/company?d=${encodeURIComponent(prefill)}`
          : result.data.next;
      router.push(next);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <fieldset>
        <legend className="sr-only">Your first job</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {FIRST_JOB_OPTIONS.map((option) => {
            const selected = job === option.value;
            const label =
              option.value === "hunt" && isAgency ? "Find new customers for a client" : option.label;
            return (
              <label
                key={option.value}
                className={[
                  "hl-focusable-within grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 rounded-md border p-3 transition-colors duration-[120ms]",
                  selected
                    ? "border-brand-border bg-brand-surface"
                    : "border-line bg-surface hover:border-brand-border hover:bg-hover",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="job"
                  value={option.value}
                  checked={selected}
                  onChange={() => setJob(option.value)}
                  className="row-span-2 mt-0.5 size-4 shrink-0 self-start accent-[var(--color-brand)]"
                />
                <span className={["text-[13px] font-medium", selected ? "text-brand-text" : "text-fg"].join(" ")}>
                  {label}
                </span>
                <span className="mt-0.5 text-[12px] leading-[1.5] text-fg-muted">{option.description}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {job === "research" && (
        <div className="max-w-md">
          <label
            htmlFor="first-job-url"
            className="block text-[11px] font-semibold tracking-label text-fg-muted uppercase"
          >
            Which company?
          </label>
          <input
            id="first-job-url"
            name="url"
            inputMode="url"
            autoComplete="url"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- revealed by the choice just made
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="acme.com"
            aria-invalid={urlError ? true : undefined}
            aria-describedby={urlError ? "first-job-url-error" : undefined}
            className="hl-focusable mt-1.5 h-10 w-full rounded-md border border-line bg-field px-3 text-[14px] text-fg placeholder:text-fg-muted transition-[border-color,background-color] duration-[120ms] ease-out-hl hover:border-line-strong focus:bg-surface"
          />
          {urlError && (
            <p id="first-job-url-error" role="alert" className="mt-1.5 text-[13px] text-danger">
              {urlError}
            </p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="primary" size="lg" disabled={pending || !ready}>
          {pending ? "Opening…" : job === "research" ? "Research it" : "Continue"}
        </Button>
        <Link
          href="/welcome?edit=1"
          className="hl-focusable inline-flex items-center gap-1 rounded text-[13px] text-fg-muted hover:text-fg"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          Back to You
        </Link>
      </div>
    </form>
  );
}
