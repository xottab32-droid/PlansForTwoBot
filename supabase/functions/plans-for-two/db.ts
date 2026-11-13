// Прямое подключение к Postgres (схема p4t не публикуется через Data API).
// Все операции с данными пары выполняются через inCouple(): внутри транзакции включается роль p4t_app
// без BYPASSRLS и выставляется p4t.couple — RLS не даст прочитать или изменить чужие записи,
// даже если в коде будет ошибка в фильтре.
import postgres from 'npm:postgres@3.4.5';
import { AsyncLocalStorage } from 'node:async_hooks';

/** Отмечает, что при обработке текущего update уже закоммичены изменения данных пары (для решения «можно ли повторить»). */
export const writes = new AsyncLocalStorage<{ wrote: boolean }>();

// deno-lint-ignore no-explicit-any
export type Q = any;
let _sql: ReturnType<typeof postgres> | null = null;

export function db(): Q {
  if (!_sql) {
    const url = Deno.env.get('SUPABASE_DB_URL');
    if (!url) throw new Error('SUPABASE_DB_URL is not set');
    _sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
  }
  return _sql;
}

export async function closeDb() {
  if (_sql) { await _sql.end({ timeout: 1 }); _sql = null; }
}

/** userId — кто действует (p4t.me()): от него зависят права на желания и тайные отметки дарителя. */
export async function inCouple<T>(coupleId: string, fn: (tx: Q) => Promise<T>, userId?: number): Promise<T> {
  if (!coupleId) throw new Error('no couple');
  let wrote = false;
  const res = await db().begin(async (tx: Q) => {
    await tx`select set_config('p4t.couple', ${coupleId}, true), set_config('p4t.user', ${userId ? String(userId) : ''}, true)`;
    await tx`set local role p4t_app`;
    const r = await fn(tx);
    // id транзакции назначается только при записи — так узнаём, что что-то изменилось
    const [w] = await tx`select pg_current_xact_id_if_assigned() is not null as w`;
    wrote = !!w?.w;
    return r;
  }) as T;
  if (wrote) { const st = writes.getStore(); if (st) st.wrote = true; }
  return res;
}

export const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
export const iso = (v: unknown): string => {
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
  }
  return String(v).slice(0, 10);
};
