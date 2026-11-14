-- =====================================================================
-- SAMS - President's Office Correspondence module  (v0.1)
-- PostgreSQL 14+ | extends 01_sams_schema_v2.sql (run that file first)
--
-- Design rules
--  * Lives in its own schema "president_office" (restricted access).
--  * Reuses from v2: admin_unit, faculty, department, staff, student,
--    app_user, document, service_request, audit_log.
--  * Replaces the legacy Access table tblArchive (one row per
--    correspondence, 3 outgoing columns) with:
--      correspondence -> correspondence_outgoing (1..n)
--                     -> correspondence_event    (workflow trail)
--                     -> correspondence_attachment (scans via public.document)
--  * legacy_* columns keep the trace back to the Access archive so the
--    migration can be audited. Column names are placeholders until the
--    real tblArchive Documenter report is checked.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS president_office;
REVOKE ALL ON SCHEMA president_office FROM PUBLIC;

-- ---------- 1. Lookups ----------
-- Legacy lookup "Sections" (e.g. contracts, expatriates, financial rewards)
CREATE TABLE president_office.office_section (
  section_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        VARCHAR(30) UNIQUE NOT NULL,
  name_ar     VARCHAR(200) NOT NULL,
  name_en     VARCHAR(200),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- The president's directive ("التأشيرة"): approved, filed, prepare letter ...
CREATE TABLE president_office.directive_type (
  directive_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         VARCHAR(30) UNIQUE NOT NULL,
  name_ar      VARCHAR(200) NOT NULL,
  closes_item  BOOLEAN NOT NULL DEFAULT FALSE   -- e.g. "filed" ends the process
);

-- Parties outside the Academy (ministries, universities, companies, individuals)
CREATE TABLE president_office.external_entity (
  external_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name_ar     VARCHAR(250) NOT NULL,
  name_en     VARCHAR(250),
  entity_type VARCHAR(20) NOT NULL DEFAULT 'other'
              CHECK (entity_type IN ('ministry','government_body','university','company','individual','other')),
  city        VARCHAR(100)
);

-- One normalized "sender / destination": internal unit, faculty, department,
-- staff member, or external entity. Replaces the free-text "in direction" and
-- "out direction 1/2/3" columns after name cleaning.
CREATE TABLE president_office.party (
  party_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  party_kind      VARCHAR(15) NOT NULL
                  CHECK (party_kind IN ('faculty','department','admin_unit','staff','external','unresolved')),
  faculty_id      BIGINT REFERENCES public.faculty(faculty_id),
  department_id   BIGINT REFERENCES public.department(department_id),
  admin_unit_id   BIGINT REFERENCES public.admin_unit(unit_id),
  staff_id        BIGINT REFERENCES public.staff(staff_id),
  external_id     BIGINT REFERENCES president_office.external_entity(external_id),
  label_ar        VARCHAR(250) NOT NULL,          -- clean display name, e.g. "عميد كلية العلوم الإدارية"
  CHECK (num_nonnulls(faculty_id, department_id, admin_unit_id, staff_id, external_id) <= 1),
  UNIQUE (label_ar)
);

-- ---------- 2. The correspondence itself ----------
CREATE TABLE president_office.correspondence (
  correspondence_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  archive_year      SMALLINT NOT NULL,            -- legacy "Year" column
  origin_type       VARCHAR(10) NOT NULL DEFAULT 'incoming'
                    CHECK (origin_type IN ('incoming','internal')),
  section_id        BIGINT REFERENCES president_office.office_section(section_id),
  incoming_no       VARCHAR(30),
  incoming_date     DATE,
  from_party_id     BIGINT REFERENCES president_office.party(party_id),
  subject           TEXT NOT NULL,
  directive_id      BIGINT REFERENCES president_office.directive_type(directive_id),
  directive_note    TEXT,                         -- free-text part of the visa
  followup_note     TEXT,                         -- legacy "following" / follow-up data
  page_no           INTEGER,
  original_page_no  INTEGER,                      -- legacy "original text" page
  has_original      BOOLEAN NOT NULL DEFAULT FALSE,
  has_attachments   BOOLEAN NOT NULL DEFAULT FALSE,
  is_postponed      BOOLEAN NOT NULL DEFAULT FALSE,
  is_recurring      BOOLEAN NOT NULL DEFAULT FALSE,
  needs_followup    BOOLEAN NOT NULL DEFAULT FALSE,
  status            VARCHAR(15) NOT NULL DEFAULT 'registered'
                    CHECK (status IN ('registered','with_president','in_progress','awaiting_reply','closed','archived')),
  is_historical     BOOLEAN NOT NULL DEFAULT FALSE,   -- old, low-quality years: excluded from response-time KPIs
  confidentiality   VARCHAR(12) NOT NULL DEFAULT 'normal'
                    CHECK (confidentiality IN ('normal','restricted','confidential')),
  related_request_id BIGINT REFERENCES public.service_request(request_id),  -- link to Project 3 complaint
  related_student_id BIGINT REFERENCES public.student(student_id),          -- restricted; only when the item concerns a student
  registered_by     BIGINT REFERENCES public.app_user(user_id),
  registered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at         TIMESTAMPTZ,
  -- migration trace (NULL for records created in the new system)
  legacy_id         BIGINT UNIQUE,
  legacy_in_direction_raw TEXT,
  CHECK (closed_at IS NULL OR status IN ('closed','archived'))
);

-- Up to 3 destinations in the legacy form; here any number, ordered.
CREATE TABLE president_office.correspondence_outgoing (
  outgoing_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  correspondence_id BIGINT NOT NULL REFERENCES president_office.correspondence(correspondence_id) ON DELETE CASCADE,
  seq_no            SMALLINT NOT NULL DEFAULT 1 CHECK (seq_no >= 1),
  outgoing_no       VARCHAR(30),
  outgoing_date     DATE,
  to_party_id       BIGINT REFERENCES president_office.party(party_id),
  receiver_name     VARCHAR(200),                 -- legacy "receiver"
  followup_note     TEXT,                         -- legacy "OutDFollo"
  legacy_out_direction_raw TEXT,
  UNIQUE (correspondence_id, seq_no)
);

-- Scans / files: reuse public.document (doc_type = 'correspondence')
CREATE TABLE president_office.correspondence_attachment (
  correspondence_id BIGINT NOT NULL REFERENCES president_office.correspondence(correspondence_id) ON DELETE CASCADE,
  document_id       BIGINT NOT NULL REFERENCES public.document(document_id),
  is_original       BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (correspondence_id, document_id)
);

-- Workflow trail - the part the Access archive never recorded.
-- Same pattern as public.request_event.
CREATE TABLE president_office.correspondence_event (
  event_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  correspondence_id BIGINT NOT NULL REFERENCES president_office.correspondence(correspondence_id) ON DELETE CASCADE,
  actor_user_id     BIGINT REFERENCES public.app_user(user_id),
  event_type        VARCHAR(20) NOT NULL
                    CHECK (event_type IN ('registered','visa_issued','forwarded','reply_sent',
                                          'reminder','postponed','reopened','closed','comment')),
  to_unit_id        BIGINT REFERENCES public.admin_unit(unit_id),   -- for 'forwarded'
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 3. Indexes ----------
CREATE INDEX ix_corr_incoming_date ON president_office.correspondence(incoming_date);
CREATE INDEX ix_corr_year_section  ON president_office.correspondence(archive_year, section_id);
CREATE INDEX ix_corr_status        ON president_office.correspondence(status, needs_followup);
CREATE INDEX ix_corr_from_party    ON president_office.correspondence(from_party_id);
CREATE INDEX ix_corr_incoming_no   ON president_office.correspondence(archive_year, incoming_no);
CREATE INDEX ix_corr_subject_fts   ON president_office.correspondence USING gin (to_tsvector('arabic', subject));
CREATE INDEX ix_out_corr           ON president_office.correspondence_outgoing(correspondence_id);
CREATE INDEX ix_out_date           ON president_office.correspondence_outgoing(outgoing_date);
CREATE INDEX ix_event_corr         ON president_office.correspondence_event(correspondence_id, created_at);

-- ---------- 4. Audit (writes only) ----------
-- Logs who changed what into public.audit_log. Only column NAMES are logged
-- for updates, never the text, so the audit table does not duplicate
-- sensitive content. The app sets the user per session:
--   SELECT set_config('app.user_id', '<user_id>', false);
-- Reads (SELECT) cannot be caught by triggers; log them in the app layer.
CREATE OR REPLACE FUNCTION president_office.fn_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
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
END $$;

CREATE TRIGGER trg_audit_correspondence
  AFTER INSERT OR UPDATE OR DELETE ON president_office.correspondence
  FOR EACH ROW EXECUTE FUNCTION president_office.fn_audit('correspondence_id');
CREATE TRIGGER trg_audit_outgoing
  AFTER INSERT OR UPDATE OR DELETE ON president_office.correspondence_outgoing
  FOR EACH ROW EXECUTE FUNCTION president_office.fn_audit('outgoing_id');

-- ---------- 5. Analytic views (feed the executive dashboard) ----------
-- Turnaround: days from incoming to the FIRST outgoing letter
CREATE VIEW president_office.v_turnaround AS
SELECT c.correspondence_id,
       c.archive_year,
       c.section_id,
       c.from_party_id,
       c.incoming_date,
       c.is_historical,
       MIN(o.outgoing_date)                          AS first_outgoing_date,
       MIN(o.outgoing_date) - c.incoming_date        AS response_days
FROM president_office.correspondence c
LEFT JOIN president_office.correspondence_outgoing o USING (correspondence_id)
GROUP BY c.correspondence_id;

-- Open items: the digital version of the "topics requiring a reply" report
CREATE VIEW president_office.v_pending AS
SELECT c.correspondence_id,
       c.archive_year,
       c.incoming_no,
       c.incoming_date,
       c.section_id,
       c.from_party_id,
       c.subject,
       c.needs_followup,
       c.is_postponed,
       (CURRENT_DATE - c.incoming_date) AS age_days
FROM president_office.correspondence c
WHERE c.status NOT IN ('closed','archived')
  AND NOT c.is_historical
  AND (c.needs_followup OR c.status IN ('awaiting_reply','in_progress','with_president'));

-- Monthly workload
CREATE VIEW president_office.v_monthly_volume AS
SELECT date_trunc('month', incoming_date)::date AS month,
       section_id,
       COUNT(*)                                  AS items
FROM president_office.correspondence
WHERE incoming_date IS NOT NULL
GROUP BY 1, 2;

-- ---------- 6. Access control (deny by default) ----------
-- RLS on with no policy = nobody except the table owner / BYPASSRLS roles.
-- Policies are added when the role model is final (office staff, secretary,
-- president, Project 6 read-only analytics).
ALTER TABLE president_office.correspondence            ENABLE ROW LEVEL SECURITY;
ALTER TABLE president_office.correspondence_outgoing   ENABLE ROW LEVEL SECURITY;
ALTER TABLE president_office.correspondence_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE president_office.correspondence_event      ENABLE ROW LEVEL SECURITY;
ALTER TABLE president_office.party                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE president_office.external_entity           ENABLE ROW LEVEL SECURITY;
-- NOTE (Supabase): keep "president_office" OUT of the API "Exposed schemas"
-- setting so the REST/GraphQL API cannot reach these tables.
