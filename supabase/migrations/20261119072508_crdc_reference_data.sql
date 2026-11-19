-- Reference data for the CRDC portal (center tariff, degrees, statuses, journals).
-- Source: the center's procedural guides for Egyptians and foreign researchers.
-- Items marked CONFIRM are assumptions still to be confirmed with the center.
begin;
insert into crdc.services (service_id, code, name_ar, is_active) values
 (1,'PUB','تحكيم ونشر الأبحاث',true),
 (2,'LANG','التدقيق اللغوي',true),
 (3,'STAT','التحليل والمراجعة الإحصائية',true),
 (4,'DT','شهادة أساسيات التحول الرقمي',true),
 (5,'PLAG','قياس نسبة الاقتباس',true),
 (6,'CONSULT','الاستشارات',false);          -- no details yet: hidden until confirmed

insert into crdc.requirement_types (requirement_code, service_id, name_ar, sort_order)
select v.c, s.service_id, v.n, v.o
from (values ('PUBLICATION','PUB','نشر بحث علمي',1),('LANG','LANG','مراجعة لغوية',2),
             ('STAT_REVIEW','STAT','مراجعة إحصائية',3),('STAT_ANALYSIS','STAT','تحليل إحصائي',4),
             ('DT','DT','شهادة التحول الرقمي',5),('PLAG','PLAG','قياس نسبة الاقتباس',6)) v(c,sv,n,o)
join crdc.services s on s.code = v.sv;

-- fees: option, applicant, currency, base, included pages, extra page, certificate, requirement
-- CONFIRM: for Egyptians the 500 EGP certificate fee sits under the "publish + certificate" row;
--          for foreign researchers the certificate is inside the quoted price (certificate_fee = 0).
insert into crdc.fee_schedule (service_id, option_code, applicant_type, currency, base_fee,
                               included_pages, extra_page_fee, certificate_fee, requirement_code)
select s.service_id, v.opt, v.app, v.cur, v.base, v.inc, v.extra, v.cert, v.req
from (values
 ('PUB_ARBITRATION','egyptian','EGP',1500,null::int,null::int,0,null::text),
 ('PUB_PUBLISH'    ,'egyptian','EGP',1500,25,80,500,'PUBLICATION'),
 ('LANG_AR'        ,'egyptian','EGP',3000,150,23,500,'LANG'),
 ('LANG_EN'        ,'egyptian','EGP',4500,150,50,500,'LANG'),
 ('STAT_REVIEW'    ,'egyptian','EGP',3000,null,null,500,'STAT_REVIEW'),
 ('STAT_ANALYSIS'  ,'egyptian','EGP',7000,null,null,500,'STAT_ANALYSIS'),
 ('DT_COURSE_EXAM' ,'egyptian','EGP',1050,null,null,0,'DT'),
 ('DT_EXAM_ONLY'   ,'egyptian','EGP',910,null,null,0,'DT'),
 ('PLAG'           ,'egyptian','EGP',250,null,null,0,'PLAG'),
 ('PUB_ARBITRATION','foreign','USD',200,null,null,0,null),
 ('PUB_PUBLISH'    ,'foreign','USD',400,25,20,0,'PUBLICATION'),
 ('LANG_AR'        ,'foreign','USD',500,150,3,0,'LANG'),
 ('LANG_EN'        ,'foreign','USD',575,150,5,0,'LANG'),
 ('STAT_REVIEW'    ,'foreign','USD',400,null,null,0,'STAT_REVIEW'),
 ('STAT_ANALYSIS'  ,'foreign','USD',750,null,null,0,'STAT_ANALYSIS'),
 ('DT_COURSE_EXAM' ,'foreign','USD',200,null,null,0,'DT'),
 ('DT_EXAM_ONLY'   ,'foreign','USD',100,null,null,0,'DT'),
 ('DT_RETAKE'      ,'foreign','USD',20,null,null,0,null),
 ('PLAG'           ,'foreign','USD',50,null,null,0,'PLAG')
) v(opt,app,cur,base,inc,extra,cert,req)
join crdc.services s on s.code = split_part(v.opt,'_',1);

insert into crdc.degrees (degree_id, code, name_ar, track, level) values
 (1,'PHD_ACAD','دكتوراه أكاديمي','academic','phd'),
 (2,'MA_ACAD','ماجستير أكاديمي','academic','masters'),
 (3,'PHD_PROF','دكتوراه مهني','professional','phd'),
 (4,'MA_PROF','ماجستير مهني','professional','masters');

insert into crdc.degree_requirements (degree_id, requirement_code, min_count)
select d.degree_id, v.r, v.n
from (values
 ('PHD_ACAD','PUBLICATION',2),('PHD_ACAD','LANG',1),('PHD_ACAD','STAT_REVIEW',1),('PHD_ACAD','STAT_ANALYSIS',1),('PHD_ACAD','DT',1),('PHD_ACAD','PLAG',1),
 ('MA_ACAD','PUBLICATION',1),('MA_ACAD','LANG',1),('MA_ACAD','STAT_REVIEW',1),('MA_ACAD','STAT_ANALYSIS',1),('MA_ACAD','DT',1),('MA_ACAD','PLAG',1),
 ('PHD_PROF','DT',1),('MA_PROF','DT',1)) v(d,r,n)
join crdc.degrees d on d.code = v.d;

insert into crdc.request_statuses (status_id, code, name_ar, sort_order, is_final) values
 (1,'SUBMITTED','تم التقديم',1,false),(2,'PAYMENT_ORDER','إذن دفع',2,false),(3,'PAID','تم السداد',3,false),
 (4,'IN_PROGRESS','قيد التنفيذ',4,false),(5,'REVISIONS','تعديلات مطلوبة',5,false),
 (6,'COMPLETED','تم الانتهاء',6,false),(7,'DELIVERED','تم تسليم الإفادة',7,true);

insert into crdc.journals (journal_id, code, name_ar, issues_per_year) values
 (1,'JSO','مجلة البحوث الإدارية',4),
 (2,'SJSAF','مجلة السادات للبحوث الإدارية والمالية',2);

-- CONFIRM: issue months are inferred from the 2024-2025 covers; submission deadlines unknown.
insert into crdc.journal_issues (journal_id, issue_year, issue_month)
select j.journal_id, y.yr, m.mo
from crdc.journals j
cross join (values (2025),(2026)) y(yr)
join lateral unnest(case when j.journal_id = 1 then array[1,4,7,10] else array[1,7] end) m(mo) on true;
commit;
