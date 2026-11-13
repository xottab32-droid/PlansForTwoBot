// Edge Function plans-for-two: webhook бота, напоминания (?cron), рассылки (?broadcast), первичная настройка (?bootstrap)
import { handleUpdate } from './bot.ts';
import { runReminders, deliverPending } from './cron.ts';
import { processUpdate } from './updates.ts';
import { db } from './db.ts';
import { api, Update } from './tg.ts';
import { COMMANDS } from './core.ts';
import { processBroadcasts } from './admin.ts';
import { randomHex } from './util.ts';

async function cfg(key: string): Promise<string | null> {
  const [r] = await db()`select value from p4t.config where key = ${key}`;
  return r?.value ?? null;
}

function safeEq(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

const txt = (s: string, status = 200) => new Response(s, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

async function bootstrap(): Promise<Response> {
  if (!Deno.env.get('PLANS_BOT_TOKEN')) return txt('Секрет PLANS_BOT_TOKEN не задан в Edge Functions → Secrets', 500);
  if (await cfg('webhook_secret')) return txt('Уже настроено. Повторная настройка отключена.', 409);
  const me = await api<{ username: string }>('getMe', {});
  const webhook = randomHex(32), cron = randomHex(32);
  const fnUrl = `${Deno.env.get('SUPABASE_URL')!}/functions/v1/plans-for-two`;
  await db()`insert into p4t.config (key, value) values ('webhook_secret', ${webhook}), ('cron_secret', ${cron}), ('bot_username', ${me.username}), ('function_url', ${fnUrl})
             on conflict (key) do update set value = excluded.value, updated_at = now()`;
  try {
    await api('setWebhook', {
      url: fnUrl, secret_token: webhook, drop_pending_updates: true,
      allowed_updates: ['message', 'callback_query', 'widget_query'], max_connections: 20,
    });
    await api('setMyCommands', { commands: COMMANDS });
    await api('setMyShortDescription', { short_description: 'Общий календарь, цели и «хочу сходить» для пары 💞' });
    await api('setMyDescription', { description: 'Планы на двоих: свидания и важные даты с напоминаниями, общие цели с историей накоплений, список мест «хочу сходить». Данные видны только вашей паре. Нажми «Запустить».' });
    await api('setChatMenuButton', { menu_button: { type: 'commands' } });
  } catch (e) {
    await db()`delete from p4t.config where key in ('webhook_secret', 'cron_secret')`;
    return txt(`Ошибка настройки: ${String(e)}`, 500);
  }
  return txt(`Готово: вебхук для @${me.username} установлен. Открой бота и нажми /start.`);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  try {
    if (url.searchParams.has('bootstrap')) return await bootstrap();
    if (req.method !== 'POST') return txt('ok');
    if (url.searchParams.has('cron')) {
      const secret = await cfg('cron_secret');
      if (!secret || !safeEq(req.headers.get('x-cron-secret') ?? '', secret)) return txt('forbidden', 403);
      const n = await runReminders();
      return txt(`sent ${n}`);
    }
    if (url.searchParams.has('deliver')) {
      const secret = await cfg('cron_secret');
      if (!secret || !safeEq(req.headers.get('x-cron-secret') ?? '', secret)) return txt('forbidden', 403);
      const n = await deliverPending();
      return txt(`delivered ${n}`);
    }
    if (url.searchParams.has('broadcast')) {
      const secret = await cfg('cron_secret');
      if (!secret || !safeEq(req.headers.get('x-cron-secret') ?? '', secret)) return txt('forbidden', 403);
      const n = await processBroadcasts();
      return txt(`processed ${n}`);
    }
    const secret = await cfg('webhook_secret');
    if (!secret || !safeEq(req.headers.get('x-telegram-bot-api-secret-token') ?? '', secret)) return txt('forbidden', 403);
    const up = (await req.json()) as Update;
    if (typeof up?.update_id !== 'number') return txt('ok');
    const result = await processUpdate(up, handleUpdate);
    // Telegram повторяет webhook только при не-2xx. Не подтверждаем недоставленное обновление.
    if (result === 'retry') return txt('retry', 503);
    // failed — подтверждаем, чтобы Telegram не повторял: повтор задвоит действие или снова упадёт
    return txt(result === 'duplicate' ? 'dup' : result === 'failed' ? 'failed' : 'ok');
  } catch (e) {
    console.error(JSON.stringify({ request_failed: String(e) }));
    return txt('error', 500);
  }
});
