-- 0020 — evidence gains reliability, a subject field, and contradictions.
--
-- ── What `0002` got right, and is not changed ────────────────────────────
--
-- The `evidence` table is the best-designed thing in this schema. Three
-- constraints in particular carry real weight and none of them moves here:
--
--   evidence_fact_needs_source        a fact with no URL is an inference
--                                     wearing a fact's label
--   evidence_unknown_has_no_confidence "high confidence that we don't know"
--                                     is a category error that would render
--                                     as a credible-looking badge
--   event_date vs observed_at         a six-month-old event seen yesterday
--                                     is still six months old
--
-- The first of those caught a real bug while `enrich_company` was being
-- written: the handler wrote provider assertions as `fact` with no source,
-- and the CHECK refused them. That is the constraint working exactly as
-- designed, and the fix was to give the claim a URL where it can actually be
-- observed rather than to weaken the rule.
--
-- ── What was missing ─────────────────────────────────────────────────────
--
-- **Reliability.** Freshness existed; trust did not. "Their careers page says
-- they are hiring six engineers" and "a model inferred they are growing" are
-- both evidence, and nothing distinguished how much weight they deserve.
--
-- **A subject field.** Every claim was free text, so "employee count" arriving
-- from three sources produced three rows with no way to know they were about
-- the same attribute — which makes deduplication impossible and contradiction
-- undetectable.
--
-- **Contradiction.** `superseded_by` handles replacement. It does not handle
-- two live sources that disagree, which is the interesting case: the UI
-- should show both rather than silently picking one.

alter table evidence
  -- How much weight this deserves, independent of how confident the claim is.
  -- The two are different: a first-party statement can be low confidence
  -- (vague wording) and an inference can be high confidence (overwhelming
  -- circumstantial evidence). Conflating them would collapse the distinction
  -- between "how sure are we" and "how good is the source".
  --
  --   first_party       the company said it themselves — their site, their
  --                     filing, their job posting. The strongest.
  --   provider_attested a data provider asserts it. Checkable, attributable,
  --                     and not something we observed.
  --   press             a publication reported it.
  --   user_asserted     somebody at the customer typed it. Authoritative
  --                     about their own dealings, unverifiable by us.
  --   inferred          derived by a model from other evidence. Weakest, and
  --                     the one that must never be presented as observation.
  add column reliability text
    check (reliability is null or reliability in (
      'first_party', 'provider_attested', 'press', 'user_asserted', 'inferred'
    )),

  -- Which attribute this claim is about, when it is about one.
  --
  -- Nullable on purpose: most evidence is narrative ("they are opening a
  -- London office") and does not map to a column. The ones that do —
  -- employee_count, industry, funding_stage — become deduplicable and
  -- comparable, which is what makes the two features below possible at all.
  add column field text,

  -- Set when another live claim about the same field disagrees. Not a
  -- foreign key to one row, because three sources can disagree three ways and
  -- picking one to point at would be inventing a winner.
  add column contradicted boolean not null default false,

  -- A hash of the normalized claim text, for cross-source deduplication.
  -- `EVD-02`: the same funding round reported by three outlets is one claim
  -- with three citations, not three claims.
  add column claim_hash text;

create index evidence_field_idx
  on evidence (org_id, subject_type, subject_id, field)
  where field is not null and deleted_at is null;

create index evidence_claim_hash_idx
  on evidence (org_id, subject_type, subject_id, claim_hash)
  where claim_hash is not null and deleted_at is null;

-- One live claim per (subject, field, source). Three sources may each assert
-- an employee count — that is the contradiction case, and it must remain
-- representable — but one source asserting it twice is a duplicate.
--
-- `coalesce` on the source columns because a provider claim has no
-- `source_id` and a scanned claim has no `source_label`; without it every
-- provider row would collide with every other provider row on the same field.
create unique index evidence_one_per_source_field
  on evidence (
    org_id, subject_type, subject_id, field,
    coalesce(source_id::text, ''), coalesce(source_url, '')
  )
  where field is not null and deleted_at is null;

-- ── Marking a contradiction ───────────────────────────────────────────────
--
-- Called after evidence is written. Deliberately a separate step rather than
-- a trigger: a trigger would fire once per row during a bulk insert and
-- recompute the same set N times, and the answer is only meaningful once the
-- whole batch has landed.
--
-- The comparison is on the *claim text*, not on a parsed value. Parsing "180
-- employees" and "about 200 employees" into numbers to decide whether they
-- disagree needs a tolerance, and a tolerance is a policy nobody has set.
-- Two different strings from two sources about one field is a flag worth
-- raising; a person reading both is a better judge than a threshold.

create or replace function public.flag_contradictions(
  p_org     uuid,
  p_subject_type text,
  p_subject uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_n integer;
begin
  with live as (
    select e.id, e.field, lower(trim(e.claim)) as claim
    from public.evidence e
    where e.org_id = p_org
      and e.subject_type = p_subject_type
      and e.subject_id = p_subject
      and e.field is not null
      and e.deleted_at is null
      and e.superseded_by is null
  ),
  disagreeing as (
    select a.id
    from live a
    join live b on b.field = a.field and b.id <> a.id and b.claim <> a.claim
  )
  update public.evidence e
    set contradicted = (e.id in (select id from disagreeing)),
        updated_at = now()
    where e.org_id = p_org
      and e.subject_type = p_subject_type
      and e.subject_id = p_subject
      and e.field is not null
      and e.deleted_at is null
      -- Only rows whose flag would change. Without this the statement rewrites
      -- every evidence row for the subject on every call, which on a
      -- well-researched company is hundreds of rows and a `updated_at` that
      -- stops meaning anything.
      and e.contradicted <> (e.id in (select id from disagreeing));

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── Backfill ──────────────────────────────────────────────────────────────
--
-- Existing rows get a reliability inferred from what they already carry,
-- which is the only honest source for it. A row with a `source_id` came from
-- a scanned source; one with a URL and no source came from an ad-hoc fetch;
-- an `inference` is inferred by definition. Everything else stays null rather
-- than being assigned a value nobody can justify — null means "we do not
-- know how reliable this is", which is true of a row written before the
-- column existed.

update evidence
  set reliability = case
    when kind = 'inference' then 'inferred'
    when source_id is not null then 'press'
    when source_url is not null then 'first_party'
    else null
  end
  where reliability is null and deleted_at is null;

do $$
begin
  revoke execute on function public.flag_contradictions(uuid, text, uuid)
    from public, anon, authenticated;
  grant execute on function public.flag_contradictions(uuid, text, uuid) to service_role;
exception when undefined_object or undefined_function then null;
end $$;
