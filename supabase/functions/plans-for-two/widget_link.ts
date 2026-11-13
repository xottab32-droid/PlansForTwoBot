import type { Ctx } from './core.ts';
import { db } from './db.ts';
import { send } from './tg.ts';

async function hexHash(value:string):Promise<string>{
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
/** This action is authorized by a real private Telegram update, not by a supplied Telegram ID. */
export async function attachWidgetDevice(c:Ctx, code:string) {
  if(!c.couple)return await send(c.chat,'Сначала создай пару или присоединись к ней через /addpart.');
  if(!/^[a-f0-9]{48}$/.test(code))return await send(c.chat,'Неверный код привязки Android.');
  const hash=await hexHash(code);
  const [row]=await db()`
    update p4t.widget_devices set tg_id=${c.u.tg_id},couple_id=${c.couple.id},linked_at=now(),
      expires_at=now()+interval '365 days'
    where code_hash=${hash} and linked_at is null and revoked_at is null and expires_at>now()
    returning tg_id`;
  if(!row)return await send(c.chat,'Код привязки недействителен или истёк. Создай новый в приложении.');
  return await send(c.chat,'✅ Android-виджет привязан к вашей паре. Вернись в приложение и нажми «Проверить привязку и обновить».');
}
export async function revokeWidgetDevices(c:Ctx) {
  const [row]=await db()`
    with revoked as (
      update p4t.widget_devices set revoked_at=now()
      where tg_id=${c.u.tg_id} and revoked_at is null
      returning 1
    ) select count(*)::int as n from revoked`;
  return await send(c.chat,'🔒 Привязанных Android-устройств отключено: '+Number(row.n)+'. Для повторного подключения используй приложение.');
}
