import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterAcceleratedAudio, installAudioFormatFilter } from '../src/speed/audio-formats.js';

const ac3 = { itag: 380, mimeType: 'audio/mp4; codecs="ac-3"' };
const ddplus = { itag: 328, mimeType: 'audio/mp4; codecs="ec-3"' };
const aac = { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"' };
const opus = { itag: 251, mimeType: 'audio/webm; codecs="opus"' };
const video = { itag: 401, mimeType: 'video/mp4; codecs="av01.0.13M.08"' };

test('2x replaces AC-3/DD+ offers with available AAC/Opus without changing video', () => {
  const streaming = { adaptiveFormats: [video, ac3, ddplus, aac, opus] };
  assert.equal(filterAcceleratedAudio(streaming, 2), true);
  assert.deepEqual(streaming.adaptiveFormats, [video, aac, opus]);
});

test('normal playback preserves the full original surround offer and identity', () => {
  const list = [video, ac3, ddplus, aac];
  const streaming = { adaptiveFormats: list };
  assert.equal(filterAcceleratedAudio(streaming, 1), false);
  assert.equal(streaming.adaptiveFormats, list);
  assert.deepEqual(list, [video, ac3, ddplus, aac]);
});

test('no compatible audio never empties the offer or changes muxed fallback', () => {
  const list = [video, ac3];
  const muxed = [{ mimeType: 'video/mp4; codecs="avc1, mp4a.40.2"' }];
  const streaming = { adaptiveFormats: list, formats: muxed };
  assert.equal(filterAcceleratedAudio(streaming, 2), false);
  assert.deepEqual(streaming.adaptiveFormats, [video, ac3]);
  assert.equal(streaming.formats, muxed);
});

test('early parse filters each offer without changing global codec capabilities', () => {
  let speed = 2;
  const win = { JSON: { parse: JSON.parse }, MediaSource: { isTypeSupported: () => true },
    HTMLMediaElement: function () {} };
  win.HTMLMediaElement.prototype.canPlayType = () => 'probably';
  const native = win.JSON.parse;
  const feature = installAudioFormatFilter(win, () => speed);
  const response = win.JSON.parse(JSON.stringify({ streamingData: { adaptiveFormats: [video, ac3, aac] } }));
  assert.deepEqual(response.streamingData.adaptiveFormats, [video, aac]);
  assert.equal(win.MediaSource.isTypeSupported(ac3.mimeType), true);
  assert.equal(win.MediaSource.isTypeSupported(aac.mimeType), true);
  assert.equal(win.HTMLMediaElement.prototype.canPlayType(ddplus.mimeType), 'probably');
  speed = 1;
  assert.equal(win.MediaSource.isTypeSupported(ac3.mimeType), true);
  assert.deepEqual(win.JSON.parse(JSON.stringify({ streamingData: { adaptiveFormats: [video, ac3, aac] } })).streamingData.adaptiveFormats, [video, ac3, aac]);
  speed = 2;
  const next = win.JSON.parse(JSON.stringify({ streamingData: { adaptiveFormats: [video, ac3] } }));
  assert.deepEqual(next.streamingData.adaptiveFormats, [video, ac3]);
  assert.equal(win.MediaSource.isTypeSupported(ac3.mimeType), true);
  feature.uninstall();
  assert.equal(win.JSON.parse, native);
});

test('already compatible offers preserve array identity and JSON revivers still run', () => {
  const list = [video, aac, opus];
  const streaming = { adaptiveFormats: list };
  filterAcceleratedAudio(streaming, 2);
  assert.equal(streaming.adaptiveFormats, list);
  const win = { JSON: { parse: JSON.parse } };
  const feature = installAudioFormatFilter(win, () => 2);
  assert.deepEqual(win.JSON.parse('{"keep":1,"drop":2}', (key, value) => key === 'drop' ? undefined : value), { keep: 1 });
  feature.uninstall();
});

function fetchWindow(fetch) {
  return { JSON: { parse: JSON.parse }, fetch, Response, Headers,
    location: { href: 'https://www.youtube.com/tv' } };
}

test('native Response.json receives filtered player audio with response metadata preserved', async () => {
  const original = new Response(JSON.stringify({ playerResponse: {
    streamingData: { adaptiveFormats: [video, ac3, aac, opus] }
  } }), { headers: { 'content-type': 'application/json', 'content-length': '1000' } });
  Object.defineProperty(original, 'url', { value: 'https://www.youtube.com/youtubei/v1/player' });
  let seen;
  const win = fetchWindow(function (...args) { seen = { args, receiver: this }; return Promise.resolve(original); });
  const feature = installAudioFormatFilter(win, () => 2);
  const options = { method: 'POST' };
  const result = await win.fetch('/youtubei/v1/player', options);
  assert.deepEqual(seen, { args: ['/youtubei/v1/player', options], receiver: win });
  assert.notEqual(result, original);
  assert.equal(original.bodyUsed, false);
  assert.equal(result.url, original.url);
  assert.equal(result.type, original.type);
  assert.equal(result.status, original.status);
  assert.equal(result.headers.get('content-length'), null);
  assert.equal(result.headers.get('content-type'), 'application/json');
  assert.deepEqual((await result.json()).playerResponse.streamingData.adaptiveFormats, [video, aac, opus]);
  feature.uninstall();
});

test('fetch preserves original response identity when disabled, unrelated, malformed or no alternative', async () => {
  await Promise.all([
    [1, '/youtubei/v1/player', { streamingData: { adaptiveFormats: [video, ac3, aac] } }],
    [2, 'https://example.com/player', { streamingData: { adaptiveFormats: [ac3, aac] } }],
    [2, '/unrelated', { streamingData: { adaptiveFormats: [ac3, aac] } }],
    [2, '/youtubei/v1/player', { streamingData: { adaptiveFormats: [video, ac3] } }],
    [2, '/youtubei/v1/player', { streamingData: { adaptiveFormats: [video, aac] } }],
    [2, '/youtubei/v1/player', '{malformed']
  ].map(async ([speed, url, body]) => {
    const original = new Response(typeof body === 'string' ? body : JSON.stringify(body));
    const win = fetchWindow(() => Promise.resolve(original));
    const feature = installAudioFormatFilter(win, () => speed);
    assert.equal(await win.fetch(url), original);
    assert.equal(original.bodyUsed, false);
    feature.uninstall();
  }));
});

test('fetch rejection and cancellation propagate unchanged', async () => {
  await Promise.all([new Error('offline'), new DOMException('cancelled', 'AbortError')].map(async failure => {
    const win = fetchWindow(() => Promise.reject(failure));
    const feature = installAudioFormatFilter(win, () => 2);
    await assert.rejects(win.fetch('/youtubei/v1/player'), error => error === failure);
    feature.uninstall();
  }));
});

test('disabling or uninstalling during fetch preserves the original response', async () => {
  await Promise.all([false, true].map(async uninstall => {
    let resolve;
    let speed = 2;
    const original = new Response(JSON.stringify({ streamingData: { adaptiveFormats: [ac3, aac] } }));
    const win = fetchWindow(() => new Promise(done => { resolve = done; }));
    const nativeFetch = win.fetch;
    const feature = installAudioFormatFilter(win, () => speed);
    const pending = win.fetch('/youtubei/v1/player');
    if (uninstall) feature.uninstall();
    else speed = 1;
    resolve(original);
    assert.equal(await pending, original);
    feature.uninstall();
    assert.equal(win.fetch, nativeFetch);
  }));
});

test('uninstall preserves later wrappers and makes retained hooks inert', async () => {
  const original = new Response(JSON.stringify({ streamingData: { adaptiveFormats: [ac3, aac] } }));
  const win = fetchWindow(() => Promise.resolve(original));
  const feature = installAudioFormatFilter(win, () => 2);
  const fetchHook = win.fetch;
  const parseHook = win.JSON.parse;
  const laterFetch = (...args) => fetchHook(...args);
  const laterParse = (...args) => parseHook(...args);
  win.fetch = laterFetch;
  win.JSON.parse = laterParse;
  feature.uninstall();
  assert.equal(win.fetch, laterFetch);
  assert.equal(win.JSON.parse, laterParse);
  assert.equal(await win.fetch('/youtubei/v1/player'), original);
  assert.deepEqual(win.JSON.parse(JSON.stringify({ streamingData: { adaptiveFormats: [ac3, aac] } })).streamingData.adaptiveFormats, [ac3, aac]);
});

test('unknown/unsupported audio remains eligible for graceful native fallback', () => {
  const win = { JSON: { parse: JSON.parse }, MediaSource: { isTypeSupported: () => true } };
  const feature = installAudioFormatFilter(win, () => 2);
  win.JSON.parse(JSON.stringify({ playerResponse: { streamingData: { adaptiveFormats: [video, ac3] } } }));
  assert.equal(win.MediaSource.isTypeSupported(ac3.mimeType), true);
  assert.equal(win.JSON.parse('null'), null);
  assert.throws(() => win.JSON.parse('{'), SyntaxError);
  feature.uninstall();
});
