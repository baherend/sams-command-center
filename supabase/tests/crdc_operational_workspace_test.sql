BEGIN;
SELECT plan(5);

INSERT INTO auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES
 ('70000000-0000-0000-0000-000000000001','authenticated','authenticated','ops-reviewer@example.test','',now(),'{}','{}',now(),now()),
 ('70000000-0000-0000-0000-000000000002','authenticated','authenticated','ops-other@example.test','',now(),'{}','{}',now(),now());
INSERT INTO crdc.staff_users(staff_id,auth_user_id,full_name,role,is_active) VALUES
 ('80000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','Ops Reviewer','reviewer',true),
 ('80000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000002','Other Reviewer','reviewer',true);
SELECT set_config('test.ops.item', (select item_id::text from crdc.request_items order by item_id limit 1), true);
UPDATE crdc.request_items set assigned_staff_id='80000000-0000-0000-0000-000000000001' where item_id=current_setting('test.ops.item')::bigint;
UPDATE crdc.request_items set status_id=(select status_id from crdc.request_statuses where code='PAID') where item_id=current_setting('test.ops.item')::bigint;
SELECT set_config('request.jwt.claims','{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$select crdc.set_request_item_status(current_setting('test.ops.item')::bigint,'IN_PROGRESS','بدأت المراجعة')$$,'assigned reviewer can set IN_PROGRESS');
SELECT is((select code from crdc.request_statuses s join crdc.request_items i using(status_id) where i.item_id=current_setting('test.ops.item')::bigint),'IN_PROGRESS','status update is reflected on item');
SELECT is((select note from crdc.request_status_history where item_id=current_setting('test.ops.item')::bigint order by changed_at desc limit 1),'بدأت المراجعة','status note is in timeline');
SELECT throws_ok($$select crdc.set_request_item_status(current_setting('test.ops.item')::bigint,'PAID',null)$$,'42501',NULL,'reviewer cannot write a payment status');
SELECT set_config('request.jwt.claims','{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT is((select count(*)::integer from crdc.request_items where item_id=current_setting('test.ops.item')::bigint),0,'unassigned reviewer cannot see the case');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

