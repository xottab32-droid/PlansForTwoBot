-- Лимиты повторов: окончательные ошибки получают статус failed и больше не повторяются.
-- Только расширяет допустимые статусы, данные не меняет.
alter table p4t.updates drop constraint if exists updates_status_check;
alter table p4t.updates add constraint updates_status_check
  check (status in ('processing', 'retry', 'done', 'failed'));

alter table p4t.reminder_deliveries drop constraint if exists reminder_deliveries_status_check;
alter table p4t.reminder_deliveries add constraint reminder_deliveries_status_check
  check (status in ('pending', 'sending', 'sent', 'skipped', 'blocked', 'failed'));
