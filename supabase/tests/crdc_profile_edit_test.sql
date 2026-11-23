-- Synthetic coverage for researcher-owned, non-identity profile editing.
begin;
select plan(9);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('d5000000-0000-0000-0000-000000000001','authenticated','authenticated','r5-owner@example.test','',now(),'{}','{}',now(),now()),
 ('d5000000-0000-0000-0000-000000000002','authenticated','authenticated','r5-other@example.test','',now(),'{}','{}',now(),now());
insert into crdc.researchers(researcher_id,auth_user_id,full_name,applicant_type,national_id,degree_id,specialty,email)
values
 ('f5000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000001','R5 Owner','egyptian','29001010101051',1,'Original','r5-owner@example.test'),
 ('f5000000-0000-0000-0000-000000000002','d5000000-0000-0000-0000-000000000002','R5 Other','egyptian','29001010101052',1,'Other','r5-other@example.test');

select set_config('request.jwt.claims','{"sub":"d5000000-0000-0000-0000-000000000001","role":"authenticated","email":"r5-owner@example.test"}',true);
set local role authenticated;
select lives_ok($$update crdc.researchers set full_name='R5 Updated', specialty='Updated specialty', degree_id=2 where researcher_id='f5000000-0000-0000-0000-000000000001'$$,'researcher can update allowed fields on their profile');
select is((select full_name from crdc.researchers where researcher_id='f5000000-0000-0000-0000-000000000001'),'R5 Updated','allowed name update persisted');
select is((with changed as (update crdc.researchers set full_name='Unauthorized change' where researcher_id='f5000000-0000-0000-0000-000000000002' returning 1) select count(*)::int from changed),0,'researcher cannot update another profile');
select throws_ok($$update crdc.researchers set applicant_type='foreign' where researcher_id='f5000000-0000-0000-0000-000000000001'$$,'42501',null,'applicant_type is locked');
select throws_ok($$update crdc.researchers set national_id='29001010101053' where researcher_id='f5000000-0000-0000-0000-000000000001'$$,'42501',null,'national_id is locked');
select throws_ok($$update crdc.researchers set passport_no='R5-PASSPORT' where researcher_id='f5000000-0000-0000-0000-000000000001'$$,'42501',null,'passport_no is locked');
select throws_ok($$update crdc.researchers set email='changed@example.test' where researcher_id='f5000000-0000-0000-0000-000000000001'$$,'42501',null,'email is locked');
select throws_ok($$update crdc.researchers set identity_verified_at=now() where researcher_id='f5000000-0000-0000-0000-000000000001'$$,'42501',null,'identity verification timestamp is locked');
reset role;
select is((select full_name from crdc.researchers where researcher_id='f5000000-0000-0000-0000-000000000002'),'R5 Other','other profile remained unchanged');
select * from finish();
rollback;
