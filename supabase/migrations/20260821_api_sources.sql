-- 관리자 등록 공식 API의 공통 설정 저장소
create table if not exists public.api_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider_url text not null,
  documentation_url text,
  base_url text not null,
  auth_location text not null default 'none'
    check (auth_location in ('none', 'query', 'header')),
  auth_name text,
  secret_name text,
  method text not null default 'GET'
    check (method in ('GET', 'POST')),
  request_params jsonb not null default '{}'::jsonb,
  request_headers jsonb not null default '{}'::jsonb,
  response_path text not null,
  code_parameter text,
  legal_review text not null default 'pending'
    check (legal_review in ('pending', 'approved', 'rejected')),
  legal_notes text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists api_sources_name_idx on public.api_sources (lower(name));
alter table public.api_sources enable row level security;
