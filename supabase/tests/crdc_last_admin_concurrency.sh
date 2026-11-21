#!/usr/bin/env bash
set -euo pipefail

# supabase start uses this local database URL by default. Override it when the
# CLI is configured with a non-default local database port.
DB_URL="${CRDC_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
ID_A='30000000-0000-0000-0000-000000000b01'
ID_B='30000000-0000-0000-0000-000000000b02'
AUTH_A='00000000-0000-0000-0000-000000000c01'
AUTH_B='00000000-0000-0000-0000-000000000c02'
ID_C='30000000-0000-0000-0000-000000000b03'
AUTH_C='00000000-0000-0000-0000-000000000c03'
LOG_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/crdc-last-admin-race"
mkdir -p "$LOG_DIR"
rm -f "$LOG_DIR/session-a.log" "$LOG_DIR/session-b.log"

psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
insert into auth.users (
  id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('$AUTH_A'::uuid,'authenticated'::text,'authenticated'::text,'r3b-race-a@example.test'::text,'',now(),'{}','{}',now(),now()),
  ('$AUTH_B'::uuid,'authenticated'::text,'authenticated'::text,'r3b-race-b@example.test'::text,'',now(),'{}','{}',now(),now()),
  ('$AUTH_C'::uuid,'authenticated'::text,'authenticated'::text,'r3b-race-c@example.test'::text,'',now(),'{}','{}',now(),now())
on conflict (id) do update set email=excluded.email;
insert into crdc.staff_users(staff_id, auth_user_id, full_name, role, is_active) values
  ('$ID_A'::uuid, '$AUTH_A'::uuid, 'R3B concurrency admin A'::text, 'admin'::text, true),
  ('$ID_B'::uuid, '$AUTH_B'::uuid, 'R3B concurrency admin B'::text, 'admin'::text, true),
  ('$ID_C'::uuid, '$AUTH_C'::uuid, 'R3B concurrency cleanup admin'::text, 'admin'::text, true)
on conflict (staff_id) do update set auth_user_id=excluded.auth_user_id,
  full_name=excluded.full_name,role=excluded.role,is_active=true;
-- C keeps the global invariant intact but is disabled during the race so it
-- cannot mask two concurrent demotions of A and B.
update crdc.staff_users set is_active=false where staff_id='$ID_C'::uuid;
SQL

run_demotion() {
  local staff_id="$1"
  local log_file="$2"
  psql "$DB_URL" -v ON_ERROR_STOP=1 >"$log_file" 2>&1 <<SQL
begin;
select pg_sleep(0.25);
update crdc.staff_users set is_active=false where staff_id='$staff_id'::uuid;
commit;
SQL
}

set +e
run_demotion "$ID_A" "$LOG_DIR/session-a.log" & pid_a=$!
run_demotion "$ID_B" "$LOG_DIR/session-b.log" & pid_b=$!
wait "$pid_a"; result_a=$?
wait "$pid_b"; result_b=$?
set -e

active_count="$(psql "$DB_URL" -At -v ON_ERROR_STOP=1 -c \
  "select count(*) from crdc.staff_users where staff_id in ('$ID_A'::uuid,'$ID_B'::uuid) and is_active and role='admin'::text")"
if [[ "$active_count" != "1" ]]; then
  cat "$LOG_DIR/session-a.log" "$LOG_DIR/session-b.log"
  echo "Expected exactly one fixture admin to remain active; found $active_count" >&2
  exit 1
fi
if ! { [[ "$result_a" -eq 0 && "$result_b" -ne 0 ]] || [[ "$result_a" -ne 0 && "$result_b" -eq 0 ]]; }; then
  cat "$LOG_DIR/session-a.log" "$LOG_DIR/session-b.log"
  echo "Expected one concurrent demotion to succeed and the other to be rejected (exit codes: $result_a, $result_b)" >&2
  exit 1
fi
if [[ "$result_a" -ne 0 ]]; then
  rejection_log="$LOG_DIR/session-a.log"
else
  rejection_log="$LOG_DIR/session-b.log"
fi
if ! grep -Fq 'Cannot remove the last active CRDC administrator' "$rejection_log"; then
  cat "$LOG_DIR/session-a.log" "$LOG_DIR/session-b.log"
  echo "The rejected session did not fail with the last-admin guard" >&2
  exit 1
fi

echo "Concurrent last-admin race passed: one demotion committed and one was rejected."
cat "$LOG_DIR/session-a.log" "$LOG_DIR/session-b.log"

# Reactivate C after measuring the A/B race, then remove A and B. The isolated
# CI database retains C as its active administrator to preserve the invariant.
psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
update crdc.staff_users set is_active=true where staff_id='$ID_C'::uuid;
update crdc.staff_users set is_active=false where staff_id in ('$ID_A'::uuid,'$ID_B'::uuid);
delete from crdc.staff_users where staff_id in ('$ID_A'::uuid,'$ID_B'::uuid);
delete from auth.users where id in ('$AUTH_A'::uuid,'$AUTH_B'::uuid);
SQL
