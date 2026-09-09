-- ============================================================================
-- 0026 — The research a product row was built from, kept
--
-- ── Why this is a second onboarding migration ────────────────────────────
--
-- `0024` made onboarding persist its answers. Writing the code that consumes
-- them surfaced something `0024` had not: `research_company` establishes five
-- things about a company — what it sells, who buys it, the problem it solves,
-- its business model, and the likely buying trigger — and `products` has a
-- column for exactly one of them.
--
-- `description` took `sells`, `value_props` took `problem`, and the other
-- three were dropped on the floor. That was survivable while nothing read
-- them. It stopped being survivable the moment `draft_icp` existed, because
-- that task's entire honesty mechanism is a closed set of citations built from
-- those five sentences: a field it returns must quote the research sentence it
-- followed from. With two of the five sentences persisted, the ICP could only
-- ever be drafted from two, and re-drafting it later — after an edit, on a new
-- device, or a month on — would silently produce a thinner profile than the
-- first run did.
--
-- ── Why a jsonb column and not five text columns ─────────────────────────
--
-- Because the thing being stored is not five strings. Every finding carries a
-- claim kind (`fact` / `inference` / `unknown`), a confidence, and — for a
-- fact — the URL it was read on. That structure is the whole reason the
-- onboarding review screen can show a user which parts of their profile the
-- site *stated* and which parts a model *concluded*, and flattening it to text
-- would throw away precisely the distinction this codebase is built around.
--
-- Five columns would also have to grow to six the day `RESEARCH_FIELDS` does,
-- and `RESEARCH_FIELDS` is a product decision that lives in `packages/ai`.
--
-- ── Why not `evidence` ───────────────────────────────────────────────────
--
-- The obvious home, and it does not fit. `evidence.subject_id` references a
-- subject, and the four permitted subject types are company, opportunity,
-- contact and signal — where `company` means a row in `companies`, which holds
-- *prospects*. The customer's own company is not one and must not become one:
-- inventing a row there to satisfy the foreign key would put a fabricated
-- prospect in every workspace, and it would be scored, ranked and possibly
-- contacted.
--
-- So the research lives with the product it describes, which is the thing it
-- is actually about.
-- ============================================================================

alter table public.products
  -- The `CompanyUnderstanding` from `research_company`, whole and as returned.
  --
  -- Denormalised on purpose and not read by SQL: nothing filters on it, and
  -- the readers are `draft_icp` (which needs the sentences) and the onboarding
  -- review screen (which needs the claim kinds). Shredding it into columns
  -- would give both of them reassembly work and would give the reassembly two
  -- chances to disagree.
  add column if not exists research jsonb,

  -- When it was read, and whether a model actually did the reading.
  --
  -- `research_is_live = false` means the deployment had no ANTHROPIC_API_KEY
  -- and the row holds the worked example every onboarding screen labels as
  -- such. Storing that distinction is what stops a demo profile being promoted
  -- to a real one by the next thing that reads it — the same §7 rule the
  -- screens enforce visually, made durable.
  add column if not exists researched_at timestamptz,
  add column if not exists research_is_live boolean not null default false;

-- A shape check, deliberately weak — the same posture `0013` takes with
-- `icps.criteria`. Full validation belongs where it can produce a message a
-- person can act on. What this stops is a scalar or an array landing in a
-- column every reader will treat as an object with a `findings` array.
alter table public.products
  drop constraint if exists products_research_is_object;

alter table public.products
  add constraint products_research_is_object
    check (research is null or jsonb_typeof(research) = 'object');

comment on column public.products.research is
  'The research_company output this product row was built from, whole. Kept '
  'because draft_icp cites these sentences and the review screen renders '
  'their claim kinds — both of which are lost if only the prose survives.';

comment on column public.products.research_is_live is
  'False when no model was configured and this is the labelled worked example. '
  'Durable version of the warning the onboarding screens show, so nothing '
  'downstream promotes a demo profile to a real one.';

-- No RLS changes. `products` has carried `tenant_read` / `tenant_write` since
-- `0002`, and a policy is over rows rather than columns, so the new columns
-- are already covered by both. Adding a policy here would be a second place to
-- get the tenant boundary wrong.
