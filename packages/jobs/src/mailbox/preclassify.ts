/**
 * The replies that must be honoured without a model.
 *
 * `sync_mailbox` used to act on an opt-out or a bounce only when
 * `classify_reply` succeeded. With no API key, an exhausted quota or a model
 * outage, "please remove me" was stored, shown as unclassified, and the
 * sequence kept sending — the failure the whole reply path exists to prevent.
 *
 * So the two cases with legal or reputational weight are recognised here
 * first, by rules a person can read, and the model is only asked about
 * everything else. Deliberately narrow: a false positive here suppresses an
 * address somebody may have wanted to keep, so a phrase has to be the point of
 * the message, not a word that happens to appear in it.
 */
import type { ReplyClassification } from "@huntloop/ai";
import type { IncomingMessage } from "./provider.ts";

const BOUNCE_SENDERS = /^(mailer-daemon|postmaster|mail-daemon|mailerdaemon)@/i;

const BOUNCE_SUBJECTS =
  /^(undeliverable|undelivered mail|delivery status notification \(failure\)|mail delivery (failed|subsystem)|returned mail|delivery failure|failure notice)\b/i;

/* Matched against the reply's own words — the lines above any quoted copy of
   our message — so a phrase from our footer ("If you'd rather not hear from
   us") that the client quoted back does not count as theirs. */
const OPT_OUT_PHRASES = [
  /\bremove me\b/i,
  /\btake me off\b/i,
  /\bopt(?:ing)? (?:me )?out\b/i,
  /\bstop (?:emailing|contacting|messaging|sending)\b/i,
  /\bdo not (?:contact|email) me\b/i,
  /\bdon'?t (?:contact|email) me\b/i,
  /\bnot interested,? (?:please )?(?:remove|stop)\b/i,
];

/** A whole-message "stop" or "no thanks": short enough to be the entire answer. */
const BARE_REFUSAL = /^\s*(stop|no thanks|no thank you|unsubscribe|remove)[\s.!]*$/i;

export function preclassify(
  incoming: Pick<IncomingMessage, "from" | "subject" | "text">,
): ReplyClassification | null {
  const subject = (incoming.subject ?? "").trim();

  if (BOUNCE_SENDERS.test(incoming.from) || BOUNCE_SUBJECTS.test(subject)) {
    return verdict("bounce", "The message could not be delivered.", false);
  }

  const own = ownWords(incoming.text ?? "");
  /* "unsubscribe" alone counts only in a short message. In a long one it is
     usually an auto-reply or newsletter footer, and suppressing on that
     removes somebody who never asked. */
  const shortUnsubscribe = own.trim().length <= 160 && /\bunsubscribe\b/i.test(own);
  if (BARE_REFUSAL.test(own) || shortUnsubscribe || OPT_OUT_PHRASES.some((p) => p.test(own)) || /^\s*unsubscribe\b/i.test(subject)) {
    return verdict("unsubscribe", "They asked not to be contacted again.", false);
  }

  return null;
}

/**
 * The part of a reply its author wrote: everything above the first quoted
 * line or reply header. Capped, because an opt-out is said near the top and a
 * long message that mentions "unsubscribe" in paragraph six is something else.
 */
export function ownWords(text: string): string {
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*>/.test(line)) break;
    if (/^\s*On .+wrote:\s*$/i.test(line)) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^\s*From:\s/i.test(line)) break;
    lines.push(line);
  }
  return lines.join("\n").slice(0, 600);
}

function verdict(
  label: "bounce" | "unsubscribe",
  summary: string,
  needsHuman: boolean,
): ReplyClassification {
  return { label, confidence: "high", summary, needsHuman, demand: [] };
}
