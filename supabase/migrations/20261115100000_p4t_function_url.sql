-- Задания pg_cron берут адрес Edge Function из p4t.config ('function_url'), а не из кода миграции.
-- Значение записывает ?bootstrap. Для установок, настроенных раньше:
--   insert into p4t.config (key, value) values ('function_url', 'https://<project-ref>.supabase.co/functions/v1/plans-for-two')
--   on conflict (key) do update set value = excluded.value;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'p4t-reminders') then perform cron.unschedule('p4t-reminders'); end if;
  if exists (select 1 from cron.job where jobname = 'p4t-broadcasts') then perform cron.unschedule('p4t-broadcasts'); end if;
end $$;

select cron.schedule('p4t-reminders', '*/10 * * * *', $job$
  select net.http_post(
    url := u.value || '?cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', c.value),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  from p4t.config c join p4t.config u on u.key = 'function_url'
  where c.key = 'cron_secret'
$job$);

select cron.schedule('p4t-broadcasts', '* * * * *', $job$
  select net.http_post(
    url := u.value || '?broadcast',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', c.value),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  from p4t.config c join p4t.config u on u.key = 'function_url'
  where c.key = 'cron_secret' and exists (select 1 from p4t.broadcasts where status in ('queued', 'sending'))
$job$);
