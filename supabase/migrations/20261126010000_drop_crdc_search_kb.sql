begin;

drop function if exists crdc.search_kb(text, text, integer);
drop policy if exists kb_chunks_admin_all on crdc.kb_chunks;
drop table if exists crdc.kb_chunks cascade;

commit;