-- Expose only grouped request totals to active admins and viewers.
begin;

-- The CI-only service-role client needs schema usage to create isolated staff fixtures.
grant usage on schema crdc to service_role;
grant insert on crdc.staff_users to service_role;

create or replace view crdc.staff_dashboard_overview
with (security_barrier = true) as
  select 'total'::text as metric, 'all'::text as category, 'كل الطلبات'::text as label,
         count(*)::bigint as request_count
  from crdc.service_requests
  where (select private.current_crdc_staff_role()) in ('admin','viewer')
  having (select private.current_crdc_staff_role()) in ('admin','viewer')

  union all

  select 'applicant_type'::text, sr.applicant_type, sr.applicant_type,
         count(*)::bigint
  from crdc.service_requests sr
  where (select private.current_crdc_staff_role()) in ('admin','viewer')
  group by sr.applicant_type

  union all

  select 'status'::text, st.code, st.name_ar,
         count(distinct i.request_id)::bigint
  from crdc.request_statuses st
  left join crdc.request_items i using (status_id)
  where (select private.current_crdc_staff_role()) in ('admin','viewer')
  group by st.code, st.name_ar, st.sort_order
  order by metric, category;

revoke all on crdc.staff_dashboard_overview from public, anon, authenticated;
grant select on crdc.staff_dashboard_overview to authenticated;

commit;

