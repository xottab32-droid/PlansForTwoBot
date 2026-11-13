import { cleanName, SUPPORT_BOT, SUPPORT_URL, Ctx, CURRENCIES, inC, nameOf, notifyPartner, pairTitle, partner, show, TZS, WS } from './core.ts';
import { db } from './db.ts';
import { Btn, b, kb, u } from './tg.ts';
import { esc, localNow, plural } from './util.ts';
import { startWizard } from './wizard.ts';
import { onboarding } from './pair_views.ts';
const navRow = (...extra: Btn[]): Btn[] => [...extra, b('🏠 Главная', 'nav:home')];

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
  '<b>🎁 Желания и подарки</b>',
  '/gifts — твой список желаний и список партнёра',
  '/addgift — добавить желание: цена, ссылка, насколько хочется',
  'В списке партнёра отмечай «🤫 Выбрал» → «🛍 Купил» → «🎁 Подарил». Отметки видишь только ты — партнёр узнает о подарке, только когда ты нажмёшь «Подарил». Укажи в дне рождения, чей он, — бот напомнит заглянуть в список.',
  '',
  '<b>🔗 Связи</b>',
  'Цель → событие: «Накопили на поездку → запланировали поездку». Кнопка «📅 Запланировать» есть в цели и в записи «Хочу сходить». Когда цель достигнута, бот сам предложит запланировать.',
  '',
  '<b>🔔 Уведомления</b>',
  'Партнёру приходит сообщение, когда ты добавляешь или меняешь событие, создаёшь цель, пополняешь копилку (кто, сколько, куда и сколько осталось), добавляешь место в список или новое желание. О твоих отметках «выбрал/купил» партнёр не узнаёт.',
  'Напоминания о датах — обоим: за 7 дней, за день и в день события (настраивается), а также за 2 часа до событий со временем.',
  '',
  '<b>⚙️ Прочее</b>',
  '/settings — часовой пояс, валюта, напоминания, карточки, выход из пары',
  '/name — изменить своё имя (как тебя видит партнёр)',
  '/support — написать в поддержку',
  '/cancel — отменить текущий ввод',
  '/help — эта справка',
  '',
  '✨ <b>Интерактивные карточки.</b> Главная, календарь, цели и подарки приходят живыми виджетами прямо в чате: календарь листается, по дню видно события, цель пополняется в одно касание. Если вместо карточки видно «неподдерживаемое сообщение» — обнови Telegram или выключи карточки в /settings.',
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
