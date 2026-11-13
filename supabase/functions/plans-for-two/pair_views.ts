import { BOT_USERNAME, Ctx, fmtExpiry, MENU, nameOf, notifyPartner, pairTitle, partner, show, withCouple } from './core.ts';
import { db, Q } from './db.ts';
import { Btn, b, kb, send } from './tg.ts';
import { esc, inviteCode, normCode, showCode } from './util.ts';
import { home } from './views.ts';
const navRow = (...extra: Btn[]): Btn[] => [...extra, b('🏠 Главная', 'nav:home')];

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
    // Личное уходит вместе с человеком: его список желаний и его тайные отметки на желаниях партнёра
    await tx`delete from p4t.gifts where couple_id = ${cid} and owner_id = ${c.u.tg_id}`;
    await tx`delete from p4t.gift_plans where couple_id = ${cid} and giver_id = ${c.u.tg_id}`;
    await tx`update p4t.events set person_id = null where couple_id = ${cid} and person_id = ${c.u.tg_id}`;
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
