// Контекст запроса, общие справочники, отправка и уведомления партнёру
import { db, inCouple, num, Q } from './db.ts';
import { api, Btn, edit, Kb, Message, send, TgError, User } from './tg.ts';
import { esc, localNow } from './util.ts';

export type WS = {
  f: string; k: string; d: Record<string, any>; m?: number; id?: number; only?: boolean;
  skip?: string[]; pm?: string; err?: string; h?: string[];
  /** ключ шага, где ждём свой вариант текстом (например, своё эмодзи) */
  cm?: string;
};
export type UserRow = {
  tg_id: number; first_name: string; username: string | null; couple_id: string | null; state: WS | null;
  widgets: boolean; quiet: boolean; cards: Record<string, number>; join_fails: number; join_window: Date | null;
  news: boolean; blocked_at: Date | null;
  /** своё имя в паре (null — имя из Telegram) */
  display_name: string | null;
  /** имя из профиля Telegram */
  tg_name: string;
};
export type Couple = {
  id: string; invite_code: string | null; invite_expires_at: Date | null; tz: string; currency: string;
  remind_hour: number; remind_days: number[]; created_by: number;
};
export type Ctx = {
  u: UserRow; chat: number; couple: Couple | null; members: UserRow[]; today: string;
  /** сообщение, которое можно отредактировать вместо отправки нового */
  target?: number;
  cbId?: string; answered?: boolean;
};

export const KINDS: Record<string, { e: string; n: string; yearly: boolean; time?: boolean; place?: boolean; def?: string }> = {
  date: { e: '💕', n: 'Свидание', yearly: false, time: true, place: true, def: 'Свидание' },
  birthday: { e: '🎂', n: 'День рождения', yearly: true },
  anniversary: { e: '💍', n: 'Годовщина', yearly: true, def: 'Годовщина' },
  relationship: { e: '❤️', n: 'Начало отношений', yearly: true, def: 'Начало отношений' },
  important: { e: '⭐', n: 'Важная дата', yearly: false, time: true },
  trip: { e: '✈️', n: 'Поездка', yearly: false, time: true, place: true },
};
export const CATS: Record<string, [string, string]> = {
  food: ['🍽', 'Ресторан'], cafe: ['☕', 'Кафе / бар'], show: ['🎭', 'Кино, театр, концерт'], walk: ['🌳', 'Место / прогулка'],
  fun: ['🎳', 'Активность'], trip: ['🧳', 'Путешествие'], other: ['✨', 'Другое'],
};
export const GOAL_EMOJI: [string, string][] = [
  ['🚗', 'Машина'], ['✈️', 'Путешествие'], ['🏠', 'Жильё'], ['💍', 'Свадьба'],
  ['🎁', 'Подарок'], ['💻', 'Техника'], ['🛋', 'Ремонт'], ['🎯', 'Цель'],
];
export const TZS: [string, string][] = [
  ['Europe/Kaliningrad', 'Калининград'], ['Europe/Moscow', 'Москва'], ['Europe/Samara', 'Самара'],
  ['Asia/Yekaterinburg', 'Екатеринбург'], ['Asia/Novosibirsk', 'Новосибирск'], ['Asia/Vladivostok', 'Владивосток'],
  ['Europe/Minsk', 'Минск'], ['Europe/Kyiv', 'Киев'], ['Asia/Almaty', 'Алматы'],
  ['Europe/Amsterdam', 'Амстердам / Берлин'], ['Europe/London', 'Лондон'], ['UTC', 'UTC'],
];
/** Насколько хочется подарок: 1 — очень, 3 — было бы неплохо */
export const PRIO: Record<string, [string, string]> = { 1: ['🔥', 'Очень хочу'], 2: ['🙂', 'Хочу'], 3: ['🤷', 'Было бы неплохо'] };
/** Предмет желания: необязательная категория и повод. Фото/приватные идеи не используются. */
export const GIFT_CATS: Record<string, [string, string]> = {
  tech: ['📱', 'Техника'], clothes: ['👕', 'Одежда'], beauty: ['💄', 'Красота'],
  home: ['🏠', 'Для дома'], experience: ['🎟️', 'Впечатления'], other: ['🎁', 'Другое'],
};
export const GIFT_OCCASIONS: Record<string, [string, string]> = {
  any: ['✨', 'Без повода'], birthday: ['🎂', 'День рождения'],
  anniversary: ['💞', 'Годовщина'], newyear: ['🎄', 'Новый год'],
};
export const CURRENCIES = ['₽', '€', '$', '₴', 'Br', '₸', 'zł'];

export const MENU = {
  keyboard: [
    [{ text: '🏠 Главная' }, { text: '📅 Календарь' }],
    [{ text: '🎯 Цели' }, { text: '📍 Хочу сходить' }],
    [{ text: '🎁 Подарки' }, { text: '➕ Добавить' }, { text: '⚙️ Настройки' }],
  ],
  resize_keyboard: true, input_field_placeholder: 'Выбери раздел или напиши…',
};

export const BOT_USERNAME = () => Deno.env.get('BOT_USERNAME') ?? 'PlansForTwoBot';
/** Поддержка — бот обращений с антиспамом */
export const SUPPORT_BOT = 'KucherAgent';
export const SUPPORT_URL = `https://t.me/${SUPPORT_BOT}`;

export const COMMANDS = [
  ['start', 'Запуск бота и главное меню'], ['help', 'Что умеет бот и все команды'], ['home', 'Главная карточка пары'],
  ['calendar', 'Общий календарь'], ['adddate', 'Добавить свидание или важную дату'], ['upcoming', 'Ближайшие события'],
  ['goals', 'Цели и накопления'], ['addgoal', 'Новая цель'], ['wishlist', 'Хочу сходить'], ['addwish', 'Добавить место или идею'],
  ['gifts', 'Желания и подарки'], ['addgift', 'Добавить желание'],
  ['addpart', 'Пригласить партнёра'], ['join', 'Войти в пару по коду'], ['settings', 'Настройки'], ['name', 'Изменить своё имя'], ['support', 'Написать в поддержку'],
  ['cancel', 'Отменить ввод'],
].map(([command, description]) => ({ command, description }));

/** Имя для показа: своё имя в паре, если задано, иначе имя из Telegram */
export const mapUser = (r: any): UserRow => ({
  ...r, tg_id: Number(r.tg_id), join_fails: Number(r.join_fails ?? 0), cards: r.cards ?? {},
  tg_name: r.first_name ?? '', display_name: r.display_name ?? null, first_name: r.display_name || r.first_name || '',
});
/** Нормализация введённого имени: одна строка, без лишних пробелов. null — если не подходит */
export function cleanName(raw: string): string | null {
  const t = raw.replace(/[\p{Cc}\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064]/gu, ' ').replace(/\s+/g, ' ').trim();
  return t && [...t].length <= 32 ? t : null;
}
const mapCouple = (r: any): Couple => ({ ...r, remind_hour: Number(r.remind_hour), remind_days: (r.remind_days ?? []).map(Number), created_by: Number(r.created_by) });

export async function loadCtx(from: User, chat: number): Promise<Ctx> {
  const sql = db();
  // Регистрация/обновление пользователя + счётчик обращений за день (для обезличенной статистики)
  const [row] = await sql`
    with u as (
      insert into p4t.users (tg_id, first_name, username, last_seen_at) values (${from.id}, ${(from.first_name ?? '').slice(0, 64)}, ${from.username ?? null}, now())
      on conflict (tg_id) do update set first_name = excluded.first_name, username = excluded.username, updated_at = now(), last_seen_at = now(), blocked_at = null
      returning *
    ), a as (
      insert into p4t.activity (tg_id, day) select tg_id, (now() at time zone 'UTC')::date from u
      on conflict (tg_id, day) do update set hits = p4t.activity.hits + 1
    )
    select * from u`;
  const u = mapUser(row);
  return await withCouple({ u, chat, couple: null, members: [], today: localNow('Europe/Moscow').date });
}

export async function withCouple(c: Ctx): Promise<Ctx> {
  const sql = db();
  c.couple = null; c.members = [];
  if (c.u.couple_id) {
    const [cp] = await sql`select * from p4t.couples where id = ${c.u.couple_id}`;
    if (cp) {
      c.couple = mapCouple(cp);
      c.members = (await sql`select * from p4t.users where couple_id = ${cp.id} order by created_at`).map(mapUser);
      c.today = localNow(c.couple.tz).date;
    }
  }
  return c;
}

export const partner = (c: Ctx) => c.members.find((m) => m.tg_id !== c.u.tg_id) ?? null;
export const nameOf = (m: { first_name: string; username?: string | null } | null) => m ? esc(m.first_name || (m.username ? '@' + m.username : 'Партнёр')) : '—';
export function pairTitle(c: Ctx) {
  const p = partner(c);
  return p ? `${nameOf(c.u)} & ${nameOf(p)}` : nameOf(c.u);
}

export async function saveState(c: Ctx, s: WS | null) {
  c.u.state = s;
  await db()`update p4t.users set state = ${s ? JSON.stringify(s) : null}::text::jsonb, updated_at = now() where tg_id = ${c.u.tg_id}`;
}
export async function saveCards(c: Ctx) {
  await db()`update p4t.users set cards = ${JSON.stringify(c.u.cards)}::text::jsonb where tg_id = ${c.u.tg_id}`;
}

/** Показать карточку: отредактировать текущее сообщение (если можно) или отправить новое */
export async function show(c: Ctx, text: string, keyboard?: Kb, extra: Record<string, unknown> = {}): Promise<number> {
  if (c.target) {
    try {
      await edit(c.chat, c.target, text, keyboard);
      return c.target;
    } catch (e) { console.error('edit failed, sending new', String(e)); }
  }
  const m = await send(c.chat, text, keyboard, extra);
  c.target = m.message_id;
  return m.message_id;
}

/** Уведомление второму партнёру (с учётом его настройки «без звука») */
export async function notifyPartner(c: Ctx, text: string, keyboard?: Kb): Promise<boolean> {
  const p = partner(c);
  if (!p) return false;
  try {
    await send(p.tg_id, text, keyboard, { disable_notification: p.quiet });
    return true;
  } catch (e) {
    await sendFailed(p.tg_id, e);
    return false;
  }
}

/** Уведомление обоим (для напоминаний) */
export async function notifyAll(members: { tg_id: number; quiet: boolean }[], text: string, keyboard?: Kb) {
  for (const m of members) {
    try { await send(m.tg_id, text, keyboard, { disable_notification: m.quiet }); } catch (e) { await sendFailed(m.tg_id, e); }
  }
}

// deno-lint-ignore no-explicit-any
/** Ошибка доставки: если пользователь заблокировал бота — отмечаем (для статистики и рассылок) */
export async function sendFailed(tgId: number, e: unknown) {
  console.error(JSON.stringify({ notify_failed: tgId, error: String(e) }));
  if (e instanceof TgError && e.code === 403) {
    try { await db()`update p4t.users set blocked_at = now() where tg_id = ${tgId}`; } catch { /* */ }
  }
}

export const inC = (c: Ctx, fn: (tx: Q) => Promise<any>): Promise<any> => inCouple(c.couple!.id, fn, c.u.tg_id);

export async function goalsWithSaved(tx: Q, archived = false) {
  const rows = await tx`
    select g.id, g.title, g.emoji, g.target, g.deadline::text as deadline, g.archived, g.achieved_at, g.created_by,
           coalesce(sum(c.amount), 0) as saved
    from p4t.goals g left join p4t.contributions c on c.goal_id = g.id
    where g.archived = ${archived}
    group by g.id order by g.created_at`;
  return rows.map((r: any) => ({ ...r, id: Number(r.id), target: num(r.target), saved: num(r.saved) }));
}
export type Goal = { id: number; title: string; emoji: string; target: number; saved: number; deadline: string | null; archived: boolean; achieved_at: Date | null; created_by: number };

export async function goalById(tx: Q, id: number): Promise<Goal | null> {
  const [r] = await tx`
    select g.id, g.title, g.emoji, g.target, g.deadline::text as deadline, g.archived, g.achieved_at, g.created_by,
           coalesce((select sum(amount) from p4t.contributions where goal_id = g.id), 0) as saved
    from p4t.goals g where g.id = ${id}`;
  return r ? { ...r, id: Number(r.id), target: num(r.target), saved: num(r.saved), created_by: Number(r.created_by) } : null;
}

export type Ev = {
  id: number; kind: string; title: string; event_date: string; event_time: string | null; place: string | null;
  note: string | null; yearly: boolean; goal_id: number | null; wish_id: number | null; created_by: number;
  /** чей день рождения (участник пары), null — другой человек */
  person_id: number | null;
};
export async function allEvents(tx: Q): Promise<Ev[]> {
  const rows = await tx`
    select id, kind, title, event_date::text as event_date, to_char(event_time, 'HH24:MI') as event_time,
           place, note, yearly, goal_id, wish_id, created_by, person_id
    from p4t.events order by event_date, event_time nulls first`;
  return rows.map(mapEv);
}
/** Извлекаем только события выбранного месяца для календаря. */
export async function eventsForMonth(tx: Q, year: number, month: number): Promise<Ev[]> {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const rows = await tx`
    select id, kind, title, event_date::text as event_date, to_char(event_time, 'HH24:MI') as event_time,
      place, note, yearly, goal_id, wish_id, created_by, person_id from p4t.events
    where (not yearly and event_date >= ${from}::date and event_date < ${to}::date)
       or (yearly and extract(month from event_date) = ${month} and event_date < ${to}::date)
    order by event_date, event_time nulls first`;
  return rows.map(mapEv);
}

export const mapEv = (r: any): Ev => ({ ...r, id: Number(r.id), goal_id: r.goal_id ? Number(r.goal_id) : null, wish_id: r.wish_id ? Number(r.wish_id) : null, created_by: Number(r.created_by), person_id: r.person_id ? Number(r.person_id) : null });
export async function eventById(tx: Q, id: number): Promise<Ev | null> {
  const [r] = await tx`
    select id, kind, title, event_date::text as event_date, to_char(event_time, 'HH24:MI') as event_time,
           place, note, yearly, goal_id, wish_id, created_by, person_id
    from p4t.events where id = ${id}`;
  return r ? mapEv(r) : null;
}
export const evTitle = (e: { kind: string; title: string }) => e.kind === 'birthday' ? `День рождения: ${e.title}` : e.title;

export const memberName = (c: Ctx, id: number) => {
  const m = c.members.find((x) => x.tg_id === id);
  return m ? nameOf(m) : 'бывший участник';
};

export function fmtExpiry(d: Date, tz: string) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(d);
}

export const noop = 'noop';
export type { Btn };
export { api };
export type { Message };
