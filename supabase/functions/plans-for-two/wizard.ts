// Пошаговый ввод в одной карточке: бот редактирует одно сообщение, введённый текст удаляется.
import { cleanName, Ctx, CATS, GOAL_EMOJI, KINDS, nameOf, saveState, show, WS } from './core.ts';
import { b, Btn, del, kb } from './tg.ts';
import { addDays, esc, fmtDate, fmtMoney, isoOf, MONTHS, parseAmount, parseDate, parseEmoji, parseTime, quickAmounts, WD, weekday, daysInMonth } from './util.ts';
import * as V from './views.ts';

type StepType = 'choice' | 'text' | 'date' | 'time' | 'amount';
interface Step {
  key: string; label: string; type: StepType;
  q: (d: any, c: Ctx) => string;
  opts?: (d: any, c: Ctx) => [string, string][];
  optional?: (d: any) => boolean;
  when?: (d: any) => boolean;
  show?: (v: any, d: any, c: Ctx) => string;
  max?: number;
  past?: (d: any) => boolean;
  check?: (v: any, d: any, c: Ctx) => string | null;
  /** свой вариант текстом: кнопка со значением '*' переключает шаг в режим ввода */
  custom?: { q: string; parse: (t: string) => string | null; err: string };
}
interface Flow { title: (s: WS) => string; steps: Step[]; done: (c: Ctx, s: WS) => Promise<unknown>; cancel?: (c: Ctx) => Promise<unknown> }

const cur = (c: Ctx) => c.couple?.currency ?? '₽';

const EV_STEPS: Step[] = [
  { key: 'kind', label: 'Тип', type: 'choice', q: () => 'Что добавляем?',
    opts: () => Object.entries(KINDS).map(([k, v]) => [`${v.e} ${v.n}`, k]), show: (v) => `${KINDS[v].e} ${KINDS[v].n}` },
  { key: 'title', label: 'Название', type: 'text', max: 100,
    q: (d) => d.kind === 'birthday' ? 'Чей день рождения? Например: «Аня» или «Мама Миши».'
      : d.kind === 'trip' ? 'Куда едем? Например: «Питер на выходные».'
      : d.kind === 'date' ? 'Как назовём свидание? Например: «Ужин в Пушкине». Можно пропустить.'
      : d.kind === 'important' ? 'Что за дата? Например: «Переезд» или «Визит к врачу».'
      : 'Название? Можно пропустить — будет «' + (KINDS[d.kind]?.def ?? '') + '».',
    opts: (d) => d.kind === 'date' ? [['🍽 Ужин в ресторане', 'Ужин в ресторане'], ['🎬 Кино', 'Кино'], ['🌳 Прогулка', 'Прогулка']] : [],
    optional: (d) => !!KINDS[d.kind]?.def },
  { key: 'date', label: 'Дата', type: 'date',
    q: (d) => (d.kind === 'birthday' ? 'Дата рождения? ' : d.kind === 'relationship' ? 'Когда всё началось? ' : 'Когда? ') +
      'Выбери в календаре или напиши: 14.11, 14.11.2026, «завтра».',
    past: (d) => ['birthday', 'relationship', 'anniversary'].includes(d.kind),
    show: (v) => fmtDate(v, { year: true, wd: true }) },
  { key: 'time', label: 'Время', type: 'time', when: (d) => !!KINDS[d.kind]?.time, optional: () => true,
    q: () => 'Во сколько? Напиши, например, 19:30 — или пропусти.',
    opts: () => [['12:00', '12:00'], ['18:00', '18:00'], ['19:00', '19:00'], ['20:00', '20:00']] },
  { key: 'place', label: 'Место', type: 'text', max: 150, when: (d) => !!KINDS[d.kind]?.place, optional: () => true,
    q: () => 'Где? Название, адрес или ссылка. Можно пропустить.' },
  { key: 'note', label: 'Комментарий', type: 'text', max: 500, optional: () => true,
    q: () => 'Комментарий? Например: «забронировать столик». Можно пропустить.' },
];

const GOAL_STEPS: Step[] = [
  { key: 'title', label: 'Название', type: 'text', max: 80, q: () => 'Как назовём цель? Например: «Машина» или «Отпуск в Италии».' },
  { key: 'emoji', label: 'Иконка', type: 'choice', q: () => 'Выбери иконку или просто отправь своё эмодзи в чат:',
    opts: () => [...GOAL_EMOJI.map(([e, n]): [string, string] => [`${e} ${n}`, e]), ['✨ Другое — своё эмодзи', '*']],
    custom: { q: 'Отправь в чат одно эмодзи для цели — например 🐶, 🎸, 🏝 или 🇮🇹.', parse: parseEmoji, err: 'Нужно одно эмодзи, например 🏝' } },
  { key: 'target', label: 'Сумма цели', type: 'amount', q: (_d, c) => `Сколько нужно накопить? Например: 300000 или 300к (${cur(c)}).`,
    show: (v, _d, c) => fmtMoney(v, cur(c)), check: (v) => v > 0 ? null : 'Сумма должна быть больше нуля' },
  { key: 'deadline', label: 'Срок', type: 'date', optional: () => true, q: () => 'К какому сроку? Выбери дату или пропусти.',
    show: (v) => 'до ' + fmtDate(v, { year: true }), check: (v, _d, c) => v > c.today ? null : 'Срок должен быть в будущем' },
  { key: 'start', label: 'Уже отложено', type: 'amount', optional: () => true,
    q: (_d, c) => `Сколько уже отложено? Например: 50000 (${cur(c)}). Можно пропустить.`,
    show: (v, _d, c) => fmtMoney(v, cur(c)), check: (v) => v > 0 ? null : 'Сумма должна быть больше нуля' },
];

const TOP_STEPS: Step[] = [
  { key: 'amount', label: 'Сумма', type: 'amount',
    q: (d, c) => (d.sign > 0 ? 'Сколько добавляем' : 'Сколько снимаем') + ` (${cur(c)})? Можно сразу с комментарием: «15000 С зарплаты».`,
    opts: (d) => quickAmounts(d.target ?? 100000).map((x) => [(d.sign > 0 ? '+' : '−') + fmtMoney(x, ''), String(x)]),
    show: (v, d, c) => (d.sign > 0 ? '+' : '−') + fmtMoney(v, cur(c)),
    check: (v, d) => v <= 0 ? 'Сумма должна быть больше нуля' : (d.sign < 0 && v > (d.saved ?? 0) ? `Нельзя снять больше, чем накоплено (${fmtMoney(d.saved ?? 0, '')})` : null) },
  { key: 'comment', label: 'Комментарий', type: 'text', max: 200, optional: () => true,
    q: () => 'Комментарий к операции? Выбери вариант, напиши свой или пропусти.',
    opts: (d) => (d.sign > 0
      ? ['Отложил(а) с зарплаты', 'Премия', 'Возврат за билеты', 'Подарок', 'Кэшбэк']
      : ['Потратили на цель', 'Взяли на другое', 'Исправление ошибки']).map((x) => [x, x]) },
];

const WISH_STEPS: Step[] = [
  { key: 'cat', label: 'Категория', type: 'choice', q: () => 'Что это?', opts: () => Object.entries(CATS).map(([k, [e, n]]) => [`${e} ${n}`, k]),
    show: (v) => CATS[v].join(' ') },
  { key: 'title', label: 'Название', type: 'text', max: 100, q: () => 'Название места или идеи? Например: «Ресторан Пушкин».' },
  { key: 'note', label: 'Заметка', type: 'text', max: 500, optional: () => true, q: () => 'Заметка или ссылка? Адрес, меню, сайт. Можно пропустить.' },
];

const JOIN_STEPS: Step[] = [
  { key: 'code', label: 'Код', type: 'text', max: 20, q: () => 'Введи код приглашения от партнёра (8 символов, например K7M2-QX9P).' },
];

const NAME_STEPS: Step[] = [
  { key: 'name', label: 'Имя', type: 'text', max: 32,
    q: (_d, c) => `Сейчас ты — <b>${nameOf(c.u)}</b>${c.u.display_name ? '' : ' (из Telegram)'}.\n\nКак тебя называть? Напиши имя до 32 символов: «Аня», «Котик», «Миша 🐻». Его увидит партнёр в уведомлениях и карточках.`,
    opts: (_d, c) => c.u.display_name && c.u.tg_name ? [[`↩️ Как в Telegram: ${c.u.tg_name}`, c.u.tg_name]] : [],
    check: (v, _d, c) => v === c.u.tg_name || cleanName(String(v)) ? null : 'Имя должно быть от 1 до 32 символов' },
];

export const FLOWS: Record<string, Flow> = {
  ev: { title: (s) => s.id ? '✏️ Изменение события' : '➕ Новое событие', steps: EV_STEPS, done: (c, s) => V.finishEvent(c, s) },
  goal: { title: (s) => s.id ? '✏️ Изменение цели' : '🎯 Новая цель', steps: GOAL_STEPS, done: (c, s) => V.finishGoal(c, s) },
  top: { title: (s) => (s.d.sign > 0 ? '➕ Пополнение: ' : '➖ Снятие: ') + `${s.d.emoji ?? ''} ${s.d.gtitle ?? ''}`, steps: TOP_STEPS, done: (c, s) => V.finishTopUp(c, s) },
  wish: { title: (s) => s.id ? '✏️ Изменение записи' : '📍 Хочу сходить', steps: WISH_STEPS, done: (c, s) => V.finishWish(c, s) },
  join: { title: () => '🔑 Вход по коду', steps: JOIN_STEPS, done: (c, s) => V.finishJoin(c, s) },
  name: { title: () => '✏️ Твоё имя', steps: NAME_STEPS, done: (c, s) => V.finishName(c, s), cancel: (c) => V.settings(c, '✖️ Имя не изменено.') },
};

const visible = (st: Step, s: WS) => (!st.when || st.when(s.d)) && !(s.skip ?? []).includes(st.key);

export async function startWizard(c: Ctx, f: string, d: Record<string, any> = {}, o: { only?: string; id?: number; skip?: string[] } = {}) {
  const flow = FLOWS[f];
  const s: WS = { f, k: '', d, h: [], skip: o.skip, id: o.id, only: !!o.only };
  const first = o.only ? flow.steps.find((x) => x.key === o.only) : flow.steps.find((x) => visible(x, s));
  if (!first) return;
  s.k = first.key;
  await render(c, s);
}

function picker(pm: string, today: string): Btn[][] {
  const [y, m] = pm.split('-').map(Number);
  const mk = (yy: number, mm: number) => { if (mm < 1) { mm = 12; yy--; } if (mm > 12) { mm = 1; yy++; } return `${yy}-${String(mm).padStart(2, '0')}`; };
  const rows: Btn[][] = [[
    b('«', `wz:cm:${mk(y - 1, m)}`), b('‹', `wz:cm:${mk(y, m - 1)}`), b(`${MONTHS[m - 1]} ${y}`, 'noop'),
    b('›', `wz:cm:${mk(y, m + 1)}`), b('»', `wz:cm:${mk(y + 1, m)}`),
  ], WD.map((w) => b(w, 'noop'))];
  const first = weekday(isoOf(y, m, 1)), n = daysInMonth(y, m);
  let row: Btn[] = Array.from({ length: first }, () => b('·', 'noop'));
  for (let d = 1; d <= n; d++) {
    const iso = isoOf(y, m, d);
    row.push(b(iso === today ? `[${d}]` : String(d), `wz:d:${iso.replace(/-/g, '')}`));
    if (row.length === 7) { rows.push(row); row = []; }
  }
  if (row.length) { while (row.length < 7) row.push(b('·', 'noop')); rows.push(row); }
  rows.push([b('Сегодня', `wz:d:${today.replace(/-/g, '')}`), b('Завтра', `wz:d:${addDays(today, 1).replace(/-/g, '')}`)]);
  return rows;
}

function text(c: Ctx, s: WS) {
  const flow = FLOWS[s.f];
  const st = flow.steps.find((x) => x.key === s.k)!;
  const vis = flow.steps.filter((x) => visible(x, s));
  const idx = vis.findIndex((x) => x.key === s.k);
  const lines = [`<b>${esc(flow.title(s))}</b>` + (s.only || vis.length < 2 ? '' : ` · шаг ${idx + 1} из ${vis.length}`), ''];
  if (!s.only) {
    for (const x of vis) {
      if (x.key === s.k) break;
      const v = s.d[x.key];
      if (v === undefined || v === null || v === '') continue;
      lines.push(`${x.label}: <b>${esc(x.show ? x.show(v, s.d, c) : v)}</b>`);
    }
    if (lines.length > 2) lines.push('');
  }
  lines.push(s.cm === st.key && st.custom ? st.custom.q : st.q(s.d, c));
  if (s.err) lines.push('', `⚠️ ${esc(s.err)}`);
  return lines.join('\n');
}

function keyboard(c: Ctx, s: WS) {
  const st = FLOWS[s.f].steps.find((x) => x.key === s.k)!;
  const rows: Btn[][] = [];
  const custom = s.cm === st.key && !!st.custom;
  const opts = st.opts && !custom ? st.opts(s.d, c) : [];
  const perRow = st.type === 'choice' ? 2 : st.type === 'time' ? 4 : st.type === 'amount' ? 3 : 1;
  const own = opts.findIndex(([, v]) => v === '*');
  const main = opts.map((o, i) => [o, i] as const).filter(([, i]) => i !== own);
  for (let i = 0; i < main.length; i += perRow) rows.push(main.slice(i, i + perRow).map(([[l], j]) => b(l, `wz:v:${j}`)));
  if (own >= 0) rows.push([b(opts[own][0], `wz:v:${own}`)]);
  if (custom) rows.push([b('‹ К списку иконок', 'wz:cx')]);
  if (st.type === 'date') {
    const base = s.pm ?? (s.d[st.key] ? String(s.d[st.key]).slice(0, 7) : c.today.slice(0, 7));
    rows.push(...picker(base, c.today));
  }
  const nav: Btn[] = [];
  if ((s.h ?? []).length && !s.only) nav.push(b('‹ Назад', 'wz:back'));
  if (st.optional?.(s.d)) nav.push(b('Пропустить ›', 'wz:skip'));
  nav.push(b('✖️ Отмена', 'wz:x'));
  rows.push(nav);
  return kb(...rows);
}

export async function render(c: Ctx, s: WS) {
  if (s.m && !c.target) c.target = s.m;
  s.m = await show(c, text(c, s), keyboard(c, s));
  await saveState(c, s);
}

async function accept(c: Ctx, s: WS, value: any) {
  const flow = FLOWS[s.f];
  const st = flow.steps.find((x) => x.key === s.k)!;
  const err = st.check ? st.check(value, s.d, c) : null;
  if (err) { s.err = err; return await render(c, s); }
  s.d[st.key] = value;
  s.err = undefined; s.pm = undefined; s.cm = undefined;
  await advance(c, s);
}

async function advance(c: Ctx, s: WS) {
  const flow = FLOWS[s.f];
  const i = flow.steps.findIndex((x) => x.key === s.k);
  const next = s.only ? undefined : flow.steps.slice(i + 1).find((x) => visible(x, s));
  if (!next) {
    c.target = s.m;
    await saveState(c, null);
    return await flow.done(c, s);
  }
  (s.h ??= []).push(s.k);
  s.k = next.key;
  await render(c, s);
}

function parse(st: Step, s: WS, c: Ctx, input: string): { ok: true; v: any } | { ok: false; err: string } {
  const t = input.trim();
  switch (st.type) {
    case 'choice': {
      if (!st.custom) return { ok: false, err: 'Выбери вариант кнопкой' };
      const v = st.custom.parse(t);
      return v ? { ok: true, v } : { ok: false, err: st.custom.err };
    }
    case 'text':
      if (!t) return { ok: false, err: 'Пустой текст' };
      if (t.length > (st.max ?? 200)) return { ok: false, err: `Слишком длинно: максимум ${st.max} символов` };
      return { ok: true, v: t };
    case 'date': {
      const d = parseDate(t, c.today, st.past?.(s.d) ?? false);
      return d ? { ok: true, v: d } : { ok: false, err: 'Не понял дату. Примеры: 14.11, 14.11.2026, 14 ноября, завтра' };
    }
    case 'time': {
      const v = parseTime(t);
      return v ? { ok: true, v } : { ok: false, err: 'Не понял время. Пример: 19:30' };
    }
    case 'amount': {
      const a = parseAmount(t);
      if (!a) return { ok: false, err: 'Не понял сумму. Примеры: 15000, 15 000, 15к' };
      if (s.f === 'top' && a.comment) { s.d.comment = a.comment; (s.skip ??= []).push('comment'); }
      return { ok: true, v: Math.abs(a.amount) };
    }
  }
}

/** Текстовое сообщение, пока активен ввод */
export async function onText(c: Ctx, s: WS, msgId: number, input: string) {
  await del(c.chat, msgId);
  const st = FLOWS[s.f]?.steps.find((x) => x.key === s.k);
  if (!st) { await saveState(c, null); return; }
  const r = parse(st, s, c, input);
  if (!r.ok) { s.err = r.err; return await render(c, s); }
  await accept(c, s, r.v);
}

/** Нажатие кнопки в карточке ввода */
export async function onCallback(c: Ctx, s: WS, data: string) {
  const st = FLOWS[s.f]?.steps.find((x) => x.key === s.k);
  if (!st) { await saveState(c, null); return; }
  const [, act, arg] = data.split(':');
  if (act === 'x') {
    await saveState(c, null);
    c.target = s.m;
    const cancel = FLOWS[s.f]?.cancel;
    return cancel ? await cancel(c) : await V.home(c, '✖️ Ввод отменён.');
  }
  if (act === 'back') {
    const prev = (s.h ?? []).pop();
    if (prev) { s.k = prev; s.err = undefined; s.pm = undefined; s.cm = undefined; }
    return await render(c, s);
  }
  if (act === 'skip') {
    if (!st.optional?.(s.d)) return await render(c, s);
    s.d[st.key] = null;
    s.err = undefined;
    return await advance(c, s);
  }
  if (act === 'cm' && st.type === 'date' && /^\d{4}-\d{2}$/.test(arg)) { s.pm = arg; return await render(c, s); }
  if (act === 'd' && st.type === 'date' && /^\d{8}$/.test(arg)) {
    return await accept(c, s, `${arg.slice(0, 4)}-${arg.slice(4, 6)}-${arg.slice(6, 8)}`);
  }
  if (act === 'cx') { s.cm = undefined; s.err = undefined; return await render(c, s); }
  if (act === 'v') {
    const opts = st.opts ? st.opts(s.d, c) : [];
    const o = opts[Number(arg)];
    if (!o) return await render(c, s);
    if (o[1] === '*' && st.custom) { s.cm = st.key; s.err = undefined; return await render(c, s); }
    if (st.type === 'amount') return await accept(c, s, Number(o[1]));
    return await accept(c, s, o[1]);
  }
  await render(c, s);
}
