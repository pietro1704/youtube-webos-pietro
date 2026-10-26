import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterWatchedVideos, nativeWatchProgress, watchedPage } from '../src/watched/progress.js';
import { installWatchedNetworkFilter } from '../src/watched/network.js';
import { installYouTubeNetworkRules } from '../src/ublock/youtube.js';
const url = 'https://www.youtube.com/youtubei/v1/browse';
const item = (id, percent) => ({ tileRenderer: { contentId: id, title: { simpleText: 'Same title' }, header: { tileHeaderRenderer: { thumbnailOverlays: [{ thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: percent } }] } } } });
const fixture = () => ({ contents: [item('aaaaaaaaaaa', 90), item('bbbbbbbbbbb', 0), item('ccccccccccc', undefined)] });
function harness() {
  let account = 'A', on = true, data = fixture(), pending = null;
  const pref = { threshold: 80, pages: ['home', 'subscriptions'] }, requests = [], reports = [];
  class XHR extends EventTarget {
    open(method, resource) { this.method = method; this.resource = resource; this.readyState = 1; this.status = 0; }
    send(body) { this.body = body; this._data = JSON.parse(JSON.stringify(data)); this.readyState = 4; this.status = 200; }
    get responseText() { return JSON.stringify(this._data); }
    get response() { return this.responseType === 'json' ? this._data : this.responseText; }
    abort() { this.dispatchEvent(new Event('abort')); }
  }
  const win = { JSON, location: { href: 'https://www.youtube.com/tv' }, Headers, Response, XMLHttpRequest: XHR,
    fetch(resource, init) {
      const signal = init?.signal !== undefined ? init.signal : resource?.signal;
      if (signal?.aborted) return Promise.reject(signal.reason);
      requests.push([resource, init]);
      const response = new Response(typeof data === 'string' ? data : JSON.stringify(data), { headers: { 'x-native': 'kept', 'content-length': '123', 'content-encoding': 'gzip' } });
      Object.defineProperty(response, 'url', { value: typeof resource === 'string' ? new URL(resource, url).href : resource.url });
      win.last = response;
      return pending ? pending(response) : Promise.resolve(response);
    } };
  const native = win.fetch;
  // Exercise composition with the fork's existing XHR/fetch network wrappers.
  installYouTubeNetworkRules(win, () => false);
  const filter = installWatchedNetworkFilter(win, { enabled: () => on, identity: () => account, preferences: () => pref, report: event => reports.push(event) });
  return { win, XHR, filter, pref, requests, reports, native,
    account(value) { account = value; }, enabled(value) { on = value; }, data(value) { data = value; }, defer(fn) { pending = fn; } };
}
const browse = { method: 'POST', body: JSON.stringify({ browseId: 'FEwhat_to_watch' }) };
test('native zero/unknown progress survives; threshold uses exact video identity rather than title', () => {
  const data = fixture(); const zero = data.contents[1], unknown = data.contents[2];
  assert.equal(nativeWatchProgress(zero).percent, 0);
  assert.equal(filterWatchedVideos(data, 80).removed, 1); assert.deepEqual(data.contents, [zero, unknown]);
  assert.equal(filterWatchedVideos(data, 80).removed, 0);
});
test('lockup percent widths, invalid values and conflicting overlays are handled conservatively', () => {
  const lockup = { lockupViewModel: { contentId: 'ddddddddddd', contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { progressBar: { thumbnailOverlayProgressBarViewModel: { startPercent: 85 } } } }] } } } };
  assert.equal(nativeWatchProgress(lockup).percent, 85);
  for (const value of ['90', null, -1, 101]) assert.equal(nativeWatchProgress(item('aaaaaaaaaaa', value)), null);
  const conflict = item('aaaaaaaaaaa', 90); conflict.tileRenderer.thumbnailOverlays = [{ thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: 10 } }];
  assert.equal(nativeWatchProgress(conflict), null);
  const data = { contents: [lockup] }; assert.equal(filterWatchedVideos(data, 100).removed, 0);
});
test('bounded traversal never applies a partial deletion', () => {
  const data = fixture(), copy = JSON.stringify(data); assert.equal(filterWatchedVideos(data, 80, 2).limited, true); assert.equal(JSON.stringify(data), copy);
});
test('fetch filters actual body data while preserving response metadata and clone behavior', async () => {
  const h = harness(); const response = await h.win.fetch(url, browse);
  assert.notEqual(response, h.win.last); assert.equal(response.url, url); assert.equal(response.headers.get('x-native'), 'kept');
  assert.equal(response.headers.get('content-length'), null); assert.equal(response.headers.get('content-encoding'), null);
  const clone = response.clone(); assert.equal(clone.url, url); assert.equal((await clone.json()).contents.length, 2);
  assert.equal((await response.json()).contents[0].tileRenderer.contentId, 'bbbbbbbbbbb');
  assert.equal(h.requests[0][1], browse); h.filter.uninstall();
});
for (const reason of ['disabled', 'guest', 'page', 'malformed', 'unrelated', 'unknown-progress']) {
  test(`fetch preserves native response identity for ${reason}`, async () => {
    const h = harness(); let resource = url;
    if (reason === 'disabled') h.enabled(false);
    if (reason === 'guest') h.account(null);
    if (reason === 'page') h.pref.pages = ['search'];
    if (reason === 'malformed') h.data('{');
    if (reason === 'unrelated') resource = 'https://example.com/youtubei/v1/browse';
    if (reason === 'unknown-progress') h.data({ contents: [item('aaaaaaaaaaa', null)] });
    assert.equal(await h.win.fetch(resource, browse), h.win.last); h.filter.uninstall();
  });
}
for (const reason of ['account', 'disable', 'preferences', 'uninstall', 'return-to-account']) {
  test(`late fetch data stays native after ${reason}`, async () => {
    const h = harness(); let release;
    h.defer(response => new Promise(resolve => { release = () => resolve(response); }));
    const pending = h.win.fetch(url, browse);
    if (reason === 'account') h.account('B');
    if (reason === 'disable') h.enabled(false);
    if (reason === 'preferences') h.pref.threshold = 95;
    if (reason === 'uninstall') h.filter.uninstall();
    if (reason === 'return-to-account') { h.account('B'); h.filter.invalidate(); h.account('A'); }
    release(); assert.equal(await pending, h.win.last); h.filter.uninstall();
  });
}
test('Request bodies are cloned before native consumption and cancellation reasons remain exact', async () => {
  const h = harness();
  const request = new Request(url, browse);
  const response = await h.win.fetch(request); assert.equal(request.bodyUsed, false); assert.equal((await response.json()).contents.length, 2);
  const abort = new AbortController(); abort.abort(0);
  const reason = await h.win.fetch(new Request(url, { ...browse, signal: abort.signal })).catch(error => error);
  assert.equal(reason, 0); h.filter.uninstall();
});
test('network failure propagates rather than becoming an empty successful response', async () => {
  const h = harness(), error = new Error('offline'); h.defer(() => Promise.reject(error));
  await assert.rejects(h.win.fetch(url, browse), error); h.filter.uninstall();
});
test('continuations inherit only a previously confirmed page/account context', async () => {
  const h = harness(); h.data({ contents: [item('bbbbbbbbbbb', 0), { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next-page' } } } }] });
  await h.win.fetch(url, browse);
  h.data(fixture()); const next = { ...browse, body: JSON.stringify({ continuation: 'next-page' }) };
  assert.equal((await (await h.win.fetch(url, next)).json()).contents.length, 2);
  h.account('B'); assert.equal(await h.win.fetch(url, next), h.win.last);
  h.filter.uninstall();
});
test('XHR text/json compose with ad blocking, preserve disabled identity, abort and reuse', () => {
  const h = harness(), xhr = new h.win.XMLHttpRequest(); assert.ok(xhr instanceof h.XHR);
  xhr.open('POST', url); xhr.send(browse.body);
  assert.equal(JSON.parse(xhr.responseText).contents.length, 2);
  xhr.responseType = 'json'; assert.equal(xhr.response.contents.length, 2); assert.equal(xhr._data.contents.length, 3);
  h.enabled(false); assert.equal(xhr.response, xhr._data);
  h.enabled(true); xhr.open('POST', url); xhr.send(browse.body); xhr.abort(); assert.equal(xhr.response, xhr._data);
  xhr.open('POST', url); xhr.send(browse.body); assert.equal(xhr.response.contents.length, 2);
  h.account('B'); assert.equal(xhr.response, xhr._data);
  let tracked = false; const old = h.XHR.prototype.open;
  h.XHR.prototype.open = function () { tracked = true; return old.apply(this, arguments); };
  xhr.open('POST', url); assert.equal(tracked, true); h.filter.uninstall();
});

test('page classification covers native browse, search, watch and unknown routes', () => {
  for (const [browseId, expected] of [['FEwhat_to_watch', 'home'], ['FEsubscriptions', 'subscriptions'], ['FElibrary', 'library'], ['FEhistory', 'library'], ['FEmy_youtube', 'library'], ['UCchannel', 'channels'], ['FEunknown', null]]) {
    assert.equal(watchedPage(new URL(url), { browseId }), expected);
  }
  assert.equal(watchedPage(new URL(url.replace('browse', 'search')), {}), 'search');
  for (const endpoint of ['next', 'get_watch']) assert.equal(watchedPage(new URL(url.replace('browse', endpoint)), {}), 'watch');
});
test('wrapped and standard native cards obey inclusive threshold boundaries', () => {
  for (const kind of ['videoRenderer', 'compactVideoRenderer', 'tileRenderer']) {
    const renderer = { videoId: 'aaaaaaaaaaa', thumbnailOverlays: [{ thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: 80 } }] };
    const data = { contents: [{ richItemRenderer: { content: { [kind]: renderer } } }] };
    assert.equal(filterWatchedVideos(data, 81).removed, 0);
    assert.equal(filterWatchedVideos(data, 80).removed, 1);
  }
});
test('cancelling an in-flight fetch prevents a late successful response from being rewritten', async () => {
  const h = harness(), abort = new AbortController(); let release;
  h.defer(response => new Promise(resolve => { release = () => resolve(response); }));
  const pending = h.win.fetch(url, { ...browse, signal: abort.signal });
  abort.abort(); release();
  assert.equal(await pending, h.win.last); assert.equal(h.reports.length, 0); h.filter.uninstall();
});
for (const reason of ['error', 'timeout', 'http', 'malformed']) {
  test(`XHR preserves the native response for ${reason}`, () => {
    const h = harness(), xhr = new h.win.XMLHttpRequest();
    xhr.open('POST', url); xhr.send(browse.body); xhr.responseType = 'json';
    if (reason === 'http') xhr.status = 503;
    else if (reason === 'malformed') { xhr._data = '{'; xhr.responseType = ''; }
    else xhr.dispatchEvent(new Event(reason));
    assert.equal(xhr.response, reason === 'malformed' ? JSON.stringify('{') : xhr._data);
    assert.equal(h.reports.length, 0); h.filter.uninstall();
  });
}
