// Экраны бота: главная, календарь, события, цели и бюджет, «Хочу сходить», настройки, пара
import {
  allEvents, BOT_USERNAME, CATS, cleanName, SUPPORT_BOT, SUPPORT_URL, Ctx, CURRENCIES, Ev, evTitle, eventById, fmtExpiry, Goal, goalById, goalsWithSaved,
  inC, KINDS, MENU, memberName, nameOf, notifyPartner, pairTitle, partner, saveCards, saveState, show, TZS, withCouple, WS,
} from './core.ts';
import { db, num, Q } from './db.ts';
import { answerWidget, b, Btn, del, kb, Kb, send, sendWidget, u } from './tg.ts';
import {
  bar, cut, daysBetween, esc, fmtDate, fmtMoney, fmtShort, fmtShortDate, inviteCode, localNow, nextOccurrence, normCode,
  occursInMonth, pctOf, plural, quickAmounts, showCode, untilText, utf8len, yearsText,
} from './util.ts';
import { CAL_HTML, GOAL_HTML, HOME_HTML } from './widgets.ts';
import { startWizard } from './wizard.ts';

const navRow = (...extra: Btn[]): Btn[] => [...extra, b('🏠 Главная', 'nav:home')];
const cur = (c: Ctx) => c.couple!.currency;
const money = (c: Ctx, n: number) => fmtMoney(n, cur(c));

// ============================== Пара и онбординг ==============================

export async function onboarding(c: Ctx, extra = '') {
  const text = [
    extra ? extra + '\n' : '',
    '💞 <b>Планы на двоих</b>',
    '',
    'Общий календарь, цели с копилкой и список «Хочу сходить» — только для вас двоих.',
    '',
    '<b>Как начать</b>',
    '1. Нажми «Создать пару» — бот выдаст одноразовый код.',
    '2. Отправь ссылку или код партнёру.',
    '3. Партнёр открывает ссылку — и вы в одной паре.',
    '',
    'Уже есть код от партнёра? Нажми «Ввести код».',
  ].join('\n').trim();
  await show(c, text, kb(
    [b('💌 Создать пару и пригласить', 'pair:new', 'primary')],
    [b('🔑 Ввести код', 'pair:code')],
    [b('❓ Что умеет бот', 'nav:help')],
  ));
}

async function createCouple(c: Ctx) {
  const sql = db();
  await sql.begin(async (tx: Q) => {
    const [cp] = await tx`insert into p4t.couples (created_by) values (${c.u.tg_id}) returning id`;
    await tx`update p4t.users set couple_id = ${cp.id} where tg_id = ${c.u.tg_id}`;
    c.u.couple_id = cp.id;
  });
  await withCouple(c);
}

export async function invite(c: Ctx, regen = false) {
  if (!c.couple) await createCouple(c);
  const p = partner(c);
  if (p) {
    return await show(c, `❤️ У тебя уже есть пара: <b>${pairTitle(c)}</b>.\n\nВ паре может быть только два человека. Чтобы пригласить другого человека, сначала нужно выйти из пары в /settings.`, kb(navRow()));
  }
  let code = c.couple!.invite_code;
  let exp = c.couple!.invite_expires_at ? new Date(c.couple!.invite_expires_at) : null;
  if (regen || !code || !exp || exp < new Date()) {
    for (let i = 0; i < 5; i++) {
      code = inviteCode();
      try {
        const [r] = await db()`update p4t.couples set invite_code = ${code}, invite_expires_at = now() + interval '48 hours'
          where id = ${c.couple!.id} returning invite_expires_at`;
        exp = new Date(r.invite_expires_at);
        break;
      } catch (e) { if (i === 4) throw e; }
    }
  }
  const link = `https://t.me/${BOT_USERNAME()}?start=j_${code}`;
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Присоединяйся ко мне в «Планы на двоих» 💞 Код: ' + showCode(code!))}`;
  await show(c, [
    '💌 <b>Приглашение партнёра</b>',
    '',
    `Код: <code>${showCode(code!)}</code>`,
    `Действует до ${esc(fmtExpiry(exp!, c.couple!.tz))} · одноразовый`,
    '',
    'Отправь партнёру ссылку кнопкой ниже. Или пусть он откроет @' + BOT_USERNAME() + ' и введёт:',
    `<code>/join ${code}</code>`,
    '',
    '🔒 Присоединиться можно только по этому коду. После входа партнёра код сгорает.',
  ].join('\n'), kb(
    [{ text: '📤 Отправить приглашение', url: share }],
    [{ text: '📋 Скопировать ссылку', copy_text: { text: link } }],
    [b('🔄 Новый код', 'pair:regen'), b('🚫 Отозвать', 'pair:revoke', 'danger')],
    navRow(),
  ));
}

export async function revokeInvite(c: Ctx) {
  if (c.couple) await db()`update p4t.couples set invite_code = null, invite_expires_at = null where id = ${c.couple.id}`;
  await show(c, '🚫 Код приглашения отозван. Новый можно получить командой /addpart.', kb(navRow(b('💌 Новый код', 'pair:regen'))));
}

async function joinBlocked(c: Ctx) {
  const [r] = await db()`select join_fails >= 5 and join_window > now() - interval '1 hour' as blocked from p4t.users where tg_id = ${c.u.tg_id}`;
  return !!r?.blocked;
}
async function joinFail(c: Ctx) {
  await db()`update p4t.users set
      join_fails = case when join_window is null or join_window < now() - interval '1 hour' then 1 else join_fails + 1 end,
      join_window = case when join_window is null or join_window < now() - interval '1 hour' then now() else join_window end
    where tg_id = ${c.u.tg_id}`;
}

/** Проверка кода и подтверждение входа */
export async function joinPreview(c: Ctx, raw: string) {
  const code = normCode(raw);
  if (await joinBlocked(c)) return await show(c, '⏳ Слишком много неверных попыток. Попробуй через час.', kb(navRow()));
  if (!/^[A-Z2-9]{8}$/.test(code)) { await joinFail(c); return await show(c, '❌ Код должен состоять из 8 символов, например <code>K7M2-QX9P</code>.', kb([b('🔑 Ввести ещё раз', 'pair:code')], navRow())); }
  const [cp] = await db()`select c.id, (select coalesce(display_name, first_name) from p4t.users where tg_id = c.created_by) as owner,
      (select count(*) from p4t.users where couple_id = c.id)::int as members
    from p4t.couples c where c.invite_code = ${code} and c.invite_expires_at > now()`;
  if (!cp) { await joinFail(c); return await show(c, '❌ Код не найден или истёк. Попроси партнёра отправить новый (/addpart).', kb([b('🔑 Ввести ещё раз', 'pair:code')], navRow())); }
  if (cp.id === c.u.couple_id) return await show(c, 'Это код твоей же пары 🙂 Отправь его партнёру.', kb(navRow()));
  if (cp.members >= 2) return await show(c, '❌ В этой паре уже два человека.', kb(navRow()));
  if (partner(c)) return await show(c, `Ты уже в паре: <b>${pairTitle(c)}</b>. Чтобы присоединиться к другой, сначала выйди из текущей в /settings.`, kb(navRow()));
  let warn = '';
  if (c.couple) {
    const [n] = await db()`select (select count(*) from p4t.events where couple_id = ${c.couple.id}) + (select count(*) from p4t.goals where couple_id = ${c.couple.id}) + (select count(*) from p4t.wishes where couple_id = ${c.couple.id}) as n`;
    if (Number(n.n) > 0) warn = '\n\n⚠️ У тебя уже есть своя пара без партнёра, и в ней есть записи. После присоединения они будут удалены.';
  }
  await show(c, `💞 Присоединиться к паре с <b>${esc(cp.owner ?? 'партнёром')}</b>?${warn}`, kb(
    [b('✅ Присоединиться', `pair:join:${code}`, 'success')],
    [b('Отмена', 'nav:home')],
  ));
}

export async function doJoin(c: Ctx, raw: string) {
  const code = normCode(raw);
  if (await joinBlocked(c)) return await show(c, '⏳ Слишком много неверных попыток. Попробуй через час.', kb(navRow()));
  if (partner(c)) return await show(c, 'Ты уже в паре.', kb(navRow()));
  let res: 'ok' | 'bad' | 'full' = 'bad';
  await db().begin(async (tx: Q) => {
    const [cp] = await tx`select id from p4t.couples where invite_code = ${code} and invite_expires_at > now() for update`;
    if (!cp) return;
    const [{ n }] = await tx`select count(*)::int as n from p4t.users where couple_id = ${cp.id}`;
    if (n >= 2) { res = 'full'; return; }
    const old = c.u.couple_id;
    await tx`update p4t.users set couple_id = ${cp.id}, state = null where tg_id = ${c.u.tg_id}`;
    await tx`update p4t.couples set invite_code = null, invite_expires_at = null where id = ${cp.id}`;
    if (old && old !== cp.id) {
      const [{ left }] = await tx`select count(*)::int as left from p4t.users where couple_id = ${old}`;
      if (left === 0) await tx`delete from p4t.couples where id = ${old}`;
    }
    c.u.couple_id = cp.id;
    res = 'ok';
  });
  if (res === 'bad') { await joinFail(c); return await show(c, '❌ Код не найден или истёк. Попроси партнёра отправить новый.', kb(navRow())); }
  if (res === 'full') return await show(c, '❌ В этой паре уже два человека.', kb(navRow()));
  await withCouple(c);
  await notifyPartner(c, `🎉 <b>${nameOf(c.u)}</b> теперь в вашей паре!\n\nКалендарь, цели и «Хочу сходить» теперь общие. Все изменения будут приходить вам обоим.`, kb([b('🏠 Открыть главную', 'nav:home')]));
  c.target = undefined;
  await send(c.chat, `🎉 Готово! Вы теперь пара: <b>${pairTitle(c)}</b>.\n\nМеню разделов — внизу экрана. Справка — /help.`, MENU);
  await home(c);
}

export async function leaveConfirm(c: Ctx) {
  if (!c.couple) return await onboarding(c);
  const p = partner(c);
  await show(c, [
    '🚪 <b>Выйти из пары?</b>',
    '',
    p ? `Ты потеряешь доступ к общим данным. Календарь, цели и список останутся у <b>${nameOf(p)}</b>.`
      : 'Ты единственный участник — <b>все данные пары будут удалены безвозвратно</b>.',
  ].join('\n'), kb([b('🚪 Да, выйти', 'pair:leave!', 'danger')], [b('Отмена', 'nav:set')]));
}

export async function doLeave(c: Ctx) {
  if (!c.couple) return await onboarding(c);
  const p = partner(c);
  const cid = c.couple.id;
  await db().begin(async (tx: Q) => {
    await tx`update p4t.users set couple_id = null, state = null, cards = '{}' where tg_id = ${c.u.tg_id}`;
    const [{ left }] = await tx`select count(*)::int as left from p4t.users where couple_id = ${cid}`;
    if (left === 0) await tx`delete from p4t.couples where id = ${cid}`;
  });
  if (p) {
    try {
      await send(p.tg_id, `🚪 <b>${nameOf(c.u)}</b> вышел(-ла) из пары. Все данные остались у тебя.\nПригласить партнёра снова — /addpart.`);
    } catch (e) { console.error(String(e)); }
  }
  c.u.couple_id = null;
  await withCouple(c);
  await onboarding(c, '✅ Ты вышел(-ла) из пары.');
}

// ============================== Главная ==============================

type Upcoming = Ev & { occ: string; days: number; years: number };

function upcoming(evs: Ev[], today: string): Upcoming[] {
  return evs.map((e) => {
    const o = nextOccurrence(e.event_date, e.yearly, today);
    return { ...e, occ: o.date, years: o.years, days: daysBetween(today, o.date) };
  }).filter((e) => e.days >= 0)
    .sort((a, b) => a.occ.localeCompare(b.occ) || (a.event_time ?? '').localeCompare(b.event_time ?? ''));
}

const evExtra = (e: Upcoming) => (e.kind === 'relationship' || e.kind === 'anniversary') && e.years > 0 ? ` · ${yearsText(e.years)}` : '';

async function homeData(c: Ctx) {
  return await inC(c, async (tx) => {
    const evs = await allEvents(tx);
    const goals = await goalsWithSaved(tx);
    const [{ n }] = await tx`select count(*)::int as n from p4t.wishes where done_at is null`;
    const rel = evs.filter((e) => e.kind === 'relationship').sort((a, b) => a.event_date.localeCompare(b.event_date))[0];
    const together = rel && rel.event_date <= c.today ? daysBetween(rel.event_date, c.today) : null;
    return { up: upcoming(evs, c.today).slice(0, 4), goals, wishes: n as number, rel, together };
  });
}

function homeKb(c: Ctx): Kb {
  return kb(
    [b('📅 Календарь', 'nav:cal'), b('🎯 Цели', 'nav:goals'), b('📍 Хочу', 'nav:wish')],
    [b('➕ Добавить', 'nav:add', 'primary'), b('⚙️', 'nav:set')],
    partner(c) ? [] : [b('💌 Пригласить партнёра', 'pair:new', 'success')],
  );
}

export async function home(c: Ctx, notice = '') {
  if (!c.couple) return await onboarding(c, notice);
  const h = await homeData(c);
  const t = h.together !== null ? `❤️ Вместе ${h.together} ${plural(h.together, 'день', 'дня', 'дней')} · с ${fmtDate(h.rel!.event_date, { year: true })}` : '❤️ Добавь дату начала отношений — бот будет считать дни вместе';
  if (c.u.widgets) {
    // Текстовое сообщение-уведомление (например, «ввод отменён») заменяем, затем шлём живую карточку
    if (c.target) { await del(c.chat, c.target); c.target = undefined; }
    if (notice) await send(c.chat, notice);
    // Навигация под виджетом дублирует клавиатуру меню, поэтому кнопок нет; остаётся только приглашение, пока партнёра нет
    const wk = partner(c) ? undefined : kb([b('💌 Пригласить партнёра', 'pair:new', 'success')]);
    return await sendCard(c, 'home', HOME_HTML, `💞 <b>${pairTitle(c)}</b>\n${esc(t)}`, homeWidgetJson(c, h), wk, () => send(c.chat, homeText(c, h, ''), homeKb(c)));
  }
  await show(c, homeText(c, h, notice), homeKb(c));
}

function homeText(c: Ctx, h: Awaited<ReturnType<typeof homeData>>, notice: string) {
  const L: string[] = [];
  if (notice) L.push(notice, '');
  L.push(`💞 <b>${pairTitle(c)}</b>`);
  L.push(h.together !== null ? `❤️ Вместе <b>${h.together}</b> ${plural(h.together, 'день', 'дня', 'дней')} · с ${fmtDate(h.rel!.event_date, { year: true })}` : '❤️ Добавь «Начало отношений» — бот будет считать дни вместе');
  if (!partner(c)) L.push('', '💌 Партнёр ещё не присоединился — /addpart');
  L.push('', '<b>📅 Ближайшее</b>');
  if (!h.up.length) L.push('Пока пусто — добавь свидание или важную дату');
  for (const e of h.up.slice(0, 4)) L.push(`${KINDS[e.kind].e} ${esc(cut(evTitle(e), 40))} · ${fmtShortDate(e.occ)}${e.event_time ? ' ' + e.event_time : ''} · <i>${untilText(e.days)}</i>${evExtra(e)}`);
  L.push('', '<b>🎯 Цели</b>');
  if (!h.goals.length) L.push('Целей пока нет — /addgoal');
  for (const g of h.goals.slice(0, 4)) {
    const p = pctOf(g.saved, g.target);
    L.push(`${g.emoji} ${esc(g.title)} — <b>${p}%</b>${p >= 100 ? ' 🎉' : ''}`, `${bar(p)} ${fmtShort(g.saved)} из ${fmtShort(g.target)} ${cur(c)}`);
  }
  L.push('', `📍 Хочу сходить: <b>${h.wishes}</b> ${plural(h.wishes, 'место', 'места', 'мест')}`);
  return L.join('\n');
}

function fitJson(o: any, shrink: (() => boolean)[]): string {
  let s = JSON.stringify(o);
  for (const f of shrink) { while (utf8len(s) > 1000 && f()) s = JSON.stringify(o); }
  return s;
}

function homeWidgetJson(c: Ctx, h: Awaited<ReturnType<typeof homeData>>) {
  const o = {
    n: `${partner(c) ? c.u.first_name + ' & ' + partner(c)!.first_name : c.u.first_name}`.slice(0, 60),
    t: h.together !== null ? `${h.together} ${plural(h.together, 'день', 'дня', 'дней')}` : null,
    s: h.rel ? fmtShortDate(h.rel.event_date) + ' ' + h.rel.event_date.slice(0, 4) : '',
    p: partner(c) ? 0 : 1,
    e: h.up.slice(0, 3).map((e) => [e.id, KINDS[e.kind].e, cut(evTitle(e), 26), fmtShortDate(e.occ), untilText(e.days)]),
    g: h.goals.slice(0, 3).map((g) => [g.id, g.emoji, cut(g.title, 26), pctOf(g.saved, g.target), `${fmtShort(g.saved)} из ${fmtShort(g.target)} ${cur(c)}`]),
    w: h.wishes,
  };
  return fitJson(o, [() => !!o.g.pop(), () => !!o.e.pop()]);
}

/** Отправка карточки-виджета; предыдущая карточка того же вида удаляется, чтобы не захламлять чат */
export async function sendCard(c: Ctx, kind: string, html: string, caption: string, data: string, keyboard: Kb | undefined, fallback: () => Promise<unknown>) {
  const prev = c.u.cards?.[kind];
  try {
    const m = await sendWidget(c.chat, html, caption, data, keyboard);
    if (prev && prev !== m.message_id) await del(c.chat, prev);
    c.u.cards = { ...(c.u.cards ?? {}), [kind]: m.message_id };
    await saveCards(c);
  } catch (e) {
    console.error('sendWidget failed, fallback to text', String(e));
    await fallback();
  }
}

// ============================== Календарь ==============================

function monthMarks(evs: Ev[], y: number, m: number) {
  const d: Record<string, string> = {};
  for (const e of evs) {
    const o = occursInMonth(e.event_date, e.yearly, y, m);
    if (!o) continue;
    const day = String(Number(o.slice(8, 10)));
    const em = KINDS[e.kind].e;
    if (!(d[day] ?? '').includes(em) && [...(d[day] ?? '')].length < 4) d[day] = (d[day] ?? '') + em;
  }
  return d;
}

async function calJson(c: Ctx, y: number, m: number) {
  const evs = await inC(c, (tx) => allEvents(tx));
  return JSON.stringify({ y, m, t: c.today, d: monthMarks(evs, y, m) });
}

async function dayJson(c: Ctx, day: string) {
  const evs = await inC(c, (tx) => allEvents(tx));
  const [y, m] = day.split('-').map(Number);
  const l = evs.filter((e) => occursInMonth(e.event_date, e.yearly, y, m) === day)
    .map((e) => [e.id, KINDS[e.kind].e, cut(evTitle(e), 30), e.event_time ?? '']);
  const o = { x: fmtDate(day, { wd: true }), l };
  return fitJson(o, [() => !!o.l.pop()]);
}

export async function calendar(c: Ctx) {
  if (!c.couple) return await onboarding(c);
  const [y, m] = c.today.split('-').map(Number);
  const k = kb([b('➕ Добавить событие', 'add:ev', 'primary')], [b('📋 Ближайшие', 'up:0'), b('🕰 Прошедшие', 'pa:0')], navRow());
  if (c.u.widgets) {
    if (c.target) { await del(c.chat, c.target); c.target = undefined; }
    return await sendCard(c, 'cal', CAL_HTML, '📅 <b>Наш календарь</b> · нажми на день, чтобы увидеть события', await calJson(c, y, m), k, () => upcomingList(c, 0));
  }
  await upcomingList(c, 0);
}

export async function upcomingList(c: Ctx, page: number, past = false) {
  if (!c.couple) return await onboarding(c);
  const evs = await inC(c, (tx) => allEvents(tx));
  let list: Upcoming[];
  if (past) {
    list = evs.filter((e) => !e.yearly && e.event_date < c.today).map((e) => ({ ...e, occ: e.event_date, years: 0, days: daysBetween(c.today, e.event_date) }))
      .sort((a, b) => b.occ.localeCompare(a.occ));
  } else list = upcoming(evs, c.today);
  const per = 8, pages = Math.max(1, Math.ceil(list.length / per));
  page = Math.min(Math.max(0, page), pages - 1);
  const slice = list.slice(page * per, page * per + per);
  const L = [past ? '🕰 <b>Прошедшие события</b>' : '📋 <b>Ближайшие события</b>', ''];
  if (!slice.length) L.push(past ? 'Прошедших событий пока нет.' : 'Ничего не запланировано. Самое время позвать на свидание 💕');
  for (const e of slice) {
    L.push(`${KINDS[e.kind].e} <b>${esc(cut(evTitle(e), 50))}</b>${evExtra(e)}`);
    L.push(`    ${fmtDate(e.occ, { wd: true, year: e.occ.slice(0, 4) !== c.today.slice(0, 4) })}${e.event_time ? ' · ' + e.event_time : ''} · ${untilText(e.days)}`);
  }
  const p = past ? 'pa' : 'up';
  const rows: Btn[][] = slice.map((e) => [b(`${KINDS[e.kind].e} ${fmtShortDate(e.occ)} · ${cut(evTitle(e), 32)}`, `ev:o:${e.id}`)]);
  rows.push([page > 0 ? b('‹', `${p}:${page - 1}`) : null, pages > 1 ? b(`${page + 1}/${pages}`, 'noop') : null, page < pages - 1 ? b('›', `${p}:${page + 1}`) : null].filter(Boolean) as Btn[]);
  rows.push([b('➕ Добавить', 'add:ev', 'primary'), past ? b('📋 Ближайшие', 'up:0') : b('🕰 Прошедшие', 'pa:0')]);
  rows.push(navRow(b('📅 Календарь', 'nav:cal')));
  await show(c, L.join('\n'), kb(...rows));
}

// ============================== События ==============================

export function addMenu(c: Ctx) {
  if (!c.couple) return onboarding(c);
  return show(c, '➕ <b>Что добавим?</b>', kb(
    [b('💕 Свидание', 'add:ev:date', 'primary'), b('🎂 День рождения', 'add:ev:birthday')],
    [b('💍 Годовщина', 'add:ev:anniversary'), b('❤️ Начало отношений', 'add:ev:relationship')],
    [b('⭐ Важная дата', 'add:ev:important'), b('✈️ Поездка', 'add:ev:trip')],
    [b('🎯 Цель накоплений', 'add:goal'), b('📍 Хочу сходить', 'add:wish')],
    navRow(),
  ));
}

export async function addEvent(c: Ctx, kind?: string) {
  if (!c.couple) return await onboarding(c);
  if (kind && KINDS[kind]) return await startWizard(c, 'ev', { kind }, { skip: ['kind'] });
  await startWizard(c, 'ev');
}

export async function eventCard(c: Ctx, id: number, notice = '') {
  const r = await inC(c, async (tx) => {
    const e = await eventById(tx, id);
    if (!e) return null;
    const g = e.goal_id ? await goalById(tx, e.goal_id) : null;
    const [w] = e.wish_id ? await tx`select id, title from p4t.wishes where id = ${e.wish_id}` : [];
    return { e, g, w };
  });
  if (!r) return await show(c, '🤷 Событие не найдено — возможно, его удалили.', kb(navRow(b('📋 Ближайшие', 'up:0'))));
  const { e, g, w } = r;
  const o = nextOccurrence(e.event_date, e.yearly, c.today);
  const days = daysBetween(c.today, o.date);
  const L: string[] = [];
  if (notice) L.push(notice, '');
  L.push(`${KINDS[e.kind].e} <b>${esc(evTitle(e))}</b>`, `<i>${KINDS[e.kind].n}</i>`, '');
  L.push(`📆 ${fmtDate(o.date, { wd: true, year: true })}${e.event_time ? ' · ' + e.event_time : ''}`);
  L.push(`⏳ ${untilText(days)}`);
  if (e.yearly) {
    L.push(`🔁 Каждый год${e.kind !== 'birthday' && o.years > 0 ? ` · будет ${yearsText(o.years)}` : ''} · с ${fmtDate(e.event_date, { year: true })}`);
  }
  if (e.place) L.push(`📍 ${esc(e.place)}`);
  if (e.note) L.push(`📝 ${esc(e.note)}`);
  if (g) L.push(`🎯 Цель: ${g.emoji} ${esc(g.title)} — ${pctOf(g.saved, g.target)}% (${money(c, g.saved)} из ${money(c, g.target)})`);
  if (w) L.push(`📍 Из списка «Хочу сходить»: ${esc(w.title)}`);
  L.push('', `👤 Добавлено: ${memberName(c, e.created_by)}`);
  await show(c, L.join('\n'), kb(
    [b('✏️ Изменить', `ev:e:${id}`), b('🗑 Удалить', `ev:d:${id}`, 'danger')],
    [g ? b('🎯 Открыть цель', `g:o:${g.id}`) : b('🎯 Привязать цель', `ev:lg:${id}`), g ? b('Отвязать', `ev:ul:${id}`) : null],
    [b('📋 Ближайшие', 'up:0'), b('📅 Календарь', 'nav:cal')],
  ));
}

export async function eventEditMenu(c: Ctx, id: number) {
  const e = await inC(c, (tx) => eventById(tx, id));
  if (!e) return await show(c, '🤷 Событие не найдено.', kb(navRow()));
  const k = KINDS[e.kind];
  await show(c, `✏️ <b>${esc(evTitle(e))}</b>\nЧто изменить?`, kb(
    [b('Название', `ev:ef:${id}:title`), b('Дата', `ev:ef:${id}:date`)],
    [k.time ? b('Время', `ev:ef:${id}:time`) : null, k.place ? b('Место', `ev:ef:${id}:place`) : null],
    [b('Комментарий', `ev:ef:${id}:note`), b('Тип', `ev:ef:${id}:kind`)],
    [b('‹ Назад', `ev:o:${id}`)],
  ));
}

export async function eventEditField(c: Ctx, id: number, field: string) {
  if (!['title', 'date', 'time', 'place', 'note', 'kind'].includes(field)) return;
  const e = await inC(c, (tx) => eventById(tx, id));
  if (!e) return await show(c, '🤷 Событие не найдено.', kb(navRow()));
  await startWizard(c, 'ev', { kind: e.kind, title: e.title, date: e.event_date, time: e.event_time, place: e.place, note: e.note, goal: e.goal_id, wish: e.wish_id }, { only: field, id });
}

export async function finishEvent(c: Ctx, s: WS) {
  const d = s.d;
  const k = KINDS[d.kind] ?? KINDS.important;
  const title = String(d.title ?? '').trim() || k.def || k.n;
  const time = k.time ? d.time ?? null : null;
  const place = k.place ? d.place ?? null : null;
  let id = s.id;
  const ok = await inC(c, async (tx) => {
    if (id) {
      const r = await tx`update p4t.events set kind = ${d.kind}, title = ${title}, event_date = ${d.date}, event_time = ${time},
          place = ${place}, note = ${d.note ?? null}, yearly = ${k.yearly}, updated_at = now()
        where id = ${id} returning id`;
      return r.length > 0;
    }
    if (d.goal && !(await tx`select 1 from p4t.goals where id = ${d.goal}`).length) d.goal = null;
    if (d.wish && !(await tx`select 1 from p4t.wishes where id = ${d.wish}`).length) d.wish = null;
    const [r] = await tx`insert into p4t.events (couple_id, kind, title, event_date, event_time, place, note, yearly, goal_id, wish_id, created_by)
      values (${c.couple!.id}, ${d.kind}, ${title}, ${d.date}, ${time}, ${place}, ${d.note ?? null}, ${k.yearly}, ${d.goal ?? null}, ${d.wish ?? null}, ${c.u.tg_id})
      returning id`;
    id = Number(r.id);
    return true;
  });
  if (!ok || !id) return await show(c, '🤷 Событие не найдено — возможно, его удалили.', kb(navRow()));
  const when = `${fmtDate(d.date, { wd: true, year: true })}${time ? ', ' + time : ''}`;
  const verb = s.id ? 'изменено событие' : (d.kind === 'date' ? 'новое свидание' : 'новое событие');
  await notifyPartner(c, `🔔 <b>${nameOf(c.u)}</b> · ${verb}\n${k.e} <b>${esc(evTitle({ kind: d.kind, title }))}</b>\n📆 ${when}${place ? '\n📍 ' + esc(place) : ''}${d.note ? '\n📝 ' + esc(d.note) : ''}`,
    kb([b('Открыть', `ev:o:${id}`)]));
  await eventCard(c, id, s.id ? '✅ Сохранено. Партнёр получил уведомление.' : '✅ Добавлено! Партнёр получил уведомление.');
}

export async function eventDeleteConfirm(c: Ctx, id: number) {
  const e = await inC(c, (tx) => eventById(tx, id));
  if (!e) return await show(c, '🤷 Событие не найдено.', kb(navRow()));
  await show(c, `🗑 Удалить «${esc(evTitle(e))}»?`, kb([b('Да, удалить', `ev:d!:${id}`, 'danger'), b('Отмена', `ev:o:${id}`)]));
}

export async function eventDelete(c: Ctx, id: number) {
  const r = await inC(c, (tx) => tx`delete from p4t.events where id = ${id} returning kind, title, event_date::text as event_date`);
  if (!r.length) return await show(c, '🤷 Событие уже удалено.', kb(navRow()));
  await notifyPartner(c, `🗑 <b>${nameOf(c.u)}</b> · удалено событие\n${KINDS[r[0].kind].e} ${esc(evTitle(r[0]))} (${fmtDate(r[0].event_date)})`);
  await upcomingList(c, 0);
}

export async function eventLinkMenu(c: Ctx, id: number) {
  const goals = await inC(c, (tx) => goalsWithSaved(tx));
  if (!goals.length) return await show(c, 'Целей пока нет. Создай цель — и её можно будет привязать к событию.', kb([b('🎯 Новая цель', 'add:goal')], [b('‹ Назад', `ev:o:${id}`)]));
  await show(c, '🎯 К какой цели привязать событие?\nНапример: «Накопили на поездку → запланировали поездку».', kb(
    ...goals.map((g) => [b(`${g.emoji} ${cut(g.title, 30)} · ${pctOf(g.saved, g.target)}%`, `ev:lg:${id}:${g.id}`)]),
    [b('‹ Назад', `ev:o:${id}`)],
  ));
}

export async function eventLink(c: Ctx, id: number, gid: number | null) {
  // Составной внешний ключ (goal_id, couple_id) не даст сослаться на цель чужой пары
  try {
    await inC(c, (tx) => tx`update p4t.events set goal_id = ${gid}, updated_at = now() where id = ${id}`);
  } catch (e) {
    console.error(String(e));
    return await show(c, '🤷 Цель не найдена.', kb([b('‹ Назад', `ev:o:${id}`)]));
  }
  await eventCard(c, id, gid ? '🔗 Событие привязано к цели.' : 'Связь с целью убрана.');
}

// ============================== Цели и бюджет ==============================

export async function goalsList(c: Ctx, archived = false) {
  if (!c.couple) return await onboarding(c);
  const goals = await inC(c, (tx) => goalsWithSaved(tx, archived));
  const L = [archived ? '📦 <b>Архив целей</b>' : '🎯 <b>Наши цели</b>', ''];
  if (!goals.length) L.push(archived ? 'В архиве пусто.' : 'Целей пока нет. Машина, отпуск, свадьба — с чего начнём?');
  let total = 0;
  for (const g of goals) {
    const p = pctOf(g.saved, g.target);
    total += g.saved;
    L.push(`${g.emoji} <b>${esc(g.title)}</b> — ${p}%${p >= 100 ? ' 🎉' : ''}`);
    L.push(`${bar(p)}`);
    L.push(`${money(c, g.saved)} из ${money(c, g.target)}${g.deadline ? ' · до ' + fmtShortDate(g.deadline) + ' ' + g.deadline.slice(0, 4) : ''}`, '');
  }
  if (goals.length && !archived) L.push(`💰 Всего накоплено: <b>${money(c, total)}</b>`);
  await show(c, L.join('\n').trim(), kb(
    ...goals.map((g) => [b(`${g.emoji} ${cut(g.title, 28)} · ${pctOf(g.saved, g.target)}%`, `g:o:${g.id}`)]),
    [archived ? null : b('➕ Новая цель', 'add:goal', 'primary'), archived ? b('🎯 Активные', 'gl:0') : b('📦 Архив', 'gl:1')],
    navRow(),
  ));
}

async function goalDetails(c: Ctx, id: number) {
  return await inC(c, async (tx) => {
    const g = await goalById(tx, id);
    if (!g) return null;
    const hist = await tx`select id, user_id, amount, comment, created_at from p4t.contributions where goal_id = ${id} order by created_at desc, id desc limit 5`;
    const evs = (await tx`select id, kind, title, event_date::text as event_date from p4t.events where goal_id = ${id} order by event_date limit 3`) as any[];
    return { g, hist: hist.map((h: any) => ({ ...h, amount: num(h.amount), user_id: Number(h.user_id), id: Number(h.id) })), evs };
  });
}

const shortTs = (d: Date, tz: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'short' }).format(new Date(d)).replace('.', '');

function goalKb(g: Goal): Kb {
  if (g.archived) return kb([b('♻️ Вернуть из архива', `g:a:${g.id}`)], [b('🗑 Удалить', `g:d:${g.id}`, 'danger')], [b('‹ Все цели', 'nav:goals')]);
  return kb(
    [b('➕ Пополнить', `g:t:${g.id}`, 'success'), b('➖ Снять', `g:w:${g.id}`)],
    [b('📜 История', `g:h:${g.id}:0`), b('📅 Запланировать', `g:p:${g.id}`, 'primary')],
    [b('✏️ Изменить', `g:e:${g.id}`), b('📦 В архив', `g:a:${g.id}`)],
    [b('🗑 Удалить', `g:d:${g.id}`, 'danger'), b('‹ Все цели', 'nav:goals')],
  );
}

function goalText(c: Ctx, r: NonNullable<Awaited<ReturnType<typeof goalDetails>>>, notice = '') {
  const { g, hist, evs } = r;
  const p = pctOf(g.saved, g.target);
  const left = Math.max(0, g.target - g.saved);
  const L: string[] = [];
  if (notice) L.push(notice, '');
  L.push(`${g.emoji} <b>${esc(g.title)}</b>${g.archived ? ' · в архиве' : ''}`, `${bar(p)} <b>${p}%</b>`, '');
  L.push(`💰 Накоплено: <b>${money(c, g.saved)}</b> из ${money(c, g.target)}`);
  L.push(left > 0 ? `⏳ Осталось: <b>${money(c, left)}</b>` : '🎉 Цель достигнута!');
  if (g.deadline) {
    const days = daysBetween(c.today, g.deadline);
    const months = Math.max(1, Math.ceil(days / 30.44));
    L.push(`📆 Срок: до ${fmtDate(g.deadline, { year: true })}${left > 0 && days > 0 ? ` · ≈ ${money(c, Math.ceil(left / months))}/мес` : days <= 0 && left > 0 ? ' · срок прошёл' : ''}`);
  }
  for (const e of evs) L.push(`🔗 ${KINDS[e.kind].e} ${esc(evTitle(e))} — ${fmtDate(e.event_date, { year: true })}`);
  if (hist.length) {
    L.push('', '<b>Последние операции</b>');
    for (const h of hist) L.push(`${h.amount > 0 ? '+' : '−'}${money(c, Math.abs(h.amount))} · ${memberName(c, h.user_id)} · ${shortTs(h.created_at, c.couple!.tz)}${h.comment ? ' — «' + esc(h.comment) + '»' : ''}`);
  }
  return L.join('\n');
}

function goalJson(c: Ctx, r: NonNullable<Awaited<ReturnType<typeof goalDetails>>>, extra: Record<string, unknown> = {}) {
  const { g, hist } = r;
  const left = Math.max(0, g.target - g.saved);
  const o: any = {
    i: g.id, t: cut(g.title, 40), e: g.emoji, p: pctOf(g.saved, g.target),
    sv: money(c, g.saved), tg: money(c, g.target), lf: money(c, left), a: left <= 0 ? 1 : 0, ar: g.archived ? 1 : 0,
    dl: g.deadline ? 'до ' + fmtDate(g.deadline, { year: true }) : '',
    q: quickAmounts(g.target).map((x) => [x, fmtMoney(x, cur(c))]),
    h: hist.slice(0, 3).map((h) => [(h.amount > 0 ? '+' : '−') + fmtMoney(Math.abs(h.amount), cur(c)), (c.members.find((x) => x.tg_id === h.user_id)?.first_name ?? '—'), cut(h.comment ?? '', 24), shortTs(h.created_at, c.couple!.tz)]),
    ...extra,
  };
  return fitJson(o, [() => !!o.h.pop()]);
}

/** Открыть цель: живая карточка-виджет (если включено) или текст */
export async function goalCard(c: Ctx, id: number, notice = '', forceText = false) {
  const r = await goalDetails(c, id);
  if (!r) return await show(c, '🤷 Цель не найдена — возможно, её удалили.', kb([b('‹ Все цели', 'nav:goals')]));
  if (c.u.widgets && !forceText) {
    if (c.target) { await del(c.chat, c.target); c.target = undefined; }
    if (notice) await send(c.chat, notice);
    const p = pctOf(r.g.saved, r.g.target);
    return await sendCard(c, `g${id}`, GOAL_HTML, `${r.g.emoji} <b>${esc(r.g.title)}</b> · ${p}% · ${money(c, r.g.saved)} из ${money(c, r.g.target)}`, goalJson(c, r), goalKb(r.g), () => send(c.chat, goalText(c, r), goalKb(r.g)));
  }
  await show(c, goalText(c, r, notice), goalKb(r.g));
}

export async function addGoal(c: Ctx) {
  if (!c.couple) return await onboarding(c);
  await startWizard(c, 'goal');
}

export async function finishGoal(c: Ctx, s: WS) {
  const d = s.d;
  if (s.id) {
    const ok = await inC(c, async (tx) => {
      const r = await tx`update p4t.goals set title = ${d.title}, emoji = ${d.emoji}, target = ${d.target}, deadline = ${d.deadline ?? null}
        where id = ${s.id} returning id`;
      if (r.length) await syncAchieved(tx, s.id!);
      return r.length > 0;
    });
    if (!ok) return await show(c, '🤷 Цель не найдена.', kb(navRow()));
    await notifyPartner(c, `✏️ <b>${nameOf(c.u)}</b> · изменена цель ${d.emoji} <b>${esc(d.title)}</b>\nСумма цели: ${money(c, d.target)}${d.deadline ? ' · до ' + fmtDate(d.deadline, { year: true }) : ''}`, kb([b('Открыть цель', `g:o:${s.id}`)]));
    return await goalCard(c, s.id, '✅ Цель обновлена.', true);
  }
  const id = await inC(c, async (tx) => {
    const [g] = await tx`insert into p4t.goals (couple_id, title, emoji, target, deadline, created_by)
      values (${c.couple!.id}, ${d.title}, ${d.emoji ?? '🎯'}, ${d.target}, ${d.deadline ?? null}, ${c.u.tg_id}) returning id`;
    if (d.start) await tx`insert into p4t.contributions (couple_id, goal_id, user_id, amount, comment) values (${c.couple!.id}, ${g.id}, ${c.u.tg_id}, ${d.start}, 'Стартовая сумма')`;
    await syncAchieved(tx, Number(g.id));
    return Number(g.id);
  });
  await notifyPartner(c, `🎯 <b>${nameOf(c.u)}</b> · новая цель ${d.emoji ?? '🎯'} <b>${esc(d.title)}</b>\nНужно: ${money(c, d.target)}${d.start ? ` · уже есть ${money(c, d.start)}` : ''}${d.deadline ? '\n📆 до ' + fmtDate(d.deadline, { year: true }) : ''}`, kb([b('Открыть цель', `g:o:${id}`)]));
  await goalCard(c, id, '✅ Цель создана! Пополнять можно кнопками под карточкой.');
}

async function syncAchieved(tx: Q, id: number) {
  const [r] = await tx`update p4t.goals g set achieved_at = case
        when coalesce((select sum(amount) from p4t.contributions where goal_id = g.id), 0) >= g.target then coalesce(g.achieved_at, now())
        else null end
      where g.id = ${id}
      returning (achieved_at is not null) as done`;
  return !!r?.done;
}

export async function goalEditMenu(c: Ctx, id: number) {
  const g = await inC(c, (tx) => goalById(tx, id));
  if (!g) return await show(c, '🤷 Цель не найдена.', kb(navRow()));
  await show(c, `✏️ ${g.emoji} <b>${esc(g.title)}</b>\nЧто изменить?`, kb(
    [b('Название', `g:ef:${id}:title`), b('Иконку', `g:ef:${id}:emoji`)],
    [b('Сумму цели', `g:ef:${id}:target`), b('Срок', `g:ef:${id}:deadline`)],
    [b('‹ Назад', `g:o:${id}`)],
  ));
}

export async function goalEditField(c: Ctx, id: number, field: string) {
  if (!['title', 'emoji', 'target', 'deadline'].includes(field)) return;
  const g = await inC(c, (tx) => goalById(tx, id));
  if (!g) return await show(c, '🤷 Цель не найдена.', kb(navRow()));
  await startWizard(c, 'goal', { title: g.title, emoji: g.emoji, target: g.target, deadline: g.deadline }, { only: field, id });
}

export async function topUpStart(c: Ctx, id: number, sign: 1 | -1) {
  const g = await inC(c, (tx) => goalById(tx, id));
  if (!g) return await show(c, '🤷 Цель не найдена.', kb(navRow()));
  if (g.archived) return await show(c, 'Цель в архиве. Сначала верни её из архива.', kb([b('‹ К цели', `g:o:${id}`)]));
  if (sign < 0 && g.saved <= 0) return await show(c, 'В этой цели пока нечего снимать.', kb([b('‹ К цели', `g:o:${id}`)]));
  await startWizard(c, 'top', { gid: id, sign, target: g.target, saved: g.saved, emoji: g.emoji, gtitle: cut(g.title, 30) });
}

/** Запись операции + уведомление партнёру. Возвращает новую сводку */
export async function addContribution(c: Ctx, gid: number, amount: number, comment: string | null) {
  const r = await inC(c, async (tx) => {
    const [g] = await tx`select id, archived from p4t.goals where id = ${gid} for update`;
    if (!g || g.archived) return null;
    const before = await goalById(tx, gid);
    if (amount < 0 && before!.saved + amount < 0) return { err: 'Нельзя снять больше, чем накоплено' } as const;
    const [ins] = await tx`insert into p4t.contributions (couple_id, goal_id, user_id, amount, comment)
      values (${c.couple!.id}, ${gid}, ${c.u.tg_id}, ${amount}, ${comment}) returning id`;
    const wasDone = !!before!.achieved_at;
    const done = await syncAchieved(tx, gid);
    const after = await goalById(tx, gid);
    return { g: after!, cid: Number(ins.id), reached: done && !wasDone } as const;
  });
  if (!r || 'err' in r) return r;
  const { g } = r;
  const p = pctOf(g.saved, g.target), left = Math.max(0, g.target - g.saved);
  const sign = amount > 0 ? '+' : '−';
  await notifyPartner(c, [
    `${amount > 0 ? '💰' : '💸'} <b>${nameOf(c.u)}</b> · ${sign}${money(c, Math.abs(amount))} ${amount > 0 ? '→' : 'из'} ${g.emoji} <b>${esc(g.title)}</b>`,
    comment ? `💬 «${esc(comment)}»` : '',
    `Накоплено ${money(c, g.saved)} из ${money(c, g.target)} (${p}%)${left > 0 ? ` · осталось ${money(c, left)}` : ''}`,
  ].filter(Boolean).join('\n'), kb([b('Открыть цель', `g:o:${gid}`)]));
  if (r.reached) {
    const msg = `🎉 <b>Цель достигнута!</b>\n${g.emoji} ${esc(g.title)} — накоплено ${money(c, g.saved)}.\n\nПора планировать? Создайте событие, и оно будет связано с этой целью.`;
    const k = kb([b('📅 Запланировать', `g:p:${gid}`, 'success')]);
    await notifyPartner(c, msg, k);
    await send(c.chat, msg, k);
  }
  return r;
}

export async function finishTopUp(c: Ctx, s: WS) {
  const d = s.d;
  const amount = Number(d.amount) * (d.sign > 0 ? 1 : -1);
  const r = await addContribution(c, d.gid, amount, d.comment ?? null);
  if (!r) return await show(c, '🤷 Цель не найдена или в архиве.', kb(navRow()));
  if ('err' in r) return await show(c, `⚠️ ${r.err}`, kb([b('‹ К цели', `g:o:${d.gid}`)]));
  await goalCard(c, d.gid, `✅ ${amount > 0 ? '+' : '−'}${money(c, Math.abs(amount))} записано. Партнёр получил уведомление.`);
}

export async function goalHistory(c: Ctx, id: number, page: number) {
  const per = 10;
  const r = await inC(c, async (tx) => {
    const g = await goalById(tx, id);
    if (!g) return null;
    const [{ n, plus, minus }] = await tx`select count(*)::int as n, coalesce(sum(amount) filter (where amount > 0), 0) as plus,
        coalesce(sum(amount) filter (where amount < 0), 0) as minus from p4t.contributions where goal_id = ${id}`;
    const rows = await tx`select user_id, amount, comment, created_at from p4t.contributions where goal_id = ${id}
      order by created_at desc, id desc limit ${per} offset ${page * per}`;
    return { g, n: n as number, plus: num(plus), minus: num(minus), rows };
  });
  if (!r) return await show(c, '🤷 Цель не найдена.', kb(navRow()));
  const pages = Math.max(1, Math.ceil(r.n / per));
  const L = [`📜 <b>История: ${r.g.emoji} ${esc(r.g.title)}</b>`, `Операций: ${r.n} · пополнено ${money(c, r.plus)} · снято ${money(c, Math.abs(r.minus))}`, ''];
  if (!r.rows.length) L.push('Пока ни одной операции.');
  for (const h of r.rows) {
    const a = num(h.amount);
    L.push(`${shortTs(h.created_at, c.couple!.tz)} · <b>${a > 0 ? '+' : '−'}${money(c, Math.abs(a))}</b> · ${memberName(c, Number(h.user_id))}${h.comment ? '\n      «' + esc(h.comment) + '»' : ''}`);
  }
  await show(c, L.join('\n'), kb(
    [page > 0 ? b('‹', `g:h:${id}:${page - 1}`) : null, pages > 1 ? b(`${page + 1}/${pages}`, 'noop') : null, page < pages - 1 ? b('›', `g:h:${id}:${page + 1}`) : null],
    [b('➕ Пополнить', `g:t:${id}`, 'success'), b('‹ К цели', `g:o:${id}`)],
  ));
}

export async function goalArchive(c: Ctx, id: number) {
  const r = await inC(c, (tx) => tx`update p4t.goals set archived = not archived where id = ${id} returning archived`);
  if (!r.length) return await show(c, '🤷 Цель не найдена.', kb(navRow()));
  await goalCard(c, id, r[0].archived ? '📦 Цель перенесена в архив.' : '♻️ Цель снова активна.', true);
}

export async function goalDeleteConfirm(c: Ctx, id: number) {
  const g = await inC(c, (tx) => goalById(tx, id));
  if (!g) return await show(c, '🤷 Цель не найдена.', kb(navRow()));
  await show(c, `🗑 Удалить цель ${g.emoji} «${esc(g.title)}» вместе со всей историей пополнений?\n\nЕсли цель просто достигнута — лучше отправить её в архив.`, kb(
    [b('Да, удалить', `g:d!:${id}`, 'danger'), b('📦 В архив', `g:a:${id}`)], [b('Отмена', `g:o:${id}`)],
  ));
}

export async function goalDelete(c: Ctx, id: number) {
  const r = await inC(c, (tx) => tx`delete from p4t.goals where id = ${id} returning emoji, title`);
  if (!r.length) return await show(c, '🤷 Цель уже удалена.', kb(navRow()));
  await notifyPartner(c, `🗑 <b>${nameOf(c.u)}</b> · удалена цель ${r[0].emoji} ${esc(r[0].title)}`);
  await goalsList(c);
}

export async function goalPlan(c: Ctx, id: number) {
  const g = await inC(c, (tx) => goalById(tx, id));
  if (!g) return await show(c, '🤷 Цель не найдена.', kb(navRow()));
  const kind = g.emoji === '✈️' ? 'trip' : g.emoji === '💍' ? 'important' : null;
  await startWizard(c, 'ev', { title: g.title, goal: id, ...(kind ? { kind } : {}) }, { skip: kind ? ['kind', 'title'] : ['title'] });
}

// ============================== Хочу сходить ==============================

export async function wishList(c: Ctx, cat = 'all', page = 0, done = false) {
  if (!c.couple) return await onboarding(c);
  const rows = await inC(c, (tx) => tx`
    select w.id, w.category, w.title, w.done_at,
      (select min(e.event_date)::text from p4t.events e where e.wish_id = w.id and e.event_date >= ${c.today}) as planned
    from p4t.wishes w where (w.done_at is not null) = ${done} order by w.created_at desc limit 500`);
  const cats = [...new Set(rows.map((r: any) => r.category))] as string[];
  const list = rows.filter((r: any) => cat === 'all' || r.category === cat);
  const per = 8, pages = Math.max(1, Math.ceil(list.length / per));
  page = Math.min(Math.max(0, page), pages - 1);
  const slice = list.slice(page * per, page * per + per);
  const L = [done ? '✅ <b>Где мы уже были</b>' : `📍 <b>Хочу сходить</b> · ${rows.length}`];
  if (cat !== 'all' && CATS[cat]) L.push(`Фильтр: ${CATS[cat].join(' ')}`);
  L.push('');
  if (!slice.length) L.push(done ? 'Пока пусто.' : 'Список пуст. Добавь ресторан, выставку или место для прогулки — без даты, просто чтобы не забыть.');
  for (const w of slice) L.push(`${CATS[w.category]?.[0] ?? '✨'} ${esc(w.title)}${w.planned ? ` · 📅 ${fmtShortDate(w.planned)}` : ''}`);
  const p = done ? 'wd' : 'wl';
  const rowsKb: Btn[][] = slice.map((w: any) => [b(`${CATS[w.category]?.[0] ?? '✨'} ${cut(w.title, 34)}${w.planned ? ' 📅' : ''}`, `wi:o:${w.id}`)]);
  if (cats.length > 1 && !done) {
    const f = [b(cat === 'all' ? '• Все' : 'Все', `${p}:all:0`), ...cats.slice(0, 6).map((k) => b((cat === k ? '• ' : '') + CATS[k][0], `${p}:${k}:0`))];
    rowsKb.push(f.slice(0, 4), f.slice(4));
  }
  rowsKb.push([page > 0 ? b('‹', `${p}:${cat}:${page - 1}`) : null, pages > 1 ? b(`${page + 1}/${pages}`, 'noop') : null, page < pages - 1 ? b('›', `${p}:${cat}:${page + 1}`) : null].filter(Boolean) as Btn[]);
  if (!done) rowsKb.push([b('➕ Добавить', 'add:wish', 'primary'), rows.length ? b('🎲 Куда сходим?', 'wi:rnd') : null].filter(Boolean) as Btn[]);
  rowsKb.push([done ? b('📍 Хочу сходить', 'wl:all:0') : b('✅ Где уже были', 'wd:all:0'), b('🏠 Главная', 'nav:home')]);
  await show(c, L.join('\n'), kb(...rowsKb));
}

export async function addWish(c: Ctx) {
  if (!c.couple) return await onboarding(c);
  await startWizard(c, 'wish');
}

export async function finishWish(c: Ctx, s: WS) {
  const d = s.d;
  if (s.id) {
    const r = await inC(c, (tx) => tx`update p4t.wishes set category = ${d.cat}, title = ${d.title}, note = ${d.note ?? null} where id = ${s.id} returning id`);
    if (!r.length) return await show(c, '🤷 Запись не найдена.', kb(navRow()));
    return await wishCard(c, s.id, '✅ Сохранено.');
  }
  const id = await inC(c, async (tx) => {
    const [r] = await tx`insert into p4t.wishes (couple_id, category, title, note, created_by)
      values (${c.couple!.id}, ${d.cat}, ${d.title}, ${d.note ?? null}, ${c.u.tg_id}) returning id`;
    return Number(r.id);
  });
  await notifyPartner(c, `📍 <b>${nameOf(c.u)}</b> · хочет сходить\n${CATS[d.cat][0]} <b>${esc(d.title)}</b>${d.note ? '\n📝 ' + esc(d.note) : ''}`, kb([b('Открыть', `wi:o:${id}`), b('📅 Запланировать', `wi:p:${id}`)]));
  await wishCard(c, id, '✅ Добавлено в «Хочу сходить». Партнёр получил уведомление.');
}

export async function wishCard(c: Ctx, id: number, notice = '', random = false) {
  const r = await inC(c, async (tx) => {
    const [w] = await tx`select id, category, title, note, done_at, created_by, created_at from p4t.wishes where id = ${id}`;
    if (!w) return null;
    const evs = await tx`select id, event_date::text as event_date, to_char(event_time, 'HH24:MI') as t from p4t.events where wish_id = ${id} order by event_date desc limit 3`;
    return { w, evs };
  });
  if (!r) return await show(c, '🤷 Запись не найдена — возможно, её удалили.', kb([b('‹ Список', 'wl:all:0')]));
  const { w, evs } = r;
  const L: string[] = [];
  if (notice) L.push(notice, '');
  L.push(`${CATS[w.category]?.[0] ?? '✨'} <b>${esc(w.title)}</b>`, `<i>${CATS[w.category]?.[1] ?? ''}</i>`);
  if (w.note) L.push('', `📝 ${esc(w.note)}`);
  const future = evs.find((e: any) => e.event_date >= c.today);
  if (future) L.push('', `📅 Запланировано: ${fmtDate(future.event_date, { wd: true })}${future.t ? ' · ' + future.t : ''}`);
  if (w.done_at) L.push('', `✅ Были: ${shortTs(w.done_at, c.couple!.tz)}`);
  L.push('', `👤 Добавлено: ${memberName(c, Number(w.created_by))} · ${shortTs(w.created_at, c.couple!.tz)}`);
  await show(c, L.join('\n'), kb(
    w.done_at ? [b('↩️ Вернуть в список', `wi:u:${id}`)] : [b('📅 Запланировать', `wi:p:${id}`, 'primary'), b('✅ Сходили', `wi:x:${id}`, 'success')],
    future ? [b('Открыть событие', `ev:o:${future.id}`)] : [],
    [b('✏️ Изменить', `wi:e:${id}`), b('🗑 Удалить', `wi:d:${id}`, 'danger')],
    [random ? b('🎲 Ещё вариант', 'wi:rnd') : null, b('‹ Список', 'wl:all:0')],
  ));
}

export async function wishRandom(c: Ctx) {
  const [w] = await inC(c, (tx) => tx`select id from p4t.wishes where done_at is null order by random() limit 1`);
  if (!w) return await show(c, 'Список пуст — добавь пару мест 🙂', kb([b('➕ Добавить', 'add:wish')], navRow()));
  await wishCard(c, Number(w.id), '🎲 Как насчёт этого?', true);
}

export async function wishDone(c: Ctx, id: number, done: boolean) {
  const r = await inC(c, (tx) => tx`update p4t.wishes set done_at = ${done ? new Date() : null} where id = ${id} returning title, category`);
  if (!r.length) return await show(c, '🤷 Запись не найдена.', kb(navRow()));
  if (done) await notifyPartner(c, `✅ <b>${nameOf(c.u)}</b> · отмечено «сходили»: ${CATS[r[0].category]?.[0] ?? ''} ${esc(r[0].title)}`);
  await wishCard(c, id, done ? '✅ Отмечено! Запись перенесена в «Где уже были».' : '↩️ Запись снова в списке «Хочу сходить».');
}

export async function wishPlan(c: Ctx, id: number) {
  const [w] = await inC(c, (tx) => tx`select id, title, category from p4t.wishes where id = ${id}`);
  if (!w) return await show(c, '🤷 Запись не найдена.', kb(navRow()));
  const kind = w.category === 'trip' ? 'trip' : 'date';
  await startWizard(c, 'ev', { kind, title: w.title, place: w.title, wish: id }, { skip: ['kind', 'title', 'place'] });
}

export async function wishEditMenu(c: Ctx, id: number) {
  const [w] = await inC(c, (tx) => tx`select id, title from p4t.wishes where id = ${id}`);
  if (!w) return await show(c, '🤷 Запись не найдена.', kb(navRow()));
  await show(c, `✏️ <b>${esc(w.title)}</b>\nЧто изменить?`, kb(
    [b('Название', `wi:ef:${id}:title`), b('Заметку', `wi:ef:${id}:note`), b('Категорию', `wi:ef:${id}:cat`)],
    [b('‹ Назад', `wi:o:${id}`)],
  ));
}

export async function wishEditField(c: Ctx, id: number, field: string) {
  if (!['title', 'note', 'cat'].includes(field)) return;
  const [w] = await inC(c, (tx) => tx`select category, title, note from p4t.wishes where id = ${id}`);
  if (!w) return await show(c, '🤷 Запись не найдена.', kb(navRow()));
  await startWizard(c, 'wish', { cat: w.category, title: w.title, note: w.note }, { only: field, id });
}

export async function wishDeleteConfirm(c: Ctx, id: number) {
  const [w] = await inC(c, (tx) => tx`select title from p4t.wishes where id = ${id}`);
  if (!w) return await show(c, '🤷 Запись не найдена.', kb(navRow()));
  await show(c, `🗑 Удалить «${esc(w.title)}» из списка?`, kb([b('Да, удалить', `wi:d!:${id}`, 'danger'), b('Отмена', `wi:o:${id}`)]));
}

export async function wishDelete(c: Ctx, id: number) {
  await inC(c, (tx) => tx`delete from p4t.wishes where id = ${id}`);
  await wishList(c);
}

// ============================== Настройки ==============================

export async function settings(c: Ctx, notice = '') {
  const L: string[] = [];
  if (notice) L.push(notice, '');
  L.push('⚙️ <b>Настройки</b>', '');
  if (c.couple) {
    const tz = TZS.find(([z]) => z === c.couple!.tz)?.[1] ?? c.couple.tz;
    const ln = localNow(c.couple.tz);
    const days = [...c.couple.remind_days].sort((a, b) => b - a).map((d) => d === 0 ? 'в день события' : `за ${d} ${plural(d, 'день', 'дня', 'дней')}`).join(', ') || 'выключены';
    L.push(`👫 Пара: <b>${pairTitle(c)}</b>`);
    L.push(`🌍 Часовой пояс: <b>${esc(tz)}</b> (сейчас ${String(ln.hour).padStart(2, '0')}:${String(ln.minute).padStart(2, '0')})`);
    L.push(`💱 Валюта: <b>${esc(c.couple.currency)}</b>`);
    L.push(`⏰ Напоминания: <b>в ${String(c.couple.remind_hour).padStart(2, '0')}:00</b> · ${days}`);
    L.push('   + за 2 часа до событий со временем');
  }
  L.push(`🙋 Твоё имя: <b>${nameOf(c.u)}</b>${c.u.display_name ? '' : ' <i>(из Telegram)</i>'}`);
  L.push(`✨ Интерактивные карточки: <b>${c.u.widgets ? 'вкл' : 'выкл'}</b>`);
  L.push(`🔔 Уведомления от партнёра: <b>${c.u.quiet ? 'без звука' : 'со звуком'}</b>`);
  L.push(`📣 Новости бота: <b>${c.u.news ? 'присылать' : 'не присылать'}</b>`);
  L.push('', '<i>Часовой пояс, валюта и напоминания — общие для пары. Имя, карточки и звук — только для тебя.</i>');
  await show(c, L.join('\n'), kb(
    c.couple ? [b('🌍 Часовой пояс', 's:tz'), b('💱 Валюта', 's:cur')] : [],
    c.couple ? [b('⏰ Время', 's:hr'), b('📆 За сколько дней', 's:dd')] : [],
    [b('✏️ Моё имя', 's:nm')],
    [b(`✨ Карточки: ${c.u.widgets ? 'вкл' : 'выкл'}`, 's:wd'), b(`🔔 Звук: ${c.u.quiet ? 'выкл' : 'вкл'}`, 's:q')],
    [b(`📣 Новости: ${c.u.news ? 'вкл' : 'выкл'}`, 's:nw'), b('💬 Поддержка', 'nav:support')],
    c.couple && !partner(c) ? [b('💌 Пригласить партнёра', 'pair:new', 'success')] : [],
    c.couple ? [b('🚪 Выйти из пары', 'pair:leave', 'danger')] : [b('💌 Создать пару', 'pair:new', 'primary')],
    navRow(),
  ));
}

export async function settingsAction(c: Ctx, act: string, arg?: string) {
  const sql = db();
  if (act === 'wd') {
    c.u.widgets = !c.u.widgets;
    await sql`update p4t.users set widgets = ${c.u.widgets} where tg_id = ${c.u.tg_id}`;
    return await settings(c, c.u.widgets ? '✨ Карточки-виджеты включены.' : 'Карточки выключены — бот будет присылать обычные сообщения.');
  }
  if (act === 'nw') {
    await setNews(c, !c.u.news);
    return await settings(c, c.u.news ? '📣 Новости бота включены.' : '🔕 Новости бота выключены. Напоминания и уведомления от партнёра продолжат приходить.');
  }
  if (act === 'nm') {
    if (arg === 'tg') return await saveName(c, null);
    return await startWizard(c, 'name');
  }
  if (act === 'q') {
    c.u.quiet = !c.u.quiet;
    await sql`update p4t.users set quiet = ${c.u.quiet} where tg_id = ${c.u.tg_id}`;
    return await settings(c);
  }
  if (!c.couple) return await onboarding(c);
  const cp = c.couple;
  if (act === 'tz') {
    if (arg !== undefined && TZS[Number(arg)]) {
      cp.tz = TZS[Number(arg)][0];
      await inC(c, (tx) => tx`update p4t.couples set tz = ${cp.tz} where id = ${cp.id}`);
      return await settings(c, '✅ Часовой пояс сохранён.');
    }
    return await show(c, '🌍 Выбери часовой пояс пары — по нему приходят напоминания:', kb(
      ...Array.from({ length: Math.ceil(TZS.length / 2) }, (_, i) => TZS.slice(i * 2, i * 2 + 2).map(([z, n], j) => b((z === cp.tz ? '• ' : '') + n, `s:tz:${i * 2 + j}`))),
      [b('‹ Назад', 'nav:set')],
    ));
  }
  if (act === 'cur') {
    if (arg !== undefined && CURRENCIES[Number(arg)]) {
      cp.currency = CURRENCIES[Number(arg)];
      await inC(c, (tx) => tx`update p4t.couples set currency = ${cp.currency} where id = ${cp.id}`);
      return await settings(c, '✅ Валюта сохранена. Суммы не пересчитываются — меняется только знак.');
    }
    return await show(c, '💱 Валюта для целей:', kb(CURRENCIES.slice(0, 4).map((x, i) => b((x === cp.currency ? '• ' : '') + x, `s:cur:${i}`)),
      CURRENCIES.slice(4).map((x, i) => b((x === cp.currency ? '• ' : '') + x, `s:cur:${i + 4}`)), [b('‹ Назад', 'nav:set')]));
  }
  if (act === 'hr') {
    const hours = [8, 9, 10, 12, 18, 20, 21];
    if (arg !== undefined && hours.includes(Number(arg))) {
      cp.remind_hour = Number(arg);
      await inC(c, (tx) => tx`update p4t.couples set remind_hour = ${cp.remind_hour} where id = ${cp.id}`);
      return await settings(c, '✅ Время напоминаний сохранено.');
    }
    return await show(c, '⏰ Во сколько присылать напоминания?', kb(hours.slice(0, 4).map((h) => b((h === cp.remind_hour ? '• ' : '') + `${String(h).padStart(2, '0')}:00`, `s:hr:${h}`)),
      hours.slice(4).map((h) => b((h === cp.remind_hour ? '• ' : '') + `${h}:00`, `s:hr:${h}`)), [b('‹ Назад', 'nav:set')]));
  }
  if (act === 'dd') {
    const opts = [14, 7, 3, 1, 0];
    if (arg !== undefined && opts.includes(Number(arg))) {
      const v = Number(arg);
      const set = new Set(cp.remind_days);
      set.has(v) ? set.delete(v) : set.add(v);
      cp.remind_days = [...set].sort((a, b) => b - a);
      await inC(c, (tx) => tx`update p4t.couples set remind_days = ${'{' + cp.remind_days.join(',') + '}'}::smallint[] where id = ${cp.id}`);
    }
    return await show(c, '📆 За сколько дней напоминать о событиях? Можно выбрать несколько.', kb(
      opts.slice(0, 3).map((d) => b(`${cp.remind_days.includes(d) ? '✅' : '▫️'} за ${d} дн.`, `s:dd:${d}`)),
      [b(`${cp.remind_days.includes(1) ? '✅' : '▫️'} за 1 день`, 's:dd:1'), b(`${cp.remind_days.includes(0) ? '✅' : '▫️'} в день события`, 's:dd:0')],
      [b('Готово', 'nav:set', 'primary')],
    ));
  }
  await settings(c);
}

// ============================== Справка ==============================

export const HELP = [
  '💞 <b>Планы на двоих</b> — общий органайзер для пары.',
  '',
  '<b>Начало</b>',
  '/start — запуск бота и главное меню',
  '/addpart — пригласить партнёра (создаёт пару и одноразовый код)',
  '/join — присоединиться к паре по коду',
  '/home — главная карточка пары',
  '',
  '<b>📅 Календарь</b>',
  '/calendar — календарь событий',
  '/adddate — добавить свидание, день рождения, годовщину, начало отношений, поездку или важную дату',
  '/upcoming — список ближайших событий',
  '',
  '<b>🎯 Цели и бюджет</b>',
  '/goals — цели и прогресс накоплений',
  '/addgoal — новая цель: машина, отпуск, свадьба…',
  'Пополнение и снятие — в карточке цели, с комментарием («Отложил с зарплаты», «Возврат за билеты»). Вся история операций сохраняется. Это справочный учёт, не банковский счёт.',
  '',
  '<b>📍 Хочу сходить</b>',
  '/wishlist — места и идеи без даты',
  '/addwish — добавить ресторан, выставку, прогулку…',
  '«🎲 Куда сходим?» — случайный выбор из списка.',
  '',
  '<b>🔗 Связи</b>',
  'Цель → событие: «Накопили на поездку → запланировали поездку». Кнопка «📅 Запланировать» есть в цели и в записи «Хочу сходить». Когда цель достигнута, бот сам предложит запланировать.',
  '',
  '<b>🔔 Уведомления</b>',
  'Партнёру приходит сообщение, когда ты добавляешь или меняешь событие, создаёшь цель, пополняешь копилку (кто, сколько, куда и сколько осталось), добавляешь место в список.',
  'Напоминания о датах — обоим: за 7 дней, за день и в день события (настраивается), а также за 2 часа до событий со временем.',
  '',
  '<b>⚙️ Прочее</b>',
  '/settings — часовой пояс, валюта, напоминания, карточки, выход из пары',
  '/name — изменить своё имя (как тебя видит партнёр)',
  '/support — написать в поддержку',
  '/cancel — отменить текущий ввод',
  '/help — эта справка',
  '',
  '✨ <b>Интерактивные карточки.</b> Главная, календарь и цели приходят живыми виджетами прямо в чате: календарь листается, по дню видно события, цель пополняется в одно касание. Если вместо карточки видно «неподдерживаемое сообщение» — обнови Telegram или выключи карточки в /settings.',
  '',
  '🔒 <b>Приватность.</b> Данные пары видны только вам двоим. Вход — только по одноразовому коду, который действует 48 часов. В паре не больше двух человек.',

  '',
  `💬 <b>Поддержка.</b> Вопрос, идея или нашёл ошибку — пиши @${SUPPORT_BOT}, ответим лично.`,
].join('\n');

export async function help(c: Ctx) {
  await show(c, HELP, kb(
    [u('💬 Написать в поддержку', SUPPORT_URL)],
    c.couple ? navRow() : [b('💌 Создать пару', 'pair:new', 'primary'), b('🔑 Ввести код', 'pair:code')],
  ));
}

/** Сохранить своё имя (null — вернуть имя из Telegram) и сообщить партнёру */
export async function saveName(c: Ctx, name: string | null) {
  const before = nameOf(c.u);
  await db()`update p4t.users set display_name = ${name}, updated_at = now() where tg_id = ${c.u.tg_id}`;
  c.u.display_name = name;
  c.u.first_name = name || c.u.tg_name;
  const m = c.members.find((x) => x.tg_id === c.u.tg_id);
  if (m) Object.assign(m, { display_name: c.u.display_name, first_name: c.u.first_name });
  const after = nameOf(c.u);
  if (after !== before) await notifyPartner(c, `✏️ <b>${before}</b> сменил(а) имя в боте — теперь <b>${after}</b>`);
  return await settings(c, name ? `✅ Готово, теперь ты — <b>${after}</b>. Так тебя видит партнёр в уведомлениях и карточках.` : `✅ Вернул имя из Telegram: <b>${after}</b>.`);
}

export async function finishName(c: Ctx, s: WS) {
  const raw = String(s.d.name ?? '');
  if (raw === c.u.tg_name) return await saveName(c, null);
  const v = cleanName(raw);
  return await saveName(c, v === c.u.tg_name ? null : v);
}

export async function setNews(c: Ctx, on: boolean) {
  c.u.news = on;
  await db()`update p4t.users set news = ${on} where tg_id = ${c.u.tg_id}`;
}

export async function support(c: Ctx) {
  await show(c, [
    '💬 <b>Поддержка</b>',
    '',
    `Есть вопрос, идея или что-то сломалось? Напиши в бот поддержки @${SUPPORT_BOT} — сообщение прочитает живой человек и ответит там же.`,
    '',
    'Чтобы помочь быстрее, опиши:',
    '• что делал(а) и что ожидал(а) увидеть;',
    '• что получилось на самом деле (можно скриншот);',
    '• примерное время, когда это произошло.',
    '',
    '<i>Не присылай коды приглашения и личные данные партнёра — они не нужны для решения проблемы.</i>',
  ].join('\n'), kb([u('✍️ Написать в поддержку', SUPPORT_URL)], c.couple ? navRow() : [b('‹ Назад', 'nav:help')]));
}

// ============================== Запросы от виджетов ==============================

const J = (o: unknown) => JSON.stringify(o);

/** Возвращает ответ виджету (≤1024 байт) и, при необходимости, действие после ответа */
export async function widgetQuery(c: Ctx, data: string): Promise<{ answer: string; after?: () => Promise<unknown> }> {
  if (!c.couple) return { answer: J({ err: 'Ты больше не в паре. Нажми /start' }) };
  let m: RegExpExecArray | null;
  if (data === 'h') return { answer: homeWidgetJson(c, await homeData(c)) };
  if ((m = /^o:([cgw])$/.exec(data))) {
    return { answer: '{}', after: () => m![1] === 'c' ? calendar(c) : m![1] === 'g' ? goalsList(c) : wishList(c) };
  }
  if ((m = /^e:(\d{1,12})$/.exec(data))) return { answer: '{}', after: () => eventCard(c, Number(m![1])) };
  if ((m = /^g:(\d{1,12})$/.exec(data))) return { answer: '{}', after: () => goalCard(c, Number(m![1])) };
  if ((m = /^m:(\d{4})-(\d{2})$/.exec(data))) {
    const y = Number(m[1]), mo = Number(m[2]);
    if (mo < 1 || mo > 12 || y < 1900 || y > 2200) return { answer: J({ err: 'Неверный месяц' }) };
    return { answer: await calJson(c, y, mo) };
  }
  if ((m = /^d:(\d{4}-\d{2}-\d{2})$/.exec(data))) return { answer: await dayJson(c, m[1]) };
  if ((m = /^r:(\d{1,12})$/.exec(data))) {
    const r = await goalDetails(c, Number(m[1]));
    return { answer: r ? goalJson(c, r) : J({ err: 'Цель не найдена' }) };
  }
  if ((m = /^t:(\d{1,12}):(\d{1,12})$/.exec(data))) {
    const gid = Number(m[1]), amount = Number(m[2]);
    const g = await inC(c, (tx) => goalById(tx, gid));
    if (!g) return { answer: J({ err: 'Цель не найдена' }) };
    if (!quickAmounts(g.target).includes(amount)) return { answer: J({ err: 'Неверная сумма' }) };
    const r = await addContribution(c, gid, amount, 'Быстрое пополнение');
    if (!r || 'err' in r) return { answer: J({ err: r && 'err' in r ? r.err : 'Цель недоступна' }) };
    const d = await goalDetails(c, gid);
    return { answer: goalJson(c, d!, { ok: `+${money(c, amount)} записано`, u: r.cid }) };
  }
  if ((m = /^x:(\d{1,12})$/.exec(data))) {
    const cid = Number(m[1]);
    const [rm] = await inC(c, (tx) => tx`delete from p4t.contributions where id = ${cid} and user_id = ${c.u.tg_id}
      and created_at > now() - interval '10 minutes' returning goal_id, amount`);
    if (!rm) return { answer: J({ err: 'Отменить можно только своё пополнение в течение 10 минут' }) };
    const gid = Number(rm.goal_id);
    await inC(c, (tx) => syncAchieved(tx, gid));
    const d = await goalDetails(c, gid);
    await notifyPartner(c, `↩️ <b>${nameOf(c.u)}</b> · отменена операция ${num(rm.amount) > 0 ? '+' : '−'}${money(c, Math.abs(num(rm.amount)))} в ${d!.g.emoji} ${esc(d!.g.title)}`);
    return { answer: goalJson(c, d!) };
  }
  if ((m = /^c:(\d{1,12})$/.exec(data))) return { answer: '{}', after: () => topUpStart(c, Number(m![1]), 1) };
  if ((m = /^l:(\d{1,12})$/.exec(data))) return { answer: '{}', after: () => goalHistory(c, Number(m![1]), 0) };
  return { answer: J({ err: 'Неизвестный запрос' }) };
}

export { answerWidget, saveState };

export async function finishJoin(c: Ctx, s: WS) {
  await joinPreview(c, String(s.d.code ?? ''));
}
