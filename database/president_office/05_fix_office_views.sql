-- =====================================================================
-- Fix-up for the president_office schema as built by Codex
--   1) add is_historical (old years excluded from reply-time KPIs)
--   2) recreate the 3 report views with column names that match the tables
--      (transaction_id, from_party_id) and security_invoker = true so the
--      views respect row level security of the tables underneath
--   3) turn RLS on for the 2 lookup tables that still have it off
-- Safe to run on empty tables; nothing is deleted except the 3 views, which
-- are recreated in the same transaction.
-- =====================================================================
BEGIN;

ALTER TABLE president_office.transactions
  ADD COLUMN IF NOT EXISTS is_historical boolean NOT NULL DEFAULT false;

DROP VIEW IF EXISTS president_office.report_response_time;
DROP VIEW IF EXISTS president_office.report_waiting_for_reply;
DROP VIEW IF EXISTS president_office.report_monthly_volume;

-- days from incoming to the FIRST outgoing letter
CREATE VIEW president_office.report_response_time
WITH (security_invoker = true) AS
SELECT t.transaction_id,
       t.archive_year,
       t.section_id,
       t.from_party_id,
       t.incoming_date,
       t.is_historical,
       MIN(o.outgoing_date)                    AS first_outgoing_date,
       MIN(o.outgoing_date) - t.incoming_date  AS response_days
FROM president_office.transactions t
LEFT JOIN president_office.outgoing_letters o USING (transaction_id)
GROUP BY t.transaction_id;

-- open items (historical rows are excluded so old unanswered papers do not show as late)
CREATE VIEW president_office.report_waiting_for_reply
WITH (security_invoker = true) AS
SELECT t.transaction_id,
       t.archive_year,
       t.incoming_no,
       t.incoming_date,
       t.section_id,
       t.from_party_id,
       t.subject,
       t.needs_followup,
       t.is_postponed,
       CURRENT_DATE - t.incoming_date AS age_days
FROM president_office.transactions t
WHERE t.status NOT IN ('closed', 'archived')
  AND NOT t.is_historical
  AND (t.needs_followup OR t.status IN ('awaiting_reply', 'in_progress', 'with_president'));

-- workload per month (keeps ALL years, history included)
CREATE VIEW president_office.report_monthly_volume
WITH (security_invoker = true) AS
SELECT date_trunc('month', incoming_date)::date AS month,
       section_id,
       COUNT(*) AS items
FROM president_office.transactions
WHERE incoming_date IS NOT NULL
GROUP BY 1, 2;

ALTER TABLE president_office.decision_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE president_office.office_departments  ENABLE ROW LEVEL SECURITY;

COMMIT;
