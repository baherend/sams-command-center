-- Security and data-integrity fixes from the CRDC review (C1, H1, H2, M1, M3).
-- Forward-only: earlier migrations are untouched. Safe for local reset and for sams-dev
-- (no synthetic data); if sams-dev ever holds rows that violate a new constraint or unique
-- index, the migration fails loudly and nothing is applied.
begin;

-- ---------------------------------------------------------------------
-- C1: viewer (and any non-operational role) must not change item status.
-- Same body as the previous definition plus the allow-list above; the
-- signature is unchanged, so existing grants and the crdc wrapper stay valid.
-- ---------------------------------------------------------------------
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
  -- C1: only operational roles may change an item status. Without this explicit
  -- allow-list a viewer fell through every role-specific branch below.
  if v_role is null or v_role not in ('admin','reviewer','statistician','cashier') then
    raise exception 'Staff role is not permitted to change item status' using errcode='42501';
  end if;

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

-- ---------------------------------------------------------------------
-- H2: publication_submissions is written only through
-- crdc.update_publication_submission(...), which sets accepted_at server-side.
-- The RPC is SECURITY DEFINER, so it is unaffected by these revokes. The direct
-- policies are dropped because they are now unreachable and (unlike the RPC)
-- excluded statisticians, which made the two paths inconsistent.
-- The RPC already treats reviewer and statistician identically: both need an
-- active account and an item assigned to them; admin is unrestricted.
-- ---------------------------------------------------------------------
revoke insert, update on crdc.publication_submissions from authenticated;
drop policy if exists publication_submissions_staff_insert on crdc.publication_submissions;
drop policy if exists publication_submissions_staff_update on crdc.publication_submissions;

do $$
declare seq_name text;
begin
  seq_name := pg_get_serial_sequence('crdc.publication_submissions','submission_id');
  if seq_name is not null then
    execute format('revoke usage, select on sequence %s from authenticated', seq_name);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- H1: payments become immutable once a service item references them.
-- SECURITY DEFINER so the "is it linked?" check is not filtered by the
-- caller's RLS (a cashier cannot read every request_items row).
-- amount, currency and request_id never change once linked. payment_order_no,
-- receipt_no and paid_at may be filled in once while still NULL (the order is
-- recorded before payment, and the PAID transition needs paid_at on the already
-- linked payment), but a recorded value can neither be changed nor cleared.
-- ---------------------------------------------------------------------
create or replace function private.trg_payments_lock()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from crdc.request_items i where i.payment_id = old.payment_id) then
    if new.amount     is distinct from old.amount
       or new.currency   is distinct from old.currency
       or new.request_id is distinct from old.request_id
       or (old.payment_order_no is not null and new.payment_order_no is distinct from old.payment_order_no)
       or (old.receipt_no       is not null and new.receipt_no       is distinct from old.receipt_no)
       or (old.paid_at          is not null and new.paid_at          is distinct from old.paid_at)
    then
      raise exception 'Payment is linked to service items; its recorded values are locked'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.trg_payments_lock() from public, anon, authenticated;

drop trigger if exists payments_lock on crdc.payments;
create trigger payments_lock
before update on crdc.payments
for each row execute function private.trg_payments_lock();

create unique index payments_receipt_no_key
  on crdc.payments (receipt_no) where receipt_no is not null;
create unique index payments_payment_order_no_key
  on crdc.payments (payment_order_no) where payment_order_no is not null;

-- ---------------------------------------------------------------------
-- M1: basic identity validation.
-- work_title lives on service_requests (not researchers).
-- ---------------------------------------------------------------------
alter table crdc.researchers
  add constraint researchers_national_id_not_blank
  check (national_id is null or btrim(national_id) <> '');
alter table crdc.service_requests
  add constraint service_requests_work_title_not_blank
  check (btrim(work_title) <> '');

create unique index researchers_national_id_key
  on crdc.researchers (national_id) where national_id is not null;
create unique index researchers_passport_nationality_key
  on crdc.researchers (passport_no, nationality)
  where passport_no is not null and nationality is not null;

-- ---------------------------------------------------------------------
-- M3: separation of duties. A staff member whose Auth user is the researcher
-- on a request cannot be assigned to that request's items. Enforced by trigger
-- so it holds for every writer (admin policy path, service role, maintenance),
-- not only for the admin RLS policy. Raises 42501 like the existing assignment
-- policy, so callers see one error class for "assignment not allowed".
-- ---------------------------------------------------------------------
create or replace function private.trg_item_assignment_separation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.assigned_staff_id is not null and exists (
    select 1
    from crdc.staff_users su
    join crdc.service_requests sr on sr.request_id = new.request_id
    join crdc.researchers r on r.researcher_id = sr.researcher_id
    where su.staff_id = new.assigned_staff_id
      and su.auth_user_id is not null
      and su.auth_user_id = r.auth_user_id
  ) then
    raise exception 'Staff cannot be assigned to their own researcher request'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.trg_item_assignment_separation() from public, anon, authenticated;

drop trigger if exists item_assignment_separation on crdc.request_items;
create trigger item_assignment_separation
before insert or update of assigned_staff_id, request_id on crdc.request_items
for each row execute function private.trg_item_assignment_separation();

commit;
