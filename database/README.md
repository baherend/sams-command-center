# Database
- التسمية: `snake_case`، المفاتيح `BIGINT GENERATED ALWAYS AS IDENTITY`، الأعمدة العربية/الإنجليزي `name_ar` / `name_en`.
- الملفات مرقمة بترتيب التشغيل. ملف اتنفذ **ما يتعدّلش**، بنضيف ملف جديد.
- `president_office` schema مقفول بـ RLS (deny by default) ومش لازم يظهر في Exposed schemas في Supabase.

## الفولدرات
- `schema/` : هيكل الأكاديمية (01) + الهيكل التنظيمي (02) + داتا صغيرة (03) + views تحليلية (04).
- `academy_demo_data/` : داتا وهمية كبيرة (05 لـ 08). اقرا README اللي جواه الأول.
- `president_office/` : مكتب المدير (الإصلاح 05 والداتا الوهمية 06).
