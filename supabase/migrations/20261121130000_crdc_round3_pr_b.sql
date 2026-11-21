-- Round 3 PR B: prevent removal of the last active administrator and record
-- a minimal, explicitly whitelisted operational audit trail.
begin;

create or replace function private.guard_last_active_crdc_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_is_active_admin boolean := false;
begin
  -- A transaction-scoped global lock serializes all staff row removals or
  -- updates. A transaction releasing this lock has committed before the next
  -- guard checks the remaining administrator count.
  perform pg_catalog.pg_advisory_xact_lock(731942, 1);

  if TG_OP = 'UPDATE' then
    v_new_is_active_admin := NEW.is_active and NEW.role = 'admin' and NEW.auth_user_id is not null;
  end if;

  if OLD.is_active and OLD.role = 'admin' and OLD.auth_user_id is not null
     and (TG_OP = 'DELETE' or not v_new_is_active_admin) then
    if not exists (
      select 1
      from crdc.staff_users su
      where su.is_active
        and su.role = 'admin'
        and su.auth_user_id is not null
        and su.staff_id <> OLD.staff_id
    ) then
      raise exception 'Cannot remove the last active CRDC administrator'
        using errcode = '23514';
    end if;
  end if;

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;
revoke all on function private.guard_last_active_crdc_admin() from public, anon, authenticated;
drop trigger if exists staff_users_last_active_admin_guard on crdc.staff_users;
create trigger staff_users_last_active_admin_guard
before update or delete on crdc.staff_users
for each row execute function private.guard_last_active_crdc_admin();

create table crdc.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_auth_user_id uuid,
  table_name text not null check (table_name in ('payments','request_items','staff_users','publication_submissions')),
  row_key text not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  changed_columns text[] not null,
  old_values jsonb,
  new_values jsonb
);
alter table crdc.audit_log enable row level security;
revoke all on table crdc.audit_log from public, anon, authenticated, service_role;
grant select on table crdc.audit_log to authenticated;
drop policy if exists audit_log_active_admin_read on crdc.audit_log;
create policy audit_log_active_admin_read on crdc.audit_log
for select to authenticated
using ((select private.current_crdc_staff_role()) = 'admin');

create or replace function private.audit_crdc_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
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
      v_allowed := array['request_id','amount','currency','channel','paid_at'];
      v_row_key := coalesce(v_new->>'payment_id', v_old->>'payment_id');
    when 'request_items' then
      -- Deliberately track only assignment and payment-link changes.
      v_allowed := array['assigned_staff_id','payment_id'];
      v_row_key := coalesce(v_new->>'item_id', v_old->>'item_id');
    when 'staff_users' then
      -- Identity and display fields are intentionally excluded.
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
      if TG_OP <> 'INSERT' then
        v_old_safe := v_old_safe || jsonb_build_object(v_key, v_old->v_key);
      end if;
      if TG_OP <> 'DELETE' then
        v_new_safe := v_new_safe || jsonb_build_object(v_key, v_new->v_key);
      end if;
    end if;
  end loop;

  -- Omit changes that touch only unapproved columns. In particular, unrelated
  -- request_items updates (including status_id) never produce an audit row.
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

drop trigger if exists payments_audit_log on crdc.payments;
create trigger payments_audit_log after insert or update or delete on crdc.payments
for each row execute function private.audit_crdc_row_change();
drop trigger if exists request_items_audit_log on crdc.request_items;
create trigger request_items_audit_log after insert or update or delete on crdc.request_items
for each row execute function private.audit_crdc_row_change();
drop trigger if exists staff_users_audit_log on crdc.staff_users;
create trigger staff_users_audit_log after insert or update or delete on crdc.staff_users
for each row execute function private.audit_crdc_row_change();
drop trigger if exists publication_submissions_audit_log on crdc.publication_submissions;
create trigger publication_submissions_audit_log after insert or update or delete on crdc.publication_submissions
for each row execute function private.audit_crdc_row_change();

commit;
