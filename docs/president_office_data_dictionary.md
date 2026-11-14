# قاموس بيانات مكتب رئيس الأكاديمية

schema: `president_office` (على Supabase `sams-dev`). الأسماء دي هي الفعلية في القاعدة.

## الجداول

| الجدول | المعنى | بيقابل في الأرشيف القديم |
|---|---|---|
| `transactions` | المعاملة: وارد، جهة، موضوع، تأشيرة، حالة، فلاجات | `tblArchive` |
| `outgoing_letters` | الصادر (أكتر من صادر للمعاملة) | `out number`، `out date`، `out direction1/2/TXT` |
| `transaction_history` | خطوات المعاملة (مين عمل إيه وإمتى) | مفيش في القديم |
| `transaction_files` | ربط المعاملة بالملفات الممسوحة (`public.document`) | `attached`، `Photo`، `Origin` |
| `transaction_parties` | الجهة المرسلة/المستلمة بعد التوحيد (كلية، إدارة، موظف، خارجية) | `in direction` + أعمدة `out direction` |
| `outside_contacts` | جهات خارجية (وزارات، جامعات، شركات) | جزء من `in direction` |
| `office_departments` | أقسام المكتب | جدول `Sections` + عمود `section` |
| `decision_types` | نوع التأشيرة (موافقة، حفظ، لإعداد خطاب...) | عمود `visa` |

## Views (للتقارير)

| الـ view | بتجاوب على |
|---|---|
| `report_response_time` | أيام من الوارد لأول صادر (التاريخي `is_historical` متعلّم) |
| `report_waiting_for_reply` | المعاملات المفتوحة وعمرها بالأيام (من غير التاريخي) |
| `report_monthly_volume` | حجم المعاملات شهرياً حسب القسم |

## ربط الأعمدة القديمة بالجديدة (من صور الشاشة، محتاج تأكيد من Documenter)

| القديم (`tblArchive`) | الجديد | واثق؟ |
|---|---|---|
| `ID` | `transactions.legacy_id` | أيوه |
| `Year` | `archive_year` | أيوه |
| `section` | `section_id` | أيوه |
| `in number` / `in date` | `incoming_no` / `incoming_date` | أيوه |
| `in direction` | `from_party_id` (والنص الأصلي في `legacy_in_direction_raw`) | أيوه |
| `subject` | `subject` | أيوه |
| `out number` (صفر = مفيش صادر) | `outgoing_letters.outgoing_no` | أيوه |
| `out date` | `outgoing_letters.outgoing_date` | أيوه |
| `out direction1/2/TXT` | صفوف في `outgoing_letters` | أيوه، التفاصيل محتاجة تأكيد |
| `visa` | `directive_id` + `directive_note` | أيوه |
| `following` / `following_result` | `followup_note` | تقريباً |
| `page num` | `page_no` | أيوه |
| `repeated` / `delayed` | `is_recurring` / `is_postponed` | أيوه |
| `FollowingForm` | `needs_followup` | تقريباً |
| `Origin` | `has_original` | تقريباً |
| `attached` / `Photo` | `has_attachments` + الملفات | مش متأكد |
| `Receiver1/2` | `outgoing_letters.receiver_name` | مش متأكد |
| `OutDFollo` | `outgoing_letters.followup_note` | مش متأكد |

## ملاحظات عن الأرشيف القديم (Microsoft Access)

- الداتا كلها في **جدول واحد** `tblArchive` فيه عمود `Year`، وأقدم سجل من **2007**.
- في فورم لكل سنة (`frm2018_Archive` وغيره)، لكن الداتا واحدة.
- قوايم مساعدة: `Sections`، `Out_Direction`، `Year`.
- سجلات السنين القديمة غالباً `out number = 0` وتأشيرة "حفظ"، يعني **مفيش رد مسجل** مش "متأخر". لذلك فيه `is_historical`.
- الملف عليه باسورد، ولازم المسؤول عن الأرشيف يفتحه.
- خطوات استخراج التصميم من غير ما نلمس الداتا: [`Access_Archive_Steps.pdf`](Access_Archive_Steps.pdf).

## قرارات لسه مفتوحة

1. إيه اللي يعتبر معاملة "مقفولة"؟ (حفظ وموافقة كفاية؟ ولو "تأجيل"؟)
2. حد أدنى للسنين اللي تتحسب في زمن الرد (الافتراضي: بعد 2017).
3. مين يراجع توحيد أسماء الجهات؟
4. مكان التشغيل النهائي (محلي / سحابة / سيرفر خاص) والميزانية.
