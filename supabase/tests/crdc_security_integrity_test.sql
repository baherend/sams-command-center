-- Regression tests for the C1, H1, H2, M1 and M3 security/data-integrity findings.
-- Everything runs inside one rolled-back transaction with synthetic identities only.
BEGIN;
SELECT plan(38);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('a0000000-0000-0000-0000-000000000001','authenticated','authenticated','si-researcher@example.test','',now(),'{}','{}',now(),now()),
  ('a0000000-0000-0000-0000-000000000101','authenticated','authenticated','si-admin@example.test','',now(),'{}','{}',now(),now()),
  ('a0000000-0000-0000-0000-000000000102','authenticated','authenticated','si-reviewer@example.test','',now(),'{}','{}',now(),now()),
  ('a0000000-0000-0000-0000-000000000103','authenticated','authenticated','si-statistician@example.test','',now(),'{}','{}',now(),now()),
  ('a0000000-0000-0000-0000-000000000104','authenticated','authenticated','si-cashier@example.test','',now(),'{}','{}',now(),now()),
  ('a0000000-0000-0000-0000-000000000105','authenticated','authenticated','si-viewer@example.test','',now(),'{}','{}',now(),now());

INSERT INTO crdc.researchers (researcher_id, auth_user_id, full_name, applicant_type, nationality, national_id, passport_no, degree_id, email) VALUES
  ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','SI Researcher','egyptian',NULL,'29001010101001',NULL,1,'si-researcher@example.test'),
  ('b0000000-0000-0000-0000-000000000002',NULL,'SI Foreign','foreign','Testland-X',NULL,'TEST-SI-P-1',1,'si-foreign@example.test');

INSERT INTO crdc.staff_users (staff_id, auth_user_id, full_name, role, is_active) VALUES
  ('c0000000-0000-0000-0000-000000000101','a0000000-0000-0000-0000-000000000101','SI Admin','admin',true),
  ('c0000000-0000-0000-0000-000000000102','a0000000-0000-0000-0000-000000000102','SI Reviewer','reviewer',true),
  ('c0000000-0000-0000-0000-000000000103','a0000000-0000-0000-0000-000000000103','SI Statistician','statistician',true),
  ('c0000000-0000-0000-0000-000000000104','a0000000-0000-0000-0000-000000000104','SI Cashier','cashier',true),
  ('c0000000-0000-0000-0000-000000000105','a0000000-0000-0000-0000-000000000105','SI Viewer','viewer',true);

-- Request 1 (paper): publication item assigned to the reviewer, plus a second item for the statistician.
-- Request 2 (paper): a plain item used for payment-lock tests.
INSERT INTO crdc.service_requests (researcher_id, work_type, work_title, page_count) VALUES
  ('b0000000-0000-0000-0000-000000000001','paper','SI TEST PUB',20),
  ('b0000000-0000-0000-0000-000000000001','paper','SI TEST PAY',20);

INSERT INTO crdc.request_items (request_id, fee_id, status_id, amount_due, assigned_staff_id)
SELECT sr.request_id, f.fee_id, st.status_id, crdc.calc_fee(f.fee_id, sr.page_count),
       CASE WHEN sr.work_title='SI TEST PUB' THEN 'c0000000-0000-0000-0000-000000000102'::uuid END
FROM crdc.service_requests sr
JOIN crdc.fee_schedule f ON f.option_code='PUB_PUBLISH' AND f.applicant_type='egyptian'
JOIN crdc.request_statuses st ON st.code='PAID'
WHERE sr.work_title IN ('SI TEST PUB','SI TEST PAY');

INSERT INTO crdc.publication_submissions (item_id, journal_id, issue_id, paper_language)
SELECT i.item_id, 1, (SELECT min(issue_id) FROM crdc.journal_issues WHERE journal_id=1), 'ar'
FROM crdc.request_items i JOIN crdc.service_requests sr USING (request_id) WHERE sr.work_title='SI TEST PUB';

SELECT set_config('test.si.pub_item', (SELECT i.item_id::text FROM crdc.request_items i JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='SI TEST PUB'), true);
SELECT set_config('test.si.pay_item', (SELECT i.item_id::text FROM crdc.request_items i JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='SI TEST PAY'), true);
SELECT set_config('test.si.pay_req',  (SELECT request_id::text FROM crdc.service_requests WHERE work_title='SI TEST PAY'), true);
SELECT set_config('test.si.issue',    (SELECT min(issue_id)::text FROM crdc.journal_issues WHERE journal_id=1), true);

-- ============ C1: viewer cannot change item status ============
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000105","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT crdc.set_request_item_status(current_setting('test.si.pub_item')::bigint,'IN_PROGRESS','viewer attempt')$$,
  '42501', 'Staff role is not permitted to change item status', 'C1: viewer is rejected by the status RPC');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM crdc.request_status_history WHERE item_id=current_setting('test.si.pub_item')::bigint AND note='viewer attempt'), 0, 'C1: viewer attempt left no history row');
SELECT is((SELECT s.code FROM crdc.request_items i JOIN crdc.request_statuses s USING(status_id) WHERE i.item_id=current_setting('test.si.pub_item')::bigint), 'PAID', 'C1: item status unchanged after viewer attempt');

SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000101","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT crdc.set_request_item_status(current_setting('test.si.pub_item')::bigint,'IN_PROGRESS','admin ok')$$,
  'C1: admin can still change status');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000102","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT crdc.set_request_item_status(current_setting('test.si.pub_item')::bigint,'REVISIONS','reviewer ok')$$,
  'C1: assigned reviewer can still change status');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000104","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT crdc.set_request_item_status(current_setting('test.si.pub_item')::bigint,'IN_PROGRESS',null)$$,
  '42501', 'Cashiers can only record payment statuses', 'C1: cashier still limited to payment statuses');
RESET ROLE;

-- ============ H2: publication_submissions is RPC-only ============
SELECT ok(NOT has_table_privilege('authenticated','crdc.publication_submissions','INSERT'), 'H2: authenticated has no INSERT on publication_submissions');
SELECT ok(NOT has_table_privilege('authenticated','crdc.publication_submissions','UPDATE'), 'H2: authenticated has no UPDATE on publication_submissions');

SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000101","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$UPDATE crdc.publication_submissions SET decision='accepted', accepted_at='2000-01-01' WHERE item_id=current_setting('test.si.pub_item')::bigint$$,
  '42501', NULL, 'H2: admin cannot update publication_submissions directly');
SELECT throws_ok(
  $$INSERT INTO crdc.publication_submissions (item_id, journal_id, paper_language) VALUES (current_setting('test.si.pay_item')::bigint,1,'ar')$$,
  '42501', NULL, 'H2: admin cannot insert publication_submissions directly');
RESET ROLE;

SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000102","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$UPDATE crdc.publication_submissions SET decision='accepted', accepted_at='2000-01-01' WHERE item_id=current_setting('test.si.pub_item')::bigint$$,
  '42501', NULL, 'H2: reviewer cannot back-date accepted_at through a direct update');
SELECT lives_ok(
  $$SELECT crdc.update_publication_submission(current_setting('test.si.pub_item')::bigint,'accepted',1::smallint,current_setting('test.si.issue')::integer)$$,
  'H2: assigned reviewer can decide through the RPC');
RESET ROLE;
SELECT is((SELECT accepted_at FROM crdc.publication_submissions WHERE item_id=current_setting('test.si.pub_item')::bigint), current_date, 'H2: accepted_at is set server-side');

-- Statistician is treated exactly like reviewer: unassigned is rejected, assigned is allowed.
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000103","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT crdc.update_publication_submission(current_setting('test.si.pub_item')::bigint,'rejected',1::smallint,NULL)$$,
  '42501', 'This item is not assigned to this staff member', 'H2: unassigned statistician is rejected by the RPC');
RESET ROLE;
UPDATE crdc.request_items SET assigned_staff_id='c0000000-0000-0000-0000-000000000103' WHERE item_id=current_setting('test.si.pub_item')::bigint;
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT crdc.update_publication_submission(current_setting('test.si.pub_item')::bigint,'revisions',1::smallint,NULL)$$,
  'H2: assigned statistician can decide through the RPC');
RESET ROLE;
SELECT is((SELECT accepted_at FROM crdc.publication_submissions WHERE item_id=current_setting('test.si.pub_item')::bigint), NULL::date, 'H2: leaving accepted clears accepted_at');

SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000104","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT crdc.update_publication_submission(current_setting('test.si.pub_item')::bigint,'accepted',1::smallint,NULL)$$,
  '42501', NULL, 'H2: cashier is rejected by the publication RPC');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000105","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT crdc.update_publication_submission(current_setting('test.si.pub_item')::bigint,'accepted',1::smallint,NULL)$$,
  '42501', NULL, 'H2: viewer is rejected by the publication RPC');
RESET ROLE;

-- ============ H1: payments are locked once linked; receipt/order numbers are unique ============
INSERT INTO crdc.payments (request_id, payment_order_no, amount, currency, channel)
SELECT i.request_id, 'SI-ORDER-1', i.amount_due, 'EGP', 'treasury'
FROM crdc.request_items i WHERE i.item_id=current_setting('test.si.pay_item')::bigint;
SELECT set_config('test.si.payment', (SELECT max(payment_id)::text FROM crdc.payments WHERE payment_order_no='SI-ORDER-1'), true);

-- Not linked yet: every column is still editable.
SELECT lives_ok(
  $$UPDATE crdc.payments SET amount = amount + 1 WHERE payment_id=current_setting('test.si.payment')::bigint$$,
  'H1: an unlinked payment can still be corrected');
UPDATE crdc.payments SET amount = amount - 1 WHERE payment_id=current_setting('test.si.payment')::bigint;
UPDATE crdc.request_items SET payment_id=current_setting('test.si.payment')::bigint WHERE item_id=current_setting('test.si.pay_item')::bigint;

SELECT throws_ok($$UPDATE crdc.payments SET amount = amount + 1 WHERE payment_id=current_setting('test.si.payment')::bigint$$,
  '23514', NULL, 'H1: linked payment amount is locked');
SELECT throws_ok($$UPDATE crdc.payments SET currency = 'USD' WHERE payment_id=current_setting('test.si.payment')::bigint$$,
  '23514', NULL, 'H1: linked payment currency is locked');
SELECT throws_ok($$UPDATE crdc.payments SET request_id = request_id + 1000000 WHERE payment_id=current_setting('test.si.payment')::bigint$$,
  '23514', NULL, 'H1: linked payment request_id is locked');
SELECT throws_ok($$UPDATE crdc.payments SET payment_order_no = 'SI-ORDER-CHANGED' WHERE payment_id=current_setting('test.si.payment')::bigint$$,
  '23514', NULL, 'H1: a recorded payment_order_no cannot be changed');
SELECT throws_ok($$UPDATE crdc.payments SET payment_order_no = NULL WHERE payment_id=current_setting('test.si.payment')::bigint$$,
  '23514', NULL, 'H1: a recorded payment_order_no cannot be cleared');

-- Receipt metadata is now RPC-only; a cashier cannot mutate payment rows directly.
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000104","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$UPDATE crdc.payments SET paid_at=current_date, receipt_no='SI-RECEIPT-1' WHERE payment_id=current_setting('test.si.payment')::bigint$$,
  '42501', NULL, 'H1: cashier cannot directly set receipt metadata');
SELECT throws_ok($$UPDATE crdc.payments SET receipt_no='SI-RECEIPT-2' WHERE payment_id=current_setting('test.si.payment')::bigint$$,
  '42501', NULL, 'H1: cashier cannot directly change a receipt reference');
SELECT throws_ok($$UPDATE crdc.payments SET paid_at=current_date - 3 WHERE payment_id=current_setting('test.si.payment')::bigint$$,
  '42501', NULL, 'H1: cashier cannot directly change payment date');
RESET ROLE;

SELECT throws_ok(
  $$INSERT INTO crdc.payments (request_id, receipt_no, amount, currency, channel, paid_at, receipt_status) VALUES (current_setting('test.si.pay_req')::bigint,'SI-DUP-RECEIPT','10','EGP','bank',current_date,'pending_review'),(current_setting('test.si.pay_req')::bigint,'SI-DUP-RECEIPT','11','EGP','bank',current_date,'pending_review')$$,
  '23505', NULL, 'H1: duplicate receipt_no is rejected');
SELECT throws_ok(
  $$INSERT INTO crdc.payments (request_id, payment_order_no, amount, currency, channel) VALUES (current_setting('test.si.pay_req')::bigint,'SI-ORDER-1',10,'EGP','bank')$$,
  '23505', NULL, 'H1: duplicate payment_order_no is rejected');
SELECT lives_ok(
  $$INSERT INTO crdc.payments (request_id, amount, currency, channel) VALUES (current_setting('test.si.pay_req')::bigint,10,'EGP','bank'),(current_setting('test.si.pay_req')::bigint,11,'EGP','bank')$$,
  'H1: several payments without receipt/order numbers remain allowed');

-- ============ M1: identity validation ============
SELECT throws_ok(
  $$INSERT INTO crdc.researchers (full_name, applicant_type, national_id, email) VALUES ('Blank ID','egyptian','   ','si-blank@example.test')$$,
  '23514', NULL, 'M1: blank national_id is rejected');
SELECT throws_ok(
  $$INSERT INTO crdc.researchers (full_name, applicant_type, national_id, email) VALUES ('Dup ID','egyptian','29001010101001','si-dupid@example.test')$$,
  '23505', NULL, 'M1: duplicate national_id is rejected');
SELECT throws_ok(
  $$INSERT INTO crdc.researchers (full_name, applicant_type, nationality, passport_no, email) VALUES ('Dup Passport','foreign','Testland-X','TEST-SI-P-1','si-duppp@example.test')$$,
  '23505', NULL, 'M1: duplicate (passport_no, nationality) is rejected');
SELECT lives_ok(
  $$INSERT INTO crdc.researchers (full_name, applicant_type, nationality, passport_no, email) VALUES ('Same Passport Other Country','foreign','Testland-Y','TEST-SI-P-1','si-other@example.test')$$,
  'M1: the same passport number from another nationality is allowed');
SELECT throws_ok(
  $$INSERT INTO crdc.service_requests (researcher_id, work_type, work_title, page_count) VALUES ('b0000000-0000-0000-0000-000000000001','paper','  ',10)$$,
  '23514', NULL, 'M1: blank work_title is rejected');

-- ============ M3: separation of duties on assignment ============
-- The reviewer below is also a researcher with their own request; they must never be assigned to it.
INSERT INTO crdc.researchers (researcher_id, auth_user_id, full_name, applicant_type, national_id, degree_id, email)
VALUES ('b0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000102','SI Reviewer As Researcher','egyptian','29001010101003',1,'si-reviewer@example.test');
INSERT INTO crdc.service_requests (researcher_id, work_type, work_title, page_count)
VALUES ('b0000000-0000-0000-0000-000000000003','thesis','SI TEST SELF',100);
INSERT INTO crdc.request_items (request_id, fee_id, status_id, amount_due)
SELECT sr.request_id, f.fee_id, st.status_id, crdc.calc_fee(f.fee_id, sr.page_count)
FROM crdc.service_requests sr
JOIN crdc.fee_schedule f ON f.option_code='STAT_ANALYSIS' AND f.applicant_type='egyptian'
JOIN crdc.request_statuses st ON st.code='SUBMITTED'
WHERE sr.work_title='SI TEST SELF';
SELECT set_config('test.si.self_item', (SELECT i.item_id::text FROM crdc.request_items i JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='SI TEST SELF'), true);

SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000101","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$UPDATE crdc.request_items SET assigned_staff_id='c0000000-0000-0000-0000-000000000102' WHERE item_id=current_setting('test.si.self_item')::bigint$$,
  '42501', NULL, 'M3: admin cannot assign staff to their own researcher request');
SELECT lives_ok(
  $$UPDATE crdc.request_items SET assigned_staff_id='c0000000-0000-0000-0000-000000000103' WHERE item_id=current_setting('test.si.self_item')::bigint$$,
  'M3: admin can assign a different reviewer/statistician to that request');
RESET ROLE;
SELECT is((SELECT assigned_staff_id FROM crdc.request_items WHERE item_id=current_setting('test.si.self_item')::bigint), 'c0000000-0000-0000-0000-000000000103'::uuid, 'M3: the allowed assignment persisted');

SELECT * FROM finish();
ROLLBACK;
