-- M6 billing: subscriptions + usage_events (applied 2026-08-29). RLS enabled
-- (backend connects as postgres, bypasses RLS; blocks direct anon access).
create table if not exists subscriptions (
  id text primary key default gen_random_uuid()::text,
  user_id text not null,
  plan text not null default 'free',
  status text not null default 'active',
  provider text, provider_customer_id text, provider_sub_id text,
  current_period_start timestamptz default now(),
  current_period_end timestamptz,
  created_at timestamptz default now());
create index if not exists ix_subscriptions_user_id on subscriptions(user_id);

create table if not exists usage_events (
  id text primary key default gen_random_uuid()::text,
  user_id text not null,
  project_id text,
  kind text not null default 'transcription',
  minutes integer not null default 0,
  created_at timestamptz default now());
create index if not exists ix_usage_events_user_id on usage_events(user_id);
create index if not exists ix_usage_events_created_at on usage_events(created_at);

alter table subscriptions enable row level security;
alter table usage_events enable row level security;
