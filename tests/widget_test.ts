import { assert } from 'jsr:@std/assert@1.0.19';
import { GIFT_HTML, HOME_HTML } from '../supabase/functions/plans-for-two/widgets.ts';

Deno.test('gift widget has valid JavaScript and all interactive actions', () => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(GIFT_HTML)?.[1];
  assert(script, 'widget script exists');
  // Parses without running the Telegram runtime.
  new Function(script);
  for (const action of ['gw', 'ga', 'gs:', 'gb:', 'gx:', 'go:', 'gl:']) {
    assert(script.includes(action), 'missing widget action: ' + action);
  }
  assert(GIFT_HTML.includes('textContent'), 'user-provided text must use textContent');
  assert(GIFT_HTML.includes('Подобрать по бюджету'), 'budget controls missing');
  assert(HOME_HTML.includes('o:p'), 'home widget gift navigation missing');
});

Deno.test('gift widget HTML is within Telegram 4096-byte compressed limit', async () => {
  const stream = new Blob([GIFT_HTML]).stream().pipeThrough(new CompressionStream('deflate'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  assert(bytes.length <= 4096, `compressed widget exceeds limit: ${bytes.length} bytes`);
});


Deno.test('gift widget UI: partner tabs, budget selection, random button and secret marks', async () => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(GIFT_HTML)?.[1];
  assert(script);
  const requests: string[] = [];
  const mine: [number, string, string, string][] = [[1, '🎧', 'Моё желание', '1500 ₽']];
  const partnerGift: [number, string, string, string, number] = [2, '🎁', 'Желание партнёра', '12000 ₽', 0];
  const state = { m: ['', 1, mine], p: ['', 1, [partnerGift]], b: 'Другой', q: [5000, 15000, 30000], cc: '₽', f: 0 };
  type E = { tag: string; textContent: string; children: E[]; className: string; style: Record<string, string>;
    onclick?: (event?: { stopPropagation(): void }) => void; appendChild(node: E): E };
  function element(tag: string): E {
    let value = '';
    const e = { tag, children: [] as E[], className: '', style: {}, onclick: undefined,
      appendChild(child: E) { this.children.push(child); return child; },
      get textContent() { return value; },
      set textContent(next: string) { value = next; if (next === '') this.children = []; },
    };
    return e as E;
  }
  const root = element('div');
  const document = { getElementById: () => root, createElement: element };
  const widget = {
    chatData: JSON.stringify(state),
    request: async (data: string) => {
      requests.push(data);
      if (data === 'gb:15000') return { result: JSON.stringify({ ...state, f: 15000 }) };
      return { result: JSON.stringify(state) };
    },
    HapticFeedback: { impactOccurred: () => {} },
    ready: () => {},
    onEvent: () => {},
  };
  new Function('window', 'document', script)({ TelegramWidget: widget }, document);
  const find = (text: string, node: E = root): E | undefined =>
    node.textContent.includes(text) ? node : node.children.map((child) => find(text, child)).find(Boolean);
  await Promise.resolve();
  const partnerTab = find('💞 Другой');
  assert(partnerTab?.onclick, 'partner tab must be clickable');
  partnerTab.onclick();
  const budget = find('до 15к₽');
  assert(budget?.onclick, 'budget button must be clickable');
  budget.onclick();
  await Promise.resolve();
  assert(requests.includes('gb:15000'), 'budget filter must query the bot');
  await Promise.resolve();
  const pick = find('🎲 Случайный');
  assert(pick?.onclick, 'random picker must be clickable');
  pick.onclick();
  assert(requests.includes('gx:15000'), 'random picker must pass active budget');
  const back = find('🙋 Мои');
  assert(back?.onclick, 'own tab must remain clickable');
  back.onclick();
  const ownText = JSON.stringify(root, (key, value) => key === 'onclick' ? undefined : value);
  assert(!ownText.includes('🤫 выбрал') && !ownText.includes('🛍 купил'), 'giver states must never render on own tab');
});
