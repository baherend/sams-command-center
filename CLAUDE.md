# CRDC Platform — Claude Code Handoff

**Read this first before changing the CRDC platform.** The repository is `baherend/sams-command-center`; CRDC lives under `CRDC/`. PR #18 (Round 3 PR A follow-up) is merged to `main`; all three CI workflows passed on its merge commit as of 2026-11-21. Round 3 PR B is in progress on `feat/crdc-round3-pr-b`. The platform is an authenticated researcher and staff prototype; it is not production-ready.

## 1. Project rules and environment isolation

- Keep synthetic data out of the shared Supabase project `sams-dev`. Its CRDC migrations and reference rows may be deployed, but `supabase/seed.sql` must never be applied there.
- Develop and test against the local Supabase stack only: `supabase start`, then `supabase db reset`. The reset applies migrations and the local synthetic seed.
- A separate `sams-test` project is acceptable only after confirming it is isolated. Do not assume one is configured.
- Browser code uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never put a service-role key in frontend code. The service-role key appears only in disposable local CI fixtures.
- Put schema changes in timestamped `supabase/migrations/` files and validate through a PR before any hosted deployment.

## 2. Database schema and workflows

The `crdc` schema has 15 tables:

- **Catalog/reference:** `services`, `requirement_types`, `fee_schedule`, `degrees`, `degree_requirements`, `journals`, `journal_issues`, `request_statuses`.
- **People:** `researchers`, `staff_users`.
- **Operations/publication:** `service_requests`, `request_items`, `payments`, `request_status_history`, `publication_submissions`.

Core relationships are `researchers → service_requests → request_items → request_status_history`; publication items may have one `publication_submissions` row linked to a journal and optional issue.

Important rules:

- Applicant types are `egyptian` and `foreign`; currencies are respectively `EGP` and `USD`.
- Work types are `thesis` and `paper`. A thesis and a paper are separate requests; each request may contain multiple service items.
- Item status codes are `SUBMITTED`, `PAYMENT_ORDER`, `PAID`, `IN_PROGRESS`, `REVISIONS`, `COMPLETED`, and `DELIVERED`.
- Publication decisions are `pending`, `revisions`, `accepted`, and `rejected`; an accepted decision requires `accepted_at`.
- National IDs are trimmed and must contain 14 digits, start with century digit 2 or 3, and encode a real YYMMDD date in digits 2–7. No checksum is defined. Passport values are trimmed and uppercased before their nationality-scoped unique check.
- Work titles contain 3–300 trimmed characters, status-history notes are at most 500 characters, and page counts are either NULL when the selected fees permit it or 1–2000.
- Only admins create publication submission records through `crdc.create_publication_submission(...)`; direct authenticated table inserts remain denied. Publication decisions are accepted only in `IN_PROGRESS`, `REVISIONS`, or `COMPLETED`. The project owner approved these states as the project's operating rule on 2026-11-21; do not describe this rule as awaiting center confirmation. Revisit it only if the center or project owner changes the rule for production.
- `request_items.assigned_staff_id` stores assignment per item. Admin assignment is limited to active reviewers and statisticians.
- Use `crdc.create_service_request(...)` for request creation and `crdc.set_request_item_status(...)` for status changes. The latter allows only admin/reviewer/statistician/cashier (never viewer), validates transitions, locks the item row (`FOR UPDATE`) so concurrent changes serialise, refuses staff acting on a request whose researcher profile is their own account (admin included), and appends `request_status_history`.
- `crdc.update_publication_submission(...)` validates assigned operational access, journal/issue consistency, refuses staff deciding on their own researcher request, and sets `accepted_at` server-side the first time a decision becomes accepted (re-saving an accepted decision keeps the original date). `publication_submissions` has no direct INSERT/UPDATE grant for `authenticated`; this RPC is the only write path.
- Payment linkage remains in `crdc.link_payment_to_items(...)`, which locks the payment and item rows and only links still-unlinked items. Once a payment is linked, its amount/currency/request are immutable and a recorded `payment_order_no`, `receipt_no` or `paid_at` cannot change (they may be filled in once while NULL). Receipt grouping is a prototype rule pending center confirmation.

## 3. Security and RLS

RLS is enabled on all CRDC tables. Authorization is based on the signed-in Auth user linked through `researchers.auth_user_id` or `staff_users.auth_user_id`; client-side role checks only control presentation.

Roles:

- **Researcher:** owns one profile and can see only their profile, requests, items, payments, history, and publication records.
- **Reviewer/statistician:** see only cases with items assigned to them; can update allowed operational statuses through the status RPC. Payment statuses are rejected for these roles.
- **Cashier:** has payment operations and limited request contact data, without national ID or passport fields.
- **Viewer:** can access aggregate dashboards only, never individual cases or researcher identities.
- **Admin:** has broad operational access, manages staff assignments, sees the administrative request queue, and can access operational workflows.

The safe aggregate views are `crdc.viewer_dashboard_summary` and `crdc.staff_dashboard_overview`. They contain grouped counts only, with no personal identifiers or case details.

## 4. Synthetic seed data

`supabase/seed.sql` is local-only. It generates 400 fictitious researchers and historical requests from 2018–2026, using `@example.test` emails and TEST-prefixed identifiers.

It covers Egyptian and foreign profiles, degrees, separate thesis/paper requests, multi-service items, payment and status scenarios, and publication outcomes. Use it only after a local `supabase db reset` or in an explicitly isolated test environment.

## 5. Frontend: `CRDC/researcher-portal`

Stack: React 19, TypeScript, Vite, and `@supabase/supabase-js`. Styling is responsive RTL Arabic in `src/styles.css`.

Key files:

- `src/App.tsx` — authentication, staff-versus-researcher detection, researcher onboarding, and sign-out.
- `src/ResearcherPortal.tsx` — researcher service catalog, new-request flow, request list/detail, fees, history, and publication display.
- `src/StaffConsole.tsx` — staff shell and role-specific workspace.
- `src/supabase.ts` — publishable/anon client setup only.

Merged and completed product work:

1. **Researcher journey (PR #10):** active service catalog, degree and fee options, request creation only through `create_service_request`, My Requests, request details, item fees/statuses, timeline, publication information, and researcher data isolation.
2. **Staff role detection and viewer overview (PR #11):** signed-in active staff bypass researcher onboarding; staff shell shows name, role, and sign-out. Admin/viewer access a read-only aggregate overview without PII.
3. **Admin request queue and assignments (PR #12):** admins can filter all requests, view allowed researcher context and item summaries, and assign/reassign every item in a request to an active reviewer or statistician.
4. **Reviewer/statistician workspace (PR #13):** assigned-cases tab uses RLS-limited queries. Operational staff can update allowed statuses with a history note, and handle publication decisions, journals, and issues through secure RPCs.
5. **Round 3 PR A integrity controls (PR #17):** added normalized/validated researcher identity inputs, bounded request data, admin-only publication submission creation, and a publication-decision status allow-list.
6. **Round 3 follow-up (PR #18):** fixed the national-ID browser pattern and corrected pgTAP role switching and RPC argument types. On merge commit `b66961d`, `crdc-sql-tests`, `crdc-portal-build`, and `crdc-researcher-e2e` all passed in GitHub Actions (2026-11-21).

Round 3 PR B is in progress on `feat/crdc-round3-pr-b`: migration `20261121130000_crdc_round3_pr_b.sql` guards the last active admin with a transaction advisory lock and adds an append-only audit log with per-table safe-column allow-lists. pgTAP coverage is in `supabase/tests/crdc_round3_pr_b_test.sql`; `.github/workflows/crdc-sql-tests.yml` runs `supabase/tests/crdc_last_admin_concurrency.sh` to exercise concurrent demotions in two PostgreSQL sessions.

## 6. CI/CD and tests

Workflows under `.github/workflows/`:

- `crdc-sql-tests.yml` runs on pull requests and on pushes to `main`; it starts local Supabase, runs `supabase db reset`, and runs pgTAP SQL/RLS tests.
- `crdc-portal-build.yml` installs portal dependencies and runs `npm run build`.
- `crdc-researcher-e2e.yml` runs the portal against local Supabase and synthetic data with Playwright.

The E2E suite covers researcher registration/request isolation, viewer shell and aggregates, admin assignment persistence, and assigned reviewer status update with timeline visibility and case isolation.

Preserve these constraints:

- Keep workflow path filters covering portal, Supabase migrations, tests, and the workflow itself.
- Keep `npm install` in the existing CI workflow unless the lockfile setup is intentionally corrected.
- Playwright is pinned to `1.65.1`.
- Supabase startup can occasionally hit public registry rate limits; retry a failed job when logs show the failure occurred before app tests.
- Do not replace local CI values with hosted credentials.

## 7. Remaining milestone

The remaining product items are:

1. **Cashier payment UX**, after the center confirms receipt grouping. Keep all payment writes behind the existing cashier/admin RLS and payment RPC rules.
2. **Password recovery** for portal accounts.
3. **Researcher profile editing**, with database authorization and appropriate validation.

Before expanding any workflow, inspect the exact migration definitions and active RLS policies first.
