-- Reviewer/statistician operational publication decisions with server-side validation.
begin;

-- CI creates disposable assigned-case fixtures with the local service role only.
grant update (assigned_staff_id, status_id) on crdc.request_items to service_role;

create or replace function private.update_publication_submission_impl(
  p_item_id bigint, p_decision text, p_journal_id smallint, p_issue_id integer default null
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_staff_id uuid;
begin
  select staff_id, role into v_staff_id, v_role
  from crdc.staff_users
  where auth_user_id = (select auth.uid()) and is_active;
  if not found or v_role not in ('admin','reviewer','statistician') then
    raise exception 'Operational staff account required' using errcode='42501';
  end if;
  if v_role in ('reviewer','statistician') and not exists (
    select 1 from crdc.request_items where item_id=p_item_id and assigned_staff_id=v_staff_id
  ) then raise exception 'This item is not assigned to this staff member' using errcode='42501'; end if;
  if p_decision not in ('pending','revisions','accepted','rejected') then
    raise exception 'Unknown publication decision' using errcode='23514';
  end if;
  if not exists (
    select 1 from crdc.publication_submissions where item_id=p_item_id
  ) then raise exception 'Publication submission not found' using errcode='P0002'; end if;
  if not exists (select 1 from crdc.journals where journal_id=p_journal_id) then
    raise exception 'Journal not found' using errcode='23503'; end if;
  if p_issue_id is not null and not exists (
    select 1 from crdc.journal_issues where issue_id=p_issue_id and journal_id=p_journal_id
  ) then raise exception 'Issue does not belong to this journal' using errcode='23503'; end if;
  update crdc.publication_submissions
  set decision=p_decision, journal_id=p_journal_id, issue_id=p_issue_id,
      accepted_at=case when p_decision='accepted' then current_date else null end
  where item_id=p_item_id;
end;
$$;

create or replace function crdc.update_publication_submission(
  p_item_id bigint, p_decision text, p_journal_id smallint, p_issue_id integer default null
)
returns void language sql security invoker set search_path = ''
as $$ select private.update_publication_submission_impl($1,$2,$3,$4) $$;

revoke all on function private.update_publication_submission_impl(bigint,text,smallint,integer) from public, anon;
revoke all on function crdc.update_publication_submission(bigint,text,smallint,integer) from public, anon;
grant execute on function private.update_publication_submission_impl(bigint,text,smallint,integer) to authenticated;
grant execute on function crdc.update_publication_submission(bigint,text,smallint,integer) to authenticated;

commit;

