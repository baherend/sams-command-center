-- Public catalog for the CRDC public website (visitors who are not signed in).
--
-- Why a separate schema instead of granting anon on crdc:
--   anon has no USAGE on schema crdc today. Granting it would make every crdc function whose
--   EXECUTE was never revoked from PUBLIC callable by anyone on the internet, and every future
--   function too. Instead, visitors get one read-only function in its own schema, and nothing else.
--
-- What it returns: only reference data the center already publishes (active services, their fees,
-- degrees and their required services, journals). No researcher, request, payment, staff or audit data.
--
-- Deployment note: add "crdc_public" to the API's exposed schemas (supabase/config.toml for local/CI;
-- Project Settings > API > Exposed schemas on a hosted project) before the portal calls it.

create schema if not exists crdc_public;
revoke all on schema crdc_public from public;
grant usage on schema crdc_public to anon, authenticated;

-- New functions in this schema must not become callable by PUBLIC by default.
alter default privileges in schema crdc_public revoke execute on functions from public;

create or replace function crdc_public.get_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('service_id', s.service_id, 'code', s.code, 'name_ar', s.name_ar)
                       order by s.service_id)
      from crdc.services s
      where s.is_active), '[]'::jsonb),
    'fees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'service_id', f.service_id, 'option_code', f.option_code, 'applicant_type', f.applicant_type,
               'currency', f.currency, 'base_fee', f.base_fee, 'included_pages', f.included_pages,
               'extra_page_fee', f.extra_page_fee, 'certificate_fee', f.certificate_fee,
               'requirement_code', f.requirement_code)
             order by f.service_id, f.option_code, f.applicant_type)
      from crdc.fee_schedule f
      join crdc.services s on s.service_id = f.service_id and s.is_active), '[]'::jsonb),
    'requirement_types', coalesce((
      select jsonb_agg(jsonb_build_object('requirement_code', r.requirement_code, 'service_id', r.service_id,
                                          'name_ar', r.name_ar, 'sort_order', r.sort_order)
                       order by r.sort_order)
      from crdc.requirement_types r
      join crdc.services s on s.service_id = r.service_id and s.is_active), '[]'::jsonb),
    'degrees', coalesce((
      select jsonb_agg(jsonb_build_object('degree_id', d.degree_id, 'code', d.code, 'name_ar', d.name_ar,
                                          'track', d.track, 'level', d.level)
                       order by d.degree_id)
      from crdc.degrees d), '[]'::jsonb),
    'degree_requirements', coalesce((
      select jsonb_agg(jsonb_build_object('degree_id', dr.degree_id, 'requirement_code', dr.requirement_code,
                                          'min_count', dr.min_count)
                       order by dr.degree_id, r.sort_order)
      from crdc.degree_requirements dr
      join crdc.requirement_types r on r.requirement_code = dr.requirement_code
      join crdc.services s on s.service_id = r.service_id and s.is_active), '[]'::jsonb),
    'journals', coalesce((
      select jsonb_agg(jsonb_build_object('journal_id', j.journal_id, 'code', j.code, 'name_ar', j.name_ar,
                                          'issues_per_year', j.issues_per_year)
                       order by j.journal_id)
      from crdc.journals j), '[]'::jsonb)
  );
$$;

comment on function crdc_public.get_catalog() is
  'Read-only public catalog for the CRDC website: active services, fees, degrees, degree requirements, journals. No personal or operational data.';

revoke all on function crdc_public.get_catalog() from public;
grant execute on function crdc_public.get_catalog() to anon, authenticated;
