# CRDC Platform — Claude Code Handoff

**Read this first to resume work with minimal repository scanning.** The repository is `baherend/sams-command-center`; CRDC lives under `CRDC/`. PRs #4–#8 are merged to `main`. The current product is an early researcher-onboarding prototype, not a production portal.

## 1. Project rules and environment isolation

- Keep all synthetic/test data out of the shared Supabase project `sams-dev`. Its CRDC migrations and reference rows are deployed; its synthetic seed was **not** applied.
- Use the local Supabase stack (`supabase start`, then `supabase db reset`) for development and CI. The reset loads migrations and `supabase/seed.sql`; it resets the local database.
- A dedicated `sams-test` project is also acceptable only after confirming it is separate and configured for testing. Do not assume such a project is already connected.
- Never apply `supabase/seed.sql` to `sams-dev`. Never use hosted credentials or the service-role key in browser code. Do not change hosted Auth/API settings without the project owner's explicit authorization.
- Put schema changes in timestamped files under `supabase/migrations/`; document and review them through a PR before deployment.

## 2. Database schema: `crdc`

The four migrations define 15 tables:

- **Catalog/reference:** `services`, `requirement_types`, `fee_schedule`, `degrees`, `degree_requirements`, `journals`, `journal_issues`, `request_statuses`.
- **People:** `researchers`, `staff_users`.
- **Operations/publication:** `service_requests`, `request_items`, `payments`, `request_status_history`, `publication_submissions`.

Main relationships:

- `researchers → service_requests → request_items → request_status_history`.
- `service_requests → payments`; `request_items.payment_id` links items to a payment. The current model allows a payment to cover multiple items **within one request and one currency**; one item cannot be split among payments. Treat receipt grouping as a prototype rule pending confirmation by the center.
- `request_items → publication_submissions → journals / journal_issues`.
- `degrees → degree_requirements → requirement_types → services`; `fee_schedule` connects applicant type and service option to currency and pricing.

Important constraints and status vocabularies:

- There are no PostgreSQL enum types; text columns use CHECK constraints and reference tables.
- Applicant types: `egyptian`, `foreign`. Egyptian researcher profiles require a national ID; foreign profiles require passport number and nationality. Auth user ID and email are unique.
- Work types: `thesis`, `paper`. Each thesis or paper is its own request. Multiple service items may be attached to one request.
- Currency must match applicant type: Egyptians use `EGP`, foreign applicants use `USD`. Composite foreign keys keep fee, request, item, payment, and currency combinations consistent. Item amounts are fee snapshots calculated by `crdc.calc_fee(...)`.
- Request/item status codes in `request_statuses`: `SUBMITTED`, `PAYMENT_ORDER`, `PAID`, `IN_PROGRESS`, `REVISIONS`, `COMPLETED`, `DELIVERED`.
- `payments` has no separate status enum. Payment progress is represented by `PAYMENT_ORDER` and `PAID` status-history events; payment channel is `treasury` or `bank`.
- Publication decisions: `pending`, `revisions`, `accepted`, `rejected`; paper language: `ar`, `en`. An accepted submission requires `accepted_at`.
- The schema provides `crdc.create_service_request(...)` and `crdc.link_payment_to_items(...)` workflows. Use these RPCs for requests/payment linking instead of direct client inserts.

For exact definitions, inspect `supabase/migrations/20261119072455_crdc_schema.sql` and the reference/RLS migrations listed in section 6.

## 3. Security and RLS

RLS is enabled on all 15 CRDC tables. Authorization is based on the signed-in Auth user linked through `researchers.auth_user_id` or `staff_users.auth_user_id`; do not trust client-supplied role fields.

Database staff roles are `admin`, `reviewer`, `statistician`, `cashier`, and `viewer`:

- **Researcher:** read own profile, requests/items, payments, status history, and publication records; create own profile once.
- **Reviewer/statistician:** assigned operational cases only.
- **Cashier:** payment operations and a limited contact view with researcher name/email; no national IDs or passport numbers.
- **Viewer:** aggregate dashboard counts only.
- **Admin:** broad operational access, staff management, and assignments.

The portal uses the Supabase publishable/anon key and the authenticated user's session; RLS remains the source of truth. The frontend must never use the service-role key or implement authorization only by hiding UI. Staff pages/role switching are not implemented yet.

## 4. Synthetic seed: `supabase/seed.sql`

The local-only generator creates **400 fictitious researchers**, with researcher and request dates spanning **2018–2026**. It uses `@example.test` emails and TEST-prefixed identifiers. It covers Egyptian/foreign applicants, degree types, separate thesis/paper requests, multi-service request items, unpaid/paid and varied status timelines, and publication outcomes including pending, revisions, accepted, and rejected. Publication issue links are only assigned when a same-year reference issue exists.

Use it only after local migrations with `supabase db reset`, or in an isolated dedicated test environment. No production or real-person records belong in this seed.

## 5. Frontend: `CRDC/researcher-portal`

Stack: React 19, TypeScript, Vite, and `@supabase/supabase-js`.

Key source files:

- `src/main.tsx` — React bootstrap.
- `src/App.tsx` — sign-up/sign-in, confirmation-pending state, Egyptian/foreign researcher profile form, profile summary, and sign-out.
- `src/supabase.ts` — client initialized from `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- `src/styles.css` — responsive RTL styling.
- `src/vite-env.d.ts` — Vite environment types.

Currently available screens are connection setup, account creation/login, profile completion, and saved-profile confirmation. There is no service catalog screen, request creation/list/detail screen, payment UI, password recovery, profile editing, or staff dashboard yet. Local configuration lives in `supabase/config.toml`; `.env.local` is ignored and must contain only local URL + publishable/anon key for browser runs.

## 6. CI/CD and automated tests

Workflows under `.github/workflows/`:

- `crdc-sql-tests.yml` — starts isolated Supabase, runs `supabase db reset` (migrations + seed), then `supabase test db`. SQL tests cover RLS/role access; the established suite has 33 pgTAP assertions across two files.
- `crdc-portal-build.yml` — installs portal dependencies and runs `npm run build`.
- `crdc-researcher-e2e.yml` — starts isolated Supabase with the synthetic seed, builds the portal, launches Chromium through Playwright, and tests Egyptian/foreign registration, profile saving, and own-profile isolation. PR #8 added this workflow and its latest run passed.

Preserve these CI assumptions:

- Keep each workflow's path filters covering the files it validates.
- The current portal workflows use `npm install`; a prior `npm ci` attempt failed in GitHub because the runner could not find the lockfile at that working-directory path. Don't switch back without confirming the lockfile is checked out at the expected path.
- Playwright is installed at pinned version `1.65.1` for the CI E2E job. The local Supabase service-role key is generated inside the disposable runner only; never replace it with a hosted key.
- Allow the local SMTP/Auth configuration and test to confirm synthetic sign-ups only inside the isolated local stack.

## 7. Next milestone

Build the authenticated **service catalog and request journey**:

1. Read active services, fee options, degree requirements, and page-based pricing from `services`, `fee_schedule`, and `degree_requirements`.
2. Let a researcher select a work type (thesis or paper), title/page count, and service options. Keep a paper request separate from its thesis request.
3. Submit through `crdc.create_service_request(...)`; let database logic calculate prices and create request items. Do not duplicate fee/authorization rules in the browser.
4. Add a “My requests” list and request detail with item-level statuses/history and publication details; query only the signed-in user's records and let RLS enforce access.
5. Test locally with the seed and add Playwright coverage for request creation, validation, and isolation before any hosted deployment.

Before implementing payment UX, confirm the receipt-grouping policy with the center; keep cashier-only payment writes behind the existing RPC/RLS rules.
