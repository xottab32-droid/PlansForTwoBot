import { CATS, Ctx, inC, memberName, nameOf, notifyPartner, show, WS } from './core.ts';
import { b, Btn, kb, u } from './tg.ts';
import { cut, esc, fmtDate, fmtShortDate } from './util.ts';
import { startWizard } from './wizard.ts';
import { onboarding } from './pair_views.ts';
const shortTs = (d: Date, tz: string) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'short' }).format(new Date(d)).replace('.', '');
const navRow = (...extra: Btn[]): Btn[] => [...extra, b('🏠 Главная', 'nav:home')];

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
