-- Private Android widget tokens; never exposed through the Supabase Data API.
create table if not exists p4t.widget_devices (
  code_hash text primary key check (code_hash ~ '^[a-f0-9]{64}$'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  ip_hash text not null,
  tg_id bigint references p4t.users(tg_id) on delete cascade,
  couple_id uuid references p4t.couples(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '10 minutes'),
  linked_at timestamptz,
  revoked_at timestamptz,
  constraint widget_device_link_consistency check (
    (linked_at is null and tg_id is null and couple_id is null) or
    (linked_at is not null and tg_id is not null and couple_id is not null)
  )
);
create index if not exists widget_devices_user_idx on p4t.widget_devices(tg_id) where revoked_at is null;
create index if not exists widget_devices_rate_idx on p4t.widget_devices(ip_hash,created_at);
alter table p4t.widget_devices enable row level security;
revoke all on p4t.widget_devices from public,anon,authenticated,service_role;
-- Only trusted Edge Functions using direct postgres access can write device records.
