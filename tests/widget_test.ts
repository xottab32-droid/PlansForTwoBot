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
