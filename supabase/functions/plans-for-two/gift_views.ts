// Желания и подарки. Желание видит вся пара, менять — только владелец.
// Отметки дарителя («выбрал», «купил») лежат в p4t.gift_plans: RLS отдаёт их только самому дарителю,
// поэтому владелец не увидит их ни в тексте, ни в виджете, даже если в коде ошибка в фильтре.
import { Ctx, inC, memberName, nameOf, notifyPartner, partner, PRIO, sendFailed, show, WS } from './core.ts';
import { db, num, Q } from './db.ts';
import { b, Btn, del, kb, send, u } from './tg.ts';
import { cut, daysBetween, esc, fitJson, fmtMoney, fmtShort, nextOccurrence, plural, untilText } from './util.ts';
import { GIFT_HTML } from './widgets.ts';
import { startWizard } from './wizard.ts';
import { onboarding } from './pair_views.ts';
import { sendCard } from './views.ts';

type Gift = {
  id: number; owner_id: number; title: string; price: number | null; priority: number; url: string | null; note: string | null;
  received_at: Date | null; given_by: number | null; created_at: Date;
  /** отметка текущего пользователя (только на чужих желаниях) */
  st: 'picked' | 'bought' | null;
};
type W = 'm' | 'p';
const ST_NAME = { picked: '🤫 выбрано', bought: '🛍 куплено' } as const;
const PER = 8;
const pe = (g: { priority: number }) => PRIO[g.priority]?.[0] ?? '🙂';
const shortTs = (d: Date, tz: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'short' }).format(new Date(d)).replace('.', '');
const notFound = (c: Ctx) => show(c, '🤷 Желание не найдено — возможно, его удалили.', kb([b('🎁 Подарки', 'gf:l:m:0'), b('🏠 Главная', 'nav:home')]));

function mapGift(c: Ctx, r: any): Gift {
  const owner = Number(r.owner_id);
  return {
    ...r, id: Number(r.id), owner_id: owner, price: r.price == null ? null : num(r.price), priority: Number(r.priority),
    given_by: r.given_by ? Number(r.given_by) : null,
    // Двойная защита: даже если RLS вернёт отметку на своём желании, не показываем её
    st: owner === c.u.tg_id ? null : (r.st ?? null),
  };
}

async function giftsOf(c: Ctx, tx: Q, owner: number, received: boolean, limit: number, offset = 0): Promise<Gift[]> {
  const rows = await tx`
    select g.id, g.owner_id, g.title, g.price, g.priority, g.url, g.note, g.received_at, g.given_by, g.created_at, p.status as st
    from p4t.gifts g left join p4t.gift_plans p on p.gift_id = g.id
    where g.owner_id = ${owner} and (g.received_at is not null) = ${received}
    order by case when ${received} then g.received_at end desc nulls last, g.priority, g.created_at desc, g.id desc
    limit ${limit} offset ${offset}`;
  return rows.map((r: any) => mapGift(c, r));
}

async function counts(tx: Q, owner: number) {
  const [r] = await tx`
    select count(*) filter (where g.received_at is null)::int as n,
           count(*) filter (where g.received_at is not null)::int as got,
           count(p.gift_id) filter (where g.received_at is null and p.status = 'picked')::int as picked,
           count(p.gift_id) filter (where g.received_at is null and p.status = 'bought')::int as bought
    from p4t.gifts g left join p4t.gift_plans p on p.gift_id = g.id where g.owner_id = ${owner}`;
  return { n: Number(r.n), got: Number(r.got), picked: Number(r.picked), bought: Number(r.bought) };
}

/** Ближайший день рождения владельца списка (если в календаре указано, чей он) */
async function birthday(c: Ctx, tx: Q, owner: number): Promise<number | null> {
  const rows = await tx`select event_date::text as d from p4t.events where kind = 'birthday' and person_id = ${owner}`;
  let best: number | null = null;
  for (const r of rows) {
    const days = daysBetween(c.today, nextOccurrence(r.d, true, c.today).date);
    if (days >= 0 && (best === null || days < best)) best = days;
  }
  return best;
}

const occText = (c: Ctx, w: W, days: number | null) => days === null ? '' : w === 'm'
  ? `🎂 Твой день рождения ${untilText(days)}`
  : `🎂 День рождения: ${partner(c)?.first_name ?? ''} — ${untilText(days)}`;

const planText = (k: { picked: number; bought: number }) => k.picked + k.bought
  ? `ты выбрал(а) ${k.picked + k.bought}${k.bought ? `, купил(а) ${k.bought}` : ''}` : 'ты пока ничего не выбрал(а)';

const priceText = (c: Ctx, g: Gift) => g.price ? fmtMoney(g.price, c.couple!.currency) : '';

// ============================== Вход в раздел ==============================

export async function giftsHome(c: Ctx) {
  if (!c.couple) return await onboarding(c);
  if (c.u.widgets) {
    if (c.target) { await del(c.chat, c.target); c.target = undefined; }
    const k = kb([b('📋 Списком', 'gf:l:m:0'), b('➕ Желание', 'add:gift', 'primary')]);
    const cap = partner(c)
      ? `🎁 <b>Желания и подарки</b> · отметки «выбрал/купил» видишь только ты`
      : '🎁 <b>Желания и подарки</b> · пригласи партнёра, чтобы он(а) увидел(а) твой список';
    return await sendCard(c, 'gift', GIFT_HTML, cap, await giftJson(c), k, () => giftList(c, 'm', 0));
  }
  await giftList(c, 'm', 0);
}

export async function giftList(c: Ctx, w: W, page = 0, received = false) {
  if (!c.couple) return await onboarding(c);
  const p = partner(c);
  if (w === 'p' && !p) w = 'm';
  const owner = w === 'm' ? c.u.tg_id : p!.tg_id;
  const r = await inC(c, async (tx) => {
    const k = await counts(tx, owner);
    const total = received ? k.got : k.n;
    const pages = Math.max(1, Math.ceil(total / PER));
    page = Math.min(Math.max(0, Math.floor(page) || 0), pages - 1);
    return { k, total, pages, list: await giftsOf(c, tx, owner, received, PER, page * PER), bd: received ? null : await birthday(c, tx, owner) };
  });
  const { k, total, pages, list, bd } = r;
  const who = w === 'm' ? 'Мои желания' : `Желания: ${nameOf(p)}`;
  const L = [received ? `🎉 <b>${w === 'm' ? 'Мне подарили' : `Уже подарено: ${nameOf(p)}`}</b> · ${total}` : `🎁 <b>${who}</b> · ${total}`];
  const occ = occText(c, w, bd);
  if (occ) L.push(esc(occ));
  if (!received) L.push(w === 'm'
    ? (p ? `<i>${nameOf(p)} видит этот список, но не видит, что из него уже выбрано.</i>` : '<i>Партнёр увидит список, когда присоединится.</i>')
    : `🤫 ${planText(k)} · <i>${nameOf(p)} этого не видит</i>`);
  if (total > PER) L.push(`Страница ${page + 1}/${pages}`);
  L.push('');
  if (!list.length) {
    L.push(received ? 'Пока пусто.' : w === 'm'
      ? 'Список пуст. Добавь, что хочешь получить в подарок: вещь, впечатление, сертификат — с ценой и ссылкой.'
      : `${nameOf(p)} пока ничего не добавил(а). Можно намекнуть 😉`);
  }
  for (const g of list) {
    const pr = priceText(c, g);
    L.push(`${received ? '🎉' : pe(g)} ${esc(cut(g.title, 60))}${pr ? ' · ' + pr : ''}${g.st ? ' · ' + ST_NAME[g.st] : ''}`);
  }
  const pf = received ? 'gf:r' : 'gf:l';
  const rows: Btn[][] = list.map((g) => [b(`${received ? '🎉' : pe(g)} ${cut(g.title, 32)}${g.st === 'picked' ? ' 🤫' : g.st === 'bought' ? ' 🛍' : ''}`, `gf:o:${g.id}`)]);
  if (pages > 1) rows.push([
    page > 0 ? b('‹', `${pf}:${w}:${page - 1}`) : null, b(`${page + 1}/${pages}`, 'noop'),
    page < pages - 1 ? b('›', `${pf}:${w}:${page + 1}`) : null,
  ].filter(Boolean) as Btn[]);
  if (p && !received) rows.push([b(w === 'm' ? '• 🙋 Мои' : '🙋 Мои', 'gf:l:m:0'), b(`${w === 'p' ? '• ' : ''}💞 ${cut(p.first_name, 20)}`, 'gf:l:p:0')]);
  if (!received && w === 'm') rows.push([b('➕ Добавить желание', 'add:gift', 'primary')]);
  rows.push([received ? b('‹ К списку', `gf:l:${w}:0`) : b(`🎉 ${w === 'm' ? 'Мне подарили' : 'Уже подарено'}`, `gf:r:${w}:0`), b('🏠 Главная', 'nav:home')]);
  await show(c, L.join('\n'), kb(...rows));
}

// ============================== Карточка ==============================

async function giftById(c: Ctx, tx: Q, id: number): Promise<Gift | null> {
  const [r] = await tx`
    select g.id, g.owner_id, g.title, g.price, g.priority, g.url, g.note, g.received_at, g.given_by, g.created_at, p.status as st
    from p4t.gifts g left join p4t.gift_plans p on p.gift_id = g.id where g.id = ${id}`;
  return r ? mapGift(c, r) : null;
}

export async function giftCard(c: Ctx, id: number, notice = '') {
  const g = await inC(c, (tx) => giftById(c, tx, id));
  if (!g) return await notFound(c);
  const mine = g.owner_id === c.u.tg_id;
  const owner = memberName(c, g.owner_id);
  const L: string[] = [];
  if (notice) L.push(notice, '');
  L.push(`${g.received_at ? '🎉' : pe(g)} <b>${esc(g.title)}</b>`, `<i>${PRIO[g.priority]?.[1] ?? ''}</i>`);
  if (g.price) L.push('', `💰 Примерно ${priceText(c, g)}`);
  if (g.note) L.push(`📝 ${esc(g.note)}`);
  if (g.url) L.push(`🔗 ${esc(cut(g.url, 60))}`);
  L.push('', mine ? `🙋 Твоё желание · добавлено ${shortTs(g.created_at, c.couple!.tz)}` : `💞 Желание: ${owner} · добавлено ${shortTs(g.created_at, c.couple!.tz)}`);
  const rows: Btn[][] = [];
  if (g.url) rows.push([u('🔗 Открыть ссылку', g.url)]);
  if (g.received_at) {
    L.push(`🎉 Получено ${shortTs(g.received_at, c.couple!.tz)}${g.given_by ? ' · подарил(а) ' + memberName(c, g.given_by) : ''}`);
    if (mine) rows.push([b('↩️ Вернуть в список', `gf:u:${id}`), b('🗑 Удалить', `gf:d:${id}`, 'danger')]);
  } else if (mine) {
    rows.push([b('✅ Уже получил(а)', `gf:x:${id}`, 'success')]);
    rows.push([b('✏️ Изменить', `gf:e:${id}`), b('🗑 Удалить', `gf:d:${id}`, 'danger')]);
  } else {
    L.push('', g.st === 'bought' ? `🛍 Ты отметил(а): <b>куплено</b>. ${owner} этого не видит.`
      : g.st === 'picked' ? `🤫 Ты отметил(а): <b>выбрано</b>. ${owner} этого не видит.`
      : `🤫 Решишь подарить — отметь «Выбрал(а)». ${owner} не узнает, пока не подаришь.`);
    rows.push([
      b(g.st === 'picked' ? '• 🤫 Выбрал(а)' : '🤫 Выбрал(а)', `gf:s:${id}:p`),
      b(g.st === 'bought' ? '• 🛍 Купил(а)' : '🛍 Купил(а)', `gf:s:${id}:b`),
    ]);
    rows.push([b('🎁 Подарил(а)', `gf:g:${id}`, 'success'), g.st ? b('Снять отметку', `gf:s:${id}:n`) : null].filter(Boolean) as Btn[]);
  }
  const w = mine ? 'm' : 'p';
  rows.push([g.received_at ? b('‹ Подаренное', `gf:r:${w}:0`) : b('‹ К списку', `gf:l:${w}:0`), b('🏠 Главная', 'nav:home')]);
  await show(c, L.join('\n'), kb(...rows));
}

// ============================== Добавление и изменение ==============================

export async function addGift(c: Ctx) {
  if (!c.couple) return await onboarding(c);
  await startWizard(c, 'gift', { prio: '2' });
}

export async function finishGift(c: Ctx, s: WS) {
  const d = s.d;
  const prio = [1, 2, 3].includes(Number(d.prio)) ? Number(d.prio) : 2;
  const price = d.price ? Number(d.price) : null;
  const url = d.url && /^https?:\/\/\S+$/i.test(d.url) ? String(d.url) : null;
  if (s.id) {
    const r = await inC(c, (tx) => tx`update p4t.gifts set title = ${d.title}, price = ${price}, priority = ${prio}, url = ${url},
      note = ${d.note ?? null}, updated_at = now() where id = ${s.id} and owner_id = ${c.u.tg_id} and received_at is null returning id`);
    if (!r.length) return await notFound(c);
    return await giftCard(c, s.id, '✅ Сохранено.');
  }
  const id = await inC(c, async (tx) => {
    const [r] = await tx`insert into p4t.gifts (couple_id, owner_id, title, price, priority, url, note)
      values (${c.couple!.id}, ${c.u.tg_id}, ${d.title}, ${price}, ${prio}, ${url}, ${d.note ?? null}) returning id`;
    return Number(r.id);
  });
  const pr = price ? ' · ' + fmtMoney(price, c.couple!.currency) : '';
  await notifyPartner(c, `🎁 <b>${nameOf(c.u)}</b> · новое желание\n${PRIO[prio][0]} <b>${esc(d.title)}</b>${pr}\n\n🤫 Решишь подарить — отметь «Выбрал(а)». ${nameOf(c.u)} этого не увидит.`,
    kb([b('Открыть', `gf:o:${id}`), b('🎁 Все желания', 'gf:l:p:0')]));
  await giftCard(c, id, partner(c) ? `✅ Добавлено. ${nameOf(partner(c))} получил(а) уведомление.` : '✅ Добавлено в твой список желаний.');
}

async function ownGift(c: Ctx, id: number) {
  const g = await inC(c, (tx) => giftById(c, tx, id));
  return g && g.owner_id === c.u.tg_id ? g : null;
}

export async function giftEditMenu(c: Ctx, id: number) {
  const g = await ownGift(c, id);
  if (!g || g.received_at) return await notFound(c);
  await show(c, `✏️ <b>${esc(g.title)}</b>\nЧто изменить?`, kb(
    [b('Название', `gf:ef:${id}:title`), b('Цену', `gf:ef:${id}:price`), b('Насколько хочется', `gf:ef:${id}:prio`)],
    [b('Ссылку', `gf:ef:${id}:url`), b('Заметку', `gf:ef:${id}:note`)],
    [b('‹ Назад', `gf:o:${id}`)],
  ));
}

export async function giftEditField(c: Ctx, id: number, field: string) {
  if (!['title', 'price', 'prio', 'url', 'note'].includes(field)) return;
  const g = await ownGift(c, id);
  if (!g || g.received_at) return await notFound(c);
  await startWizard(c, 'gift', { title: g.title, price: g.price, prio: String(g.priority), url: g.url, note: g.note }, { only: field, id });
}

// ============================== Тайные отметки и «подарил» ==============================

/** Отметка дарителя. RLS не даст поставить её на своё или полученное желание. */
async function setPlan(c: Ctx, id: number, st: string): Promise<string | null> {
  const g = await inC(c, (tx) => giftById(c, tx, id));
  if (!g) return 'Желание не найдено';
  if (g.owner_id === c.u.tg_id) return 'Это твоё желание — отмечать его не нужно';
  if (g.received_at) return 'Это желание уже исполнено';
  try {
    await inC(c, async (tx) => {
      if (st === 'n') await tx`delete from p4t.gift_plans where gift_id = ${id}`;
      else {
        await tx`insert into p4t.gift_plans (gift_id, couple_id, giver_id, status)
          values (${id}, ${c.couple!.id}, ${c.u.tg_id}, ${st === 'b' ? 'bought' : 'picked'})
          on conflict (gift_id) do update set status = excluded.status, updated_at = now()`;
      }
    });
  } catch (e) {
    console.error('gift plan failed', String(e));
    return 'Не получилось сохранить отметку';
  }
  return null;
}

export async function giftPlan(c: Ctx, id: number, st: string) {
  if (!['p', 'b', 'n'].includes(st)) return;
  const err = await setPlan(c, id, st);
  if (err) return await giftCard(c, id, `⚠️ ${err}`);
  await giftCard(c, id, st === 'n' ? 'Отметка снята.' : '✅ Отметка сохранена.');
}

export async function giftGiveConfirm(c: Ctx, id: number) {
  const g = await inC(c, (tx) => giftById(c, tx, id));
  if (!g || g.owner_id === c.u.tg_id || g.received_at) return await notFound(c);
  const owner = memberName(c, g.owner_id);
  await show(c, `🎁 Отметить «${esc(g.title)}» подаренным?\n\n${owner} получит уведомление, что это подарок от тебя, а желание перейдёт в «Уже подарено». Если подарок ещё впереди — лучше пока оставь отметку «Купил(а)».`,
    kb([b('🎁 Да, подарил(а)', `gf:g!:${id}`, 'success'), b('Отмена', `gf:o:${id}`)]));
}

export async function giftGive(c: Ctx, id: number) {
  const g = await inC(c, (tx) => giftById(c, tx, id));
  if (!g) return await notFound(c);
  const [r] = await inC(c, (tx) => tx`select p4t.gift_given(${id}) as ok`);
  if (!r?.ok) return await giftCard(c, id, '⚠️ Не получилось — возможно, желание уже отмечено полученным.');
  await notifyPartner(c, `🎁 <b>${nameOf(c.u)}</b> подарил(а) тебе «${esc(g.title)}» ❤️\nЖелание перенесено в «Мне подарили».`, kb([b('Открыть', `gf:o:${id}`)]));
  await giftCard(c, id, `🎉 Готово! ${memberName(c, g.owner_id)} получил(а) уведомление.`);
}

/**
 * Владелец удаляет желание или отмечает его полученным. Если партнёр успел его выбрать или купить,
 * отметка снимается, а партнёр получает тихое сообщение. Владелец об отметке не узнаёт:
 * её читает только серверная роль, ответ владельцу одинаковый в обоих случаях.
 */
async function dropPlanAndTell(c: Ctx, id: number, title: string, why: 'del' | 'got') {
  const [pl] = await db()`delete from p4t.gift_plans where gift_id = ${id} and couple_id = ${c.couple!.id} returning giver_id, status`;
  if (!pl) return;
  const giver = c.members.find((m) => m.tg_id === Number(pl.giver_id));
  if (!giver || giver.tg_id === c.u.tg_id) return;
  const st = pl.status === 'bought' ? 'куплено' : 'выбрано';
  const text = why === 'del'
    ? `ℹ️ ${nameOf(c.u)} убрал(а) из списка желаний «${esc(title)}». Твоя отметка «${st}» снята — ${nameOf(c.u)} о ней не узнал(а).`
    : `ℹ️ ${nameOf(c.u)} отметил(а) «${esc(title)}» как уже полученное. Твоя отметка «${st}» снята — ${nameOf(c.u)} о ней не узнал(а).${pl.status === 'bought' ? '\nВозможно, стоит выбрать что-то другое из списка 😉' : ''}`;
  try { await send(giver.tg_id, text, kb([b('🎁 Желания', 'gf:l:p:0')]), { disable_notification: true }); } catch (e) { await sendFailed(giver.tg_id, e); }
}

export async function giftReceived(c: Ctx, id: number, got: boolean) {
  const r = await inC(c, (tx) => got
    ? tx`update p4t.gifts set received_at = now(), given_by = null, updated_at = now() where id = ${id} and owner_id = ${c.u.tg_id} and received_at is null returning title`
    : tx`update p4t.gifts set received_at = null, given_by = null, updated_at = now() where id = ${id} and owner_id = ${c.u.tg_id} and received_at is not null returning title`);
  if (!r.length) return await notFound(c);
  if (got) await dropPlanAndTell(c, id, r[0].title, 'got');
  await giftCard(c, id, got ? '🎉 Отмечено полученным.' : '↩️ Желание снова в списке.');
}

export async function giftDeleteConfirm(c: Ctx, id: number) {
  const g = await ownGift(c, id);
  if (!g) return await notFound(c);
  await show(c, `🗑 Удалить «${esc(g.title)}» из списка желаний?`, kb([b('Да, удалить', `gf:d!:${id}`, 'danger'), b('Отмена', `gf:o:${id}`)]));
}

export async function giftDelete(c: Ctx, id: number) {
  const g = await ownGift(c, id);
  if (!g) return await notFound(c);
  // Сначала снимаем отметку партнёра и предупреждаем его, затем удаляем
  if (!g.received_at) await dropPlanAndTell(c, id, g.title, 'del');
  await inC(c, (tx) => tx`delete from p4t.gifts where id = ${id} and owner_id = ${c.u.tg_id}`);
  await giftList(c, 'm', 0, !!g.received_at);
}

/** Маршрутизация кнопок gf:* */
export async function giftRoute(c: Ctx, p: string[]) {
  const w: W = p[2] === 'p' ? 'p' : 'm';
  if (p[1] === 'l') return await giftList(c, w, Number(p[3]) || 0);
  if (p[1] === 'r') return await giftList(c, w, Number(p[3]) || 0, true);
  const id = Number(p[2]);
  if (!Number.isInteger(id) || id <= 0) return;
  switch (p[1]) {
    case 'o': return await giftCard(c, id);
    case 's': return await giftPlan(c, id, p[3]);
    case 'g': return await giftGiveConfirm(c, id);
    case 'g!': return await giftGive(c, id);
    case 'x': return await giftReceived(c, id, true);
    case 'u': return await giftReceived(c, id, false);
    case 'e': return await giftEditMenu(c, id);
    case 'ef': return await giftEditField(c, id, p[3]);
    case 'd': return await giftDeleteConfirm(c, id);
    case 'd!': return await giftDelete(c, id);
  }
}

// ============================== Виджет ==============================

const ST_CODE = { picked: 1, bought: 2 } as const;

/** Данные виджета собираются под конкретного зрителя: на своих желаниях отметок нет вовсе */
export async function giftJson(c: Ctx, err?: string) {
  const p = partner(c);
  const cur = c.couple!.currency;
  const d = await inC(c, async (tx) => ({
    mine: await giftsOf(c, tx, c.u.tg_id, false, 6), km: await counts(tx, c.u.tg_id), bm: await birthday(c, tx, c.u.tg_id),
    theirs: p ? await giftsOf(c, tx, p.tg_id, false, 6) : [], kp: p ? await counts(tx, p.tg_id) : null, bp: p ? await birthday(c, tx, p.tg_id) : null,
  }));
  const pr = (g: Gift) => g.price ? `${fmtShort(g.price)} ${cur}` : '';
  const o: any = {
    b: p ? p.first_name.slice(0, 24) : null,
    m: [occText(c, 'm', d.bm).slice(0, 60), d.km.n, d.mine.map((g) => [g.id, pe(g), cut(g.title, 28), pr(g)])],
    p: p && d.kp ? [
      [occText(c, 'p', d.bp), d.kp.n ? planText(d.kp) : ''].filter(Boolean).join(' · ').slice(0, 90), d.kp.n,
      d.theirs.map((g) => [g.id, pe(g), cut(g.title, 24), pr(g), g.st ? ST_CODE[g.st] : 0]),
    ] : null,
  };
  if (err) o.err = err;
  return fitJson(o, [() => !!o.p?.[2].pop(), () => !!o.m[2].pop()]);
}

export async function giftWidgetQuery(c: Ctx, data: string): Promise<{ answer: string; after?: () => Promise<unknown> } | null> {
  let m: RegExpExecArray | null;
  if (data === 'gw') return { answer: await giftJson(c) };
  if (data === 'ga') return { answer: '{}', after: () => addGift(c) };
  if ((m = /^gl:([mp])$/.exec(data))) return { answer: '{}', after: () => giftList(c, m![1] as W, 0) };
  if ((m = /^go:(\d{1,12})$/.exec(data))) return { answer: '{}', after: () => giftCard(c, Number(m![1])) };
  if ((m = /^gs:(\d{1,12}):([pbn])$/.exec(data))) {
    const err = await setPlan(c, Number(m[1]), m[2]);
    return { answer: await giftJson(c, err ?? undefined) };
  }
  return null;
}

/** Подсказка для напоминания о дне рождения участника пары: только про свои отметки получателя */
export async function birthdayHint(coupleId: string, person: number, viewer: number, personName: string, currency: string): Promise<string> {
  const sql = db();
  if (person === viewer) {
    const [r] = await sql`select count(*)::int as n from p4t.gifts where couple_id = ${coupleId} and owner_id = ${person} and received_at is null`;
    return Number(r.n) ? '' : `\n\n🎁 Твой список желаний пуст — добавь пару идей, чтобы было проще с подарком: /addgift`;
  }
  const [r] = await sql`
    select count(*) filter (where g.received_at is null)::int as n,
           count(p.gift_id) filter (where g.received_at is null and p.giver_id = ${viewer})::int as mine,
           count(p.gift_id) filter (where g.received_at is null and p.giver_id = ${viewer} and p.status = 'bought')::int as bought,
           min(g.price) filter (where g.received_at is null) as minp
    from p4t.gifts g left join p4t.gift_plans p on p.gift_id = g.id
    where g.couple_id = ${coupleId} and g.owner_id = ${person}`;
  const n = Number(r.n);
  if (!n) return `\n\n🎁 ${esc(personName)} пока не добавил(а) желаний — можно аккуратно намекнуть 😉`;
  const state = Number(r.mine) ? `ты выбрал(а) ${r.mine}${Number(r.bought) ? `, купил(а) ${r.bought}` : ''}` : 'ты пока ничего не выбрал(а)';
  return `\n\n🎁 В списке желаний ${n} ${plural(n, 'идея', 'идеи', 'идей')}${r.minp ? ` (от ${fmtMoney(num(r.minp), currency)})` : ''} · ${state}`;
}
