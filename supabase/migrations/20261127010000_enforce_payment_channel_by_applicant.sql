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
  v_channel text;
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
    v_channel := case when v_cur.currency = 'USD' then 'bank' else 'treasury' end;

    select array_agg(i.item_id order by i.item_id) into v_item_ids
    from crdc.request_items i
    where i.request_id = p_request_id and i.status_id = v_submitted
      and i.payment_id is null and i.currency = v_cur.currency;

    insert into crdc.payments (request_id, amount, currency, channel)
    select p_request_id, sum(i.amount_due), v_cur.currency, v_channel
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

create or replace function crdc.submit_payment_receipt(
  p_payment_id bigint,
  p_channel text,
  p_receipt_no text,
  p_paid_at date,
  p_receipt_storage_path text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_researcher_id uuid;
  v_request_id bigint;
  v_currency char(3);
  v_order_no text;
  v_receipt_status text;
  v_item_count integer;
  v_expected_amount numeric;
  v_mimetype text;
  v_file_size bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign-in required' using errcode = '28000';
  end if;
  if (select private.current_crdc_staff_role()) is not null then
    raise exception 'Only the researcher who owns this request may submit its receipt' using errcode = '42501';
  end if;
  select private.current_crdc_researcher_id() into v_researcher_id;
  if v_researcher_id is null then
    raise exception 'Researcher profile required' using errcode = '42501';
  end if;
  if p_channel is null or p_channel not in ('treasury','bank') then
    raise exception 'Unknown payment channel' using errcode = '23514';
  end if;
  if p_receipt_no is null or char_length(btrim(p_receipt_no)) not between 1 and 100 then
    raise exception 'Receipt reference is required and must be at most 100 characters' using errcode = '23514';
  end if;
  if p_paid_at is null or p_paid_at > current_date then
    raise exception 'Payment date is required and cannot be in the future' using errcode = '23514';
  end if;

  select p.request_id, p.currency, p.payment_order_no, p.receipt_status
  into v_request_id, v_currency, v_order_no, v_receipt_status
  from crdc.payments p
  where p.payment_id = p_payment_id
  for update;
  if not found then raise exception 'Payment order not found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from crdc.service_requests sr
    where sr.request_id = v_request_id and sr.researcher_id = v_researcher_id
  ) then
    raise exception 'Payment order does not belong to this researcher' using errcode = '42501';
  end if;
  if v_currency = 'EGP' and p_channel <> 'treasury' then
    raise exception 'Egyptian researchers must pay through treasury' using errcode = '23514';
  end if;
  if v_currency = 'USD' and p_channel <> 'bank' then
    raise exception 'International researchers must pay through bank' using errcode = '23514';
  end if;
  if v_order_no is null or v_receipt_status not in ('awaiting_receipt','rejected') then
    raise exception 'This payment order is not awaiting a receipt' using errcode = '23514';
  end if;

  perform 1 from crdc.request_items i
  where i.payment_id = p_payment_id order by i.item_id for update;
  select count(*)::integer, coalesce(sum(i.amount_due), 0)
  into v_item_count, v_expected_amount
  from crdc.request_items i join crdc.request_statuses st using (status_id)
  where i.payment_id = p_payment_id
    and i.request_id = v_request_id and i.currency = v_currency
    and st.code = 'PAYMENT_ORDER';
  if v_item_count = 0
     or v_item_count <> (select count(*) from crdc.request_items i where i.payment_id = p_payment_id)
     or v_expected_amount <> (select p.amount from crdc.payments p where p.payment_id = p_payment_id) then
    raise exception 'Payment order items are not all awaiting payment or the amount does not match' using errcode = '23514';
  end if;

  if p_receipt_storage_path is null or p_receipt_storage_path !~ (
    '^' || (select auth.uid())::text || '/' || v_request_id::text || '/' || p_payment_id::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$'
  ) then
    raise exception 'Receipt file path is not valid for this payment order' using errcode = '23514';
  end if;
  select o.metadata->>'mimetype',
         case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else null end
  into v_mimetype, v_file_size
  from storage.objects o
  where o.bucket_id = 'payment-receipts' and o.name = p_receipt_storage_path;
  if not found or v_mimetype is null or v_mimetype not in ('application/pdf','image/jpeg','image/png')
     or v_file_size is null or v_file_size < 1 or v_file_size > 5242880 then
    raise exception 'Receipt file is missing or has an unsupported type or size' using errcode = '23514';
  end if;
  if exists (
    select 1 from crdc.payments p
    where p.channel = p_channel
      and p.receipt_no = btrim(p_receipt_no)
      and p.payment_id <> p_payment_id
      and p.receipt_status in ('pending_review','verified')
  ) then
    raise exception 'Receipt reference is already in use for this channel' using errcode = '23505';
  end if;

  update crdc.payments
  set channel = p_channel,
      receipt_no = btrim(p_receipt_no),
      paid_at = p_paid_at,
      receipt_storage_path = p_receipt_storage_path,
      submitted_by_researcher_at = clock_timestamp(),
      receipt_status = 'pending_review',
      verified_by_staff_id = null,
      verified_at = null,
      rejection_reason = null
  where payment_id = p_payment_id;
exception
  when unique_violation then
    raise exception 'Receipt reference is already in use for this channel' using errcode = '23505';
end;
$$;

revoke all on function crdc.submit_payment_receipt(bigint,text,text,date,text) from public, anon;
grant execute on function crdc.submit_payment_receipt(bigint,text,text,date,text) to authenticated;
