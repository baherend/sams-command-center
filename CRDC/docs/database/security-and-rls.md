# CRDC accounts and row security

## Identity

Supabase Auth owns login credentials. crdc.researchers.auth_user_id links the signed-in identity to a researcher record; crdc.staff_users.auth_user_id links staff. The draft adds foreign keys to auth.users and preserves CRDC records if an Auth account is deleted.

Researchers may read only their own profile, requests, service items, payments, status history, and publication records. Center staff read operational records according to the current role helper. Staff accounts are not self-registered; an active account and role must be assigned by an administrator.

## Roles

| Role | Intended access |
|---|---|
| researcher (Auth user with a researcher row) | Read own records; submit requests through the database function |
| admin | Manage staff and assignments; administer cases |
| reviewer | Update assigned service status and publication decisions |
| statistician | Update status on assigned items |
| cashier | Record payments, link payments to service items, and set payment statuses |
| viewer | Read operational data; no writes |

The current draft grants every active staff role read access to all operational rows. Confirm this matches the center's privacy expectations before production. In particular, decide whether the viewer role should see personal identifiers and receipt details.

## Controlled operations

04_crdc_rls_policies.sql provides these authenticated RPCs:

- crdc.create_service_request(...) — creates one request for one thesis or paper, validates fee options for the applicant, and calculates amounts in the database.
- crdc.link_payment_to_items(...) — limits linking to one request and currency and checks that the payment amount equals the selected service-item total.
- crdc.set_request_item_status(...) — appends a status event for an authorized staff member; the trigger mirrors the event to the current item status.

Publication metadata is restricted to PUB_PUBLISH. A database trigger also rejects attaching it to the separate arbitration fee item.

The internal helper functions use SECURITY DEFINER in the unexposed private schema. They validate auth.uid(), pin search_path, and revoke default execute access. Keep private out of Supabase's exposed schemas. Expose crdc only if the portal will call its Data API/RPCs.

## Required checks before merging or deployment

1. Create a Supabase migration using the CLI, rather than applying the draft as an ad-hoc SQL change.
2. Add pgTAP tests under supabase/tests/ for:
   - anonymous access is denied;
   - researcher A sees their own rows and not researcher B's;
   - a researcher cannot create a profile for another Auth ID;
   - request submission calculates fees and creates the initial status history;
   - invalid fee/applicant combinations are rejected;
   - direct status/history writes by a researcher are denied;
   - only assigned reviewers/statisticians can change work status;
   - payment amount, request, and currency must match selected service items;
   - payment status cannot be advanced without a linked payment;
   - publication metadata cannot attach to an arbitration-only item;
   - staff roles cannot perform each other's restricted writes.
3. Run the complete SQL chain and supabase test db against a local Supabase stack.
4. Run Supabase security advisors and fix any findings.
5. Review public-repository contents for real IDs, email addresses, credentials, and service-role keys.

## Current verification state

The schema, reference data, RLS migration, and synthetic seed were executed in an ephemeral PGlite PostgreSQL runtime with minimal Supabase Auth role/function stubs. The smoke checks passed for the 15-table count, RLS enabled on all 15 tables, policy coverage, payment request/currency consistency, payment totals, publication-item restrictions, and researcher request isolation for two synthetic accounts.

This does not replace a run against the Supabase local stack: PGlite does not provide Supabase Auth or the pgTAP extension used by `supabase test db`. Docker and `psql` are unavailable in the current Windows environment, so the Supabase CLI migration/reset and pgTAP workflow has not yet produced a result. Do not mark the full Supabase SQL test as passed until the GitHub Actions workflow or a local Supabase stack completes successfully.
