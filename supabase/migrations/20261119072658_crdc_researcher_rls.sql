-- Initial Supabase access rules for the CRDC portal.
-- Run after 01_crdc_schema.sql, 02_crdc_reference_data.sql, and 03_crdc_fake_sample_data.sql.
-- Expose schema crdc in Supabase API settings; do not expose schema private.
-- Payment records are staff-only; the script leaves the receipt grouping flexible until the center confirms it.

begin;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='researchers_auth_user_fk' and conrelid='crdc.researchers'::regclass) then
    alter table crdc.researchers add constraint researchers_auth_user_fk
      foreign key (auth_user_id) references auth.users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='staff_users_auth_user_fk' and conrelid='crdc.staff_users'::regclass) then
    alter table crdc.staff_users add constraint staff_users_auth_user_fk
      foreign key (auth_user_id) references auth.users(id) on delete set null;
  end if;
end $$;

create or replace function private.current_crdc_staff_role()
returns text language sql stable security definer set search_path = ''
as $$
  select su.role from crdc.staff_users su
  where su.auth_user_id = (select auth.uid()) and su.is_active limit 1
$$;
revoke all on function private.current_crdc_staff_role() from public, anon;
grant execute on function private.current_crdc_staff_role() to authenticated;

-- Keep RLS enabled and start from no table grants.
revoke all on all tables in schema crdc from public, anon, authenticated;
grant usage on schema crdc to authenticated;
grant select on all tables in schema crdc to authenticated;

-- Profile: a signed-in researcher may create only the profile bound to their
-- own Auth ID and confirmed email. Auth email confirmation must be enabled.
drop policy if exists researcher_read_self_or_staff on crdc.researchers;
create policy researcher_read_self_or_staff on crdc.researchers
for select to authenticated using (
  auth_user_id = (select auth.uid())
  or (select private.current_crdc_staff_role()) is not null
);
drop policy if exists researcher_create_self on crdc.researchers;
create policy researcher_create_self on crdc.researchers
for insert to authenticated with check (
  (select auth.uid()) is not null
  and auth_user_id = (select auth.uid())
  and lower(email) = lower((select auth.jwt()->>'email'))
);
grant insert on crdc.researchers to authenticated;

drop policy if exists staff_users_read_self_or_admin on crdc.staff_users;
create policy staff_users_read_self_or_admin on crdc.staff_users
for select to authenticated using (
  auth_user_id = (select auth.uid())
  or (select private.current_crdc_staff_role()) = 'admin'
);
drop policy if exists staff_users_admin_insert on crdc.staff_users;
create policy staff_users_admin_insert on crdc.staff_users
for insert to authenticated with check ((select private.current_crdc_staff_role()) = 'admin');
drop policy if exists staff_users_admin_update on crdc.staff_users;
create policy staff_users_admin_update on crdc.staff_users
for update to authenticated using ((select private.current_crdc_staff_role()) = 'admin')
with check ((select private.current_crdc_staff_role()) = 'admin');
grant insert, update on crdc.staff_users to authenticated;

-- Catalog: all signed-in users can read; inactive services are staff-only.
drop policy if exists services_read on crdc.services;
create policy services_read on crdc.services for select to authenticated
using (is_active or (select private.current_crdc_staff_role()) is not null);
drop policy if exists requirement_types_read on crdc.requirement_types;
create policy requirement_types_read on crdc.requirement_types for select to authenticated using (true);
drop policy if exists fee_schedule_read on crdc.fee_schedule;
create policy fee_schedule_read on crdc.fee_schedule for select to authenticated using (
  exists (select 1 from crdc.services s where s.service_id=fee_schedule.service_id and s.is_active)
  or (select private.current_crdc_staff_role()) is not null
);
drop policy if exists degrees_read on crdc.degrees;
create policy degrees_read on crdc.degrees for select to authenticated using (true);
drop policy if exists degree_requirements_read on crdc.degree_requirements;
create policy degree_requirements_read on crdc.degree_requirements for select to authenticated using (true);
drop policy if exists journals_read on crdc.journals;
create policy journals_read on crdc.journals for select to authenticated using (true);
drop policy if exists journal_issues_read on crdc.journal_issues;
create policy journal_issues_read on crdc.journal_issues for select to authenticated using (true);
drop policy if exists request_statuses_read on crdc.request_statuses;
create policy request_statuses_read on crdc.request_statuses for select to authenticated using (true);

-- Researchers read only their cases; staff may read cases for center operations.
drop policy if exists service_requests_read on crdc.service_requests;
create policy service_requests_read on crdc.service_requests for select to authenticated using (
  (select private.current_crdc_staff_role()) is not null
  or exists (select 1 from crdc.researchers r
    where r.researcher_id=service_requests.researcher_id and r.auth_user_id=(select auth.uid()))
);
drop policy if exists request_items_read on crdc.request_items;
create policy request_items_read on crdc.request_items for select to authenticated using (
  (select private.current_crdc_staff_role()) is not null
  or exists (select 1 from crdc.service_requests sr join crdc.researchers r using (researcher_id)
    where sr.request_id=request_items.request_id and r.auth_user_id=(select auth.uid()))
);
drop policy if exists payments_read on crdc.payments;
create policy payments_read on crdc.payments for select to authenticated using (
  (select private.current_crdc_staff_role()) is not null
  or exists (select 1 from crdc.service_requests sr join crdc.researchers r using (researcher_id)
    where sr.request_id=payments.request_id and r.auth_user_id=(select auth.uid()))
);
drop policy if exists status_history_read on crdc.request_status_history;
create policy status_history_read on crdc.request_status_history for select to authenticated using (
  (select private.current_crdc_staff_role()) is not null
  or exists (select 1 from crdc.request_items i
    join crdc.service_requests sr using (request_id)
    join crdc.researchers r using (researcher_id)
    where i.item_id=request_status_history.item_id and r.auth_user_id=(select auth.uid()))
);
drop policy if exists publication_submissions_read on crdc.publication_submissions;
create policy publication_submissions_read on crdc.publication_submissions for select to authenticated using (
  (select private.current_crdc_staff_role()) is not null
  or exists (select 1 from crdc.request_items i
    join crdc.service_requests sr using (request_id)
    join crdc.researchers r using (researcher_id)
    where i.item_id=publication_submissions.item_id and r.auth_user_id=(select auth.uid()))
);

-- Reviewers may manage publication decisions only for the publication fee item,
-- never for the separate arbitration fee item.
drop policy if exists publication_submissions_staff_insert on crdc.publication_submissions;
create policy publication_submissions_staff_insert on crdc.publication_submissions
for insert to authenticated with check (
  (select private.current_crdc_staff_role()) in ('admin','reviewer')
  and exists (select 1 from crdc.request_items i join crdc.fee_schedule f using (fee_id)
    where i.item_id=publication_submissions.item_id and i.service_id=1 and f.option_code='PUB_PUBLISH')
);
drop policy if exists publication_submissions_staff_update on crdc.publication_submissions;
create policy publication_submissions_staff_update on crdc.publication_submissions
for update to authenticated using ((select private.current_crdc_staff_role()) in ('admin','reviewer'))
with check (
  (select private.current_crdc_staff_role()) in ('admin','reviewer')
  and exists (select 1 from crdc.request_items i join crdc.fee_schedule f using (fee_id)
    where i.item_id=publication_submissions.item_id and i.service_id=1 and f.option_code='PUB_PUBLISH')
);
grant insert, update on crdc.publication_submissions to authenticated;

-- Direct writes to request items and status history stay blocked; the RPCs below validate request ownership, calculate fees, and append status history.


-- Payment entries are staff-entered. This intentionally allows more than one
-- payment row per request until the center confirms receipt grouping.
drop policy if exists payments_cashier_insert on crdc.payments;
create policy payments_cashier_insert on crdc.payments
for insert to authenticated
with check ((select private.current_crdc_staff_role()) in ('admin','cashier'));
drop policy if exists payments_cashier_update on crdc.payments;
create policy payments_cashier_update on crdc.payments
for update to authenticated
using ((select private.current_crdc_staff_role()) in ('admin','cashier'))
with check ((select private.current_crdc_staff_role()) in ('admin','cashier'));
grant insert, update on crdc.payments to authenticated;

do $$
declare seq_name text;
begin
  seq_name := pg_get_serial_sequence('crdc.payments','payment_id');
  if seq_name is not null then
    execute format('grant usage, select on sequence %s to authenticated', seq_name);
  end if;
  seq_name := pg_get_serial_sequence('crdc.publication_submissions','submission_id');
  if seq_name is not null then
    execute format('grant usage, select on sequence %s to authenticated', seq_name);
  end if;
end $$;

-- Staff assignment is an admin-only edit; status_id remains uneditable directly.
drop policy if exists request_items_admin_assignment on crdc.request_items;
create policy request_items_admin_assignment on crdc.request_items
for update to authenticated
using ((select private.current_crdc_staff_role()) = 'admin')
with check ((select private.current_crdc_staff_role()) = 'admin');
grant update (assigned_staff_id) on crdc.request_items to authenticated;

-- Create one request for one work (paper or thesis) and calculate every item
-- amount in the database. A request may contain multiple service fee options.
create or replace function private.create_service_request_impl(
  p_work_type text, p_work_title text, p_page_count integer, p_fee_ids smallint[]
)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v_researcher_id uuid;
  v_applicant_type text;
  v_request_id bigint;
  v_fee_id smallint;
  v_service_id smallint;
  v_included_pages integer;
  v_active boolean;
  v_status_id smallint;
  v_amount numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign-in required' using errcode='28000';
  end if;
  if p_fee_ids is null or cardinality(p_fee_ids)=0 then
    raise exception 'Select at least one service' using errcode='23514';
  end if;
  if exists (select 1 from unnest(p_fee_ids) as x(fee_id) where fee_id is null)
     or cardinality(p_fee_ids) <> (select count(distinct fee_id) from unnest(p_fee_ids) as x(fee_id)) then
    raise exception 'Fee IDs must be present and unique' using errcode='23514';
  end if;

  select r.researcher_id, r.applicant_type into v_researcher_id, v_applicant_type
  from crdc.researchers r where r.auth_user_id=(select auth.uid());
  if not found then
    raise exception 'Create your researcher profile before submitting a request' using errcode='23503';
  end if;
  select s.status_id into v_status_id from crdc.request_statuses s where s.code='SUBMITTED';
  if v_status_id is null then raise exception 'SUBMITTED status is missing' using errcode='23503'; end if;

  insert into crdc.service_requests(researcher_id,work_type,work_title,page_count)
  values (v_researcher_id,p_work_type,p_work_title,p_page_count)
  returning request_id into v_request_id;

  foreach v_fee_id in array p_fee_ids loop
    select f.service_id,f.included_pages,s.is_active into v_service_id,v_included_pages,v_active
    from crdc.fee_schedule f join crdc.services s using (service_id)
    where f.fee_id=v_fee_id and f.applicant_type=v_applicant_type;
    if not found or not coalesce(v_active,false) then
      raise exception 'Fee option is unavailable for this researcher' using errcode='23514';
    end if;
    if v_service_id=1 and p_work_type <> 'paper' then
      raise exception 'Publication services require a separate paper request' using errcode='23514';
    end if;
    if v_included_pages is not null and p_page_count is null then
      raise exception 'Page count is required for this service' using errcode='23514';
    end if;
    v_amount := crdc.calc_fee(v_fee_id,p_page_count);
    if v_amount is null then raise exception 'Fee calculation failed' using errcode='23514'; end if;
    insert into crdc.request_items(request_id,fee_id,status_id,amount_due)
    values (v_request_id,v_fee_id,v_status_id,v_amount);
  end loop;
  return v_request_id;
end;
$$;

create or replace function crdc.create_service_request(
  p_work_type text, p_work_title text, p_page_count integer, p_fee_ids smallint[]
)
returns bigint language sql security invoker set search_path = ''
as $$ select private.create_service_request_impl($1,$2,$3,$4) $$;

-- Status changes must be appended to history; the existing trigger mirrors the
-- newest event into request_items.status_id.
create or replace function private.set_request_item_status_impl(
  p_item_id bigint, p_status_code text, p_note text default null
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_role text;
  v_request_id bigint;
  v_assigned uuid;
  v_current text;
  v_target smallint;
begin
  select su.staff_id,su.role into v_staff_id,v_role
  from crdc.staff_users su
  where su.auth_user_id=(select auth.uid()) and su.is_active;
  if not found then raise exception 'Active staff account required' using errcode='42501'; end if;

  select i.request_id,i.assigned_staff_id,s.code into v_request_id,v_assigned,v_current
  from crdc.request_items i join crdc.request_statuses s using(status_id)
  where i.item_id=p_item_id;
  if not found then raise exception 'Service item not found' using errcode='P0002'; end if;
  select s.status_id into v_target from crdc.request_statuses s where s.code=p_status_code;
  if v_target is null then raise exception 'Unknown status' using errcode='23514'; end if;

  if v_role in ('reviewer','statistician')
     and v_assigned is distinct from v_staff_id then
    raise exception 'This item is not assigned to this staff member' using errcode='42501';
  end if;
  if v_role='cashier' and p_status_code not in ('PAYMENT_ORDER','PAID') then
    raise exception 'Cashiers can only record payment statuses' using errcode='42501';
  end if;
  if v_role in ('reviewer','statistician')
     and p_status_code not in ('IN_PROGRESS','REVISIONS','COMPLETED','DELIVERED') then
    raise exception 'This role cannot set that status' using errcode='42501';
  end if;
  if not (
       (v_current='SUBMITTED' and p_status_code='PAYMENT_ORDER')
    or (v_current='PAYMENT_ORDER' and p_status_code='PAID')
    or (v_current='PAID' and p_status_code='IN_PROGRESS')
    or (v_current='IN_PROGRESS' and p_status_code in ('REVISIONS','COMPLETED'))
    or (v_current='REVISIONS' and p_status_code='IN_PROGRESS')
    or (v_current='COMPLETED' and p_status_code='DELIVERED')
  ) then raise exception 'Status transition is not allowed' using errcode='23514'; end if;

  if p_status_code='PAYMENT_ORDER' and not exists (select 1 from crdc.request_items i join crdc.payments p on p.payment_id=i.payment_id and p.request_id=i.request_id and p.currency=i.currency where i.item_id=p_item_id and p.payment_order_no is not null) then raise exception 'Link the payment order to this service first' using errcode='23514'; end if;
  if p_status_code='PAID' and not exists (select 1 from crdc.request_items i join crdc.payments p on p.payment_id=i.payment_id and p.request_id=i.request_id and p.currency=i.currency where i.item_id=p_item_id and p.paid_at is not null) then raise exception 'Link the paid receipt to this service first' using errcode='23514'; end if;

  insert into crdc.request_status_history(item_id,status_id,changed_at,changed_by,note)
  values(p_item_id,v_target,clock_timestamp(),v_staff_id,p_note);
end;
$$;

create or replace function crdc.set_request_item_status(
  p_item_id bigint, p_status_code text, p_note text default null
)
returns void language sql security invoker set search_path = ''
as $$ select private.set_request_item_status_impl($1,$2,$3) $$;

revoke all on function private.create_service_request_impl(text,text,integer,smallint[]) from public,anon;
revoke all on function private.set_request_item_status_impl(bigint,text,text) from public,anon;
revoke all on function crdc.create_service_request(text,text,integer,smallint[]) from public,anon;
revoke all on function crdc.set_request_item_status(bigint,text,text) from public,anon;
grant execute on function private.create_service_request_impl(text,text,integer,smallint[]) to authenticated;
grant execute on function private.set_request_item_status_impl(bigint,text,text) to authenticated;
grant execute on function crdc.create_service_request(text,text,integer,smallint[]) to authenticated;
grant execute on function crdc.set_request_item_status(bigint,text,text) to authenticated;


create or replace function private.link_payment_to_items_impl(
  p_payment_id bigint, p_item_ids bigint[]
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_request_id bigint;
  v_currency char(3);
  v_payment_amount numeric;
  v_expected_amount numeric;
begin
  select su.role into v_role from crdc.staff_users su
  where su.auth_user_id=(select auth.uid()) and su.is_active;
  if not found or v_role not in ('admin','cashier') then
    raise exception 'Cashier or admin role required' using errcode='42501';
  end if;
  if p_item_ids is null or cardinality(p_item_ids)=0
     or exists(select 1 from unnest(p_item_ids) as x(item_id) where item_id is null)
     or cardinality(p_item_ids) <> (select count(distinct item_id) from unnest(p_item_ids) as x(item_id)) then
    raise exception 'Item IDs must be present and unique' using errcode='23514';
  end if;
  select p.request_id,p.currency,p.amount into v_request_id,v_currency,v_payment_amount
  from crdc.payments p where p.payment_id=p_payment_id;
  if not found then raise exception 'Payment not found' using errcode='P0002'; end if;
  if (select count(*) from crdc.request_items i where i.item_id=any(p_item_ids))
     <> cardinality(p_item_ids) then
    raise exception 'One or more service items were not found' using errcode='P0002';
  end if;
  if exists(select 1 from crdc.request_items i
    where i.item_id=any(p_item_ids)
      and (i.request_id<>v_request_id or i.currency<>v_currency)) then
    raise exception 'Payment and service items must have the same request and currency' using errcode='23514';
  end if;
  if exists(select 1 from crdc.request_items i where i.item_id=any(p_item_ids)
    and i.payment_id is not null and i.payment_id<>p_payment_id) then
    raise exception 'A service item is already linked to another payment' using errcode='23514';
  end if;
  select sum(i.amount_due) into v_expected_amount from crdc.request_items i where i.item_id=any(p_item_ids);
  if v_payment_amount<>v_expected_amount then
    raise exception 'Payment amount must equal the selected service items total' using errcode='23514';
  end if;
  update crdc.request_items i set payment_id=p_payment_id
  where i.item_id=any(p_item_ids);
end;
$$;

create or replace function crdc.link_payment_to_items(
  p_payment_id bigint, p_item_ids bigint[]
)
returns void language sql security invoker set search_path = ''
as $$ select private.link_payment_to_items_impl($1,$2) $$;

revoke all on function private.link_payment_to_items_impl(bigint,bigint[]) from public,anon;
revoke all on function crdc.link_payment_to_items(bigint,bigint[]) from public,anon;
grant execute on function private.link_payment_to_items_impl(bigint,bigint[]) to authenticated;
grant execute on function crdc.link_payment_to_items(bigint,bigint[]) to authenticated;
-- Enforce the publication sub-service at the database level too. RLS alone
-- would not protect writes made by privileged maintenance roles.
create or replace function crdc.validate_publication_item()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_option_code text;
begin
  select f.option_code into v_option_code
  from crdc.request_items i
  join crdc.fee_schedule f on f.fee_id=i.fee_id
  where i.item_id=new.item_id and i.service_id=new.service_id;
  if not found or v_option_code <> 'PUB_PUBLISH' then
    raise exception 'Publication details require a PUB_PUBLISH service item'
      using errcode='23514';
  end if;
  return new;
end;
$$;
drop trigger if exists publication_item_valid on crdc.publication_submissions;
create trigger publication_item_valid
before insert or update of item_id, service_id
on crdc.publication_submissions
for each row execute function crdc.validate_publication_item();

commit;
