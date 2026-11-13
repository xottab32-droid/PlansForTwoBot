// Надёжная обработка webhook: done/processing/retry вместо безусловного ack.
// Telegram повторяет запросы с не-2xx; один update нельзя выполнять параллельно.
import { db, writes } from './db.ts';

/** Сколько раз пробуем обработать один update, прежде чем сдаться */
export const MAX_UPDATE_ATTEMPTS = 3;
import type { Update } from './tg.ts';

export type UpdateResult = 'done' | 'duplicate' | 'retry' | 'failed';

export async function processUpdate(up: Update, handle: (update: Update) => Promise<unknown>): Promise<UpdateResult> {
  const sql = db();
  const [claimed] = await sql`
    insert into p4t.updates (update_id, status, claimed_at, attempts)
    values (${up.update_id}, 'processing', now(), 1)
    on conflict (update_id) do update
      set status = 'processing', claimed_at = now(), attempts = p4t.updates.attempts + 1
      where p4t.updates.status = 'retry'
         or (p4t.updates.status = 'processing' and p4t.updates.claimed_at < now() - interval '3 minutes')
    returning update_id, attempts`;
  if (!claimed) {
    const [row] = await sql`select status from p4t.updates where update_id = ${up.update_id}`;
    return row?.status === 'done' || row?.status === 'failed' ? 'duplicate' : 'retry';
  }

  const track = { wrote: false };
  try {
    await writes.run(track, () => handle(up));
    await sql`update p4t.updates set status = 'done', finished_at = now(), claimed_at = null
      where update_id = ${up.update_id} and status = 'processing'`;
    return 'done';
  } catch (e) {
    console.error(JSON.stringify({
      update_failed: up.update_id, error: String(e), stack: (e as Error)?.stack,
    }));
    // Повторять безопасно, только если данные пары ещё не менялись: иначе повтор задвоит
    // действие (пополнение, цель). Лимит попыток защищает от «ядовитых» updates.
    const giveUp = track.wrote || Number(claimed.attempts) >= MAX_UPDATE_ATTEMPTS;
    try {
      await sql`update p4t.updates set status = ${giveUp ? 'failed' : 'retry'}, claimed_at = null,
          finished_at = ${giveUp ? sql`now()` : null}
        where update_id = ${up.update_id} and status = 'processing'`;
    } catch (resetError) {
      // Сбой БД: просроченную блокировку освободит следующий запрос Telegram.
      console.error('update retry state failed', String(resetError));
    }
    return giveUp ? 'failed' : 'retry';
  }
}
