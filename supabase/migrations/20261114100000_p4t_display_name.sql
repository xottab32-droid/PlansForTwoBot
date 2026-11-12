-- Своё имя в паре вместо имени из Telegram. Только добавление колонки.
alter table p4t.users add column if not exists display_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_display_name_len') then
    alter table p4t.users add constraint users_display_name_len
      check (display_name is null or char_length(display_name) between 1 and 32);
  end if;
end $$;
