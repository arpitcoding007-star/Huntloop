-- 0043 — learning extended to competitors and demand. COMMAND.md §16.3-J (P6).
--
-- `analyze_performance` now also reads accepted competitors (losses in the
-- window, prospects using / evaluating / leaving them) and accepted demand
-- themes (the deals that asked, and how many were lost). Two new finding
-- kinds carry what it concludes, and two citation arrays hold what those
-- findings rest on — real ids, resolved under RLS like the three before them
-- (see 0010), so a renamed competitor or theme still links to the right row.

alter table public.learning_findings
  drop constraint if exists learning_findings_kind_check;

alter table public.learning_findings
  add constraint learning_findings_kind_check check (kind in (
    -- from 0010 and 0018, unchanged
    'source_performance', 'scoring_adjustment', 'style_guidance', 'icp_refinement',
    'discovery_query', 'persona_fit', 'outreach_angle', 'contact_selection',
    -- new
    --   competitive_positioning  a competitor deals are lost to, or one many
    --                            prospects use, and what that should change
    --   product_demand           a theme prospects keep raising, weighed by the
    --                            deals that raised it and how many were lost
    'competitive_positioning', 'product_demand'
  ));

alter table public.learning_findings
  add column if not exists cited_competitor_ids uuid[] not null default '{}',
  add column if not exists cited_theme_ids      uuid[] not null default '{}';

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0043_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
