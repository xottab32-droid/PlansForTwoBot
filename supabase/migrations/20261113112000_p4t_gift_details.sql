-- Дополнительные поля каталога подарков без фотографий и приватных списков идей.
-- Только расширение существующей p4t.gifts, никакие желания не удаляются.
alter table p4t.gifts add column if not exists category text not null default 'other'
  check (category in ('tech','clothes','beauty','home','experience','other'));
alter table p4t.gifts add column if not exists occasion text not null default 'any'
  check (occasion in ('any','birthday','anniversary','newyear'));
create index if not exists gifts_budget_idx on p4t.gifts(couple_id, owner_id, price)
  where received_at is null and price is not null;

-- Дата выбирается только дарителем, запись остаётся под существующей RLS-политикой gift_plans_own.
alter table p4t.gift_plans add column if not exists remind_on date;
create index if not exists gift_plans_remind_idx on p4t.gift_plans(couple_id, remind_on)
  where remind_on is not null;

-- Обычные напоминания видны паре, а личные подарочные — только адресату.
-- Воркер планировщика вставляет строки с p4t.user = NULL, поэтому INSERT разрешён всей паре.
drop policy if exists reminder_deliveries_own on p4t.reminder_deliveries;
create policy reminder_deliveries_read on p4t.reminder_deliveries for select to p4t_app
  using (couple_id = p4t.cur() and
    (reminder_key not like 'grem:%' or tg_id = p4t.me()));
create policy reminder_deliveries_insert on p4t.reminder_deliveries for insert to p4t_app
  with check (couple_id = p4t.cur());
