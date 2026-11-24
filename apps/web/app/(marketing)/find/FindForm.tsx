"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Textarea } from "@huntloop/ui";
import { ArrowRight } from "lucide-react";
import { saveDraftRequest } from "../../../lib/exchange/draft-request";

/** Keeps the words in this browser and moves on; nothing is posted (DN-74). */
export function FindForm({ next, cta }: { next: string; cta: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  return (
    <form
      className="max-w-xl space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        saveDraftRequest(text.trim());
        router.push(next);
      }}
    >
      <Field label="What do you need?" hint="For example: “200 NVIDIA H100 GPUs delivered to Munich this quarter”.">
        {(p) => <Textarea {...p} rows={3} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />}
      </Field>
      <Button type="submit" variant="primary" size="lg" icon={ArrowRight} disabled={text.trim().length < 3}>
        {cta}
      </Button>
      <p className="text-[12px] leading-[1.5] text-fg-muted">
        This stays in your browser until you continue in your workspace. Nothing is sent or saved when you press the button.
      </p>
    </form>
  );
}
