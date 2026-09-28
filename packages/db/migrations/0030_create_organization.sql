-- 0030 — creating a workspace.
--
-- ── The defect ───────────────────────────────────────────────────────────
--
-- Onboarding step two inserted into `organizations` and then `memberships`
-- through the signed-in user's own client. Neither could ever succeed:
--
--   · `organizations` has `org_read` (select) and `org_write` (update) and no
--     insert policy, so every insert answered "new row violates row-level
--     security policy for table organizations";
--   · `membership_write` requires the caller to already be an admin of the
--     org — which nobody is, of an org they are creating;
--   · and `.insert().select("id")` needs the new row to be *readable*, which
--     `org_read` refuses until the membership exists.
--
-- A chicken-and-egg that no policy can untie without also letting any user
-- attach themselves to any org. So creation is one SECURITY DEFINER function
-- that does both rows in one transaction and nothing else.
--
-- ── What it checks, since it is the whole authorization ──────────────────
--
--   · an authenticated caller — the owner is always `auth.uid()`, never an
--     argument, so nobody can create a workspace on someone else's behalf;
--   · a slug in the shape the app generates;
--   · a ceiling on workspaces one person may own, so a script with a session
--     cannot squat every company's slug.
--
-- A taken slug raises `unique_violation` (23505) unchanged: the caller already
-- retries with a numeric suffix on exactly that code.

create or replace function public.create_organization(
  p_name   text,
  p_slug   text,
  p_domain text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user  uuid := auth.uid();
  v_org   uuid;
  v_owned int;
begin
  if v_user is null then
    raise exception 'create_organization requires an authenticated caller';
  end if;

  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{0,62}$' then
    raise exception 'invalid workspace address';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'a workspace needs a name';
  end if;

  select count(*) into v_owned
    from public.memberships m
    join public.organizations o on o.id = m.org_id
   where m.user_id = v_user
     and m.role = 'owner'
     and m.deleted_at is null
     and o.deleted_at is null;

  if v_owned >= 20 then
    raise exception 'you already own the maximum number of workspaces';
  end if;

  insert into public.organizations (name, slug, primary_domain)
  values (btrim(p_name), p_slug, nullif(lower(btrim(p_domain)), ''))
  returning id into v_org;

  insert into public.memberships (org_id, user_id, role)
  values (v_org, v_user, 'owner');

  return v_org;
end;
$$;

do $$
begin
  revoke execute on function public.create_organization(text, text, text) from public, anon;
  grant execute on function public.create_organization(text, text, text) to authenticated, service_role;
exception when undefined_object or undefined_function then null;
end $$;
