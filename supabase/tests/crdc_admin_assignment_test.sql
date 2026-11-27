BEGIN;
SELECT plan(6);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('50000000-0000-0000-0000-000000000101','authenticated','authenticated','assignment-admin@example.test','',now(),'{}','{}',now(),now()),
  ('50000000-0000-0000-0000-000000000102','authenticated','authenticated','assignment-viewer@example.test','',now(),'{}','{}',now(),now());

INSERT INTO crdc.staff_users (staff_id, auth_user_id, full_name, role, is_active) VALUES
  ('60000000-0000-0000-0000-000000000101','50000000-0000-0000-0000-000000000101','Assignment Admin','admin',true),
  ('60000000-0000-0000-0000-000000000102',null,'Active Reviewer','reviewer',true),
  ('60000000-0000-0000-0000-000000000103',null,'Active Statistician','statistician',true),
  ('60000000-0000-0000-0000-000000000104',null,'Inactive Reviewer','reviewer',false),
  ('60000000-0000-0000-0000-000000000105',null,'Cashier','cashier',true),
  ('60000000-0000-0000-0000-000000000106','50000000-0000-0000-0000-000000000102','Assignment Viewer','viewer',true);

SELECT set_config('test.assignment.item_id', (SELECT item_id::text FROM crdc.request_items WHERE service_id = 3 ORDER BY item_id LIMIT 1), true);
SELECT set_config('test.assignment.pub_item_id', (SELECT item_id::text FROM crdc.request_items WHERE service_id = 1 ORDER BY item_id LIMIT 1), true);
SELECT set_config('request.jwt.claims',
  '{"sub":"50000000-0000-0000-0000-000000000101","email":"assignment-admin@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

UPDATE crdc.request_items
SET assigned_staff_id='60000000-0000-0000-0000-000000000102'
WHERE item_id=current_setting('test.assignment.item_id')::bigint;
SELECT is(
  (SELECT assigned_staff_id FROM crdc.request_items WHERE item_id=current_setting('test.assignment.item_id')::bigint),
  '60000000-0000-0000-0000-000000000102'::uuid,
  'admin can assign an active reviewer'
);
UPDATE crdc.request_items
SET assigned_staff_id='60000000-0000-0000-0000-000000000103'
WHERE item_id=current_setting('test.assignment.item_id')::bigint;
SELECT is(
  (SELECT assigned_staff_id FROM crdc.request_items WHERE item_id=current_setting('test.assignment.item_id')::bigint),
  '60000000-0000-0000-0000-000000000103'::uuid,
  'admin can assign an active statistician'
);
SELECT throws_ok(
  $$UPDATE crdc.request_items SET assigned_staff_id='60000000-0000-0000-0000-000000000104'
    WHERE item_id=current_setting('test.assignment.item_id')::bigint$$,
  '42501', NULL, 'admin cannot assign an inactive reviewer'
);
SELECT throws_ok(
  $$UPDATE crdc.request_items SET assigned_staff_id='60000000-0000-0000-0000-000000000103'
    WHERE item_id=current_setting('test.assignment.pub_item_id')::bigint$$,
  '42501', NULL, 'admin cannot assign a statistician to a non-statistics service'
);
SELECT throws_ok(
  $$UPDATE crdc.request_items SET assigned_staff_id='60000000-0000-0000-0000-000000000105'
    WHERE item_id=current_setting('test.assignment.item_id')::bigint$$,
  '42501', NULL, 'admin cannot assign a cashier'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"50000000-0000-0000-0000-000000000102","email":"assignment-viewer@example.test","role":"authenticated"}', true);
UPDATE crdc.request_items
SET assigned_staff_id='60000000-0000-0000-0000-000000000102'
WHERE item_id=current_setting('test.assignment.item_id')::bigint;

RESET ROLE;
SELECT is(
  (SELECT assigned_staff_id FROM crdc.request_items WHERE item_id=current_setting('test.assignment.item_id')::bigint),
  '60000000-0000-0000-0000-000000000103'::uuid,
  'viewer cannot change staff assignments'
);
SELECT * FROM finish();
ROLLBACK;

