-- Bảng log click (1 record = 1 GET/redirect)
create table if not exists public.cf_logs (
  id bigserial primary key,
  site_id uuid references public.sites(id) on delete set null,
  path text not null,
  ip text,
  ua text,
  created_at timestamptz not null default now()
);

-- Index phục vụ truy vấn 24h
create index if not exists idx_cf_logs_site_path_time
  on public.cf_logs (site_id, path, created_at desc);

-- RLS + Policies
alter table public.cf_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='cf_logs' and policyname='cf_logs_insert_anon'
  ) then
    create policy cf_logs_insert_anon
      on public.cf_logs
      for insert
      to anon
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='cf_logs' and policyname='cf_logs_select_authenticated'
  ) then
    create policy cf_logs_select_authenticated
      on public.cf_logs
      for select
      to authenticated, service_role
      using (true);
  end if;
end$$;

-- Views cho dashboard
create or replace view public.v_clicks_last24h as
select site_id, path, count(*)::bigint as clicks_24h
from public.cf_logs
where created_at >= now() - interval '24 hours'
group by site_id, path;

create or replace view public.v_clicks_alltime as
select site_id, path, count(*)::bigint as clicks_all
from public.cf_logs
group by site_id, path;
