-- =====================================================================
-- CRDC portal schema (v1) - Consulting, Research & Development Center
-- 15 tables in schema "crdc". Draft for PostgreSQL 15+ / Supabase; not yet executed.
-- Run once, on an empty database. Everything is inside one transaction.
-- Row Level Security is enabled on every table with NO policies
-- (deny-by-default); policies come in a later step.
-- =====================================================================
begin;
create schema crdc;

-- ---------- reference tables ----------
create table crdc.services (
  service_id smallint primary key,            -- PUB is fixed at id 1 (see publication_submissions)
  code       text not null unique,
  name_ar    text not null,
  is_active  boolean not null default true);

create table crdc.requirement_types (
  requirement_code text primary key,
  service_id       smallint not null references crdc.services,
  name_ar          text not null,
  sort_order       smallint not null unique);

create table crdc.fee_schedule (
  fee_id           smallint generated always as identity primary key,
  service_id       smallint not null references crdc.services,
  option_code      text not null,
  applicant_type   text not null check (applicant_type in ('egyptian','foreign')),
  currency         char(3) not null check (currency in ('EGP','USD')),
  base_fee         numeric(10,2) not null check (base_fee >= 0),
  included_pages   int check (included_pages > 0),
  extra_page_fee   numeric(10,2) check (extra_page_fee >= 0),
  certificate_fee  numeric(10,2) not null default 0 check (certificate_fee >= 0),
  requirement_code text references crdc.requirement_types,
  unique (option_code, applicant_type),
  constraint fee_schedule_key unique (fee_id, service_id, applicant_type, currency),
  check ((applicant_type = 'egyptian' and currency = 'EGP')
      or (applicant_type = 'foreign'  and currency = 'USD')));

create table crdc.degrees (
  degree_id smallint primary key,
  code      text not null unique,
  name_ar   text not null,
  track     text not null check (track in ('academic','professional')),
  level     text not null check (level in ('masters','phd')));

create table crdc.degree_requirements (
  degree_id        smallint not null references crdc.degrees,
  requirement_code text not null references crdc.requirement_types,
  min_count        smallint not null default 1 check (min_count > 0),
  primary key (degree_id, requirement_code));

create table crdc.journals (
  journal_id      smallint primary key,
  code            text not null unique,
  name_ar         text not null,
  issues_per_year smallint not null check (issues_per_year between 1 and 12));

create table crdc.journal_issues (
  issue_id            int generated always as identity primary key,
  journal_id          smallint not null references crdc.journals,
  issue_year          smallint not null,
  issue_month         smallint not null check (issue_month between 1 and 12),
  submission_deadline date,                    -- unknown until confirmed with the center
  unique (journal_id, issue_year, issue_month),
  constraint journal_issues_key unique (issue_id, journal_id));

create table crdc.request_statuses (
  status_id  smallint primary key,
  code       text not null unique,
  name_ar    text not null,
  sort_order smallint not null unique,
  is_final   boolean not null default false);

-- ---------- people ----------
create table crdc.researchers (
  researcher_id  uuid primary key default gen_random_uuid(),
  auth_user_id   uuid unique,                  -- will point to Supabase auth.users when RLS/login is wired
  full_name      text not null,
  applicant_type text not null check (applicant_type in ('egyptian','foreign')),
  nationality    text,
  national_id    text,
  passport_no    text,
  degree_id      smallint references crdc.degrees,
  specialty      text,
  email          text not null unique,
  created_at     timestamptz not null default now(),
  constraint researchers_key unique (researcher_id, applicant_type),
  check ((applicant_type = 'egyptian' and national_id is not null)
      or (applicant_type = 'foreign' and passport_no is not null and nationality is not null)));

create table crdc.staff_users (
  staff_id     uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  full_name    text not null,
  role         text not null check (role in ('admin','reviewer','statistician','cashier','viewer')),
  is_active    boolean not null default true);

-- ---------- operations ----------
create table crdc.service_requests (
  request_id     bigint generated always as identity primary key,
  researcher_id  uuid not null,
  applicant_type text not null,                -- copied from the researcher by trigger
  work_type      text not null check (work_type in ('paper','thesis')),
  work_title     text not null,
  page_count     int check (page_count > 0),
  created_at     timestamptz not null default now(),
  constraint sr_researcher_fk foreign key (researcher_id, applicant_type)
    references crdc.researchers (researcher_id, applicant_type),
  constraint sr_key unique (request_id, applicant_type));

create table crdc.payments (
  payment_id       bigint generated always as identity primary key,
  request_id       bigint not null references crdc.service_requests,
  payment_order_no text,
  receipt_no       text,
  amount           numeric(10,2) not null check (amount > 0),
  currency         char(3) not null check (currency in ('EGP','USD')),
  channel          text not null check (channel in ('treasury','bank')),
  paid_at          date,
  constraint payments_key unique (payment_id, request_id, currency));

create table crdc.request_items (
  item_id           bigint generated always as identity primary key,
  request_id        bigint not null,
  fee_id            smallint not null,
  service_id        smallint not null,         -- service_id / applicant_type / currency are copied
  applicant_type    text not null,             -- from fee_schedule by trigger and then verified
  currency          char(3) not null,          -- by the composite foreign keys below
  payment_id        bigint,
  status_id         smallint not null references crdc.request_statuses,
  amount_due        numeric(10,2) not null check (amount_due >= 0),   -- snapshot of the fee at request time
  assigned_staff_id uuid references crdc.staff_users,
  created_at        timestamptz not null default now(),
  constraint ri_fee_fk foreign key (fee_id, service_id, applicant_type, currency)
    references crdc.fee_schedule (fee_id, service_id, applicant_type, currency),
  constraint ri_req_fk foreign key (request_id, applicant_type)
    references crdc.service_requests (request_id, applicant_type),
  constraint ri_pay_fk foreign key (payment_id, request_id, currency)
    references crdc.payments (payment_id, request_id, currency),
  constraint ri_key unique (item_id, service_id));

create table crdc.request_status_history (
  history_id bigint generated always as identity primary key,
  item_id    bigint not null references crdc.request_items,
  status_id  smallint not null references crdc.request_statuses,
  changed_at timestamptz not null default now(),
  changed_by uuid references crdc.staff_users,
  note       text);

create table crdc.publication_submissions (
  submission_id  bigint generated always as identity primary key,
  item_id        bigint not null unique,
  service_id     smallint not null default 1 check (service_id = 1),   -- 1 = PUB: only publication items
  journal_id     smallint not null references crdc.journals,
  issue_id       int,
  paper_language text not null check (paper_language in ('ar','en')),
  decision       text not null default 'pending' check (decision in ('pending','revisions','accepted','rejected')),
  accepted_at    date,
  check (decision <> 'accepted' or accepted_at is not null),
  constraint ps_item_fk  foreign key (item_id, service_id) references crdc.request_items (item_id, service_id),
  constraint ps_issue_fk foreign key (issue_id, journal_id) references crdc.journal_issues (issue_id, journal_id));

-- ---------- indexes (every foreign key has one) ----------
create index on crdc.requirement_types (service_id);
create index on crdc.fee_schedule (service_id);
create index on crdc.fee_schedule (requirement_code);
create index on crdc.degree_requirements (requirement_code);
create index on crdc.researchers (degree_id);
create index on crdc.service_requests (researcher_id);
create index on crdc.payments (request_id);
create index on crdc.request_items (request_id);
create index on crdc.request_items (fee_id);
create index on crdc.request_items (payment_id);
create index on crdc.request_items (status_id);
create index on crdc.request_items (assigned_staff_id);
create index on crdc.request_status_history (item_id, changed_at);
create index on crdc.request_status_history (status_id);
create index on crdc.request_status_history (changed_by);
create index on crdc.publication_submissions (issue_id, journal_id);
create index on crdc.publication_submissions (journal_id);

-- ---------- functions and triggers ----------
create function crdc.calc_fee(p_fee_id smallint, p_pages int) returns numeric
language sql stable set search_path = '' as $$
  select f.base_fee
       + case when f.included_pages is not null and f.extra_page_fee is not null and p_pages is not null
              then greatest(0, p_pages - f.included_pages) * f.extra_page_fee else 0 end
       + f.certificate_fee
  from crdc.fee_schedule f where f.fee_id = p_fee_id $$;

create function crdc.trg_sr_fill() returns trigger language plpgsql set search_path = '' as $$
begin
  select applicant_type into new.applicant_type from crdc.researchers where researcher_id = new.researcher_id;
  return new;
end $$;
create trigger sr_fill before insert on crdc.service_requests
  for each row execute function crdc.trg_sr_fill();

create function crdc.trg_item_fill() returns trigger language plpgsql set search_path = '' as $$
begin
  select service_id, applicant_type, currency into new.service_id, new.applicant_type, new.currency
  from crdc.fee_schedule where fee_id = new.fee_id;
  return new;
end $$;
create trigger item_fill before insert or update of fee_id on crdc.request_items
  for each row execute function crdc.trg_item_fill();

create function crdc.trg_item_hist() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into crdc.request_status_history (item_id, status_id, changed_at)
  values (new.item_id, new.status_id, new.created_at);
  return null;
end $$;
create trigger item_hist after insert on crdc.request_items
  for each row execute function crdc.trg_item_hist();

create function crdc.trg_hist_sync() returns trigger language plpgsql set search_path = '' as $$
begin
  update crdc.request_items set status_id = new.status_id
  where item_id = new.item_id and status_id <> new.status_id
    and not exists (select 1 from crdc.request_status_history h
                    where h.item_id = new.item_id and h.changed_at > new.changed_at);
  return null;
end $$;
create trigger hist_sync after insert on crdc.request_status_history
  for each row execute function crdc.trg_hist_sync();

-- ---------- Row Level Security: on, no policies yet ----------
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'crdc' loop
    execute format('alter table crdc.%I enable row level security', t);
  end loop;
end $$;

commit;
