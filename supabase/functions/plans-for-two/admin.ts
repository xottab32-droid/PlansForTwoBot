// Админ-панель (только для ID из p4t.config 'admin_ids'): обезличенная статистика и рассылки.
// Ни один запрос здесь не возвращает имена, тексты событий/целей или суммы конкретных пар — только агрегаты.
import { COMMANDS, Ctx, saveState, sendFailed, show } from './core.ts';
import { db, Q } from './db.ts';
import { api, b, Btn, edit, kb, Message, send, TgError } from './tg.ts';
import { esc, fmtNum, plural } from './util.ts';

// ---------- доступ ----------
let adminCache: { ids: Set<number>; at: number } | null = null;

export async function adminIds(): Promise<Set<number>> {
  if (adminCache && Date.now() - adminCache.at < 60_000) return adminCache.ids;
  const [r] = await db()`select value from p4t.config where key = 'admin_ids'`;
  const ids = new Set(String(r?.value ?? '').split(',').map((x) => Number(x.trim())).filter((x) => Number.isSafeInteger(x) && x > 0));
  adminCache = { ids, at: Date.now() };
  return ids;
}
export const isAdmin = async (tgId: number) => (await adminIds()).has(tgId);

// ---------- сегменты рассылки ----------
type Seg = { n: string; hint: string; where: (sql: Q) => unknown };
export const SEGMENTS: Record<string, Seg> = {
  all: { n: 'Все пользователи', hint: 'все, кто запускал бота', where: (sql) => sql`true` },
  full: { n: 'Полные пары', hint: 'оба партнёра в паре', where: (sql) => sql`u.couple_id in (select couple_id from p4t.users where couple_id is not null group by couple_id having count(*) = 2)` },
  waiting: { n: 'Ждут партнёра', hint: 'создали пару, но партнёр не присоединился', where: (sql) => sql`u.couple_id in (select couple_id from p4t.users where couple_id is not null group by couple_id having count(*) = 1)` },
  solo: { n: 'Без пары', hint: 'запустили бота, но не создали пару и не вошли в неё', where: (sql) => sql`u.couple_id is null` },
  empty: { n: 'Пара без записей', hint: 'в паре, но ни одного события, цели или места', where: (sql) => sql`u.couple_id is not null and not exists (select 1 from p4t.events e where e.couple_id = u.couple_id) and not exists (select 1 from p4t.goals g where g.couple_id = u.couple_id) and not exists (select 1 from p4t.wishes w where w.couple_id = u.couple_id)` },
  active7: { n: 'Активные за 7 дней', hint: 'заходили за последнюю неделю', where: (sql) => sql`u.last_seen_at > now() - interval '7 days'` },
  idle14: { n: 'Не заходили 14+ дней', hint: 'последний визит больше 2 недель назад', where: (sql) => sql`u.last_seen_at < now() - interval '14 days'` },
  idle30: { n: 'Не заходили 30+ дней', hint: 'последний визит больше месяца назад', where: (sql) => sql`u.last_seen_at < now() - interval '30 days'` },
  forgot: { n: '«Запустили и забыли»', hint: 'пользовались только в первый день, прошло 3+ дня', where: (sql) => sql`u.created_at < now() - interval '3 days' and (select count(*) from p4t.activity a where a.tg_id = u.tg_id) <= 1` },
};

/** Базовый фильтр получателей: не заблокировали бота, не отписались от новостей, не админы.
 *  Функция синхронная: возвращает фрагмент запроса, а не выполняет его. */
function recipientsFrom(sql: Q, seg: string, admins: number[]) {
  return sql`from p4t.users u where u.blocked_at is null and u.news and not (u.tg_id = any(${admins}::bigint[])) and ${SEGMENTS[seg].where(sql)}`;
}
export async function segmentCount(seg: string): Promise<number> {
  const sql = db();
  const admins = [...await adminIds()];
  const [r] = await sql`select count(*)::int as n ${recipientsFrom(sql, seg, admins)}`;
  return Number(r.n);
}

// ---------- статистика ----------
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const spark = (vals: number[]) => {
  const bars = '▁▂▃▄▅▆▇█', max = Math.max(1, ...vals);
  return vals.map((v) => (v === 0 ? '·' : bars[Math.min(7, Math.floor((v / max) * 7.999))])).join('');
};

async function collectStats() {
  const [r] = await db()`
    with td as (select (now() at time zone 'UTC')::date as d),
    cm as (select couple_id, count(*)::int as n, max(last_seen_at) as last from p4t.users where couple_id is not null group by couple_id),
    c as (
      select cp.id, cp.created_at, coalesce(cm.n, 0) as n, cm.last,
        exists (select 1 from p4t.events e where e.couple_id = cp.id) as has_ev,
        exists (select 1 from p4t.goals g where g.couple_id = cp.id) as has_goal,
        exists (select 1 from p4t.contributions x where x.couple_id = cp.id) as has_contr,
        exists (select 1 from p4t.wishes w where w.couple_id = cp.id) as has_wish
      from p4t.couples cp left join cm on cm.couple_id = cp.id
    ),
    ad as (select tg_id, count(*)::int as days from p4t.activity group by tg_id),
    a30 as (select tg_id, count(*)::int as days, sum(hits)::int as hits from p4t.activity, td where day > td.d - 30 group by tg_id)
    select jsonb_build_object(
      'users', (select count(*) from p4t.users),
      'u_new1', (select count(*) from p4t.users where created_at > now() - interval '1 day'),
      'u_new7', (select count(*) from p4t.users where created_at > now() - interval '7 days'),
      'u_new30', (select count(*) from p4t.users where created_at > now() - interval '30 days'),
      'u_paired', (select count(*) from p4t.users where couple_id is not null),
      'u_full', (select coalesce(sum(n), 0) from c where n = 2),
      'u_content', (select coalesce(sum(n), 0) from c where n > 0 and (has_ev or has_goal or has_wish)),
      'blocked', (select count(*) from p4t.users where blocked_at is not null),
      'news_off', (select count(*) from p4t.users where not news),
      'widgets_off', (select count(*) from p4t.users where not widgets),
      'quiet', (select count(*) from p4t.users where quiet),
      'couples', (select count(*) from c),
      'c_full', (select count(*) from c where n = 2),
      'c_wait', (select count(*) from c where n = 1),
      'c_empty', (select count(*) from c where n = 0),
      'c_new7', (select count(*) from c where created_at > now() - interval '7 days'),
      'c_new30', (select count(*) from c where created_at > now() - interval '30 days'),
      'c_act7', (select count(*) from c where n = 2 and last > now() - interval '7 days'),
      'c_cool', (select count(*) from c where n = 2 and last <= now() - interval '7 days' and last > now() - interval '30 days'),
      'c_lost', (select count(*) from c where n = 2 and last <= now() - interval '30 days'),
      'c_used', (select count(*) from c where n = 2 and (has_ev or has_goal or has_wish)),
      'f_ev', (select count(*) from c where n > 0 and has_ev),
      'f_goal', (select count(*) from c where n > 0 and has_goal),
      'f_contr', (select count(*) from c where n > 0 and has_contr),
      'f_wish', (select count(*) from c where n > 0 and has_wish),
      'c_live', (select count(*) from c where n > 0)
    ) || jsonb_build_object(
      'dau', (select count(*) from p4t.activity, td where day = td.d),
      'wau', (select count(distinct tg_id) from p4t.activity, td where day > td.d - 7),
      'mau', (select count(*) from a30),
      'hits_today', (select coalesce(sum(hits), 0) from p4t.activity, td where day = td.d),
      'hits7', (select coalesce(sum(hits), 0) from p4t.activity, td where day > td.d - 7),
      'avg_days30', (select coalesce(round(avg(days)::numeric, 1), 0) from a30),
      'avg_hits30', (select coalesce(round((sum(hits)::numeric / nullif(sum(days), 0)), 1), 0) from a30),
      'freq_daily', (select count(*) from a30 where days >= 15),
      'freq_weekly', (select count(*) from a30 where days between 4 and 14),
      'freq_rare', (select count(*) from a30 where days between 1 and 3),
      'forgot', (select count(*) from p4t.users u left join ad on ad.tg_id = u.tg_id where u.created_at < now() - interval '3 days' and coalesce(ad.days, 0) <= 1),
      'forgot_base', (select count(*) from p4t.users where created_at < now() - interval '3 days'),
      'ret_base', (select count(*) from p4t.users where created_at between now() - interval '37 days' and now() - interval '7 days'),
      'ret7', (select count(*) from p4t.users u where u.created_at between now() - interval '37 days' and now() - interval '7 days'
                and exists (select 1 from p4t.activity a where a.tg_id = u.tg_id and a.day >= (u.created_at at time zone 'UTC')::date + 7))
    ) || jsonb_build_object(
      'n_events', (select count(*) from p4t.events),
      'n_events_new7', (select count(*) from p4t.events where created_at > now() - interval '7 days'),
      'n_goals', (select count(*) from p4t.goals),
      'n_goals_done', (select count(*) from p4t.goals where achieved_at is not null),
      'n_contr', (select count(*) from p4t.contributions),
      'n_contr_new7', (select count(*) from p4t.contributions where created_at > now() - interval '7 days'),
      'n_wishes', (select count(*) from p4t.wishes),
      'n_wishes_done', (select count(*) from p4t.wishes where done_at is not null),
      'n_linked', (select count(*) from p4t.events where goal_id is not null or wish_id is not null),
      'reminders7', (select count(*) from p4t.sent where created_at > now() - interval '7 days'),
      'daily', (select json_agg(json_build_array(to_char(g.d, 'DD.MM'), coalesce(x.users, 0), coalesce(x.hits, 0)) order by g.d)
                from td, generate_series(td.d - 13, td.d, interval '1 day') as g(d)
                left join (select day, count(*)::int as users, sum(hits)::int as hits from p4t.activity group by day) x on x.day = g.d::date)
    ) as s`;
  const s = r.s as Record<string, any>;
  for (const k of Object.keys(s)) if (k !== 'daily') s[k] = Number(s[k]);
  return s;
}

export function statsText(s: Record<string, any>) {
  const f = (n: number) => fmtNum(n);
  const daily: [string, number, number][] = s.daily ?? [];
  const users = daily.map((d) => d[1]), hits = daily.map((d) => d[2]);
  const L = [
    '📊 <b>Статистика PlansForTwoBot</b>',
    '<i>Только обезличенные агрегаты — без имён и содержимого.</i>',
    '',
    `👤 <b>Пользователи: ${f(s.users)}</b>`,
    `   новые: сегодня ${f(s.u_new1)} · 7 дн. ${f(s.u_new7)} · 30 дн. ${f(s.u_new30)}`,
    '',
    `💞 <b>Пары: ${f(s.couples)}</b> (новых за 7 дн. ${f(s.c_new7)}, за 30 дн. ${f(s.c_new30)})`,
    `   полные ${f(s.c_full)} · ждут партнёра ${f(s.c_wait)} · распались ${f(s.c_empty)}`,
    '',
    '🔥 <b>Активность</b>',
    `   DAU ${f(s.dau)} · WAU ${f(s.wau)} · MAU ${f(s.mau)}${s.mau ? ` · «липкость» DAU/MAU ${pct(s.dau, s.mau)}%` : ''}`,
    `   обращений: сегодня ${f(s.hits_today)} · за 7 дн. ${f(s.hits7)}`,
    `   активный пользователь за 30 дн.: ${s.avg_days30} дн. с ботом, ~${s.avg_hits30} действий в такой день`,
    `   частота (30 дн.): почти каждый день ${f(s.freq_daily)} · каждую неделю ${f(s.freq_weekly)} · изредка ${f(s.freq_rare)}`,
    `   14 дней, люди: <code>${spark(users)}</code> макс ${Math.max(0, ...users)}`,
    `   14 дней, действия: <code>${spark(hits)}</code> макс ${Math.max(0, ...hits)}`,
    '',
    '🧭 <b>Полные пары по активности</b>',
    `   🟢 активны (≤7 дн.) ${f(s.c_act7)} · 🟡 остывают (8–30 дн.) ${f(s.c_cool)} · 🔴 заброшены (30+ дн.) ${f(s.c_lost)}`,
    `   реально пользуются (есть записи): ${f(s.c_used)} из ${f(s.c_full)} (${pct(s.c_used, s.c_full)}%)`,
    '',
    `💤 <b>«Запустили и забыли»: ${f(s.forgot)}</b> из ${f(s.forgot_base)} (${pct(s.forgot, s.forgot_base)}%)`,
    '   пользовались только в первый день, прошло 3+ дня',
    s.ret_base ? `🔁 Вернулись через неделю после старта: ${pct(s.ret7, s.ret_base)}% (${f(s.ret7)} из ${f(s.ret_base)})` : '🔁 Возврат через неделю: пока мало данных',
    '',
    '🪜 <b>Воронка</b>',
    `   запустили ${f(s.users)} → в паре ${f(s.u_paired)} (${pct(s.u_paired, s.users)}%) → полная пара ${f(s.u_full)} (${pct(s.u_full, s.users)}%) → есть записи ${f(s.u_content)} (${pct(s.u_content, s.users)}%)`,
    '',
    `🧩 <b>Функции</b> (доля пар из ${f(s.c_live)})`,
    `   📅 события ${pct(s.f_ev, s.c_live)}% · 🎯 цели ${pct(s.f_goal, s.c_live)}% · 💰 пополнения ${pct(s.f_contr, s.c_live)}% · 📍 «хочу сходить» ${pct(s.f_wish, s.c_live)}%`,
    `   всего: событий ${f(s.n_events)} (+${f(s.n_events_new7)} за 7 дн.) · целей ${f(s.n_goals)} (достигнуто ${f(s.n_goals_done)})`,
    `   операций по целям ${f(s.n_contr)} (+${f(s.n_contr_new7)} за 7 дн.) · мест ${f(s.n_wishes)} (посетили ${f(s.n_wishes_done)}) · связей цель/место → событие ${f(s.n_linked)}`,
    `   напоминаний отправлено за 7 дн.: ${f(s.reminders7)}`,
    '',
    '⚙️ <b>Прочее</b>',
    `   заблокировали бота ${f(s.blocked)} · отписались от новостей ${f(s.news_off)} · выключили карточки ${f(s.widgets_off)} · без звука ${f(s.quiet)}`,
  ];
  return L.join('\n');
}

const adminKb = () => kb(
  [b('🔄 Обновить', 'adm:s'), b('📣 Новая рассылка', 'adm:bc', 'primary')],
  [b('📜 История рассылок', 'adm:bl'), b('ℹ️ Как считается', 'adm:i')],
);

export async function adminHome(c: Ctx) {
  const s = await collectStats();
  await show(c, statsText(s), adminKb());
}

/** Команды: обычный список для всех + /admin только в чате администратора */
export async function syncAdminCommands(c: Ctx) {
  try {
    await api('setMyCommands', { commands: COMMANDS });
    await api('setMyCommands', { commands: [...COMMANDS, { command: 'admin', description: '🔐 Статистика и рассылки' }], scope: { type: 'chat', chat_id: c.chat } });
  } catch (e) { console.error('setMyCommands failed', String(e)); }
}

const INFO = [
  'ℹ️ <b>Как считается статистика</b>',
  '',
  '• <b>Обращение</b> — любое действие в боте: сообщение, кнопка, тап в карточке. Считается одно число на пользователя в день, без содержимого.',
  '• <b>DAU / WAU / MAU</b> — уникальные пользователи за сегодня / 7 / 30 дней (UTC).',
  '• <b>Активность пары</b> — последний визит любого из партнёров.',
  '• <b>«Реально пользуются»</b> — полная пара, где есть хотя бы одно событие, цель или место.',
  '• <b>«Запустили и забыли»</b> — пользовались ботом только в один день, и с регистрации прошло больше 3 дней.',
  '• <b>Возврат через неделю</b> — из зарегистрированных 7–37 дней назад доля тех, кто заходил на 7-й день и позже.',
  '• <b>Заблокировали</b> — Telegram вернул ошибку 403 при отправке сообщения.',
  '',
  'Счётчики обращений хранятся 400 дней. Имена, тексты и суммы конкретных пар в статистику не попадают.',
].join('\n');

// ---------- рассылки ----------
async function segmentMenu(c: Ctx) {
  const rows: Btn[][] = [];
  const keys = Object.keys(SEGMENTS);
  const counts = await Promise.all(keys.map((k) => segmentCount(k)));
  for (let i = 0; i < keys.length; i += 2) {
    rows.push(keys.slice(i, i + 2).map((k, j) => b(`${SEGMENTS[k].n} · ${counts[i + j]}`, `adm:bs:${k}`)));
  }
  rows.push([b('‹ Статистика', 'adm:s')]);
  const L = ['📣 <b>Новая рассылка</b>', '', 'Кому отправляем? В скобках — число получателей.', ''];
  keys.forEach((k, i) => L.push(`• <b>${SEGMENTS[k].n}</b> (${counts[i]}) — ${SEGMENTS[k].hint}`));
  L.push('', '<i>Всегда исключаются: те, кто заблокировал бота или отписался от новостей, и администраторы.</i>');
  await show(c, L.join('\n'), kb(...rows));
}

async function askMessage(c: Ctx, seg: string) {
  const n = await segmentCount(seg);
  const m = await show(c, [
    `📣 Сегмент: <b>${SEGMENTS[seg].n}</b> · получателей: <b>${n}</b>`,
    '',
    'Пришли сообщение для рассылки следующим сообщением — текст, фото, видео или документ с подписью. Форматирование сохранится, сообщение будет отправлено от имени бота.',
    '',
    'Покажу превью, отправка — только после подтверждения.',
  ].join('\n'), kb([b('‹ Другой сегмент', 'adm:bc'), b('✖️ Отмена', 'adm:s')]));
  await saveState(c, { f: 'bc', k: 'msg', d: { seg }, m });
}

const unsubscribeKb = () => kb([b('🔕 Не присылать новости', 'news:off')]);

/** Сообщение от администратора, пока ждём текст рассылки */
export async function onAdminMessage(c: Ctx, msg: Message) {
  const s = c.u.state!;
  const seg = String(s.d.seg ?? 'all');
  if (!SEGMENTS[seg]) return await saveState(c, null);
  try {
    await api('copyMessage', { chat_id: c.chat, from_chat_id: c.chat, message_id: msg.message_id, reply_markup: unsubscribeKb() });
  } catch (e) {
    return await send(c.chat, `⚠️ Это сообщение нельзя разослать: ${esc(String(e))}. Пришли другое.`);
  }
  const n = await segmentCount(seg);
  const card = await send(c.chat, [
    '👆 <b>Превью</b> — так сообщение увидят получатели.',
    '',
    `Сегмент: <b>${SEGMENTS[seg].n}</b> · получателей: <b>${n}</b>`,
    'Не удаляй исходное сообщение, пока идёт рассылка — бот копирует именно его.',
  ].join('\n'), kb(
    [b(`✅ Отправить ${n} ${plural(n, 'получателю', 'получателям', 'получателям')}`, 'adm:go', 'success')],
    [b('✏️ Другое сообщение', `adm:bs:${seg}`), b('✖️ Отмена', 'adm:x', 'danger')],
  ));
  if (s.m) { try { await edit(c.chat, s.m, `📣 Сегмент: <b>${SEGMENTS[seg].n}</b> — сообщение получено, превью ниже.`); } catch { /* */ } }
  await saveState(c, { f: 'bc', k: 'confirm', d: { seg, src: msg.message_id }, m: card.message_id });
}

async function launch(c: Ctx) {
  const s = c.u.state;
  if (!s || s.f !== 'bc' || s.k !== 'confirm' || !s.d.src) return await show(c, 'Черновик рассылки не найден. Начни заново.', kb([b('📣 Новая рассылка', 'adm:bc')]));
  const seg = String(s.d.seg);
  const sql = db();
  const admins = [...await adminIds()];
  const id = await sql.begin(async (tx: Q) => {
    const [bc] = await tx`insert into p4t.broadcasts (created_by, segment, src_chat, src_msg) values (${c.u.tg_id}, ${seg}, ${c.chat}, ${s.d.src}) returning id`;
    await tx`insert into p4t.broadcast_recipients (broadcast_id, tg_id) select ${bc.id}, u.tg_id ${recipientsFrom(tx, seg, admins)}`;
    const [t] = await tx`update p4t.broadcasts set total = (select count(*) from p4t.broadcast_recipients where broadcast_id = ${bc.id}) where id = ${bc.id} returning total`;
    if (Number(t.total) === 0) await tx`update p4t.broadcasts set status = 'done', finished_at = now() where id = ${bc.id}`;
    return Number(bc.id);
  });
  await saveState(c, null);
  const [bc] = await sql`select total from p4t.broadcasts where id = ${id}`;
  await show(c, `🚀 Рассылка <b>#${id}</b> запущена: ${bc.total} ${plural(Number(bc.total), 'получатель', 'получателя', 'получателей')}.\nОтчёт пришлю, когда закончу.`,
    kb([b('⏹ Остановить', `adm:bx:${id}`, 'danger'), b('📜 История', 'adm:bl')]));
  kick();
}

/** Запуск обработки рассылки в фоне (после ответа Telegram); pg_cron раз в минуту подстрахует */
function kick() {
  const p = processBroadcasts(40_000).catch((e) => console.error('broadcast failed', String(e)));
  const er = (globalThis as any).EdgeRuntime;
  if (er?.waitUntil) er.waitUntil(p);
  else pending.push(p);
}
/** Для тестов: дождаться фоновой обработки */
export const pending: Promise<unknown>[] = [];

const STATUS: Record<string, string> = { queued: '⏳ в очереди', sending: '📤 идёт', done: '✅ завершена', canceled: '⏹ остановлена' };

async function history(c: Ctx) {
  const rows = await db()`
    select b.id, b.segment, b.status, b.total, to_char(b.created_at at time zone 'Europe/Moscow', 'DD.MM HH24:MI') as at,
      count(*) filter (where r.status = 'sent')::int as sent,
      count(*) filter (where r.status = 'blocked')::int as blocked,
      count(*) filter (where r.status = 'failed')::int as failed,
      count(*) filter (where r.status in ('pending', 'sending'))::int as left
    from p4t.broadcasts b left join p4t.broadcast_recipients r on r.broadcast_id = b.id
    group by b.id order by b.id desc limit 10`;
  const L = ['📜 <b>Рассылки</b> (последние 10, время МСК)', ''];
  if (!rows.length) L.push('Рассылок пока не было.');
  for (const r of rows) {
    L.push(`<b>#${r.id}</b> · ${r.at} · ${esc(SEGMENTS[r.segment]?.n ?? r.segment)} · ${STATUS[r.status] ?? r.status}`);
    L.push(`   ✅ ${r.sent} из ${r.total}${r.blocked ? ` · 🚫 заблокировали ${r.blocked}` : ''}${r.failed ? ` · ⚠️ ошибки ${r.failed}` : ''}${r.left ? ` · ⏳ осталось ${r.left}` : ''}`);
  }
  const running = rows.filter((r: any) => r.status === 'queued' || r.status === 'sending');
  await show(c, L.join('\n'), kb(
    ...running.map((r: any) => [b(`⏹ Остановить #${r.id}`, `adm:bx:${r.id}`, 'danger')]),
    [b('🔄 Обновить', 'adm:bl'), b('‹ Статистика', 'adm:s')],
  ));
}

async function cancel(c: Ctx, id: number) {
  const sql = db();
  const r = await sql`update p4t.broadcasts set status = 'canceled', finished_at = now() where id = ${id} and status in ('queued', 'sending') returning id`;
  if (r.length) await sql`update p4t.broadcast_recipients set status = 'skipped' where broadcast_id = ${id} and status = 'pending'`;
  await history(c);
}

export async function adminCallback(c: Ctx, data: string) {
  const [, act, arg] = data.split(':');
  if (act !== 'go' && act !== 'bs' && c.u.state?.f === 'bc') await saveState(c, null);
  switch (act) {
    case 's': return await adminHome(c);
    case 'i': return await show(c, INFO, kb([b('‹ Статистика', 'adm:s')]));
    case 'bc': return await segmentMenu(c);
    case 'bs': return SEGMENTS[arg] ? await askMessage(c, arg) : await segmentMenu(c);
    case 'go': return await launch(c);
    case 'x': await saveState(c, null); return await show(c, '✖️ Рассылка отменена.', kb([b('‹ Статистика', 'adm:s')]));
    case 'bl': return await history(c);
    case 'bx': return await cancel(c, Number(arg));
  }
}

// ---------- обработка очереди рассылок ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function deliver(bc: any, tgId: number) {
  const sql = db();
  try {
    await api('copyMessage', { chat_id: tgId, from_chat_id: Number(bc.src_chat), message_id: Number(bc.src_msg), reply_markup: unsubscribeKb() });
    await sql`update p4t.broadcast_recipients set status = 'sent' where broadcast_id = ${bc.id} and tg_id = ${tgId}`;
  } catch (e) {
    if (e instanceof TgError && e.code === 429) {
      await sql`update p4t.broadcast_recipients set status = 'pending', claimed_at = null where broadcast_id = ${bc.id} and tg_id = ${tgId}`;
      throw e;
    }
    const blocked = e instanceof TgError && e.code === 403;
    if (blocked) await sendFailed(tgId, e);
    await sql`update p4t.broadcast_recipients set status = ${blocked ? 'blocked' : 'failed'}, error = ${String(e).slice(0, 200)} where broadcast_id = ${bc.id} and tg_id = ${tgId}`;
  }
}

async function report(id: number) {
  const sql = db();
  const [r] = await sql`
    select b.created_by, b.segment, b.total,
      count(*) filter (where r.status = 'sent')::int as sent,
      count(*) filter (where r.status = 'blocked')::int as blocked,
      count(*) filter (where r.status = 'failed')::int as failed
    from p4t.broadcasts b left join p4t.broadcast_recipients r on r.broadcast_id = b.id where b.id = ${id} group by b.id`;
  if (!r) return;
  const failedSrc = r.failed > 0 && r.sent === 0 ? '\n\nПохоже, исходное сообщение удалено — бот не смог его скопировать.' : '';
  try {
    await send(Number(r.created_by), `📣 Рассылка <b>#${id}</b> (${esc(SEGMENTS[r.segment]?.n ?? r.segment)}) завершена.\n\n✅ Доставлено: <b>${r.sent}</b> из ${r.total}\n🚫 Заблокировали бота: ${r.blocked}\n⚠️ Ошибки: ${r.failed}${failedSrc}`,
      kb([b('📜 История', 'adm:bl'), b('📊 Статистика', 'adm:s')]));
  } catch (e) { console.error('report failed', String(e)); }
}

/** Отправляет сообщения из очереди (~20 в секунду, лимит Telegram — 30) в течение budgetMs. Возвращает число обработанных */
export async function processBroadcasts(budgetMs = 45_000): Promise<number> {
  const sql = db();
  const t0 = Date.now();
  let done = 0;
  // Возврат «зависших» (функция упала посреди пачки)
  await sql`update p4t.broadcast_recipients set status = 'pending', claimed_at = null where status = 'sending' and claimed_at < now() - interval '3 minutes'`;
  while (Date.now() - t0 < budgetMs) {
    const [bc] = await sql`select * from p4t.broadcasts where status in ('queued', 'sending') order by id limit 1`;
    if (!bc) break;
    if (bc.status === 'queued') await sql`update p4t.broadcasts set status = 'sending' where id = ${bc.id} and status = 'queued'`;
    const batch = await sql`
      update p4t.broadcast_recipients set status = 'sending', claimed_at = now()
      where broadcast_id = ${bc.id} and tg_id in (
        select tg_id from p4t.broadcast_recipients where broadcast_id = ${bc.id} and status = 'pending' limit 20 for update skip locked)
      returning tg_id`;
    if (!batch.length) {
      const [{ n }] = await sql`select count(*)::int as n from p4t.broadcast_recipients where broadcast_id = ${bc.id} and status = 'sending'`;
      if (n > 0) break; // пачку обрабатывает другой запуск
      const fin = await sql`update p4t.broadcasts set status = 'done', finished_at = now() where id = ${bc.id} and status = 'sending' returning id`;
      if (fin.length) await report(Number(bc.id));
      continue;
    }
    const tb = Date.now();
    const res = await Promise.allSettled(batch.map((r: any) => deliver(bc, Number(r.tg_id))));
    done += batch.length;
    if (res.some((x) => x.status === 'rejected')) await sleep(3000); // 429: Telegram просит притормозить
    const wait = 1000 - (Date.now() - tb);
    if (wait > 0) await sleep(wait);
  }
  return done;
}
