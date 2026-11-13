-- Желания и подарки. Желание видит вся пара, менять его может только владелец.
-- Отметки дарителя («выбрал», «купил») — в отдельной таблице, которую видит только сам даритель:
-- RLS скрывает строки, а не колонки, поэтому отметки нельзя хранить в самой p4t.gifts.
-- Только добавляет объекты, существующие данные не меняет.

-- Кто действует: выставляется в inCouple() вместе с p4t.couple
create function p4t.me() returns bigint language sql stable set search_path = '' as $$
  select nullif(current_setting('p4t.user', true), '')::bigint
$$;
revoke all on function p4t.me() from public;
grant execute on function p4t.me() to p4t_app;

-- Чей день рождения (для подсказок дарителю). null — другой человек или не указано.
alter table p4t.events add column if not exists person_id bigint;

create table p4t.gifts (
  id bigint generated always as identity primary key,
  couple_id uuid not null references p4t.couples(id) on delete cascade,
  owner_id bigint not null,
  title text not null check (length(title) between 1 and 100),
  price numeric(14,2) check (price > 0 and price < 1000000000000),
  priority smallint not null default 2 check (priority between 1 and 3),
  url text check (length(url) <= 500 and url ~ '^https?://\S+$'),
  note text check (length(note) <= 500),
  received_at timestamptz,
  given_by bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, couple_id)
);
create index gifts_couple_owner_idx on p4t.gifts(couple_id, owner_id, received_at);

create table p4t.gift_plans (
  gift_id bigint primary key,
  couple_id uuid not null,
  giver_id bigint not null,
  status text not null check (status in ('picked', 'bought')),
  updated_at timestamptz not null default now(),
  foreign key (gift_id, couple_id) references p4t.gifts(id, couple_id) on delete cascade
);
create index gift_plans_giver_idx on p4t.gift_plans(couple_id, giver_id);

alter table p4t.gifts enable row level security;
alter table p4t.gift_plans enable row level security;
revoke all on p4t.gifts, p4t.gift_plans from public, anon, authenticated, service_role;
grant select, insert, update, delete on p4t.gifts, p4t.gift_plans to p4t_app;
grant usage on all sequences in schema p4t to p4t_app;

create policy gifts_read on p4t.gifts for select to p4t_app using (couple_id = p4t.cur());
create policy gifts_insert on p4t.gifts for insert to p4t_app
  with check (couple_id = p4t.cur() and owner_id = p4t.me());
create policy gifts_update on p4t.gifts for update to p4t_app
  using (couple_id = p4t.cur() and owner_id = p4t.me())
  with check (couple_id = p4t.cur() and owner_id = p4t.me());
create policy gifts_delete on p4t.gifts for delete to p4t_app
  using (couple_id = p4t.cur() and owner_id = p4t.me());

create policy gift_plans_own on p4t.gift_plans for all to p4t_app
  using (couple_id = p4t.cur() and giver_id = p4t.me())
  with check (couple_id = p4t.cur() and giver_id = p4t.me()
    and exists (select 1 from p4t.gifts g where g.id = gift_id and g.owner_id <> p4t.me() and g.received_at is null));

-- «Подарил»: единственное изменение чужого желания — отметить его полученным от себя
create function p4t.gift_given(p_gift bigint) returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p4t.me() is null or p4t.cur() is null then return false; end if;
  if not exists (select 1 from p4t.users u where u.tg_id = p4t.me() and u.couple_id = p4t.cur()) then return false; end if;
  update p4t.gifts set received_at = now(), given_by = p4t.me(), updated_at = now()
    where id = p_gift and couple_id = p4t.cur() and owner_id <> p4t.me() and received_at is null;
  get diagnostics n = row_count;
  if n > 0 then delete from p4t.gift_plans where gift_id = p_gift; end if;
  return n > 0;
end $$;
revoke all on function p4t.gift_given(bigint) from public;
grant execute on function p4t.gift_given(bigint) to p4t_app;
