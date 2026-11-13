// Интеграционный тест на локальном Postgres с моком Telegram API.
// Запуск: SUPABASE_DB_URL=postgres://... PLANS_BOT_TOKEN=test deno test -A tests/integration_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { handleUpdate } from '../supabase/functions/plans-for-two/bot.ts';
import { runReminders, deliverPending } from '../supabase/functions/plans-for-two/cron.ts';
import { processUpdate } from '../supabase/functions/plans-for-two/updates.ts';
import { addDays, localNow } from '../supabase/functions/plans-for-two/util.ts';
import { closeDb, db, inCouple } from '../supabase/functions/plans-for-two/db.ts';
import { pending } from '../supabase/functions/plans-for-two/admin.ts';

type Call = { method: string; p: any };
const calls: Call[] = [];
let mid = 1000;
let failNextReminder = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  if (!url.startsWith('https://api.telegram.org/')) return realFetch(input, init);
  const method = url.split('/').pop()!;
  const p = JSON.parse(init?.body ?? '{}');
  calls.push({ method, p });
  if (method === 'copyMessage' && p.chat_id === 333) {
    return new Response(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }), { status: 403 });
  }
  if (method === 'sendMessage' && failNextReminder && p.chat_id === 222 &&
      String(p.text ?? '').includes('Контроль повторной доставки')) {
    failNextReminder = false;
    return new Response(JSON.stringify({ ok: false, error_code: 502, description: 'Temporary Telegram failure' }), { status: 502 });
  }
  let result: any = true;
  if (method === 'copyMessage') result = { message_id: ++mid };
  if (method === 'sendMessage' || method === 'sendWidget') result = { message_id: ++mid, chat: { id: p.chat_id, type: 'private' } };
  if (method === 'editMessageText') result = { message_id: p.message_id };
  return new Response(JSON.stringify({ ok: true, result }), { headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

let uid = 1;
const users: Record<string, { id: number; first_name: string }> = {
  A: { id: 111, first_name: 'Аня' }, B: { id: 222, first_name: 'Миша' }, C: { id: 333, first_name: 'Чужой' }, D: { id: 444, first_name: 'Дина' }, Z: { id: 900000001, first_name: 'Админ' }, E: { id: 555, first_name: 'Ева' },
};
const chat = (k: string) => ({ id: users[k].id, type: 'private' });
const text = (k: string, t: string) => handleUpdate({ update_id: uid++, message: { message_id: ++mid, chat: chat(k), from: users[k], text: t } });
const lastTo = (k: string, method?: string) => [...calls].reverse().find((c) => c.p.chat_id === users[k].id && (!method || c.method === method));
const lastMsgId = (k: string) => {
  // id последнего отправленного (не отредактированного) сообщения с inline-клавиатурой
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (c.p.chat_id === users[k].id && c.method === 'editMessageText' && c.p.reply_markup) return c.p.message_id;
    if (c.p.chat_id === users[k].id && c.method === 'sendMessage' && c.p.reply_markup?.inline_keyboard) return msgIdOf(i);
  }
  return 0;
};
const sentIds = new Map<number, number>();
function msgIdOf(i: number) { return sentIds.get(i)!; }
// фиксируем id отправленных сообщений
const origPush = calls.push.bind(calls);
calls.push = (...items: Call[]) => { const n = origPush(...items); const i = calls.length - 1; if (['sendMessage', 'sendWidget'].includes(calls[i].method)) sentIds.set(i, mid + 1); return n; };
const tap = (k: string, data: string, message_id = lastMsgId(k), widget = false) =>
  handleUpdate({ update_id: uid++, callback_query: { id: 'cb' + uid, from: users[k], data, message: { message_id, chat: chat(k), widget: widget ? {} : undefined } } });
const wq = async (k: string, data: string) => {
  const before = calls.length;
  await handleUpdate({ update_id: uid++, widget_query: { id: 'wq' + uid, from: users[k], chat: chat(k), message_id: 1, data } });
  const a = calls.slice(before).find((c) => c.method === 'answerWidgetQuery');
  return JSON.parse(a!.p.data);
};
const textsTo = (k: string, from: number) => calls.slice(from).filter((c) => c.p.chat_id === users[k].id && (c.method === 'sendMessage' || c.method === 'editMessageText')).map((c) => c.p.text as string);
const allText = (k: string, from: number) => textsTo(k, from).join('\n---\n');
const coupleOf = async (k: string) => (await db()`select couple_id from p4t.users where tg_id = ${users[k].id}`)[0]?.couple_id;

Deno.test({ name: 'full flow + isolation', sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const sql = db();
  await sql`truncate p4t.couples, p4t.users, p4t.updates, p4t.sent, p4t.broadcasts, p4t.activity restart identity cascade`;

  // --- A создаёт пару
  await text('A', '/start');
  assert(lastTo('A')!.p.text.includes('пар'), 'onboarding');
  await tap('A', 'pair:new');
  const [{ invite_code: code }] = await sql`select invite_code from p4t.couples`;
  assert(/^[A-Z2-9]{8}$/.test(code));
  // --- B входит по ссылке
  let mark = calls.length;
  await text('B', `/start j_${code}`);
  assert(allText('B', mark).includes('Аня'), 'preview shows inviter');
  await tap('B', `pair:join:${code}`);
  assertEquals(await coupleOf('B'), await coupleOf('A'));
  assert(allText('A', mark).length > 0, 'A notified about partner');
  const [{ invite_code: after }] = await sql`select invite_code from p4t.couples`;
  assertEquals(after, null, 'code is one-time');

  // --- C пытается войти по уже использованному коду, D создаёт свою пару и C входит туда
  mark = calls.length;
  await text('C', `/join ${code}`);
  assertEquals(await coupleOf('C'), null);
  await text('D', '/addpart');
  const [{ invite_code: code2 }] = await sql`select invite_code from p4t.couples where invite_code is not null`;
  await text('C', `/join ${code2}`);
  await tap('C', `pair:join:${code2}`);
  assertEquals(await coupleOf('C'), await coupleOf('D'));
  // третий в полную пару не войдёт (триггер)
  let full = false;
  try { await sql`update p4t.users set couple_id = ${await coupleOf('A')} where tg_id = ${users.C.id}`; } catch (e) { full = /couple_full/.test(String(e)); }
  assert(full, 'max 2 per couple');

  // --- A добавляет свидание через мастер
  mark = calls.length;
  await tap('A', 'add:ev:date', 0);
  await text('A', 'Ужин в Пушкине');
  await text('A', 'завтра');
  await text('A', '19:30');
  await text('A', 'Тверской б-р, 26');
  await tap('A', 'wz:skip');
  if (Deno.env.get('DBG')) for (const c of calls.slice(mark)) console.log(c.method, c.p.chat_id, c.p.message_id ?? '', String(c.p.text ?? c.p.data ?? '').slice(0, 150).replace(/\n/g, ' | '));
  const evs = await sql`select * from p4t.events`;
  assertEquals(evs.length, 1);
  assertEquals(evs[0].title, 'Ужин в Пушкине');
  assert(allText('B', mark).includes('Ужин в Пушкине'), 'partner notified about date');

  // --- день рождения (ежегодно, дата в прошлом)
  await tap('A', 'add:ev:birthday', 0);
  await text('A', 'Миша');
  await text('A', '3 мая 1995');
  await tap('A', 'wz:skip');
  const [bd] = await sql`select * from p4t.events where kind = 'birthday'`;
  assertEquals(bd.yearly, true);

  // --- B создаёт цель с начальной суммой
  mark = calls.length;
  await tap('B', 'add:goal', 0);
  await text('B', 'Отпуск в Италии');
  await tap('B', 'wz:v:1');
  await text('B', '300к');
  await tap('B', 'wz:skip');
  await text('B', '50000');
  const [g] = await sql`select * from p4t.goals`;
  assertEquals(Number(g.target), 300000);
  const contrib1 = await sql`select * from p4t.contributions`;
  assertEquals(contrib1.length, 1);
  // --- A пополняет с комментарием
  mark = calls.length;
  await tap('A', `g:t:${g.id}`, 0);
  await text('A', '15 000 Отложил с зарплаты');
  const cs = await sql`select * from p4t.contributions order by id`;
  assertEquals(cs.length, 2);
  assertEquals(cs[1].comment, 'Отложил с зарплаты');
  const bTxt = allText('B', mark);
  assert(bTxt.includes('Аня') && bTxt.includes('15') && /Осталось|осталось/.test(bTxt), 'contribution notification with context:\n' + bTxt);
  // снять больше накопленного нельзя
  await tap('A', `g:w:${g.id}`, 0);
  await text('A', '1000000');
  assertEquals((await sql`select count(*)::int as n from p4t.contributions`)[0].n, 2);
  await tap('A', 'wz:x');

  // --- «Хочу сходить» и связь со свиданием
  await tap('A', 'add:wish', 0);
  await tap('A', 'wz:v:0');
  await text('A', 'Ресторан Белуга');
  await tap('A', 'wz:skip');
  const [w] = await sql`select * from p4t.wishes`;
  assert(w && w.title === 'Ресторан Белуга');
  await tap('A', `wi:p:${w.id}`, 0);
  // мастер события с предзаполненным названием
  for (let i = 0; i < 6; i++) {
    const s = (await sql`select state from p4t.users where tg_id = ${users.A.id}`)[0].state;
    if (!s) break;
    if (s.k === 'date') await text('A', 'завтра');
    else if (s.k === 'kind') await tap('A', 'wz:v:0');
    else if (s.k === 'title') await text('A', 'Ужин в Белуге');
    else await tap('A', 'wz:skip');
  }
  const [linked] = await sql`select * from p4t.events where wish_id is not null`;
  assert(linked, 'event linked to wish');
  // связь цели с событием
  await tap('A', `ev:lg:${evs[0].id}:${g.id}`, 0);
  assertEquals(Number((await sql`select goal_id from p4t.events where id = ${evs[0].id}`)[0].goal_id), Number(g.id));

  // --- виджеты
  const h = await wq('A', 'h');
  assert(h.e.length >= 1 && h.g.length === 1, 'home widget data');
  const today = (await sql`select (now() at time zone 'Europe/Moscow')::date::text as d`)[0].d;
  const m = await wq('A', `m:${today.slice(0, 7)}`);
  assert(m.d, 'calendar month');
  const gw = await wq('B', `r:${g.id}`);
  assertEquals(gw.sv.replace(/\s/g, ''), '65000₽', JSON.stringify(gw));
  const qa = gw.q[0][0];
  const t = await wq('B', `t:${g.id}:${qa}`);
  assert(t.ok && t.sv.replace(/\s/g, '') === `${65000 + qa}₽`, 'quick top-up from widget ' + JSON.stringify(t));
  const undo = await wq('B', `x:${t.u}`);
  assertEquals(undo.sv.replace(/\s/g, ''), '65000₽');

  // --- ИЗОЛЯЦИЯ: C/D не видят данные пары A/B ни через бота, ни через RLS
  const foreignGoal = await wq('C', `r:${g.id}`);
  assert(foreignGoal.err, 'foreign goal via widget denied');
  const foreignTop = await wq('C', `t:${g.id}:5000`);
  assert(foreignTop.err);
  mark = calls.length;
  await tap('C', `ev:o:${evs[0].id}`, 0);
  await tap('C', `g:o:${g.id}`, 0);
  await tap('C', `ev:d!:${evs[0].id}`, 0);
  await tap('C', `g:d!:${g.id}`, 0);
  await tap('C', `wi:d!:${w.id}`, 0);
  assert(!allText('C', mark).includes('Пушкин') && !allText('C', mark).includes('Италии'), 'no foreign data leaked');
  assertEquals((await sql`select count(*)::int as n from p4t.events where couple_id = ${await coupleOf('A')}`)[0].n, 3);
  assertEquals((await sql`select count(*)::int as n from p4t.goals`)[0].n, 1);
  const cd = await coupleOf('C');
  const seen: any = await inCouple(cd, (tx) => tx`select (select count(*) from p4t.events)::int e, (select count(*) from p4t.goals)::int g, (select count(*) from p4t.users)::int u, (select count(*) from p4t.couples)::int c`);
  assertEquals(seen[0], { e: 0, g: 0, u: 2, c: 1 });
  let blocked = false;
  const ca = await coupleOf('A');
  try { await inCouple(cd, (tx) => tx`insert into p4t.events (couple_id, kind, title, event_date, created_by) values (${ca}, 'date', 'x', '2026-12-01', 333)`); }
  catch (e) { blocked = /row-level security/.test(String(e)); }
  assert(blocked, 'RLS blocks writing into another couple');
  let noUsersWrite = false;
  try { await inCouple(cd, (tx) => tx`update p4t.users set couple_id = null`); } catch (e) { noUsersWrite = /permission denied/.test(String(e)); }
  assert(noUsersWrite, 'p4t_app cannot modify users');

  // --- напоминания: «завтра» для свидания при remind_hour=0
  await sql`update p4t.couples set remind_hour = 0`;
  mark = calls.length;
  const n1 = await runReminders();
  assert(n1 >= 1, 'reminder sent');
  assert(allText('A', mark).includes('Завтра') && allText('B', mark).includes('Завтра'), 'both partners reminded');
  assert(!allText('C', mark).includes('Пушкин'), 'no cross-couple reminders');
  const n2 = await runReminders();
  assertEquals(n2, 0, 'no duplicates');
  // --- Повторяемые webhook updates: ошибка -> retry -> done -> duplicate
  const checkId = 987654321;
  let handled = 0;
  await sql`delete from p4t.updates where update_id = ${checkId}`;
  const sample = { update_id: checkId };
  assertEquals(await processUpdate(sample, async () => { handled++; throw new Error('expected test failure'); }), 'retry');
  assertEquals((await sql`select status from p4t.updates where update_id = ${checkId}`)[0].status, 'retry');
  assertEquals(await processUpdate(sample, async () => { handled++; }), 'done');
  assertEquals(await processUpdate(sample, async () => { handled++; }), 'duplicate');
  assertEquals(handled, 2, 'processed only until success');

  // --- 502 от Telegram не должна терять напоминание для второго участника.
  const tomorrow = addDays(localNow('Europe/Moscow').date, 1);
  await sql`insert into p4t.events (couple_id, kind, title, event_date, created_by)
    values (${ca}, 'important', 'Контроль повторной доставки', ${tomorrow}, 111)`;
  failNextReminder = true;
  await runReminders();
  const delivery1 = await sql`select tg_id::int as tg_id, status from p4t.reminder_deliveries
    where body like '%Контроль повторной доставки%' order by tg_id`;
  assertEquals(delivery1.map((r: any) => [r.tg_id, r.status]), [[111, 'sent'], [222, 'pending']]);
  await sql`update p4t.reminder_deliveries set next_attempt_at = now() - interval '1 minute'
    where body like '%Контроль повторной доставки%' and status = 'pending'`;
  await deliverPending();
  const delivery2 = await sql`select tg_id::int as tg_id, status from p4t.reminder_deliveries
    where body like '%Контроль повторной доставки%' order by tg_id`;
  assertEquals(delivery2.map((r: any) => [r.tg_id, r.status]), [[111, 'sent'], [222, 'sent']]);

  // --- Цели/места не обрезаются после восьмой записи и дают перейти на следующую страницу.
  for (let i = 0; i < 12; i++) {
    await sql`insert into p4t.goals (couple_id, title, target, created_by)
      values (${ca}, ${'Тестовая цель ' + i}, 1000, 111)`;
    await sql`insert into p4t.wishes (couple_id, title, created_by)
      values (${ca}, ${'Тестовое место ' + i}, 111)`;
  }
  const startPaging = calls.length;
  await tap('A', 'gl:0:1', 0);
  assert(allText('A', startPaging).includes('страница 2/'), 'second goal page');
  const wishPaging = calls.length;
  await tap('A', 'wl:all:1', 0);
  assert(allText('A', wishPaging).includes('Страница 2/'), 'second wishlist page');


  // --- остальные экраны не падают
  for (const k of ['nav:home', 'nav:cal', 'nav:goals', 'nav:wish', 'nav:add', 'nav:set', 'nav:help', 'up:0', 'pa:0', 'gl:1', 'wl:all:0', 'wd:all:0', 'wi:rnd',
    `g:h:${g.id}:0`, `g:p:${g.id}`, `g:e:${g.id}`, `ev:e:${evs[0].id}`, `ev:lg:${evs[0].id}`, `wi:o:${w.id}`, 's:wd', 's:q', 's:tz', 's:cur']) {
    const before = calls.length;
    await tap('A', k, 0);
    assert(calls.length > before, 'no response for ' + k);
  }
  for (const cmd of ['/help', '/home', '/calendar', '/upcoming', '/goals', '/wishlist', '/settings', '/cancel', '🏠 Главная', '📅 Календарь']) await text('A', cmd);

  // --- главный виджет без кнопок навигации (они есть в меню), меню можно свернуть
  await db()`update p4t.users set widgets = true where tg_id = 111`;
  mark = calls.length;
  await text('A', '/home');
  const hwMsg = calls.slice(mark).find((c) => c.method === 'sendWidget' && c.p.chat_id === 111)!;
  assert(hwMsg && !hwMsg.p.reply_markup, 'home widget has no inline buttons');
  await text('A', '/calendar');
  const cwMsg = [...calls].reverse().find((c) => c.method === 'sendWidget' && c.p.chat_id === 111)!;
  assert(cwMsg.p.reply_markup?.inline_keyboard?.length, 'calendar widget keeps buttons');
  await text('A', '/start');
  const menu = lastTo('A', 'sendMessage')!.p.reply_markup;
  assert(menu.keyboard && !menu.is_persistent, 'menu keyboard can be hidden');

  // --- своё эмодзи для цели
  await tap('A', 'add:goal', 0);
  await text('A', 'Собака');
  const goalCard = lastTo('A', 'editMessageText')!.p;
  const flat = goalCard.reply_markup.inline_keyboard.flat();
  const own = flat.find((x: any) => x.text.startsWith('✨ Другое'));
  assert(own, 'custom emoji button');
  await tap('A', own.callback_data);
  assert(lastTo('A', 'editMessageText')!.p.text.includes('Отправь в чат одно эмодзи'), 'asks for emoji');
  await text('A', 'собака');
  assert(lastTo('A', 'editMessageText')!.p.text.includes('Нужно одно эмодзи'), 'rejects non-emoji');
  await tap('A', 'wz:cx');
  assert(lastTo('A', 'editMessageText')!.p.reply_markup.inline_keyboard.flat().some((x: any) => x.text === '🚗 Машина'), 'back to icon list');
  await text('A', '🐶'); // можно отправить и без кнопки «Другое»
  await text('A', '50000');
  await tap('A', 'wz:skip');
  await tap('A', 'wz:skip');
  const dog = (await sql`select id, emoji from p4t.goals where title = 'Собака'`)[0];
  assertEquals(dog.emoji, '🐶');
  await tap('A', `g:ef:${dog.id}:emoji`, 0);
  await tap('A', 'wz:v:8');
  await text('A', '🇮🇹');
  assertEquals((await sql`select emoji from p4t.goals where id = ${dog.id}`)[0].emoji, '🇮🇹');

  // --- своё имя в паре
  await text('A', '/settings');
  await tap('A', 's:nm');
  assertEquals((await db()`select state from p4t.users where tg_id = 111`)[0].state.f, 'name');
  await text('A', 'x'.repeat(40));
  assert(lastTo('A', 'editMessageText')!.p.text.includes('Слишком длинно'), 'too long name rejected');
  mark = calls.length;
  await text('A', '  Анюта \u200b 🌸  ');
  assertEquals((await db()`select display_name from p4t.users where tg_id = 111`)[0].display_name, 'Анюта 🌸');
  assert(allText('A', mark).includes('теперь ты — <b>Анюта 🌸</b>'), 'name saved');
  assert(allText('B', mark).includes('<b>Аня</b> сменил(а) имя в боте — теперь <b>Анюта 🌸</b>'), 'partner notified about name');
  mark = calls.length;
  await text('B', '/settings');
  assert(allText('B', mark).includes('Миша & Анюта 🌸') || allText('B', mark).includes('Анюта 🌸 & Миша'), 'partner sees new name');
  assert(!allText('C', 0).includes('Анюта'), 'other couples do not see name');
  const hw = await wq('B', 'h');
  assert(JSON.stringify(hw).includes('Анюта'), 'widget uses new name');
  await text('A', '/home'); // новое сообщение от Telegram с first_name «Аня» не затирает своё имя
  assertEquals((await db()`select display_name, first_name from p4t.users where tg_id = 111`)[0].display_name, 'Анюта 🌸');
  await tap('A', 's:nm');
  await tap('A', 'wz:x');
  assert(lastTo('A', 'editMessageText')!.p.text.includes('Имя не изменено'), 'cancel returns to settings');
  await text('A', '/name');
  await tap('A', 'wz:v:0'); // «Как в Telegram»
  assertEquals((await db()`select display_name from p4t.users where tg_id = 111`)[0].display_name, null);
  await tap('A', 's:nm:tg', 0);
  await text('D', '/settings'); // без пары тоже доступно
  await tap('D', 's:nm');
  await text('D', 'Ди');
  assertEquals((await db()`select display_name from p4t.users where tg_id = 444`)[0].display_name, 'Ди');

  // --- выход из пары: данные остаются у партнёра, A теряет доступ
  await tap('A', 'pair:leave!', 0);
  assertEquals(await coupleOf('A'), null);
  const lostAccess = await wq('A', `r:${g.id}`);
  assert(lostAccess.err);
  const errs = calls.filter((c) => c.method === 'sendMessage' && /Ошибка|ошибка/.test(c.p.text));
  assertEquals(errs.length, 0);
  console.log('telegram calls:', calls.length);
} });

Deno.test({ name: 'admin: stats + broadcasts', sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const sql = db();
  await sql`insert into p4t.config (key, value) values ('admin_ids', '900000001') on conflict (key) do update set value = excluded.value`;
  let mark = calls.length;
  if (Deno.env.get('DUMP')) Deno.writeTextFileSync(Deno.env.get('DUMP')!, calls.map((c) => `${c.method} ${c.p.chat_id ?? ''} ${c.p.message_id ?? ''}\n${c.p.text ?? c.p.caption ?? c.p.data ?? ''}\n${c.p.reply_markup ? JSON.stringify(c.p.reply_markup.inline_keyboard?.map((r: any) => r.map((b: any) => b.text + '→' + (b.callback_data ?? b.url ?? 'copy')))) : ''}`).join('\n=====\n'));
  // --- не-админ не видит админку
  mark = calls.length;
  await text('A', '/admin');
  assert(allText('A', mark).includes('Не знаю такой команды'));
  await tap('A', 'adm:s', 0);
  await tap('A', 'adm:t', 0);
  await tap('A', 'adm:bc', 0);
  assertEquals(calls.slice(mark).filter((c) => c.method === 'sendWidget').length, 0, 'no admin widget for regular user');
  // запрос виджета статистики от не-админа — только ошибка, никаких цифр
  const denied = await wq('A', 'as');
  assertEquals(Object.keys(denied), ['err']);
  assert(!allText('A', mark).includes('Статистика') && !allText('A', mark).includes('рассылк'), 'no admin UI for regular user');
  assertEquals(calls.slice(mark).filter((c) => c.method === 'setMyCommands').length, 0);

  // --- E запустил бота «давно» и забыл
  await text('E', '/start');
  await sql`update p4t.users set created_at = now() - interval '20 days', last_seen_at = now() - interval '20 days' where tg_id = 555`;
  await sql`update p4t.activity set day = day - 20 where tg_id = 555`;
  // B давно не заходил
  await sql`update p4t.users set last_seen_at = now() - interval '40 days' where tg_id = 222`;

  // --- админ: статистика без личных данных
  mark = calls.length;
  const markA = mark;
  await text('Z', '/admin');
  // по умолчанию — виджет с графиками: только числа, без имён/текстов/сумм
  const aw = calls.slice(mark).find((c) => c.method === 'sendWidget' && c.p.chat_id === 900000001)!;
  assert(aw && aw.p.caption.includes('Статистика'), 'admin widget sent');
  assert(new TextEncoder().encode(aw.p.chat_data).length <= 1024, 'chat_data fits');
  const ad = JSON.parse(aw.p.chat_data);
  assert(ad.u >= 5 && ad.d.length === 14 && /^\d{4}-\d{2}-\d{2}$/.test(ad.de), aw.p.chat_data);
  for (const secret of ['Аня', 'Миша', 'Пушкин', 'Италии', 'Белуга', 'Дина', 'Ева', '15000', '15 000']) assert(!aw.p.chat_data.includes(secret), 'widget leak: ' + secret);
  assert(JSON.stringify(aw.p.reply_markup).includes('adm:t'), 'text button under widget');
  const live = await wq('Z', 'as');
  assertEquals(live.u, ad.u);
  assertEquals(live.fg, ad.fg);
  // повторное /admin заменяет прошлую карточку
  const m2 = calls.length;
  await text('Z', '/admin');
  assert(calls.slice(m2).some((c) => c.method === 'deleteMessage' && c.p.chat_id === 900000001 && c.p.message_id === sentIds.get(calls.indexOf(aw))), 'old admin widget removed');
  mark = calls.length;
  await tap('Z', 'adm:t', 0);
  const st = allText('Z', mark);
  assert(st.includes('Статистика') && st.includes('Пары:'), st);
  for (const secret of ['Аня', 'Миша', 'Пушкин', 'Италии', 'Белуга', 'Дина', 'Ева', '15 000']) assert(!st.includes(secret), 'stats leak: ' + secret);
  assert(/Запустили и забыли»: 1/.test(st), 'forgot counted:\n' + st);
  const sc = calls.slice(markA, m2).filter((c) => c.method === 'setMyCommands');
  assertEquals(sc.length, 2);
  assert(sc[1].p.scope.chat_id === 900000001 && sc[1].p.commands.some((x: any) => x.command === 'admin'));
  assert(!sc[0].p.commands.some((x: any) => x.command === 'admin') && sc[0].p.commands.some((x: any) => x.command === 'support'));
  await tap('Z', 'adm:i', 0);

  // --- сегменты
  const { segmentCount } = await import('../supabase/functions/plans-for-two/admin.ts');
  assertEquals(await segmentCount('idle30'), 1); // B
  assertEquals(await segmentCount('forgot'), 1); // E
  assertEquals(await segmentCount('solo'), 2); // A (вышел из пары) и E; админ исключён

  // D отписывается от новостей
  await tap('D', 'news:off', 1);
  assertEquals((await sql`select news from p4t.users where tg_id = 444`)[0].news, false);

  // --- рассылка всем
  mark = calls.length;
  await tap('Z', 'adm:bc', 0);
  await tap('Z', 'adm:bs:all', lastMsgId('Z'));
  await handleUpdate({ update_id: uid++, message: { message_id: 777, chat: chat('Z'), from: users.Z, text: 'Новость: добавили виджеты!' } });
  const preview = calls.slice(mark).find((c) => c.method === 'copyMessage');
  assert(preview && preview.p.chat_id === 900000001 && preview.p.message_id === 777, 'preview to admin');
  const confirmId = lastMsgId('Z');
  // обычный пользователь не может нажать «Отправить»
  await tap('A', 'adm:go', 0);
  assertEquals((await sql`select count(*)::int n from p4t.broadcasts`)[0].n, 0);
  await tap('Z', 'adm:go', confirmId);
  await Promise.all(pending);
  const [bc] = await sql`select * from p4t.broadcasts`;
  assertEquals(bc.status, 'done');
  const rec = await sql`select tg_id::int, status from p4t.broadcast_recipients order by tg_id`;
  // A, B, C(блок), E; D отписан, админ исключён
  assertEquals(rec.map((r: any) => [r.tg_id, r.status]), [[111, 'sent'], [222, 'sent'], [333, 'blocked'], [555, 'sent']]);
  assert((await sql`select blocked_at from p4t.users where tg_id = 333`)[0].blocked_at, 'blocked marked');
  const copies = calls.slice(mark).filter((c) => c.method === 'copyMessage' && c.p.chat_id !== 900000001);
  assert(copies.every((c) => c.p.from_chat_id === 900000001 && c.p.message_id === 777 && c.p.reply_markup.inline_keyboard[0][0].callback_data === 'news:off'));
  assert(allText('Z', mark).includes('Доставлено: <b>3</b> из 4'), 'report to admin:\n' + allText('Z', mark));
  // рассылка по сегменту «не заходили 30+ дней»
  await tap('Z', 'adm:bs:idle30', 0);
  await handleUpdate({ update_id: uid++, message: { message_id: 778, chat: chat('Z'), from: users.Z, text: 'Мы скучаем' } });
  await tap('Z', 'adm:go', lastMsgId('Z'));
  await Promise.all(pending);
  const rec2 = await sql`select tg_id::int from p4t.broadcast_recipients where broadcast_id = (select max(id) from p4t.broadcasts)`;
  assertEquals(rec2.map((r: any) => r.tg_id), [222]);
  await tap('Z', 'adm:bl', 0);
  assert(lastTo('Z')!.p.text.includes('#2'));
  // C снова пишет боту — блокировка снимается
  await text('C', '/help');
  assertEquals((await sql`select blocked_at from p4t.users where tg_id = 333`)[0].blocked_at, null);
  if (Deno.env.get('DUMP')) Deno.writeTextFileSync(Deno.env.get('DUMP') + '.admin', calls.slice(0).filter((c) => c.p.chat_id === 900000001).map((c) => `${c.method}\n${c.p.text ?? ''}\n${JSON.stringify(c.p.reply_markup?.inline_keyboard?.map((r: any) => r.map((b: any) => b.text)) ?? '')}`).join('\n=====\n'));
  await closeDb();
} });
