// Напоминания: атомарная постановка в очередь и отдельная доставка каждому участнику.
// Не отмечаем уведомление доставленным до успешного ответа Telegram.
import { allEvents, Couple, evTitle, KINDS, mapUser, UserRow } from './core.ts';
import { db, inCouple, Q } from './db.ts';
import { b, kb, send, TgError } from './tg.ts';
import { addDays, daysBetween, esc, fmtDate, localNow, nextOccurrence, plural, untilText, yearsText } from './util.ts';

async function claim(tx: Q, coupleId: string, key: string): Promise<boolean> {
  const rows = await tx`insert into p4t.sent (couple_id, key) values (${coupleId}, ${key})
    on conflict do nothing returning key`;
  return rows.length > 0;
}

type Msg = { key: string; text: string; kb?: ReturnType<typeof kb> };

export async function runReminders(now = new Date()) {
  const sql = db();
  // Сужаем число пар для обхода: не проверяем пары без дат в ближайшие 14 дней.
  // Сохраняем юбилеи каждые 100 дней независимо от месяца начала отношений.
  const couples: Couple[] = await sql`
    select cp.* from p4t.couples cp
    where exists (select 1 from p4t.users u where u.couple_id = cp.id)
      and exists (
        select 1 from p4t.events e
        where e.couple_id = cp.id and (
          (not e.yearly and e.event_date between (${now}::timestamptz at time zone cp.tz)::date - 1
            and (${now}::timestamptz at time zone cp.tz)::date + 14)
          or (e.yearly and extract(month from e.event_date) in (
            extract(month from (${now}::timestamptz at time zone cp.tz)::date),
            extract(month from (${now}::timestamptz at time zone cp.tz)::date + 14)
          ))
          or (e.kind = 'relationship'
              and (${now}::timestamptz at time zone cp.tz)::date - e.event_date > 0
              and mod((${now}::timestamptz at time zone cp.tz)::date - e.event_date, 100) = 0)
        )
      )`;
  let queued = 0;
  for (const cp of couples) {
    try { queued += await coupleReminders(cp, now); }
    catch (e) { console.error('reminders failed for couple', cp.id, String(e)); }
  }
  // Доставляем уже сохранённую очередь, даже если новых напоминаний не было.
  await deliverPending();
  await sql`delete from p4t.sent where created_at < now() - interval '400 days'`;
  await sql`delete from p4t.reminder_deliveries where status in ('sent', 'skipped', 'blocked', 'failed')
    and coalesce(sent_at, created_at) < now() - interval '30 days'`;
  // retry/processing старше 3 дней Telegram уже не повторит
  await sql`delete from p4t.updates where created_at < now() - interval '3 days'`;
  await sql`delete from p4t.activity where day < (now() at time zone 'UTC')::date - 400`;
  await sql`delete from p4t.broadcast_recipients r using p4t.broadcasts b
    where b.id = r.broadcast_id and b.status in ('done', 'canceled')
      and b.finished_at < now() - interval '90 days'`;
  return queued;
}

async function coupleReminders(cp: Couple, now: Date): Promise<number> {
  const ln = localNow(cp.tz, now);
  const members: UserRow[] = (await db()`select * from p4t.users where couple_id = ${cp.id}`).map(mapUser);
  if (!members.length) return 0;
  const out: Msg[] = [];
  await inCouple(cp.id, async (tx) => {
    const events = await allEvents(tx);
    for (const e of events) {
      const occ = nextOccurrence(e.event_date, e.yearly, ln.date);
      const k = KINDS[e.kind] ?? KINDS.important;
      if (occ) {
        const days = daysBetween(ln.date, occ.date);
        const title = esc(evTitle(e));
        const yrs = occ.years > 0 && e.kind !== 'birthday' ? ` — ${yearsText(occ.years)}` : '';
        const open = kb([b('Открыть', `ev:o:${e.id}`, 'primary')]);
        const remKey = `r:${e.id}:${occ.date}:${days}`;
        if (cp.remind_days.includes(days) && ln.hour >= cp.remind_hour && await claim(tx, cp.id, remKey)) {
          const when = days === 0 ? 'Сегодня' : days === 1 ? 'Завтра' : untilText(days).replace(/^ч/, 'Ч');
          const t = e.event_time ? ` в ${String(e.event_time).slice(0, 5)}` : '';
          out.push({ key: remKey, text: `🔔 <b>${when}</b>${days > 1 ? ` (${fmtDate(occ.date, { wd: true })})` : t}: ${k.e} ${title}${yrs}${e.place ? `\n📍 ${esc(e.place)}` : ''}`, kb: open });
        }
        if (days === 0 && e.event_time) {
          const [h, m] = String(e.event_time).split(':').map(Number);
          const left = h * 60 + m - ln.minutes;
          const timedKey = `t:${e.id}:${occ.date}`;
          if (left > 0 && left <= 120 && await claim(tx, cp.id, timedKey)) {
            out.push({ key: timedKey, text: `⏰ Через ${left >= 60 ? `${Math.round(left / 60)} ч` : `${left} мин`}: ${k.e} ${title}${e.place ? `\n📍 ${esc(e.place)}` : ''}`, kb: open });
          }
        }
      }
      if (e.wish_id && !e.yearly && addDays(e.event_date, 1) === ln.date && ln.hour >= cp.remind_hour) {
        const [w] = await tx`select id, title, done_at from p4t.wishes where id = ${e.wish_id}`;
        const followKey = `f:${e.id}`;
        if (w && !w.done_at && await claim(tx, cp.id, followKey)) {
          out.push({
            key: followKey, text: `💭 Вчера было «${esc(e.title)}». Отметить «${esc(w.title)}» как посещённое?`,
            kb: kb([b('✅ Сходили', `wi:x:${w.id}`, 'success'), b('Оставить в списке', `wi:o:${w.id}`)]),
          });
        }
      }
      if (e.kind === 'relationship' && ln.hour >= cp.remind_hour) {
        const n = daysBetween(e.event_date, ln.date);
        const milestoneKey = `m:${e.id}:${n}`;
        if (n > 0 && n % 100 === 0 && await claim(tx, cp.id, milestoneKey)) {
          out.push({ key: milestoneKey, text: `🎉 Сегодня вы вместе уже <b>${n} ${plural(n, 'день', 'дня', 'дней')}</b>! ❤️` });
        }
      }
    }

    // Обе записи находятся в одной транзакции: p4t.sent + очередь получателей.
    // Ошибка постановки в очередь откатит отметку в sent.
    for (const msg of out) for (const member of members) {
      await tx`insert into p4t.reminder_deliveries
        (couple_id, reminder_key, tg_id, body, reply_markup)
        values (${cp.id}, ${msg.key}, ${member.tg_id}, ${msg.text}, ${JSON.stringify(msg.kb ?? null)}::jsonb)
        on conflict (couple_id, reminder_key, tg_id) do nothing`;
    }
  });
  return out.length;
}

/** После стольких неудачных попыток доставка помечается failed (≈ сутки с учётом backoff) */
export const MAX_DELIVERY_ATTEMPTS = 8;

async function deliverOne(row: any) {
  const sql = db();
  const [user] = await sql`select couple_id, quiet, blocked_at from p4t.users where tg_id = ${row.tg_id}`;
  if (!user || user.couple_id !== row.couple_id || user.blocked_at) {
    await sql`update p4t.reminder_deliveries set status = 'skipped', claimed_at = null
      where id = ${row.id}`;
    return false;
  }
  try {
    await send(Number(row.tg_id), row.body, row.reply_markup ?? undefined, { disable_notification: user.quiet });
    await sql`update p4t.reminder_deliveries set status = 'sent', sent_at = now(), claimed_at = null, error = null
      where id = ${row.id}`;
    return true;
  } catch (e) {
    if (e instanceof TgError && e.code === 403) {
      await sql`update p4t.users set blocked_at = now() where tg_id = ${row.tg_id}`;
      await sql`update p4t.reminder_deliveries set status = 'blocked', claimed_at = null, error = ${String(e).slice(0,300)}
        where id = ${row.id}`;
    } else if ((e instanceof TgError && e.code === 400) || Number(row.attempts) >= MAX_DELIVERY_ATTEMPTS) {
      // 400 — ошибка в самом сообщении или чате, повтор не поможет; лимит — от бесконечных повторов
      await sql`update p4t.reminder_deliveries set status = 'failed', claimed_at = null, error = ${String(e).slice(0, 300)}
        where id = ${row.id}`;
    } else {
      const backoff = Math.min(3600, 60 * (2 ** Math.min(6, Number(row.attempts) - 1)));
      // 429: Telegram сам говорит, через сколько можно повторить
      const delay = e instanceof TgError && e.code === 429 && e.retryAfter > 0 ? Math.min(3600, e.retryAfter + 1) : backoff;
      await sql`update p4t.reminder_deliveries
        set status = 'pending', claimed_at = null,
            next_attempt_at = now() + ${delay} * interval '1 second', error = ${String(e).slice(0,300)}
        where id = ${row.id}`;
    }
    console.error('reminder delivery failed', row.id, String(e));
    return false;
  }
}

// Короткие ограниченные порции, чтобы не превышать лимит времени Edge Function.
// FOR UPDATE SKIP LOCKED предотвращает одновременную отправку несколькими cron-запусками.
export async function deliverPending(limit = 10): Promise<number> {
  const sql = db();
  const rows = await sql`
    with ready as (
      select id from p4t.reminder_deliveries
      where (status = 'pending' and next_attempt_at <= now())
         or (status = 'sending' and claimed_at < now() - interval '3 minutes')
      order by next_attempt_at, id
      for update skip locked limit ${limit}
    )
    update p4t.reminder_deliveries d
    set status = 'sending', attempts = attempts + 1, claimed_at = now()
    from ready where d.id = ready.id
    returning d.id, d.tg_id, d.couple_id, d.body, d.reply_markup, d.attempts`;
  let cursor = 0, delivered = 0;
  await Promise.all(Array.from({ length: Math.min(5, rows.length) }, async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      if (await deliverOne(row)) delivered++;
    }
  }));
  return delivered;
}
