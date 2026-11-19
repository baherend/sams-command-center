-- Tighten operational access to least privilege by CRDC role.
-- Researchers retain visibility into their own payment and receipt records.
-- Cashiers receive only a limited contact view; viewers receive aggregates only.

begin;

create or replace function private.current_crdc_staff_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select su.staff_id from crdc.staff_users su
  where su.auth_user_id = (select auth.uid()) and su.is_active
  limit 1
$$;

create or replace function private.current_crdc_researcher_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select r.researcher_id from crdc.researchers r
  where r.auth_user_id = (select auth.uid())
  limit 1
$$;

create or replace function private.crdc_request_owned_by_current_researcher(p_request_id bigint)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from crdc.service_requests sr
    where sr.request_id = p_request_id
      and sr.researcher_id = (select private.current_crdc_researcher_id())
  )
$$;

create or replace function private.crdc_item_owned_by_current_researcher(p_item_id bigint)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from crdc.request_items i
    join crdc.service_requests sr using (request_id)
    where i.item_id = p_item_id
      and sr.researcher_id = (select private.current_crdc_researcher_id())
  )
$$;

create or replace function private.crdc_item_assigned_to_current_staff(p_item_id bigint)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from crdc.request_items i
    where i.item_id = p_item_id
      and i.assigned_staff_id = (select private.current_crdc_staff_id())
  )
$$;

revoke all on function private.current_crdc_staff_id() from public, anon;
revoke all on function private.current_crdc_researcher_id() from public, anon;
revoke all on function private.crdc_request_owned_by_current_researcher(bigint) from public, anon;
revoke all on function private.crdc_item_owned_by_current_researcher(bigint) from public, anon;
revoke all on function private.crdc_item_assigned_to_current_staff(bigint) from public, anon;
grant execute on function private.current_crdc_staff_id() to authenticated;
grant execute on function private.current_crdc_researcher_id() to authenticated;
grant execute on function private.crdc_request_owned_by_current_researcher(bigint) to authenticated;
grant execute on function private.crdc_item_owned_by_current_researcher(bigint) to authenticated;
grant execute on function private.crdc_item_assigned_to_current_staff(bigint) to authenticated;

-- Researcher identity details stay visible to the researcher and administrators.
drop policy if exists researcher_read_self_or_staff on crdc.researchers;
create policy researcher_read_self_or_admin on crdc.researchers
for select to authenticated using (
  auth_user_id = (select auth.uid())
  or (select private.current_crdc_staff_role()) = 'admin'
);

-- Replace broad staff reads with role and assignment scoped access.
drop policy if exists service_requests_read on crdc.service_requests;
create policy service_requests_read on crdc.service_requests
for select to authenticated using (
  (select private.current_crdc_staff_role()) in ('admin','cashier')
  or researcher_id = (select private.current_crdc_researcher_id())
  or (
    (select private.current_crdc_staff_role()) in ('reviewer','statistician')
    and exists (
      select 1 from crdc.request_items i
      where i.request_id = service_requests.request_id
        and i.assigned_staff_id = (select private.current_crdc_staff_id())
    )
  )
);

drop policy if exists request_items_read on crdc.request_items;
create policy request_items_read on crdc.request_items
for select to authenticated using (
  (select private.current_crdc_staff_role()) in ('admin','cashier')
  or (select private.crdc_request_owned_by_current_researcher(request_id))
  or (
    (select private.current_crdc_staff_role()) in ('reviewer','statistician')
    and assigned_staff_id = (select private.current_crdc_staff_id())
  )
);

drop policy if exists payments_read on crdc.payments;
create policy payments_read on crdc.payments
for select to authenticated using (
  (select private.current_crdc_staff_role()) in ('admin','cashier')
  or (select private.crdc_request_owned_by_current_researcher(request_id))
);

drop policy if exists status_history_read on crdc.request_status_history;
create policy status_history_read on crdc.request_status_history
for select to authenticated using (
  (select private.current_crdc_staff_role()) = 'admin'
  or (select private.crdc_item_owned_by_current_researcher(item_id))
  or (
    (select private.current_crdc_staff_role()) = 'cashier'
    and status_id in (select status_id from crdc.request_statuses where code in ('PAYMENT_ORDER','PAID'))
  )
  or (
    (select private.current_crdc_staff_role()) in ('reviewer','statistician')
    and (select private.crdc_item_assigned_to_current_staff(item_id))
  )
);

drop policy if exists publication_submissions_read on crdc.publication_submissions;
create policy publication_submissions_read on crdc.publication_submissions
for select to authenticated using (
  (select private.current_crdc_staff_role()) = 'admin'
  or (select private.crdc_item_owned_by_current_researcher(item_id))
  or (
    (select private.current_crdc_staff_role()) in ('reviewer','statistician')
    and (select private.crdc_item_assigned_to_current_staff(item_id))
  )
);

drop policy if exists publication_submissions_staff_insert on crdc.publication_submissions;
create policy publication_submissions_staff_insert on crdc.publication_submissions
for insert to authenticated with check (
  (
    (select private.current_crdc_staff_role()) = 'admin'
    or (
      (select private.current_crdc_staff_role()) = 'reviewer'
      and (select private.crdc_item_assigned_to_current_staff(item_id))
    )
  )
  and exists (
    select 1 from crdc.request_items i join crdc.fee_schedule f using (fee_id)
    where i.item_id = publication_submissions.item_id
      and i.service_id = 1 and f.option_code = 'PUB_PUBLISH'
  )
);

drop policy if exists publication_submissions_staff_update on crdc.publication_submissions;
create policy publication_submissions_staff_update on crdc.publication_submissions
for update to authenticated
using (
  (select private.current_crdc_staff_role()) = 'admin'
  or (
    (select private.current_crdc_staff_role()) = 'reviewer'
    and (select private.crdc_item_assigned_to_current_staff(item_id))
  )
)
with check (
  (
    (select private.current_crdc_staff_role()) = 'admin'
    or (
      (select private.current_crdc_staff_role()) = 'reviewer'
      and (select private.crdc_item_assigned_to_current_staff(item_id))
    )
  )
  and exists (
    select 1 from crdc.request_items i join crdc.fee_schedule f using (fee_id)
    where i.item_id = publication_submissions.item_id
      and i.service_id = 1 and f.option_code = 'PUB_PUBLISH'
  )
);

-- Cashiers get contact details needed to match a request, without national IDs/passports.
create or replace view crdc.cashier_request_contacts
with (security_barrier = true) as
select sr.request_id, sr.work_type, sr.work_title,
       r.full_name, r.email, r.applicant_type
from crdc.service_requests sr
join crdc.researchers r using (researcher_id)
where (select private.current_crdc_staff_role()) in ('admin','cashier');
revoke all on crdc.cashier_request_contacts from public, anon, authenticated;
grant select on crdc.cashier_request_contacts to authenticated;

-- The viewer role receives only grouped operational counts, never case rows or identities.
create or replace view crdc.viewer_dashboard_summary
with (security_barrier = true) as
select s.code as service_code, s.name_ar as service_name,
       st.code as status_code, st.name_ar as status_name,
       count(*)::bigint as item_count
from crdc.request_items i
join crdc.services s using (service_id)
join crdc.request_statuses st using (status_id)
where s.is_active
  and (select private.current_crdc_staff_role()) in ('admin','viewer')
group by s.code, s.name_ar, st.code, st.name_ar;
revoke all on crdc.viewer_dashboard_summary from public, anon, authenticated;
grant select on crdc.viewer_dashboard_summary to authenticated;

commit;
