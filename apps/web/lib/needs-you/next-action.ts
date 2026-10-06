/**
 * What to do next with one opportunity — derived, and showing its working.
 *
 * Replaces the four-case `recommendedAction(priority, hasBuyer, hasTrigger)`
 * (COMMAND.md §16.1 D6), which could tell a salesperson to "reach out now"
 * about a company that had replied two days earlier and was waiting for an
 * answer. Those four cases survive as the last fallback, because they are
 * still right when nothing has happened yet.
 *
 * Pure for the same reason `rank.ts` is: the recommendation is a claim, and a
 * claim has to be checkable against the facts on the same page. So it returns
 * the facts it used beside the sentence.
 */
import { businessDaysBetween, type Priority } from "./rank";

export interface NextActionInput {
  priority: Priority;
  status: string;
  hasBuyer: boolean;
  hasTrigger: boolean;
  nextStep: { text: string; dueAt: string | null } | null;
  /** The latest touch on any channel, if there is one. */
  lastTouch: {
    direction: "outbound" | "inbound";
    channel: string;
    at: string;
  } | null;
  /** The latest reply classification on any thread for this opportunity. */
  replyClassification: string | null;
  /** True while a sequence is actively working this opportunity. */
  sequenceActive: boolean;
  now: Date;
  quietAfterBusinessDays: number;
}

export interface NextAction {
  text: string;
  /** The facts the sentence rests on, in the order a reader would check them. */
  inputs: string[];
  /** How the header should present it. */
  tone: "neutral" | "info" | "warning" | "success";
}

const CHANNEL: Record<string, string> = {
  email: "email",
  linkedin: "LinkedIn message",
  phone: "call",
  meeting: "meeting",
  chat: "message",
  other: "message",
};

function days(from: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(from)) / (24 * 3600_000)));
}

function ago(n: number): string {
  if (n === 0) return "today";
  return n === 1 ? "yesterday" : `${n} days ago`;
}

function dueLabel(dueAt: string, now: Date): string {
  const due = new Date(dueAt);
  const sameDay = due.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
  if (sameDay) return "today";
  return due.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** The pre-activity rule: what the verdict alone supports. */
export function legacyRecommendation(priority: Priority, hasBuyer: boolean, hasTrigger: boolean): string {
  if (priority === "ignore") return "No action — this one is out of scope.";
  if (priority === "watch") return "Keep monitoring — no reason to contact today.";
  if (!hasBuyer) return "Identify a decision maker before reaching out.";
  if (priority !== "hot") return "Research the current approach before contacting.";
  return hasTrigger
    ? "Reach out now, while the trigger is fresh."
    : "Reach out — the fit is strong, though no dated trigger is on file yet.";
}

export function nextAction(input: NextActionInput): NextAction {
  const { now } = input;

  if (input.status === "won") {
    return {
      text: "Won. Log check-ins here as they happen so the relationship keeps its history.",
      inputs: ["Stage: won"],
      tone: "success",
    };
  }
  if (input.status === "lost" || input.status === "archived") {
    return {
      text: "Closed. Nothing to do unless something changes at this company.",
      inputs: [`Stage: ${input.status}`],
      tone: "neutral",
    };
  }

  // A person's own plan outranks anything derived.
  if (input.nextStep) {
    const { text, dueAt } = input.nextStep;
    if (dueAt && Date.parse(dueAt) < now.getTime() && dueLabel(dueAt, now) !== "today") {
      const late = days(dueAt, now);
      return {
        text: `Overdue: ${text}`,
        inputs: [`Next step due ${late === 1 ? "1 day" : `${late} days`} ago`],
        tone: "warning",
      };
    }
    return {
      text: dueAt ? `Next: ${text} — due ${dueLabel(dueAt, now)}.` : `Next: ${text}`,
      inputs: [dueAt ? `Next step due ${dueLabel(dueAt, now)}` : "Next step set, no due date"],
      tone: "info",
    };
  }

  const touch = input.lastTouch;

  if (touch?.direction === "inbound") {
    const when = ago(days(touch.at, now));
    const via = touch.channel === "email" ? "" : ` on ${CHANNEL[touch.channel] === "LinkedIn message" ? "LinkedIn" : touch.channel}`;
    const inputs = [`They replied${via} ${when}`];
    if (input.replyClassification) inputs.push(`Read as ${input.replyClassification.replace(/_/g, " ")}`);
    if (input.replyClassification === "wrong_person") {
      return { text: "They say they are not the right person. Find who is before following up.", inputs, tone: "warning" };
    }
    if (input.replyClassification === "positive") {
      return { text: "They replied positively. Answer them and propose a time to talk.", inputs, tone: "success" };
    }
    return { text: "They replied and are waiting on you. Answer them.", inputs, tone: "info" };
  }

  if (input.status === "meeting" || input.status === "proposal") {
    return {
      text: "Set a next step. Deals at this stage stall when nobody owns what happens next.",
      inputs: [`Stage: ${input.status}`, "No next step set"],
      tone: "warning",
    };
  }

  if (input.sequenceActive) {
    return {
      text: "A sequence is following up on its own. Watch for replies.",
      inputs: ["Enrolled in an active sequence"],
      tone: "neutral",
    };
  }

  if (touch?.direction === "outbound") {
    const business = businessDaysBetween(new Date(touch.at), now);
    const what = CHANNEL[touch.channel] ?? "message";
    if (business >= input.quietAfterBusinessDays) {
      return {
        text: `No reply ${business} business days after your ${what}. Follow up, or try another channel.`,
        inputs: [`Last touch: ${what}, ${ago(days(touch.at, now))}`, "No reply since"],
        tone: "warning",
      };
    }
    return {
      text: `Waiting on them. Your ${what} went out ${ago(days(touch.at, now))}.`,
      inputs: [`Last touch: ${what}, ${ago(days(touch.at, now))}`],
      tone: "neutral",
    };
  }

  const inputs = [`Priority: ${input.priority.toUpperCase()}`, input.hasBuyer ? "Decision maker identified" : "No decision maker yet"];
  if (input.priority === "hot") inputs.push(input.hasTrigger ? "Dated trigger on file" : "No dated trigger");
  return {
    text: legacyRecommendation(input.priority, input.hasBuyer, input.hasTrigger),
    inputs,
    tone: input.priority === "hot" ? "info" : "neutral",
  };
}
