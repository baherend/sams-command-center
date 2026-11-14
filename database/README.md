# Database
- التسمية: `snake_case`، المفاتيح `BIGINT GENERATED ALWAYS AS IDENTITY`، الأعمدة العربية/الإنجليزي `name_ar` / `name_en`.
- الملفات مرقمة بترتيب التشغيل. ملف اتنفذ **ما يتعدّلش**، بنضيف ملف جديد.
- `president_office` schema مقفول بـ RLS (deny by default) ومش لازم يظهر في Exposed schemas في Supabase.
