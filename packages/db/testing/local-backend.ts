/**
 * An isolated backend for tests: every real migration on PGlite, behind the
 * subset of PostgREST and Supabase Auth that Huntloop uses.
 *
 * ── Why ──────────────────────────────────────────────────────────────────
 *
 * The migration tests run real SQL with no handlers; the job tests run real
 * handlers against a recording stand-in. A bug in the seam between them — a
 * column that does not exist, a filter PostgREST would refuse, an insert the
 * database rejects — passed both. Here the real supabase-js client, the real
 * handlers and the real web app talk to the real schema with RLS on.
 *
 * ── Isolation ────────────────────────────────────────────────────────────
 *
 * In memory, bound to 127.0.0.1, with no credentials of any kind: tokens are
 * unsigned and only this process believes them. Nothing here can reach a
 * hosted project, and nothing survives the process. Never import it from
 * product code (`check-admin-imports` covers packages, and this folder is not
 * exported).
 *
 * It answers 501 for anything it does not implement, so a query it cannot
 * judge fails the test instead of passing it.
 */
import { createServer, type Server } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

export const SERVICE_KEY = "test-service-role";
export const ANON_KEY = "test-anon";
/** PostgREST's default row cap on Supabase. */
export const MAX_ROWS = 1000;
const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

interface Fk { name: string; table: string; cols: string[]; ref: string; refCols: string[] }
interface Res { status: number; body?: unknown; headers?: Record<string, string> }
class Unsupported extends Error {}
class NotFound extends Error {}

const ident = (s: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw new Unsupported(`identifier ${s}`);
  return `"${s}"`;
};
const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** Splits at top level on `sep`, respecting parentheses, braces and quotes. */
function split(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0, quoted = false, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && quoted) { cur += c + (s[++i] ?? ""); continue; }
    if (c === '"') quoted = !quoted;
    if (!quoted && (c === "(" || c === "{")) depth++;
    if (!quoted && (c === ")" || c === "}")) depth--;
    if (c === sep && depth === 0 && !quoted) { out.push(cur); cur = ""; } else cur += c;
  }
  if (cur !== "" || out.length) out.push(cur);
  return out.filter((x) => x !== "");
}
const unquote = (s: string) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\(.)/g, "$1") : s);

/** `a`, `a->b`, `a->>b` */
function column(alias: string, name: string): string {
  const m = name.match(/^([a-zA-Z_][a-zA-Z0-9_]*)((?:->>?[a-zA-Z0-9_]+)*)$/);
  if (!m) throw new Unsupported(`column ${name}`);
  return `${alias}.${ident(m[1]!)}${(m[2] ?? "").replace(/(->>?)([a-zA-Z0-9_]+)/g, (_, op: string, k: string) => `${op}${lit(k)}`)}`;
}

function condition(alias: string, col: string, expr: string): string {
  let neg = false;
  if (expr.startsWith("not.")) { neg = true; expr = expr.slice(4); }
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot);
  const v = expr.slice(dot + 1);
  const c = column(alias, col);
  const bin: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", cs: "@>", cd: "<@", ov: "&&" };
  let sql: string;
  if (bin[op]) sql = `${c} ${bin[op]} ${lit(v)}`;
  else if (op === "like" || op === "ilike") sql = `${c} ${op} ${lit(v.replaceAll("*", "%"))}`;
  else if (op === "is") {
    if (!/^(null|true|false|unknown)$/.test(v)) throw new Unsupported(`is.${v}`);
    sql = `${c} is ${v}`;
  } else if (op === "in") {
    const items = split(v.slice(1, -1)).map((x) => lit(unquote(x)));
    sql = items.length ? `${c} in (${items.join(",")})` : "false";
  } else throw new Unsupported(`operator ${op}`);
  return neg ? `not (${sql})` : sql;
}

/** `(a.eq.1,and(b.is.null,c.gt.2))` */
function logic(alias: string, body: string, joiner: "or" | "and"): string {
  const parts = split(body.replace(/^\(|\)$/g, "")).map((p) => {
    const m = p.match(/^(not\.)?(and|or)\((.*)\)$/s);
    if (m) return `${m[1] ? "not " : ""}${logic(alias, m[3]!, m[2] as "and" | "or")}`;
    const i = p.indexOf(".");
    return condition(alias, p.slice(0, i), p.slice(i + 1));
  });
  return `(${parts.join(` ${joiner} `)})`;
}

interface Embed { alias: string; target: string; hint: string | null; inner: boolean; select: Sel }
interface Sel { cols: string[]; embeds: Embed[] }

function parseSelect(s: string): Sel {
  const sel: Sel = { cols: [], embeds: [] };
  for (const raw of split(s.replace(/\s+/g, ""))) {
    const m = raw.match(/^(?:([\w]+):)?([\w]+)((?:![\w]+)*)\((.*)\)$/s);
    if (m) {
      const mods = (m[3] ?? "").split("!").filter(Boolean);
      const hint = mods.find((x) => x !== "inner" && x !== "left") ?? null;
      sel.embeds.push({ alias: m[1] ?? m[2]!, target: m[2]!, hint, inner: mods.includes("inner"), select: parseSelect(m[4]!) });
    } else sel.cols.push(raw);
  }
  return sel;
}

export class LocalBackend {
  readonly users = new Map<string, { id: string; email: string }>();
  /** Every refusal, so a test can assert there were none. */
  readonly errors: { method: string; path: string; status: number; message: string }[] = [];
  private fks: Fk[] = [];
  private columns = new Map<string, Set<string>>();
  private lock: Promise<unknown> = Promise.resolve();
  private server: Server | null = null;

  readonly db: PGlite;

  private constructor(db: PGlite) {
    this.db = db;
  }

  static async start(): Promise<LocalBackend> {
    const db = new PGlite();
    await db.exec(`
      create schema auth;
      create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, email_confirmed_at timestamptz default now(),
        raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      grant usage on schema public, auth to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
    for (const f of (await readdir(MIGRATIONS)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()) {
      await db.exec(await readFile(path.join(MIGRATIONS, f), "utf8"));
    }
    const b = new LocalBackend(db);
    b.fks = (
      await db.query<Fk>(`
        select c.conname as name, t.relname as "table", r.relname as ref,
               array(select a.attname::text from unnest(c.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by o) as cols,
               array(select a.attname::text from unnest(c.confkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by o) as "refCols"
          from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_class r on r.oid = c.confrelid
         where c.contype = 'f' and c.connamespace = 'public'::regnamespace`)
    ).rows;
    for (const r of (await db.query<{ t: string; c: string }>(`select table_name as t, column_name as c from information_schema.columns where table_schema = 'public'`)).rows) {
      if (!b.columns.has(r.t)) b.columns.set(r.t, new Set());
      b.columns.get(r.t)!.add(r.c);
    }
    return b;
  }

  /* ── Synthetic people ──────────────────────────────────────────────────── */

  async addUser(email: string): Promise<{ id: string; email: string; token: string }> {
    if (!/@[\w.-]+\.(test|example)$/.test(email)) throw new Error(`Synthetic users use a reserved domain, not ${email}`);
    const id = await this.exclusive(async () => (await this.db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0]!.id);
    this.users.set(id, { id, email });
    return { id, email, token: this.token(id, email) };
  }

  token(id: string, email: string): string {
    const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    return `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: id, email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 86_400 })}.${part("unsigned")}`;
  }

  /** The session cookie `@supabase/ssr` reads for this user. */
  session(user: { id: string; email: string; token: string }): string {
    const body = {
      access_token: user.token, token_type: "bearer", expires_in: 86_400, expires_at: Math.floor(Date.now() / 1000) + 86_400,
      refresh_token: "none", user: this.authUser(user),
    };
    return `base64-${Buffer.from(JSON.stringify(body)).toString("base64url")}`;
  }

  private authUser(u: { id: string; email: string }) {
    return { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  }

  /** Direct SQL, as the operator. */
  async sql<T = Record<string, unknown>>(text: string, args: unknown[] = []): Promise<T[]> {
    return this.exclusive(async () => (await this.db.query<T>(text, args)).rows);
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  /* ── HTTP ──────────────────────────────────────────────────────────────── */

  async listen(port = 0): Promise<string> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        void this.handle(req.method ?? "GET", req.url ?? "/", req.headers as Record<string, string>, Buffer.concat(chunks).toString()).then((r) => {
          res.writeHead(r.status, { "content-type": "application/json", ...(r.headers ?? {}) });
          res.end(r.body === undefined || req.method === "HEAD" ? undefined : JSON.stringify(r.body));
        });
      });
    });
    await new Promise<void>((done) => this.server!.listen(port, "127.0.0.1", done));
    const a = this.server.address();
    return `http://127.0.0.1:${typeof a === "object" && a ? a.port : port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((done) => (this.server ? this.server.close(() => done()) : done()));
    this.server?.closeAllConnections();
    await this.db.close();
  }

  async handle(method: string, url: string, headers: Record<string, string>, body: string): Promise<Res> {
    /* The hosted gateway refuses a long URL; `.in()` with hundreds of ids makes one. */
    if (url.length > 16_000) {
      this.errors.push({ method, path: url.slice(0, 120), status: 414, message: `URI of ${url.length} characters` });
      return { status: 414, body: { message: "URI too long" } };
    }
    const u = new URL(url, "http://local");
    const bearer = (headers.authorization ?? "").replace(/^Bearer /i, "");
    let role: "anon" | "authenticated" | "service_role" = "anon";
    let sub = "";
    if (bearer === SERVICE_KEY || (!bearer && headers.apikey === SERVICE_KEY)) role = "service_role";
    else if (bearer.split(".").length === 3) {
      try {
        sub = String((JSON.parse(Buffer.from(bearer.split(".")[1]!, "base64url").toString()) as { sub?: string }).sub ?? "");
      } catch {
        sub = "";
      }
      if (this.users.has(sub)) role = "authenticated";
      else sub = "";
    }
    const note = (r: Res): Res => {
      if (r.status >= 400) this.errors.push({ method, path: u.pathname + u.search, status: r.status, message: JSON.stringify(r.body) });
      return r;
    };
    if (u.pathname === "/auth/v1/user") {
      const user = this.users.get(sub);
      return user ? { status: 200, body: this.authUser(user) } : { status: 401, body: { code: 401, msg: "no session" } };
    }
    if (u.pathname === "/auth/v1/logout") return { status: 204 };
    if (!u.pathname.startsWith("/rest/v1/")) return note({ status: 501, body: { message: `not implemented: ${u.pathname}` } });
    return note(
      await this.exclusive(async () => {
        try {
          await this.db.exec("begin");
          await this.db.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [sub, JSON.stringify({ sub, role })]);
          await this.db.exec(`set local role ${role}`);
          const r = await this.rest(method, u, headers, body);
          await this.db.exec(r.status < 400 ? "commit" : "rollback");
          return r;
        } catch (error) {
          await this.db.exec("rollback");
          if (error instanceof Unsupported) return { status: 501, body: { code: "TEST501", message: `local backend: ${error.message}` } };
          if (error instanceof NotFound) return { status: 404, body: { code: "PGRST205", message: error.message } };
          const e = error as { code?: string; message?: string; detail?: string; hint?: string };
          const status = e.code === "42501" ? 403 : e.code === "23505" || e.code === "23503" ? 409 : e.code === "42P01" ? 404 : 400;
          return { status, body: { code: e.code ?? "XX000", message: e.message ?? String(error), details: e.detail ?? null, hint: e.hint ?? null } };
        }
      }),
    );
  }

  /* ── PostgREST ─────────────────────────────────────────────────────────── */

  private async rest(method: string, u: URL, headers: Record<string, string>, body: string): Promise<Res> {
    const name = u.pathname.slice("/rest/v1/".length);
    const prefer = headers.prefer ?? "";
    const single = /vnd\.pgrst\.object/.test(headers.accept ?? "");
    if (name.startsWith("rpc/")) return this.rpc(name.slice(4), method, u, body, single, prefer);
    if (!this.columns.has(name)) throw new NotFound(`Could not find the table 'public.${name}' in the schema cache`);
    const table = `public.${ident(name)}`;

    if (method === "GET" || method === "HEAD") {
      const sql = this.build(name, u.searchParams);
      return this.reply(`select * from (${sql.text}) q`, sql.count, prefer, single, method === "HEAD");
    }

    const filters = this.where(name, name, u.searchParams);
    const where = filters.length ? ` where ${filters.join(" and ")}` : "";
    const wants = /return=representation/.test(prefer);
    const select = u.searchParams.get("select") ?? "*";
    let mutation: string;
    if (method === "POST") {
      const parsed = JSON.parse(body) as Record<string, unknown> | Record<string, unknown>[];
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      if (!rows.length) return { status: 201, body: [] };
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const unknown = cols.find((c) => !this.columns.get(name)!.has(c));
      if (unknown) return { status: 400, body: { code: "PGRST204", message: `Could not find the '${unknown}' column of '${name}' in the schema cache` } };
      /* Without `missing=default`, PostgREST sends null for a key only some rows have. */
      const list = cols.map(ident).join(", ");
      mutation = cols.length
        ? `insert into ${table} as ${ident(name)} (${list}) select ${list} from json_populate_recordset(null::${table}, ${lit(JSON.stringify(rows))}::json)`
        : `insert into ${table} as ${ident(name)} default values`;
      const conflict = u.searchParams.get("on_conflict");
      const resolution = prefer.match(/resolution=(\w+)-duplicates/)?.[1];
      if (resolution) {
        const target = conflict
          ? conflict.split(",").map(ident).join(", ")
          : (await this.primaryKey(name)).map(ident).join(", ");
        mutation += resolution === "ignore" ? ` on conflict (${target}) do nothing` : ` on conflict (${target}) do update set ${cols.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ")}`;
      }
    } else if (method === "PATCH") {
      const patch = JSON.parse(body) as Record<string, unknown>;
      const cols = Object.keys(patch);
      const unknown = cols.find((c) => !this.columns.get(name)!.has(c));
      if (unknown) return { status: 400, body: { code: "PGRST204", message: `Could not find the '${unknown}' column of '${name}' in the schema cache` } };
      mutation = `update ${table} as ${ident(name)} set ${cols.map((c) => `${ident(c)} = r_.${ident(c)}`).join(", ")} from json_populate_record(null::${table}, ${lit(JSON.stringify(patch))}::json) r_${where}`;
    } else if (method === "DELETE") mutation = `delete from ${table} as ${ident(name)}${where}`;
    else throw new Unsupported(method);

    if (!wants) {
      const r = await this.db.query(mutation);
      return { status: method === "POST" ? 201 : 204, headers: /count=exact/.test(prefer) ? { "content-range": `*/${r.affectedRows ?? 0}` } : {} };
    }
    /* Read back through the same embedding builder, from the returned rows. */
    const sel = parseSelect(select);
    const returned = (await this.db.query(`${mutation} returning ${ident(name)}.*`)).rows as Record<string, unknown>[];
    let rows: Record<string, unknown>[] = returned;
    if (!sel.cols.includes("*") || sel.embeds.length) {
      if (sel.embeds.length) {
        if (!returned.every((r) => r.id)) throw new Unsupported("embedding on a returned row with no id");
        const p = new URLSearchParams({ select, id: `in.(${returned.map((r) => String(r.id)).join(",")})` });
        rows = returned.length && method !== "DELETE" ? ((await this.db.query(this.build(name, p).text)).rows as Record<string, unknown>[]) : [];
      } else {
        const missing = sel.cols.find((c) => !this.columns.get(name)!.has(c.split(":").pop()!));
        if (missing) return { status: 400, body: { code: "42703", message: `column ${name}.${missing} does not exist` } };
        rows = returned.map((r) => Object.fromEntries(sel.cols.map((c) => [c.split(":")[0], r[c.split(":").pop()!]])));
      }
    }
    if (single && rows.length !== 1) return { status: 406, body: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows` } };
    return { status: method === "POST" ? 201 : 200, body: single ? rows[0] : rows };
  }

  private async primaryKey(table: string): Promise<string[]> {
    return (await this.db.query<{ a: string }>(`select a.attname as a from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = $1::regclass and i.indisprimary`, [`public.${table}`])).rows.map((r) => r.a);
  }

  private async reply(text: string, count: string, prefer: string, single: boolean, head: boolean): Promise<Res> {
    const headers: Record<string, string> = {};
    const rows = head ? [] : ((await this.db.query(text)).rows as Record<string, unknown>[]);
    if (/count=/.test(prefer)) {
      const n = (await this.db.query<{ n: number }>(count)).rows[0]!.n;
      headers["content-range"] = `${rows.length ? `0-${rows.length - 1}` : "*"}/${n}`;
    } else if (head) await this.db.query(text);
    if (single && !head && rows.length !== 1) return { status: 406, body: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows` } };
    return { status: 200, headers, body: single ? rows[0] : rows };
  }

  private async rpc(fn: string, method: string, u: URL, body: string, single: boolean, prefer: string): Promise<Res> {
    const reserved = new Set(["select", "order", "limit", "offset"]);
    const args: Record<string, unknown> = method === "POST" ? (body ? (JSON.parse(body) as Record<string, unknown>) : {}) : Object.fromEntries([...u.searchParams].filter(([k]) => !reserved.has(k)));
    const keys = Object.keys(args);
    const cands = (
      await this.db.query<{ names: string[] | null; types: string[]; nargs: number; ndef: number; retset: boolean; ret: string; kind: string; out: boolean }>(
        `select p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes) t) as types, p.pronargs as nargs, p.pronargdefaults as ndef,
                p.proretset as retset, t.typname as ret, t.typtype as kind, p.proallargtypes is not null as out
           from pg_proc p join pg_type t on t.oid = p.prorettype where p.pronamespace = 'public'::regnamespace and p.proname = $1`, [fn])
    ).rows;
    const f = cands.find((c) => {
      const inputs = (c.names ?? []).slice(0, c.nargs);
      return keys.every((k) => inputs.includes(k)) && inputs.slice(0, c.nargs - c.ndef).every((n) => keys.includes(n));
    });
    if (!f) return { status: 404, body: { code: "PGRST202", message: `Could not find the function public.${fn}(${keys.join(", ")}) in the schema cache` } };
    const call = keys
      .map((k) => {
        const type = f.types[(f.names ?? []).indexOf(k)]!;
        const v = args[k];
        if (v === null || v === undefined) return `${ident(k)} => null::${type}`;
        if (type.startsWith("json")) return `${ident(k)} => ${lit(JSON.stringify(v))}::${type}`;
        if (Array.isArray(v)) return `${ident(k)} => ${v.length ? `array[${v.map((x) => lit(String(x))).join(",")}]` : "'{}'"}::${type}`;
        return `${ident(k)} => ${lit(String(v))}::${type}`;
      })
      .join(", ");
    const from = `public.${ident(fn)}(${call})`;
    if (f.ret === "void") {
      await this.db.query(`select ${from}`);
      return { status: 204 };
    }
    const composite = f.kind === "c" || f.out || f.ret === "record";
    if (f.retset || composite) {
      const limit = Math.min(MAX_ROWS, Number(u.searchParams.get("limit") ?? MAX_ROWS));
      const rows = (await this.db.query<Record<string, unknown>>(`select * from ${from} limit ${limit}`)).rows;
      const out = composite ? rows : rows.map((r) => Object.values(r)[0]);
      if (single) return rows.length === 1 ? { status: 200, body: out[0] } : { status: 406, body: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows` } };
      return { status: 200, body: f.retset ? out : out[0], headers: /count=/.test(prefer) ? { "content-range": `*/${rows.length}` } : {} };
    }
    const row = (await this.db.query<{ v: unknown }>(`select ${from} as v`)).rows[0]!;
    return { status: 200, body: row.v };
  }

  private where(table: string, alias: string, params: URLSearchParams, prefix = ""): string[] {
    const out: string[] = [];
    const reserved = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
    for (const [key, value] of params) {
      if (!key.startsWith(prefix)) continue;
      const k = key.slice(prefix.length);
      if ((!prefix && reserved.has(k)) || /^(order|limit|offset)$/.test(k)) continue;
      if (k === "or" || k === "and") { out.push(logic(ident(alias), value, k)); continue; }
      if (/^not\.(or|and)$/.test(k)) { out.push(`not ${logic(ident(alias), value, k.slice(4) as "or" | "and")}`); continue; }
      if (/\./.test(k.replace(/->>?/g, ""))) continue; // an embed's filter
      if (!this.columns.get(table)?.has(k.split("->")[0]!)) throw Object.assign(new Error(`column ${table}.${k} does not exist`), { code: "42703" });
      out.push(condition(ident(alias), k, value));
    }
    return out;
  }

  private fk(parent: string, e: Embed): { fk: Fk; many: boolean } {
    const byHint = (f: Fk) => !e.hint || f.name === e.hint || f.cols.includes(e.hint);
    const out = this.fks.filter((f) => f.table === parent && f.ref === e.target && byHint(f));
    const back = this.fks.filter((f) => f.table === e.target && f.ref === parent && byHint(f));
    if (parent === e.target) {
      if (out.length !== 1) throw Object.assign(new Error(`ambiguous relationship ${parent} → ${e.target}`), { code: "PGRST201" });
      return { fk: out[0]!, many: e.hint !== null && e.hint !== out[0]!.name ? false : false };
    }
    if (out.length + back.length === 0) throw Object.assign(new Error(`Could not find a relationship between '${parent}' and '${e.target}' in the schema cache`), { code: "PGRST200" });
    if (out.length + back.length > 1) throw Object.assign(new Error(`more than one relationship was found for '${parent}' and '${e.target}'`), { code: "PGRST201" });
    return out.length ? { fk: out[0]!, many: false } : { fk: back[0]!, many: true };
  }

  private build(table: string, params: URLSearchParams): { text: string; count: string } {
    const sel = parseSelect(params.get("select") ?? "*");
    const inner: string[] = [];
    const list = this.fields(table, table, sel, params, "", inner);
    const where = [...this.where(table, table, params), ...inner];
    const w = where.length ? ` where ${where.join(" and ")}` : "";
    const limit = Math.min(MAX_ROWS, Number(params.get("limit") ?? MAX_ROWS));
    const offset = Number(params.get("offset") ?? 0);
    const from = `public.${ident(table)} as ${ident(table)}${w}`;
    return {
      text: `select ${list} from ${from}${this.order(table, params.get("order"), sel)} limit ${limit} offset ${offset}`,
      count: `select count(*)::int as n from ${from}`,
    };
  }

  private order(alias: string, order: string | null, sel?: Sel): string {
    if (!order) return "";
    return ` order by ${split(order)
      .map((o) => {
        const rel = o.match(/^(\w+)\((\w+)\)(.*)$/);
        const [col, ...mods] = (rel ? `${rel[2]}${rel[3]}` : o).split(".");
        const m = mods.map((x) => ({ asc: "asc", desc: "desc", nullsfirst: "nulls first", nullslast: "nulls last" })[x] ?? "").join(" ");
        if (rel) {
          const e = sel?.embeds.find((x) => x.alias === rel[1] || x.target === rel[1]);
          if (!e) throw new Unsupported(`order by ${o}`);
          const { fk } = this.fk(alias, e);
          return `(select r_.${ident(col!)} from public.${ident(e.target)} r_ where ${fk.cols.map((c, i) => `r_.${ident(fk.refCols[i]!)} = ${ident(alias)}.${ident(c)}`).join(" and ")}) ${m}`;
        }
        return `${column(ident(alias), col!)} ${m}`;
      })
      .join(", ")}`;
  }

  private fields(table: string, alias: string, sel: Sel, params: URLSearchParams, prefix: string, inner: string[]): string {
    const out = sel.cols.map((c) => {
      if (c === "*") return `${ident(alias)}.*`;
      const m = c.match(/^(?:(\w+):)?([\w>-]+)(?:::(\w+))?$/);
      if (!m) throw new Unsupported(`select ${c}`);
      const base = m[2]!.split("->")[0]!;
      if (!this.columns.get(table)?.has(base)) throw Object.assign(new Error(`column ${table}.${base} does not exist`), { code: "42703" });
      return `${column(ident(alias), m[2]!)}${m[3] ? `::${ident(m[3])}` : ""} as ${ident(m[1] ?? m[2]!.split(/->>?/).pop()!)}`;
    });
    for (const e of sel.embeds) {
      const { fk, many } = this.fk(table, e);
      const a = `${alias}_${e.alias}`;
      const join = fk.cols.map((c, i) => (many ? `${ident(a)}.${ident(c)} = ${ident(alias)}.${ident(fk.refCols[i]!)}` : `${ident(a)}.${ident(fk.refCols[i]!)} = ${ident(alias)}.${ident(c)}`)).join(" and ");
      const sub: string[] = [];
      const p = `${prefix}${e.alias}.`;
      const list = this.fields(e.target, a, e.select, params, p, sub) || "1";
      const conds = [join, ...this.where(e.target, a, params, p), ...sub];
      const base = `from public.${ident(e.target)} as ${ident(a)} where ${conds.join(" and ")}`;
      const lim = params.get(`${p}limit`);
      const q = `select ${list} ${base}${this.order(a, params.get(`${p}order`))}${lim ? ` limit ${Number(lim)}` : ""}`;
      if (e.inner) inner.push(`exists (select 1 ${base})`);
      if (!e.select.cols.length && !e.select.embeds.length) continue;
      out.push(many ? `(select coalesce(json_agg(row_to_json(x_)), '[]'::json) from (${q}) x_) as ${ident(e.alias)}` : `(select row_to_json(x_) from (${q} limit 1) x_) as ${ident(e.alias)}`);
    }
    return out.join(", ");
  }
}
