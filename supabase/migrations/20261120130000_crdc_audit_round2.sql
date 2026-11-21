-- CRDC audit round 2: self-approval lock, accepted_at preservation, row-level locking (M2).
-- Forward-only. Only function bodies change (same signatures), so existing grants and the
-- crdc wrapper functions stay valid. No data is touched, so it is safe for sams-dev.
begin;

-- ---------------------------------------------------------------------
-- Item status RPC.
--  * Self-approval lock: nobody, admin included, may change the status of an item
--    that belongs to their own researcher profile.
--  * M2: the item row is locked FOR UPDATE before the current status is read, so two
--    concurrent transitions serialise and the second one is validated against the
--    status the first one wrote (instead of both passing and writing duplicate history).
--    The current status code is read in a separate statement AFTER the lock, so it sees
--    the committed result of a transition we waited for.
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
  v_current_status_id smallint;
  v_current text;
  v_target smallint;
begin
  select su.staff_id,su.role into v_staff_id,v_role
  from crdc.staff_users su
  where su.auth_user_id=(select auth.uid()) and su.is_active;
  if not found then raise exception 'Active staff account required' using errcode='42501'; end if;
  if v_role is null or v_role not in ('admin','reviewer','statistician','cashier') then
    raise exception 'Staff role is not permitted to change item status' using errcode='42501';
  end if;

  select i.request_id,i.assigned_staff_id,i.status_id
  into v_request_id,v_assigned,v_current_status_id
  from crdc.request_items i
  where i.item_id=p_item_id
  for update;
  if not found then raise exception 'Service item not found' using errcode='P0002'; end if;

  if exists (
    select 1
    from crdc.service_requests sr
    join crdc.researchers r on r.researcher_id=sr.researcher_id
    where sr.request_id=v_request_id and r.auth_user_id=(select auth.uid())
  ) then
    raise exception 'Staff cannot change the status of their own researcher request' using errcode='42501';
  end if;

  select s.code into v_current from crdc.request_statuses s where s.status_id=v_current_status_id;
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
-- Payment linking RPC (M2).
-- The payment row is locked first, then the selected item rows in item_id order (a fixed
-- order, so two callers cannot deadlock). Validation therefore runs against stable data, and a
-- concurrent edit of the payment waits for this call to commit, after which the payments lock
-- trigger sees the new link. The UPDATE only touches items that are still unlinked; an item
-- already linked to THIS payment is left alone (re-sending the same link stays idempotent),
-- and one linked to ANOTHER payment is rejected by the check below, before the UPDATE.
-- ---------------------------------------------------------------------
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
  from crdc.payments p where p.payment_id=p_payment_id
  for update;
  if not found then raise exception 'Payment not found' using errcode='P0002'; end if;

  perform 1 from crdc.request_items i
  where i.item_id=any(p_item_ids)
  order by i.item_id
  for update;

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
  where i.item_id=any(p_item_ids) and i.payment_id is null;
end;
$$;

-- ---------------------------------------------------------------------
-- Publication RPC.
--  * accepted_at is preserved while the decision stays 'accepted'. It is a DATE column, so
--    current_date is used for the first acceptance (equivalent to now()::date, no implicit cast);
--    leaving 'accepted' still clears it, and accepting again later stamps the new date.
--  * Same self-approval lock as the status RPC: nobody decides on their own paper.
-- ---------------------------------------------------------------------
create or replace function private.update_publication_submission_impl(
  p_item_id bigint, p_decision text, p_journal_id smallint, p_issue_id integer default null
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_staff_id uuid;
begin
  select staff_id, role into v_staff_id, v_role
  from crdc.staff_users
  where auth_user_id = (select auth.uid()) and is_active;
  if not found or v_role not in ('admin','reviewer','statistician') then
    raise exception 'Operational staff account required' using errcode='42501';
  end if;
  if v_role in ('reviewer','statistician') and not exists (
    select 1 from crdc.request_items where item_id=p_item_id and assigned_staff_id=v_staff_id
  ) then raise exception 'This item is not assigned to this staff member' using errcode='42501'; end if;
  if exists (
    select 1
    from crdc.request_items i
    join crdc.service_requests sr on sr.request_id=i.request_id
    join crdc.researchers r on r.researcher_id=sr.researcher_id
    where i.item_id=p_item_id and r.auth_user_id=(select auth.uid())
  ) then
    raise exception 'Staff cannot decide on their own researcher request' using errcode='42501';
  end if;
  if p_decision not in ('pending','revisions','accepted','rejected') then
    raise exception 'Unknown publication decision' using errcode='23514';
  end if;
  if not exists (
    select 1 from crdc.publication_submissions where item_id=p_item_id
  ) then raise exception 'Publication submission not found' using errcode='P0002'; end if;
  if not exists (select 1 from crdc.journals where journal_id=p_journal_id) then
    raise exception 'Journal not found' using errcode='23503'; end if;
  if p_issue_id is not null and not exists (
    select 1 from crdc.journal_issues where issue_id=p_issue_id and journal_id=p_journal_id
  ) then raise exception 'Issue does not belong to this journal' using errcode='23503'; end if;
  update crdc.publication_submissions
  set decision=p_decision, journal_id=p_journal_id, issue_id=p_issue_id,
      accepted_at=case when p_decision='accepted' then coalesce(accepted_at, current_date) else null end
  where item_id=p_item_id;
end;
$$;

commit;
