-- 0021 — evidence may be about a competitor.
--
-- ── The gap 0015 left ────────────────────────────────────────────────────
--
-- `0015` created `competitor_evidence (competitor_id, evidence_id, field)`,
-- a join table whose whole purpose is to point at `evidence` rows describing
-- a competitor. But `evidence.subject_type` has carried a CHECK since `0002`
-- allowing only `company | opportunity | contact | signal`, so no row the
-- join table could legitimately reference was insertable. The join table was
-- correct and unusable — the research job would have failed on its first
-- insert, at runtime, in production.
--
-- ── Why not reuse `subject_type = 'company'` ─────────────────────────────
--
-- Tempting, because `0015` deliberately makes a competitor *be* a company:
-- `competitors.company_id` is the identity, reusing `0012`'s resolver rather
-- than growing a second one. So the evidence could hang off the company row.
--
-- It must not, for two reasons.
--
-- **`competitors.company_id` is nullable.** A competitor named during
-- onboarding has a name and no domain until the resolver works out what it
-- is. Research is exactly what would give it one, so requiring the identity
-- before the evidence inverts the order the product actually runs in.
--
-- **The claims are about a different subject.** "Charges per seat" is true of
-- the competitor-as-vendor. If it were written against the company row it
-- would land in the same evidence list as "hiring six engineers" on a
-- prospect — and `flag_contradictions` groups by `(subject, field)`, so a
-- competitor that is also somebody's prospect would have its pricing
-- contradict its prospect research. Two subjects, two subject_types.

alter table evidence drop constraint evidence_subject_type_check;

alter table evidence
  add constraint evidence_subject_type_check
  check (subject_type in ('company', 'opportunity', 'contact', 'signal', 'competitor'));

-- ── The lookup the competitor screen makes ───────────────────────────────
--
-- "Everything we know about this competitor, newest first" reaches `evidence`
-- through `competitor_evidence`, but the research job reaches it the other
-- way — "the row I wrote for this field last time" — and that is a
-- subject-scoped read the existing indexes already serve. What they do not
-- serve is the un-fielded narrative rows, which is what this covers.
create index evidence_competitor_idx
  on evidence (org_id, subject_id, observed_at desc)
  where subject_type = 'competitor' and deleted_at is null;
