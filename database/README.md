# Database
- التسمية: `snake_case`، المفاتيح `BIGINT GENERATED ALWAYS AS IDENTITY`، الأعمدة العربية/الإنجليزي `name_ar` / `name_en`.
- الملفات مرقمة بترتيب التشغيل. ملف اتنفذ **ما يتعدّلش**، بنضيف ملف جديد.
- `president_office` schema مقفول بـ RLS (deny by default) ومش لازم يظهر في Exposed schemas في Supabase.

## الفولدرات
- `schema/` : هيكل الأكاديمية (01) + الهيكل التنظيمي (02) + داتا صغيرة (03) + views تحليلية (04).
- `academy_demo_data/` : داتا وهمية كبيرة (05 لـ 08). اقرا README اللي جواه الأول.
- `president_office/` : مكتب المدير (الهيكل الفعلي AS_BUILT، الإصلاح 05، الداتا الوهمية 06، الأوصاف العربية 07 و07b).

## ترتيب تشغيل ملفات SQL

شغّلها على Supabase (SQL Editor) بالترتيب ده، وكل ملف لوحده:

| # | الملف | الفولدر | ملاحظة |
|---|---|---|---|
| 1 | `01_sams_schema_v2.sql` | `schema/` | الـ schema الموحد (57 جدول) |
| 2 | `02_sams_seed_org_structure.sql` | `schema/` | الهيكل التنظيمي |
| 3 | `03_sams_sample_data.sql` | `schema/` | داتا تجريبية |
| 4 | `04_sams_analytic_views.sql` | `schema/` | views التحليل |
| 5 | `AS_BUILT_president_office_schema.sql` | `president_office/` | هيكل مكتب المدير الفعلي (بأسماء كودكس) |
| 6 | `05_fix_office_views.sql` | `president_office/` | إصلاح الـ views |
| 7 | `06_seed_fake_demo_data.sql` | `president_office/` | داتا وهمية، **مرة واحدة بس** |
| 8 | `07_president_office_arabic_comments.sql` | `president_office/` | أوصاف عربية |
| 9 | `07b_view_column_comments.sql` | `president_office/` | أوصاف أعمدة الـ views |

### ملاحظات مهمة

- الأرقام `05` و`06` موجودة في فولدرين (`academy_demo_data/` و`president_office/`)، فاعتمد على **الجدول ده** مش على الرقم.
- فولدر `academy_demo_data/` فيه داتا تجريبية إضافية للأكاديمية، وترتيب تشغيلها مع الجدول اللي فوق **لسه ما اتأكدش**. اقرا الـ README اللي جواه قبل ما تشغّله، وملف `05_reset_and_core_data.sql` اسمه فيه "reset" فاتأكد إنه مش بيمسح داتا موجودة.
- `_draft_original_design/` مسودة قديمة بأسماء مختلفة، **متشغّلهاش**.
- أي إعادة بناء للـ views (ملف `05`) بتمسح الأوصاف، فشغّل `07` و`07b` بعدها.
- كل تغيير في الـ schema يتكتب كملف SQL جديد ويتراجع في Pull Request، وشخص واحد بس يشغّله على القاعدة.