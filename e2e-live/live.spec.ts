import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type Person = { id: string; email: string; token: string; session: string };
const door = async <T>(body: Record<string, unknown>): Promise<T> => {
  const r = await fetch("http://127.0.0.1:3198", { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as T;
};
const sql = <T = Record<string, unknown>>(text: string, args: unknown[] = []) => door<T[]>({ op: "sql", text, args });
const refused = () => door<{ method: string; path: string; status: number; message: string }[]>({ op: "errors" });
/* A failed test restarts the worker, and the backend remembers the last one. */
const stamp = Date.now().toString(36);
const ACME = `acme-${stamp}`;
const SELLERS = `sellers-${stamp}`;
const person = (name: string) => door<Person>({ op: "user", email: `${name}-${stamp}@live.test` });
async function signIn(context: BrowserContext, p: Person) {
  await context.clearCookies();
  const name = "sb-127-auth-token";
  const chunks = p.session.match(/.{1,3000}/g)!;
  await context.addCookies(chunks.map((value, i) => ({ name: chunks.length > 1 ? `${name}.${i}` : name, value, domain: "127.0.0.1", path: "/" })));
}
const workspace = async (p: Person, slug: string, role = "owner") => {
  let [o] = await sql<{ id: string }>(`select id from organizations where slug = $1`, [slug]);
  o ??= (await sql<{ id: string }>(`insert into organizations (name, slug, onboarding_step, onboarding_completed_at) values ($1, $1, 'done', now()) returning id`, [slug]))[0];
  await sql(`insert into memberships (org_id, user_id, role) values ($1, $2, $3::org_role)`, [o!.id, p.id, role]);
  return o!.id;
};
async function clean(what: string) {
  const bad = (await refused()).map((e) => `${e.method} ${e.path.slice(0, 220)} → ${e.status} ${e.message.slice(0, 220)}`);
  expect(bad, what).toEqual([]);
}
const broken = /something went wrong|couldn.t load|could not be loaded|application error/i;

const SCREENS = ["dashboard", "analytics", "analyze", "assistant", "companies", "competitors", "demand", "exchange", "exchange/new", "exchange/intros", "exchange/updates", "exchange/supplier", "exchange/market", "exchange/privacy", "exchange/notifications", "imports", "inbox", "intelligence", "learn", "memory", "needs-you", "opportunities", "ops", "outreach", "performance", "pipeline", "settings", "sources", "team"];

let owner: Person, viewer: Person, seller: Person;
test.beforeAll(async () => {
  owner = await person("owner");
  viewer = await person("viewer");
  seller = await person("seller");
  const a = await workspace(owner, ACME);
  await sql(`update plans set limits = limits || '{"seats": 50}'::jsonb`);
  await workspace(viewer, ACME, "viewer");
  await workspace(seller, SELLERS);
  await sql(`update exchange_categories set matching_enabled = true where slug = 'gpus-accelerators'`);
  await sql(`insert into companies (org_id, canonical_domain, name, industry) select $1, 'prospect' || i || '.${stamp}.test', 'Prospect ' || i, 'Software' from generate_series(1, 30) i`, [a]);
  await sql(`insert into opportunities (org_id, company_id, priority, status, priority_reason) select org_id, id, (array['hot','warm','watch'])[1 + (row_number() over ())::int % 3]::text::opportunity_priority, (array['discovered','qualified','contacted','won','lost'])[1 + (row_number() over ())::int % 5]::opportunity_status, 'synthetic' from companies where org_id = $1`, [a]);
  await refused();
});

async function links(page: Page, org: string): Promise<string[]> {
  return page.evaluate((o) => [...document.querySelectorAll("a[href]")].map((a) => new URL((a as HTMLAnchorElement).href).pathname).filter((p) => p.startsWith(`/${o}/`)), org);
}

for (const role of ["owner", "viewer"] as const) {
  test(`every screen opens for ${role}, and the database refuses nothing`, async ({ page, context }) => {
    test.setTimeout(400_000);
    await signIn(context, role === "owner" ? owner : viewer);
    const seen = new Set<string>();
    const queue = SCREENS.map((s) => `/${ACME}/${s}`);
    const problems: string[] = [];
    while (queue.length && seen.size < 90) {
      const path = queue.shift()!;
      /* One of each record page is enough. */
      const shape = path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id");
      if (seen.has(shape) || shape.endsWith("/export")) continue;
      seen.add(shape);
      const errors: string[] = [];
      const onError = (e: Error) => errors.push(e.message);
      page.on("pageerror", onError);
      const r = await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      page.off("pageerror", onError);
      const text = await page.locator("body").innerText();
      if ((r?.status() ?? 0) >= 500 || broken.test(text) || errors.length) problems.push(`${path}: ${r?.status()} ${errors.join("; ")} ${text.match(broken)?.[0] ?? ""}`);
      for (const bad of await refused()) problems.push(`${path}: ${bad.method} ${bad.path.slice(0, 260)} → ${bad.status} ${bad.message.slice(0, 200)}`);
      for (const l of await links(page, ACME)) queue.push(l);
    }
    console.log(`${role}: ${seen.size} screens`);
    expect(problems).toEqual([]);
  });
}

test("the screens show the workspace's own rows, not the demo", async ({ page, context }) => {
  await signIn(context, owner);
  await page.goto(`/${ACME}/companies`);
  await expect(page.getByText("Prospect 17", { exact: true }).first()).toBeVisible();
  await clean("companies");
});

test("a signed-in person cannot open a workspace that is not theirs", async ({ page, context }) => {
  await signIn(context, seller);
  await page.goto(`/${ACME}/dashboard`);
  await expect(page.getByText("Prospect 1")).toHaveCount(0);
  await refused();
});

test("buyer to outcome, through the screens", async ({ page, context }) => {
  await signIn(context, seller);
  await page.goto(`/${SELLERS}/exchange/supplier`);
  await page.getByLabel(/name/i).first().fill(`Seller Compute ${stamp}`);
  await page.getByRole("button", { name: /create|save/i }).first().click();
  await expect(page.getByText(/saved|Seller Compute/i).first()).toBeVisible();
  const [profile] = await sql<{ id: string }>(`select id from exchange_provider_profiles where name = 'Seller Compute ${stamp}'`);
  expect(profile).toBeTruthy();
  const [cat] = await sql<{ id: string }>(`select id from exchange_categories where slug = 'gpus-accelerators'`);
  const [offering] = await sql<{ id: string }>(`insert into exchange_offerings (provider_id, category_id, title, status, serves_global) values ($1, $2, 'H100 cards', 'active', true) returning id`, [profile!.id, cat!.id]);

  await signIn(context, owner);
  await page.goto(`/${ACME}/exchange/new`);
  await page.getByLabel("What do you need?").fill(`200 H100 cards ${stamp}`);
  await page.getByRole("button", { name: "Use a plain form instead" }).click();
  await page.getByRole("button", { name: /save|submit|file/i }).last().click();
  await expect.poll(async () => (await sql(`select 1 from exchange_needs where summary = '200 H100 cards ${stamp}'`)).length).toBe(1);
  await sql(`update exchange_needs set visibility = 2, category_id = $1 where summary = '200 H100 cards ${stamp}'`, [cat!.id]);
  const [need] = await sql<{ id: string }>(`select id from exchange_needs where summary = '200 H100 cards ${stamp}'`);
  await sql(`insert into exchange_matches (need_id, offering_id, score) values ($1, $2, 80)`, [need!.id, offering!.id]);

  await signIn(context, seller);
  await page.goto(`/${SELLERS}/exchange/supplier`);
  await page.getByRole("button", { name: /introduction/i }).first().click();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect.poll(async () => (await sql(`select 1 from exchange_intros`)).length).toBe(1);
  const [intro] = await sql<{ id: string }>(`select id from exchange_intros`);

  await signIn(context, owner);
  await page.goto(`/${ACME}/needs-you`);
  await expect(page.getByText(`Seller Compute ${stamp}`).first()).toBeVisible();
  await page.goto(`/${ACME}/exchange/intros/${intro!.id}`);
  await page.getByRole("button", { name: /accept/i }).first().click();
  await expect.poll(async () => (await sql<{ state: string }>(`select state from exchange_intros`))[0]!.state).toBe("accepted");
  await page.reload();
  await page.getByRole("textbox").first().fill("Please send a quote.");
  await page.getByRole("button", { name: /send/i }).first().click();
  await expect.poll(async () => (await sql(`select 1 from exchange_messages`)).length).toBe(1);

  await signIn(context, seller);
  await page.goto(`/${SELLERS}/exchange/intros/${intro!.id}`);
  await expect(page.getByText("Please send a quote.").first()).toBeVisible();
  await clean("the journey");
});

test("onboarding makes a buyer's workspace, which opens on its requests", async ({ page, context }) => {
  const fresh = await person("fresh");
  await signIn(context, fresh);
  await page.goto("/welcome?job=buy");
  await page.getByLabel("Your name").fill("Fay Fresh");
  await page.getByRole("radio", { name: /Founder or CEO/ }).check();
  await page.getByRole("button", { name: /continue|next/i }).first().click();
  await page.waitForURL("**/welcome/start**");
  await expect(page.getByRole("radio", { name: /Find a product/ })).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL("**/exchange/new");
  expect((await sql<{ purpose: string }>(`select o.purpose from organizations o join memberships m on m.org_id = o.id where m.user_id = $1`, [fresh.id]))[0]!.purpose).toBe("buyer");
  await page.goto("/orgs");
  await clean("onboarding");
});

test("the questionnaire asks, stops at its cap, and records what it spent", async ({ page, context }) => {
  await signIn(context, owner);
  await page.goto(`/${ACME}/exchange/new`);
  await page.getByLabel("What do you need?").fill("Something synthetic");
  await page.getByRole("button", { name: "Continue" }).click();
  for (let i = 0; i < 12; i++) {
    const answer = page.getByLabel("Your answer");
    const card = page.getByRole("heading", { name: "Check your request" });
    await expect(answer.or(card).first()).toBeVisible();
    if (await card.isVisible()) break;
    await answer.fill("I am not sure yet");
    await answer.press("Enter");
    await expect(answer.and(page.locator("input[value='']")).or(card).first()).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Check your request" })).toBeVisible();
  const runs = await sql<{ task: string; status: string; n: number }>(`select task, status, count(*)::int as n from ai_runs where org_id = (select id from organizations where slug = $1) and task like 'intake%' group by 1, 2 order by 1`, [ACME]);
  expect(runs.every((r) => r.status === "succeeded")).toBe(true);
  expect(runs.find((r) => r.task === "intake_turn")!.n).toBeLessThanOrEqual(9);
  await clean("the questionnaire");
});

test("a plan limit is shown, and refused in words at the limit", async ({ page, context }) => {
  await signIn(context, owner);
  await sql(`update plans set limits = limits || jsonb_build_object('needs_open', 1)`);
  await page.goto(`/${ACME}/exchange`);
  await expect(page.getByText(/of 1 open requests in use/)).toBeVisible();
  await page.goto(`/${ACME}/exchange/new`);
  await page.getByLabel("What do you need?").fill(`one too many ${stamp}`);
  await page.getByRole("button", { name: "Use a plain form instead" }).click();
  await page.getByRole("button", { name: /save|submit|file/i }).last().click();
  await expect(page.getByText(/Your plan includes 1 open requests/)).toBeVisible();
  await sql(`update plans set limits = limits - 'needs_open'`);
  await refused();
});

test("the buyer domain serves /find at its home page", async ({ request }) => {
  const r = await request.get("http://localhost:3103/");
  expect(await r.text()).toContain("Stay anonymous until you choose");
  expect(await (await request.get("http://127.0.0.1:3103/")).text()).not.toContain("Stay anonymous until you choose");
});
