/**
 * The product's email, as HTML and plain text.
 *
 * Every interpolated value is escaped: names, organisation names and
 * opportunity titles are typed by people, and an email client renders HTML.
 * Styles are inline because most clients drop `<style>` blocks; the layout is
 * one centred column that reads the same in a phone's mail app.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const C = {
  text: "#1f2937",
  muted: "#6b7280",
  line: "#e5e7eb",
  // The product fill, #1F58F0: passes AA under white text (see the design tokens).
  brand: "#1F58F0",
  canvas: "#F7F8FA",
};

interface Block {
  heading: string;
  /** Plain sentences; escaped. */
  paragraphs: string[];
  cta?: { label: string; href: string };
  /** Rows under the paragraphs, e.g. the digest's items. */
  list?: { title: string; detail?: string; href?: string }[];
  /** Small print: why they received this and how to stop it. */
  footer: string[];
  preheader?: string;
}

function render(block: Block): { html: string; text: string } {
  const list = block.list?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-top:1px solid ${C.line}">${block.list
        .map(
          (item) => `<tr><td style="padding:12px 0;border-bottom:1px solid ${C.line}">
<div style="font-size:14px;color:${C.text};font-weight:600">${
            item.href
              ? `<a href="${escapeHtml(item.href)}" style="color:${C.text};text-decoration:none">${escapeHtml(item.title)}</a>`
              : escapeHtml(item.title)
          }</div>${
            item.detail
              ? `<div style="font-size:13px;color:${C.muted};margin-top:2px">${escapeHtml(item.detail)}</div>`
              : ""
          }</td></tr>`,
        )
        .join("")}</table>`
    : "";

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(block.heading)}</title></head>
<body style="margin:0;padding:0;background:${C.canvas}">
${block.preheader ? `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(block.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${C.line};border-radius:8px">
<tr><td style="padding:28px 28px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="font-size:13px;font-weight:600;color:${C.brand};letter-spacing:0.02em">Huntloop</div>
<h1 style="font-size:20px;line-height:1.35;color:${C.text};margin:14px 0 12px">${escapeHtml(block.heading)}</h1>
${block.paragraphs.map((p) => `<p style="font-size:14px;line-height:1.6;color:${C.text};margin:0 0 12px">${escapeHtml(p)}</p>`).join("")}
${list}
${
  block.cta
    ? `<p style="margin:20px 0 24px"><a href="${escapeHtml(block.cta.href)}" style="display:inline-block;background:${C.brand};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:6px">${escapeHtml(block.cta.label)}</a></p>`
    : ""
}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid ${C.line};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
${block.footer.map((f) => `<p style="font-size:12px;line-height:1.5;color:${C.muted};margin:0 0 6px">${escapeHtml(f)}</p>`).join("")}
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    block.heading,
    "",
    ...block.paragraphs,
    ...(block.list?.length
      ? ["", ...block.list.map((i) => `- ${i.title}${i.detail ? ` — ${i.detail}` : ""}${i.href ? `\n  ${i.href}` : ""}`)]
      : []),
    ...(block.cta ? ["", `${block.cta.label}: ${block.cta.href}`] : []),
    "",
    "—",
    ...block.footer,
  ].join("\n");

  return { html, text };
}

/* ── Invitations ─────────────────────────────────────────────────────────── */

export function invitationEmail(input: {
  orgName: string;
  inviterName: string | null;
  role: string;
  url: string;
  expiresAt: string;
}): RenderedEmail {
  const who = input.inviterName ? `${input.inviterName} invited you` : "You have been invited";
  const subject = `${input.inviterName ?? "A teammate"} invited you to ${input.orgName} on Huntloop`;
  const expires = new Date(input.expiresAt).toUTCString().replace(/:\d\d GMT$/, " UTC");
  return {
    subject,
    ...render({
      preheader: `Join ${input.orgName} as ${input.role}.`,
      heading: `Join ${input.orgName} on Huntloop`,
      paragraphs: [
        `${who} to join ${input.orgName} as ${articleFor(input.role)} ${input.role}.`,
        "Huntloop finds the companies worth contacting, explains why each one matters now, and keeps the team's follow-ups in one place.",
      ],
      cta: { label: "Accept the invitation", href: input.url },
      footer: [
        `The link works once and expires ${expires}. It only works for this email address.`,
        "If you weren't expecting this, you can ignore it — nothing happens unless you accept.",
      ],
    }),
  };
}

/* ── Join requests ───────────────────────────────────────────────────────── */

export function joinRequestEmail(input: {
  orgName: string;
  requesterEmail: string;
  url: string;
}): RenderedEmail {
  return {
    subject: `${input.requesterEmail} asked to join ${input.orgName}`,
    ...render({
      heading: `${input.requesterEmail} would like to join ${input.orgName}`,
      paragraphs: [
        "They signed up with an address at your company's domain and asked to join this workspace instead of creating a new one.",
        "Approving gives them member access. You can change their role afterwards.",
      ],
      cta: { label: "Review the request", href: input.url },
      footer: ["You receive this because you are an admin of this workspace."],
    }),
  };
}

export function joinApprovedEmail(input: { orgName: string; url: string }): RenderedEmail {
  return {
    subject: `You're in: ${input.orgName} on Huntloop`,
    ...render({
      heading: `Your request to join ${input.orgName} was approved`,
      paragraphs: ["You now have member access to the workspace."],
      cta: { label: `Open ${input.orgName}`, href: input.url },
      footer: ["You receive this because you asked to join this workspace."],
    }),
  };
}

/* ── The daily digest ────────────────────────────────────────────────────── */

export interface DigestItem {
  title: string;
  why: string;
  href: string;
}

export function digestEmail(input: {
  orgName: string;
  firstName: string | null;
  items: DigestItem[];
  total: number;
  needsYouUrl: string;
  preferencesUrl: string;
  unsubscribeUrl: string;
}): RenderedEmail {
  const count = input.total;
  const subject = `${count} thing${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} you in ${input.orgName}`;
  return {
    subject,
    ...render({
      preheader: input.items[0] ? input.items[0].title : subject,
      heading: input.firstName ? `Good morning, ${input.firstName}` : "Your day in Huntloop",
      paragraphs: [
        count > input.items.length
          ? `The top ${input.items.length} of ${count} items waiting for you in ${input.orgName}, most urgent first.`
          : `What is waiting for you in ${input.orgName}, most urgent first.`,
      ],
      list: input.items.map((i) => ({ title: i.title, detail: i.why, href: i.href })),
      cta: { label: "Open Needs you", href: input.needsYouUrl },
      footer: [
        "Sent once a day, only when something needs you.",
        `Change when it arrives: ${input.preferencesUrl}`,
        `Stop these emails: ${input.unsubscribeUrl}`,
      ],
    }),
  };
}

function articleFor(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
