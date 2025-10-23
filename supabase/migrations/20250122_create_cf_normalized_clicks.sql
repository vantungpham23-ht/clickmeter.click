-- Bảng cache dữ liệu normalized clicks
create table if not exists public.cf_normalized_clicks (
  site_id uuid references public.sites(id) on delete cascade,
  path text not null default '/',
  click_date date not null default current_date,
  clicks_24h bigint not null default 0,
  created_at timestamptz default now(),
  primary key (site_id, path, click_date)
);

create index if not exists idx_cf_normalized_clicks_site_date
  on public.cf_normalized_clicks (site_id, click_date desc);

-- Enable RLS
alter table public.cf_normalized_clicks enable row level security;

-- Create policy for users to access their own data
create policy "Users can view their own normalized clicks" on public.cf_normalized_clicks
  for select using (
    site_id in (
      select id from public.sites where user_id = auth.uid()
    )
  );

-- Create policy for service role to insert/update
create policy "Service role can manage normalized clicks" on public.cf_normalized_clicks
  for all using (true);
