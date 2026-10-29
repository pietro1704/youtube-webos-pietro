import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pruneYouTubeAds, installInitialResponseRules, installYouTubeNetworkRules } from '../src/ublock/youtube.js';

const base = 'https://www.youtube.com/tv';
const promo = () => ({ feedNudgeRenderer: { title: { simpleText: 'Oferta' },
  primaryButton: { buttonRenderer: { navigationEndpoint: { urlEndpoint: { url: '/premiumlite' } } } } } });
const organic = () => ({ tileRenderer: { videoId: 'premium-review', title: 'YouTube Premium Lite: análise' } });
const payload = () => ({ contents: [promo(), organic(), { tvMastheadRenderer: {} }],
  auxiliaryUi: { messageRenderers: { upsellDialogRenderer: { isVisible: true } } } });

test('promotion structures are removed while ordinary videos and generic nudges retain identity', () => {
  const video = organic(), reminder = { feedNudgeRenderer: { title: 'Continue assistindo', navigationEndpoint: { watchEndpoint: { videoId: 'next' } } } };
  const data = payload(); data.contents.push(video, reminder);
  assert.equal(pruneYouTubeAds(data), data);
  assert.deepEqual(data.contents, [organic(), video, reminder]);
  assert.equal(data.contents[1], video); assert.equal(data.contents[2], reminder);
  assert.deepEqual(data.auxiliaryUi.messageRenderers, {});
});

test('text, unrelated external links, malformed nodes and cyclic objects are preserved', () => {
  const data = { contents: [null, 'Premium', { feedNudgeRenderer: { urlEndpoint: { url: 'https://example.com/premium' } } },
    { statementBannerRenderer: { title: 'Premium Lite', urlEndpoint: { url: '/watch?v=keep' } } }] };
  const before = structuredClone(data);
  assert.equal(pruneYouTubeAds(data), data); assert.deepEqual(data, before);
  data.loop = data; pruneYouTubeAds(data); assert.equal(data.loop, data);
});

test('initial and replacement responses respect adblock configuration', () => {
  let enabled = false;
  const original = payload(), win = { ytInitialData: original };
  installInitialResponseRules(win, () => enabled);
  assert.equal(win.ytInitialData, original); assert.equal(original.contents.length, 3);
  enabled = true;
  assert.deepEqual(win.ytInitialData.contents, [organic()]);
  const next = payload(); win.ytInitialData = next;
  assert.equal(win.ytInitialData, next); assert.deepEqual(next.contents, [organic()]);
  enabled = false;
  const disabled = payload(); win.ytInitialData = disabled;
  assert.equal(disabled.contents.length, 3);
});

test('browse fetch filters promotions and preserves response identity on disable, failure and cancellation', async () => {
  let enabled = true, response = new Response(JSON.stringify(payload()));
  const win = { location: { href: base }, Headers, Response,
    fetch: async (_url, init) => { if (init?.signal?.aborted) throw init.signal.reason; return response; } };
  installYouTubeNetworkRules(win, () => enabled);
  assert.deepEqual((await (await win.fetch('/youtubei/v1/browse')).json()).contents, [organic()]);
  enabled = false; assert.equal(await win.fetch('/youtubei/v1/browse'), response);
  enabled = true;
  response = new Response('unavailable', { status: 503 });
  assert.equal(await win.fetch('/youtubei/v1/browse'), response);
  response = new Response('{');
  assert.equal(await win.fetch('/youtubei/v1/browse'), response);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(win.fetch('/youtubei/v1/browse', { signal: controller.signal }), { name: 'AbortError' });
});
