-- Напоминания PlansForTwoBot: pg_cron раз в 10 минут вызывает Edge Function plans-for-two?cron.
-- Адрес функции и секрет берутся из p4t.config (их записывает ?bootstrap); до настройки задание ничего не делает.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'p4t-reminders') then
    perform cron.unschedule('p4t-reminders');
  end if;
end $$;

select cron.schedule(
  'p4t-reminders',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := u.value || '?cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', c.value),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  from p4t.config c join p4t.config u on u.key = 'function_url'
  where c.key = 'cron_secret'
  $job$
);
