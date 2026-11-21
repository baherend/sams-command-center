-- Round 3 PR C: bounded staff request pages using keyset pagination.
begin;

create index if not exists service_requests_staff_page_key_idx
  on crdc.service_requests (created_at desc, request_id desc);

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
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_page_size constant integer := 20;
  v_role text := private.current_crdc_staff_role();
begin
  if coalesce(v_role, ''::text) not in ('admin','reviewer','statistician') then
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
