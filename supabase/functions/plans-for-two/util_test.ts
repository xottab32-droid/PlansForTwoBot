import { assertEquals } from 'jsr:@std/assert@1';
import { nextOccurrence, parseAmount, parseDate, parseTime, quickAmounts, inviteCode, normCode, untilText, occursInMonth, parseEmoji, plural } from './util.ts';

Deno.test('parseDate', () => {
  const t = '2026-11-12';
  assertEquals(parseDate('14.11', t), '2026-11-14');
  assertEquals(parseDate('10.11', t), '2027-11-10');
  assertEquals(parseDate('10.11', t, true), '2026-11-10');
  assertEquals(parseDate('20.11', t, true), '2025-11-20');
  assertEquals(parseDate('14 ноября', t), '2026-11-14');
  assertEquals(parseDate('3 мая 2020', t), '2020-05-03');
  assertEquals(parseDate('2026-12-31', t), '2026-12-31');
  assertEquals(parseDate('31.02', t), null);
  assertEquals(parseDate('29.02', t), '2028-02-29');
  assertEquals(parseDate('завтра', t), '2026-11-13');
  assertEquals(parseDate('5.6.26', t), '2026-06-05');
  assertEquals(parseDate('абв', t), null);
});
Deno.test('parseTime', () => {
  assertEquals(parseTime('19:30'), '19:30');
  assertEquals(parseTime('9'), '09:00');
  assertEquals(parseTime('1930'), '19:30');
  assertEquals(parseTime('25:00'), null);
});
Deno.test('parseAmount', () => {
  assertEquals(parseAmount('15000'), { amount: 15000, comment: '' });
  assertEquals(parseAmount('15 000 Отложил с зарплаты'), { amount: 15000, comment: 'Отложил с зарплаты' });
  assertEquals(parseAmount('15к'), { amount: 15000, comment: '' });
  assertEquals(parseAmount('1,5k на билеты'), { amount: 1500, comment: 'на билеты' });
  assertEquals(parseAmount('-500 вернули'), { amount: -500, comment: 'вернули' });
  assertEquals(parseAmount('500 к отпуску'), { amount: 500, comment: 'к отпуску' });
  assertEquals(parseAmount('2000₽ возврат за билеты'), { amount: 2000, comment: 'возврат за билеты' });
  assertEquals(parseAmount('0'), null);
  assertEquals(parseAmount('привет'), null);
});
Deno.test('nextOccurrence', () => {
  assertEquals(nextOccurrence('1995-03-10', true, '2026-11-12'), { date: '2027-03-10', years: 32 });
  assertEquals(nextOccurrence('2020-11-12', true, '2026-11-12'), { date: '2026-11-12', years: 6 });
  assertEquals(nextOccurrence('2000-02-29', true, '2026-11-12'), { date: '2027-02-28', years: 27 });
  assertEquals(nextOccurrence('2026-12-01', false, '2026-11-12'), { date: '2026-12-01', years: 0 });
  assertEquals(occursInMonth('2020-11-05', true, 2026, 11), '2026-11-05');
  assertEquals(occursInMonth('2027-11-05', true, 2026, 11), null);
});
Deno.test('misc', () => {
  assertEquals(plural(1, 'день', 'дня', 'дней'), 'день');
  assertEquals(plural(12, 'день', 'дня', 'дней'), 'дней');
  assertEquals(plural(22, 'день', 'дня', 'дней'), 'дня');
  const code = inviteCode();
  assertEquals(/^[A-Z2-9]{8}$/.test(code), true);
  assertEquals(normCode('abcd-efgh'), 'ABCDEFGH');
  assertEquals(quickAmounts(300000).length > 0, true);
  assertEquals(typeof untilText(3), 'string');
});

Deno.test('parseEmoji', () => {
  for (const e of ['🐶', '🏝', '✈️', '🇮🇹', '1️⃣', '👨‍👩‍👧', '👍🏽', ' 🎸 ']) assertEquals(parseEmoji(e), e.trim(), e);
  for (const e of ['', 'а', 'Машина', '🐶🐱', '🐶 кот', '123', '😀😀😀😀😀😀😀😀😀']) assertEquals(parseEmoji(e), null, e);
});
