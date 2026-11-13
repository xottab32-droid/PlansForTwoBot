-- Дополнительные поля каталога подарков без фотографий и приватных списков идей.
-- Только расширение существующей p4t.gifts, никакие желания не удаляются.
alter table p4t.gifts add column if not exists category text not null default 'other'
  check (category in ('tech','clothes','beauty','home','experience','other'));
alter table p4t.gifts add column if not exists occasion text not null default 'any'
  check (occasion in ('any','birthday','anniversary','newyear'));
create index if not exists gifts_budget_idx on p4t.gifts(couple_id, owner_id, price)
  where received_at is null and price is not null;
