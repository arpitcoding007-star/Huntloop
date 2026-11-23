-- ============================================================================
-- 0061 — The starting Exchange taxonomy (build plan DN-14, decision EX-5)
--
-- Decided 2026-11-23: every category from the start, global. This is a broad
-- starting tree, 15 parents and their leaves, not a final list. It is data:
-- add, rename, retire (`active = false`) or regroup rows without a migration.
--
-- Every row starts with matching_enabled = false. A category is switched on
-- once it has enough active providers (the plan's bar is 5); until then its
-- needs are saved and counted, and the buyer is told that suppliers there
-- have not joined yet.
--
-- `regulated` is a starting judgement for EX-10 (export-controlled compute,
-- medical, chemicals, financial and legal services). Regulated categories will
-- require a verified buyer and never show anonymous cards. Review it.
--
-- Attributes live on the parent; leaves inherit them unless they define their
-- own. Idempotent: re-running changes nothing that already exists.
-- ============================================================================

with goods_attrs as (
  select '[
    {"key":"item","label":"What exactly (model, spec, grade)","type":"text","required":true},
    {"key":"quantity","label":"Quantity","type":"number","required":true},
    {"key":"unit","label":"Unit","type":"text","required":false},
    {"key":"condition","label":"Condition","type":"choice","options":["new","refurbished","used","any"],"required":false},
    {"key":"deliver_to","label":"Deliver to","type":"place","required":true},
    {"key":"budget","label":"Budget","type":"money","required":false},
    {"key":"timeline","label":"When do you need it","type":"timeline","required":true},
    {"key":"must_haves","label":"Must-haves (certification, warranty, authorised seller)","type":"list","required":false}
  ]'::jsonb as a
), services_attrs as (
  select '[
    {"key":"scope","label":"What needs doing","type":"text","required":true},
    {"key":"location","label":"Where (or remote)","type":"place","required":true},
    {"key":"budget","label":"Budget","type":"money","required":false},
    {"key":"start","label":"When to start","type":"timeline","required":true},
    {"key":"duration","label":"How long","type":"text","required":false},
    {"key":"must_haves","label":"Must-haves (experience, language, certification)","type":"list","required":false}
  ]'::jsonb as a
), software_attrs as (
  select '[
    {"key":"use_case","label":"What it must do","type":"text","required":true},
    {"key":"seats","label":"How many users","type":"number","required":true},
    {"key":"integrations","label":"Must integrate with","type":"list","required":false},
    {"key":"deployment","label":"Deployment","type":"choice","options":["cloud","on-premise","either"],"required":false},
    {"key":"budget","label":"Budget per month","type":"money","required":false},
    {"key":"timeline","label":"When do you want to decide","type":"timeline","required":true}
  ]'::jsonb as a
), parents(slug, name, kind, sort, regulated, attrs) as (
  values
    ('electronics',            'Electronics & components',       'goods',    10, false, (select a from goods_attrs)),
    ('computers-it-hardware',  'Computers & IT hardware',        'goods',    20, false, (select a from goods_attrs)),
    ('industrial',             'Industrial equipment & supplies','goods',    30, false, (select a from goods_attrs)),
    ('raw-materials',          'Raw materials & chemicals',      'goods',    40, false, (select a from goods_attrs)),
    ('consumer-goods',         'Consumer goods',                 'goods',    50, false, (select a from goods_attrs)),
    ('food-agriculture',       'Food & agriculture',             'goods',    60, false, (select a from goods_attrs)),
    ('health-medical',         'Health & medical',               'both',     70, true,  (select a from goods_attrs)),
    ('automotive',             'Automotive & transport',         'both',     80, false, (select a from goods_attrs)),
    ('construction',           'Construction & real estate',     'both',     90, false, (select a from services_attrs)),
    ('software',               'Software & SaaS',                'services',100, false, (select a from software_attrs)),
    ('business-services',      'Business services',              'services',110, false, (select a from services_attrs)),
    ('professional-services',  'Professional services',          'services',120, false, (select a from services_attrs)),
    ('creative-marketing',     'Creative & marketing',           'services',130, false, (select a from services_attrs)),
    ('logistics',              'Logistics & supply chain',       'services',140, false, (select a from services_attrs)),
    ('education-training',     'Education & training',           'services',150, false, (select a from services_attrs))
)
insert into public.exchange_categories (slug, name, kind, sort, regulated, attributes)
select slug, name, kind, sort, regulated, attrs from parents
on conflict (slug) do nothing;

with leaves(parent, slug, name, kind, sort, regulated) as (
  values
    ('electronics', 'semiconductors-chips',       'Semiconductors & chips',            'goods', 1, false),
    ('electronics', 'gpus-accelerators',          'GPUs & AI accelerators',            'goods', 2, true),
    ('electronics', 'electronic-components',      'Passive & electronic components',   'goods', 3, false),
    ('electronics', 'pcbs-assemblies',            'PCBs & assemblies',                 'goods', 4, false),
    ('electronics', 'consumer-electronics',       'Consumer electronics',              'goods', 5, false),

    ('computers-it-hardware', 'laptops-desktops',  'Laptops & desktops',               'goods', 1, false),
    ('computers-it-hardware', 'servers-storage',   'Servers & storage',                'goods', 2, false),
    ('computers-it-hardware', 'networking',        'Networking equipment',             'goods', 3, false),
    ('computers-it-hardware', 'peripherals',       'Peripherals & accessories',        'goods', 4, false),

    ('industrial', 'machinery',                   'Machinery',                         'goods', 1, false),
    ('industrial', 'tools-hardware',              'Tools & hardware',                  'goods', 2, false),
    ('industrial', 'packaging',                   'Packaging',                         'goods', 3, false),
    ('industrial', 'contract-manufacturing',      'Contract manufacturing',            'both',  4, false),

    ('raw-materials', 'metals',                   'Metals',                            'goods', 1, false),
    ('raw-materials', 'plastics-polymers',        'Plastics & polymers',               'goods', 2, false),
    ('raw-materials', 'chemicals',                'Chemicals',                         'goods', 3, true),
    ('raw-materials', 'textiles-fabrics',         'Textiles & fabrics',                'goods', 4, false),

    ('consumer-goods', 'home-household',          'Home & household',                  'goods', 1, false),
    ('consumer-goods', 'apparel-footwear',        'Apparel & footwear',                'goods', 2, false),
    ('consumer-goods', 'personal-care',           'Beauty & personal care',            'goods', 3, false),
    ('consumer-goods', 'furniture',               'Furniture',                         'goods', 4, false),

    ('food-agriculture', 'food-beverage',         'Food & beverage',                   'goods', 1, false),
    ('food-agriculture', 'agri-produce',          'Agricultural produce',              'goods', 2, false),
    ('food-agriculture', 'agri-inputs',           'Seeds, fertiliser & agri inputs',   'goods', 3, false),

    ('health-medical', 'medical-devices',         'Medical devices & equipment',       'goods', 1, true),
    ('health-medical', 'pharmaceuticals',         'Pharmaceuticals',                   'goods', 2, true),
    ('health-medical', 'healthcare-services',     'Healthcare services',               'services', 3, true),

    ('automotive', 'vehicles',                    'Vehicles',                          'goods', 1, false),
    ('automotive', 'auto-parts',                  'Auto parts',                        'goods', 2, false),
    ('automotive', 'fleet-services',              'Fleet & mobility services',         'services', 3, false),

    ('construction', 'building-materials',        'Building materials',                'goods', 1, false),
    ('construction', 'contractors',               'Contractors & trades',              'services', 2, false),
    ('construction', 'commercial-real-estate',    'Commercial real estate',            'services', 3, false),

    ('software', 'crm-sales',                     'CRM & sales software',              'services', 1, false),
    ('software', 'finance-accounting-software',   'Finance & accounting software',     'services', 2, false),
    ('software', 'hr-payroll-software',           'HR & payroll software',             'services', 3, false),
    ('software', 'marketing-software',            'Marketing software',                'services', 4, false),
    ('software', 'developer-tools',               'Developer tools & infrastructure',  'services', 5, false),
    ('software', 'security-it-software',          'Security & IT software',            'services', 6, false),
    ('software', 'custom-software',               'Custom software development',       'services', 7, false),

    ('business-services', 'staffing-recruiting',  'Staffing & recruiting',             'services', 1, false),
    ('business-services', 'it-services',          'IT services & support',             'services', 2, false),
    ('business-services', 'facilities',           'Facilities & office services',      'services', 3, false),
    ('business-services', 'translation',          'Translation & localisation',        'services', 4, false),

    ('professional-services', 'accounting-tax',   'Accounting & tax',                  'services', 1, true),
    ('professional-services', 'legal',            'Legal services',                    'services', 2, true),
    ('professional-services', 'consulting',       'Business consulting',               'services', 3, false),
    ('professional-services', 'financial-services','Financial services',               'services', 4, true),

    ('creative-marketing', 'design',              'Design & branding',                 'services', 1, false),
    ('creative-marketing', 'marketing-agencies',  'Marketing & advertising',           'services', 2, false),
    ('creative-marketing', 'content-video',       'Content, photo & video',            'services', 3, false),

    ('logistics', 'freight-shipping',             'Freight & shipping',                'services', 1, false),
    ('logistics', 'warehousing',                  'Warehousing & fulfilment',          'services', 2, false),
    ('logistics', 'customs-trade',                'Customs & trade compliance',        'services', 3, false),

    ('education-training', 'corporate-training',  'Corporate training',                'services', 1, false),
    ('education-training', 'courses-tutoring',    'Courses & tutoring',                'services', 2, false)
)
insert into public.exchange_categories (slug, parent_id, name, kind, sort, regulated)
select l.slug, p.id, l.name, l.kind, l.sort, l.regulated
  from leaves l
  join public.exchange_categories p on p.slug = l.parent
on conflict (slug) do nothing;

-- A probe for `db:doctor` (see 0031).
create or replace function public.migration_0061_applied()
returns boolean
language sql
immutable
set search_path = public, pg_catalog
as $$ select true $$;
