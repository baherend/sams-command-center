begin;

alter table crdc.services add column if not exists name_en text;
alter table crdc.requirement_types add column if not exists name_en text;
alter table crdc.degrees add column if not exists name_en text;
alter table crdc.journals add column if not exists name_en text;
alter table crdc.request_statuses add column if not exists name_en text;

update crdc.services set name_en = case code
  when 'PUB' then 'Research Arbitration & Publication'
  when 'LANG' then 'Proofreading'
  when 'STAT' then 'Statistical Analysis & Review'
  when 'DT' then 'Digital Transformation Fundamentals Certificate'
  when 'PLAG' then 'Plagiarism Check'
  when 'CONSULT' then 'Consultations'
  else name_en end where code in ('PUB','LANG','STAT','DT','PLAG','CONSULT');

update crdc.requirement_types set name_en = case requirement_code
  when 'PUBLICATION' then 'Publish Scientific Paper'
  when 'LANG' then 'Language Review'
  when 'STAT_REVIEW' then 'Statistical Review'
  when 'STAT_ANALYSIS' then 'Statistical Analysis'
  when 'DT' then 'Digital Transformation Fundamentals Certificate'
  when 'PLAG' then 'Plagiarism Check'
  else name_en end where requirement_code in ('PUBLICATION','LANG','STAT_REVIEW','STAT_ANALYSIS','DT','PLAG');

update crdc.degrees set name_en = case code
  when 'PHD_ACAD' then 'Academic PhD'
  when 'MA_ACAD' then 'Academic Master’s'
  when 'PHD_PROF' then 'Professional PhD'
  when 'MA_PROF' then 'Professional Master’s'
  else name_en end where code in ('PHD_ACAD','MA_ACAD','PHD_PROF','MA_PROF');

update crdc.journals set name_en = case code
  when 'JSO' then 'Administrative Research Journal'
  when 'SJSAF' then 'Sadat Journal for Administrative and Financial Research'
  else name_en end where code in ('JSO','SJSAF');

update crdc.request_statuses set name_en = case code
  when 'SUBMITTED' then 'Submitted'
  when 'PAYMENT_ORDER' then 'Payment Order'
  when 'PAID' then 'Paid'
  when 'IN_PROGRESS' then 'In Progress'
  when 'REVISIONS' then 'Revisions Required'
  when 'COMPLETED' then 'Completed'
  when 'DELIVERED' then 'Certificate Delivered'
  else name_en end where code in ('SUBMITTED','PAYMENT_ORDER','PAID','IN_PROGRESS','REVISIONS','COMPLETED','DELIVERED');
create or replace view crdc.staff_dashboard_overview
with (security_barrier = true) as
  select 'total'::text as metric,
         'all'::text as category,
         'كل الطلبات'::text as label,
         count(*)::bigint as request_count,
         'All Requests'::text as label_en
  from crdc.service_requests
  where (select private.current_crdc_staff_role()) in ('admin','viewer')
  having (select private.current_crdc_staff_role()) in ('admin','viewer')

  union all

  select 'applicant_type'::text,
         sr.applicant_type,
         sr.applicant_type,
         count(*)::bigint,
         sr.applicant_type
  from crdc.service_requests sr
  where (select private.current_crdc_staff_role()) in ('admin','viewer')
  group by sr.applicant_type

  union all

  select 'status'::text,
         st.code,
         st.name_ar,
         count(distinct i.request_id)::bigint,
         coalesce(st.name_en, st.name_ar)
  from crdc.request_statuses st
  left join crdc.request_items i using (status_id)
  where (select private.current_crdc_staff_role()) in ('admin','viewer')
  group by st.code, st.name_ar, st.name_en, st.sort_order
  order by metric, category;

revoke all on crdc.staff_dashboard_overview from public, anon, authenticated;
grant select on crdc.staff_dashboard_overview to authenticated;

create or replace view crdc.viewer_dashboard_summary
with (security_barrier = true) as
select s.code as service_code,
       s.name_ar as service_name,
       st.code as status_code,
       st.name_ar as status_name,
       count(*)::bigint as item_count,
       s.name_en as service_name_en,
       st.name_en as status_name_en
from crdc.request_items i
join crdc.services s using (service_id)
join crdc.request_statuses st using (status_id)
where s.is_active
  and (select private.current_crdc_staff_role()) in ('admin','viewer')
group by s.code, s.name_ar, s.name_en, st.code, st.name_ar, st.name_en;

revoke all on crdc.viewer_dashboard_summary from public, anon, authenticated;
grant select on crdc.viewer_dashboard_summary to authenticated;

create or replace function crdc.get_analytics_dashboard(p_days integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = crdc, public
as $$
declare
  v_role text;
begin
  v_role := private.current_crdc_staff_role();
  if v_role is null or v_role not in ('admin', 'viewer') then
    raise exception 'Admin or viewer role required' using errcode = '42501';
  end if;
  if p_days is not null and p_days not between 1 and 3650 then
    raise exception 'p_days must be NULL or between 1 and 3650' using errcode = '22023';
  end if;

  return (
    with req as (
      select sr.request_id, sr.applicant_type
      from crdc.service_requests sr
      where p_days is null
         or sr.created_at >= now() - make_interval(days => p_days)
    ),
    itm as (
      select i.item_id, i.service_id, i.status_id, i.currency, i.amount_due, i.created_at,
             st.code as status_code,
             coalesce(p.receipt_status = 'verified', false) as is_verified
      from crdc.request_items i
      join req r on r.request_id = i.request_id
      join crdc.request_statuses st on st.status_id = i.status_id
      left join crdc.payments p on p.payment_id = i.payment_id
    ),
    turnaround as (
      select extract(epoch from (fin.at - coalesce(sub.at, i.created_at))) / 86400.0 as days
      from itm i
      cross join lateral (
        select min(h.changed_at) as at
        from crdc.request_status_history h
        join crdc.request_statuses s on s.status_id = h.status_id
        where h.item_id = i.item_id and s.code in ('COMPLETED', 'DELIVERED')
      ) fin
      left join lateral (
        select min(h.changed_at) as at
        from crdc.request_status_history h
        join crdc.request_statuses s on s.status_id = h.status_id
        where h.item_id = i.item_id and s.code = 'SUBMITTED'
      ) sub on true
      where fin.at is not null
    ),
    months as (
      select generate_series(
        date_trunc('month', now() at time zone 'UTC') - interval '11 months',
        date_trunc('month', now() at time zone 'UTC'),
        interval '1 month'
      ) as m
    ),
    trend_req as (
      select sr.request_id,
             date_trunc('month', sr.created_at at time zone 'UTC') as m
      from crdc.service_requests sr
      where (sr.created_at at time zone 'UTC') >= (select min(m) from months)
    ),
    trend_rev as (
      select tr.m,
             sum(i.amount_due) filter (where i.currency = 'EGP') as egp,
             sum(i.amount_due) filter (where i.currency = 'USD') as usd
      from trend_req tr
      join crdc.request_items i on i.request_id = tr.request_id
      join crdc.payments p on p.payment_id = i.payment_id and p.receipt_status = 'verified'
      group by tr.m
    )
    select jsonb_build_object(
      'kpis', jsonb_build_object(
        'total_requests', (select count(*) from req),
        'total_items', (select count(*) from itm),
        'active_items', (select count(*) from itm where status_code not in ('COMPLETED', 'DELIVERED')),
        'completed_items', (select count(*) from itm where status_code in ('COMPLETED', 'DELIVERED')),
        'avg_turnaround_days', (select round(avg(greatest(days, 0))::numeric, 2) from turnaround),
        'verified_revenue_egp', (select coalesce(sum(amount_due), 0) from itm where is_verified and currency = 'EGP'),
        'verified_revenue_usd', (select coalesce(sum(amount_due), 0) from itm where is_verified and currency = 'USD')
      ),
      'by_service', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'service_code', s.code,
          'service_name_ar', s.name_ar,
          'service_name_en', s.name_en,
          'item_count', coalesce(a.item_count, 0),
          'revenue_egp', coalesce(a.revenue_egp, 0),
          'revenue_usd', coalesce(a.revenue_usd, 0)
        ) order by s.service_id), '[]'::jsonb)
        from crdc.services s
        left join (
          select service_id, count(*) as item_count,
                 sum(amount_due) filter (where is_verified and currency = 'EGP') as revenue_egp,
                 sum(amount_due) filter (where is_verified and currency = 'USD') as revenue_usd
          from itm group by service_id
        ) a on a.service_id = s.service_id
      ),
      'by_status', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'status_code', st.code,
          'status_name_ar', st.name_ar,
          'status_name_en', st.name_en,
          'item_count', coalesce(a.item_count, 0)
        ) order by st.sort_order), '[]'::jsonb)
        from crdc.request_statuses st
        left join (select status_id, count(*) as item_count from itm group by status_id) a
          on a.status_id = st.status_id
      ),
      'monthly_trend', (
        select jsonb_agg(jsonb_build_object(
          'month', to_char(mo.m, 'YYYY-MM'),
          'request_count', (select count(*) from trend_req t where t.m = mo.m),
          'revenue_egp', coalesce((select egp from trend_rev v where v.m = mo.m), 0),
          'revenue_usd', coalesce((select usd from trend_rev v where v.m = mo.m), 0)
        ) order by mo.m)
        from months mo
      ),
      'applicant_mix', jsonb_build_object(
        'egyptian_requests', (select count(*) from req where applicant_type = 'egyptian'),
        'foreign_requests', (select count(*) from req where applicant_type = 'foreign')
      )
    )
  );
end;
$$;

revoke all on function crdc.get_analytics_dashboard(integer) from public, anon;
grant execute on function crdc.get_analytics_dashboard(integer) to authenticated;

commit;