-- Round 4 follow-up: scoped receipt references, separation of duties,
-- per-payment upload limits, and complete safe audit coverage.
begin;

-- A rejected reference is reusable, and independent payment channels have
-- independent receipt-number spaces. The partial index remains the concurrency
-- safe backstop for simultaneous submissions.
drop index if exists crdc.payments_receipt_no_key;
create unique index payments_channel_receipt_no_active_key
  on crdc.payments (channel, receipt_no)
  where receipt_no is not null
    and receipt_status in ('pending_review','verified');

-- Storage INSERT policy calls this SECURITY DEFINER helper. Serialize uploads
-- per payment so concurrent requests cannot both observe fewer than three
-- objects and exceed the limit.
create or replace function private.crdc_payment_receipt_upload_allowed(p_name text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_parts text[];
  v_request_id bigint;
  v_payment_id bigint;
  v_prefix text;
  v_existing_count bigint;
begin
  if (select auth.uid()) is null
     or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[1-9][0-9]{0,18}/[1-9][0-9]{0,18}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$' then
    return false;
  end if;
  v_parts := storage.foldername(p_name);
  if coalesce(array_length(v_parts, 1), 0) <> 3
     or v_parts[1] <> (select auth.uid())::text then
    return false;
  end if;
  begin
    v_request_id := v_parts[2]::bigint;
    v_payment_id := v_parts[3]::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return false;
  end;

  if not exists (
    select 1
    from crdc.payments p
    join crdc.service_requests sr on sr.request_id = p.request_id
    where p.payment_id = v_payment_id
      and p.request_id = v_request_id
      and sr.researcher_id = (select private.current_crdc_researcher_id())
      and p.payment_order_no is not null
      and p.receipt_status in ('awaiting_receipt','rejected')
      and exists (select 1 from crdc.request_items i where i.payment_id = p.payment_id)
      and not exists (
        select 1
        from crdc.request_items i
        join crdc.request_statuses st using (status_id)
        where i.payment_id = p.payment_id and st.code <> 'PAYMENT_ORDER'
      )
  ) then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crdc-payment-receipt-upload:' || v_payment_id::text, 0)
  );
  v_prefix := v_parts[1] || '/' || v_parts[2] || '/' || v_parts[3] || '/';
  select count(*) into v_existing_count
  from storage.objects o
  where o.bucket_id = 'payment-receipts'
    and left(o.name, char_length(v_prefix)) = v_prefix;

  return v_existing_count < 3;
end;
$$;
revoke all on function private.crdc_payment_receipt_upload_allowed(text) from public, anon;
grant execute on function private.crdc_payment_receipt_upload_allowed(text) to authenticated;

drop policy if exists crdc_payment_receipts_researcher_upload on storage.objects;
create policy crdc_payment_receipts_researcher_upload
on storage.objects for insert to authenticated
with check (
  bucket_id = 'payment-receipts'
  and (select private.crdc_payment_receipt_upload_allowed(name))
);

-- Receipt references are unique only while a receipt is being reviewed or has
-- been verified. A prior rejected receipt does not reserve the reference.
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

-- Staff may not review receipts for requests they own as researchers.
create or replace function crdc.approve_payment_receipt(p_payment_id bigint)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_role text;
  v_request_id bigint;
  v_currency char(3);
  v_amount numeric;
  v_status text;
  v_receipt_no text;
  v_receipt_path text;
  v_item_count integer;
  v_paid_status smallint;
begin
  select su.staff_id, su.role into v_staff_id, v_role
  from crdc.staff_users su
  where su.auth_user_id = (select auth.uid()) and su.is_active;
  if not found or v_role not in ('admin','cashier') then
    raise exception 'Cashier or admin role required' using errcode = '42501';
  end if;

  select p.request_id,p.currency,p.amount,p.receipt_status,p.receipt_no,p.receipt_storage_path
  into v_request_id,v_currency,v_amount,v_status,v_receipt_no,v_receipt_path
  from crdc.payments p where p.payment_id = p_payment_id for update;
  if not found then raise exception 'Payment order not found' using errcode = 'P0002'; end if;
  if exists (
    select 1 from crdc.service_requests sr
    join crdc.researchers r on r.researcher_id = sr.researcher_id
    where sr.request_id = v_request_id and r.auth_user_id = (select auth.uid())
  ) then
    raise exception 'Staff cannot approve a receipt for their own researcher request' using errcode = '42501';
  end if;
  if v_status <> 'pending_review' or v_receipt_no is null or v_receipt_path is null then
    raise exception 'This receipt is not awaiting verification' using errcode = '23514';
  end if;

  perform 1 from crdc.request_items i
  where i.payment_id = p_payment_id order by i.item_id for update;
  select count(*)::integer into v_item_count
  from crdc.request_items i join crdc.request_statuses st using (status_id)
  where i.payment_id = p_payment_id and i.request_id = v_request_id
    and i.currency = v_currency and st.code = 'PAYMENT_ORDER';
  if v_item_count = 0
     or v_item_count <> (select count(*) from crdc.request_items i where i.payment_id = p_payment_id)
     or v_amount <> (select sum(i.amount_due) from crdc.request_items i where i.payment_id = p_payment_id) then
    raise exception 'Payment order items or amount changed before verification' using errcode = '23514';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'payment-receipts' and o.name = v_receipt_path
  ) then
    raise exception 'Receipt file is no longer available' using errcode = '23514';
  end if;
  select st.status_id into v_paid_status from crdc.request_statuses st where st.code = 'PAID';
  if v_paid_status is null then raise exception 'PAID status is missing' using errcode = '23503'; end if;

  update crdc.payments
  set receipt_status = 'verified', verified_by_staff_id = v_staff_id,
      verified_at = clock_timestamp(), rejection_reason = null
  where payment_id = p_payment_id;

  insert into crdc.request_status_history (item_id,status_id,changed_at,changed_by,note)
  select i.item_id,v_paid_status,clock_timestamp(),v_staff_id,'اعتمدت الخزينة السداد بعد مراجعة الإيصال.'
  from crdc.request_items i where i.payment_id = p_payment_id
  order by i.item_id;
end;
$$;

create or replace function crdc.reject_payment_receipt(p_payment_id bigint, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_role text;
  v_request_id bigint;
  v_status text;
begin
  select su.staff_id, su.role into v_staff_id, v_role
  from crdc.staff_users su
  where su.auth_user_id = (select auth.uid()) and su.is_active;
  if not found or v_role not in ('admin','cashier') then
    raise exception 'Cashier or admin role required' using errcode = '42501';
  end if;
  select p.request_id,p.receipt_status into v_request_id,v_status
  from crdc.payments p where p.payment_id = p_payment_id for update;
  if not found then raise exception 'Payment order not found' using errcode = 'P0002'; end if;
  if exists (
    select 1 from crdc.service_requests sr
    join crdc.researchers r on r.researcher_id = sr.researcher_id
    where sr.request_id = v_request_id and r.auth_user_id = (select auth.uid())
  ) then
    raise exception 'Staff cannot reject a receipt for their own researcher request' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'A rejection reason between 3 and 500 characters is required' using errcode = '23514';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'This receipt is not awaiting verification' using errcode = '23514';
  end if;
  update crdc.payments
  set receipt_status = 'rejected', rejection_reason = btrim(p_reason),
      verified_by_staff_id = null, verified_at = null
  where payment_id = p_payment_id;
end;
$$;

-- Extend the existing per-table audit allow-list without adding receipt paths,
-- rejection text, or researcher identity fields.
create or replace function private.audit_crdc_row_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_old_safe jsonb := '{}'::jsonb;
  v_new_safe jsonb := '{}'::jsonb;
  v_columns text[] := array[]::text[];
  v_allowed text[];
  v_key text;
  v_changed boolean;
  v_row_key text;
begin
  if TG_OP <> 'INSERT' then v_old := to_jsonb(OLD); end if;
  if TG_OP <> 'DELETE' then v_new := to_jsonb(NEW); end if;

  case TG_TABLE_NAME
    when 'payments' then
      v_allowed := array[
        'request_id','amount','currency','channel','paid_at','receipt_status',
        'receipt_no','payment_order_no','verified_by_staff_id'
      ];
      v_row_key := coalesce(v_new->>'payment_id', v_old->>'payment_id');
    when 'request_items' then
      v_allowed := array['assigned_staff_id','payment_id'];
      v_row_key := coalesce(v_new->>'item_id', v_old->>'item_id');
    when 'staff_users' then
      v_allowed := array['auth_user_id','role','is_active'];
      v_row_key := coalesce(v_new->>'staff_id', v_old->>'staff_id');
    when 'publication_submissions' then
      v_allowed := array['item_id','service_id','journal_id','issue_id','paper_language','decision','accepted_at'];
      v_row_key := coalesce(v_new->>'submission_id', v_old->>'submission_id');
    else
      raise exception 'Unsupported CRDC audit source: %', TG_TABLE_NAME;
  end case;

  foreach v_key in array v_allowed loop
    if TG_OP = 'INSERT' then
      v_changed := v_new->v_key is not null and v_new->v_key <> 'null'::jsonb;
    elsif TG_OP = 'DELETE' then
      v_changed := v_old->v_key is not null and v_old->v_key <> 'null'::jsonb;
    else
      v_changed := v_old->v_key is distinct from v_new->v_key;
    end if;
    if v_changed then
      v_columns := array_append(v_columns, v_key);
      if TG_OP <> 'INSERT' then v_old_safe := v_old_safe || jsonb_build_object(v_key, v_old->v_key); end if;
      if TG_OP <> 'DELETE' then v_new_safe := v_new_safe || jsonb_build_object(v_key, v_new->v_key); end if;
    end if;
  end loop;

  if cardinality(v_columns) = 0 then
    if TG_OP = 'DELETE' then return OLD; end if;
    return NEW;
  end if;

  insert into crdc.audit_log (
    actor_auth_user_id, table_name, row_key, action,
    changed_columns, old_values, new_values
  ) values (
    auth.uid(), TG_TABLE_NAME, v_row_key, TG_OP,
    v_columns,
    case when TG_OP = 'INSERT' then null else v_old_safe end,
    case when TG_OP = 'DELETE' then null else v_new_safe end
  );
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;
revoke all on function private.audit_crdc_row_change() from public, anon, authenticated;

revoke all on function crdc.submit_payment_receipt(bigint,text,text,date,text) from public, anon;
revoke all on function crdc.approve_payment_receipt(bigint) from public, anon;
revoke all on function crdc.reject_payment_receipt(bigint,text) from public, anon;
grant execute on function crdc.submit_payment_receipt(bigint,text,text,date,text) to authenticated;
grant execute on function crdc.approve_payment_receipt(bigint) to authenticated;
grant execute on function crdc.reject_payment_receipt(bigint,text) to authenticated;

commit;
