-- pg_net переносится из public в схему extensions (рекомендация Security Advisor).
-- Функции pg_net всё равно живут в схеме net, задание p4t-reminders продолжает работать.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
