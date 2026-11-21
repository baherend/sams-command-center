# CRDC accounts and row security

## Researcher account flow

Supabase Auth owns passwords, login sessions, and email identity. The application should use this flow:

1. The researcher signs up with email and password; Auth confirmation should be enabled in the Supabase project.
2. After signing in, the researcher creates one `crdc.researchers` profile. The database policy binds `auth_user_id` to the current Auth user and requires the profile email to match the email claim in the access token.
3. The researcher reads their own profile, requests, service items, payments, status history, and publication records. A request is created only through `crdc.create_service_request(...)`, which creates one request for one work (paper or thesis) and calculates its service-item amounts.
4. Profile changes are not available to researchers in the current policy set. Staff provisioning and any correction/relinking process need an explicit operational workflow before real researcher accounts are used.

The initial React/Supabase Auth onboarding interface is in [`CRDC/researcher-portal`](../../researcher-portal/). It supports email/password sign-up and sign-in, then inserts one researcher profile after authentication. The app needs `crdc` in Supabase API Exposed schemas, an allowed redirect URL, and email confirmation enabled. These hosted Auth/API settings are separate from SQL migrations and have not been changed by the database migration.

Email confirmation is an Auth project setting; the database insert policy checks the token email but does not itself verify an `email_confirmed_at` value. The standard hosted Supabase behavior blocks sign-in for unverified email accounts; keep email confirmation enabled, because disabling it treats sign-ups as confirmed. Do not expose the `private` schema through the Data API. [Supabase Auth users documentation](https://supabase.com/docs/guides/auth/users)

`crdc.researchers.auth_user_id` links the profile to `auth.users`; `crdc.staff_users.auth_user_id` links staff. Both foreign keys use `ON DELETE SET NULL`, preserving the CRDC records if an Auth account is deleted. An administrator recovery/relinking procedure is needed for that case.

## Roles and current access

| Role | Current access in the applied policy set |
|---|---|
| researcher (Auth user with a researcher row) | Read own records; create own profile; submit a request through the database function |
| admin | Read all operational rows; manage staff and assignments; insert/update payment and publication rows; use staff RPCs |
| reviewer | Read assigned cases; update publication decisions only on assigned cases; change allowed statuses through the staff RPC |
| statistician | Read assigned cases; change allowed statuses through the staff RPC |
| cashier | Read payment operations; see researcher name/email through a limited contact view; insert/update payments, link payments, and record payment statuses |
| viewer | Read grouped counts by active service and status through an aggregate view; no case rows, identifiers, or writes |

Researchers can read payment and receipt details belonging to their own requests. Researcher identity rows are readable only by their owner and admins; cashiers get only name and email through `crdc.cashier_request_contacts`, which does not expose national IDs or passport numbers. The old broad staff read policies have been replaced by role and assignment scoped policies. Viewers receive only grouped counts through `crdc.viewer_dashboard_summary`.

The DB policies bind a staff account to its Auth user. Staff roles are not self-registered: an administrator must create/assign the `staff_users` row. Reviewer/statistician status changes are restricted to assigned items by `crdc.set_request_item_status(...)`; publication decision writes currently allow any active reviewer or admin, without an assignment check.

## Controlled operations

- `crdc.create_service_request(...)` — validates the researcher's profile and fee options, then creates one thesis or paper request with one or more service items.
- `crdc.link_payment_to_items(...)` — cashier/admin only; limits a payment to one request and currency and checks that its amount equals the selected service-item total. It locks the payment and item rows before validating.
- `crdc.set_request_item_status(...)` — appends a status event for an authorized staff member; the trigger mirrors the newest event into the current item status. Viewers are rejected, the item row is locked, and staff cannot change an item that belongs to their own researcher profile.
- A database trigger restricts publication metadata to the `PUB_PUBLISH` service item, not a separate arbitration fee item.
- `crdc.create_publication_submission(...)` is the admin-only creation path. It checks for `PUB_PUBLISH`, a valid journal and language, duplicate submissions, and self-approval. Authenticated users still have no direct `INSERT` or `UPDATE` grant on this table.
- Publication decisions lock the row and require item status `IN_PROGRESS`, `REVISIONS`, or `COMPLETED`; this operational status rule is an assumption pending confirmation by the center. Accepted dates are preserved when an accepted decision is saved again.
- Researcher national IDs are trimmed and validated as 14 digits with century digit 2 or 3 and a valid YYMMDD date; no checksum is applied. Passport numbers are trimmed and uppercased before nationality-scoped uniqueness is enforced. Titles use 3–300 trimmed characters, status notes allow at most 500 characters, and page counts allow NULL or 1–2000.

Internal helpers use `SECURITY DEFINER` in the unexposed `private` schema, pin `search_path`, validate the caller, and revoke default execute access. Expose `crdc` in the Supabase API settings only if the portal needs its tables/RPCs through the Data API; never expose `private`.

## Adopted prototype defaults

1. Researchers can see their own payment/receipt details; no other researcher's payment data is visible to them.
2. Reviewers and statisticians see only assigned cases. Cashiers handle payment rows and see only researcher name/email through a limited view. Viewers receive aggregate counts, not case-level rows.
3. Researcher profiles are immutable through the researcher session. Profile corrections and Auth account relinking are administrator workflows, to be built before real accounts are used.
4. Email confirmation remains enabled in Supabase Auth. Staff roles are provisioned by admins, never self-selected by users.
5. Publication decisions are restricted to assigned reviewers/statisticians or admins, are RPC-only, and cannot be made by staff on their own researcher request.

These are conservative prototype defaults based on least privilege and data minimization. They can be revised if the center confirms different operational requirements.

## Deployment and verification

The initial three CRDC migrations were applied to the shared `sams-dev` project after the owner authorized it. A fourth migration, `crdc_rls_role_hardening`, applies the prototype defaults above. The migration history filenames in this repository match the versions already recorded by `sams-dev`. Reference data is present; synthetic records were not added to `sams-dev`. The local-only `supabase/seed.sql` generates 400 fictitious researchers and historical requests dated 2018–2026 for isolated workflow testing. Never run the seed against `sams-dev`. Future schema/security changes should be committed as migrations, reviewed through a GitHub PR, and applied to `sams-dev` only after the project owner authorizes that specific deployment.

The GitHub Actions SQL workflow runs the migrations and synthetic seed on an isolated local Supabase stack and executes `supabase test db`. Run [#44571430916](https://github.com/baherend/sams-command-center/actions/runs/44571430916) passed **33 pgTAP assertions** across two files. The role-access tests cover researcher isolation, assigned/unassigned reviewer access, cashier contact/payment access, and viewer aggregate-only access. Account lifecycle, admin/statistician cases, and the wider write-operation matrix still need coverage before production use.
