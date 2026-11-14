-- =====================================================================
-- SAMS (Sadat Academy for Management Sciences) - Base Schema v0.2
-- PostgreSQL 14+ | Starter schema for Project 6 (central data platform)
-- Sections: A core academic | B admissions | C finance | D services & complaints
--           E alumni & careers | F documents | G audit | H analytic views
-- =====================================================================

-- ---------- A1. Organization structure ----------
CREATE TABLE campus (
  campus_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        VARCHAR(20) UNIQUE NOT NULL,
  name_ar     VARCHAR(150) NOT NULL,
  name_en     VARCHAR(150),
  city        VARCHAR(100),
  is_main     BOOLEAN NOT NULL DEFAULT FALSE
);

-- Administrative units (registrar, student affairs, IT, research center, training center ...)
CREATE TABLE admin_unit (
  unit_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_unit_id BIGINT REFERENCES admin_unit(unit_id),
  campus_id      BIGINT REFERENCES campus(campus_id),
  code           VARCHAR(30) UNIQUE NOT NULL,
  name_ar        VARCHAR(200) NOT NULL,
  name_en        VARCHAR(200),
  unit_type      VARCHAR(20) NOT NULL CHECK (unit_type IN ('administration','center','office'))
);

CREATE TABLE faculty (
  faculty_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          VARCHAR(20) UNIQUE NOT NULL,
  name_ar       VARCHAR(200) NOT NULL,
  name_en       VARCHAR(200),
  dean_staff_id BIGINT            -- FK added after staff table
);

CREATE TABLE faculty_campus (          -- which campuses offer which faculty
  faculty_id BIGINT NOT NULL REFERENCES faculty(faculty_id),
  campus_id  BIGINT NOT NULL REFERENCES campus(campus_id),
  PRIMARY KEY (faculty_id, campus_id)
);

CREATE TABLE department (
  department_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  faculty_id     BIGINT NOT NULL REFERENCES faculty(faculty_id),
  code           VARCHAR(20) UNIQUE NOT NULL,
  name_ar        VARCHAR(200) NOT NULL,
  name_en        VARCHAR(200),
  head_staff_id  BIGINT            -- FK added after staff table
);

CREATE TABLE program (          -- a degree program / major (e.g. BSc Accounting, MBA, Licence in English)
  program_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  faculty_id         BIGINT NOT NULL REFERENCES faculty(faculty_id),
  department_id      BIGINT REFERENCES department(department_id),   -- NULL for faculty-level postgraduate programs
  code               VARCHAR(20) UNIQUE NOT NULL,
  name_ar            VARCHAR(200) NOT NULL,
  name_en            VARCHAR(200),
  degree_level       VARCHAR(20) NOT NULL CHECK (degree_level IN ('diploma','bachelor','master','doctorate')),
  program_type       VARCHAR(12) NOT NULL DEFAULT 'academic' CHECK (program_type IN ('academic','professional')),
  teaching_language  VARCHAR(2)  NOT NULL DEFAULT 'ar' CHECK (teaching_language IN ('ar','en')),
  total_credit_hours SMALLINT,
  duration_terms     SMALLINT,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE track (            -- specialization path inside a program (e.g. Business Admin -> Finance & Investment)
  track_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  program_id BIGINT NOT NULL REFERENCES program(program_id),
  code       VARCHAR(20) UNIQUE NOT NULL,
  name_ar    VARCHAR(200) NOT NULL,
  name_en    VARCHAR(200)
);

-- ---------- A2. Curriculum ----------
CREATE TABLE course (
  course_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  department_id BIGINT NOT NULL REFERENCES department(department_id),
  code          VARCHAR(20) UNIQUE NOT NULL,
  name_ar       VARCHAR(200) NOT NULL,
  name_en       VARCHAR(200),
  credit_hours  NUMERIC(3,1) NOT NULL,
  lecture_hours NUMERIC(3,1) DEFAULT 0,
  lab_hours     NUMERIC(3,1) DEFAULT 0,
  description   TEXT
);

CREATE TABLE program_course (          -- the study plan
  program_id BIGINT NOT NULL REFERENCES program(program_id),
  course_id  BIGINT NOT NULL REFERENCES course(course_id),
  level_no   SMALLINT,
  term_no    SMALLINT,
  course_type VARCHAR(20) NOT NULL DEFAULT 'required' CHECK (course_type IN ('required','elective','university_req')),
  PRIMARY KEY (program_id, course_id)
);

CREATE TABLE course_prerequisite (
  course_id              BIGINT NOT NULL REFERENCES course(course_id),
  prerequisite_course_id BIGINT NOT NULL REFERENCES course(course_id),
  PRIMARY KEY (course_id, prerequisite_course_id),
  CHECK (course_id <> prerequisite_course_id)
);

-- ---------- A3. Calendar ----------
CREATE TABLE academic_year (
  year_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label      VARCHAR(9) UNIQUE NOT NULL,       -- e.g. 2025/2026
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL
);

CREATE TABLE term (
  term_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  year_id            BIGINT NOT NULL REFERENCES academic_year(year_id),
  term_name          VARCHAR(10) NOT NULL CHECK (term_name IN ('first','second','summer')),
  start_date         DATE NOT NULL,
  end_date           DATE NOT NULL,
  registration_start DATE,
  registration_end   DATE,
  UNIQUE (year_id, term_name)
);

-- ---------- A4. People, accounts, staff ----------
CREATE TABLE person (
  person_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  national_id   VARCHAR(20) UNIQUE,            -- sensitive: encrypt / restrict access
  first_name_ar VARCHAR(100) NOT NULL,
  last_name_ar  VARCHAR(100) NOT NULL,
  first_name_en VARCHAR(100),
  last_name_en  VARCHAR(100),
  gender        CHAR(1) CHECK (gender IN ('M','F')),
  birth_date    DATE,
  nationality   VARCHAR(60),
  email         VARCHAR(150) UNIQUE,
  phone         VARCHAR(30),
  address       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role (
  role_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code    VARCHAR(30) UNIQUE NOT NULL,         -- student, instructor, advisor, registrar, executive, admin ...
  name_ar VARCHAR(100)
);

CREATE TABLE app_user (
  user_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id     BIGINT UNIQUE NOT NULL REFERENCES person(person_id),
  username      VARCHAR(80) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ
);

CREATE TABLE user_role (
  user_id BIGINT NOT NULL REFERENCES app_user(user_id),
  role_id BIGINT NOT NULL REFERENCES role(role_id),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE staff (
  staff_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id       BIGINT UNIQUE NOT NULL REFERENCES person(person_id),
  staff_code      VARCHAR(20) UNIQUE NOT NULL,
  department_id   BIGINT REFERENCES department(department_id),   -- academic home (faculty members)
  admin_unit_id   BIGINT REFERENCES admin_unit(unit_id),          -- administrative home
  campus_id       BIGINT REFERENCES campus(campus_id),
  staff_type      VARCHAR(20) NOT NULL CHECK (staff_type IN ('faculty_member','teaching_assistant','administrative','part_time')),
  hire_date       DATE,
  status          VARCHAR(15) NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_leave','resigned','retired'))
);

CREATE TABLE instructor (
  staff_id       BIGINT PRIMARY KEY REFERENCES staff(staff_id),
  academic_rank  VARCHAR(30) CHECK (academic_rank IN ('professor','associate_professor','assistant_professor','lecturer','assistant_lecturer','teaching_assistant')),
  specialization VARCHAR(200),
  max_weekly_load_hours SMALLINT
);

ALTER TABLE faculty    ADD CONSTRAINT fk_faculty_dean  FOREIGN KEY (dean_staff_id) REFERENCES staff(staff_id);
ALTER TABLE department ADD CONSTRAINT fk_dept_head     FOREIGN KEY (head_staff_id) REFERENCES staff(staff_id);

-- ---------- A5. Students ----------
CREATE TABLE student (
  student_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id         BIGINT UNIQUE NOT NULL REFERENCES person(person_id),
  student_code      VARCHAR(20) UNIQUE NOT NULL,
  campus_id         BIGINT NOT NULL REFERENCES campus(campus_id),
  admission_year_id BIGINT REFERENCES academic_year(year_id),
  advisor_staff_id  BIGINT REFERENCES staff(staff_id),
  smart_card_uid    VARCHAR(64) UNIQUE,                 -- smart ID card (Project 2)
  status            VARCHAR(15) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deferred','withdrawn','graduated'))
);

CREATE TABLE student_program (          -- supports main major + minor / second major, and transfers
  student_program_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id    BIGINT NOT NULL REFERENCES student(student_id),
  program_id    BIGINT NOT NULL REFERENCES program(program_id),
  track_id      BIGINT REFERENCES track(track_id),
  program_role  VARCHAR(12) NOT NULL DEFAULT 'primary' CHECK (program_role IN ('primary','second_major','minor')),
  start_term_id BIGINT REFERENCES term(term_id),
  end_term_id   BIGINT REFERENCES term(term_id),
  is_current    BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX uq_student_current_primary ON student_program(student_id) WHERE is_current AND program_role = 'primary';

-- ---------- B. Admissions ----------
CREATE TABLE admission_application (
  application_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id        BIGINT NOT NULL REFERENCES person(person_id),
  program_id       BIGINT NOT NULL REFERENCES program(program_id),
  campus_id        BIGINT NOT NULL REFERENCES campus(campus_id),
  year_id          BIGINT NOT NULL REFERENCES academic_year(year_id),
  certificate_type VARCHAR(30) CHECK (certificate_type IN ('thanaweya_amma','azhar','igcse','american_diploma','foreign','bachelor','master')),
  score_percent    NUMERIC(5,2),
  status           VARCHAR(15) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','accepted','rejected','enrolled')),
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (person_id, program_id, year_id)
);

-- ---------- A6. Facilities & timetable ----------
CREATE TABLE building (
  building_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campus_id   BIGINT NOT NULL REFERENCES campus(campus_id),
  code        VARCHAR(20) NOT NULL,
  name_ar     VARCHAR(150),
  UNIQUE (campus_id, code)
);

CREATE TABLE room (
  room_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  building_id BIGINT NOT NULL REFERENCES building(building_id),
  code        VARCHAR(20) NOT NULL,
  room_type   VARCHAR(15) NOT NULL CHECK (room_type IN ('lecture_hall','lab','exam_hall','meeting')),
  capacity    SMALLINT NOT NULL CHECK (capacity > 0),
  UNIQUE (building_id, code)
);

CREATE TABLE course_section (
  section_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id          BIGINT NOT NULL REFERENCES course(course_id),
  term_id            BIGINT NOT NULL REFERENCES term(term_id),
  campus_id          BIGINT NOT NULL REFERENCES campus(campus_id),
  section_no         SMALLINT NOT NULL,
  instructor_staff_id BIGINT REFERENCES instructor(staff_id),
  teaching_language  VARCHAR(2) DEFAULT 'ar',
  capacity           SMALLINT,
  status             VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  UNIQUE (course_id, term_id, campus_id, section_no)
);

CREATE TABLE section_meeting (          -- weekly timetable slots
  meeting_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  section_id  BIGINT NOT NULL REFERENCES course_section(section_id),
  room_id     BIGINT REFERENCES room(room_id),
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  CHECK (end_time > start_time)
);

-- ---------- A7. Enrollment, grades, attendance ----------
CREATE TABLE enrollment (
  enrollment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id    BIGINT NOT NULL REFERENCES student(student_id),
  section_id    BIGINT NOT NULL REFERENCES course_section(section_id),
  status        VARCHAR(12) NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','dropped','withdrawn','completed')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, section_id)
);

CREATE TABLE grade_scale (
  letter_grade VARCHAR(3) PRIMARY KEY,
  min_score    NUMERIC(5,2) NOT NULL,
  max_score    NUMERIC(5,2) NOT NULL,
  grade_points NUMERIC(3,2) NOT NULL
);

CREATE TABLE grade (
  enrollment_id    BIGINT PRIMARY KEY REFERENCES enrollment(enrollment_id),
  coursework_score NUMERIC(5,2),
  midterm_score    NUMERIC(5,2),
  final_score      NUMERIC(5,2),
  total_score      NUMERIC(5,2),
  letter_grade     VARCHAR(3) REFERENCES grade_scale(letter_grade),
  grade_points     NUMERIC(3,2),
  is_final         BOOLEAN NOT NULL DEFAULT FALSE,
  graded_by        BIGINT REFERENCES staff(staff_id),
  graded_at        TIMESTAMPTZ
);

CREATE TABLE term_result (              -- per-student per-term summary (feeds early warning & forecasting)
  student_id        BIGINT NOT NULL REFERENCES student(student_id),
  term_id           BIGINT NOT NULL REFERENCES term(term_id),
  credits_attempted NUMERIC(4,1),
  credits_earned    NUMERIC(4,1),
  term_gpa          NUMERIC(3,2),
  cumulative_gpa    NUMERIC(3,2),
  academic_standing VARCHAR(20) CHECK (academic_standing IN ('good','warning','probation','dismissed','honors')),
  PRIMARY KEY (student_id, term_id)
);

CREATE TABLE attendance (
  attendance_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enrollment_id BIGINT NOT NULL REFERENCES enrollment(enrollment_id),
  meeting_id    BIGINT REFERENCES section_meeting(meeting_id),
  session_date  DATE NOT NULL,
  status        VARCHAR(10) NOT NULL CHECK (status IN ('present','absent','late','excused')),
  method        VARCHAR(12) NOT NULL DEFAULT 'manual' CHECK (method IN ('manual','smart_card','qr')),
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, session_date, meeting_id)
);

-- ---------- C. Finance ----------
CREATE TABLE fee_item (
  fee_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  program_id  BIGINT REFERENCES program(program_id),
  name_ar     VARCHAR(150) NOT NULL,
  amount      NUMERIC(12,2) NOT NULL,
  currency    CHAR(3) NOT NULL DEFAULT 'EGP'
);

CREATE TABLE invoice (
  invoice_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id   BIGINT NOT NULL REFERENCES student(student_id),
  term_id      BIGINT NOT NULL REFERENCES term(term_id),
  total_amount NUMERIC(12,2) NOT NULL,
  due_date     DATE,
  status       VARCHAR(10) NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid','cancelled'))
);

CREATE TABLE payment (
  payment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES invoice(invoice_id),
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method     VARCHAR(15) CHECK (method IN ('cash','card','bank_transfer','online')),
  reference  VARCHAR(80),
  paid_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- D. Services, complaints & tickets (Project 3) ----------
CREATE TABLE service_category (
  category_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        VARCHAR(30) UNIQUE NOT NULL,
  name_ar     VARCHAR(150) NOT NULL,
  default_unit_id BIGINT REFERENCES admin_unit(unit_id),
  sla_hours   SMALLINT
);

CREATE TABLE service_request (
  request_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id       BIGINT NOT NULL REFERENCES person(person_id),
  category_id     BIGINT REFERENCES service_category(category_id),
  assigned_unit_id BIGINT REFERENCES admin_unit(unit_id),
  request_type    VARCHAR(12) NOT NULL CHECK (request_type IN ('complaint','inquiry','suggestion','request')),
  channel         VARCHAR(10) NOT NULL CHECK (channel IN ('text','voice','web','app')),
  subject         VARCHAR(250),
  body            TEXT NOT NULL,
  sentiment_score NUMERIC(4,3),                       -- -1..1 (AI output)
  sentiment_label VARCHAR(10) CHECK (sentiment_label IN ('negative','neutral','positive')),
  priority        VARCHAR(8) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status          VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','in_progress','resolved','closed')),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sla_due_at      TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  satisfaction_rating SMALLINT CHECK (satisfaction_rating BETWEEN 1 AND 5)
);

CREATE TABLE request_event (
  event_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id  BIGINT NOT NULL REFERENCES service_request(request_id),
  actor_user_id BIGINT REFERENCES app_user(user_id),
  event_type  VARCHAR(20) NOT NULL,                   -- created, assigned, comment, status_change ...
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- E. Alumni & careers (Project 4) ----------
CREATE TABLE graduation (
  student_id      BIGINT PRIMARY KEY REFERENCES student(student_id),
  program_id      BIGINT NOT NULL REFERENCES program(program_id),
  term_id         BIGINT NOT NULL REFERENCES term(term_id),
  graduation_date DATE,
  final_gpa       NUMERIC(3,2),
  honors          VARCHAR(30)
);

CREATE TABLE employer (
  employer_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  sector      VARCHAR(100),
  city        VARCHAR(100),
  contact_email VARCHAR(150)
);

CREATE TABLE skill (
  skill_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name     VARCHAR(120) UNIQUE NOT NULL,
  category VARCHAR(60)
);

CREATE TABLE person_skill (
  person_id BIGINT NOT NULL REFERENCES person(person_id),
  skill_id  BIGINT NOT NULL REFERENCES skill(skill_id),
  level     SMALLINT CHECK (level BETWEEN 1 AND 5),
  source    VARCHAR(15) CHECK (source IN ('self','course','certificate','assessment')),
  PRIMARY KEY (person_id, skill_id)
);

CREATE TABLE job_posting (
  job_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employer_id BIGINT NOT NULL REFERENCES employer(employer_id),
  title       VARCHAR(200) NOT NULL,
  job_type    VARCHAR(12) CHECK (job_type IN ('full_time','part_time','internship','training')),
  description TEXT,
  posted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      VARCHAR(8) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))
);

CREATE TABLE job_skill (
  job_id         BIGINT NOT NULL REFERENCES job_posting(job_id),
  skill_id       BIGINT NOT NULL REFERENCES skill(skill_id),
  required_level SMALLINT CHECK (required_level BETWEEN 1 AND 5),
  PRIMARY KEY (job_id, skill_id)
);

CREATE TABLE employment_record (
  employment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id     BIGINT NOT NULL REFERENCES person(person_id),
  employer_id   BIGINT REFERENCES employer(employer_id),
  job_title     VARCHAR(200),
  start_date    DATE,
  end_date      DATE
);

-- ---------- F. Documents & library (Projects 1 and 5) ----------
CREATE TABLE document (
  document_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_type      VARCHAR(20) NOT NULL CHECK (doc_type IN ('regulation','guide','admission_rule','form','research','book','correspondence','other')),
  title         VARCHAR(300) NOT NULL,
  owner_unit_id BIGINT REFERENCES admin_unit(unit_id),
  language      VARCHAR(2) DEFAULT 'ar',
  storage_uri   TEXT NOT NULL,
  ocr_text      TEXT,
  is_official   BOOLEAN NOT NULL DEFAULT FALSE,       -- only official sources feed the AI assistant
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- G. Audit ----------
CREATE TABLE audit_log (
  audit_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT REFERENCES app_user(user_id),
  action     VARCHAR(20) NOT NULL,
  table_name VARCHAR(60) NOT NULL,
  record_id  BIGINT,
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Indexes on common joins / filters ----------
CREATE INDEX ix_enrollment_section   ON enrollment(section_id);
CREATE INDEX ix_section_term         ON course_section(term_id, course_id);
CREATE INDEX ix_attendance_enroll    ON attendance(enrollment_id, session_date);
CREATE INDEX ix_meeting_room         ON section_meeting(room_id, day_of_week);
CREATE INDEX ix_request_status       ON service_request(status, opened_at);
CREATE INDEX ix_request_category     ON service_request(category_id);
CREATE INDEX ix_invoice_student      ON invoice(student_id, term_id);
CREATE INDEX ix_student_program      ON student_program(program_id);
CREATE INDEX ix_program_faculty      ON program(faculty_id);

-- ---------- NEW: Student status history (adopted from teammate's design) ----------
CREATE TABLE student_status_history (
    status_history_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id          BIGINT NOT NULL REFERENCES student(student_id),
    status               VARCHAR(30) NOT NULL,
    start_date          DATE NOT NULL,
    end_date            DATE,
    reason               VARCHAR(255)
);

-- ---------- NEW: Academic advising (adopted from teammate's design) ----------
CREATE TABLE academic_advisor (
    advisor_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    instructor_id    BIGINT NOT NULL REFERENCES instructor(staff_id),
    department_id    BIGINT NOT NULL REFERENCES department(department_id),
    status           VARCHAR(20) NOT NULL DEFAULT 'active'
);

CREATE TABLE student_advisor (
    student_advisor_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id           BIGINT NOT NULL REFERENCES student(student_id),
    advisor_id           BIGINT NOT NULL REFERENCES academic_advisor(advisor_id),
    start_date           DATE NOT NULL,
    end_date             DATE,
    status               VARCHAR(20) NOT NULL DEFAULT 'active'
);

CREATE TABLE advising_session (
    session_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id    BIGINT NOT NULL REFERENCES student(student_id),
    advisor_id    BIGINT NOT NULL REFERENCES academic_advisor(advisor_id),
    session_date  DATE NOT NULL,
    notes         TEXT,
    recommendations TEXT
);

-- ---------- NEW: Library (adopted from teammate's design — covers Project 5) ----------
CREATE TABLE library_book (
    book_id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    isbn               VARCHAR(20),
    title              VARCHAR(255) NOT NULL,
    author             VARCHAR(255),
    publisher          VARCHAR(150),
    category           VARCHAR(100),
    publication_year   SMALLINT,
    quantity           INT NOT NULL DEFAULT 1
);

CREATE TABLE library_borrowing (
    borrow_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    book_id       BIGINT NOT NULL REFERENCES library_book(book_id),
    person_id     BIGINT NOT NULL REFERENCES person(person_id),
    borrow_date   DATE NOT NULL,
    due_date      DATE NOT NULL,
    return_date   DATE,
    fine_status   VARCHAR(20) NOT NULL DEFAULT 'none'
);

-- ---------- NEW: Events (adopted from teammate's design) ----------
CREATE TABLE event (
    event_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_name    VARCHAR(200) NOT NULL,
    event_type    VARCHAR(50),
    event_date    DATE NOT NULL,
    location      VARCHAR(150),
    organizer     VARCHAR(150),
    description   TEXT,
    status        VARCHAR(20) NOT NULL DEFAULT 'scheduled'
);

CREATE TABLE event_participant (
    participant_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id            BIGINT NOT NULL REFERENCES event(event_id),
    person_id           BIGINT NOT NULL REFERENCES person(person_id),
    attendance_status   VARCHAR(20) NOT NULL DEFAULT 'registered'
);

-- ---------- NEW: Faculty workload + HR (adopted from teammate's design) ----------
CREATE TABLE faculty_workload (
    workload_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    instructor_id         BIGINT NOT NULL REFERENCES instructor(staff_id),
    term_id               BIGINT NOT NULL REFERENCES term(term_id),
    course_id             BIGINT NOT NULL REFERENCES course(course_id),
    teaching_hours        NUMERIC(5,2) NOT NULL DEFAULT 0,
    research_hours        NUMERIC(5,2) NOT NULL DEFAULT 0,
    administrative_hours  NUMERIC(5,2) NOT NULL DEFAULT 0
);

CREATE TABLE employee_attendance (
    employee_attendance_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    staff_id                 BIGINT NOT NULL REFERENCES staff(staff_id),
    attendance_date          DATE NOT NULL,
    check_in                 TIME,
    check_out                TIME,
    status                   VARCHAR(20) NOT NULL DEFAULT 'present'
);

CREATE TABLE leave_request (
    leave_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    staff_id      BIGINT NOT NULL REFERENCES staff(staff_id),
    leave_type    VARCHAR(30) NOT NULL,
    start_date    DATE NOT NULL,
    end_date      DATE NOT NULL,
    reason        VARCHAR(255),
    status        VARCHAR(20) NOT NULL DEFAULT 'pending'
);

-- ---------- NEW: Certificates (adopted from teammate's design) ----------
CREATE TABLE certificate (
    certificate_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    student_id           BIGINT NOT NULL REFERENCES student(student_id),
    certificate_type     VARCHAR(50) NOT NULL,
    certificate_number   VARCHAR(50) NOT NULL,
    issue_date           DATE NOT NULL,
    language             VARCHAR(20) NOT NULL DEFAULT 'ar',
    verification_code    VARCHAR(50) NOT NULL,
    status                VARCHAR(20) NOT NULL DEFAULT 'issued'
);
