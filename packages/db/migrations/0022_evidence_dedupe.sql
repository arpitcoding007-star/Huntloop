-- 0022 — the same claim from three outlets is one claim with three citations.
--
-- ── What 0020 left half-built ────────────────────────────────────────────
--
-- `0020` added `evidence.claim_hash` with a comment describing `EVD-02`, and
-- an index over it. Nothing ever wrote it. A nullable column that is always
-- null, behind a partial index that therefore covers nothing, is worse than
-- an absent one: it reads in the schema like a feature.
--
-- Two things were missing and this adds both.
--
-- **The hash had no writer.** Every insert site would have had to remember to
-- compute it — the scanner, the researcher, the enricher, the competitor job,
-- and the two web actions. A rule enforced in six places is a rule that holds
-- in five.
--
-- **The citations had nowhere to live.** "One claim with three citations"
-- needs somewhere to put citations two and three. Without it, deduplication
-- can only mean deletion, and deleting the second outlet's report destroys
-- the corroboration that makes the claim worth more than a single report.
--
-- ── Why the hash is generated rather than written ────────────────────────
--
-- It is a pure function of `claim`, so a writer that computes it is a writer
-- that can compute it *differently* — a trimmed string here, a lowercased one
-- there — and two spellings of the same normalisation produce two hashes and
-- no deduplication, silently. Postgres computing it removes the possibility.
--
-- The column is dropped and re-added rather than backfilled because it is
-- null in every row that exists; there is nothing to preserve.

alter table evidence drop column claim_hash;

-- ── The normalisation, and its limits ────────────────────────────────────
--
-- Lowercase, strip everything that is not a letter, digit or space, collapse
-- runs of whitespace, trim. That makes "Raised $12M Series B." and "raised
-- $12m series b" one claim, which is the case `EVD-02` names.
--
-- The trim is not cosmetic and the first version of this omitted it: a claim
-- ending in a full stop normalises to a trailing space and one ending in a
-- word does not, so the two most common spellings of the same sentence hashed
-- differently and nothing deduplicated. It failed exactly the way an
-- unenforced rule fails — quietly, with the feature apparently present.
--
-- It does NOT make "raised $12M" and "raised twelve million dollars" one
-- claim, and it is not trying to. Semantic equivalence needs a model, a model
-- would occasionally merge two genuinely different funding rounds into one,
-- and a merge is far harder to notice than a duplicate. Duplicates are
-- visible and annoying; a wrongly merged claim is invisible and wrong.
alter table evidence
  add column claim_hash text
    generated always as (
      md5(
        btrim(
          regexp_replace(
            regexp_replace(lower(claim), '[^a-z0-9 ]', ' ', 'g'),
            '\s+', ' ', 'g'
          )
        )
      )
    ) stored;

create index evidence_claim_hash_idx
  on evidence (org_id, subject_type, subject_id, claim_hash)
  where deleted_at is null;

-- ── Citations ────────────────────────────────────────────────────────────
--
-- One row per place a claim was seen. The surviving `evidence` row keeps its
-- own source columns — every existing reader depends on them and none of this
-- is worth a rewrite of the evidence list — and this table holds the full set,
-- including the winner's own.
--
-- The value is corroboration. "Three outlets reported this" is a materially
-- different fact from "one blog said this", and before this table the second
-- and third reports were either duplicate rows or nothing at all.

create table evidence_citations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  evidence_id  uuid not null references evidence(id) on delete cascade,

  source_id    uuid references sources(id) on delete set null,
  source_url   text,
  excerpt      text,
  -- When this particular sighting was recorded. The claim's own `observed_at`
  -- becomes the earliest of them, because the question "how long have we
  -- known this" is answered by the first sighting, not the latest duplicate.
  observed_at  timestamptz not null default now(),

  created_at   timestamptz not null default now()
);

-- The same outlet reporting the same claim twice is one citation. An index
-- rather than a table constraint because a UNIQUE constraint cannot hold an
-- expression, and the coalesces are load-bearing: a provider claim has no
-- `source_id` and a scanned one may have no `source_url`, so without them
-- every such row would collide with every other.
create unique index evidence_citations_unique_source
  on evidence_citations (
    org_id, evidence_id, coalesce(source_id::text, ''), coalesce(source_url, '')
  );

create index evidence_citations_evidence_idx
  on evidence_citations (org_id, evidence_id, observed_at desc);

alter table evidence_citations enable row level security;

create policy tenant_read on public.evidence_citations
  for select using (org_id in (select public.user_org_ids()));
create policy tenant_write on public.evidence_citations
  for all
  using (public.has_org_role(org_id, 'member'))
  with check (public.has_org_role(org_id, 'member'));

-- ── Merging duplicates ───────────────────────────────────────────────────
--
-- Called after a batch of evidence lands, exactly like `flag_contradictions`
-- and for the same reason: run per-row it would recompute the same grouping
-- once per insert, and the answer is only meaningful once the batch is in.
--
-- Ordering of the winner, and why it is not "the newest":
--
--   1. reliability, strongest first. A first-party statement outranks a press
--      report of the same claim, and the surviving row is the one a screen
--      shows.
--   2. `kind`, fact before inference.
--   3. `observed_at`, earliest first. Between two equally good sources the
--      first sighting is the original report and the rest are pickup.
--
-- Losers are soft-deleted with `superseded_by` pointing at the winner, not
-- hard-deleted. Anything already citing a loser — a trigger, a competitor
-- signal, a score's rule trace — keeps resolving, and follows the pointer to
-- the row that replaced it.

create or replace function public.merge_duplicate_evidence(
  p_org          uuid,
  p_subject_type text,
  p_subject      uuid
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_merged integer;
begin
  with live as (
    select
      e.id, e.claim_hash, e.source_id, e.source_url, e.excerpt, e.observed_at,
      row_number() over (
        partition by e.claim_hash
        order by
          case e.reliability
            when 'first_party'       then 1
            when 'provider_attested' then 2
            when 'press'             then 3
            when 'user_asserted'     then 4
            when 'inferred'          then 5
            else 6
          end,
          case e.kind when 'fact' then 1 when 'inference' then 2 else 3 end,
          e.observed_at,
          e.id
      ) as rank
    from public.evidence e
    where e.org_id = p_org
      and e.subject_type = p_subject_type
      and e.subject_id = p_subject
      and e.deleted_at is null
      and e.superseded_by is null
  ),
  groups as (
    select claim_hash, count(*) as n from live group by claim_hash having count(*) > 1
  ),
  winners as (
    select l.* from live l join groups g on g.claim_hash = l.claim_hash where l.rank = 1
  ),
  losers as (
    select l.*, w.id as winner_id
    from live l
    join groups g on g.claim_hash = l.claim_hash
    join winners w on w.claim_hash = l.claim_hash
    where l.rank > 1
  ),
  -- The winner's own sighting, so a citation list is complete rather than
  -- "the other two". Without this the first outlet to report something is the
  -- one that disappears from the list of who reported it.
  cited as (
    insert into public.evidence_citations
      (org_id, evidence_id, source_id, source_url, excerpt, observed_at)
    select p_org, w.id, w.source_id, w.source_url, w.excerpt, w.observed_at from winners w
    union all
    select p_org, l.winner_id, l.source_id, l.source_url, l.excerpt, l.observed_at from losers l
    on conflict do nothing
    returning 1
  ),
  -- The claim is as old as its earliest sighting. A duplicate arriving today
  -- must not make a six-month-old report look like today's news — the same
  -- distinction `event_date` versus `observed_at` exists to keep.
  aged as (
    update public.evidence e
      set observed_at = least(e.observed_at, (
            select min(l.observed_at) from losers l where l.winner_id = e.id
          )),
          updated_at = now()
      where e.id in (select distinct winner_id from losers)
      returning 1
  ),
  merged as (
    update public.evidence e
      set superseded_by = l.winner_id,
          deleted_at = now(),
          updated_at = now()
      from losers l
      where e.id = l.id
      returning 1
  )
  select count(*)::int into v_merged from merged;

  return v_merged;
end;
$$;

revoke execute on function public.merge_duplicate_evidence(uuid, text, uuid) from public;

comment on function public.merge_duplicate_evidence(uuid, text, uuid) is
  'EVD-02. Collapses evidence rows whose normalized claim text is identical '
  'into one row with an evidence_citations entry per source. Returns the '
  'number of rows superseded.';
