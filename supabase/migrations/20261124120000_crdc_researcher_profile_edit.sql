-- Allow researchers to edit only their own non-identity profile attributes.
begin;

alter table crdc.researchers
  add column if not exists identity_verified_at timestamptz;

drop policy if exists researcher_update_self on crdc.researchers;
create policy researcher_update_self on crdc.researchers
for update to authenticated
using (auth_user_id = (select auth.uid()))
with check (auth_user_id = (select auth.uid()));

-- Table-level UPDATE is deliberately not granted. Only these columns are editable.
revoke update on crdc.researchers from public, anon, authenticated;
grant update (full_name, degree_id, specialty) on crdc.researchers to authenticated;

create or replace function private.guard_researcher_identity_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role'
     and (select private.current_crdc_staff_role()) is distinct from 'admin'
     and (
       new.researcher_id is distinct from old.researcher_id
       or new.auth_user_id is distinct from old.auth_user_id
       or new.email is distinct from old.email
       or new.applicant_type is distinct from old.applicant_type
       or new.national_id is distinct from old.national_id
       or new.passport_no is distinct from old.passport_no
       or new.nationality is distinct from old.nationality
       or new.identity_verified_at is distinct from old.identity_verified_at
     ) then
    raise exception 'Researcher identity fields cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_researcher_identity_update() from public, anon, authenticated;
drop trigger if exists researchers_guard_identity_update on crdc.researchers;
create trigger researchers_guard_identity_update
before update on crdc.researchers
for each row execute function private.guard_researcher_identity_update();

commit;
