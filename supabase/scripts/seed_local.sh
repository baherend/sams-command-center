#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

# Read the active local-stack URL from the Supabase CLI, then fail closed unless
# it is the configured loopback database. This script never accepts a linked
# or hosted project URL.
status_env="$(supabase status -o env)"
eval "$status_env"

if [[ ! "${DB_URL:-}" =~ ^postgres(ql)?://[^@/]+@(127\.0\.0\.1|localhost|\[::1\]):54322/postgres$ ]]; then
  echo "Refusing to run the synthetic seed: Supabase DB_URL is not the local 127.0.0.1:54322/postgres database." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to load the guarded synthetic seed into the local Supabase database." >&2
  exit 1
fi

PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c crdc.allow_seed=on" \
  psql "$DB_URL" --set ON_ERROR_STOP=1 --file "$repo_root/supabase/seed.sql"
