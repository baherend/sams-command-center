begin;
select plan(3);

select hasnt_function(
  'crdc',
  'search_kb',
  array['text', 'text', 'integer'],
  'crdc.search_kb function has been dropped'
);

select hasnt_table(
  'crdc',
  'kb_chunks',
  'crdc.kb_chunks table has been dropped'
);

select is(
  crdc.normalize_arabic('أكاديمية السادات للعلوم الإدارية'),
  'اكاديميه السادات للعلوم الاداريه',
  'normalize_arabic normalizes hamza and ta marbuta'
);

select * from finish();
rollback;