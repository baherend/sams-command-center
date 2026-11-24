-- Round 6, step 1: aggregate analytics dashboard RPC for admin and viewer staff.
-- Returns one JSONB object of grouped counts and money totals only. It never
-- selects researcher identity columns (names, emails, national IDs, passports,
-- nationality) or any per-case identifier, so the payload is PII-free by design.
--
-- Rules:
--  * p_days filters requests by service_requests.created_at; items, revenue and
--    the applicant mix follow their request. NULL means all time.
--  * Revenue is the amount_due of items linked to a payment whose receipt_status
--    is 'verified', split by the item's currency (EGP / USD, never summed).
--  * Turnaround runs from the first SUBMITTED history row (item created_at if
--    none) to the first COMPLETED or DELIVERED history row.
--  * monthly_trend always covers the last 12 calendar months (UTC), including
--    empty months, and is independent of p_days.
begin;

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
