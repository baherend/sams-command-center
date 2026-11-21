-- Round 3 PR A: normalize identity inputs, validate request bounds, and expose
-- the controlled publication submission creation path.
begin;

create or replace function private.trg_researcher_normalize_identity()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.national_id is not null then new.national_id := btrim(new.national_id); end if;
  if new.passport_no is not null then new.passport_no := upper(btrim(new.passport_no)); end if;
  return new;
end;
$$;
revoke all on function private.trg_researcher_normalize_identity() from public, anon, authenticated;
drop trigger if exists researchers_normalize_identity on crdc.researchers;
create trigger researchers_normalize_identity
before insert or update of national_id, passport_no on crdc.researchers
for each row execute function private.trg_researcher_normalize_identity();

alter table crdc.researchers drop constraint if exists researchers_national_id_not_blank;
alter table crdc.researchers add constraint researchers_national_id_format
check (national_id is null or case when national_id ~ '^[0-9]{14}$' then
  substring(national_id from 1 for 1) in ('2','3')
  and substring(national_id from 4 for 2)::integer between 1 and 12
  and substring(national_id from 6 for 2)::integer between 1 and
    case substring(national_id from 4 for 2)::integer
      when 2 then case when ((case substring(national_id from 1 for 1) when '2' then 1900 else 2000 end
                              + substring(national_id from 2 for 2)::integer) % 4 = 0
                              and ((case substring(national_id from 1 for 1) when '2' then 1900 else 2000 end
                                    + substring(national_id from 2 for 2)::integer) % 100 <> 0
                                   or (case substring(national_id from 1 for 1) when '2' then 1900 else 2000 end
                                       + substring(national_id from 2 for 2)::integer) % 400 = 0)) then 29 else 28 end
      when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31
    end
  else false end);
alter table crdc.service_requests drop constraint if exists service_requests_work_title_not_blank;
alter table crdc.service_requests add constraint service_requests_work_title_length
check (char_length(btrim(work_title)) between 3 and 300);
alter table crdc.service_requests add constraint service_requests_page_count_range
check (page_count is null or page_count between 1 and 2000);
alter table crdc.request_status_history add constraint request_status_history_note_length
check (note is null or char_length(note) <= 500);

create or replace function private.create_service_request_impl(
  p_work_type text, p_work_title text, p_page_count integer, p_fee_ids smallint[]
)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v_researcher_id uuid; v_applicant_type text; v_request_id bigint;
  v_fee_id smallint; v_service_id smallint; v_included_pages integer;
  v_active boolean; v_status_id smallint; v_amount numeric;
begin
  if (select auth.uid()) is null then raise exception 'Sign-in required' using errcode='28000'; end if;
  if p_page_count is not null and p_page_count not between 1 and 2000 then
    raise exception 'Page count must be between 1 and 2000' using errcode='23514';
  end if;
  if p_work_title is null or char_length(btrim(p_work_title)) not between 3 and 300 then
    raise exception 'Work title must be between 3 and 300 characters' using errcode='23514';
  end if;
  if p_fee_ids is null or cardinality(p_fee_ids)=0 then
    raise exception 'Select at least one service' using errcode='23514';
  end if;
  if exists (select 1 from unnest(p_fee_ids) as x(fee_id) where fee_id is null)
     or cardinality(p_fee_ids) <> (select count(distinct fee_id) from unnest(p_fee_ids) as x(fee_id)) then
    raise exception 'Fee IDs must be present and unique' using errcode='23514';
  end if;
  select r.researcher_id,r.applicant_type into v_researcher_id,v_applicant_type
  from crdc.researchers r where r.auth_user_id=(select auth.uid());
  if not found then raise exception 'Create your researcher profile before submitting a request' using errcode='23503'; end if;
  select s.status_id into v_status_id from crdc.request_statuses s where s.code='SUBMITTED';
  if v_status_id is null then raise exception 'SUBMITTED status is missing' using errcode='23503'; end if;
  foreach v_fee_id in array p_fee_ids loop
    select f.service_id,f.included_pages,s.is_active into v_service_id,v_included_pages,v_active
    from crdc.fee_schedule f join crdc.services s using(service_id)
    where f.fee_id=v_fee_id and f.applicant_type=v_applicant_type;
    if not found or not coalesce(v_active,false) then raise exception 'Fee option is unavailable for this researcher' using errcode='23514'; end if;
    if v_service_id=1 and p_work_type <> 'paper' then raise exception 'Publication services require a separate paper request' using errcode='23514'; end if;
    if v_included_pages is not null and p_page_count is null then raise exception 'Page count is required for this service' using errcode='23514'; end if;
  end loop;
  insert into crdc.service_requests(researcher_id,work_type,work_title,page_count)
  values(v_researcher_id,p_work_type,p_work_title,p_page_count) returning request_id into v_request_id;
  foreach v_fee_id in array p_fee_ids loop
    v_amount := crdc.calc_fee(v_fee_id,p_page_count);
    if v_amount is null then raise exception 'Fee calculation failed' using errcode='23514'; end if;
    insert into crdc.request_items(request_id,fee_id,status_id,amount_due)
    values(v_request_id,v_fee_id,v_status_id,v_amount);
  end loop;
  return v_request_id;
end;
$$;
revoke all on function private.create_service_request_impl(text,text,integer,smallint[]) from public, anon, authenticated;
grant execute on function private.create_service_request_impl(text,text,integer,smallint[]) to authenticated;

create or replace function private.create_publication_submission_impl(
  p_item_id bigint, p_journal_id smallint, p_paper_language text
)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare v_role text; v_request_id bigint; v_researcher_auth uuid; v_submission_id bigint;
begin
  select su.role into v_role from crdc.staff_users su
  where su.auth_user_id=(select auth.uid()) and su.is_active;
  if not found or v_role is distinct from 'admin' then
    raise exception 'Admin role required' using errcode='42501';
  end if;
  if p_paper_language is null or p_paper_language not in ('ar','en') then
    raise exception 'Paper language must be ar or en' using errcode='23514';
  end if;
  if not exists(select 1 from crdc.journals j where j.journal_id=p_journal_id) then
    raise exception 'Journal not found' using errcode='23503';
  end if;
  select i.request_id,r.auth_user_id into v_request_id,v_researcher_auth
  from crdc.request_items i join crdc.service_requests sr using(request_id)
  join crdc.researchers r using(researcher_id)
  where i.item_id=p_item_id for update of i;
  if not found then raise exception 'Service item not found' using errcode='P0002'; end if;
  if v_researcher_auth=(select auth.uid()) then
    raise exception 'Staff cannot create a publication submission for their own researcher request' using errcode='42501';
  end if;
  if not exists(select 1 from crdc.request_items i join crdc.fee_schedule f using(fee_id)
    where i.item_id=p_item_id and i.service_id=1 and f.option_code='PUB_PUBLISH') then
    raise exception 'Publication details require a PUB_PUBLISH service item' using errcode='23514';
  end if;
  if exists(select 1 from crdc.publication_submissions p where p.item_id=p_item_id) then
    raise exception 'Publication submission already exists for this item' using errcode='23505';
  end if;
  insert into crdc.publication_submissions(item_id,journal_id,paper_language)
  values(p_item_id,p_journal_id,p_paper_language) returning submission_id into v_submission_id;
  return v_submission_id;
end;
$$;
create or replace function crdc.create_publication_submission(
  p_item_id bigint, p_journal_id smallint, p_paper_language text
)
returns bigint language sql security invoker set search_path = ''
as $$ select private.create_publication_submission_impl($1,$2,$3) $$;
revoke all on function private.create_publication_submission_impl(bigint,smallint,text) from public, anon, authenticated;
grant execute on function private.create_publication_submission_impl(bigint,smallint,text) to authenticated;
revoke all on function crdc.create_publication_submission(bigint,smallint,text) from public, anon;
grant execute on function crdc.create_publication_submission(bigint,smallint,text) to authenticated;

create or replace function private.update_publication_submission_impl(
  p_item_id bigint, p_decision text, p_journal_id smallint, p_issue_id integer default null
)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_role text; v_staff_id uuid; v_request_id bigint; v_current_decision text;
  v_accepted_at date; v_status text;
begin
  select su.staff_id,su.role into v_staff_id,v_role from crdc.staff_users su
  where su.auth_user_id=(select auth.uid()) and su.is_active;
  if not found or v_role not in ('admin','reviewer','statistician') then raise exception 'Operational staff account required' using errcode='42501'; end if;
  if p_decision is null then raise exception 'Publication decision is required' using errcode='23514'; end if;
  if p_decision not in ('pending','revisions','accepted','rejected') then raise exception 'Unknown publication decision' using errcode='23514'; end if;
  select p.decision,p.accepted_at,i.request_id,s.code into v_current_decision,v_accepted_at,v_request_id,v_status
  from crdc.publication_submissions p join crdc.request_items i using(item_id)
  join crdc.request_statuses s using(status_id)
  where p.item_id=p_item_id for update of p;
  if not found then raise exception 'Publication submission not found' using errcode='P0002'; end if;
  if v_role in ('reviewer','statistician') and not exists(select 1 from crdc.request_items i where i.item_id=p_item_id and i.assigned_staff_id=v_staff_id) then raise exception 'This item is not assigned to this staff member' using errcode='42501'; end if;
  if exists(select 1 from crdc.service_requests sr join crdc.researchers r using(researcher_id) where sr.request_id=v_request_id and r.auth_user_id=(select auth.uid())) then raise exception 'Staff cannot decide on their own researcher request' using errcode='42501'; end if;
  if v_status not in ('IN_PROGRESS','REVISIONS','COMPLETED') then
    raise exception 'Publication decisions are allowed only while the item is IN_PROGRESS, REVISIONS or COMPLETED' using errcode='23514';
  end if;
  if not exists(select 1 from crdc.journals j where j.journal_id=p_journal_id) then raise exception 'Journal not found' using errcode='23503'; end if;
  if p_issue_id is not null and not exists(select 1 from crdc.journal_issues ji where ji.issue_id=p_issue_id and ji.journal_id=p_journal_id) then raise exception 'Issue does not belong to this journal' using errcode='23503'; end if;
  update crdc.publication_submissions set decision=p_decision,journal_id=p_journal_id,issue_id=p_issue_id,
    accepted_at=case when p_decision='accepted' then coalesce(v_accepted_at,current_date) else null end
  where item_id=p_item_id;
end;
$$;
revoke all on function private.update_publication_submission_impl(bigint,text,smallint,integer) from public, anon, authenticated;
grant execute on function private.update_publication_submission_impl(bigint,text,smallint,integer) to authenticated;

commit;
