// Маршрутизация обновлений Telegram
import { Ctx, loadCtx, MENU, saveState } from './core.ts';
import { answerCb, answerWidget, api, b, Callback, edit, kb, Message, send, Update, WidgetQuery } from './tg.ts';
import * as V from './views.ts';
import * as W from './wizard.ts';
import * as A from './admin.ts';

const MENU_LABELS: Record<string, (c: Ctx) => Promise<unknown>> = {
  '🏠 Главная': (c) => V.home(c),
  '📅 Календарь': (c) => V.calendar(c),
  '🎯 Цели': (c) => V.goalsList(c),
  '📍 Хочу сходить': (c) => V.wishList(c),
  '🎁 Подарки': (c) => V.giftsHome(c),
  '➕ Добавить': (c) => V.addMenu(c),
  '⚙️ Настройки': (c) => V.settings(c),
};

export async function handleUpdate(up: Update) {
  if (up.message) return await onMessage(up.message);
  if (up.callback_query) return await onCallback(up.callback_query);
  if (up.widget_query) return await onWidget(up.widget_query);
}

/** Прервать незавершённый ввод: старая карточка ввода помечается как отменённая */
async function dropWizard(c: Ctx, keepMsg?: number) {
  const s = c.u.state;
  if (!s) return;
  await saveState(c, null);
  if (s.m && s.m !== keepMsg) { try { await edit(c.chat, s.m, '✖️ Ввод отменён.'); } catch { /* уже удалено */ } }
}

async function command(c: Ctx, cmd: string, arg: string) {
  switch (cmd) {
    case 'start': {
      const j = /^j_([A-Za-z0-9]{8})$/.exec(arg);
      if (j) return await V.joinPreview(c, j[1]);
      if (c.couple) {
        await send(c.chat, `💞 С возвращением! Разделы — в меню внизу, справка — /help.`, MENU);
        return await V.home(c);
      }
      return await V.onboarding(c);
    }
    case 'help': return await V.help(c);
    case 'home': return await V.home(c);
    case 'calendar': return await V.calendar(c);
    case 'upcoming': return await V.upcomingList(c, 0);
    case 'adddate': case 'addevent': return await V.addEvent(c);
    case 'goals': return await V.goalsList(c);
    case 'addgoal': return await V.addGoal(c);
    case 'wishlist': case 'wish': return await V.wishList(c);
    case 'addwish': return await V.addWish(c);
    case 'gifts': case 'gift': case 'presents': return await V.giftsHome(c);
    case 'addgift': return await V.addGift(c);
    case 'addpart': case 'invite': case 'newpair': return await V.invite(c);
    case 'join': return arg ? await V.joinPreview(c, arg) : await W.startWizard(c, 'join');
    case 'settings': return await V.settings(c);
    case 'name': return await W.startWizard(c, 'name');
    case 'leave': return await V.leaveConfirm(c);
    case 'support': case 'feedback': return await V.support(c);
    case 'admin': case 'stats':
      if (await A.isAdmin(c.u.tg_id)) { await A.syncAdminCommands(c); return await A.adminHome(c); }
      return await send(c.chat, 'Не знаю такой команды. Список команд — /help');
    case 'cancel': return await send(c.chat, 'Ок, ничего не делаем. Меню — внизу экрана.', c.couple ? MENU : undefined);
    default: return await send(c.chat, 'Не знаю такой команды. Список команд — /help');
  }
}

async function onMessage(m: Message) {
  if (m.chat.type !== 'private' || !m.from || m.from.is_bot) return;
  const c = await loadCtx(m.from, m.chat.id);
  const text = (m.text ?? '').trim();
  const cmd = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
  if (cmd) {
    await dropWizard(c);
    return await command(c, cmd[1].toLowerCase(), (cmd[2] ?? '').trim());
  }
  const menu = MENU_LABELS[text];
  if (menu) { await dropWizard(c); return await menu(c); }
  if (c.u.state?.f === 'bc') {
    if (await A.isAdmin(c.u.tg_id)) return await A.onAdminMessage(c, m);
    await saveState(c, null);
  }
  if (c.u.state) {
    if (!m.text) return await send(c.chat, 'Пришли ответ текстом 🙂');
    return await W.onText(c, c.u.state, m.message_id, text.slice(0, 1000));
  }
  if (!c.couple && /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(text)) return await V.joinPreview(c, text);
  await send(c.chat, 'Выбери раздел в меню внизу или посмотри /help', c.couple ? MENU : undefined);
}

const OPEN = new Set(['nav:help', 'nav:set', 'nav:support', 's:nw', 'pair:new', 'pair:regen', 'pair:code', 'pair:leave', 'pair:leave!', 's:wd', 's:q', 's:nm', 's:nm:tg', 'noop']);

async function onCallback(q: Callback) {
  const msg = q.message;
  if (!msg || msg.chat.type !== 'private') return await answerCb(q.id);
  const c = await loadCtx(q.from, msg.chat.id);
  c.cbId = q.id;
  c.target = msg.widget ? undefined : msg.message_id;
  const data = q.data ?? '';
  try {
    if (data === 'noop') return;
    if (data.startsWith('adm:')) {
      if (!(await A.isAdmin(c.u.tg_id))) return;
      return await A.adminCallback(c, data);
    }
    if (data === 'news:off' || data === 'news:on') return await newsToggle(c, data === 'news:on', msg.message_id);
    if (data.startsWith('wz:')) {
      const s = c.u.state;
      if (!s || s.m !== msg.message_id) {
        await answerCb(q.id, 'Эта карточка ввода уже неактуальна');
        c.answered = true;
        try { await edit(c.chat, msg.message_id, '✖️ Ввод отменён.'); } catch { /* */ }
        return;
      }
      return await W.onCallback(c, s, data);
    }
    await dropWizard(c, msg.message_id);
    if (!c.couple && !OPEN.has(data) && !data.startsWith('pair:join:')) return await V.onboarding(c);
    await route(c, data);
  } finally {
    if (!c.answered) await answerCb(q.id);
  }
}

async function route(c: Ctx, data: string) {
  const p = data.split(':');
  const id = Number(p[2]);
  switch (p[0]) {
    case 'nav':
      switch (p[1]) {
        case 'home': return await V.home(c);
        case 'cal': return await V.calendar(c);
        case 'goals': return await V.goalsList(c);
        case 'wish': return await V.wishList(c);
        case 'gift': return await V.giftsHome(c);
        case 'add': return await V.addMenu(c);
        case 'set': return await V.settings(c);
        case 'help': return await V.help(c);
        case 'support': return await V.support(c);
      }
      return;
    case 'pair':
      switch (p[1]) {
        case 'new': return await V.invite(c);
        case 'regen': return await V.invite(c, true);
        case 'revoke': return await V.revokeInvite(c);
        case 'code': return await W.startWizard(c, 'join');
        case 'join': return await V.doJoin(c, p[2] ?? '');
        case 'leave': return await V.leaveConfirm(c);
        case 'leave!': return await V.doLeave(c);
      }
      return;
    case 'add':
      if (p[1] === 'ev') return await V.addEvent(c, p[2]);
      if (p[1] === 'goal') return await V.addGoal(c);
      if (p[1] === 'wish') return await V.addWish(c);
      if (p[1] === 'gift') return await V.addGift(c);
      return;
    case 'up': return await V.upcomingList(c, Number(p[1]) || 0);
    case 'pa': return await V.upcomingList(c, Number(p[1]) || 0, true);
    case 'gl': return await V.goalsList(c, p[1] === '1', Number(p[2]) || 0);
    case 'wl': return await V.wishList(c, p[1] ?? 'all', Number(p[2]) || 0);
    case 'wd': return await V.wishList(c, p[1] ?? 'all', Number(p[2]) || 0, true);
    case 's': return await V.settingsAction(c, p[1], p[2]);
    case 'gf': return await V.giftRoute(c, p);
  }
  if (p[0] === 'wi' && p[1] === 'rnd') return await V.wishRandom(c);
  if (!Number.isInteger(id) || id <= 0) return;
  if (p[0] === 'ev') {
    switch (p[1]) {
      case 'o': return await V.eventCard(c, id);
      case 'e': return await V.eventEditMenu(c, id);
      case 'ef': return await V.eventEditField(c, id, p[3]);
      case 'd': return await V.eventDeleteConfirm(c, id);
      case 'd!': return await V.eventDelete(c, id);
      case 'lg': return p[3] ? await V.eventLink(c, id, Number(p[3])) : await V.eventLinkMenu(c, id);
      case 'ul': return await V.eventLink(c, id, null);
    }
  }
  if (p[0] === 'g') {
    switch (p[1]) {
      case 'o': return await V.goalCard(c, id);
      case 't': return await V.topUpStart(c, id, 1);
      case 'w': return await V.topUpStart(c, id, -1);
      case 'h': return await V.goalHistory(c, id, Number(p[3]) || 0);
      case 'p': return await V.goalPlan(c, id);
      case 'e': return await V.goalEditMenu(c, id);
      case 'ef': return await V.goalEditField(c, id, p[3]);
      case 'a': return await V.goalArchive(c, id);
      case 'd': return await V.goalDeleteConfirm(c, id);
      case 'd!': return await V.goalDelete(c, id);
    }
  }
  if (p[0] === 'wi') {
    switch (p[1]) {
      case 'o': return await V.wishCard(c, id);
      case 'p': return await V.wishPlan(c, id);
      case 'x': return await V.wishDone(c, id, true);
      case 'u': return await V.wishDone(c, id, false);
      case 'e': return await V.wishEditMenu(c, id);
      case 'ef': return await V.wishEditField(c, id, p[3]);
      case 'd': return await V.wishDeleteConfirm(c, id);
      case 'd!': return await V.wishDelete(c, id);
    }
  }
}

/** Отписка/подписка на новости прямо из рассылки */
async function newsToggle(c: Ctx, on: boolean, messageId: number) {
  await V.setNews(c, on);
  await answerCb(c.cbId!, on ? '🔔 Снова будем присылать новости бота' : '🔕 Больше не будем присылать новости. Включить — в /settings');
  c.answered = true;
  try {
    await api('editMessageReplyMarkup', { chat_id: c.chat, message_id: messageId, reply_markup: kb([on ? b('🔕 Не присылать новости', 'news:off') : b('🔔 Снова получать новости', 'news:on')]) });
  } catch { /* */ }
}

async function onWidget(q: WidgetQuery) {
  if (!q.chat || q.chat.type !== 'private') return await answerWidget(q.id, JSON.stringify({ err: 'Доступно только в личном чате с ботом' }));
  const data = String(q.data ?? '').slice(0, 64);
  // Виджет админ-статистики: отвечаем до проверки пары, права проверяются внутри (не-админ получит только ошибку)
  if (data === 'as') {
    let ans: string;
    try { ans = await A.adminWidgetQuery(q.from.id); } catch (e) {
      console.error('admin widget query failed', String(e));
      ans = JSON.stringify({ err: 'Ошибка, попробуй ещё раз' });
    }
    return await answerWidget(q.id, ans);
  }
  const c = await loadCtx(q.from, q.chat.id);
  let res: Awaited<ReturnType<typeof V.widgetQuery>>;
  try {
    res = await V.widgetQuery(c, data);
  } catch (e) {
    console.error('widget query failed', String(e));
    res = { answer: JSON.stringify({ err: 'Ошибка, попробуй ещё раз' }) };
  }
  await answerWidget(q.id, res.answer);
  if (res.after) {
    await dropWizard(c);
    await res.after();
  }
}
