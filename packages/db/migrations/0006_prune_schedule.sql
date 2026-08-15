-- ============================================================================
-- 0006 — Schedule the rate-limit sweep
--
-- Backlog RL-02. `prune_rate_limits()` was written in 0005 and nothing ever
-- called it, so `rate_limits` grows one row per user per action per window,
-- forever. Nothing breaks — until the table is large enough that the delete
-- which would have fixed it degrades into a sequential scan.
--
-- pg_cron rather than a Vercel Cron route, for the same reason 0005 chose
-- Postgres over Redis: this is housekeeping on a table, it belongs next to the
-- table, and the alternative costs an HTTP endpoint that has to authenticate
-- as nobody. A route handler could not use the service-role client anyway —
-- that import is banned from apps/ by two independent checks — so it would
-- have meant granting EXECUTE on a SECURITY DEFINER delete function to `anon`
-- and guarding it with a shared secret. Worse in every respect.
--
-- ── The guard ──────────────────────────────────────────────────────────────
-- Every migration in this directory also runs against PGlite in the test
-- suite, and PGlite has no pg_cron. Without the availability check this file
-- would fail there, taking all 39 checks with it.
--
-- Everything after the check is dynamic (`execute`) rather than direct: the
-- `cron` schema does not exist until the extension is created, and plpgsql
-- would otherwise try to resolve `cron.schedule` while parsing the block that
-- creates it.
--
-- ── What is NOT verified ───────────────────────────────────────────────────
-- The scheduled half of this has never run. PGlite skips it by design, so the
-- test suite proves the file is syntactically valid and proves nothing about
-- whether the job is created on a live project. It is written against
-- Supabase's documented pg_cron setup and needs confirming the first time
-- migrations are applied for real — `select * from cron.job` is the check.
-- See SETUP.md.
--
-- It fails loudly rather than swallowing a privilege error. A sweep that
-- silently did not get scheduled is the exact failure this migration exists
-- to fix, and it would be invisible for months.
-- ============================================================================

do $$
declare
  v_scheduled boolean;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice
      'pg_cron is unavailable here, so prune_rate_limits() is not scheduled. '
      'Expected under PGlite; on a hosted project this means the sweep is NOT '
      'running and rate_limits will grow without bound.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';

  -- Idempotent: migrations get replayed, and cron.schedule() with an existing
  -- job name updates in place on newer pg_cron but errors on older versions.
  -- Unscheduling first behaves the same way on both.
  execute 'select exists (select 1 from cron.job where jobname = $1)'
    into v_scheduled
    using 'prune-rate-limits';

  if v_scheduled then
    execute 'select cron.unschedule($1)' using 'prune-rate-limits';
  end if;

  -- 03:17 UTC daily. Off the hour on purpose — every scheduled job in every
  -- system defaults to :00, and the point of a sweep is that nobody notices it.
  --
  -- One day of retention: long enough that the longest window in use (1 hour)
  -- is closed many times over, short enough that the table stays small. Rows
  -- are counters, not history — ai_runs is where spend is recorded.
  execute 'select cron.schedule($1, $2, $3)'
    using 'prune-rate-limits',
          '17 3 * * *',
          'select public.prune_rate_limits()';
end
$$;
