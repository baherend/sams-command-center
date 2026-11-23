BEGIN;
SELECT plan(33);

-- Isolated identities and a single synthetic request/payment order.
INSERT INTO auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) VALUES
  ('d4000000-0000-0000-0000-000000000001','authenticated','authenticated','r4-researcher@example.test','',now(),'{}','{}',now(),now()),
  ('d4000000-0000-0000-0000-000000000002','authenticated','authenticated','r4-outsider@example.test','',now(),'{}','{}',now(),now()),
  ('d4000000-0000-0000-0000-000000000003','authenticated','authenticated','r4-self-cashier@example.test','',now(),'{}','{}',now(),now()),
  ('d4000000-0000-0000-0000-000000000004','authenticated','authenticated','r4-self-admin@example.test','',now(),'{}','{}',now(),now()),
  ('d4000000-0000-0000-0000-000000000005','authenticated','authenticated','r4-audit-relink@example.test','',now(),'{}','{}',now(),now()),
  ('d4000000-0000-0000-0000-000000000101','authenticated','authenticated','r4-cashier@example.test','',now(),'{}','{}',now(),now()),
  ('d4000000-0000-0000-0000-000000000102','authenticated','authenticated','r4-self-admin-audit@example.test','',now(),'{}','{}',now(),now());
INSERT INTO crdc.researchers(researcher_id,auth_user_id,full_name,applicant_type,national_id,degree_id,email) VALUES
  ('d4100000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','R4 Synthetic Researcher','egyptian','29001010102001',1,'r4-researcher@example.test'),
  ('d4100000-0000-0000-0000-000000000002','d4000000-0000-0000-0000-000000000002','R4 Other Researcher','egyptian','29001010102002',1,'r4-outsider@example.test'),
  ('d4100000-0000-0000-0000-000000000003','d4000000-0000-0000-0000-000000000003','R4 Cashier Owner','egyptian','29001010102003',1,'r4-self-cashier@example.test'),
  ('d4100000-0000-0000-0000-000000000004','d4000000-0000-0000-0000-000000000004','R4 Admin Owner','egyptian','29001010102004',1,'r4-self-admin@example.test');
INSERT INTO crdc.staff_users(staff_id,auth_user_id,full_name,role,is_active) VALUES
  ('d4200000-0000-0000-0000-000000000101','d4000000-0000-0000-0000-000000000101','R4 Cashier','cashier',true),
  ('d4200000-0000-0000-0000-000000000103','d4000000-0000-0000-0000-000000000003','R4 Self Cashier','cashier',true),
  ('d4200000-0000-0000-0000-000000000104','d4000000-0000-0000-0000-000000000004','R4 Self Admin','admin',true),
  ('d4200000-0000-0000-0000-000000000102','d4000000-0000-0000-0000-000000000102','R4 Audit Admin','admin',true);
INSERT INTO crdc.service_requests(researcher_id,work_type,work_title,page_count)
VALUES
  ('d4100000-0000-0000-0000-000000000001','paper','R4 CASHIER TEST',20),
  ('d4100000-0000-0000-0000-000000000003','paper','R4 SELF CASHIER TEST',20),
  ('d4100000-0000-0000-0000-000000000004','paper','R4 SELF ADMIN TEST',20);
INSERT INTO crdc.payments(request_id,payment_order_no,amount,currency,channel)
SELECT sr.request_id,'R4-ORDER-1',crdc.calc_fee(f.fee_id,sr.page_count),'EGP','treasury'
FROM crdc.service_requests sr
CROSS JOIN LATERAL (SELECT fee_id FROM crdc.fee_schedule WHERE applicant_type='egyptian' ORDER BY fee_id LIMIT 1) f
WHERE sr.work_title='R4 CASHIER TEST';
INSERT INTO crdc.request_items(request_id,fee_id,status_id,amount_due)
SELECT sr.request_id,f.fee_id,st.status_id,crdc.calc_fee(f.fee_id,sr.page_count)
FROM crdc.service_requests sr
JOIN crdc.fee_schedule f ON f.fee_id=(SELECT min(fee_id) FROM crdc.fee_schedule WHERE applicant_type='egyptian')
JOIN crdc.request_statuses st ON st.code='SUBMITTED'
WHERE sr.work_title='R4 CASHIER TEST';
SELECT set_config('test.r4.payment',(SELECT p.payment_id::text FROM crdc.payments p JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='R4 CASHIER TEST'),true);
SELECT set_config('test.r4.item',(SELECT i.item_id::text FROM crdc.request_items i JOIN crdc.service_requests sr USING(request_id) WHERE sr.work_title='R4 CASHIER TEST'),true);
SELECT set_config('test.r4.request',(SELECT request_id::text FROM crdc.service_requests WHERE work_title='R4 CASHIER TEST'),true);
SELECT set_config('test.r4.path', 'd4000000-0000-0000-0000-000000000001/'||current_setting('test.r4.request')||'/'||current_setting('test.r4.payment')||'/d4300000-0000-0000-0000-000000000001.pdf',true);

-- A rejected reference can be reused; active references are channel-scoped.
INSERT INTO crdc.payments(request_id,payment_order_no,amount,currency,channel,receipt_status,receipt_no,paid_at,rejection_reason)
VALUES
  (current_setting('test.r4.request')::bigint,'R4-REJECTED-ORDER',1,'EGP','bank','rejected','R4-RECEIPT-1',current_date,'Invalid proof'),
  (current_setting('test.r4.request')::bigint,'R4-CROSS-ORDER-1',1,'EGP','treasury','pending_review','R4-CROSS-CHANNEL',current_date,null),
  (current_setting('test.r4.request')::bigint,'R4-AUDIT-ORDER',1,'EGP','treasury','awaiting_receipt',null,null,null);
SELECT lives_ok(
  $$INSERT INTO crdc.payments(request_id,payment_order_no,amount,currency,channel,receipt_status,receipt_no,paid_at)
    VALUES (current_setting('test.r4.request')::bigint,'R4-CROSS-ORDER-2',1,'EGP','bank','pending_review','R4-CROSS-CHANNEL',current_date)$$,
  'the same active receipt number is allowed on another channel');
SELECT throws_ok(
  $$INSERT INTO crdc.payments(request_id,payment_order_no,amount,currency,channel,receipt_status,receipt_no,paid_at)
    VALUES (current_setting('test.r4.request')::bigint,'R4-ACTIVE-DUP-ORDER',1,'EGP','treasury','pending_review','R4-CROSS-CHANNEL',current_date)$$,
  '23505'::text,NULL::text,'duplicate active channel and receipt number is rejected');
UPDATE crdc.payments SET payment_order_no='R4-AUDIT-ORDER-UPDATED' WHERE payment_order_no='R4-AUDIT-ORDER';
SELECT ok(EXISTS(
  SELECT 1 FROM crdc.audit_log
  WHERE table_name='payments'::text AND changed_columns @> ARRAY['payment_order_no']::text[]
    AND old_values->>'payment_order_no'='R4-AUDIT-ORDER'
    AND new_values->>'payment_order_no'='R4-AUDIT-ORDER-UPDATED'
),'audit log captures payment_order_no changes');

INSERT INTO crdc.payments(request_id,payment_order_no,amount,currency,channel,receipt_status,receipt_no,paid_at)
SELECT sr.request_id,'R4-SELF-CASHIER-ORDER',1,'EGP','bank','pending_review','R4-SELF-CASHIER',current_date
FROM crdc.service_requests sr WHERE sr.work_title='R4 SELF CASHIER TEST';
INSERT INTO crdc.payments(request_id,payment_order_no,amount,currency,channel,receipt_status,receipt_no,paid_at)
SELECT sr.request_id,'R4-SELF-ADMIN-ORDER',1,'EGP','bank','pending_review','R4-SELF-ADMIN',current_date
FROM crdc.service_requests sr WHERE sr.work_title='R4 SELF ADMIN TEST';
SELECT set_config('test.r4.self_cashier_payment',(SELECT p.payment_id::text FROM crdc.payments p WHERE p.payment_order_no='R4-SELF-CASHIER-ORDER'),true);
SELECT set_config('test.r4.self_admin_payment',(SELECT p.payment_id::text FROM crdc.payments p WHERE p.payment_order_no='R4-SELF-ADMIN-ORDER'),true);

-- Cashier creates and links a payment order, then marks the item for payment.
SELECT set_config('request.jwt.claims','{"sub":"d4000000-0000-0000-0000-000000000101","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT crdc.link_payment_to_items(current_setting('test.r4.payment')::bigint,ARRAY[current_setting('test.r4.item')::bigint])$$,
  'cashier links one same-request, same-currency item');
SELECT lives_ok(
  $$SELECT crdc.set_request_item_status(current_setting('test.r4.item')::bigint,'PAYMENT_ORDER'::text,NULL::text)$$,
  'cashier marks the linked item PAYMENT_ORDER');
RESET ROLE;

-- Storage object fixture is synthetic and scoped to the researcher/request/payment path.
INSERT INTO storage.objects(bucket_id,name,metadata)
VALUES
  ('payment-receipts',current_setting('test.r4.path'),'{"mimetype":"application/pdf","size":1024}'::jsonb),
  ('payment-receipts',regexp_replace(current_setting('test.r4.path'),'[^/]+$','d4300000-0000-0000-0000-000000000002.jpg'),'{"mimetype":"image/jpeg","size":1024}'::jsonb),
  ('payment-receipts',regexp_replace(current_setting('test.r4.path'),'[^/]+$','d4300000-0000-0000-0000-000000000003.png'),'{"mimetype":"image/png","size":1024}'::jsonb);
SELECT set_config('request.jwt.claims','{"sub":"d4000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO storage.objects(bucket_id,name,metadata)
    VALUES ('payment-receipts',regexp_replace(current_setting('test.r4.path'),'[^/]+$','d4300000-0000-0000-0000-000000000004.pdf'),'{"mimetype":"application/pdf","size":1024}'::jsonb)$$,
  '42501'::text,NULL::text,'the fourth receipt upload for one payment is rejected');
SELECT throws_ok(
  $$INSERT INTO storage.objects(bucket_id,name,metadata)
    VALUES ('payment-receipts',regexp_replace(current_setting('test.r4.path'),'^[^/]+','d4000000-0000-0000-0000-000000000002'),'{"mimetype":"application/pdf","size":1024}'::jsonb)$$,
  '42501'::text,NULL::text,'researcher cannot upload into another auth user folder');
SELECT lives_ok(
  $$SELECT crdc.submit_payment_receipt(current_setting('test.r4.payment')::bigint,'bank'::text,'R4-RECEIPT-1'::text,current_date::date,current_setting('test.r4.path')::text)$$,
  'owner can reuse a receipt number after the prior receipt was rejected');
SELECT set_config('request.jwt.claims','{"sub":"d4000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT throws_ok(
  $$SELECT crdc.submit_payment_receipt(current_setting('test.r4.payment')::bigint,'bank'::text,'R4-RECEIPT-OTHER'::text,current_date::date,current_setting('test.r4.path')::text)$$,
  '42501'::text,'Payment order does not belong to this researcher'::text,'another researcher cannot submit a receipt');
SELECT set_config('request.jwt.claims','{"sub":"d4000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT is((SELECT count(*)::integer FROM storage.objects WHERE bucket_id='payment-receipts' AND name=current_setting('test.r4.path')),
          1,'researcher can read their own receipt object');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"d4000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM storage.objects WHERE bucket_id='payment-receipts' AND name=current_setting('test.r4.path')),
          0,'another researcher cannot read the receipt object');
RESET ROLE;
SELECT is((SELECT receipt_status FROM crdc.payments WHERE payment_id=current_setting('test.r4.payment')::bigint),'pending_review'::text,'submitted receipt waits for verification');
SELECT ok(EXISTS(SELECT 1 FROM crdc.audit_log WHERE table_name='payments'::text AND row_key=current_setting('test.r4.payment')::text AND action='UPDATE'::text AND new_values->>'receipt_status'='pending_review'::text),'submission creates a safe audit row');
SELECT ok(EXISTS(SELECT 1 FROM crdc.audit_log WHERE table_name='payments'::text AND row_key=current_setting('test.r4.payment')::text AND changed_columns @> ARRAY['receipt_no']::text[] AND new_values->>'receipt_no'='R4-RECEIPT-1'),'audit log captures receipt_no changes');
SELECT ok(NOT EXISTS(SELECT 1 FROM crdc.audit_log WHERE table_name='payments'::text AND row_key=current_setting('test.r4.payment')::text AND (new_values ? 'receipt_storage_path' OR new_values ? 'rejection_reason')),'audit rows still exclude receipt paths and rejection text');

SELECT set_config('request.jwt.claims','{"sub":"d4000000-0000-0000-0000-000000000101","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM storage.objects WHERE bucket_id='payment-receipts' AND name=current_setting('test.r4.path')),
          1,'cashier can read submitted receipt proof');
SELECT lives_ok($$SELECT crdc.approve_payment_receipt(current_setting('test.r4.payment')::bigint)$$,'active cashier approves a pending receipt');
SELECT throws_ok($$SELECT crdc.approve_payment_receipt(current_setting('test.r4.payment')::bigint)$$,'23514'::text,NULL::text,'a second approval is rejected after the row lock and status check');
SELECT is((SELECT s.code FROM crdc.request_items i JOIN crdc.request_statuses s USING(status_id) WHERE i.item_id=current_setting('test.r4.item')::bigint),'PAID'::text,'approval transitions the covered item to PAID');
RESET ROLE;
SELECT ok(EXISTS(SELECT 1 FROM crdc.audit_log WHERE table_name='payments'::text AND row_key=current_setting('test.r4.payment')::text AND action='UPDATE'::text AND new_values->>'receipt_status'='verified'::text AND occurred_at IS NOT NULL),'approval audit records the verified state with server timestamp');
SELECT ok(EXISTS(SELECT 1 FROM crdc.audit_log WHERE table_name='payments'::text AND row_key=current_setting('test.r4.payment')::text AND changed_columns @> ARRAY['verified_by_staff_id']::text[] AND new_values->>'verified_by_staff_id'='d4200000-0000-0000-0000-000000000101'),'audit log captures verifying staff id changes');

SELECT set_config('request.jwt.claims','{"sub":"d4000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT crdc.approve_payment_receipt(current_setting('test.r4.self_cashier_payment')::bigint)$$,'42501'::text,'Staff cannot approve a receipt for their own researcher request'::text,'cashier cannot approve own researcher receipt');
SELECT throws_ok($$SELECT crdc.reject_payment_receipt(current_setting('test.r4.self_cashier_payment')::bigint,'Receipt details are unclear'::text)$$,'42501'::text,'Staff cannot reject a receipt for their own researcher request'::text,'cashier cannot reject own researcher receipt');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"d4000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT crdc.approve_payment_receipt(current_setting('test.r4.self_admin_payment')::bigint)$$,'42501'::text,'Staff cannot approve a receipt for their own researcher request'::text,'admin cannot approve own researcher receipt');
SELECT throws_ok($$SELECT crdc.reject_payment_receipt(current_setting('test.r4.self_admin_payment')::bigint,'Receipt details are unclear'::text)$$,'42501'::text,'Staff cannot reject a receipt for their own researcher request'::text,'admin cannot reject own researcher receipt');
RESET ROLE;

SELECT set_config('request.jwt.claims','{}',true);
UPDATE crdc.staff_users
SET auth_user_id='d4000000-0000-0000-0000-000000000005'
WHERE staff_id='d4200000-0000-0000-0000-000000000102';
SELECT ok(EXISTS(
  SELECT 1 FROM crdc.audit_log
  WHERE table_name='staff_users'::text AND row_key='d4200000-0000-0000-0000-000000000102'::text
    AND changed_columns @> ARRAY['auth_user_id']::text[]
    AND old_values->>'auth_user_id'='d4000000-0000-0000-0000-000000000102'
    AND new_values->>'auth_user_id'='d4000000-0000-0000-0000-000000000005'
),'audit log captures staff auth_user_id changes');

SELECT throws_ok(
  $$UPDATE crdc.payments SET amount=amount+1 WHERE payment_id=current_setting('test.r4.payment')::bigint$$,
  '23514'::text,NULL::text,'verified payment values are immutable');
SELECT set_config('request.jwt.claims','{"sub":"d4000000-0000-0000-0000-000000000101","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM crdc.researchers),0,'cashier cannot read researcher identity rows');
SELECT is((SELECT full_name FROM crdc.cashier_request_contacts WHERE request_id=current_setting('test.r4.request')::bigint),'R4 Synthetic Researcher'::text,'cashier contact view exposes the limited researcher name');
SELECT ok(NOT EXISTS(SELECT 1 FROM crdc.cashier_request_contacts c WHERE c.request_id=current_setting('test.r4.request')::bigint AND (to_jsonb(c) ? 'national_id' OR to_jsonb(c) ? 'passport_no')),'cashier contact view omits national ID and passport columns');
SELECT is((SELECT count(*)::integer FROM crdc.audit_log),0,'non-admin cashier cannot read audit log rows');
SELECT ok(NOT has_table_privilege('authenticated','crdc.audit_log','UPDATE') AND NOT has_table_privilege('authenticated','crdc.audit_log','DELETE'),'authenticated roles cannot update or delete audit rows');
RESET ROLE;
SELECT ok((SELECT NOT public AND file_size_limit=5242880 AND allowed_mime_types @> ARRAY['application/pdf','image/jpeg','image/png']::text[] FROM storage.buckets WHERE id='payment-receipts'),'receipt bucket is private and restricts size and MIME types');

SELECT * FROM finish();
ROLLBACK;
