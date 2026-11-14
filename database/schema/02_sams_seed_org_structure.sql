-- =====================================================================
-- SAMS seed data v0.1 - run AFTER sams_schema.sql
-- Source: official site sams.edu.eg (specialties page, FCI page, FLT degrees page, nav menu)
-- Items marked [CONFIRM] are assumptions to verify with the Academy.
-- =====================================================================

-- Campuses [CONFIRM against "عناوين الأكاديمية بالقاهرة والفروع" page]
INSERT INTO campus (code, name_ar, name_en, city, is_main) VALUES
 ('CAI','المقر الرئيسي - المعادي','Main Campus - Maadi','Cairo',TRUE),
 ('ALX','فرع الإسكندرية','Alexandria Branch','Alexandria',FALSE),
 ('TNT','فرع طنطا','Tanta Branch','Tanta',FALSE),
 ('PSD','فرع بورسعيد','Port Said Branch','Port Said',FALSE),
 ('MNY','فرع المنيا','Minya Branch','Minya',FALSE),
 ('AST','فرع أسيوط','Assiut Branch','Assiut',FALSE),
 ('DKR','فرع دكرنس','Dikirnis Branch','Dakahlia',FALSE);

INSERT INTO faculty (code, name_ar, name_en) VALUES
 ('FMS','كلية العلوم الإدارية','Faculty of Management Sciences'),
 ('FCI','كلية الحاسبات والمعلومات','Faculty of Computers and Information'),
 ('FLT','كلية اللغات والترجمة','Faculty of Languages and Translation');

-- FMS is offered at the main campus and all branches; FCI/FLT: main campus only [CONFIRM]
INSERT INTO faculty_campus (faculty_id, campus_id)
SELECT f.faculty_id, c.campus_id FROM faculty f CROSS JOIN campus c WHERE f.code = 'FMS'
UNION ALL
SELECT f.faculty_id, c.campus_id FROM faculty f JOIN campus c ON c.code = 'CAI' WHERE f.code IN ('FCI','FLT');

-- Departments. FCI and FLT departments are named on the site; FMS departments are
-- modelled one per major [CONFIRM the real scientific departments].
INSERT INTO department (faculty_id, code, name_ar, name_en)
SELECT f.faculty_id, v.code, v.name_ar, v.name_en
FROM (VALUES
 ('FMS','FMS-BA','إدارة الأعمال','Business Administration'),
 ('FMS','FMS-HRM','إدارة الموارد البشرية','Human Resources Management'),
 ('FMS','FMS-MIS','نظم المعلومات الإدارية','Management Information Systems'),
 ('FMS','FMS-ECO','الاقتصاد','Economics'),
 ('FMS','FMS-ACC','المحاسبة','Accounting'),
 ('FMS','FMS-PLA','الإدارة العامة والمحلية','Public and Local Administration'),
 ('FMS','FMS-ACT','العلوم الاكتوارية','Actuarial Sciences'),
 ('FMS','FMS-IBM','إدارة الأعمال الدولية','International Business Management'),
 ('FMS','FMS-BIS','نظم معلومات الأعمال','Business Information Systems'),
 ('FCI','FCI-CS','قسم علوم الحاسب','Computer Sciences'),
 ('FCI','FCI-IS','قسم نظم المعلومات','Information Systems'),
 ('FCI','FCI-SE','قسم هندسة البرمجيات','Software Engineering'),
 ('FLT','FLT-EN','قسم اللغة الإنجليزية','English Language'),
 ('FLT','FLT-ZH','قسم اللغة الصينية','Chinese Language'),
 ('FLT','FLT-ES','قسم اللغة الإسبانية','Spanish Language')
) AS v(fac, code, name_ar, name_en)
JOIN faculty f ON f.code = v.fac;

-- Programs. FMS majors = 48 credit hours each (major requirement only, so total left NULL).
-- FLT licence = 144 credit hours (stated on site). FMS postgraduate programs are faculty-level.
INSERT INTO program (faculty_id, department_id, code, name_ar, name_en, degree_level, program_type, teaching_language, total_credit_hours)
SELECT f.faculty_id, d.department_id, v.code, v.name_ar, v.name_en, v.lvl, v.ptype, v.lang, v.credits
FROM (VALUES
 ('FMS','FMS-BA','BSC-BA','بكالوريوس إدارة الأعمال','BSc Business Administration','bachelor','academic','ar',NULL::smallint),
 ('FMS','FMS-HRM','BSC-HRM','بكالوريوس إدارة الموارد البشرية','BSc Human Resources Management','bachelor','academic','ar',NULL),
 ('FMS','FMS-MIS','BSC-MIS','بكالوريوس نظم المعلومات الإدارية','BSc Management Information Systems','bachelor','academic','ar',NULL),
 ('FMS','FMS-ECO','BSC-ECO','بكالوريوس الاقتصاد','BSc Economics','bachelor','academic','ar',NULL),
 ('FMS','FMS-ACC','BSC-ACC','بكالوريوس المحاسبة','BSc Accounting','bachelor','academic','ar',NULL),
 ('FMS','FMS-PLA','BSC-PLA','بكالوريوس الإدارة العامة والمحلية','BSc Public and Local Administration','bachelor','academic','ar',NULL),
 ('FMS','FMS-ACT','BSC-ACT','بكالوريوس العلوم الاكتوارية','BSc Actuarial Sciences','bachelor','academic','ar',NULL),
 ('FMS','FMS-IBM','BSC-IBM','بكالوريوس إدارة الأعمال الدولية (الشعبة الإنجليزية)','BSc International Business Management','bachelor','academic','en',NULL),
 ('FMS','FMS-BIS','BSC-BIS','بكالوريوس نظم معلومات الأعمال (الشعبة الإنجليزية)','BSc Business Information Systems','bachelor','academic','en',NULL),
 ('FCI','FCI-CS','BSC-CS','بكالوريوس علوم الحاسب','BSc Computer Sciences','bachelor','academic','ar',NULL),
 ('FCI','FCI-IS','BSC-IS','بكالوريوس نظم المعلومات','BSc Information Systems','bachelor','academic','ar',NULL),
 ('FCI','FCI-SE','BSC-SE','بكالوريوس هندسة البرمجيات','BSc Software Engineering','bachelor','academic','ar',NULL),
 ('FLT','FLT-EN','LIC-EN','ليسانس اللغة الإنجليزية','Licence in English Language','bachelor','academic','ar',144),
 ('FLT','FLT-ZH','LIC-ZH','ليسانس اللغة الصينية','Licence in Chinese Language','bachelor','academic','ar',144),
 ('FLT','FLT-ES','LIC-ES','ليسانس اللغة الإسبانية','Licence in Spanish Language','bachelor','academic','ar',144),
 ('FMS',NULL,'PHD','دكتوراة الفلسفة','PhD','doctorate','academic','ar',NULL),
 ('FMS',NULL,'MSC','الماجستير الأكاديمي','MSc','master','academic','ar',NULL),
 ('FMS',NULL,'DBA','الدكتوراه المهنية في إدارة الأعمال','Doctor of Business Administration (DBA)','doctorate','professional','ar',NULL),
 ('FMS',NULL,'MBA','الماجستير المهني في إدارة الأعمال','Master of Business Administration (MBA)','master','professional','ar',NULL),
 ('FMS',NULL,'MPA','الماجستير المهني في المحاسبة','Professional Master in Accounting (MPA)','master','professional','ar',NULL),
 ('FMS',NULL,'PGD','دبلومات الدراسات العليا','Postgraduate Diplomas','diploma','academic','ar',NULL)
) AS v(fac, dept, code, name_ar, name_en, lvl, ptype, lang, credits)
JOIN faculty f ON f.code = v.fac
LEFT JOIN department d ON d.code = v.dept;

-- Tracks: Business Administration has four tracks (official site)
INSERT INTO track (program_id, code, name_ar, name_en)
SELECT p.program_id, v.code, v.name_ar, v.name_en
FROM (VALUES
 ('BSC-BA','BA-FIN','التمويل والاستثمار','Finance and Investment'),
 ('BSC-BA','BA-MKT','التسويق والتجارة الإلكترونية','Marketing and E-Commerce'),
 ('BSC-BA','BA-BNK','إدارة البنوك','Bank Management'),
 ('BSC-BA','BA-OIL','إدارة المنشآت البترولية والطاقة','Petroleum Facilities and Energy Management')
) AS v(prog, code, name_ar, name_en)
JOIN program p ON p.code = v.prog;

-- Administrative units: centers and the foreign-students office are on the site;
-- the last four are generic PLACEHOLDERS needed for complaint routing [CONFIRM]
INSERT INTO admin_unit (campus_id, code, name_ar, name_en, unit_type)
SELECT c.campus_id, v.code, v.name_ar, v.name_en, v.utype
FROM (VALUES
 ('CRDC','مركز الاستشارات والبحوث والتطوير','Consultancy, Research and Development Center','center'),
 ('TRN','مركز التدريب','Training Center','center'),
 ('RYC','مركز الجمهورية الجديدة','New Republic Center','center'),
 ('WAF','إدارة الوافدين','International Students Administration','administration'),
 ('STU','إدارة شئون الطلاب','Student Affairs','administration'),
 ('REG','إدارة التسجيل وشئون التعليم','Registration and Education Affairs','administration'),
 ('FIN','الإدارة المالية','Finance Administration','administration'),
 ('ITS','إدارة تكنولوجيا المعلومات','IT Administration','administration')
) AS v(code, name_ar, name_en, utype)
CROSS JOIN campus c WHERE c.code = 'CAI';
