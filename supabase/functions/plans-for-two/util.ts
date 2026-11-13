// Чистые функции: даты, суммы, форматирование. Покрыты тестами (util_test.ts).

export const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const toUtc = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (t: number) => { const x = new Date(t); return isoOf(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); };
export const addDays = (iso: string, n: number) => fromUtc(toUtc(iso) + n * 86400000);
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86400000);
/** 0 = понедельник */
export const weekday = (iso: string) => (new Date(toUtc(iso)).getUTCDay() + 6) % 7;
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function validDate(y: number, m: number, d: number) {
  return Number.isInteger(y) && y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** Дата годовщины в конкретном году (29 февраля → 28 февраля в невисокосный год) */
export function inYear(iso: string, y: number) {
  const [, m, d] = iso.split('-').map(Number);
  return isoOf(y, m, m === 2 && d === 29 && !leap(y) ? 28 : d);
}

/** Ближайшее наступление события начиная с today. years — сколько лет исполняется (для ежегодных) */
export function nextOccurrence(eventDate: string, yearly: boolean, today: string) {
  if (!yearly) return { date: eventDate, years: 0 };
  const y0 = Number(eventDate.slice(0, 4)), ty = Number(today.slice(0, 4));
  let y = Math.max(ty, y0);
  let occ = inYear(eventDate, y);
  if (occ < today) { y += 1; occ = inYear(eventDate, y); }
  return { date: occ, years: y - y0 };
}

/** Наступления события в заданном месяце */
export function occursInMonth(eventDate: string, yearly: boolean, y: number, m: number): string | null {
  if (!yearly) return eventDate.startsWith(`${y}-${pad(m)}-`) ? eventDate : null;
  if (Number(eventDate.slice(5, 7)) !== m || y < Number(eventDate.slice(0, 4))) return null;
  return inYear(eventDate, y);
}

const MONTH_WORDS: [RegExp, number][] = [
  [/^янв/, 1], [/^фев/, 2], [/^мар/, 3], [/^апр/, 4], [/^ма[йя]/, 5], [/^июн/, 6],
  [/^июл/, 7], [/^авг/, 8], [/^сен/, 9], [/^окт/, 10], [/^ноя/, 11], [/^дек/, 12],
];

/**
 * Разбор даты: 14.11, 14.11.2026, 14.11.26, 2026-11-14, 14 ноября, 14 ноя 2026, сегодня, завтра, послезавтра.
 * Без года: ближайшая будущая (или сегодняшняя) дата, если preferPast=false.
 */
export function parseDate(input: string, today: string, preferPast = false): string | null {
  const s = input.trim().toLowerCase().replace(/ё/g, 'е');
  if (s === 'сегодня') return today;
  if (s === 'завтра') return addDays(today, 1);
  if (s === 'послезавтра') return addDays(today, 2);
  let y: number | null = null, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (r) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?$/.exec(s))) {
    d = +r[1]; m = +r[2];
    if (r[3]) y = r[3].length === 2 ? 2000 + +r[3] : +r[3];
  } else if ((r = /^(\d{1,2})\s+([а-я]+)\.?(?:\s+(\d{4}))?(?:\s*г\.?)?$/.exec(s))) {
    d = +r[1];
    const mw = MONTH_WORDS.find(([re]) => re.test(r![2]));
    if (!mw) return null;
    m = mw[1];
    if (r[3]) y = +r[3];
  } else return null;
  const ty = Number(today.slice(0, 4));
  if (y === null) {
    y = ty;
    if (!validDate(y, m, d) && !(m === 2 && d === 29)) return null;
    if (m === 2 && d === 29) { while (!leap(y)) y += preferPast ? -1 : 1; }
    const iso = isoOf(y, m, d);
    if (!preferPast && iso < today) { y += 1; while (m === 2 && d === 29 && !leap(y)) y++; }
    if (preferPast && iso > today) { y -= 1; while (m === 2 && d === 29 && !leap(y)) y--; }
  }
  return validDate(y, m, d) ? isoOf(y, m, d) : null;
}

/** Время: 19:30, 19.30, 19 30, 1930, 19 */
export function parseTime(input: string): string | null {
  const s = input.trim();
  const r = /^(\d{1,2})(?:[:.\s]?(\d{2}))?$/.exec(s);
  if (!r) return null;
  const h = +r[1], mi = r[2] ? +r[2] : 0;
  if (h > 23 || mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}

/** Сумма + необязательный комментарий: «15000», «15 000 С зарплаты», «15к», «1,5k», «+2000», «-500 вернули» */
export function parseAmount(input: string): { amount: number; comment: string } | null {
  const s = input.trim().replace(/\u00a0|\u202f/g, ' ');
  const r = /^([+-]?)\s*(\d{1,3}(?:[ ]\d{3})+|\d+)(?:[.,](\d{1,2}))?(к|k|тыс\.?|т)?(?:\s*(?:₽|руб\.?|р\.?|€|\$|eur|usd|byn|br))?(?=\s|$)\s*(.*)$/i.exec(s);
  if (!r) return null;
  let n = Number(r[2].replace(/ /g, '') + (r[3] ? '.' + r[3] : ''));
  if (r[4]) n *= 1000;
  n = Math.round(n * 100) / 100;
  if (!Number.isFinite(n) || n <= 0 || n >= 1e11) return null;
  return { amount: r[1] === '-' ? -n : n, comment: r[5].trim().slice(0, 200) };
}

export function fmtNum(n: number) {
  const neg = n < 0, a = Math.abs(n);
  const int = Math.floor(a), frac = Math.round((a - int) * 100);
  const s = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
  return (neg ? '−' : '') + s + (frac ? ',' + pad(frac) : '');
}
export const fmtMoney = (n: number, cur: string) => `${fmtNum(n)}\u00a0${cur}`;
/** Короткая форма для виджетов: 1,2 млн / 350 тыс */
export function fmtShort(n: number) {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',').replace(',0', '') + ' млн';
  if (a >= 1e4) return Math.round(n / 1e3) + ' тыс';
  return fmtNum(Math.round(n));
}

export function fmtDate(iso: string, opts: { year?: boolean; wd?: boolean } = {}) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${opts.wd ? WD[weekday(iso)] + ', ' : ''}${d} ${MONTHS_GEN[m - 1]}${opts.year ? ' ' + y : ''}`;
}
export const fmtShortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}`;

export function untilText(days: number) {
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  if (days === 2) return 'послезавтра';
  if (days > 0) return `через ${days} ${plural(days, 'день', 'дня', 'дней')}`;
  const a = -days;
  return a === 1 ? 'вчера' : `${a} ${plural(a, 'день', 'дня', 'дней')} назад`;
}
export const yearsText = (n: number) => `${n} ${plural(n, 'год', 'года', 'лет')}`;

export function bar(pct: number, len = 10) {
  const f = Math.max(0, Math.min(len, Math.round((pct / 100) * len)));
  return '▰'.repeat(f) + '▱'.repeat(len - f);
}
export const pctOf = (saved: number, target: number) => target > 0 ? Math.max(0, Math.floor((saved / target) * 100)) : 0;

/** Текущая дата/время в часовом поясе пары */
export function localNow(tz: string, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24, minute = Number(p.minute);
  return { date: `${p.year}-${p.month}-${p.day}`, hour, minute, minutes: hour * 60 + minute };
}

/** Ровно одно эмодзи (включая флаги, 1️⃣ и составные 👨‍👩‍👧). null — если это не эмодзи */
export function parseEmoji(input: string): string | null {
  const t = input.trim();
  if (!t || [...t].length > 8) return null;
  const g = [...new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(t)];
  if (g.length !== 1) return null;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(t) ? t : null;
}
export const utf8len = (s: string) => new TextEncoder().encode(s).length;
/** JSON для виджета не длиннее 1000 байт: по очереди укорачиваем списки */
// deno-lint-ignore no-explicit-any
export function fitJson(o: any, shrink: (() => boolean)[]): string {
  let s = JSON.stringify(o);
  for (const f of shrink) { while (utf8len(s) > 1000 && f()) s = JSON.stringify(o); }
  return s;
}
export const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Красивые суммы быстрых пополнений, исходя из цели */
export function quickAmounts(target: number): number[] {
  const nice = (x: number) => {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1))));
    const k = x / p;
    return (k < 1.5 ? 1 : k < 3.5 ? 2 : k < 7.5 ? 5 : 10) * p;
  };
  const set = [...new Set([nice(target * 0.01), nice(target * 0.05), nice(target * 0.1)])].filter((x) => x >= 1);
  return set.length ? set : [100, 500, 1000];
}

const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function inviteCode() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => ALPH[x % ALPH.length]).join('');
}
export const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const showCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;
export const randomHex = (n = 32) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
