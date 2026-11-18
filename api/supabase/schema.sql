-- Supabase schema for the ESP32-CAM home security backend.
-- Documents are stored as JSONB, one table per Cosmos container, with the columns we filter on
-- pulled out. Only the API server touches these tables, using the service-role key, so RLS is
-- enabled with no policies: the publishable/anon key can read or write nothing.

create table if not exists public.devices (
  device_id    text primary key,
  household_id text not null default '',
  doc          jsonb not null,
  updated_at   timestamptz not null default now()
);
create index if not exists devices_household_idx on public.devices (household_id);

create table if not exists public.events (
  device_id    text not null,
  id           text not null,
  ts           bigint not null,
  type         text not null,
  acknowledged boolean not null default false,
  doc          jsonb not null,
  primary key (device_id, id)
);
create index if not exists events_device_ts_idx on public.events (device_id, ts desc);
create index if not exists events_unacked_idx on public.events (ts desc) where acknowledged = false;

create table if not exists public.device_config (
  device_id  text primary key,
  doc        jsonb not null,
  updated_at timestamptz not null default now()
);

-- users, households, invites, telegram links, link codes, push subscriptions (the Cosmos `users` container)
create table if not exists public.accounts (
  type         text not null,
  id           text not null,
  household_id text not null,
  email        text,
  doc          jsonb not null,
  primary key (type, id)
);
create index if not exists accounts_household_idx on public.accounts (household_id, type);
create unique index if not exists accounts_user_email_idx on public.accounts (email) where type = 'user';

-- Cloud-to-device command queue. The device fetches and deletes its rows over HTTPS.
create table if not exists public.device_commands (
  id         bigint generated always as identity primary key,
  device_id  text not null,
  command    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists device_commands_device_idx on public.device_commands (device_id, id);

alter table public.devices         enable row level security;
alter table public.events          enable row level security;
alter table public.device_config   enable row level security;
alter table public.accounts        enable row level security;
alter table public.device_commands enable row level security;

-- Private bucket for evidence photos; access only through signed URLs minted by the API.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 2000000, array['image/jpeg'])
on conflict (id) do nothing;
