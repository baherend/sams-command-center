-- =====================================================================
-- 07b: Arabic descriptions for the columns of the 3 report views
-- Adds descriptions only. Run after 05 and 07. Safe to run more than once.
-- Re-run after any rebuild of the views (a DROP VIEW removes descriptions).
-- =====================================================================

COMMENT ON COLUMN president_office.report_monthly_volume.section_id IS 'قسم المكتب المختص (يرجع لجدول office_departments)';

COMMENT ON COLUMN president_office.report_response_time.transaction_id IS 'الرقم الداخلي للمعاملة';
COMMENT ON COLUMN president_office.report_response_time.archive_year IS 'سنة الأرشيف';
COMMENT ON COLUMN president_office.report_response_time.section_id IS 'قسم المكتب المختص (يرجع لجدول office_departments)';
COMMENT ON COLUMN president_office.report_response_time.from_party_id IS 'الجهة المرسلة (يرجع لجدول transaction_parties)';
COMMENT ON COLUMN president_office.report_response_time.incoming_date IS 'تاريخ الوارد';
COMMENT ON COLUMN president_office.report_response_time.is_historical IS 'معاملة قديمة مرحّلة، تُستبعد عند حساب متوسط زمن الرد';

COMMENT ON COLUMN president_office.report_waiting_for_reply.transaction_id IS 'الرقم الداخلي للمعاملة';
COMMENT ON COLUMN president_office.report_waiting_for_reply.archive_year IS 'سنة الأرشيف';
COMMENT ON COLUMN president_office.report_waiting_for_reply.incoming_no IS 'رقم الوارد';
COMMENT ON COLUMN president_office.report_waiting_for_reply.incoming_date IS 'تاريخ الوارد';
COMMENT ON COLUMN president_office.report_waiting_for_reply.section_id IS 'قسم المكتب المختص (يرجع لجدول office_departments)';
COMMENT ON COLUMN president_office.report_waiting_for_reply.from_party_id IS 'الجهة المرسلة (يرجع لجدول transaction_parties)';
COMMENT ON COLUMN president_office.report_waiting_for_reply.subject IS 'موضوع المعاملة (نص حر). قد يحتوي بيانات حساسة';
COMMENT ON COLUMN president_office.report_waiting_for_reply.needs_followup IS 'هل تحتاج متابعة';
COMMENT ON COLUMN president_office.report_waiting_for_reply.is_postponed IS 'هل المعاملة مؤجلة';