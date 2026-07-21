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
