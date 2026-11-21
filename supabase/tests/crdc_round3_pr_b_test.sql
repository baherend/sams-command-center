begin;
select plan(30);

reset role;
set local role postgres;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000b01'::uuid,'authenticated'::text,'authenticated'::text,'r3b-admin-a@example.test'::text,'',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000b02'::uuid,'authenticated'::text,'authenticated'::text,'r3b-admin-b@example.test'::text,'',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000b03'::uuid,'authenticated'::text,'authenticated'::text,'r3b-reviewer@example.test'::text,'',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000b04'::uuid,'authenticated'::text,'authenticated'::text,'r3b-cashier@example.test'::text,'',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000b05'::uuid,'authenticated'::text,'authenticated'::text,'r3b-viewer@example.test'::text,'',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000b06'::uuid,'authenticated'::text,'authenticated'::text,'r3b-researcher@example.test'::text,'',now(),'{}','{}',now(),now());

insert into crdc.staff_users (staff_id, auth_user_id, full_name, role, is_active) values
  ('20000000-0000-0000-0000-000000000b01'::uuid,'00000000-0000-0000-0000-000000000b01'::uuid,'R3B PRIVATE ADMIN A','admin'::text,true),
  ('20000000-0000-0000-0000-000000000b02'::uuid,'00000000-0000-0000-0000-000000000b02'::uuid,'R3B PRIVATE ADMIN B','admin'::text,true),
  ('20000000-0000-0000-0000-000000000b03'::uuid,'00000000-0000-0000-0000-000000000b03'::uuid,'R3B PRIVATE REVIEWER','reviewer'::text,true),
  ('20000000-0000-0000-0000-000000000b04'::uuid,'00000000-0000-0000-0000-000000000b04'::uuid,'R3B PRIVATE CASHIER','cashier'::text,true),
  ('20000000-0000-0000-0000-000000000b05'::uuid,'00000000-0000-0000-0000-000000000b05'::uuid,'R3B PRIVATE VIEWER','viewer'::text,true);

select set_config('test.r3b.admin_a','20000000-0000-0000-0000-000000000b01'::text,true);
select set_config('test.r3b.admin_b','20000000-0000-0000-0000-000000000b02'::text,true);

select lives_ok(
  $$update crdc.staff_users set role='reviewer'::text where staff_id=current_setting('test.r3b.admin_b')::uuid$$,
  'one of two active admins can change role'
);
select is((select count(*)::integer from crdc.staff_users where staff_id in (current_setting('test.r3b.admin_a')::uuid,current_setting('test.r3b.admin_b')::uuid) and is_active and role='admin'::text),1,'the other active admin remains');
select lives_ok(
  $$update crdc.staff_users set role='admin'::text,is_active=true where staff_id=current_setting('test.r3b.admin_b')::uuid$$,
  'second admin can be restored while first remains active'
);
select lives_ok(
  $$update crdc.staff_users set is_active=false where staff_id=current_setting('test.r3b.admin_b')::uuid$$,
  'one of two admins can be deactivated'
);
select is((select count(*)::integer from crdc.staff_users where staff_id in (current_setting('test.r3b.admin_a')::uuid,current_setting('test.r3b.admin_b')::uuid) and is_active and role='admin'::text),1,'one active admin remains after deactivation');
select lives_ok(
  $$update crdc.staff_users set is_active=true where staff_id=current_setting('test.r3b.admin_b')::uuid$$,
  'second admin can be reactivated while the first remains active'
);
select lives_ok(
  $$delete from crdc.staff_users where staff_id=current_setting('test.r3b.admin_b')::uuid$$,
  'active admin can be deleted while another active admin remains'
);
insert into crdc.staff_users (staff_id,auth_user_id,full_name,role,is_active)
values ('20000000-0000-0000-0000-000000000b02'::uuid,'00000000-0000-0000-0000-000000000b02'::uuid,'R3B PRIVATE ADMIN B','admin'::text,false);

select throws_ok(
  $$update crdc.staff_users set is_active=false where staff_id=current_setting('test.r3b.admin_a')::uuid$$,
  '23514'::text,null::text,'cannot deactivate the last active admin'
);
select throws_ok(
  $$update crdc.staff_users set role='reviewer'::text where staff_id=current_setting('test.r3b.admin_a')::uuid$$,
  '23514'::text,null::text,'cannot demote the last active admin'
);
select throws_ok(
  $$delete from crdc.staff_users where staff_id=current_setting('test.r3b.admin_a')::uuid$$,
  '23514'::text,null::text,'cannot delete the last active admin'
);
select throws_ok(
  $$update crdc.staff_users set auth_user_id=null where staff_id=current_setting('test.r3b.admin_a')::uuid$$,
  '23514'::text,null::text,'cannot null the auth link of the last active admin'
);
select throws_ok(
  $$delete from auth.users where id='00000000-0000-0000-0000-000000000b01'::uuid$$,
  '23514'::text,null::text,'auth user deletion cannot null the last active admin link'
);
select is((select count(*)::integer from crdc.staff_users where staff_id=current_setting('test.r3b.admin_a')::uuid and is_active and role='admin'::text),1,'failed last-admin changes leave the administrator intact');

-- Exercise safe payment and request-item auditing with an existing synthetic
-- request. The chosen request has a single currency by schema design.
with target_request as (
  select sr.request_id, i.currency, sum(i.amount_due)::numeric(10,2) as amount
  from crdc.service_requests sr join crdc.request_items i using (request_id)
  group by sr.request_id,i.currency
  having bool_and(i.payment_id is null)
  order by sr.request_id limit 1
), inserted_payment as (
  insert into crdc.payments(request_id,receipt_no,amount,currency,channel,paid_at)
  select request_id,'R3B-PRIVATE-RECEIPT'::text,amount,currency,'treasury'::text,current_date
  from target_request returning payment_id,request_id
)
select set_config('test.r3b.payment',payment_id::text,true),
       set_config('test.r3b.request',request_id::text,true)
from inserted_payment;

update crdc.payments set amount=amount+1.00
where payment_id=current_setting('test.r3b.payment')::bigint;
update crdc.request_items
set assigned_staff_id=current_setting('test.r3b.admin_b')::uuid,
    payment_id=current_setting('test.r3b.payment')::bigint
where request_id=current_setting('test.r3b.request')::bigint
  and payment_id is null
  and item_id=(select min(item_id) from crdc.request_items where request_id=current_setting('test.r3b.request')::bigint and payment_id is null);
update crdc.request_items set status_id=status_id
where item_id=(select min(item_id) from crdc.request_items where request_id=current_setting('test.r3b.request')::bigint);

select ok(exists(
  select 1 from crdc.audit_log where table_name='payments'::text
    and row_key=current_setting('test.r3b.payment')::text and action='INSERT'::text
    and new_values ? 'amount' and not (new_values ? 'receipt_no')
),'payment insert is audited with only whitelisted fields');
select ok(exists(
  select 1 from crdc.audit_log where table_name='payments'::text
    and row_key=current_setting('test.r3b.payment')::text and action='UPDATE'::text
    and changed_columns=array['amount']::text[]
),'payment update records the changed amount');
select ok(exists(
  select 1 from crdc.audit_log where table_name='request_items'::text
    and row_key=(select min(item_id)::text from crdc.request_items where request_id=current_setting('test.r3b.request')::bigint)
    and action='UPDATE'::text and changed_columns @> array['assigned_staff_id','payment_id']::text[]
),'request item assignment and payment link changes are audited');
select is((select count(*)::integer from crdc.audit_log where table_name='request_items'::text
  and row_key=(select min(item_id)::text from crdc.request_items where request_id=current_setting('test.r3b.request')::bigint)
  and action='UPDATE'::text and changed_columns=array[]::text[]),0,'unrelated request item update creates no audit row');

-- Capture one authenticated actor in an audited staff role change.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000b01","email":"r3b-admin-a@example.test","role":"authenticated"}'::text,true);
set local role authenticated;
update crdc.staff_users set role='reviewer'::text
where staff_id=current_setting('test.r3b.admin_b')::uuid;
reset role;
select ok(exists(
  select 1 from crdc.audit_log where table_name='staff_users'::text
    and row_key=current_setting('test.r3b.admin_b')::text
    and changed_columns=array['role']::text[]
    and actor_auth_user_id='00000000-0000-0000-0000-000000000b01'::uuid
),'staff role change records safe data and the authenticated actor');
update crdc.staff_users set role='admin'::text,is_active=true
where staff_id=current_setting('test.r3b.admin_b')::uuid;
update crdc.staff_users set is_active=false
where staff_id=current_setting('test.r3b.admin_b')::uuid;
select ok(exists(
  select 1 from crdc.audit_log where table_name='staff_users'::text
    and row_key=current_setting('test.r3b.admin_b')::text
    and changed_columns=array['is_active']::text[] and new_values->>'is_active'='false'::text
),'staff active-status change is audited');

select set_config('test.r3b.publication',(
  select submission_id::text from crdc.publication_submissions order by submission_id limit 1
),true);
update crdc.publication_submissions set decision='revisions'::text
where submission_id=current_setting('test.r3b.publication')::bigint;
select ok(exists(
  select 1 from crdc.audit_log where table_name='publication_submissions'::text
    and row_key=current_setting('test.r3b.publication')::text
    and changed_columns @> array['decision']::text[] and new_values->>'decision'='revisions'::text
),'publication decision change is audited');

select ok(not exists(
  select 1 from crdc.audit_log l
  where coalesce(l.old_values,'{}'::jsonb) ?| array['national_id','passport_no','passport_number','email','full_name']::text[]
     or coalesce(l.new_values,'{}'::jsonb) ?| array['national_id','passport_no','passport_number','email','full_name']::text[]
),'no audited row contains PII field names');
select ok(not exists(
  select 1 from crdc.audit_log l
  where coalesce(l.old_values,'{}'::jsonb)::text like '%R3B PRIVATE%'
     or coalesce(l.new_values,'{}'::jsonb)::text like '%R3B PRIVATE%'
     or coalesce(l.old_values,'{}'::jsonb)::text like '%R3B-PRIVATE-RECEIPT%'
     or coalesce(l.new_values,'{}'::jsonb)::text like '%R3B-PRIVATE-RECEIPT%'
     or coalesce(l.old_values,'{}'::jsonb)::text like '%@example.test%'
     or coalesce(l.new_values,'{}'::jsonb)::text like '%@example.test%'
     or coalesce(l.old_values,'{}'::jsonb)::text like '%29001010101011%'
     or coalesce(l.new_values,'{}'::jsonb)::text like '%29001010101011%'
     or coalesce(l.old_values,'{}'::jsonb)::text like '%TEST-P-%'
     or coalesce(l.new_values,'{}'::jsonb)::text like '%TEST-P-%'
),'sensitive fixture names and receipt identifiers are not logged');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000b01","email":"r3b-admin-a@example.test","role":"authenticated"}'::text,true);
set local role authenticated;
select ok((select count(*) > 0 from crdc.audit_log),'active admin can read audit rows');
reset role;

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000b03","email":"r3b-reviewer@example.test","role":"authenticated"}'::text,true);
set local role authenticated;
select is((select count(*)::integer from crdc.audit_log),0,'non-admin staff cannot read audit rows');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000b04","email":"r3b-cashier@example.test","role":"authenticated"}'::text,true);
set local role authenticated;
select is((select count(*)::integer from crdc.audit_log),0,'cashier cannot read audit rows');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000b05","email":"r3b-viewer@example.test","role":"authenticated"}'::text,true);
set local role authenticated;
select is((select count(*)::integer from crdc.audit_log),0,'viewer cannot read audit rows');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000b06","email":"r3b-researcher@example.test","role":"authenticated"}'::text,true);
set local role authenticated;
select is((select count(*)::integer from crdc.audit_log),0,'researcher cannot read audit rows');
select throws_ok($$update crdc.audit_log set action='DELETE'::text where id=1::bigint$$,
  '42501'::text,null::text,'authenticated cannot update audit rows');
select throws_ok($$delete from crdc.audit_log where id=1::bigint$$,
  '42501'::text,null::text,'authenticated cannot delete audit rows');
select throws_ok($$insert into crdc.audit_log(table_name,row_key,action,changed_columns) values('payments'::text,'1'::text,'INSERT'::text,array[]::text[])$$,
  '42501'::text,null::text,'authenticated cannot insert audit rows');

select * from finish();
rollback;
