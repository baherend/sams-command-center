-- Round 4: researcher receipt submission and cashier verification.
-- Payment orders still group one or more items from one request/currency. Items
-- are linked to the payment order before submission and are marked PAID only by
-- approve_payment_receipt after the cashier verifies the private receipt file.
begin;

alter table crdc.payments
  add column receipt_status text not null default 'awaiting_receipt',
  add column receipt_storage_path text,
  add column submitted_by_researcher_at timestamptz,
  add column verified_by_staff_id uuid references crdc.staff_users(staff_id),
  add column verified_at timestamptz,
  add column rejection_reason text,
  add constraint payments_receipt_status_check
    check (receipt_status in ('awaiting_receipt','pending_review','rejected','verified')),
  add constraint payments_receipt_rejection_reason_length
    check (rejection_reason is null or char_length(btrim(rejection_reason)) between 3 and 500);

-- Existing paid rows were verified through the previous cashier workflow.
update crdc.payments
set receipt_status = 'verified',
    verified_at = coalesce(paid_at::timestamptz, clock_timestamp())
where paid_at is not null;

create index payments_receipt_review_page_idx
  on crdc.payments (submitted_by_researcher_at desc, payment_id desc)
  where receipt_status = 'pending_review';

-- Private bucket: Storage enforces this 5 MiB limit and MIME allow-list at upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-receipts', 'payment-receipts', false, 5242880,
  array['application/pdf','image/jpeg','image/png']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Object paths are {auth.uid()}/{request_id}/{payment_id}/{uuid}.{ext}.
-- These definer helpers let Storage RLS check the private CRDC ownership tables
-- without exposing those tables or identities to the Storage API caller.
create or replace function private.crdc_payment_receipt_upload_allowed(p_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_parts text[];
  v_request_id bigint;
  v_payment_id bigint;
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

  return exists (
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
  );
end;
$$;

create or replace function private.crdc_payment_receipt_owner_can_read(p_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_parts text[];
  v_request_id bigint;
  v_payment_id bigint;
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

  return exists (
    select 1
    from crdc.payments p
    join crdc.service_requests sr on sr.request_id = p.request_id
    where p.payment_id = v_payment_id
      and p.request_id = v_request_id
      and p.receipt_storage_path = p_name
      and sr.researcher_id = (select private.current_crdc_researcher_id())
  );
end;
$$;

create or replace function private.crdc_payment_receipt_staff_can_read(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select private.current_crdc_staff_role()) in ('admin','cashier')
    and exists (
      select 1 from crdc.payments p
      where p.receipt_storage_path = p_name
        and p.receipt_status in ('pending_review','rejected','verified')
    )
$$;

revoke all on function private.crdc_payment_receipt_upload_allowed(text) from public, anon;
revoke all on function private.crdc_payment_receipt_owner_can_read(text) from public, anon;
revoke all on function private.crdc_payment_receipt_staff_can_read(text) from public, anon;
grant execute on function private.crdc_payment_receipt_upload_allowed(text) to authenticated;
grant execute on function private.crdc_payment_receipt_owner_can_read(text) to authenticated;
grant execute on function private.crdc_payment_receipt_staff_can_read(text) to authenticated;

drop policy if exists crdc_payment_receipts_researcher_upload on storage.objects;
create policy crdc_payment_receipts_researcher_upload
on storage.objects for insert to authenticated
with check (
  bucket_id = 'payment-receipts'
  and (select private.crdc_payment_receipt_upload_allowed(name))
);

drop policy if exists crdc_payment_receipts_researcher_read on storage.objects;
create policy crdc_payment_receipts_researcher_read
on storage.objects for select to authenticated
using (
  bucket_id = 'payment-receipts'
  and (select private.crdc_payment_receipt_owner_can_read(name))
);

drop policy if exists crdc_payment_receipts_staff_read on storage.objects;
create policy crdc_payment_receipts_staff_read
on storage.objects for select to authenticated
using (
  bucket_id = 'payment-receipts'
  and (select private.crdc_payment_receipt_staff_can_read(name))
);

-- There are intentionally no UPDATE or DELETE policies for this bucket.

-- The old lock permitted receipt fields to be filled once after item linking.
-- This version also allows a rejected proof to be replaced, but freezes the
-- proof and its payment once approved. Direct table privileges below keep these
-- workflow fields writable only through the definer RPCs.
create or replace function private.trg_payments_lock()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_linked boolean;
begin
  select exists (select 1 from crdc.request_items i where i.payment_id = old.payment_id)
  into v_linked;
  if not v_linked then return new; end if;

  if new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.request_id is distinct from old.request_id
     or new.payment_order_no is distinct from old.payment_order_no then
    raise exception 'Payment is linked to service items; its order values are locked'
      using errcode = '23514';
  end if;

  if old.receipt_status = 'verified' then
    if new is distinct from old then
      raise exception 'Verified payment and receipt values are immutable'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.receipt_status = 'pending_review' then
    if new.receipt_status not in ('verified','rejected')
       or new.receipt_no is distinct from old.receipt_no
       or new.amount is distinct from old.amount
       or new.currency is distinct from old.currency
       or new.channel is distinct from old.channel
       or new.paid_at is distinct from old.paid_at
       or new.receipt_storage_path is distinct from old.receipt_storage_path
       or new.submitted_by_researcher_at is distinct from old.submitted_by_researcher_at
       or (new.receipt_status = 'verified' and (new.rejection_reason is not null or new.verified_at is null or new.verified_by_staff_id is null))
       or (new.receipt_status = 'rejected' and (new.rejection_reason is null or new.verified_at is not null or new.verified_by_staff_id is not null)) then
      raise exception 'Pending receipt may only be approved or rejected by its workflow'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.receipt_status = 'pending_review'
     and old.receipt_status in ('awaiting_receipt','rejected')
     and new.receipt_no is not null and btrim(new.receipt_no) <> ''
     and new.paid_at is not null and new.receipt_storage_path is not null
     and new.submitted_by_researcher_at is not null
     and new.rejection_reason is null
     and new.verified_by_staff_id is null and new.verified_at is null then
    return new;
  end if;

  if new.receipt_status is distinct from old.receipt_status
     or new.receipt_no is distinct from old.receipt_no
     or new.channel is distinct from old.channel
     or new.paid_at is distinct from old.paid_at
     or new.receipt_storage_path is distinct from old.receipt_storage_path
     or new.submitted_by_researcher_at is distinct from old.submitted_by_researcher_at
     or new.verified_by_staff_id is distinct from old.verified_by_staff_id
     or new.verified_at is distinct from old.verified_at
     or new.rejection_reason is distinct from old.rejection_reason then
    raise exception 'Receipt values may only change through the receipt workflow'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.trg_payments_lock() from public, anon, authenticated;

-- Payment-order setup remains a cashier/admin table operation, while receipt
-- metadata, paid dates, and verification state are available only through RPCs.
revoke insert, update on crdc.payments from authenticated;
grant insert (request_id, payment_order_no, amount, currency, channel)
  on crdc.payments to authenticated;
grant update (request_id, payment_order_no, amount, currency, channel)
  on crdc.payments to authenticated;

-- Keep the audit log minimal: log receipt state transitions, never references,
-- object paths, rejection text, email, or any identity fields.
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
      v_allowed := array['request_id','amount','currency','channel','paid_at','receipt_status'];
      v_row_key := coalesce(v_new->>'payment_id', v_old->>'payment_id');
    when 'request_items' then
      v_allowed := array['assigned_staff_id','payment_id'];
      v_row_key := coalesce(v_new->>'item_id', v_old->>'item_id');
    when 'staff_users' then
      v_allowed := array['role','is_active'];
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

-- PAID may no longer be set through the generic cashier status function.
-- Receipt approval is the only path which can append the PAID history rows.
create or replace function crdc.set_request_item_status(
  p_item_id bigint, p_status_code text, p_note text default null
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_status_code = 'PAID' then
    raise exception 'A receipt must be approved before recording PAID'
      using errcode = '42501';
  end if;
  perform private.set_request_item_status_impl(p_item_id, p_status_code, p_note);
end;
$$;
revoke all on function private.set_request_item_status_impl(bigint,text,text) from public, anon, authenticated;
revoke all on function crdc.set_request_item_status(bigint,text,text) from public, anon;
grant execute on function crdc.set_request_item_status(bigint,text,text) to authenticated;

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
    where p.receipt_no = btrim(p_receipt_no) and p.payment_id <> p_payment_id
  ) then
    raise exception 'Receipt reference is already in use' using errcode = '23505';
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
end;
$$;

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
  v_status text;
begin
  select su.staff_id, su.role into v_staff_id, v_role
  from crdc.staff_users su
  where su.auth_user_id = (select auth.uid()) and su.is_active;
  if not found or v_role not in ('admin','cashier') then
    raise exception 'Cashier or admin role required' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'A rejection reason between 3 and 500 characters is required' using errcode = '23514';
  end if;
  select p.receipt_status into v_status
  from crdc.payments p where p.payment_id = p_payment_id for update;
  if not found then raise exception 'Payment order not found' using errcode = 'P0002'; end if;
  if v_status <> 'pending_review' then
    raise exception 'This receipt is not awaiting verification' using errcode = '23514';
  end if;
  update crdc.payments
  set receipt_status = 'rejected', rejection_reason = btrim(p_reason),
      verified_by_staff_id = null, verified_at = null
  where payment_id = p_payment_id;
end;
$$;

create or replace function crdc.cashier_payment_receipt_page(
  p_after_submitted_at timestamptz default null,
  p_after_payment_id bigint default null,
  p_direction text default 'next'
)
returns table (
  payment_id bigint,
  request_id bigint,
  receipt_no text,
  amount numeric,
  currency character(3),
  channel text,
  paid_at date,
  receipt_storage_path text,
  submitted_by_researcher_at timestamptz,
  has_more boolean
)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_page_size constant integer := 20;
  v_role text := private.current_crdc_staff_role();
begin
  if coalesce(v_role, ''::text) not in ('admin','cashier') then
    raise exception 'Cashier workspace is not available for this role' using errcode = '42501';
  end if;
  if p_direction is null or p_direction not in ('next','previous') then
    raise exception 'Unknown receipt page direction' using errcode = '22023';
  end if;
  if (p_after_submitted_at is null) <> (p_after_payment_id is null) then
    raise exception 'Both receipt page cursor values must be supplied together' using errcode = '22023';
  end if;

  return query
  with bounded as (
    select p.payment_id,p.request_id,p.receipt_no,p.amount,p.currency,p.channel,p.paid_at,
           p.receipt_storage_path,p.submitted_by_researcher_at
    from crdc.payments p
    where p.receipt_status = 'pending_review'
      and p.receipt_storage_path is not null
      and (p_after_submitted_at is null
        or (p_direction = 'next' and (p.submitted_by_researcher_at,p.payment_id) < (p_after_submitted_at,p_after_payment_id))
        or (p_direction = 'previous' and (p.submitted_by_researcher_at,p.payment_id) > (p_after_submitted_at,p_after_payment_id)))
    order by
      case when p_direction = 'previous' then p.submitted_by_researcher_at end asc,
      case when p_direction = 'previous' then p.payment_id end asc,
      case when p_direction = 'next' then p.submitted_by_researcher_at end desc,
      case when p_direction = 'next' then p.payment_id end desc
    limit v_page_size + 1
  ), marked as (
    select b.*, count(*) over () > v_page_size as has_more from bounded b
  )
  select m.payment_id,m.request_id,m.receipt_no,m.amount,m.currency,m.channel,m.paid_at,
         m.receipt_storage_path,m.submitted_by_researcher_at,m.has_more
  from marked m
  order by
    case when p_direction = 'previous' then m.submitted_by_researcher_at end asc,
    case when p_direction = 'previous' then m.payment_id end asc,
    case when p_direction = 'next' then m.submitted_by_researcher_at end desc,
    case when p_direction = 'next' then m.payment_id end desc;
end;
$$;

revoke all on function crdc.submit_payment_receipt(bigint,text,text,date,text) from public, anon;
revoke all on function crdc.approve_payment_receipt(bigint) from public, anon;
revoke all on function crdc.reject_payment_receipt(bigint,text) from public, anon;
revoke all on function crdc.cashier_payment_receipt_page(timestamptz,bigint,text) from public, anon;
grant execute on function crdc.submit_payment_receipt(bigint,text,text,date,text) to authenticated;
grant execute on function crdc.approve_payment_receipt(bigint) to authenticated;
grant execute on function crdc.reject_payment_receipt(bigint,text) to authenticated;
grant execute on function crdc.cashier_payment_receipt_page(timestamptz,bigint,text) to authenticated;

commit;
