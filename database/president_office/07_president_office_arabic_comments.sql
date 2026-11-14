-- =====================================================================
-- 07: Arabic descriptions (COMMENT ON) for president_office
-- Adds descriptions only. No data and no structure are changed.
-- Safe to run more than once. Names are the live ones (Codex names).
-- Descriptions show up in Supabase Table Editor and in Power BI (field tooltips).
-- =====================================================================

COMMENT ON SCHEMA president_office IS 'مكتب رئيس الأكاديمية: المعاملات الواردة والصادرة وخطواتها. بيانات حساسة، الوصول مقيّد.';

-- ---------------- transactions ----------------
COMMENT ON TABLE president_office.transactions IS 'المعاملات: صف لكل معاملة وصلت مكتب الرئيس (وارد، موضوع، تأشيرة، حالة). بديل الجدول القديم tblArchive في Access.';
COMMENT ON COLUMN president_office.transactions.transaction_id IS 'الرقم الداخلي للمعاملة (بيتولد تلقائيًا)';
COMMENT ON COLUMN president_office.transactions.archive_year IS 'سنة الأرشيف (عمود Year القديم)';
COMMENT ON COLUMN president_office.transactions.origin_type IS 'مصدر المعاملة: incoming = واردة من جهة، internal = داخلية';
COMMENT ON COLUMN president_office.transactions.section_id IS 'قسم المكتب المختص بالمعاملة (يرجع لجدول office_departments)';
COMMENT ON COLUMN president_office.transactions.incoming_no IS 'رقم الوارد';
COMMENT ON COLUMN president_office.transactions.incoming_date IS 'تاريخ الوارد';
COMMENT ON COLUMN president_office.transactions.from_party_id IS 'الجهة المرسلة (يرجع لجدول transaction_parties)';
COMMENT ON COLUMN president_office.transactions.subject IS 'موضوع المعاملة (نص حر). قد يحتوي بيانات حساسة';
COMMENT ON COLUMN president_office.transactions.directive_id IS 'نوع التأشيرة، قرار الرئيس (يرجع لجدول decision_types)';
COMMENT ON COLUMN president_office.transactions.directive_note IS 'نص التأشيرة المكتوب بخط الرئيس أو ملاحظاتها';
COMMENT ON COLUMN president_office.transactions.followup_note IS 'ملاحظات المتابعة';
COMMENT ON COLUMN president_office.transactions.page_no IS 'رقم الصفحة في الأرشيف الورقي';
COMMENT ON COLUMN president_office.transactions.original_page_no IS 'رقم صفحة الأصل الورقي';
COMMENT ON COLUMN president_office.transactions.has_original IS 'هل الورقة الأصلية موجودة (نعم/لا)';
COMMENT ON COLUMN president_office.transactions.has_attachments IS 'هل للمعاملة مرفقات (نعم/لا)';
COMMENT ON COLUMN president_office.transactions.is_postponed IS 'هل المعاملة مؤجلة';
COMMENT ON COLUMN president_office.transactions.is_recurring IS 'هل المعاملة متكررة';
COMMENT ON COLUMN president_office.transactions.needs_followup IS 'هل تحتاج متابعة';
COMMENT ON COLUMN president_office.transactions.status IS 'حالة المعاملة: registered مسجلة، with_president عند الرئيس، in_progress قيد التنفيذ، awaiting_reply في انتظار الرد، closed مغلقة، archived مؤرشفة';
COMMENT ON COLUMN president_office.transactions.confidentiality IS 'درجة السرية: normal عادية، restricted مقيّدة، confidential سرية';
COMMENT ON COLUMN president_office.transactions.related_request_id IS 'ربط اختياري بشكوى أو طلب خدمة في النظام الموحد';
COMMENT ON COLUMN president_office.transactions.related_student_id IS 'ربط اختياري بطالب، بيانات حساسة ولا تُستخدم إلا لو المعاملة تخص الطالب';
COMMENT ON COLUMN president_office.transactions.registered_by IS 'المستخدم اللي سجّل المعاملة';
COMMENT ON COLUMN president_office.transactions.registered_at IS 'تاريخ ووقت التسجيل في النظام';
COMMENT ON COLUMN president_office.transactions.closed_at IS 'تاريخ ووقت إغلاق المعاملة (فاضي لو لسه مفتوحة)';
COMMENT ON COLUMN president_office.transactions.legacy_id IS 'رقم السجل في الأرشيف القديم (Access)، للرجوع للأصل ولمنع تكرار الترحيل';
COMMENT ON COLUMN president_office.transactions.legacy_in_direction_raw IS 'نص جهة الوارد زي ما كان مكتوب في الأرشيف القديم قبل التنضيف';
COMMENT ON COLUMN president_office.transactions.is_historical IS 'معاملة قديمة مرحّلة. بتتستبعد من تقارير المتأخر وزمن الرد لأن سجلاتها القديمة مفيهاش رد مسجّل';

-- ---------------- outgoing_letters ----------------
COMMENT ON TABLE president_office.outgoing_letters IS 'الخطابات الصادرة: صف لكل خطاب صادر. المعاملة الواحدة ممكن يكون لها أكتر من صادر.';
COMMENT ON COLUMN president_office.outgoing_letters.outgoing_id IS 'الرقم الداخلي للصادر';
COMMENT ON COLUMN president_office.outgoing_letters.transaction_id IS 'المعاملة اللي صدر عنها الخطاب (يرجع لجدول transactions)';
COMMENT ON COLUMN president_office.outgoing_letters.seq_no IS 'ترتيب الصادر داخل المعاملة: 1 ثم 2 ثم 3';
COMMENT ON COLUMN president_office.outgoing_letters.outgoing_no IS 'رقم الصادر';
COMMENT ON COLUMN president_office.outgoing_letters.outgoing_date IS 'تاريخ الصادر';
COMMENT ON COLUMN president_office.outgoing_letters.to_party_id IS 'الجهة المستلمة (يرجع لجدول transaction_parties)';
COMMENT ON COLUMN president_office.outgoing_letters.receiver_name IS 'اسم المستلم لو مسجّل';
COMMENT ON COLUMN president_office.outgoing_letters.followup_note IS 'ملاحظات متابعة الصادر';
COMMENT ON COLUMN president_office.outgoing_letters.legacy_out_direction_raw IS 'نص جهة الصادر زي ما كان في الأرشيف القديم قبل التنضيف';

-- ---------------- transaction_history ----------------
COMMENT ON TABLE president_office.transaction_history IS 'خطوات المعاملة: سجل زمني لما حصل لها (اتسجلت، اتأشّرت، اتحولت، اتردّ عليها، اتقفلت) ومين عمل كده. الأرشيف القديم ماكانش بيسجل ده.';
COMMENT ON COLUMN president_office.transaction_history.event_id IS 'الرقم الداخلي للخطوة';
COMMENT ON COLUMN president_office.transaction_history.transaction_id IS 'المعاملة صاحبة الخطوة';
COMMENT ON COLUMN president_office.transaction_history.actor_user_id IS 'المستخدم اللي نفّذ الخطوة';
COMMENT ON COLUMN president_office.transaction_history.event_type IS 'نوع الخطوة: registered تسجيل، visa_issued تأشيرة، forwarded تحويل، reply_sent إرسال رد، reminder تذكير، postponed تأجيل، reopened إعادة فتح، closed إغلاق، comment تعليق';
COMMENT ON COLUMN president_office.transaction_history.to_unit_id IS 'الإدارة المحوّل إليها (في خطوة التحويل)';
COMMENT ON COLUMN president_office.transaction_history.note IS 'ملاحظة على الخطوة';
COMMENT ON COLUMN president_office.transaction_history.created_at IS 'تاريخ ووقت الخطوة';

-- ---------------- transaction_files ----------------
COMMENT ON TABLE president_office.transaction_files IS 'ملفات المعاملة: ربط المعاملة بالورقة الممسوحة (صورة أو PDF) المحفوظة في جدول document.';
COMMENT ON COLUMN president_office.transaction_files.transaction_id IS 'المعاملة';
COMMENT ON COLUMN president_office.transaction_files.document_id IS 'الملف الممسوح (يرجع لجدول document)';
COMMENT ON COLUMN president_office.transaction_files.is_original IS 'هل ده الأصل الورقي الممسوح (نعم/لا)';

-- ---------------- transaction_parties ----------------
COMMENT ON TABLE president_office.transaction_parties IS 'الجهات: قايمة موحّدة بالمرسل والمستلم (كلية، قسم، إدارة، موظف، جهة خارجية). بديل نص جهة الوارد والصادر الحر في الأرشيف القديم.';
COMMENT ON COLUMN president_office.transaction_parties.party_id IS 'الرقم الداخلي للجهة';
COMMENT ON COLUMN president_office.transaction_parties.party_kind IS 'نوع الجهة: faculty كلية، department قسم علمي، admin_unit إدارة، staff موظف، external جهة خارجية، unresolved لسه ما اتحددتش';
COMMENT ON COLUMN president_office.transaction_parties.faculty_id IS 'الكلية (لو الجهة كلية)';
COMMENT ON COLUMN president_office.transaction_parties.department_id IS 'القسم العلمي (لو الجهة قسم)';
COMMENT ON COLUMN president_office.transaction_parties.admin_unit_id IS 'الإدارة (لو الجهة إدارة)';
COMMENT ON COLUMN president_office.transaction_parties.staff_id IS 'الموظف (لو الجهة شخص)';
COMMENT ON COLUMN president_office.transaction_parties.external_id IS 'الجهة الخارجية (يرجع لجدول outside_contacts)';
COMMENT ON COLUMN president_office.transaction_parties.label_ar IS 'الاسم الموحّد للعرض، مثال: عميد كلية العلوم الإدارية';

-- ---------------- outside_contacts ----------------
COMMENT ON TABLE president_office.outside_contacts IS 'الجهات الخارجية: وزارات وجامعات وشركات وأفراد من خارج الأكاديمية.';
COMMENT ON COLUMN president_office.outside_contacts.external_id IS 'الرقم الداخلي للجهة الخارجية';
COMMENT ON COLUMN president_office.outside_contacts.name_ar IS 'الاسم بالعربي';
COMMENT ON COLUMN president_office.outside_contacts.name_en IS 'الاسم بالإنجليزي';
COMMENT ON COLUMN president_office.outside_contacts.entity_type IS 'النوع: ministry وزارة، government_body جهة حكومية، university جامعة، company شركة، individual فرد، other أخرى';
COMMENT ON COLUMN president_office.outside_contacts.city IS 'المدينة';

-- ---------------- decision_types ----------------
COMMENT ON TABLE president_office.decision_types IS 'أنواع التأشيرة: قرار الرئيس على المعاملة (موافقة، حفظ، لإعداد خطاب، للدراسة والعرض، تأجيل، رفض).';
COMMENT ON COLUMN president_office.decision_types.directive_id IS 'الرقم الداخلي لنوع التأشيرة';
COMMENT ON COLUMN president_office.decision_types.code IS 'كود قصير بالإنجليزي';
COMMENT ON COLUMN president_office.decision_types.name_ar IS 'الاسم بالعربي';
COMMENT ON COLUMN president_office.decision_types.closes_item IS 'هل التأشيرة دي بتقفل المعاملة (مثلًا حفظ)';

-- ---------------- office_departments ----------------
COMMENT ON TABLE president_office.office_departments IS 'أقسام المكتب: تصنيف المعاملات داخل مكتب الرئيس (عقود واتفاقيات، مكافآت، وافدين...). مش هو جدول department بتاع أقسام الكليات.';
COMMENT ON COLUMN president_office.office_departments.section_id IS 'الرقم الداخلي لقسم المكتب';
COMMENT ON COLUMN president_office.office_departments.code IS 'كود قصير بالإنجليزي';
COMMENT ON COLUMN president_office.office_departments.name_ar IS 'الاسم بالعربي';
COMMENT ON COLUMN president_office.office_departments.name_en IS 'الاسم بالإنجليزي';
COMMENT ON COLUMN president_office.office_departments.is_active IS 'هل القسم مستخدم حاليًا';

-- ---------------- report views ----------------
COMMENT ON VIEW president_office.report_response_time IS 'تقرير زمن الإنجاز: عدد الأيام من وارد المعاملة لأول صادر عنها.';
COMMENT ON COLUMN president_office.report_response_time.first_outgoing_date IS 'تاريخ أول خطاب صادر';
COMMENT ON COLUMN president_office.report_response_time.response_days IS 'عدد الأيام بين الوارد وأول صادر (فاضي لو مفيش صادر)';
COMMENT ON VIEW president_office.report_waiting_for_reply IS 'تقرير المعاملات المنتظرة: المعاملات المفتوحة اللي محتاجة رد أو متابعة (بدون المعاملات القديمة المرحّلة).';
COMMENT ON COLUMN president_office.report_waiting_for_reply.age_days IS 'عدد الأيام من تاريخ الوارد لحد النهاردة';
COMMENT ON VIEW president_office.report_monthly_volume IS 'تقرير الحجم الشهري: عدد المعاملات الواردة في كل شهر وقسم.';
COMMENT ON COLUMN president_office.report_monthly_volume.month IS 'أول يوم في الشهر';
COMMENT ON COLUMN president_office.report_monthly_volume.items IS 'عدد المعاملات';
