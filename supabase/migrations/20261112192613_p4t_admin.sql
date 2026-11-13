-- Админ-панель PlansForTwoBot: статистика активности (без личных данных) и рассылки.
-- Только добавление: существующие данные не меняются.

-- Активность: последний визит, отписка от новостей, блокировка бота
alter table p4t.users add column if not exists last_seen_at timestamptz;
alter table p4t.users add column if not exists news boolean not null default true;
alter table p4t.users add column if not exists blocked_at timestamptz;
update p4t.users set last_seen_at = coalesce(last_seen_at, updated_at);
create index if not exists users_last_seen_idx on p4t.users(last_seen_at);

-- Счётчик обращений по дням (одна строка на пользователя в день; хранится 400 дней)
create table if not exists p4t.activity (
  tg_id bigint not null references p4t.users(tg_id) on delete cascade,
  day date not null,
  hits integer not null default 1,
  primary key (tg_id, day)
);
create index if not exists activity_day_idx on p4t.activity(day);
insert into p4t.activity (tg_id, day, hits)
  select tg_id, (coalesce(last_seen_at, created_at) at time zone 'UTC')::date, 1 from p4t.users
  on conflict do nothing;

-- Рассылки
create table if not exists p4t.broadcasts (
  id bigint generated always as identity primary key,
  created_by bigint not null,
  segment text not null,
  src_chat bigint not null,
  src_msg bigint not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'done', 'canceled')),
  total integer not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create table if not exists p4t.broadcast_recipients (
  broadcast_id bigint not null references p4t.broadcasts(id) on delete cascade,
  tg_id bigint not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'blocked', 'skipped')),
  claimed_at timestamptz,
  error text,
  primary key (broadcast_id, tg_id)
);
create index if not exists broadcast_recipients_pending_idx on p4t.broadcast_recipients(broadcast_id) where status in ('pending', 'sending');

-- Закрыто для всех ролей Data API и для роли пар p4t_app (доступ только у функции под владельцем)
alter table p4t.activity enable row level security;
alter table p4t.broadcasts enable row level security;
alter table p4t.broadcast_recipients enable row level security;
revoke all on p4t.activity, p4t.broadcasts, p4t.broadcast_recipients from public;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'p4t_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on p4t.activity, p4t.broadcasts, p4t.broadcast_recipients from %I', r);
    end if;
  end loop;
end $$;

-- Администраторы бота: Telegram ID через запятую. По умолчанию пусто — админки нет ни у кого.
-- Назначить себя: update p4t.config set value = '<твой Telegram ID>' where key = 'admin_ids';
insert into p4t.config (key, value) values ('admin_ids', '') on conflict (key) do nothing;

-- Обработчик рассылок: раз в минуту, только если есть незавершённая рассылка
do $$ begin
  if exists (select 1 from cron.job where jobname = 'p4t-broadcasts') then
    perform cron.unschedule('p4t-broadcasts');
  end if;
end $$;
select cron.schedule(
  'p4t-broadcasts',
  '* * * * *',
  $job$
  select net.http_post(
    url := u.value || '?broadcast',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', c.value),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  from p4t.config c join p4t.config u on u.key = 'function_url'
  where c.key = 'cron_secret' and exists (select 1 from p4t.broadcasts where status in ('queued', 'sending'))
  $job$
);
