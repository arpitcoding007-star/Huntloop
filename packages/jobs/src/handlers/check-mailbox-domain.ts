/**
 * `check_mailbox_domain` — can this mailbox's domain send cold email at all? (P1-4)
 *
 * The commonest cause of a campaign with zero replies is a domain the
 * receiving providers do not trust: no SPF, no DMARC, no DKIM. Nothing in the
 * product looked. This reads the four DNS records that decide it and stores a
 * verdict on the mailbox, which `send_message` reads before a cold send.
 *
 *   fail  no MX, or no SPF record — mail from it is likely rejected outright.
 *         Cold sequence sends are blocked; replies still go.
 *   warn  no DMARC, or no DKIM key under a common selector. Sends, and the
 *         outreach screen says what is missing.
 *   pass  all four present.
 *
 * DKIM selectors are not discoverable from DNS, so "not found" under the
 * common ones is a warning, never a failure. Domain age and blocklists are not
 * checked: both need third-party services this deployment does not have.
 */
import { promises as dnsPromises } from "node:dns";
import type { JobContext, JobOutcome } from "../registry.ts";
import { bareDomain } from "../gate.ts";

export interface DnsLookup {
  resolveMx(domain: string): Promise<{ exchange: string }[]>;
  resolveTxt(domain: string): Promise<string[][]>;
}

export const DKIM_SELECTORS = ["google", "selector1", "selector2", "default", "k1", "s1", "dkim"];

export interface DomainReport {
  domain: string;
  status: "pass" | "warn" | "fail";
  mx: boolean;
  spf: boolean;
  dmarc: boolean;
  dkim: string | null;
  problems: string[];
}

export async function assessDomain(domain: string, dns: DnsLookup = dnsPromises): Promise<DomainReport> {
  const txt = async (name: string) => {
    try {
      return (await dns.resolveTxt(name)).map((parts) => parts.join(""));
    } catch {
      return [];
    }
  };

  let mx = false;
  try {
    mx = (await dns.resolveMx(domain)).length > 0;
  } catch {
    mx = false;
  }
  const spf = (await txt(domain)).some((r) => /^v=spf1\b/i.test(r.trim()));
  const dmarc = (await txt(`_dmarc.${domain}`)).some((r) => /^v=DMARC1\b/i.test(r.trim()));

  let dkim: string | null = null;
  for (const selector of DKIM_SELECTORS) {
    const records = await txt(`${selector}._domainkey.${domain}`);
    if (records.some((r) => /\bp=/i.test(r) || /v=DKIM1/i.test(r))) {
      dkim = selector;
      break;
    }
  }

  const problems: string[] = [];
  if (!mx) problems.push(`${domain} has no MX record, so it cannot receive replies or bounces.`);
  if (!spf) problems.push(`${domain} has no SPF record; receiving servers cannot tell this mailbox is allowed to send for it.`);
  if (!dmarc) problems.push(`${domain} has no DMARC record.`);
  if (!dkim) problems.push(`No DKIM key was found for ${domain} under the common selectors.`);

  const status = !mx || !spf ? "fail" : !dmarc || !dkim ? "warn" : "pass";
  return { domain, status, mx, spf, dmarc, dkim, problems };
}

export async function checkMailboxDomain(ctx: JobContext, dns?: DnsLookup): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const mailboxId = String(payload.mailboxId ?? "");
  if (!mailboxId) {
    return { ok: false, permanent: true, error: "check_mailbox_domain: no mailboxId in payload." };
  }

  const { data: mailbox } = await scope
    .select("mailboxes", "id, email")
    .eq("id", mailboxId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!mailbox) return { ok: true, result: { skipped: "the mailbox no longer exists" } };

  const domain = bareDomain(String(mailbox.email));
  if (!domain) return { ok: false, permanent: true, error: `${mailbox.email} has no domain to check.` };

  const report = await assessDomain(domain, dns);
  const { error } = await scope
    .update("mailboxes", {
      domain_status: report.status,
      domain_report: report,
      domain_checked_at: new Date().toISOString(),
    })
    .eq("id", mailboxId);
  if (error) return { ok: false, error: `check_mailbox_domain: ${error.message}` };

  return { ok: true, result: { domain, status: report.status, problems: report.problems } };
}
