BEGIN;
SELECT plan(5);

-- Structural baseline for the CRDC database draft. Run with `supabase test db`.
SELECT has_table('crdc', 'services', 'service catalog exists');
SELECT is(
  (SELECT count(*)::integer FROM information_schema.tables
   WHERE table_schema = 'crdc' AND table_type = 'BASE TABLE'),
  15,
  'CRDC schema has the expected 15 tables'
);
SELECT is(
  (SELECT count(*)::integer FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'crdc' AND c.relkind = 'r' AND c.relrowsecurity),
  15,
  'RLS is enabled on every CRDC table'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conrelid = 'crdc.request_items'::regclass
            AND conname = 'ri_pay_fk'),
  'payment link enforces request and currency consistency'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conrelid = 'crdc.publication_submissions'::regclass
            AND conname = 'ps_item_fk'),
  'publication metadata references a publication service item'
);

SELECT * FROM finish();
ROLLBACK;
