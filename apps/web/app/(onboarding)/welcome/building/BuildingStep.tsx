"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@huntloop/ui";
import { AlertTriangle, Check, Loader2, MinusCircle } from "lucide-react";
import {
  FIRST_RUN_STAGES,
  STAGE_LABELS,
  type FirstRunStage,
} from "../../../../lib/onboarding/steps";
import { runStageAction } from "./actions";
import { advanceStep } from "../actions";

/**
 * Building the workspace.
 *
 * ── Why this screen is the whole point of the flow ───────────────────────
 *
 * Everything before it is the user telling Huntloop things. This is the first
 * moment Huntloop does something back, and it is the difference between
 * finishing setup with a promise ("we'll let you know when we find something")
 * and finishing it with the product.
 *
 * ── Why every stage can be skipped without failing ───────────────────────
 *
 * Because the stages fail for unrelated reasons, and a workspace with three
 * scored companies and no contact data is enormously more useful than an error
 * screen. No Apollo key means discovery is skipped and everything downstream
 * has nothing to work on — that is a *configuration state*, and it says so in
 * those words rather than pretending the market is empty.
 *
 * That distinction is the one thing this screen must not get wrong. A user who
 * reads "0 companies match your profile" edits a profile that was fine, or
 * concludes the product does not work, and neither is recoverable by us
 * because nothing looks broken.
 *
 * ── Why leaving is safe ──────────────────────────────────────────────────
 *
 * The first stage creates a saved discovery query that is enabled on a daily
 * interval, so the scheduled runner continues from exactly here. Closing the
 * tab delays the workspace; it does not break it. The Skip button says so.
 */

type Status = "waiting" | "running" | "done" | "skipped" | "failed";

interface StageState {
  status: Status;
  detail: string;
  count: number;
}

/* Built from the list rather than written out, so a stage added to
   `FIRST_RUN_STAGES` cannot be missing here — which was a type error waiting
   to be a runtime `undefined` on a screen with no way to recover. */
const INITIAL: Record<FirstRunStage, StageState> = Object.fromEntries(
  FIRST_RUN_STAGES.map((stage) => [stage, { status: "waiting", detail: "", count: 0 }]),
) as Record<FirstRunStage, StageState>;

export function BuildingStep({ org }: { org: string }) {
  const router = useRouter();
  const [stages, setStages] = useState<Record<FirstRunStage, StageState>>(INITIAL);
  const [finished, setFinished] = useState(false);

  /* Each stage spends money. StrictMode mounts effects twice in development,
     and without this every visit would run the whole chain twice — a real
     provider bill and a duplicate set of research calls, invisible until the
     invoice. */
  const started = useRef(false);

  const run = useCallback(async () => {
    for (const stage of FIRST_RUN_STAGES) {
      setStages((prev) => ({ ...prev, [stage]: { ...prev[stage], status: "running" } }));

      const result = await runStageAction(org, stage);

      if (!result.ok) {
        setStages((prev) => ({
          ...prev,
          [stage]: { status: "failed", detail: result.error, count: 0 },
        }));
        /* Carry on rather than stopping. A stage that could not run does not
           make the next one impossible — scoring works on companies that were
           already there, and explaining works on whatever scored. */
        continue;
      }

      setStages((prev) => ({
        ...prev,
        [stage]: {
          status: result.data.status,
          detail: result.data.detail,
          count: result.data.count,
        },
      }));
    }

    await advanceStep(org, "review");
    setFinished(true);
  }, [org]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  /* Auto-advance once, and only when there is something worth showing. A
     review screen with nothing on it is worse than staying here, where at
     least the reasons each stage was skipped are visible. */
  useEffect(() => {
    if (!finished) return;
    const found = stages.discover.count > 0 || stages.score.count > 0;
    if (found) {
      const timer = setTimeout(() => router.push(`/welcome/review?org=${org}`), 900);
      return () => clearTimeout(timer);
    }
  }, [finished, stages, router, org]);

  const nothingFound =
    finished && stages.discover.count === 0 && stages.score.count === 0;

  return (
    <>
      <h1 className="text-[26px] leading-8 font-semibold text-fg">
        {finished ? "Your workspace is ready" : "Building your workspace…"}
      </h1>
      <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
        {finished
          ? "Here's what happened."
          : "Searching your market, judging what we find against your profile, and working out who to talk to. This takes a minute."}
      </p>

      <ol className="mt-6 max-w-2xl space-y-1">
        {FIRST_RUN_STAGES.map((stage) => {
          const s = stages[stage];
          return (
            <li
              key={stage}
              className="flex items-start gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2.5"
            >
              <StageIcon status={s.status} />
              <div className="min-w-0 flex-1">
                <p
                  className={[
                    "text-[13px]",
                    s.status === "waiting" ? "text-fg-muted" : "text-fg",
                  ].join(" ")}
                >
                  {STAGE_LABELS[stage]}
                </p>
                {s.detail && (
                  <p
                    className={[
                      "mt-0.5 text-[12px] leading-[1.5]",
                      s.status === "failed" ? "text-danger" : "text-fg-muted",
                    ].join(" ")}
                  >
                    {s.detail}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Not "no companies match". The distinction between an empty market and
          an unconfigured one is the most consequential thing this screen can
          get wrong, so it is stated rather than implied. */}
      {nothingFound && (
        <div className="mt-6 max-w-2xl rounded-md border border-warning-border bg-warning-surface p-4">
          <p className="text-[13px] font-medium text-warning">
            We didn&rsquo;t find companies on this run.
          </p>
          <p className="mt-1.5 text-[13px] leading-[1.6] text-fg-secondary">
            The reasons are next to each step above. Most often it is one of
            two things: no company-search provider is connected yet, or the
            profile needs a segment or industry that a search can act on.
            Nothing is broken and nothing is lost — your profile is saved, and
            the search keeps running on a schedule.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => router.push(`/welcome/icp?org=${org}`)}
            >
              Adjust my profile
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => router.push(`/${org}/imports`)}
            >
              Import my own list
            </Button>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          variant={finished ? "primary" : "secondary"}
          size="lg"
          onClick={() => router.push(`/welcome/review?org=${org}`)}
        >
          {finished ? "See what we found" : "Skip — I'll wait in the workspace"}
        </Button>
        {!finished && (
          <span className="text-[13px] text-fg-muted">
            This carries on without you — the search is scheduled either way.
          </span>
        )}
      </div>
    </>
  );
}

function StageIcon({ status }: { status: Status }) {
  const base = "mt-0.5 size-4 shrink-0";
  switch (status) {
    case "running":
      return (
        <Loader2
          aria-label="Running"
          className={`${base} animate-spin text-brand`}
          strokeWidth={1.75}
        />
      );
    case "done":
      return <Check aria-label="Done" className={`${base} text-success`} strokeWidth={2.5} />;
    case "skipped":
      /* Visually distinct from both done and failed, because it is neither.
         A skipped stage is a configuration state and reads as one. */
      return (
        <MinusCircle
          aria-label="Skipped"
          className={`${base} text-fg-muted`}
          strokeWidth={1.75}
        />
      );
    case "failed":
      return (
        <AlertTriangle
          aria-label="Failed"
          className={`${base} text-danger`}
          strokeWidth={1.75}
        />
      );
    default:
      return (
        <span
          aria-hidden
          className={`${base} rounded-full border border-line bg-surface`}
        />
      );
  }
}
