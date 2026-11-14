# SAMS Command Center — مركز القيادة والذكاء التنبؤي

داشبورد تنفيذي لرئيس أكاديمية السادات يجمع في مكان واحد:

- **مكتب رئيس الأكاديمية:** المعاملات الواردة والصادرة، زمن الإنجاز، المتأخر.
- **حالة الأكاديمية:** الطلاب، الموظفين، هيئة التدريس، الحضور، الأعباء.

القاعدة: **PostgreSQL على Supabase** (مشروع `sams-dev`) والتقارير على **Power BI**.

> ⚠️ الداتا الموجودة في الريبو **وهمية بالكامل**. الداتا الحقيقية (أرشيف المكتب، الطلاب) **ممنوع** ترفعها هنا.

## هيكل الريبو

| المجلد | فيه إيه |
|---|---|
| `database/schema/` | الـ schema الموحد للأكاديمية (57 جدول) |
| `database/president_office/` | schema مكتب المدير (`president_office`) والإصلاحات والداتا الوهمية |
| `powerbi/` | ملفات Power BI بصيغة `.pbip` (مش `.pbix`) |
| `docs/` | قاموس الداتا، وخطوات استخراج تصميم الأرشيف القديم |

## ترتيب تشغيل ملفات القاعدة (قاعدة جديدة)

1. `database/schema/01_sams_schema_v2.sql`
2. باقي ملفات الأكاديمية (org structure + sample data + views): **TODO: تتضاف في `database/schema/`**
3. إنشاء schema `president_office`: **TODO: يتضاف DDL الفعلي اللي اتنفذ على `sams-dev`** (الملف في `_draft_original_design/` مسودة بأسماء قديمة، ملهاش دعوة بالقاعدة الشغالة)
4. `database/president_office/05_fix_office_views.sql`
5. `database/president_office/06_seed_fake_demo_data.sql` (داتا وهمية، **تتشغّل مرة واحدة بس**)

## الشغل الجماعي

اقرأ [`CONTRIBUTING.md`](CONTRIBUTING.md) قبل أول commit.
