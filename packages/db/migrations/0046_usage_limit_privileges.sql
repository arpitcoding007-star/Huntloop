-- 0046 — `usage_limit` is internal, so sessions may not call it.
--
-- `usage_limit(org, metric)` (0007) is SECURITY DEFINER and has no caller
-- check: given any workspace's id it returns that workspace's plan limit for
-- a metric. Nothing outside the database calls it — its only callers are the
-- quota functions (`check_quota`, `increment_usage`, their `_internal`
-- twins, and the provider ceiling in 0033), all SECURITY DEFINER themselves,
-- so they run with the owner's privilege and keep working after this.
--
-- `from public` alone would not be enough on Supabase: the platform's default
-- privileges grant EXECUTE on every new function in `public` to `anon`,
-- `authenticated` and `service_role` by name, and a revoke from PUBLIC leaves
-- those grants standing. Found by the SECURITY DEFINER review recorded in
-- docs/spec/07-specification-gap-report.md (REC-13); the other 36
-- session-callable definer functions check the caller, are trigger
-- functions, or are gated by a single-use token (`record_unsubscribe`).

revoke execute on function public.usage_limit(uuid, text) from public;

-- The named roles exist on Supabase and not in a bare Postgres (the PGlite
-- test harness), so this half tolerates their absence, as in 0011 and 0037.
do $$
begin
  revoke execute on function public.usage_limit(uuid, text) from anon, authenticated;
  grant execute on function public.usage_limit(uuid, text) to service_role;
exception when undefined_object then null;
end $$;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0046_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
