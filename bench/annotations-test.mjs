import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installYouTubeNetworkRules, installInitialResponseRules } from '../src/ublock/youtube.js';
const base = 'https://www.youtube.com/tv';
const payload = () => ({
  annotations: [{ playerAnnotationsExpandedRenderer: { annotationId: 'channel-logo',
    featuredChannel: { watermark: { thumbnails: [{ url: 'logo.png' }] } } } }],
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'pt' }] } },
  videoDetails: { videoId: 'correct-video' },
  endscreen: { endscreenRenderer: {} }, streamingData: { formats: [{ itag: 18 }] }, adSlots: [1]
});

test('annotations filter works with adblock off and preserves captions, identity, media and endcards', async () => {
  const win = { location: { href: base }, Headers, Response,
    fetch: async () => new Response(JSON.stringify(payload())) };
  installYouTubeNetworkRules(win, () => false, () => true);
  const response = await win.fetch('/youtubei/v1/player');
  const data = await response.json();
  assert.equal(data.annotations, undefined);
  const expected = payload(); delete expected.annotations;
  assert.deepEqual(data, expected);
});

test('initial response replacement and disabling annotations preserve the configured behavior', () => {
  let hide = true;
  const win = {};
  installInitialResponseRules(win, () => false, () => hide);
  const first = payload(); win.ytInitialPlayerResponse = first;
  assert.equal(win.ytInitialPlayerResponse, first); assert.equal(first.annotations, undefined);
  hide = false;
  const second = payload(); win.ytInitialPlayerResponse = second;
  assert.equal(win.ytInitialPlayerResponse, second); assert.equal(second.annotations.length, 1);
});

test('unrelated URLs, malformed responses and late disabled results are unchanged', async () => {
  let hide = true, resolve;
  const original = new Response(JSON.stringify(payload()));
  const win = { location: { href: base }, Headers, Response,
    fetch: () => new Promise(done => { resolve = done; }) };
  installYouTubeNetworkRules(win, () => false, () => hide);
  const pending = win.fetch('/youtubei/v1/player');
  hide = false; resolve(original); assert.equal(await pending, original);
  hide = true;
  const external = win.fetch('https://example.com/player'); resolve(original);
  assert.equal(await external, original);
  const malformed = new Response('{'), invalid = win.fetch('/youtubei/v1/player');
  resolve(malformed); assert.equal(await invalid, malformed);
});

test('player network failure and cancellation retain their original errors', async () => {
  const offline = new Error('offline');
  const win = { location: { href: base }, Headers, Response,
    fetch: async (_resource, init) => { throw init?.signal?.aborted ? init.signal.reason : offline; } };
  installYouTubeNetworkRules(win, () => false, () => true);
  await assert.rejects(win.fetch('/youtubei/v1/player'), error => error === offline);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(win.fetch('/youtubei/v1/player', { signal: controller.signal }), { name: 'AbortError' });
});

test('XHR text and JSON responses obey the annotation toggle independently of ads', () => {
  let hide = true;
  class XHR {
    open() {}
    send() {}
    get responseText() { return JSON.stringify(payload()); }
    get response() { return this.responseType === 'json' ? payload() : this.responseText; }
  }
  const win = { location: { href: base }, XMLHttpRequest: XHR };
  installYouTubeNetworkRules(win, () => false, () => hide);
  const xhr = new win.XMLHttpRequest(); xhr.open('POST', '/youtubei/v1/player');
  assert.equal(JSON.parse(xhr.responseText).annotations, undefined);
  xhr.responseType = 'json';
  assert.equal(xhr.response.annotations, undefined);
  assert.deepEqual(xhr.response.adSlots, [1]);
  hide = false;
  assert.equal(xhr.response.annotations.length, 1);
  hide = true; xhr.open('GET', 'https://example.com/player');
  assert.equal(xhr.response.annotations.length, 1);
});
