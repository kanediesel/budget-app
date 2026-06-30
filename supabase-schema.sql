-- Run this once in your Supabase project: SQL Editor → paste → Run.
-- Tables are accessed only via the server (service-role key), so RLS is on with no public
-- policies (service role bypasses RLS; the anon/publishable key can't read these).

create table if not exists app_users (
  id           uuid primary key default gen_random_uuid(),
  email        text unique not null,
  display_name text,
  created_at   timestamptz default now()
);

create table if not exists webauthn_credentials (
  id          text primary key,                 -- base64url credential ID
  user_id     uuid not null references app_users(id) on delete cascade,
  public_key  text not null,                     -- base64url
  counter     bigint not null default 0,
  transports  text[],
  created_at  timestamptz default now()
);
create index if not exists idx_webauthn_user on webauthn_credentials(user_id);

-- per-budget targets (set in the app). budget_key: grocery|eatingOut|entertainment|vacation|savings
create table if not exists budget_targets (
  budget_key text primary key,
  amount     numeric not null default 0,
  period     text not null default 'monthly',   -- monthly | annual
  updated_at timestamptz default now()
);
alter table budget_targets enable row level security;

alter table app_users enable row level security;
alter table webauthn_credentials enable row level security;
-- (no policies on purpose — only the server's service-role key touches these)

-- Plaid connected accounts (moved off the local items.json so the sync can run on Render).
-- access_token + the incremental cursor live here; touched ONLY by the server's service key.
create table if not exists plaid_items (
  label        text primary key,                 -- e.g. "B-Capital One", "Citi", "USAA"
  access_token text not null,
  cursor       text,                              -- Plaid transactionsSync cursor (incremental)
  accounts     jsonb not null default '[]',       -- [{account_id, name, mask, subtype}]
  updated_at   timestamptz default now()
);
alter table plaid_items enable row level security;
