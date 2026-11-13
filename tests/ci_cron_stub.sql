-- Локальная заглушка pg_cron для интеграционных тестов: задания не запускаются.
-- Продакшен использует настоящий pg_cron, эта схема существует только в CI.
create schema if not exists cron;
create table cron.job (jobid bigint generated always as identity primary key, jobname text unique not null);
create function cron.unschedule(p_name text) returns boolean language plpgsql as $$
begin
  delete from cron.job where jobname = p_name;
  return found;
end $$;
create function cron.schedule(p_name text, p_expr text, p_command text) returns bigint language plpgsql as $$
declare result bigint;
begin
  insert into cron.job (jobname) values (p_name)
    on conflict (jobname) do update set jobname = excluded.jobname returning jobid into result;
  return result;
end $$;
