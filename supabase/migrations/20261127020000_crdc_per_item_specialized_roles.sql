-- Add service-specific staff roles and enforce per-service assignment boundaries.
begin;

alter table crdc.staff_users drop constraint if exists staff_users_role_check;
alter table crdc.staff_users add constraint staff_users_role_check
  check (role in ('admin','reviewer','publication_reviewer','language_reviewer','statistician','digital_transformation_officer','plagiarism_officer','cashier','viewer'));

create or replace function private.crdc_role_matches_service(p_role text, p_service_id smallint)
returns boolean language sql immutable set search_path = '' as $$
  select case p_role
    when 'reviewer' then true
    when 'publication_reviewer' then p_service_id = 1
    when 'language_reviewer' then p_service_id = 2
    when 'statistician' then p_service_id = 3
    when 'digital_transformation_officer' then p_service_id = 4
    when 'plagiarism_officer' then p_service_id = 5
    else false
  end;
$$;

drop policy if exists request_items_admin_assignment on crdc.request_items;
create policy request_items_admin_assignment on crdc.request_items
for update to authenticated using ((select private.current_crdc_staff_role()) = 'admin')
with check ((select private.current_crdc_staff_role()) = 'admin' and (assigned_staff_id is null or exists (
  select 1 from crdc.staff_users su where su.staff_id = request_items.assigned_staff_id and su.is_active and private.crdc_role_matches_service(su.role, request_items.service_id)
)));

drop policy if exists service_requests_read on crdc.service_requests;
create policy service_requests_read on crdc.service_requests
for select to authenticated using (
  (select private.current_crdc_staff_role()) in ('admin','cashier')
  or researcher_id = (select private.current_crdc_researcher_id())
  or ((select private.current_crdc_staff_role()) in ('reviewer','publication_reviewer','language_reviewer','statistician','digital_transformation_officer','plagiarism_officer')
      and exists (select 1 from crdc.request_items i where i.request_id = service_requests.request_id and i.assigned_staff_id = (select private.current_crdc_staff_id())))
);

drop policy if exists request_items_read on crdc.request_items;
create policy request_items_read on crdc.request_items
for select to authenticated using (
  (select private.current_crdc_staff_role()) in ('admin','cashier')
  or (select private.crdc_request_owned_by_current_researcher(request_id))
  or ((select private.current_crdc_staff_role()) in ('reviewer','publication_reviewer','language_reviewer','statistician','digital_transformation_officer','plagiarism_officer')
      and assigned_staff_id = (select private.current_crdc_staff_id()))
);

drop policy if exists status_history_read on crdc.request_status_history;
create policy status_history_read on crdc.request_status_history
for select to authenticated using (
  (select private.current_crdc_staff_role()) = 'admin'
  or (select private.crdc_item_owned_by_current_researcher(item_id))
  or ((select private.current_crdc_staff_role()) = 'cashier' and status_id in (select status_id from crdc.request_statuses where code in ('PAYMENT_ORDER','PAID')))
  or ((select private.current_crdc_staff_role()) in ('reviewer','publication_reviewer','language_reviewer','statistician','digital_transformation_officer','plagiarism_officer')
      and (select private.crdc_item_assigned_to_current_staff(item_id)))
);

drop policy if exists publication_submissions_read on crdc.publication_submissions;
create policy publication_submissions_read on crdc.publication_submissions
for select to authenticated using (
  (select private.current_crdc_staff_role()) = 'admin'
  or (select private.crdc_item_owned_by_current_researcher(item_id))
  or ((select private.current_crdc_staff_role()) in ('reviewer','publication_reviewer','language_reviewer','statistician','digital_transformation_officer','plagiarism_officer')
      and (select private.crdc_item_assigned_to_current_staff(item_id)))
);

drop policy if exists publication_submissions_staff_insert on crdc.publication_submissions;
create policy publication_submissions_staff_insert on crdc.publication_submissions
for insert to authenticated with check (
  ((select private.current_crdc_staff_role()) = 'admin' or ((select private.current_crdc_staff_role()) in ('reviewer','publication_reviewer') and (select private.crdc_item_assigned_to_current_staff(item_id))))
  and exists (select 1 from crdc.request_items i join crdc.fee_schedule f using (fee_id) where i.item_id = publication_submissions.item_id and i.service_id = 1 and f.option_code = 'PUB_PUBLISH')
);

drop policy if exists publication_submissions_staff_update on crdc.publication_submissions;
create policy publication_submissions_staff_update on crdc.publication_submissions
for update to authenticated using ((select private.current_crdc_staff_role()) = 'admin' or ((select private.current_crdc_staff_role()) in ('reviewer','publication_reviewer') and (select private.crdc_item_assigned_to_current_staff(item_id))))
with check (
  ((select private.current_crdc_staff_role()) = 'admin' or ((select private.current_crdc_staff_role()) in ('reviewer','publication_reviewer') and (select private.crdc_item_assigned_to_current_staff(item_id))))
  and exists (select 1 from crdc.request_items i join crdc.fee_schedule f using (fee_id) where i.item_id = publication_submissions.item_id and i.service_id = 1 and f.option_code = 'PUB_PUBLISH')
);

create or replace function crdc.set_request_item_status(p_item_id bigint, p_status_code text, p_note text default null)
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

  if v_role in ('reviewer','publication_reviewer','language_reviewer','statistician','digital_transformation_officer','plagiarism_officer')
     and v_assigned is distinct from v_staff_id then
    raise exception 'This item is not assigned to this staff member' using errcode='42501';
  end if;
  if v_role='cashier' and p_status_code not in ('PAYMENT_ORDER','PAID') then
    raise exception 'Cashiers can only record payment statuses' using errcode='42501';
  end if;
  if v_role in ('reviewer','publication_reviewer','language_reviewer','statistician','digital_transformation_officer','plagiarism_officer')
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

create or replace function crdc.staff_request_page(
  p_after_created_at timestamptz default null,
  p_after_request_id bigint default null,
  p_direction text default 'next',
  p_work_type text default null,
  p_status_code text default null
)
returns table (
  request_id bigint,
  researcher_id uuid,
  applicant_type text,
  work_type text,
  work_title text,
  page_count integer,
  created_at timestamptz,
  queue_status_code text,
  item_count bigint,
  has_more boolean
)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_page_size constant integer := 20;
  v_role text := private.current_crdc_staff_role();
begin
  if coalesce(v_role, ''::text) not in ('admin','reviewer','publication_reviewer','language_reviewer','statistician','digital_transformation_officer','plagiarism_officer') then
    raise exception 'Staff request queue is not available for this role' using errcode='42501';
  end if;
  if p_direction is null or p_direction not in ('next','previous') then
    raise exception 'Unknown staff request page direction' using errcode='22023';
  end if;
  if (p_after_created_at is null) <> (p_after_request_id is null) then
    raise exception 'Both staff request page cursor values must be supplied together' using errcode='22023';
  end if;
  if p_work_type is not null and p_work_type not in ('paper','thesis') then
    raise exception 'Unknown staff request work type' using errcode='22023';
  end if;

  return query
  with bounded_requests as (
    select sr.request_id, sr.researcher_id, sr.applicant_type, sr.work_type,
           sr.work_title, sr.page_count, sr.created_at,
           coalesce(item_summary.queue_status_code, 'NO_ITEMS'::text) as queue_status_code,
           coalesce(item_summary.item_count, 0)::bigint as item_count
    from crdc.service_requests sr
    left join lateral (
      select count(ri.item_id)::bigint as item_count,
             case
               when count(ri.item_id) = 0 then 'NO_ITEMS'::text
               when count(distinct rs.code) > 1 then 'MIXED'::text
               else max(rs.code)
             end as queue_status_code
      from crdc.request_items ri
      join crdc.request_statuses rs using (status_id)
      where ri.request_id = sr.request_id
    ) item_summary on true
    where (p_work_type is null or sr.work_type = p_work_type)
      and (p_status_code is null or coalesce(item_summary.queue_status_code, 'NO_ITEMS'::text) = p_status_code)
      and (
        p_after_created_at is null
        or (p_direction = 'next' and (sr.created_at, sr.request_id) < (p_after_created_at, p_after_request_id))
        or (p_direction = 'previous' and (sr.created_at, sr.request_id) > (p_after_created_at, p_after_request_id))
      )
    order by
      case when p_direction = 'previous' then sr.created_at end asc,
      case when p_direction = 'previous' then sr.request_id end asc,
      case when p_direction = 'next' then sr.created_at end desc,
      case when p_direction = 'next' then sr.request_id end desc
    limit v_page_size + 1
  ), page_with_more as (
    select br.*, (count(*) over () > v_page_size) as has_more
    from bounded_requests br
  )
  select pwr.request_id, pwr.researcher_id, pwr.applicant_type, pwr.work_type,
         pwr.work_title, pwr.page_count, pwr.created_at, pwr.queue_status_code,
         pwr.item_count, pwr.has_more
  from page_with_more pwr
  order by
    case when p_direction = 'previous' then pwr.created_at end asc,
    case when p_direction = 'previous' then pwr.request_id end asc,
    case when p_direction = 'next' then pwr.created_at end desc,
    case when p_direction = 'next' then pwr.request_id end desc;
end;
$$;

revoke all on function crdc.staff_request_page(timestamptz,bigint,text,text,text) from public, anon;
grant execute on function crdc.staff_request_page(timestamptz,bigint,text,text,text) to authenticated;

commit;
