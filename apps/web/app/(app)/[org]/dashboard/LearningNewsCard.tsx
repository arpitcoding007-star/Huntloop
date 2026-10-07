"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@huntloop/ui";
import { Sparkles } from "lucide-react";
import type { LearningNews } from "../../../../lib/data/personal-learning";
import { acknowledgeLearningAction } from "../settings/you/actions";

/**
 * "I noticed…" (K3). What Huntloop started doing for this person since they
 * last looked, said once, with the way to undo it one click away — and how
 * many proposals are waiting for their yes. Nothing learned is applied
 * silently; this card is how "silently" is avoided.
 */
export function LearningNewsCard({ org, news }: { org: string; news: LearningNews }) {
  const [hidden, setHidden] = useState(false);
  const [pending, start] = useTransition();
  if (hidden) return null;

  return (
    <section aria-labelledby="learning-news-heading" className="mb-6 rounded-md border border-ai-border bg-surface p-4">
      <h2 id="learning-news-heading" className="flex items-center gap-1.5 text-[14px] font-semibold text-fg">
        <Sparkles aria-hidden className="size-4 text-ai" strokeWidth={1.75} />
        Huntloop noticed how you work
      </h2>
      {news.learned.length > 0 && (
        <>
          <p className="mt-1 text-[13px] text-fg-muted">From your recent edits and corrections, it now does this for you:</p>
          <ul className="mt-1.5 space-y-1 pl-4 text-[13px] text-fg">
            {news.learned.map((item) => (
              <li key={item.id} className="list-disc">{item.content}</li>
            ))}
          </ul>
        </>
      )}
      {news.proposed > 0 && (
        <p className="mt-1.5 text-[13px] text-fg">
          {news.proposed === 1 ? "One suggestion about" : `${news.proposed} suggestions about`} who to go after{" "}
          {news.proposed === 1 ? "is" : "are"} waiting for your yes — nothing changes until you answer.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" href={`/${org}/settings/you`} linkComponent={Link}>
          Review or undo
        </Button>
        {news.learned.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await acknowledgeLearningAction(org);
                if (res.ok) setHidden(news.proposed === 0);
              })
            }
          >
            Got it
          </Button>
        )}
      </div>
    </section>
  );
}
