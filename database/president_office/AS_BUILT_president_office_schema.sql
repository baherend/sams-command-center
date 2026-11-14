-- =====================================================================
-- president_office : AS-BUILT schema (reference copy, DO NOT RUN on sams-dev)
-- Reconstructed on 2026-11-14 from the live Supabase database
-- (information_schema, pg_constraint, pg_indexes, pg_get_viewdef, pg_get_functiondef).
-- Names are the ones Codex created. Use this file to understand / rebuild the
-- schema from scratch; for changes always add a NEW numbered migration file.
--
-- Notes
--  * Constraint names are left to PostgreSQL defaults here (the live names are a
--    bit odd, e.g. transactions_from_transaction_parties_id_fkey) - no effect.
--  * Identity type (ALWAYS vs BY DEFAULT) was not captured; ALWAYS assumed.
--  * RLS: enabled on every table (decision_types / office_departments via
--    05_fix_office_views.sql). No policies yet = deny by default.
--  * Views carry security_invoker = true (from 05_fix_office_views.sql).
--  * Known naming wart: office_departments uses section_id / transactions.section_id;
--    decision_types uses directive_id. Kept as-is to match the live database.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS president_office;
REVOKE ALL ON SCHEMA president_office FROM PUBLIC;

-- ---------- lookups ----------
CREATE TABLE president_office.decision_types (
  directive_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         VARCHAR(30)  NOT NULL UNIQUE,
  name_ar      VARCHAR(200) NOT NULL,
  closes_item  BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE TABLE president_office.office_departments (
  section_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       VARCHAR(30)  NOT NULL UNIQUE,
  name_ar    VARCHAR(200) NOT NULL,
  name_en    VARCHAR(200),
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE president_office.outside_contacts (
  external_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name_ar     VARCHAR(250) NOT NULL,
  name_en     VARCHAR(250),
  entity_type VARCHAR(20)  NOT NULL DEFAULT 'other'
              CHECK (entity_type IN ('ministry','government_body','university','company','individual','other')),
  city        VARCHAR(100)
);

CREATE TABLE president_office.transaction_parties (
  party_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  party_kind    VARCHAR(15) NOT NULL
                CHECK (party_kind IN ('faculty','department','admin_unit','staff','external','unresolved')),
  faculty_id    BIGINT REFERENCES public.faculty(faculty_id),
  department_id BIGINT REFERENCES public.department(department_id),
  admin_unit_id BIGINT REFERENCES public.admin_unit(unit_id),
  staff_id      BIGINT REFERENCES public.staff(staff_id),
  external_id   BIGINT REFERENCES president_office.outside_contacts(external_id),
  label_ar      VARCHAR(250) NOT NULL UNIQUE,
  CHECK (num_nonnulls(faculty_id, department_id, admin_unit_id, staff_id, external_id) <= 1)
);

-- ---------- the transactions ----------
CREATE TABLE president_office.transactions (
  transaction_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  archive_year       SMALLINT NOT NULL,
  origin_type        VARCHAR(10) NOT NULL DEFAULT 'incoming'
                     CHECK (origin_type IN ('incoming','internal')),
  section_id         BIGINT REFERENCES president_office.office_departments(section_id),
  incoming_no        VARCHAR(30),
  incoming_date      DATE,
  from_party_id      BIGINT REFERENCES president_office.transaction_parties(party_id),
  subject            TEXT NOT NULL,
  directive_id       BIGINT REFERENCES president_office.decision_types(directive_id),
  directive_note     TEXT,
  followup_note      TEXT,
  page_no            INTEGER,
  original_page_no   INTEGER,
  has_original       BOOLEAN NOT NULL DEFAULT FALSE,
  has_attachments    BOOLEAN NOT NULL DEFAULT FALSE,
  is_postponed       BOOLEAN NOT NULL DEFAULT FALSE,
  is_recurring       BOOLEAN NOT NULL DEFAULT FALSE,
  needs_followup     BOOLEAN NOT NULL DEFAULT FALSE,
  status             VARCHAR(15) NOT NULL DEFAULT 'registered'
                     CHECK (status IN ('registered','with_president','in_progress','awaiting_reply','closed','archived')),
  confidentiality    VARCHAR(12) NOT NULL DEFAULT 'normal'
                     CHECK (confidentiality IN ('normal','restricted','confidential')),
  related_request_id BIGINT REFERENCES public.service_request(request_id),
  related_student_id BIGINT REFERENCES public.student(student_id),
  registered_by      BIGINT REFERENCES public.app_user(user_id),
  registered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at          TIMESTAMPTZ,
  legacy_id          BIGINT UNIQUE,
  legacy_in_direction_raw TEXT,
  is_historical      BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (closed_at IS NULL OR status IN ('closed','archived'))
);

CREATE TABLE president_office.outgoing_letters (
  outgoing_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id BIGINT NOT NULL REFERENCES president_office.transactions(transaction_id) ON DELETE CASCADE,
  seq_no         SMALLINT NOT NULL DEFAULT 1 CHECK (seq_no >= 1),
  outgoing_no    VARCHAR(30),
  outgoing_date  DATE,
  to_party_id    BIGINT REFERENCES president_office.transaction_parties(party_id),
  receiver_name  VARCHAR(200),
  followup_note  TEXT,
  legacy_out_direction_raw TEXT,
  UNIQUE (transaction_id, seq_no)
);

CREATE TABLE president_office.transaction_files (
  transaction_id BIGINT NOT NULL REFERENCES president_office.transactions(transaction_id) ON DELETE CASCADE,
  document_id    BIGINT NOT NULL REFERENCES public.document(document_id),
  is_original    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (transaction_id, document_id)
);

CREATE TABLE president_office.transaction_history (
  event_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id BIGINT NOT NULL REFERENCES president_office.transactions(transaction_id) ON DELETE CASCADE,
  actor_user_id  BIGINT REFERENCES public.app_user(user_id),
  event_type     VARCHAR(20) NOT NULL
                 CHECK (event_type IN ('registered','visa_issued','forwarded','reply_sent',
                                       'reminder','postponed','reopened','closed','comment')),
  to_unit_id     BIGINT REFERENCES public.admin_unit(unit_id),
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- indexes (besides PK / UNIQUE) ----------
CREATE INDEX ix_outgoing_date           ON president_office.outgoing_letters(outgoing_date);
CREATE INDEX ix_outgoing_transaction    ON president_office.outgoing_letters(transaction_id);
CREATE INDEX ix_history_transaction     ON president_office.transaction_history(transaction_id, created_at);
CREATE INDEX ix_transactions_from_party ON president_office.transactions(from_party_id);
CREATE INDEX ix_transactions_incoming_date ON president_office.transactions(incoming_date);
CREATE INDEX ix_transactions_incoming_no   ON president_office.transactions(archive_year, incoming_no);
CREATE INDEX ix_transactions_status        ON president_office.transactions(status, needs_followup);
CREATE INDEX ix_transactions_subject_search ON president_office.transactions USING gin (to_tsvector('arabic', subject));
CREATE INDEX ix_transactions_year_department ON president_office.transactions(archive_year, section_id);

-- ---------- audit (writes only) ----------
CREATE OR REPLACE FUNCTION president_office.fn_audit_office_record()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
  pk_col   TEXT := TG_ARGV[0];
  rec      JSONB;
  rec_id   BIGINT;
  changed  JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN rec := to_jsonb(OLD); ELSE rec := to_jsonb(NEW); END IF;
  rec_id := (rec ->> pk_col)::BIGINT;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(jsonb_agg(n.key), '[]'::jsonb) INTO changed
    FROM jsonb_each(to_jsonb(NEW)) n
    JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
    WHERE n.value IS DISTINCT FROM o.value;
  END IF;

  INSERT INTO public.audit_log(user_id, action, table_name, record_id, details)
  VALUES (NULLIF(current_setting('app.user_id', true), '')::BIGINT,
          TG_OP,
          TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
          rec_id,
          CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('changed_columns', changed) END);
  RETURN NULL;
END $function$;

CREATE TRIGGER trg_audit_transactions
  AFTER INSERT OR UPDATE OR DELETE ON president_office.transactions
  FOR EACH ROW EXECUTE FUNCTION president_office.fn_audit_office_record('transaction_id');
CREATE TRIGGER trg_audit_outgoing_letters
  AFTER INSERT OR UPDATE OR DELETE ON president_office.outgoing_letters
  FOR EACH ROW EXECUTE FUNCTION president_office.fn_audit_office_record('outgoing_id');

-- ---------- report views (security_invoker, see 05_fix_office_views.sql) ----------
CREATE VIEW president_office.report_response_time WITH (security_invoker = true) AS
SELECT t.transaction_id, t.archive_year, t.section_id, t.from_party_id, t.incoming_date,
       t.is_historical,
       MIN(o.outgoing_date)                   AS first_outgoing_date,
       MIN(o.outgoing_date) - t.incoming_date AS response_days
FROM president_office.transactions t
LEFT JOIN president_office.outgoing_letters o USING (transaction_id)
GROUP BY t.transaction_id;

CREATE VIEW president_office.report_waiting_for_reply WITH (security_invoker = true) AS
SELECT t.transaction_id, t.archive_year, t.incoming_no, t.incoming_date, t.section_id,
       t.from_party_id, t.subject, t.needs_followup, t.is_postponed,
       CURRENT_DATE - t.incoming_date AS age_days
FROM president_office.transactions t
WHERE t.status NOT IN ('closed','archived')
  AND NOT t.is_historical
  AND (t.needs_followup OR t.status IN ('awaiting_reply','in_progress','with_president'));

CREATE VIEW president_office.report_monthly_volume WITH (security_invoker = true) AS
SELECT date_trunc('month', incoming_date)::date AS month, section_id, COUNT(*) AS items
FROM president_office.transactions
WHERE incoming_date IS NOT NULL
GROUP BY 1, 2;

-- ---------- RLS (deny by default: no policies yet) ----------
ALTER TABLE president_office.transactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE president_office.outgoing_letters    ENABLE ROW LEVEL SECURITY;
ALTER TABLE president_office.transaction_files   ENABLE ROW LEVEL SECURITY;
ALTER TABLE president_office.transaction_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE president_office.transaction_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE president_office.outside_contacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE president_office.decision_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE president_office.office_departments  ENABLE ROW LEVEL SECURITY;
