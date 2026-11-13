-- Надёжные webhook updates и повторяемые напоминания.
-- Эта миграция добавляет таблицы/поля, не меняя данные пар.
alter table p4t.updates add column if not exists status text not null default 'done'
  check (status in ('processing', 'retry', 'done'));
alter table p4t.updates add column if not exists claimed_at timestamptz;
alter table p4t.updates add column if not exists finished_at timestamptz;
alter table p4t.updates add column if not exists attempts integer not null default 0;

create table if not exists p4t.reminder_deliveries (
  id bigint generated always as identity primary key,
  couple_id uuid not null references p4t.couples(id) on delete cascade,
  reminder_key text not null,
  tg_id bigint not null references p4t.users(tg_id) on delete cascade,
  body text not null,
  reply_markup jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'skipped', 'blocked')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (couple_id, reminder_key, tg_id)
);
create index if not exists reminder_deliveries_ready_idx
  on p4t.reminder_deliveries(next_attempt_at, id)
  where status in ('pending', 'sending');

alter table p4t.reminder_deliveries enable row level security;
revoke all on p4t.reminder_deliveries from public, anon, authenticated, service_role;
grant select, insert on p4t.reminder_deliveries to p4t_app;
create policy reminder_deliveries_own on p4t.reminder_deliveries
  for all to p4t_app using (couple_id = p4t.cur()) with check (couple_id = p4t.cur());
grant usage on all sequences in schema p4t to p4t_app;

-- Быстрая повторная доставка при временном сбое Telegram.
select cron.schedule('p4t-reminder-deliveries', '* * * * *', $job$
  select net.http_post(
    url := u.value || '?deliver',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', c.value),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  from p4t.config c join p4t.config u on u.key = 'function_url'
  where c.key = 'cron_secret'
    and exists (
      select 1 from p4t.reminder_deliveries
      where (status = 'pending' and next_attempt_at <= now())
         or (status = 'sending' and claimed_at < now() - interval '3 minutes')
    )
$job$);
