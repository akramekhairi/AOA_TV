-- Single household state uses optimistic version compare-and-swap. Service role only.
create table if not exists public.aoa_catalog (
  id text primary key check (id = 'top'),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.aoa_catalog enable row level security;
revoke all on public.aoa_catalog from anon, authenticated;
create table if not exists public.aoa_state (
  id text primary key check (id = 'home'),
  version bigint not null default 0,
  payload jsonb not null
);
alter table public.aoa_state enable row level security;
revoke all on public.aoa_state from anon, authenticated;
insert into public.aoa_state(id,payload) values ('home', '{"devices":{},"pairings":{},"commands":{},"favorites":[],"progress":{},"subtitles":{},"tv":{"online":false,"state":"idle"}}') on conflict do nothing;
insert into storage.buckets(id,name,public,file_size_limit) values ('aoa-private-assets','aoa-private-assets',false,10485760) on conflict(id) do nothing;
create table if not exists public.aoa_content (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.aoa_content enable row level security;
revoke all on public.aoa_content from anon, authenticated;
