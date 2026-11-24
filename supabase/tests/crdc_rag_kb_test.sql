begin;
select plan(6);

select has_table('crdc', 'kb_chunks', 'crdc.kb_chunks table exists');

select is(
  crdc.normalize_arabic('أكاديمية السادات للعلوم الإدارية'),
  'اكاديميه السادات للعلوم الاداريه',
  'normalize_arabic normalizes hamza and ta marbuta'
);

select ok(
  (select count(*) from crdc.kb_chunks) >= 48,
  'kb_chunks contains at least the 48 seeded chunks'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', true);

select throws_ok(
  $$ insert into crdc.kb_chunks (source, audience, section, content, content_hash)
     values ('test', 'all', 'sec', 'body', 'hash_test_unauth') $$,
  '42501',
  null,
  'non-admin authenticated user cannot insert into kb_chunks'
);

select ok(
  (select count(*) from crdc.search_kb('الرسالة العلمية', 'all', 5)) >= 1,
  'search_kb finds relevant Arabic chunks'
);

select is(
  (select count(*)::int from crdc.search_kb('الرسالة العلمية', 'egyptian', 20) where audience = 'expat'),
  0,
  'search_kb filters out expat chunks when audience is egyptian'
);

select * from finish();
rollback;
