-- 0072 — profile pictures (V-18)
--
-- `profiles.avatar_url` has held the identity provider's picture URL since
-- 0007, and a session may update its own row (`profile_self_write`). Nothing
-- rendered it, so what a session could write there did not matter. Settings
-- → You now uploads a picture and the account menu draws it, so the column is
-- bounded to the two things the app produces:
--
--   · an https URL of at most 2,048 characters (Google's, copied from the
--     identity provider's metadata by handle_new_user), or
--   · an upload: a base64 JPEG data URL of at most 48,000 characters,
--     re-encoded by the browser and stripped of metadata by the server
--     (apps/web/lib/avatar.ts, which applies the same rule as
--     `isRenderableAvatar`).
--
-- Anything else (http, javascript:, svg, an oversized blob) is refused, so a
-- row written around the app cannot put an unexpected value into an <img>.
--
-- Two traps, both handled here:
--
--   · Sign-up. handle_new_user copies `avatar_url` from the sign-up metadata,
--     which an email sign-up controls. Inserting a value the check refuses
--     would fail the profile insert and with it the sign-up. The trigger now
--     keeps the provider's picture only when it passes the rule.
--   · Existing rows. A NOT VALID check still applies to every later UPDATE of
--     a row, so a stored value outside the rule would make that person's
--     name edits (and the sign-in trigger's update) fail. Values outside the
--     rule are cleared first; none of them could have been shown anyway. The
--     check is then added fully validated.

create or replace function public.avatar_url_allowed(p_url text)
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$
  select p_url is null
      or (p_url ~ '^https://' and length(p_url) <= 2048)
      or (
        p_url ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$'
        and length(p_url) <= 48000
      )
$$;

update public.profiles set avatar_url = null where not public.avatar_url_allowed(avatar_url);

alter table public.profiles drop constraint if exists profiles_avatar_url_bounded;
alter table public.profiles
  add constraint profiles_avatar_url_bounded check (public.avatar_url_allowed(avatar_url));

-- 0071's body, with the provider's picture kept only when it passes the rule.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row    jsonb := to_jsonb(new);
  v_meta   jsonb := coalesce(v_row -> 'raw_user_meta_data', '{}'::jsonb);
  v_avatar text  := nullif(coalesce(v_meta ->> 'avatar_url', v_meta ->> 'picture'), '');
begin
  if not public.avatar_url_allowed(v_avatar) then
    v_avatar := null;
  end if;
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    v_row ->> 'email',
    nullif(coalesce(v_meta ->> 'full_name', v_meta ->> 'name'), ''),
    v_avatar
  )
  on conflict (id) do update
    set email      = coalesce(excluded.email, public.profiles.email),
        full_name  = coalesce(public.profiles.full_name, excluded.full_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);
  return new;
end
$$;

create or replace function public.migration_0072_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
