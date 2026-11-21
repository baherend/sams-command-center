-- Round 3 PR A input and publication RPC regression tests. Synthetic only.
begin;
select plan(43);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('d3000000-0000-0000-0000-000000000001','authenticated','authenticated','r3-admin@example.test','',now(),'{}','{}',now(),now()),
 ('d3000000-0000-0000-0000-000000000002','authenticated','authenticated','r3-reviewer@example.test','',now(),'{}','{}',now(),now()),
 ('d3000000-0000-0000-0000-000000000003','authenticated','authenticated','r3-stat@example.test','',now(),'{}','{}',now(),now()),
 ('d3000000-0000-0000-0000-000000000004','authenticated','authenticated','r3-cashier@example.test','',now(),'{}','{}',now(),now()),
 ('d3000000-0000-0000-0000-000000000005','authenticated','authenticated','r3-viewer@example.test','',now(),'{}','{}',now(),now()),
 ('d3000000-0000-0000-0000-000000000006','authenticated','authenticated','r3-researcher@example.test','',now(),'{}','{}',now(),now());
insert into crdc.staff_users(staff_id,auth_user_id,full_name,role,is_active) values
 ('e3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','R3 Admin','admin',true),
 ('e3000000-0000-0000-0000-000000000002','d3000000-0000-0000-0000-000000000002','R3 Reviewer','reviewer',true),
 ('e3000000-0000-0000-0000-000000000003','d3000000-0000-0000-0000-000000000003','R3 Statistician','statistician',true),
 ('e3000000-0000-0000-0000-000000000004','d3000000-0000-0000-0000-000000000004','R3 Cashier','cashier',true),
 ('e3000000-0000-0000-0000-000000000005','d3000000-0000-0000-0000-000000000005','R3 Viewer','viewer',true);
insert into crdc.researchers(researcher_id,auth_user_id,full_name,applicant_type,nationality,national_id,passport_no,degree_id,email) values
 ('f3000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000006','R3 Researcher','egyptian',null,' 29001010101031 ',null,1,'r3-researcher@example.test'),
 ('f3000000-0000-0000-0000-000000000002',null,'R3 Other','egyptian',null,'29001010101032',null,1,'r3-other@example.test'),
 ('f3000000-0000-0000-0000-000000000003',null,'R3 Passport','foreign','Testland',null,' abC-123 ',1,'r3-passport@example.test'),
 ('f3000000-0000-0000-0000-000000000004','d3000000-0000-0000-0000-000000000001','R3 Admin Owner','egyptian',null,'29001010101034',null,1,'r3-admin-owner@example.test');
select is((select national_id from crdc.researchers where researcher_id='f3000000-0000-0000-0000-000000000001'),'29001010101031','national ID is trimmed');
select is((select passport_no from crdc.researchers where researcher_id='f3000000-0000-0000-0000-000000000003'),'ABC-123','passport is uppercased and trimmed');
select lives_ok($$insert into crdc.researchers(full_name,applicant_type,national_id,email) values('Synthetic century three','egyptian','30001010101040','r3-century-three@example.test')$$,'century digit three with a valid date is accepted');
select throws_ok($$insert into crdc.researchers(full_name,applicant_type,national_id,email) values('Bad length','egyptian','2900101010103','r3-bad-length@example.test')$$,'23514',null,'national ID length is checked');
select throws_ok($$insert into crdc.researchers(full_name,applicant_type,national_id,email) values('Bad century','egyptian','49001010101031','r3-bad-century@example.test')$$,'23514',null,'national ID century is checked');
select throws_ok($$insert into crdc.researchers(full_name,applicant_type,national_id,email) values('Bad month','egyptian','29013010101031','r3-bad-month@example.test')$$,'23514',null,'national ID month 13 is rejected');
select throws_ok($$insert into crdc.researchers(full_name,applicant_type,national_id,email) values('Bad day','egyptian','29002300101031','r3-bad-day@example.test')$$,'23514',null,'February 30 is rejected');
select throws_ok($$insert into crdc.researchers(full_name,applicant_type,national_id,email) values('Trailing duplicate','egyptian','29001010101031   ','r3-duplicate@example.test')$$,'23505',null,'trimmed national ID duplicate is rejected');
select throws_ok($$insert into crdc.researchers(full_name,applicant_type,nationality,passport_no,email) values('Passport duplicate','foreign','Testland',' abc-123','r3-passport-dup@example.test')$$,'23505',null,'normalized passport duplicate is rejected');

insert into crdc.service_requests(researcher_id,work_type,work_title,page_count) values('f3000000-0000-0000-0000-000000000001','paper','R3 publication source',1);
insert into crdc.service_requests(researcher_id,work_type,work_title,page_count) values('f3000000-0000-0000-0000-000000000002','paper','R3 wrong fee source',1);
insert into crdc.request_items(request_id,fee_id,status_id,amount_due)
select sr.request_id,f.fee_id,s.status_id,crdc.calc_fee(f.fee_id,sr.page_count)
from crdc.service_requests sr join crdc.fee_schedule f on f.option_code='PUB_PUBLISH' and f.applicant_type='egyptian'
join crdc.request_statuses s on s.code='IN_PROGRESS' where sr.work_title='R3 publication source';
insert into crdc.request_items(request_id,fee_id,status_id,amount_due)
select sr.request_id,f.fee_id,s.status_id,crdc.calc_fee(f.fee_id,sr.page_count)
from crdc.service_requests sr join crdc.fee_schedule f on f.option_code='PUB_ARBITRATION' and f.applicant_type='egyptian'
join crdc.request_statuses s on s.code='IN_PROGRESS' where sr.work_title='R3 wrong fee source';
insert into crdc.service_requests(researcher_id,work_type,work_title,page_count)
values('f3000000-0000-0000-0000-000000000004','paper','R3 admin own source',20);
insert into crdc.request_items(request_id,fee_id,status_id,amount_due)
select sr.request_id,f.fee_id,s.status_id,crdc.calc_fee(f.fee_id,sr.page_count)
from crdc.service_requests sr join crdc.fee_schedule f on f.option_code='PUB_PUBLISH' and f.applicant_type='egyptian'
join crdc.request_statuses s on s.code='IN_PROGRESS' where sr.work_title='R3 admin own source';
insert into crdc.publication_submissions(item_id,journal_id,paper_language)
select i.item_id,1,'ar' from crdc.request_items i join crdc.service_requests sr using(request_id) where sr.work_title='R3 admin own source';
select set_config('test.r3.pub_item',(select i.item_id::text from crdc.request_items i join crdc.service_requests sr using(request_id) where sr.work_title='R3 publication source'),true);
select set_config('test.r3.wrong_item',(select i.item_id::text from crdc.request_items i join crdc.service_requests sr using(request_id) where sr.work_title='R3 wrong fee source'),true);
select set_config('test.r3.own_item',(select i.item_id::text from crdc.request_items i join crdc.service_requests sr using(request_id) where sr.work_title='R3 admin own source'),true);

select throws_ok($$insert into crdc.service_requests(researcher_id,work_type,work_title,page_count) values('f3000000-0000-0000-0000-000000000001','paper','12',1)$$,'23514',null,'two-character title rejected');
select lives_ok($$insert into crdc.service_requests(researcher_id,work_type,work_title,page_count) values('f3000000-0000-0000-0000-000000000001','paper',repeat('a',3),1)$$,'three-character title accepted');
select lives_ok($$insert into crdc.service_requests(researcher_id,work_type,work_title,page_count) values('f3000000-0000-0000-0000-000000000001','paper',repeat('b',300),1)$$,'300-character title accepted');
select throws_ok($$insert into crdc.service_requests(researcher_id,work_type,work_title,page_count) values('f3000000-0000-0000-0000-000000000001','paper',repeat('c',301),1)$$,'23514',null,'301-character title rejected');
select throws_ok($$insert into crdc.service_requests(researcher_id,work_type,work_title,page_count) values('f3000000-0000-0000-0000-000000000001','paper',repeat('x',200000),1)$$,'23514',null,'200KB title rejected');
select throws_ok($$insert into crdc.service_requests(researcher_id,work_type,work_title,page_count) values('f3000000-0000-0000-0000-000000000001','paper','R3 pages zero',0)$$,'23514',null,'zero pages rejected');
select lives_ok($$insert into crdc.service_requests(researcher_id,work_type,work_title,page_count) values('f3000000-0000-0000-0000-000000000001','paper','R3 page minimum',1)$$,'one page accepted');
select lives_ok($$insert into crdc.service_requests(researcher_id,work_type,work_title,page_count) values('f3000000-0000-0000-0000-000000000001','paper','R3 page maximum',2000)$$,'2000 pages accepted');
select throws_ok($$insert into crdc.service_requests(researcher_id,work_type,work_title,page_count) values('f3000000-0000-0000-0000-000000000001','paper','R3 pages max plus',2001)$$,'23514',null,'2001 pages rejected');
select lives_ok($$insert into crdc.request_status_history(item_id,status_id,note) values(current_setting('test.r3.pub_item')::bigint,4,repeat('n',500))$$,'500-character note accepted');
select throws_ok($$insert into crdc.request_status_history(item_id,status_id,note) values(current_setting('test.r3.pub_item')::bigint,4,repeat('n',501))$$,'23514',null,'501-character note rejected');

select set_config('request.jwt.claims','{"sub":"d3000000-0000-0000-0000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select crdc.create_service_request('paper','R3 too many pages',2001,array[(select fee_id from crdc.fee_schedule where option_code='PUB_PUBLISH' and applicant_type='egyptian')]::smallint[])$$,'23514',null,'RPC maps page limit to clean check violation');
reset role;

select set_config('request.jwt.claims','{"sub":"d3000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select crdc.create_publication_submission(current_setting('test.r3.pub_item')::bigint,1,'ar')$$,'42501',null,'reviewer cannot create submission');
reset role;
select set_config('request.jwt.claims','{"sub":"d3000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select crdc.create_publication_submission(current_setting('test.r3.pub_item')::bigint,1,'ar')$$,'42501',null,'statistician cannot create submission');
reset role;
select set_config('request.jwt.claims','{"sub":"d3000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select crdc.create_publication_submission(current_setting('test.r3.pub_item')::bigint,1,'ar')$$,'42501',null,'cashier cannot create submission');
reset role;
select set_config('request.jwt.claims','{"sub":"d3000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select crdc.create_publication_submission(current_setting('test.r3.pub_item')::bigint,1,'ar')$$,'42501',null,'viewer cannot create submission');
reset role;
select set_config('request.jwt.claims','{"sub":"d3000000-0000-0000-0000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select crdc.create_publication_submission(current_setting('test.r3.pub_item')::bigint,1,'ar')$$,'42501',null,'researcher cannot create submission');
select throws_ok($$insert into crdc.publication_submissions(item_id,journal_id,paper_language) values(current_setting('test.r3.pub_item')::bigint,1,'ar')$$,'42501',null,'authenticated direct INSERT is denied');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select throws_ok($$select crdc.create_publication_submission(current_setting('test.r3.pub_item')::bigint,1,'ar')$$,'42501',null,'anon cannot create submission');
reset role;
select set_config('request.jwt.claims','{"sub":"d3000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select crdc.create_publication_submission(current_setting('test.r3.pub_item')::bigint,1,'ar')$$,'admin creates publication submission');
select throws_ok($$select crdc.create_publication_submission(current_setting('test.r3.pub_item')::bigint,1,'ar')$$,'23505',null,'duplicate submission is rejected');
select throws_ok($$select crdc.create_publication_submission(current_setting('test.r3.own_item')::bigint,1,'ar')$$,'42501',null,'admin cannot create submission for own researcher request');
select throws_ok($$select crdc.create_publication_submission(current_setting('test.r3.wrong_item')::bigint,1,'ar')$$,'23514',null,'non-PUB_PUBLISH item rejected');
select throws_ok($$select crdc.create_publication_submission(current_setting('test.r3.wrong_item')::bigint,99,'ar')$$,'23503',null,'unknown journal rejected');
select throws_ok($$select crdc.create_publication_submission(current_setting('test.r3.wrong_item')::bigint,1,'fr')$$,'23514',null,'unsupported paper language rejected');
select throws_ok($$select crdc.update_publication_submission(current_setting('test.r3.pub_item')::bigint,null,1,null)$$,'23514',null,'null decision is rejected cleanly');
update crdc.request_items set status_id=(select status_id from crdc.request_statuses where code='SUBMITTED') where item_id=current_setting('test.r3.pub_item')::bigint;
select throws_ok($$select crdc.update_publication_submission(current_setting('test.r3.pub_item')::bigint,'accepted',1,null)$$,'23514',null,'SUBMITTED blocks a publication decision');
update crdc.request_items set status_id=(select status_id from crdc.request_statuses where code='PAYMENT_ORDER') where item_id=current_setting('test.r3.pub_item')::bigint;
select throws_ok($$select crdc.update_publication_submission(current_setting('test.r3.pub_item')::bigint,'accepted',1,null)$$,'23514',null,'PAYMENT_ORDER blocks a publication decision');
update crdc.request_items set status_id=(select status_id from crdc.request_statuses where code='PAID') where item_id=current_setting('test.r3.pub_item')::bigint;
select throws_ok($$select crdc.update_publication_submission(current_setting('test.r3.pub_item')::bigint,'accepted',1,null)$$,'23514',null,'PAID blocks a publication decision');
update crdc.request_items set status_id=(select status_id from crdc.request_statuses where code='IN_PROGRESS') where item_id=current_setting('test.r3.pub_item')::bigint;
select lives_ok($$select crdc.update_publication_submission(current_setting('test.r3.pub_item')::bigint,'accepted',1,null)$$,'IN_PROGRESS permits a publication decision');
update crdc.request_items set status_id=(select status_id from crdc.request_statuses where code='REVISIONS') where item_id=current_setting('test.r3.pub_item')::bigint;
select lives_ok($$select crdc.update_publication_submission(current_setting('test.r3.pub_item')::bigint,'revisions',1,null)$$,'REVISIONS permits a publication decision');
update crdc.request_items set status_id=(select status_id from crdc.request_statuses where code='COMPLETED') where item_id=current_setting('test.r3.pub_item')::bigint;
select lives_ok($$select crdc.update_publication_submission(current_setting('test.r3.pub_item')::bigint,'accepted',1,null)$$,'COMPLETED permits a publication decision');
update crdc.request_items set status_id=(select status_id from crdc.request_statuses where code='DELIVERED') where item_id=current_setting('test.r3.pub_item')::bigint;
select throws_ok($$select crdc.update_publication_submission(current_setting('test.r3.pub_item')::bigint,'accepted',1,null)$$,'23514',null,'DELIVERED blocks a publication decision');
select throws_ok($$select crdc.update_publication_submission(current_setting('test.r3.own_item')::bigint,'accepted',1,null)$$,'42501','Staff cannot decide on their own researcher request','admin self-decision is blocked');
reset role;

select * from finish();
rollback;
