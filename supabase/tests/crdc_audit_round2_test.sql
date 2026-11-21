-- Audit round 2: self-approval lock, accepted_at preservation and row-level locking (M2).
-- Synthetic identities only; everything is rolled back.
BEGIN;
SELECT plan(21);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES
  ('a2000000-0000-0000-0000-000000000001','authenticated','authenticated','r2-admin-self@example.test','',now(),'{}','{}',now(),now()),
  ('a2000000-0000-0000-0000-000000000002','authenticated','authenticated','r2-admin-other@example.test','',now(),'{}','{}',now(),now()),
  ('a2000000-0000-0000-0000-000000000003','authenticated','authenticated','r2-cashier@example.test','',now(),'{}','{}',now(),now());

-- The first admin is ALSO a researcher with their own request.
INSERT INTO crdc.researchers (researcher_id, auth_user_id, full_name, applicant_type, national_id, degree_id, email) VALUES
  ('b2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','R2 Admin As Researcher','egyptian','TEST-R2-N-1',1,'r2-admin-self@example.test'),
  ('b2000000-0000-0000-0000-000000000002',NULL,'R2 Other Researcher','egyptian','TEST-R2-N-2',1,'r2-other@example.test');

INSERT INTO crdc.staff_users (staff_id, auth_user_id, full_name, role, is_active) VALUES
  ('c2000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','R2 Admin Self','admin',true),
  ('c2000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000002','R2 Admin Other','admin',true),
  ('c2000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000003','R2 Cashier','cashier',true);

INSERT INTO crdc.service_requests (researcher_id, work_type, work_title, page_count) VALUES
  ('b2000000-0000-0000-0000-000000000001','paper','R2 OWN PAPER',20),
  ('b2000000-0000-0000-0000-000000000002','paper','R2 OTHER PAPER',20);

INSERT INTO crdc.request_items (request_id, fee_id, status_id, amount_due)
SELECT sr.request_id, f.fee_id, st.status_id, crdc.calc_fee(f.fee_id, sr.page_count)
FROM crdc.service_requests sr
JOIN crdc.fee_schedule f ON f.option_code='PUB_PUBLISH' AND f.applicant_type='egyptian'
JOIN crdc.request_statuses st ON st.code='PAID'
WHERE sr.work_title IN ('R2 OWN PAPER','R2 OTHER PAPER');

INSERT INTO crdc.publication_submissions (item_id, journal_id, issue_id, paper_language)
SELECT i.item_id, 1, NULL, 'ar' FROM crdc.request_items i JOIN crdc.service_requests sr USING (request_id)
WHERE sr.work_title IN ('R2 OWN PAPER','R2 OTHER PAPER');

SELECT set_config('test.r2.own',   (SELECT i.item_id::text FROM crdc.request_items i JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='R2 OWN PAPER'), true);
SELECT set_config('test.r2.other', (SELECT i.item_id::text FROM crdc.request_items i JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='R2 OTHER PAPER'), true);
SELECT set_config('test.r2.issue', (SELECT min(issue_id)::text FROM crdc.journal_issues WHERE journal_id=1), true);

-- ============ Self-approval lock ============
SELECT set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT crdc.set_request_item_status(current_setting('test.r2.own')::bigint,'IN_PROGRESS','self attempt')$$,
  '42501', 'Staff cannot change the status of their own researcher request', 'admin cannot change the status of their own researcher request');
SELECT throws_ok(
  $$SELECT crdc.update_publication_submission(current_setting('test.r2.own')::bigint,'accepted',1::smallint,NULL)$$,
  '42501', 'Staff cannot decide on their own researcher request', 'admin cannot decide on their own paper');
SELECT lives_ok(
  $$SELECT crdc.set_request_item_status(current_setting('test.r2.other')::bigint,'IN_PROGRESS','admin on someone else')$$,
  'the same admin can still change another researcher''s item');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM crdc.request_status_history WHERE item_id=current_setting('test.r2.own')::bigint AND note='self attempt'), 0, 'blocked self attempt wrote no history');
SELECT is((SELECT s.code FROM crdc.request_items i JOIN crdc.request_statuses s USING(status_id) WHERE i.item_id=current_setting('test.r2.own')::bigint), 'PAID', 'own item status is unchanged');

SELECT set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT crdc.set_request_item_status(current_setting('test.r2.own')::bigint,'IN_PROGRESS','another admin')$$,
  'a different admin can change that item (the lock is per identity)');
RESET ROLE;

-- ============ accepted_at preservation ============
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT crdc.update_publication_submission(current_setting('test.r2.own')::bigint,'accepted',1::smallint,NULL)$$,
  'another admin can accept the paper');
RESET ROLE;
SELECT is((SELECT accepted_at FROM crdc.publication_submissions WHERE item_id=current_setting('test.r2.own')::bigint), current_date, 'first acceptance stamps today');

UPDATE crdc.publication_submissions SET accepted_at = DATE '2020-01-15' WHERE item_id=current_setting('test.r2.own')::bigint;
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT crdc.update_publication_submission(current_setting('test.r2.own')::bigint,'accepted',1::smallint,current_setting('test.r2.issue')::integer)$$,
  're-saving an accepted paper (new issue) succeeds');
RESET ROLE;
SELECT is((SELECT accepted_at FROM crdc.publication_submissions WHERE item_id=current_setting('test.r2.own')::bigint), DATE '2020-01-15', 're-saving does not overwrite the original accepted_at');

SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT crdc.update_publication_submission(current_setting('test.r2.own')::bigint,'revisions',1::smallint,NULL)$$, 'moving away from accepted succeeds');
RESET ROLE;
SELECT is((SELECT accepted_at FROM crdc.publication_submissions WHERE item_id=current_setting('test.r2.own')::bigint), NULL::date, 'leaving accepted clears accepted_at');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT crdc.update_publication_submission(current_setting('test.r2.own')::bigint,'accepted',1::smallint,NULL)$$, 'accepting again succeeds');
RESET ROLE;
SELECT is((SELECT accepted_at FROM crdc.publication_submissions WHERE item_id=current_setting('test.r2.own')::bigint), current_date, 'a new acceptance stamps a new date');

-- ============ M2: row-level locking ============
-- A real race needs two sessions (see the PR notes); these guard the definitions against regressions.
SELECT matches(pg_get_functiondef('private.set_request_item_status_impl(bigint,text,text)'::regprocedure), 'for update', 'status RPC locks the item row');
SELECT matches(pg_get_functiondef('private.link_payment_to_items_impl(bigint,bigint[])'::regprocedure), 'for update', 'link RPC takes row locks');
SELECT matches(pg_get_functiondef('private.link_payment_to_items_impl(bigint,bigint[])'::regprocedure), 'payment_id is null', 'link RPC only updates unlinked items');

-- link_payment_to_items still behaves: idempotent for the same payment, rejects a second payment.
INSERT INTO crdc.payments (request_id, payment_order_no, amount, currency, channel)
SELECT i.request_id, 'R2-ORDER-' || n, i.amount_due, i.currency, 'treasury'
FROM crdc.request_items i, generate_series(1,2) n WHERE i.item_id=current_setting('test.r2.other')::bigint;
SELECT set_config('test.r2.pay1', (SELECT payment_id::text FROM crdc.payments WHERE payment_order_no='R2-ORDER-1'), true);
SELECT set_config('test.r2.pay2', (SELECT payment_id::text FROM crdc.payments WHERE payment_order_no='R2-ORDER-2'), true);

SELECT set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT crdc.link_payment_to_items(current_setting('test.r2.pay1')::bigint, ARRAY[current_setting('test.r2.other')::bigint])$$,
  'cashier links the payment to the item');
SELECT lives_ok(
  $$SELECT crdc.link_payment_to_items(current_setting('test.r2.pay1')::bigint, ARRAY[current_setting('test.r2.other')::bigint])$$,
  're-linking the same payment is idempotent');
SELECT throws_ok(
  $$SELECT crdc.link_payment_to_items(current_setting('test.r2.pay2')::bigint, ARRAY[current_setting('test.r2.other')::bigint])$$,
  '23514', 'A service item is already linked to another payment', 'a second payment cannot take over a linked item');
RESET ROLE;
SELECT is((SELECT payment_id FROM crdc.request_items WHERE item_id=current_setting('test.r2.other')::bigint), current_setting('test.r2.pay1')::bigint, 'the item stays linked to the first payment');

SELECT * FROM finish();
ROLLBACK;
