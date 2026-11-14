-- =====================================================================
-- SAMS sample (fake) transactional data — run AFTER sams_schema.sql +
-- new_tables.sql + sams_seed.sql (real org structure)
-- Purpose: small illustrative dataset to run the dashboard demo.
-- ALL people/transactional data below is FAKE, for demo purposes only.
-- =====================================================================

-- ---------- Academic calendar ----------
INSERT INTO academic_year (label, start_date, end_date) VALUES
 ('2024/2025', '2024-09-01', '2025-06-30'),
 ('2025/2026', '2025-09-01', '2026-06-30');

INSERT INTO term (year_id, term_name, start_date, end_date, registration_start, registration_end)
SELECT y.year_id, v.term_name, v.start_date, v.end_date, v.reg_start, v.reg_end
FROM (VALUES
 ('2024/2025','first','2024-09-15'::date,'2025-01-15'::date,'2024-09-01'::date,'2024-09-14'::date),
 ('2025/2026','first','2025-09-15'::date,'2026-01-15'::date,'2025-09-01'::date,'2025-09-14'::date)
) AS v(year_label, term_name, start_date, end_date, reg_start, reg_end)
JOIN academic_year y ON y.label = v.year_label;

-- ---------- People (FAKE demo identities) ----------
INSERT INTO person (national_id, first_name_ar, last_name_ar, first_name_en, last_name_en, gender, birth_date, nationality, email, phone) VALUES
 ('29901010100011','أحمد','السيد','Ahmed','Al-Sayed','M','1999-01-01','Egyptian','ahmed.elsayed.demo@example.com','01000000001'),
 ('30002020200022','مريم','فتحي','Mariam','Fathy','F','2000-02-02','Egyptian','mariam.fathy.demo@example.com','01000000002'),
 ('30103030300033','يوسف','كامل','Youssef','Kamel','M','2001-03-03','Egyptian','youssef.kamel.demo@example.com','01000000003'),
 ('30204040400044','نور','عبدالله','Nour','Abdallah','F','2002-04-04','Egyptian','nour.abdallah.demo@example.com','01000000004'),
 ('28505050500055','محمد','الشريف','Mohamed','El-Sherif','M','1985-05-05','Egyptian','mohamed.elsherif.demo@example.com','01000000005'),
 ('28806060600066','هبة','راغب','Heba','Ragheb','F','1988-06-06','Egyptian','heba.ragheb.demo@example.com','01000000006'),
 ('28007070700077','كريم','عادل','Karim','Adel','M','1980-07-07','Egyptian','karim.adel.demo@example.com','01000000007');

-- ---------- Roles ----------
INSERT INTO role (code, name_ar) VALUES
 ('student','طالب'),
 ('instructor','عضو هيئة تدريس'),
 ('advisor','مرشد أكاديمي'),
 ('admin','إداري'),
 ('executive','قيادة تنفيذية');

-- ---------- App users (one per person, demo credentials) ----------
INSERT INTO app_user (person_id, username, password_hash, is_active)
SELECT p.person_id, v.username, 'demo_hash_not_real', TRUE
FROM (VALUES
 ('29901010100011','ahmed.elsayed'),
 ('30002020200022','mariam.fathy'),
 ('30103030300033','youssef.kamel'),
 ('30204040400044','nour.abdallah'),
 ('28505050500055','mohamed.elsherif'),
 ('28806060600066','heba.ragheb'),
 ('28007070700077','karim.adel')
) AS v(national_id, username)
JOIN person p ON p.national_id = v.national_id;

INSERT INTO user_role (user_id, role_id)
SELECT u.user_id, r.role_id FROM (VALUES
 ('ahmed.elsayed','student'),('mariam.fathy','student'),
 ('youssef.kamel','student'),('nour.abdallah','student'),
 ('mohamed.elsherif','instructor'),('mohamed.elsherif','advisor'),
 ('heba.ragheb','instructor'),
 ('karim.adel','admin')
) AS v(username, role_code)
JOIN app_user u ON u.username = v.username
JOIN role r ON r.code = v.role_code;

-- ---------- Staff & instructors ----------
INSERT INTO staff (person_id, staff_code, department_id, admin_unit_id, campus_id, staff_type, hire_date, status)
SELECT p.person_id, v.staff_code, d.department_id, NULL, c.campus_id, v.staff_type, v.hire_date, 'active'
FROM (VALUES
 ('28505050500055','STF-001','FCI-CS','CAI','faculty_member','2015-09-01'::date),
 ('28806060600066','STF-002','FCI-CS','CAI','faculty_member','2018-09-01'::date)
) AS v(national_id, staff_code, dept_code, campus_code, staff_type, hire_date)
JOIN person p ON p.national_id = v.national_id
JOIN department d ON d.code = v.dept_code
JOIN campus c ON c.code = v.campus_code;

INSERT INTO staff (person_id, staff_code, department_id, admin_unit_id, campus_id, staff_type, hire_date, status)
SELECT p.person_id, 'STF-003', NULL, au.unit_id, c.campus_id, 'administrative', '2019-01-15', 'active'
FROM person p JOIN admin_unit au ON au.code = 'STU' JOIN campus c ON c.code = 'CAI'
WHERE p.national_id = '28007070700077';

INSERT INTO instructor (staff_id, academic_rank, specialization, max_weekly_load_hours)
SELECT s.staff_id, v.rank, v.spec, 12
FROM (VALUES ('STF-001','associate_professor','هندسة البرمجيات'), ('STF-002','assistant_professor','قواعد البيانات')) AS v(staff_code, rank, spec)
JOIN staff s ON s.staff_code = v.staff_code;

UPDATE faculty SET dean_staff_id = (SELECT staff_id FROM staff WHERE staff_code = 'STF-001')
WHERE code = 'FCI';
UPDATE department SET head_staff_id = (SELECT staff_id FROM staff WHERE staff_code = 'STF-002')
WHERE code = 'FCI-CS';

-- ---------- Students ----------
INSERT INTO student (person_id, student_code, campus_id, admission_year_id, advisor_staff_id, status)
SELECT p.person_id, v.student_code, c.campus_id, y.year_id,
       (SELECT staff_id FROM staff WHERE staff_code = 'STF-001'), v.status
FROM (VALUES
 ('29901010100011','20230001','CAI','2024/2025','active'),
 ('30002020200022','20230002','CAI','2024/2025','active'),
 ('30103030300033','20220015','CAI','2024/2025','graduated'),
 ('30204040400044','20240050','CAI','2025/2026','active')
) AS v(national_id, student_code, campus_code, year_label, status)
JOIN person p ON p.national_id = v.national_id
JOIN campus c ON c.code = v.campus_code
JOIN academic_year y ON y.label = v.year_label;

INSERT INTO student_program (student_id, program_id, program_role, start_term_id, is_current)
SELECT st.student_id, pr.program_id, 'primary', t.term_id, TRUE
FROM (VALUES
 ('20230001','BSC-CS','2024/2025'),
 ('30002020200022'::text,'BSC-CS','2024/2025'),  -- placeholder not used, corrected below
 ('20220015','BSC-CS','2024/2025'),
 ('20240050','BSC-BA','2025/2026')
) AS v(student_code, prog_code, year_label)
JOIN student st ON st.student_code = v.student_code
JOIN program pr ON pr.code = v.prog_code
JOIN academic_year y ON y.label = v.year_label
JOIN term t ON t.year_id = y.year_id AND t.term_name = 'first'
WHERE v.student_code <> '30002020200022';

INSERT INTO student_program (student_id, program_id, program_role, start_term_id, is_current)
SELECT st.student_id, pr.program_id, 'primary', t.term_id, TRUE
FROM student st
JOIN program pr ON pr.code = 'BSC-CS'
JOIN academic_year y ON y.label = '2024/2025'
JOIN term t ON t.year_id = y.year_id AND t.term_name = 'first'
WHERE st.student_code = '20230002';

-- ---------- Admission applications ----------
INSERT INTO admission_application (person_id, program_id, campus_id, year_id, certificate_type, score_percent, status)
SELECT p.person_id, pr.program_id, c.campus_id, y.year_id, 'thanaweya_amma', v.score, 'enrolled'
FROM (VALUES
 ('29901010100011','BSC-CS','CAI','2024/2025',92.5),
 ('30002020200022','BSC-CS','CAI','2024/2025',88.0),
 ('30103030300033','BSC-CS','CAI','2024/2025',95.0),
 ('30204040400044','BSC-BA','CAI','2025/2026',85.5)
) AS v(national_id, prog_code, campus_code, year_label, score)
JOIN person p ON p.national_id = v.national_id
JOIN program pr ON pr.code = v.prog_code
JOIN campus c ON c.code = v.campus_code
JOIN academic_year y ON y.label = v.year_label;

-- ---------- Facilities ----------
INSERT INTO building (campus_id, code, name_ar)
SELECT c.campus_id, 'B1', 'المبنى الرئيسي' FROM campus c WHERE c.code = 'CAI';

INSERT INTO room (building_id, code, room_type, capacity)
SELECT b.building_id, v.code, v.rtype, v.cap
FROM (VALUES ('R101','lecture_hall',60), ('LAB1','lab',30)) AS v(code, rtype, cap)
JOIN building b ON b.code = 'B1';

-- ---------- Courses ----------
INSERT INTO course (department_id, code, name_ar, name_en, credit_hours, lecture_hours, lab_hours)
SELECT d.department_id, v.code, v.name_ar, v.name_en, v.ch, v.lh, v.labh
FROM (VALUES
 ('CS101','مقدمة في البرمجة','Introduction to Programming',3,2,2),
 ('CS201','هياكل البيانات','Data Structures',3,3,0),
 ('CS301','قواعد البيانات','Databases',3,2,2)
) AS v(code, name_ar, name_en, ch, lh, labh)
JOIN department d ON d.code = 'FCI-CS';

INSERT INTO program_course (program_id, course_id, level_no, term_no, course_type)
SELECT pr.program_id, c.course_id, 1, 1, 'required'
FROM program pr JOIN course c ON c.code IN ('CS101','CS201','CS301')
WHERE pr.code = 'BSC-CS';

-- ---------- Course sections & meetings ----------
INSERT INTO course_section (course_id, term_id, campus_id, section_no, instructor_staff_id, capacity, status)
SELECT c.course_id, t.term_id, cmp.campus_id, 1, s.staff_id, 30, 'open'
FROM (VALUES ('CS101','STF-001'), ('CS301','STF-002')) AS v(course_code, staff_code)
JOIN course c ON c.code = v.course_code
JOIN staff s ON s.staff_code = v.staff_code
JOIN academic_year y ON y.label = '2025/2026'
JOIN term t ON t.year_id = y.year_id AND t.term_name = 'first'
JOIN campus cmp ON cmp.code = 'CAI';

INSERT INTO section_meeting (section_id, room_id, day_of_week, start_time, end_time)
SELECT cs.section_id, r.room_id, v.dow, v.st::time, v.et::time
FROM (VALUES ('CS101',0,'09:00','11:00'), ('CS301',2,'11:00','13:00')) AS v(course_code, dow, st, et)
JOIN course c ON c.code = v.course_code
JOIN course_section cs ON cs.course_id = c.course_id
JOIN room r ON r.code = 'R101';

-- ---------- Enrollment, grades, attendance ----------
INSERT INTO enrollment (student_id, section_id, status)
SELECT st.student_id, cs.section_id, 'completed'
FROM (VALUES ('20230001','CS101'), ('20230002','CS101'), ('20230001','CS301')) AS v(student_code, course_code)
JOIN student st ON st.student_code = v.student_code
JOIN course c ON c.code = v.course_code
JOIN course_section cs ON cs.course_id = c.course_id;

INSERT INTO grade_scale (letter_grade, min_score, max_score, grade_points) VALUES
 ('A',  93, 100, 4.00), ('A-', 90, 92.9, 3.70), ('B+', 87, 89.9, 3.30),
 ('B',  83, 86.9, 3.00), ('B-', 80, 82.9, 2.70), ('C+', 77, 79.9, 2.30),
 ('C',  70, 76.9, 2.00), ('F',  0, 69.9, 0.00);

INSERT INTO grade (enrollment_id, coursework_score, midterm_score, final_score, total_score, letter_grade, grade_points, is_final, graded_by)
SELECT e.enrollment_id, 18, 28, 42, 88, 'B+', 3.30, TRUE, s.staff_id
FROM enrollment e
JOIN course_section cs ON cs.section_id = e.section_id
JOIN course c ON c.course_id = cs.course_id AND c.code = 'CS101'
JOIN student st ON st.student_id = e.student_id AND st.student_code = '20230001'
JOIN staff s ON s.staff_code = 'STF-001';

INSERT INTO term_result (student_id, term_id, credits_attempted, credits_earned, term_gpa, cumulative_gpa, academic_standing)
SELECT st.student_id, t.term_id, 6, 6, 3.30, 3.30, 'good'
FROM student st
JOIN academic_year y ON y.label = '2025/2026'
JOIN term t ON t.year_id = y.year_id AND t.term_name = 'first'
WHERE st.student_code = '20230001';

INSERT INTO attendance (enrollment_id, meeting_id, session_date, status, method)
SELECT e.enrollment_id, m.meeting_id, '2025-09-22', 'present', 'smart_card'
FROM enrollment e
JOIN course_section cs ON cs.section_id = e.section_id
JOIN course c ON c.course_id = cs.course_id AND c.code = 'CS101'
JOIN student st ON st.student_id = e.student_id AND st.student_code = '20230001'
JOIN section_meeting m ON m.section_id = cs.section_id;

-- ---------- Finance ----------
INSERT INTO fee_item (program_id, name_ar, amount)
SELECT pr.program_id, 'رسوم الفصل الدراسي', 15000.00 FROM program pr WHERE pr.code = 'BSC-CS';

INSERT INTO invoice (student_id, term_id, total_amount, due_date, status)
SELECT st.student_id, t.term_id, 15000.00, '2025-10-01', 'partial'
FROM student st
JOIN academic_year y ON y.label = '2025/2026'
JOIN term t ON t.year_id = y.year_id AND t.term_name = 'first'
WHERE st.student_code = '20230001';

INSERT INTO payment (invoice_id, amount, method, reference)
SELECT i.invoice_id, 10000.00, 'bank_transfer', 'TRX-DEMO-001'
FROM invoice i JOIN student st ON st.student_id = i.student_id WHERE st.student_code = '20230001';

-- ---------- Service requests / complaints (Project 3) ----------
INSERT INTO service_category (code, name_ar, default_unit_id, sla_hours)
SELECT v.code, v.name_ar, au.unit_id, v.sla
FROM (VALUES ('CERT_REQ','طلب إصدار شهادة','REG',48), ('ACAD_COMPLAINT','شكوى أكاديمية','STU',24))
  AS v(code, name_ar, unit_code, sla)
JOIN admin_unit au ON au.code = v.unit_code;

INSERT INTO service_request (person_id, category_id, assigned_unit_id, request_type, channel, subject, body, sentiment_label, priority, status)
SELECT p.person_id, sc.category_id, sc.default_unit_id, 'complaint', 'app', 'تأخير في اعتماد الدرجات', 'في تأخير في اعتماد درجاتي من الكنترول.', 'negative', 'high', 'open'
FROM person p JOIN service_category sc ON sc.code = 'ACAD_COMPLAINT'
WHERE p.national_id = '29901010100011';

INSERT INTO request_event (request_id, actor_user_id, event_type, note)
SELECT sr.request_id, u.user_id, 'created', 'تم فتح الشكوى'
FROM service_request sr
JOIN person p ON p.person_id = sr.person_id
JOIN app_user u ON u.person_id = p.person_id;

-- ---------- Graduation, employers, skills (Project 4) ----------
INSERT INTO graduation (student_id, program_id, term_id, graduation_date, final_gpa, honors)
SELECT st.student_id, pr.program_id, t.term_id, '2025-01-10', 3.55, 'honors'
FROM student st
JOIN program pr ON pr.code = 'BSC-CS'
JOIN academic_year y ON y.label = '2024/2025'
JOIN term t ON t.year_id = y.year_id AND t.term_name = 'first'
WHERE st.student_code = '20220015';

INSERT INTO employer (name, sector, city, contact_email) VALUES
 ('شركة ديموداتا للحلول الرقمية', 'تكنولوجيا المعلومات', 'Cairo', 'hr@demodata.example'),
 ('بنك المثال', 'الخدمات المصرفية', 'Cairo', 'careers@examplebank.example');

INSERT INTO skill (name, category) VALUES
 ('Python', 'برمجة'), ('SQL', 'بيانات'), ('Power BI', 'تحليل بيانات'), ('English', 'لغات');

INSERT INTO person_skill (person_id, skill_id, level, source)
SELECT p.person_id, sk.skill_id, 4, 'course'
FROM person p JOIN skill sk ON sk.name IN ('Python','SQL')
WHERE p.national_id = '30103030300033';

INSERT INTO job_posting (employer_id, title, job_type, description)
SELECT e.employer_id, 'محلل بيانات مبتدئ', 'full_time', 'وظيفة شاغرة لخريجي علوم الحاسب'
FROM employer e WHERE e.name = 'شركة ديموداتا للحلول الرقمية';

INSERT INTO job_skill (job_id, skill_id, required_level)
SELECT j.job_id, sk.skill_id, 3
FROM job_posting j JOIN skill sk ON sk.name = 'SQL'
WHERE j.title = 'محلل بيانات مبتدئ';

INSERT INTO employment_record (person_id, employer_id, job_title, start_date)
SELECT p.person_id, e.employer_id, 'محلل بيانات', '2025-02-01'
FROM person p, employer e
WHERE p.national_id = '30103030300033' AND e.name = 'شركة ديموداتا للحلول الرقمية';

-- ---------- Documents ----------
INSERT INTO document (doc_type, title, owner_unit_id, language, storage_uri, is_official)
SELECT 'admission_rule', 'لائحة القبول والتسجيل', au.unit_id, 'ar', 'demo://docs/admission-rules.pdf', TRUE
FROM admin_unit au WHERE au.code = 'REG';

-- ---------- Audit log ----------
INSERT INTO audit_log (user_id, action, table_name, record_id, details)
SELECT u.user_id, 'UPDATE', 'service_request', sr.request_id, '{"field":"status","demo":true}'::jsonb
FROM service_request sr
JOIN person p ON p.person_id = sr.person_id
JOIN app_user u ON u.person_id = p.person_id;

-- =====================================================================
-- NEW tables (merged from teammate's design, v2)
-- =====================================================================

INSERT INTO student_status_history (student_id, status, start_date, reason)
SELECT st.student_id, 'active', y.start_date, 'بداية القيد'
FROM student st JOIN academic_year y ON y.year_id = st.admission_year_id;

INSERT INTO academic_advisor (instructor_id, department_id, status)
SELECT s.staff_id, d.department_id, 'active'
FROM staff s JOIN department d ON d.code = 'FCI-CS'
WHERE s.staff_code = 'STF-001';

INSERT INTO student_advisor (student_id, advisor_id, start_date, status)
SELECT st.student_id, aa.advisor_id, '2024-09-15', 'active'
FROM student st, academic_advisor aa
WHERE st.student_code IN ('20230001','20230002');

INSERT INTO advising_session (student_id, advisor_id, session_date, notes, recommendations)
SELECT st.student_id, aa.advisor_id, '2025-10-01', 'مناقشة خطة التسجيل للفصل القادم', 'التسجيل في CS301 الفصل القادم'
FROM student st, academic_advisor aa
WHERE st.student_code = '20230001';

INSERT INTO library_book (isbn, title, author, publisher, category, publication_year, quantity) VALUES
 ('978-0001','مقدمة في علوم الحاسب','فريق تأليف تجريبي','دار النشر التجريبية','حاسبات',2022,5),
 ('978-0002','أساسيات قواعد البيانات','فريق تأليف تجريبي','دار النشر التجريبية','حاسبات',2021,3),
 ('978-0003','مهارات الكتابة الأكاديمية','فريق تأليف تجريبي','دار النشر التجريبية','لغات',2020,4);

INSERT INTO library_borrowing (book_id, person_id, borrow_date, due_date)
SELECT b.book_id, p.person_id, '2025-09-20', '2025-10-04'
FROM library_book b, person p
WHERE b.isbn = '978-0001' AND p.national_id = '29901010100011';

INSERT INTO event (event_name, event_type, event_date, location, organizer, status) VALUES
 ('يوم التوظيف السنوي', 'career_fair', '2025-11-10', 'المبنى الرئيسي', 'إدارة شئون الطلاب', 'scheduled'),
 ('ورشة مقدمة في تحليل البيانات', 'workshop', '2025-10-20', 'معمل الحاسبات', 'قسم علوم الحاسب', 'scheduled');

INSERT INTO event_participant (event_id, person_id, attendance_status)
SELECT ev.event_id, p.person_id, 'registered'
FROM event ev, person p
WHERE ev.event_name = 'ورشة مقدمة في تحليل البيانات' AND p.national_id = '30103030300033';

INSERT INTO faculty_workload (instructor_id, term_id, course_id, teaching_hours, research_hours, administrative_hours)
SELECT s.staff_id, t.term_id, c.course_id, 6, 4, 2
FROM staff s
JOIN academic_year y ON y.label = '2025/2026'
JOIN term t ON t.year_id = y.year_id AND t.term_name = 'first'
JOIN course c ON c.code = 'CS101'
WHERE s.staff_code = 'STF-001';

INSERT INTO employee_attendance (staff_id, attendance_date, check_in, check_out, status)
SELECT s.staff_id, '2025-09-22', '08:55', '16:10', 'present'
FROM staff s WHERE s.staff_code = 'STF-001';

INSERT INTO leave_request (staff_id, leave_type, start_date, end_date, reason, status)
SELECT s.staff_id, 'annual', '2025-12-20', '2025-12-25', 'إجازة سنوية', 'pending'
FROM staff s WHERE s.staff_code = 'STF-002';

INSERT INTO certificate (student_id, certificate_type, certificate_number, issue_date, verification_code, status)
SELECT st.student_id, 'graduation', 'CERT-2025-0001', '2025-02-01', 'VER-DEMO-0001', 'issued'
FROM student st WHERE st.student_code = '20220015';
