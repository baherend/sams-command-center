BEGIN;
SELECT plan(30);

-- Isolated, synthetic identities for the role-access matrix.
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000001','authenticated','authenticated','rls-researcher-a@example.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000002','authenticated','authenticated','rls-researcher-b@example.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000003','authenticated','authenticated','rls-unlinked@example.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000101','authenticated','authenticated','rls-reviewer-a@example.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000102','authenticated','authenticated','rls-reviewer-b@example.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000103','authenticated','authenticated','rls-cashier@example.test','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000104','authenticated','authenticated','rls-viewer@example.test','',now(),'{}','{}',now(),now());

INSERT INTO crdc.researchers (
  researcher_id, auth_user_id, full_name, applicant_type, national_id, degree_id, email
) VALUES
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','RLS Researcher A','egyptian','TEST-RLS-A',1,'rls-researcher-a@example.test'),
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','RLS Researcher B','egyptian','TEST-RLS-B',1,'rls-researcher-b@example.test');

INSERT INTO crdc.staff_users (staff_id, auth_user_id, full_name, role, is_active) VALUES
  ('20000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000101','RLS Reviewer A','reviewer',true),
  ('20000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000102','RLS Reviewer B','reviewer',true),
  ('20000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000103','RLS Cashier','cashier',true),
  ('20000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-000000000104','RLS Viewer','viewer',true);

INSERT INTO crdc.service_requests (researcher_id, work_type, work_title, page_count) VALUES
  ('10000000-0000-0000-0000-000000000001','paper','RLS TEST A',20),
  ('10000000-0000-0000-0000-000000000002','paper','RLS TEST B',20);

INSERT INTO crdc.request_items (request_id, fee_id, status_id, amount_due, assigned_staff_id)
SELECT sr.request_id, f.fee_id, st.status_id, crdc.calc_fee(f.fee_id, sr.page_count),
       CASE sr.work_title WHEN 'RLS TEST A' THEN '20000000-0000-0000-0000-000000000101'::uuid
                          ELSE '20000000-0000-0000-0000-000000000102'::uuid END
FROM crdc.service_requests sr
JOIN crdc.fee_schedule f ON f.option_code='PUB_PUBLISH' AND f.applicant_type='egyptian'
JOIN crdc.request_statuses st ON st.code='IN_PROGRESS'
WHERE sr.work_title IN ('RLS TEST A','RLS TEST B');

INSERT INTO crdc.publication_submissions (item_id, journal_id, issue_id, paper_language)
SELECT i.item_id, 1,
       (SELECT min(ji.issue_id) FROM crdc.journal_issues ji WHERE ji.journal_id=1),
       'ar'
FROM crdc.request_items i JOIN crdc.service_requests sr USING (request_id)
WHERE sr.work_title IN ('RLS TEST A','RLS TEST B');

INSERT INTO crdc.payments (request_id, receipt_no, amount, currency, channel, paid_at)
SELECT sr.request_id, 'RLS-RECEIPT-' || right(sr.work_title,1), sum(i.amount_due), 'EGP', 'treasury', current_date
FROM crdc.service_requests sr JOIN crdc.request_items i USING (request_id)
WHERE sr.work_title IN ('RLS TEST A','RLS TEST B')
GROUP BY sr.request_id, sr.work_title;

UPDATE crdc.request_items i SET payment_id=p.payment_id
FROM crdc.service_requests sr JOIN crdc.payments p USING (request_id)
WHERE i.request_id=sr.request_id AND sr.work_title IN ('RLS TEST A','RLS TEST B');

SELECT set_config('test.rls.item_a', (
  SELECT i.item_id::text FROM crdc.request_items i JOIN crdc.service_requests sr USING(request_id)
  WHERE sr.work_title='RLS TEST A'
), true);
SELECT set_config('test.rls.item_b', (
  SELECT i.item_id::text FROM crdc.request_items i JOIN crdc.service_requests sr USING(request_id)
  WHERE sr.work_title='RLS TEST B'
), true);

-- Researcher A: own profile, request, item, payment, history, and publication only.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","email":"rls-researcher-a@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM crdc.researchers), 1, 'researcher sees only own profile');
SELECT is((SELECT count(*)::integer FROM crdc.service_requests WHERE work_title='RLS TEST A'), 1, 'researcher sees own request');
SELECT is((SELECT count(*)::integer FROM crdc.service_requests WHERE work_title='RLS TEST B'), 0, 'researcher cannot see another request');
SELECT is((SELECT count(*)::integer FROM crdc.request_items i JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='RLS TEST A'), 1, 'researcher sees own service item');
SELECT is((SELECT count(*)::integer FROM crdc.request_items i JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='RLS TEST B'), 0, 'researcher cannot see another service item');
SELECT is((SELECT count(*)::integer FROM crdc.payments p JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='RLS TEST A'), 1, 'researcher sees own payment');
SELECT is((SELECT count(*)::integer FROM crdc.payments WHERE receipt_no='RLS-RECEIPT-B'), 0, 'researcher cannot see another receipt');
SELECT is((SELECT count(*)::integer FROM crdc.request_status_history h JOIN crdc.request_items i USING(item_id) JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='RLS TEST A'), 1, 'researcher sees own status history');
SELECT is((SELECT count(*)::integer FROM crdc.publication_submissions p JOIN crdc.request_items i USING(item_id) JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='RLS TEST A'), 1, 'researcher sees own publication record');
SELECT throws_ok(
  $$INSERT INTO crdc.researchers (auth_user_id, full_name, applicant_type, national_id, email)
    VALUES ('00000000-0000-0000-0000-000000000003','Forged profile','egyptian','TEST-FORGED','forged@example.test')$$,
  '42501', NULL, 'researcher cannot create a profile for another Auth user'
);
RESET ROLE;

-- Reviewer A: only the assigned case and publication record; no identity table access.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000101","email":"rls-reviewer-a@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM crdc.service_requests WHERE work_title='RLS TEST A'), 1, 'reviewer sees assigned case');
SELECT is((SELECT count(*)::integer FROM crdc.service_requests WHERE work_title='RLS TEST B'), 0, 'reviewer cannot see unassigned case');
SELECT is((SELECT count(*)::integer FROM crdc.request_items i JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='RLS TEST A'), 1, 'reviewer sees assigned service item');
SELECT is((SELECT count(*)::integer FROM crdc.request_items i JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='RLS TEST B'), 0, 'reviewer cannot see unassigned service item');
SELECT is((SELECT count(*)::integer FROM crdc.publication_submissions p JOIN crdc.request_items i USING(item_id) JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='RLS TEST B'), 0, 'reviewer cannot see unassigned publication record');
SELECT is((SELECT count(*)::integer FROM crdc.researchers), 0, 'reviewer cannot read researcher identity records');
-- Publication decisions are RPC-only; assignment is enforced inside the RPC.
SELECT lives_ok(
  $$SELECT crdc.update_publication_submission(current_setting('test.rls.item_a')::bigint,'revisions',1::smallint,(SELECT min(issue_id) FROM crdc.journal_issues WHERE journal_id=1))$$,
  'reviewer can call the publication RPC for an assigned item'
);
SELECT throws_ok(
  $$SELECT crdc.update_publication_submission(current_setting('test.rls.item_b')::bigint,'revisions',1::smallint,(SELECT min(issue_id) FROM crdc.journal_issues WHERE journal_id=1))$$,
  '42501', NULL, 'reviewer cannot call the publication RPC for an unassigned item'
);
RESET ROLE;
SELECT is((SELECT decision FROM crdc.publication_submissions WHERE item_id=current_setting('test.rls.item_a')::bigint), 'revisions', 'reviewer can update an assigned publication decision');
SELECT is((SELECT decision FROM crdc.publication_submissions WHERE item_id=current_setting('test.rls.item_b')::bigint), 'pending', 'reviewer cannot update an unassigned publication decision');

-- Cashier: payment operations and minimal contact view, but no identity-table access or work history.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000103","email":"rls-cashier@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM crdc.researchers), 0, 'cashier cannot read researcher identity table');
SELECT is((SELECT count(*)::integer FROM crdc.cashier_request_contacts WHERE work_title LIKE 'RLS TEST %'), 2, 'cashier contact view exposes required case contacts');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='crdc' AND table_name='cashier_request_contacts'
    AND column_name IN ('national_id','passport_no')
), 'cashier contact view omits national ID and passport');
SELECT is((SELECT count(*)::integer FROM crdc.payments p JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title LIKE 'RLS TEST %'), 2, 'cashier can read payment records');
SELECT is((SELECT count(*)::integer FROM crdc.request_status_history h JOIN crdc.request_items i USING(item_id) JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='RLS TEST A'), 0, 'cashier cannot read non-payment work history');
RESET ROLE;

-- Viewer: only aggregate dashboard rows; no case-level records.
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000104","email":"rls-viewer@example.test","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM crdc.service_requests), 0, 'viewer cannot read individual requests');
SELECT is((SELECT count(*)::integer FROM crdc.request_items), 0, 'viewer cannot read individual service items');
SELECT is((SELECT count(*)::integer FROM crdc.payments), 0, 'viewer cannot read payment records');
SELECT is((SELECT count(*)::integer FROM crdc.researchers), 0, 'viewer cannot read researcher identities');
SELECT ok((SELECT coalesce(sum(item_count),0) > 0 FROM crdc.viewer_dashboard_summary), 'viewer can read grouped dashboard counts');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
