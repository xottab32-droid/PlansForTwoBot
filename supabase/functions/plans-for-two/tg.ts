// Тонкая обёртка над Telegram Bot API (fetch, без сторонних библиотек)

export type Btn = { text: string; callback_data?: string; url?: string; style?: 'primary' | 'success' | 'danger'; copy_text?: { text: string } };
export type Kb = { inline_keyboard: Btn[][] };
export type User = { id: number; first_name: string; last_name?: string; username?: string; is_bot?: boolean };
export type Message = {
  message_id: number; chat: { id: number; type: string }; from?: User; text?: string;
  widget?: unknown; reply_markup?: Kb;
};
export type Callback = { id: string; from: User; data?: string; message?: Message };
export type WidgetQuery = { id: string; from: User; chat?: { id: number; type: string }; message_id?: number; data: string };
export type Update = { update_id: number; message?: Message; callback_query?: Callback; widget_query?: WidgetQuery; my_chat_member?: unknown };

export class TgError extends Error {
  constructor(public method: string, public code: number, public description: string) {
    super(`Telegram ${method} failed: ${code} ${description}`);
  }
}

const token = () => Deno.env.get('PLANS_BOT_TOKEN') ?? '';

export async function api<T = any>(method: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new TgError(method, j?.error_code ?? res.status, j?.description ?? 'unknown');
  return j.result as T;
}

export const isNotModified = (e: unknown) => e instanceof TgError && /not modified/i.test(e.description);

export const b = (text: string, data: string, style?: Btn['style']): Btn => (style ? { text, callback_data: data, style } : { text, callback_data: data });
export const u = (text: string, url: string): Btn => ({ text, url });
export const kb = (...rows: (Btn | null | false | undefined)[][]): Kb => ({
  inline_keyboard: rows.map((r) => r.filter(Boolean) as Btn[]).filter((r) => r.length),
});

export const send = (chat_id: number, text: string, reply_markup?: unknown, extra: Record<string, unknown> = {}) =>
  api<Message>('sendMessage', { chat_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(reply_markup ? { reply_markup } : {}), ...extra });

export async function edit(chat_id: number, message_id: number, text: string, reply_markup?: Kb) {
  try {
    await api('editMessageText', { chat_id, message_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: reply_markup ?? { inline_keyboard: [] } });
    return true;
  } catch (e) {
    if (isNotModified(e)) return true;
    throw e;
  }
}

export async function del(chat_id: number, message_id: number) {
  try { await api('deleteMessage', { chat_id, message_id }); } catch { /* сообщение старше 48 ч или уже удалено */ }
}

export async function answerCb(callback_query_id: string, text?: string, show_alert = false) {
  try { await api('answerCallbackQuery', { callback_query_id, ...(text ? { text, show_alert } : {}) }); } catch (e) { console.error(String(e)); }
}

export const sendWidget = (chat_id: number, html: string, caption: string, chat_data: string, reply_markup?: Kb) =>
  api<Message>('sendWidget', { chat_id, html, caption, parse_mode: 'HTML', chat_data, allow_queries: true, ...(reply_markup ? { reply_markup } : {}) });

export async function answerWidget(widget_query_id: string, data: string) {
  try { await api('answerWidgetQuery', { widget_query_id, data }); } catch (e) { console.error(String(e)); }
}
