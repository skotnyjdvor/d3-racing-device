create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists telemetry_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  device_name text not null default 'LapTrace',
  started_at timestamptz not null,
  ended_at timestamptz not null,
  point_count integer not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, started_at)
);

create index if not exists telemetry_logs_user_started_idx
on telemetry_logs (user_id, started_at desc);

alter table telemetry_logs add column if not exists title text;

create table if not exists ai_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  log_id uuid not null references telemetry_logs(id) on delete cascade,
  cache_key text not null,
  model text not null,
  primary_lap integer,
  comparison_lap integer,
  question text not null default '',
  snapshot jsonb not null,
  report jsonb not null,
  usage jsonb,
  provider_response_id text,
  created_at timestamptz not null default now(),
  unique (user_id, cache_key)
);

create index if not exists ai_analyses_log_created_idx
on ai_analyses (log_id, created_at desc);

alter table users add column if not exists email_verified_at timestamptz;
alter table users add column if not exists token_version integer not null default 0;

create table if not exists auth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('reset', 'verify')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists auth_tokens_user_kind_idx on auth_tokens (user_id, kind, created_at desc);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  number integer generated always as identity,
  user_id uuid references users(id) on delete set null,
  product text not null default 'laptrace',
  quantity integer not null check (quantity between 1 and 100),
  unit_price_cents integer,
  currency text not null default 'EUR',
  name text not null,
  email text not null,
  phone text,
  country text not null,
  address text not null,
  note text,
  language text not null default 'ru',
  status text not null default 'preorder' check (status in ('preorder', 'awaiting_payment', 'paid', 'shipped', 'cancelled')),
  payment_provider text,
  payment_reference text,
  created_at timestamptz not null default now()
);

create index if not exists orders_user_created_idx on orders (user_id, created_at desc);
create index if not exists orders_email_idx on orders (email);

-- Read-only links to one log, so a pilot can compare laps with someone else's session.
create table if not exists log_shares (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references telemetry_logs(id) on delete cascade,
  owner_id uuid not null references users(id) on delete cascade,
  token text not null unique,
  pilot_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists log_shares_log_idx on log_shares (log_id, created_at desc);
