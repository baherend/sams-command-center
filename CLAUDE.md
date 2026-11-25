# CRDC Platform — Claude Code Handoff

**Read this first before changing the CRDC platform.** The repository is `baherend/sams-command-center`; CRDC lives under `CRDC/`. Round 3 PRs A, B, and C are merged to `main` through PR #20. The platform is an authenticated researcher and staff prototype; it is not production-ready.

## 1. Project rules and environment isolation

- Keep synthetic data out of the shared Supabase project `sams-dev`. Its CRDC migrations and reference rows may be deployed, but `supabase/seed.sql` must never be applied there.
- Develop and test against the local Supabase stack only: `supabase start`, `supabase db reset`, then `bash supabase/scripts/seed_local.sh`. Reset applies migrations only; the guarded seed script explicitly loads synthetic data into the verified local database URL.
- Never run `supabase db reset --linked` or `supabase db push --include-seed` against `sams-dev`. Never apply `supabase/seed.sql` to any hosted/shared project.
- A separate `sams-test` project is acceptable only after confirming it is isolated. Do not assume one is configured.
- Browser code uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never put a service-role key in frontend code. The service-role key appears only in disposable local CI fixtures.
- Put schema changes in timestamped `supabase/migrations/` files and validate through a PR before any hosted deployment.

## 2. Database schema and workflows

The `crdc` schema has 16 tables:

- **Catalog/reference:** `services`, `requirement_types`, `fee_schedule`, `degrees`, `degree_requirements`, `journals`, `journal_issues`, `request_statuses`.
- **People:** `researchers`, `staff_users`.
- **Operations/publication/audit:** `service_requests`, `request_items`, `payments`, `request_status_history`, `publication_submissions`, `audit_log`.

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
- Payment linkage remains in `crdc.link_payment_to_items(...)`, which locks the payment and item rows and only links still-unlinked items. Team lead approved the receipt grouping rule: one payment covers one or more items from one `service_request` in one currency (`EGP` or `USD`); an item cannot be split across payments.
- A linked payment is a payment order. Researchers upload proof through the private `payment-receipts` bucket and `crdc.submit_payment_receipt(...)`; only an active cashier or admin can approve/reject through `crdc.approve_payment_receipt(...)` / `crdc.reject_payment_receipt(...)`. These Round 4 `SECURITY DEFINER` RPCs reside directly in the `crdc` schema and check the caller's role and ownership at entry. Approval locks the payment and items, verifies the order, changes the receipt to `verified`, and appends `PAID` status history. The generic status RPC must never be used to mark an item `PAID`.
- Receipt files are limited to PDF/JPG/PNG, 5 MiB, and three objects per payment. Object paths are scoped to Auth user, request, and payment; researchers read their own file and active cashiers/admins read pending/verified proofs. No overwrite/delete policy exists. Audit logs allow-list receipt status, receipt/reference numbers, payment-order numbers, and the verifying staff ID, while excluding receipt object paths, rejection text, and researcher identity fields.

## 3. Security and RLS

RLS is enabled on all CRDC tables. Authorization is based on the signed-in Auth user linked through `researchers.auth_user_id` or `staff_users.auth_user_id`; client-side role checks only control presentation.

Roles:

- **Researcher:** owns one profile and can see only their profile, requests, items, payments, history, and publication records.
- **Reviewer/statistician:** see only cases with items assigned to them; can update allowed operational statuses through the status RPC. Payment statuses are rejected for these roles.
- **Cashier:** has payment operations and limited request contact data, without national ID or passport fields.
- **Viewer:** can access aggregate dashboards only, never individual cases or researcher identities.
- **Admin:** has broad operational access, manages staff assignments, sees the administrative request queue, and can access operational workflows.

The safe aggregate views are `crdc.viewer_dashboard_summary` and `crdc.staff_dashboard_overview`. They contain grouped counts only, with no personal identifiers or case details.

Public (signed-out) access goes only through schema `crdc_public` (migration `20261125120000_crdc_public_catalog.sql`): one `SECURITY DEFINER` function, `crdc_public.get_catalog()`, returns active services, their fees, degrees, degree requirements and journals as JSONB. `anon` has no `USAGE` on `crdc` or `private`; do not grant it, because every `crdc` function not explicitly revoked from `PUBLIC` would become callable from the internet. Add new public data as fields of this function, never as `anon` table grants. A hosted project must list `crdc_public` under Exposed schemas. pgTAP coverage: `supabase/tests/crdc_public_catalog_test.sql`. `CRDC/researcher-portal/vercel.json` sets the Content-Security-Policy and security headers (allowing only Supabase and the Hugging Face model download as remote origins); a new remote origin must be added there.

## 4. Synthetic seed data

`supabase/seed.sql` is local-only and refuses to run unless `crdc.allow_seed=on` is passed in `PGOPTIONS`; it also aborts when any existing researcher row does not match the seed's synthetic identity pattern. `supabase/config.toml` disables automatic seeding. Use `bash supabase/scripts/seed_local.sh`, which verifies the active DB URL is the local loopback database before invoking `psql`. It generates 400 fictitious researchers and historical requests from 2018–2026, using `@example.test` emails and TEST-prefixed identifiers.

It covers Egyptian and foreign profiles, degrees, separate thesis/paper requests, multi-service items, payment and status scenarios, and publication outcomes. After a local `supabase db reset`, run the guarded script before pgTAP or Playwright. Never use `db reset --linked` or `db push --include-seed` on `sams-dev`.

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
6. **Round 3 follow-up (PR #18):** fixed the national-ID browser pattern and corrected pgTAP role switching and RPC argument types.
7. **Round 3 PR B (PR #19):** migration `20261121130000_crdc_round3_pr_b.sql` guards the last active Auth-linked administrator with a transaction advisory lock and adds an append-only audit log with per-table safe-column allow-lists. pgTAP coverage is in `supabase/tests/crdc_round3_pr_b_test.sql`; `.github/workflows/crdc-sql-tests.yml` runs `supabase/tests/crdc_last_admin_concurrency.sh` to exercise concurrent demotions in two PostgreSQL sessions.
8. **Round 3 PR C (PR #20):** added safe Arabic database-error mapping and unit tests; made the synthetic seed opt-in with a loopback-only loader; added keyset-paginated staff queues with page-bounded history/publication queries; made page count optional only for fee options that do not require it; and clarified researcher-visible staff notes. The migration grants `service_role` only the operational-table reads used by trusted CI/backend fixtures, while keeping `audit_log` excluded. The portal CI uses `supabase/setup-cli@v3` with `v2.stable` to avoid the rate-limited latest-release lookup and to remain on the CLI v2 line.
9. **Round 4 Cashier & Receipt Verification:** adds private receipt storage, researcher submission and cashier/admin approval/rejection RPCs, immutable verified payments, and an admin/cashier receipt queue with safe signed previews. The grouping rule is confirmed: a payment covers items from only one request and one currency, and each item belongs to at most one payment.
10. **Round 5 Password Recovery & Profile Editing:** researchers can request password recovery with a non-enumerating Arabic confirmation and complete the `PASSWORD_RECOVERY` flow with an eight-character minimum. Researchers can edit only `full_name`, `degree_id`, and `specialty` on their own profile; identity fields are read-only in the portal and protected by column grants plus a database trigger. `identity_verified_at` is an optional protected timestamp added for the identity-verification workflow.
11. **Round 6 Analytics & KPIs Dashboard (completed):** migration `20261124130000_crdc_analytics_dashboard.sql` adds `crdc.get_analytics_dashboard(p_days integer default null)`, a `SECURITY DEFINER` RPC (`search_path = crdc, public`) restricted to active `admin` and `viewer` staff (`42501` otherwise; `22023` when `p_days` is outside 1–3650). It returns one PII-free JSONB object (`kpis`, `by_service`, `by_status`, `monthly_trend`, `applicant_mix`) with no researcher names, emails, national IDs, passports, or per-case identifiers. `p_days` filters requests by `service_requests.created_at`, and items, revenue, and applicant mix follow their request. Revenue is the `amount_due` of items linked to a payment whose `receipt_status` is `verified`, kept separate per currency (EGP/USD, never summed). Turnaround runs from the first `SUBMITTED` history row (item `created_at` if none) to the first `COMPLETED`/`DELIVERED` row. `monthly_trend` always covers the last 12 UTC months, including empty months, and ignores `p_days`; `by_service` and `by_status` include zero-count rows. The portal's `src/AnalyticsDashboard.tsx` renders KPI cards, a time-range selector, and zero-dependency accessible SVG charts (left-to-right chronological trend axis). Viewers land on it by default and keep the older overview tab; admins reach it through the «الإحصائيات والمؤشرات» tab. pgTAP coverage is in `supabase/tests/crdc_analytics_dashboard_test.sql`; E2E coverage is in `e2e/staff-dashboard.spec.ts`.

12. **Murshid assistant in the portal:** `src/AssistantWidget.tsx` runs the Murshid engine (`src/murshid/`, a TypeScript port of `CRDC/chatbot/rag/`) in the browser. It answers only from the procedural guide (extractive, with a refusal gate), computes fees from `crdc.fee_schedule`, and routes journals from `journals.json` (routing still *proposed*). Chunks and vectors ship in `public/murshid/index.json` (regenerate with `CRDC/chatbot/scripts/export_web.py`); the e5 model downloads once from the Hugging Face Hub and is refused unless its SHA-256 matches the value pinned in `index.json`. The widget keeps the Morshed avatar, greeting bubble and AR/EN strings from `i18n.tsx`; `src/assistantTools.ts` (an untested copy of the calculator and journal router reading `fees.json`) was removed in favour of the engine. The earlier `crdc.search_kb` RPC and `kb_chunks` table remain in the database but the widget no longer calls them.

## 6. CI/CD and tests

Workflows under `.github/workflows/`:

- `crdc-sql-tests.yml` runs on pull requests and on pushes to `main`; it starts local Supabase, runs `supabase db reset`, explicitly loads guarded synthetic data through `seed_local.sh`, and runs pgTAP SQL/RLS tests.
- `crdc-portal-build.yml` installs portal dependencies and runs `npm run build`.
- `crdc-murshid-eval.yml` checks `fees.json` against `crdc.fee_schedule`, that `public/murshid/index.json` is current, and the in-browser engine's accuracy against the measured baseline on both question sets.
- `crdc-researcher-e2e.yml` runs the portal against local Supabase and synthetic data (loaded only through `seed_local.sh`) with Playwright.

The E2E suite covers researcher registration/request isolation, password recovery and profile editing, researcher receipt submission and cashier approval, viewer shell and aggregates, keyset pagination across multiple pages, admin assignment persistence, publication issue filtering by the currently selected journal, optional page-count rules, and assigned reviewer status update with server timestamp and case isolation.

Preserve these constraints:

- Keep workflow path filters covering portal, Supabase migrations, tests, and the workflow itself.
- Use `npm ci` in portal CI and `npm test` for the Playwright suite; Playwright is a pinned dev dependency in the lockfile.
- Playwright is pinned to `1.65.1`.
- Supabase CLI setup uses `supabase/setup-cli@v3` with `version: v2.stable` to avoid the GitHub API latest-release lookup. Docker image pulls during `supabase start` can still fail independently; distinguish registry throttling from port conflicts or migration/test failures before retrying.
- Do not replace local CI values with hosted credentials.

## 7. Remaining milestone

The remaining product items are:

All currently defined researcher portal milestones are implemented, including the Round 6 Analytics & KPIs Dashboard. Continue to inspect migration definitions and active RLS policies before expanding workflows.

Before expanding any workflow, inspect the exact migration definitions and active RLS policies first.
