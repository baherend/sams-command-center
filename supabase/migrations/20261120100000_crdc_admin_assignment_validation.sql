-- Limit assignments to active reviewers and statisticians at the database boundary.
begin;

drop policy if exists request_items_admin_assignment on crdc.request_items;
create policy request_items_admin_assignment on crdc.request_items
for update to authenticated
using ((select private.current_crdc_staff_role()) = 'admin')
with check (
  (select private.current_crdc_staff_role()) = 'admin'
  and (
    assigned_staff_id is null
    or exists (
      select 1
      from crdc.staff_users su
      where su.staff_id = request_items.assigned_staff_id
        and su.is_active
        and su.role in ('reviewer','statistician')
    )
  )
);

grant update (assigned_staff_id) on crdc.request_items to authenticated;

commit;

