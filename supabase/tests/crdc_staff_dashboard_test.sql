BEGIN;
SELECT plan(13);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('30000000-0000-0000-0000-000000000101','authenticated','authenticated','dashboard-viewer@example.test','',now(),'{}','{}',now(),now()),
  ('30000000-0000-0000-0000-000000000102','authenticated','authenticated','dashboard-cashier@example.test','',now(),'{}','{}',now(),now());

INSERT INTO crdc.staff_users (staff_id, auth_user_id, full_name, role, is_active) VALUES
  ('40000000-0000-0000-0000-000000000101','30000000-0000-0000-0000-000000000101','Dashboard Viewer','viewer',true),
  ('40000000-0000-0000-0000-000000000102','30000000-0000-0000-0000-000000000102','Dashboard Cashier','cashier',true);

SELECT set_config('test.staff.expected_total', (SELECT count(*)::text FROM crdc.service_requests), true);
SELECT set_config('request.jwt.claims',
  '{"sub":"30000000-0000-0000-0000-000000000101","email":"dashboard-viewer@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT request_count::bigint FROM crdc.staff_dashboard_overview WHERE metric='total' AND category='all'),
  current_setting('test.staff.expected_total')::bigint,
  'viewer sees the total request count as an aggregate'
);
SELECT is(
  (SELECT coalesce(sum(request_count),0)::bigint FROM crdc.staff_dashboard_overview WHERE metric='applicant_type'),
  current_setting('test.staff.expected_total')::bigint,
  'Egyptian and foreign totals add up to the total requests'
);
SELECT is((SELECT count(*)::integer FROM crdc.service_requests), 0, 'viewer cannot read request rows');
SELECT is((SELECT count(*)::integer FROM crdc.researchers), 0, 'viewer cannot read researcher rows');
SELECT is(
  (SELECT count(*)::integer FROM crdc.staff_dashboard_overview WHERE metric='status'),
  (SELECT count(*)::integer FROM crdc.request_statuses),
  'viewer sees grouped counts for every request status'
);
SELECT is(
  (SELECT count(*)::integer FROM information_schema.columns
   WHERE table_schema='crdc' AND table_name='staff_dashboard_overview'
     AND column_name IN ('researcher_id','request_id','full_name','email','national_id','passport_no','work_title')),
  0,
  'aggregate view has no identifiers or personal information columns'
);

SELECT is(
  (SELECT count(*)::integer FROM information_schema.columns
   WHERE table_schema='crdc' AND table_name='staff_dashboard_overview' AND column_name='label_en'),
  1,
  'aggregate view exposes the label_en column'
);
SELECT is(
  (SELECT count(*)::integer FROM crdc.staff_dashboard_overview
   WHERE metric='status' AND coalesce(btrim(label_en), '') = ''),
  0,
  'every status row of the aggregate view has a non-empty label_en'
);
SELECT is(
  (SELECT count(*)::integer FROM information_schema.columns
   WHERE table_schema='crdc' AND table_name='staff_dashboard_overview'
        AND column_name NOT IN ('metric','category','label','label_en','request_count')),
  0,
  'aggregate view has no columns beyond the known aggregate ones'
);

SELECT is(
  (SELECT count(*)::integer FROM information_schema.columns
   WHERE table_schema='crdc' AND table_name='viewer_dashboard_summary'
     AND column_name IN ('service_name_en','status_name_en')),
  2,
  'viewer_dashboard_summary exposes service_name_en and status_name_en'
);
SELECT is(
  (SELECT count(*)::integer FROM crdc.viewer_dashboard_summary
   WHERE coalesce(btrim(service_name_en), '') = '' OR coalesce(btrim(status_name_en), '') = ''),
  0,
  'every viewer_dashboard_summary row has non-empty English names'
);
SELECT is(
  (SELECT count(*)::integer FROM information_schema.columns
   WHERE table_schema='crdc' AND table_name='viewer_dashboard_summary'
     AND column_name NOT IN ('service_code','service_name','service_name_en',
                             'status_code','status_name','status_name_en','item_count')),
  0,
  'viewer_dashboard_summary has no columns beyond the known aggregate ones'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"30000000-0000-0000-0000-000000000102","email":"dashboard-cashier@example.test","role":"authenticated"}', true);
SELECT is((SELECT count(*)::integer FROM crdc.staff_dashboard_overview), 0, 'non-viewer staff cannot access the viewer dashboard');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

