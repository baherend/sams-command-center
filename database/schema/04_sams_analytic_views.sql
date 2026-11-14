-- ---------- H. Analytic views for the Command Center (Project 6) ----------
CREATE VIEW v_enrollment_by_dept_term AS
SELECT s.term_id, s.campus_id, c.department_id,
       COUNT(DISTINCT e.student_id) AS students,
       COUNT(*)                     AS registrations
FROM enrollment e
JOIN course_section s ON s.section_id = e.section_id
JOIN course c         ON c.course_id  = s.course_id
WHERE e.status IN ('registered','completed')
GROUP BY s.term_id, s.campus_id, c.department_id;

CREATE VIEW v_room_utilization AS
SELECT s.term_id, m.room_id, r.capacity,
       SUM(EXTRACT(EPOCH FROM (m.end_time - m.start_time)) / 3600) AS weekly_hours_booked
FROM section_meeting m
JOIN course_section s ON s.section_id = m.section_id
JOIN room r           ON r.room_id    = m.room_id
WHERE s.status <> 'cancelled'
GROUP BY s.term_id, m.room_id, r.capacity;

CREATE VIEW v_student_attendance_rate AS
SELECT e.student_id, s.term_id,
       ROUND(100.0 * COUNT(*) FILTER (WHERE a.status IN ('present','late','excused')) / NULLIF(COUNT(*),0), 1) AS attendance_pct
FROM attendance a
JOIN enrollment e     ON e.enrollment_id = a.enrollment_id
JOIN course_section s ON s.section_id    = e.section_id
GROUP BY e.student_id, s.term_id;
