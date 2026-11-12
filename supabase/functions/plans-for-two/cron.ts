// Напоминания: вызывается pg_cron каждые 10 минут. Каждое напоминание отправляется один раз
// (ключ фиксируется в p4t.sent до отправки).
import { allEvents, Couple, evTitle, KINDS, mapUser, notifyAll, UserRow } from './core.ts';
import { db, inCouple, Q } from './db.ts';
import { b, kb } from './tg.ts';
import { addDays, daysBetween, esc, fmtDate, localNow, nextOccurrence, plural, untilText, yearsText } from './util.ts';

async function claim(tx: Q, coupleId: string, key: string): Promise<boolean> {
  const r = await tx`insert into p4t.sent (couple_id, key) values (${coupleId}, ${key}) on conflict do nothing returning key`;
  return r.length > 0;
}

export async function runReminders(now = new Date()) {
  const sql = db();
  const couples: Couple[] = await sql`select * from p4t.couples where exists (select 1 from p4t.users u where u.couple_id = couples.id)`;
  let sentCount = 0;
  for (const cp of couples) {
    try {
      sentCount += await coupleReminders(cp, now);
    } catch (e) {
      console.error('reminders failed for couple', cp.id, String(e));
    }
  }
  await sql`delete from p4t.sent where created_at < now() - interval '400 days'`;
  await sql`delete from p4t.updates where created_at < now() - interval '3 days'`;
  await sql`delete from p4t.activity where day < (now() at time zone 'UTC')::date - 400`;
  await sql`delete from p4t.broadcast_recipients r using p4t.broadcasts b where b.id = r.broadcast_id and b.status in ('done', 'canceled') and b.finished_at < now() - interval '90 days'`;
  return sentCount;
}

type Msg = { text: string; kb?: ReturnType<typeof kb> };

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
        // Напоминание за N дней (по настройке пары) в выбранный час
        if (cp.remind_days.includes(days) && ln.hour >= cp.remind_hour && await claim(tx, cp.id, `r:${e.id}:${occ.date}:${days}`)) {
          const when = days === 0 ? 'Сегодня' : days === 1 ? 'Завтра' : untilText(days).replace(/^ч/, 'Ч');
          const t = e.event_time ? ` в ${String(e.event_time).slice(0, 5)}` : '';
          out.push({ text: `🔔 <b>${when}</b>${days > 1 ? ` (${fmtDate(occ.date, { wd: true })})` : t}: ${k.e} ${title}${yrs}${e.place ? `\n📍 ${esc(e.place)}` : ''}`, kb: open });
        }
        // За 2 часа до события со временем
        if (days === 0 && e.event_time) {
          const [h, m] = String(e.event_time).split(':').map(Number);
          const left = h * 60 + m - ln.minutes;
          if (left > 0 && left <= 120 && await claim(tx, cp.id, `t:${e.id}:${occ.date}`)) {
            out.push({ text: `⏰ Через ${left >= 60 ? `${Math.round(left / 60)} ч` : `${left} мин`}: ${k.e} ${title}${e.place ? `\n📍 ${esc(e.place)}` : ''}`, kb: open });
          }
        }
      }
      // На следующий день после свидания из «Хочу сходить» — спросить, отметить ли место посещённым
      if (e.wish_id && !e.yearly && addDays(e.event_date, 1) === ln.date && ln.hour >= cp.remind_hour) {
        const [w] = await tx`select id, title, done_at from p4t.wishes where id = ${e.wish_id}`;
        if (w && !w.done_at && await claim(tx, cp.id, `f:${e.id}`)) {
          out.push({
            text: `💭 Вчера было «${esc(e.title)}». Отметить «${esc(w.title)}» как посещённое?`,
            kb: kb([b('✅ Сходили', `wi:x:${w.id}`, 'success'), b('Оставить в списке', `wi:o:${w.id}`)]),
          });
        }
      }
      // Юбилеи отношений: каждые 100 дней
      if (e.kind === 'relationship' && ln.hour >= cp.remind_hour) {
        const n = daysBetween(e.event_date, ln.date);
        if (n > 0 && n % 100 === 0 && await claim(tx, cp.id, `m:${e.id}:${n}`)) {
          out.push({ text: `🎉 Сегодня вы вместе уже <b>${n} ${plural(n, 'день', 'дня', 'дней')}</b>! ❤️` });
        }
      }
    }
  });
  for (const m of out) await notifyAll(members, m.text, m.kb);
  return out.length;
}
