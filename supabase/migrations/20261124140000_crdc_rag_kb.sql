begin;

create extension if not exists pg_trgm with schema public;

create or replace function crdc.normalize_arabic(p_text text)
returns text
language sql
immutable
strict
as $$
  select trim(
    regexp_replace(
      regexp_replace(
        translate(
          regexp_replace(
            coalesce(p_text, ''),
            E'[\u064B-\u065F\u0670\u0640]', '', 'g'
          ),
          'أإآٱةى',
          'ااااهي'
        ),
        '[^[:alnum:][:space:]]', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

create table if not exists crdc.kb_chunks (
  chunk_id bigint generated always as identity primary key,
  source text not null,
  audience text not null default 'all' check (audience in ('all', 'egyptian', 'expat', 'notes', 'staff')),
  section text not null,
  content text not null,
  normalized_content text generated always as (
    crdc.normalize_arabic(section || ' ' || content)
  ) stored,
  search_tsv tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(crdc.normalize_arabic(section), '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(crdc.normalize_arabic(content), '')), 'B')
  ) stored,
  content_hash text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_kb_chunks_tsv
  on crdc.kb_chunks using gin (search_tsv);

create index if not exists idx_kb_chunks_trgm
  on crdc.kb_chunks using gin (normalized_content public.gin_trgm_ops);

create index if not exists idx_kb_chunks_audience_active
  on crdc.kb_chunks (audience, is_active);

alter table crdc.kb_chunks enable row level security;
alter table crdc.kb_chunks force row level security;

drop policy if exists kb_chunks_admin_all on crdc.kb_chunks;
create policy kb_chunks_admin_all
  on crdc.kb_chunks
  for all
  to authenticated
  using (private.current_crdc_staff_role() = 'admin')
  with check (private.current_crdc_staff_role() = 'admin');

grant select, insert, update, delete on crdc.kb_chunks to authenticated;
grant usage, select on sequence crdc.kb_chunks_chunk_id_seq to authenticated;

create or replace function crdc.search_kb(
  p_query text,
  p_audience text default 'all',
  p_limit integer default 5
)
returns table (
  chunk_id bigint,
  source text,
  section text,
  content text,
  audience text,
  score real
)
language plpgsql
stable
security definer
set search_path = crdc, public
as $$
declare
  v_norm text;
  v_tsquery tsquery;
  v_aud text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_limit is null or p_limit not between 1 and 20 then
    raise exception 'p_limit must be between 1 and 20' using errcode = '22023';
  end if;

  v_aud := coalesce(nullif(trim(p_audience), ''), 'all');
  if v_aud not in ('all', 'egyptian', 'expat', 'notes', 'staff') then
    raise exception 'Invalid audience filter' using errcode = '22023';
  end if;

  v_norm := crdc.normalize_arabic(coalesce(p_query, ''));
  if length(v_norm) < 2 then
    return;
  end if;

  v_tsquery := websearch_to_tsquery('simple', v_norm);

  return query
  with scored as (
    select
      k.chunk_id,
      k.source,
      k.section,
      k.content,
      k.audience,
      (
        coalesce(ts_rank_cd(k.search_tsv, v_tsquery), 0.0) * 2.0 +
        coalesce(public.word_similarity(v_norm, k.normalized_content), 0.0)
      )::real as total_score
    from crdc.kb_chunks k
    where k.is_active = true
      and (
        v_aud = 'staff'
        or k.audience = 'all'
        or k.audience = v_aud
      )
      and (
        k.search_tsv @@ v_tsquery
        or public.word_similarity(v_norm, k.normalized_content) >= 0.35
      )
  )
  select s.chunk_id, s.source, s.section, s.content, s.audience, s.total_score
  from scored s
  order by s.total_score desc, s.chunk_id asc
  limit p_limit;
end;
$$;

revoke all on function crdc.normalize_arabic(text) from public;
grant execute on function crdc.normalize_arabic(text) to authenticated;

revoke all on function crdc.search_kb(text, text, integer) from public, anon;
grant execute on function crdc.search_kb(text, text, integer) to authenticated;

commit;