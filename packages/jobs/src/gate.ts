/**
 * The last look at a message before it leaves (P0-4).
 *
 * At autonomy 0–1 a person approves every message, and what they approved is
 * what goes. At autonomy 2 and above nobody reads it, and the draft was
 * written by a model that had untrusted web pages in its context — so a link
 * to somewhere the org has never heard of, or a `{{first_name}}` the writer
 * left behind, would reach a prospect with nothing in the way.
 *
 * Pure, so the rules can be read and tested without a send. The handler
 * decides what a failure does: at autonomy 2+ the message goes back to the
 * approval queue with these reasons on it.
 */

export interface GateInput {
  subject: string;
  body: string;
  /** Domains a link may point at: the sending mailbox's, the recipient's, the org's own sites. */
  allowedDomains: string[];
}

export const MAX_BODY_CHARS = 5000;

/* `{{name}}`, `{first_name}`, `[First Name]`, `[Company]` — every shape a template
   placeholder takes when nothing filled it in. */
const MERGE_TAG =
  /\{\{[^}]*\}\}|\{\s*(first|last|full|company)[ _]?name\s*\}|\[\s*(first|last|full|company|prospect)[ _]?(name)?\s*\]/i;

const URL_PATTERN = /\bhttps?:\/\/([^\s/<>"')\]]+)/gi;

export function checkContent(input: GateInput): string[] {
  const issues: string[] = [];
  const subject = input.subject.trim();
  const body = input.body.trim();

  if (!subject) issues.push("The subject is empty.");
  if (!body) issues.push("The body is empty.");
  if (body.length > MAX_BODY_CHARS) {
    issues.push(`The body is ${body.length} characters; the limit for an unreviewed send is ${MAX_BODY_CHARS}.`);
  }
  if (MERGE_TAG.test(subject) || MERGE_TAG.test(body)) {
    issues.push("It contains a placeholder that was never filled in.");
  }
  if (/<\s*(script|iframe|form|img)\b/i.test(body)) {
    issues.push("It contains HTML that a cold email should not carry.");
  }

  const allowed = input.allowedDomains.map(bareDomain).filter((d): d is string => Boolean(d));
  const foreign = new Set<string>();
  for (const match of `${subject}\n${body}`.matchAll(URL_PATTERN)) {
    const host = bareDomain(match[1] ?? "");
    if (!host) continue;
    if (!allowed.some((d) => host === d || host.endsWith(`.${d}`))) foreign.add(host);
  }
  /* AI-007: a reply-to address planted by a page the model read is the same
     attack as a link, one channel over. */
  for (const match of `${subject}\n${body}`.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi)) {
    const host = bareDomain(match[1] ?? "");
    if (host && !allowed.some((d) => host === d || host.endsWith(`.${d}`))) foreign.add(host);
  }
  if (foreign.size) {
    issues.push(`It links to or names an address at ${[...foreign].slice(0, 3).join(", ")}, which is not the sender's, the recipient's or the organisation's own site.`);
  }

  return issues;
}

/** `https://WWW.Acme.com:443/x` / `dana@acme.com` / `acme.com` → `acme.com`. */
export function bareDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = value.trim().toLowerCase();
  if (v.includes("@")) v = v.slice(v.lastIndexOf("@") + 1);
  v = v.replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0] ?? "";
  v = v.replace(/^www\./, "").replace(/\.$/, "");
  return v.includes(".") ? v : null;
}
