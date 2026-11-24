BEGIN;
SELECT plan(17);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('30000000-0000-0000-0000-000000000601','authenticated','authenticated','analytics-admin@example.test','',now(),'{}','{}',now(),now()),
  ('30000000-0000-0000-0000-000000000602','authenticated','authenticated','analytics-viewer@example.test','',now(),'{}','{}',now(),now()),
  ('30000000-0000-0000-0000-000000000603','authenticated','authenticated','analytics-cashier@example.test','',now(),'{}','{}',now(),now()),
  ('30000000-0000-0000-0000-000000000604','authenticated','authenticated','analytics-reviewer@example.test','',now(),'{}','{}',now(),now()),
  ('30000000-0000-0000-0000-000000000605','authenticated','authenticated','analytics-inactive@example.test','',now(),'{}','{}',now(),now());

INSERT INTO crdc.staff_users (staff_id, auth_user_id, full_name, role, is_active) VALUES
  ('40000000-0000-0000-0000-000000000601','30000000-0000-0000-0000-000000000601','Analytics Admin','admin',true),
  ('40000000-0000-0000-0000-000000000602','30000000-0000-0000-0000-000000000602','Analytics Viewer','viewer',true),
  ('40000000-0000-0000-0000-000000000603','30000000-0000-0000-0000-000000000603','Analytics Cashier','cashier',true),
  ('40000000-0000-0000-0000-000000000604','30000000-0000-0000-0000-000000000604','Analytics Reviewer','reviewer',true),
  ('40000000-0000-0000-0000-000000000605','30000000-0000-0000-0000-000000000605','Analytics Inactive','admin',false);

-- Ground truth is read as the table owner, before any role switch (RLS hides rows from staff).
SELECT set_config('test.an.requests', (SELECT count(*)::text FROM crdc.service_requests), true);
SELECT set_config('test.an.items', (SELECT count(*)::text FROM crdc.request_items), true);

-- Viewer: allowed. Capture the payload for later checks.
SELECT set_config('request.jwt.claims',
  '{"sub":"30000000-0000-0000-0000-000000000602","email":"analytics-viewer@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(jsonb_typeof(crdc.get_analytics_dashboard()), 'object', 'viewer receives the dashboard object');
SELECT set_config('test.an.payload', crdc.get_analytics_dashboard()::text, true);
SELECT set_config('test.an.payload30', crdc.get_analytics_dashboard(30)::text, true);

-- Admin: allowed.
SELECT set_config('request.jwt.claims',
  '{"sub":"30000000-0000-0000-0000-000000000601","email":"analytics-admin@example.test","role":"authenticated"}', true);
SELECT is(jsonb_typeof(crdc.get_analytics_dashboard(365)), 'object', 'admin receives the dashboard object');
SELECT throws_ok($$SELECT crdc.get_analytics_dashboard(0)$$, '22023', NULL, 'p_days below 1 is rejected');

RESET ROLE;

SELECT is(
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(current_setting('test.an.payload')::jsonb) k),
  ARRAY['applicant_mix','by_service','by_status','kpis','monthly_trend'],
  'payload has exactly the five documented sections'
);
SELECT is(
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(current_setting('test.an.payload')::jsonb->'kpis') k),
  ARRAY['active_items','avg_turnaround_days','completed_items','total_items','total_requests','verified_revenue_egp','verified_revenue_usd'],
  'kpis has exactly the documented keys'
);
SELECT is((current_setting('test.an.payload')::jsonb->'kpis'->>'total_requests')::bigint,
  current_setting('test.an.requests')::bigint, 'total_requests matches all requests when p_days is NULL');
SELECT is((current_setting('test.an.payload')::jsonb->'kpis'->>'total_items')::bigint,
  current_setting('test.an.items')::bigint, 'total_items matches all items when p_days is NULL');
SELECT is(
  (current_setting('test.an.payload')::jsonb->'applicant_mix'->>'egyptian_requests')::bigint
  + (current_setting('test.an.payload')::jsonb->'applicant_mix'->>'foreign_requests')::bigint,
  current_setting('test.an.requests')::bigint, 'applicant mix adds up to total requests'
);
SELECT is(
  (SELECT sum((e->>'item_count')::bigint) FROM jsonb_array_elements(current_setting('test.an.payload')::jsonb->'by_status') e),
  current_setting('test.an.items')::bigint, 'by_status counts add up to total items'
);
SELECT is(jsonb_array_length(current_setting('test.an.payload')::jsonb->'monthly_trend'), 12,
  'monthly_trend covers 12 months');
SELECT ok(
  (current_setting('test.an.payload30')::jsonb->'kpis'->>'total_requests')::bigint
    <= (current_setting('test.an.payload')::jsonb->'kpis'->>'total_requests')::bigint,
  'a 30-day window never exceeds the all-time request count'
);

-- Zero PII: no identity-like keys anywhere in the payload, and no researcher value leaks into it.
SELECT is(
  (SELECT count(*)::integer
   FROM jsonb_path_query(current_setting('test.an.payload')::jsonb, 'strict $.**') o,
        LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(o) = 'object' THEN o ELSE '{}'::jsonb END) k
   WHERE k ~* '(name$|^name|email|national|passport|nationality|researcher|auth_user|staff|title)'
     AND k NOT IN ('service_name_ar','status_name_ar')),
  0, 'payload contains no PII keys at any depth'
);
SELECT is(
  (SELECT count(*)::integer FROM crdc.researchers r
   WHERE position(lower(r.email) in lower(current_setting('test.an.payload'))) > 0
      OR position(r.full_name in current_setting('test.an.payload')) > 0
      OR position(r.national_id in current_setting('test.an.payload')) > 0
      OR position(r.passport_no in current_setting('test.an.payload')) > 0),
  0, 'no researcher name, email, national ID or passport value appears in the payload'
);

-- Denied callers.
SELECT set_config('request.jwt.claims',
  '{"sub":"30000000-0000-0000-0000-000000000603","email":"analytics-cashier@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT crdc.get_analytics_dashboard()$$, '42501', NULL, 'cashier is denied');

SELECT set_config('request.jwt.claims',
  '{"sub":"30000000-0000-0000-0000-000000000604","email":"analytics-reviewer@example.test","role":"authenticated"}', true);
SELECT throws_ok($$SELECT crdc.get_analytics_dashboard()$$, '42501', NULL, 'reviewer is denied');

SELECT set_config('request.jwt.claims',
  '{"sub":"30000000-0000-0000-0000-000000000605","email":"analytics-inactive@example.test","role":"authenticated"}', true);
SELECT throws_ok($$SELECT crdc.get_analytics_dashboard()$$, '42501', NULL, 'inactive admin is denied');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT crdc.get_analytics_dashboard()$$, '42501', NULL, 'anonymous caller is denied');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
