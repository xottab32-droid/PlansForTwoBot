-- PlansForTwoBot (@PlansForTwoBot): отдельная схема p4t.
-- Таблицы и функции антиспам-бота (public.inbox_*) не затрагиваются.
-- Схема не публикуется через Data API: доступ только у Edge Function через прямое подключение к БД.

create schema if not exists p4t;

-- ---------- служебные таблицы ----------
create table p4t.config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table p4t.updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);

-- ---------- пары и участники ----------
create table p4t.couples (
  id uuid primary key default gen_random_uuid(),
  invite_code text unique check (invite_code ~ '^[A-Z2-9]{8}$'),
  invite_expires_at timestamptz,
  tz text not null default 'Europe/Moscow',
  currency text not null default '₽' check (length(currency) between 1 and 4),
  remind_hour smallint not null default 10 check (remind_hour between 0 and 23),
  remind_days smallint[] not null default '{7,1,0}',
  created_by bigint not null,
  created_at timestamptz not null default now()
);

create table p4t.users (
  tg_id bigint primary key check (tg_id > 0),
  first_name text not null default '',
  username text,
  couple_id uuid references p4t.couples(id) on delete set null,
  state jsonb,
  widgets boolean not null default true,
  quiet boolean not null default false,
  cards jsonb not null default '{}',
  join_fails smallint not null default 0,
  join_window timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index users_couple_idx on p4t.users(couple_id);

-- В паре не больше двух человек (проверка под блокировкой строки пары)
create function p4t.check_members() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.couple_id is not null and (tg_op = 'INSERT' or new.couple_id is distinct from old.couple_id) then
    perform 1 from p4t.couples where id = new.couple_id for update;
    if (select count(*) from p4t.users where couple_id = new.couple_id and tg_id <> new.tg_id) >= 2 then
      raise exception 'couple_full';
    end if;
  end if;
  return new;
end $$;
create trigger users_members_limit before insert or update of couple_id on p4t.users
  for each row execute function p4t.check_members();

-- ---------- данные пары ----------
create table p4t.goals (
  id bigint generated always as identity primary key,
  couple_id uuid not null references p4t.couples(id) on delete cascade,
  title text not null check (length(title) between 1 and 80),
  emoji text not null default '🎯' check (length(emoji) <= 8),
  target numeric(14,2) not null check (target > 0 and target < 1e12),
  deadline date,
  archived boolean not null default false,
  achieved_at timestamptz,
  created_by bigint not null,
  created_at timestamptz not null default now(),
  unique (id, couple_id)
);
create index goals_couple_idx on p4t.goals(couple_id);

-- История бюджета: каждая операция — отдельная запись (пополнение > 0, снятие < 0)
create table p4t.contributions (
  id bigint generated always as identity primary key,
  couple_id uuid not null references p4t.couples(id) on delete cascade,
  goal_id bigint not null,
  user_id bigint not null,
  amount numeric(14,2) not null check (amount <> 0 and abs(amount) < 1e12),
  comment text check (length(comment) <= 200),
  created_at timestamptz not null default now(),
  foreign key (goal_id, couple_id) references p4t.goals(id, couple_id) on delete cascade
);
create index contributions_goal_idx on p4t.contributions(goal_id, created_at desc);

create table p4t.wishes (
  id bigint generated always as identity primary key,
  couple_id uuid not null references p4t.couples(id) on delete cascade,
  category text not null default 'other' check (category in ('food','cafe','show','walk','fun','trip','other')),
  title text not null check (length(title) between 1 and 100),
  note text check (length(note) <= 500),
  done_at timestamptz,
  created_by bigint not null,
  created_at timestamptz not null default now(),
  unique (id, couple_id)
);
create index wishes_couple_idx on p4t.wishes(couple_id);

create table p4t.events (
  id bigint generated always as identity primary key,
  couple_id uuid not null references p4t.couples(id) on delete cascade,
  kind text not null check (kind in ('date','birthday','anniversary','relationship','important','trip')),
  title text not null check (length(title) between 1 and 100),
  event_date date not null,
  event_time time,
  place text check (length(place) <= 150),
  note text check (length(note) <= 500),
  yearly boolean not null default false,
  goal_id bigint,
  wish_id bigint,
  created_by bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, couple_id),
  -- Составные ключи: событие может ссылаться только на цель/желание своей же пары
  foreign key (goal_id, couple_id) references p4t.goals(id, couple_id) on delete set null (goal_id),
  foreign key (wish_id, couple_id) references p4t.wishes(id, couple_id) on delete set null (wish_id)
);
create index events_couple_idx on p4t.events(couple_id, event_date);

-- Отправленные напоминания (защита от дублей)
create table p4t.sent (
  couple_id uuid not null references p4t.couples(id) on delete cascade,
  key text not null,
  created_at timestamptz not null default now(),
  primary key (couple_id, key)
);

-- ---------- изоляция пар: роль без BYPASSRLS + RLS ----------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'p4t_app') then
    create role p4t_app nologin nobypassrls;
  end if;
end $$;
grant p4t_app to postgres;

create function p4t.cur() returns uuid language sql stable set search_path = '' as $$
  select nullif(current_setting('p4t.couple', true), '')::uuid
$$;

alter table p4t.config enable row level security;
alter table p4t.updates enable row level security;
alter table p4t.couples enable row level security;
alter table p4t.users enable row level security;
alter table p4t.goals enable row level security;
alter table p4t.contributions enable row level security;
alter table p4t.wishes enable row level security;
alter table p4t.events enable row level security;
alter table p4t.sent enable row level security;

create policy couple_own on p4t.couples for all to p4t_app using (id = p4t.cur()) with check (id = p4t.cur());
create policy users_own on p4t.users for select to p4t_app using (couple_id = p4t.cur());
create policy goals_own on p4t.goals for all to p4t_app using (couple_id = p4t.cur()) with check (couple_id = p4t.cur());
create policy contrib_own on p4t.contributions for all to p4t_app using (couple_id = p4t.cur()) with check (couple_id = p4t.cur());
create policy wishes_own on p4t.wishes for all to p4t_app using (couple_id = p4t.cur()) with check (couple_id = p4t.cur());
create policy events_own on p4t.events for all to p4t_app using (couple_id = p4t.cur()) with check (couple_id = p4t.cur());
create policy sent_own on p4t.sent for all to p4t_app using (couple_id = p4t.cur()) with check (couple_id = p4t.cur());

-- Никаких прав для ролей Data API
revoke all on schema p4t from public;
revoke all on all tables in schema p4t from public;
revoke all on all functions in schema p4t from public;
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema p4t from %I', r);
      execute format('revoke all on all tables in schema p4t from %I', r);
      execute format('revoke all on all sequences in schema p4t from %I', r);
      execute format('revoke all on all functions in schema p4t from %I', r);
    end if;
  end loop;
end $$;

grant usage on schema p4t to p4t_app;
grant execute on function p4t.cur() to p4t_app;
grant select on p4t.couples, p4t.users to p4t_app;
grant update (tz, currency, remind_hour, remind_days) on p4t.couples to p4t_app;
grant select, insert, update, delete on p4t.goals, p4t.contributions, p4t.wishes, p4t.events to p4t_app;
grant select, insert on p4t.sent to p4t_app;
grant usage on all sequences in schema p4t to p4t_app;
