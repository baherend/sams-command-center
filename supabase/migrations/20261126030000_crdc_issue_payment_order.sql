create or replace function crdc.issue_payment_order(p_request_id bigint)
returns bigint[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_role text;
  v_submitted smallint;
  v_order_status smallint;
  v_cur record;
  v_item_ids bigint[];
  v_payment_id bigint;
  v_created bigint[] := '{}';
begin
  select su.staff_id, su.role into v_staff_id, v_role
  from crdc.staff_users su
  where su.auth_user_id = (select auth.uid()) and su.is_active;
  if not found or v_role not in ('admin','cashier') then
    raise exception 'Cashier or admin role required' using errcode = '42501';
  end if;

  if exists (
    select 1 from crdc.service_requests sr
    join crdc.researchers r on r.researcher_id = sr.researcher_id
    where sr.request_id = p_request_id and r.auth_user_id = (select auth.uid())
  ) then
    raise exception 'Staff cannot issue a payment order for their own researcher request' using errcode = '42501';
  end if;

  perform 1 from crdc.service_requests sr where sr.request_id = p_request_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;

  select status_id into v_submitted from crdc.request_statuses where code = 'SUBMITTED';
  select status_id into v_order_status from crdc.request_statuses where code = 'PAYMENT_ORDER';
  if v_submitted is null or v_order_status is null then
    raise exception 'Required request statuses are missing' using errcode = '23503';
  end if;

  perform 1 from crdc.request_items i where i.request_id = p_request_id order by i.item_id for update;

  for v_cur in
    select distinct i.currency
    from crdc.request_items i
    where i.request_id = p_request_id and i.status_id = v_submitted and i.payment_id is null
    order by i.currency
  loop
    select array_agg(i.item_id order by i.item_id) into v_item_ids
    from crdc.request_items i
    where i.request_id = p_request_id and i.status_id = v_submitted
      and i.payment_id is null and i.currency = v_cur.currency;

    insert into crdc.payments (request_id, amount, currency, channel)
    select p_request_id, sum(i.amount_due), v_cur.currency, 'treasury'
    from crdc.request_items i where i.item_id = any(v_item_ids)
    returning payment_id into v_payment_id;

    update crdc.payments
    set payment_order_no = 'PO-' || lpad(v_payment_id::text, 5, '0')
    where payment_id = v_payment_id;

    perform private.link_payment_to_items_impl(v_payment_id, v_item_ids);

    update crdc.request_items set status_id = v_order_status
    where item_id = any(v_item_ids);

    insert into crdc.request_status_history (item_id, status_id, changed_at, changed_by, note)
    select i, v_order_status, clock_timestamp(), v_staff_id, 'صدر أمر الدفع.'
    from unnest(v_item_ids) as i;

    v_created := v_created || v_payment_id;
  end loop;

  if cardinality(v_created) = 0 then
    raise exception 'No submitted unpaid items to issue a payment order for' using errcode = '23514';
  end if;
  return v_created;
end;
$$;

revoke all on function crdc.issue_payment_order(bigint) from public;
grant execute on function crdc.issue_payment_order(bigint) to authenticated;