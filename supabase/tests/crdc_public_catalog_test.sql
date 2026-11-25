-- Public catalog (crdc_public.get_catalog) for visitors who are not signed in.
-- Proves two things: visitors get exactly the published reference data, and nothing else is reachable.
BEGIN;
SELECT plan(24);

-- ---------- shape of the function and the schema ----------
SELECT has_function('crdc_public', 'get_catalog', ARRAY[]::text[], 'crdc_public.get_catalog() exists');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'crdc_public.get_catalog()'::regprocedure), true,
  'get_catalog is SECURITY DEFINER (visitors never touch the tables)');
SELECT ok((SELECT proconfig FROM pg_proc WHERE oid = 'crdc_public.get_catalog()'::regprocedure) @> ARRAY['search_path=""'],
  'get_catalog pins an empty search_path');
SELECT is(has_schema_privilege('anon', 'crdc', 'USAGE'), false, 'anon has no USAGE on schema crdc');
SELECT is(has_schema_privilege('anon', 'private', 'USAGE'), false, 'anon has no USAGE on schema private');
SELECT is(has_schema_privilege('anon', 'crdc_public', 'CREATE'), false, 'anon cannot create objects in crdc_public');
SELECT is((SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'crdc_public' AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  'get_catalog', 'get_catalog is the only function anon can execute in crdc_public');

-- ---------- ground truth, read as the table owner ----------
SELECT set_config('test.pc.services', (SELECT count(*)::text FROM crdc.services WHERE is_active), true);
SELECT set_config('test.pc.fees', (SELECT count(*)::text FROM crdc.fee_schedule f
  JOIN crdc.services s ON s.service_id = f.service_id AND s.is_active), true);
SELECT set_config('test.pc.degree_reqs', (SELECT count(*)::text FROM crdc.degree_requirements dr
  JOIN crdc.requirement_types r ON r.requirement_code = dr.requirement_code
  JOIN crdc.services s ON s.service_id = r.service_id AND s.is_active), true);
SELECT set_config('test.pc.pub_eg', (SELECT jsonb_build_object('base_fee', base_fee, 'included_pages', included_pages,
  'extra_page_fee', extra_page_fee, 'certificate_fee', certificate_fee)::text
  FROM crdc.fee_schedule WHERE option_code = 'PUB_PUBLISH' AND applicant_type = 'egyptian'), true);
SELECT set_config('test.pc.inactive', (SELECT coalesce(string_agg(code, ','), '') FROM crdc.services WHERE NOT is_active), true);

-- ---------- a visitor (anon) ----------
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;

SELECT lives_ok($$SELECT crdc_public.get_catalog()$$, 'anon can call get_catalog');
SELECT is((SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(crdc_public.get_catalog()) k),
  'degree_requirements,degrees,fees,journals,requirement_types,services', 'catalog has exactly the six public sections');
SELECT is(jsonb_array_length(crdc_public.get_catalog()->'services')::text, current_setting('test.pc.services'),
  'catalog lists every active service');
SELECT is(jsonb_array_length(crdc_public.get_catalog()->'fees')::text, current_setting('test.pc.fees'),
  'catalog lists every fee row of active services');
SELECT is((SELECT count(*)::integer FROM jsonb_array_elements(crdc_public.get_catalog()->'services') s
           WHERE s->>'code' = ANY (string_to_array(current_setting('test.pc.inactive'), ','))), 0,
  'inactive services (e.g. consulting) are not published');
SELECT is(jsonb_array_length(crdc_public.get_catalog()->'degree_requirements')::text, current_setting('test.pc.degree_reqs'),
  'catalog lists every degree requirement of active services');
SELECT is((SELECT jsonb_build_object('base_fee', f->'base_fee', 'included_pages', f->'included_pages',
             'extra_page_fee', f->'extra_page_fee', 'certificate_fee', f->'certificate_fee')
           FROM jsonb_array_elements(crdc_public.get_catalog()->'fees') f
           WHERE f->>'option_code' = 'PUB_PUBLISH' AND f->>'applicant_type' = 'egyptian'),
  current_setting('test.pc.pub_eg')::jsonb, 'published fees equal crdc.fee_schedule');
SELECT is((SELECT string_agg(DISTINCT k, ',' ORDER BY k)
           FROM jsonb_array_elements(crdc_public.get_catalog()->'fees') f, jsonb_object_keys(f) k),
  'applicant_type,base_fee,certificate_fee,currency,extra_page_fee,included_pages,option_code,requirement_code,service_id',
  'fee rows carry only the allow-listed columns');

SELECT throws_ok($$SELECT count(*) FROM crdc.researchers$$, '42501', NULL, 'anon cannot read researchers');
SELECT throws_ok($$SELECT count(*) FROM crdc.service_requests$$, '42501', NULL, 'anon cannot read service requests');
SELECT throws_ok($$SELECT count(*) FROM crdc.payments$$, '42501', NULL, 'anon cannot read payments');
SELECT throws_ok($$SELECT count(*) FROM crdc.staff_users$$, '42501', NULL, 'anon cannot read staff users');
SELECT throws_ok($$SELECT count(*) FROM crdc.audit_log$$, '42501', NULL, 'anon cannot read the audit log');
SELECT throws_ok($$SELECT count(*) FROM crdc.fee_schedule$$, '42501', NULL, 'anon cannot read crdc tables directly, even fees');
SELECT throws_ok($$SELECT crdc.get_analytics_dashboard(NULL)$$, '42501', NULL, 'anon cannot call crdc functions');
SELECT throws_ok($$CREATE FUNCTION crdc_public.x() RETURNS int LANGUAGE sql AS 'select 1'$$, '42501', NULL,
  'anon cannot add functions to crdc_public');
RESET ROLE;

-- ---------- a signed-in user can use the same catalog ----------
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT crdc_public.get_catalog()$$, 'authenticated can call get_catalog');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
