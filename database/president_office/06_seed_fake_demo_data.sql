-- =====================================================================
-- FAKE demo data for president_office (Codex table names) (no real Academy records).
-- Subjects are generated from generic templates; senders/receivers are
-- generic positions, not real people. Deterministic (setseed).
-- Run after 05_fix_office_views.sql
-- =====================================================================
SELECT setseed(0.42);

INSERT INTO president_office.office_departments(code, name_ar) VALUES
 ('CONTRACTS',  'عقود واتفاقيات'),
 ('FIN_REWARDS','المكافآت والمستحقات المالية'),
 ('EXPAT',      'إدارة الوافدين'),
 ('TRAINING',   'التدريب والتعاون'),
 ('MAINT',      'الصيانة والخدمات'),
 ('ACADEMIC',   'الشؤون الأكاديمية');

INSERT INTO president_office.decision_types(code, name_ar, closes_item) VALUES
 ('APPROVED','موافقة',FALSE),
 ('FILE','حفظ',TRUE),
 ('LETTER','لإعداد خطاب',FALSE),
 ('STUDY','للدراسة والعرض',FALSE),
 ('POSTPONE','تأجيل',FALSE),
 ('REJECT','رفض',TRUE);

INSERT INTO president_office.outside_contacts(name_ar, entity_type) VALUES
 ('وزارة الاتصالات وتكنولوجيا المعلومات','ministry'),
 ('جهة حكومية (تجريبية)','government_body'),
 ('جامعة (تجريبية)','university'),
 ('شركة (تجريبية)','company');

INSERT INTO president_office.transaction_parties(party_kind, label_ar, external_id)
SELECT 'external', name_ar, external_id FROM president_office.outside_contacts;

INSERT INTO president_office.transaction_parties(party_kind, label_ar) VALUES
 ('faculty','عميد كلية العلوم الإدارية'),
 ('faculty','عميد كلية الحاسبات والمعلومات'),
 ('faculty','عميد كلية اللغات والترجمة'),
 ('admin_unit','الأمين العام'),
 ('admin_unit','مدير عام الشؤون المالية'),
 ('admin_unit','مدير عام الدراسات العليا'),
 ('admin_unit','مدير عام الوحدة'),
 ('unresolved','جهة غير محددة (تجريبي)');

DO $$
DECLARE
  n_parties INT; n_sections INT; n_dir INT;
  i INT; cid BIGINT; d DATE; resp INT; yr INT;
  subjects TEXT[] := ARRAY[
    'مذكرة بشأن طلب صرف مكافأة أبحاث التخرج لطلبة الكلية',
    'طلب الموافقة على تجديد عقد صيانة الأجهزة',
    'مذكرة بشأن تدريب مجموعة من الطلاب على مشروعات حقيقية',
    'طلب الموافقة على بروتوكول تعاون مع جهة خارجية',
    'مذكرة بشأن استعانة بأحد العاملين للعمل بإدارة أخرى',
    'طلب اتخاذ اللازم نحو إصلاح عطل بأحد المباني',
    'مذكرة بشأن مقابلة تقييم لعدد من المتقدمين',
    'شكوى مقدمة بشأن رسوم دراسية (نص تجريبي)',
    'طلب تعديل جدول الامتحانات بسبب ظرف طارئ',
    'مذكرة بشأن مقارنة المراجعة والتحليل الإحصائي للفترة'];
BEGIN
  SELECT COUNT(*) INTO n_parties  FROM president_office.transaction_parties;
  SELECT COUNT(*) INTO n_sections FROM president_office.office_departments;
  SELECT COUNT(*) INTO n_dir      FROM president_office.decision_types;

  FOR i IN 1..400 LOOP
    d  := DATE '2023-01-01' + (random() * 1409)::int;       -- up to 2026-11-05
    yr := EXTRACT(year FROM d)::int;

    INSERT INTO president_office.transactions
      (archive_year, section_id, incoming_no, incoming_date, from_party_id, subject,
       directive_id, page_no, has_original, needs_followup, is_postponed, is_recurring,
       status, registered_at)
    VALUES
      (yr,
       1 + (random() * (n_sections-1))::int,
       (1000 + i)::text,
       d,
       1 + (random() * (n_parties-1))::int,
       subjects[1 + (random() * (array_length(subjects,1)-1))::int],
       1 + (random() * (n_dir-1))::int,
       1 + (random() * 200)::int,
       random() < 0.3,
       random() < 0.08,
       random() < 0.05,
       random() < 0.07,
       'registered',
       d::timestamptz + interval '9 hours')
    RETURNING transaction_id INTO cid;

    INSERT INTO president_office.transaction_history(transaction_id, event_type, created_at)
    VALUES (cid, 'registered', d::timestamptz + interval '9 hours');

    -- ~85% get an outgoing letter 0..40 days later (older items more likely)
    IF random() < 0.85 OR d < DATE '2026-06-01' THEN
      resp := (random() * random() * 40)::int;
      INSERT INTO president_office.outgoing_letters
        (transaction_id, seq_no, outgoing_no, outgoing_date, to_party_id)
      VALUES (cid, 1, (2000 + i)::text, d + resp, 1 + (random() * (n_parties-1))::int);
      -- some items go to a second destination
      IF random() < 0.15 THEN
        INSERT INTO president_office.outgoing_letters
          (transaction_id, seq_no, outgoing_no, outgoing_date, to_party_id)
        VALUES (cid, 2, (2000 + i)::text, d + resp, 1 + (random() * (n_parties-1))::int);
      END IF;
      INSERT INTO president_office.transaction_history(transaction_id, event_type, created_at)
      VALUES (cid, 'visa_issued', d::timestamptz + interval '12 hours'),
             (cid, 'reply_sent',  (d + resp)::timestamptz + interval '14 hours');
      UPDATE president_office.transactions
         SET status = 'closed', closed_at = (d + resp)::timestamptz + interval '14 hours'
       WHERE transaction_id = cid;
    ELSE
      UPDATE president_office.transactions
         SET status = (ARRAY['with_president','in_progress','awaiting_reply'])[1 + (random()*2)::int]
       WHERE transaction_id = cid;
    END IF;
  END LOOP;
END $$;
