import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pruneYouTubeAds, rewriteYouTubeResponse, shouldBlockRequest,
  installYouTubeNetworkRules, installInitialResponseRules } from '../src/ublock/youtube.js';

const base = 'https://www.youtube.com/tv';
test('official prune paths apply to small, nested player and Shorts responses', () => {
  const entry = { command: { reelWatchEndpoint: { adClientParams: { isAd: true } } } };
  const organic = { command: { reelWatchEndpoint: { videoId: 'organic' } } };
  const data = { adPlacements: [1], playerAds: [1], adSlots: [1],
    playerResponse: { adSlots: [2], streamingData: { formats: [1] } },
    entries: [entry, organic], reelWatchSequenceResponse: { entries: [entry, organic] } };
  assert.equal(pruneYouTubeAds(data), data);
  assert.deepEqual(data, { playerResponse: { streamingData: { formats: [1] } },
    entries: [organic], reelWatchSequenceResponse: { entries: [organic] } });
});
test('ordinary response identity survives and malformed response text is unchanged', () => {
  const data = { streamingData: { formats: [1] } };
  assert.equal(pruneYouTubeAds(data), data);
  assert.equal(rewriteYouTubeResponse('{', '/youtubei/v1/reel_watch_sequence', base), '{');
});
test('official player replacements are restricted to YouTube response URLs', () => {
  const text = '{"adPlacements":[1],"adSlots":[2],"streamingData":{}}';
  assert.equal(rewriteYouTubeResponse(text, '/youtubei/v1/player?key=x', base),
    '{"no_ads":[1],"no_ads":[2],"streamingData":{}}');
  assert.equal(rewriteYouTubeResponse(text, 'https://notyoutube.com/player', base), text);
  assert.equal(rewriteYouTubeResponse(text, '/youtubei/v1/browse', base), text);
});
test('TVHTML5 advertising initplayback rule never blocks ordinary media', () => {
  assert.equal(shouldBlockRequest('https://r1.googlevideo.com/initplayback?source=youtube&c=TVHTML5&oad=1', base), true);
  assert.equal(shouldBlockRequest('https://r1.googlevideo.com/videoplayback?source=youtube&c=TVHTML5&oad=1', base), false);
  assert.equal(shouldBlockRequest('https://r1.googlevideo.com/initplayback?source=youtube&c=TVHTML5', base), false);
  assert.equal(shouldBlockRequest('https://googlevideo.com.evil.test/initplayback?source=youtube&c=TVHTML5&oad=1', base), false);
});
test('fetch rewrites actual response.json while preserving metadata and disabled identity', async () => {
  let enabled = true;
  let calls = 0;
  const response = new Response('{"adSlots":[1],"streamingData":{"formats":[1]}}');
  Object.defineProperty(response, 'url', { value: 'https://www.youtube.com/youtubei/v1/player' });
  const win = { location: { href: base }, Headers, Response, DOMException,
    fetch: async () => { calls++; return response; } };
  installYouTubeNetworkRules(win, () => enabled);
  const changed = await win.fetch('/youtubei/v1/player');
  assert.deepEqual(await changed.json(), { no_ads: [1], streamingData: { formats: [1] } });
  assert.equal(changed.url, response.url);
  enabled = false;
  assert.equal(await win.fetch('/youtubei/v1/player'), response);
  assert.equal(calls, 2);
});
test('fetch rejects blocked requests and preserves cancellation/failure', async () => {
  let calls = 0;
  const error = new Error('offline');
  const win = { location: { href: base }, Headers, Response, DOMException,
    fetch: (resource, init) => {
      const signal = init && 'signal' in init ? init.signal : resource && resource.signal;
      if (signal && signal.aborted) return Promise.reject(signal.reason);
      calls++;
      return Promise.reject(error);
    } };
  installYouTubeNetworkRules(win, () => true);
  await assert.rejects(win.fetch('https://r1.googlevideo.com/initplayback?source=youtube&c=TVHTML5&oad=1'), TypeError);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(win.fetch('/youtubei/v1/player', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
  await assert.rejects(win.fetch('/youtubei/v1/player'), error);
});
test('fetch honors Request.signal and preserves a falsy native abort reason', async () => {
  const win = { location: { href: base }, Headers, Response, DOMException, fetch };
  installYouTubeNetworkRules(win, () => true);
  const controller = new AbortController();
  controller.abort();
  const request = new Request('https://r1.googlevideo.com/initplayback?source=youtube&c=TVHTML5&oad=1', { signal: controller.signal });
  await assert.rejects(win.fetch(request), { name: 'AbortError' });
  await assert.rejects(win.fetch(request, { signal: undefined }), { name: 'AbortError' });
  const custom = new AbortController();
  custom.abort(0);
  const native = await fetch('https://example.com/', { signal: custom.signal }).catch(error => error);
  const adapted = await win.fetch('https://example.com/', { signal: custom.signal }).catch(error => error);
  assert.equal(adapted, native);
});
test('XHR text and JSON paths remove ads without altering unrelated JSON requests', () => {
  class XHR {
    open(method, url) { this.url = url; }
    send(body) { this.body = body; }
    get responseText() { return '{"adSlots":[1]}'; }
    get response() { return this.responseType === 'json' ? { adSlots: [1], content: 1 } : this.responseText; }
  }
  const win = { location: { href: base }, XMLHttpRequest: XHR };
  installYouTubeNetworkRules(win, () => true);
  const xhr = new win.XMLHttpRequest();
  xhr.open('POST', '/youtubei/v1/player');
  assert.equal(xhr.responseText, '{"no_ads":[1]}');
  xhr.responseType = 'json';
  assert.deepEqual(xhr.response, { content: 1 });
  xhr.open('GET', 'https://example.com/data');
  assert.deepEqual(xhr.response, { adSlots: [1], content: 1 });
});
test('late initial-player assignments also have their ads removed', () => {
  const win = {};
  installInitialResponseRules(win, () => true);
  win.ytInitialPlayerResponse = { adSlots: [1], streamingData: {} };
  assert.deepEqual(win.ytInitialPlayerResponse, { streamingData: {} });
});
test('existing XHR instances follow prototype tracking enable and disable', () => {
  const opened = [];
  class XHR {
    open(method, url) { opened.push(url); }
    send() {}
  }
  const win = { location: { href: base }, XMLHttpRequest: XHR };
  installYouTubeNetworkRules(win, () => true);
  const before = new win.XMLHttpRequest();
  const nativeOpen = XHR.prototype.open;
  XHR.prototype.open = function (method, url) {
    return nativeOpen.call(this, method, url.includes('/log_event') ? 'data:,' : url);
  };
  const during = new win.XMLHttpRequest();
  before.open('POST', '/youtubei/v1/log_event');
  assert.equal(opened.pop(), 'data:,');
  XHR.prototype.open = nativeOpen;
  during.open('POST', '/youtubei/v1/log_event');
  assert.equal(opened.pop(), '/youtubei/v1/log_event');
});
