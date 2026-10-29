import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeAudioRoute } from '../src/speed/native-audio-route.js';
import { audioConfigFromInit, demuxFragments, parseInitInfo } from '../src/speed/containers.js';
import { silentAacBase64 } from '../src/speed/silent-aac.js';

function harness() {
  const errors = [], revoked = [], appended = [], timers = new Map();
  let resolvePlay, rejectPlay, endCalls = 0;
  const sb = Object.assign(new EventTarget(), { appendBuffer(bytes) { appended.push(bytes); } });
  const mediaSource = Object.assign(new EventTarget(), {
    addSourceBuffer(mime) { assert.equal(mime, 'audio/mp4; codecs="mp4a.40.2"'); return sb; },
    endOfStream() { endCalls++; }
  });
  const element = Object.assign(new EventTarget(), { paused: true,
    setAttribute() {}, removeAttribute(name) { delete this[name]; },
    play() { this.paused = false; return new Promise((resolve, reject) => { resolvePlay = resolve; rejectPlay = reject; }); },
    pause() { this.paused = true; }, load() { this.loaded = true; }, remove() { this.connected = false; }
  });
  const win = { atob, URL: { revokeObjectURL(url) { revoked.push(url); } },
    setTimeout(fn) { timers.set(1, fn); return 1; }, clearTimeout(id) { timers.delete(id); },
    document: { createElement: () => element, body: { appendChild(el) { el.connected = true; } } }
  };
  const route = createNativeAudioRoute({ win,
    createNativeAudioSource: () => ({ mediaSource, url: 'blob:owned-route' }), onError: e => errors.push(e) });
  return { route, errors, revoked, appended, timers, sb, mediaSource, element, endCalls: () => endCalls,
    ready() { mediaSource.dispatchEvent(new Event('sourceopen')); sb.dispatchEvent(new Event('updateend')); resolvePlay(); },
    reject() { rejectPlay(new Error('autoplay rejected')); }
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('native route appends a bounded stereo AAC carrier and keeps its decoder open by looping', async () => {
  const h = harness(); h.ready(); await settle();
  assert.equal(h.appended.length, 1);
  assert.equal(h.endCalls(), 1);
  assert.equal(h.element.loop, true);
  assert.equal(h.element.paused, false);
  assert.equal(h.element.connected, true);
  assert.equal(h.timers.size, 0);
  h.mediaSource.dispatchEvent(new Event('sourceopen'));
  assert.equal(h.appended.length, 1, 'looping must not append another copy');
  assert.deepEqual(h.errors, []);
  h.route.destroy();
});

test('carrier asset is actual stereo 48kHz AAC with a short bounded media timeline', () => {
  const bytes = new Uint8Array(Buffer.from(silentAacBase64, 'base64'));
  const cfg = audioConfigFromInit(bytes);
  assert.equal(cfg.codec, 'mp4a.40.2');
  assert.equal(cfg.numberOfChannels, 2);
  assert.equal(cfg.sampleRate, 48000);
  const fragments = demuxFragments(bytes, parseInitInfo(bytes)).samples;
  assert.ok(fragments.length > 0);
  const last = fragments[fragments.length - 1];
  assert.ok(last.pts + last.duration > 1.9 && last.pts + last.duration < 2.2);
});

for (const action of ['reject', 'media-error', 'append-error', 'timeout']) {
  test(`native route ${action} reports failure once and releases all owned resources`, async () => {
    const h = harness();
    if (action === 'reject') h.reject();
    if (action === 'media-error') h.element.dispatchEvent(new Event('error'));
    if (action === 'append-error') { h.mediaSource.dispatchEvent(new Event('sourceopen')); h.sb.dispatchEvent(new Event('error')); }
    if (action === 'timeout') h.timers.get(1)();
    await settle();
    h.element.dispatchEvent(new Event('error'));
    assert.equal(h.errors.length, 1);
    assert.equal(h.element.paused, true);
    assert.equal(h.element.connected, false);
    assert.equal(h.element.src, undefined);
    assert.equal(h.element.loaded, true);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.revoked, ['blob:owned-route']);
    h.route.destroy();
    assert.equal(h.revoked.length, 1);
  });
}

test('cancelled startup cannot append or report an old failure against the replacement route', async () => {
  const old = harness(), next = harness();
  old.route.destroy();
  old.mediaSource.dispatchEvent(new Event('sourceopen')); old.sb.dispatchEvent(new Event('updateend')); old.reject();
  next.ready(); await settle();
  assert.equal(old.appended.length, 0);
  assert.equal(old.endCalls(), 0);
  assert.deepEqual(old.errors, []);
  assert.equal(next.element.connected, true);
  assert.equal(next.element.paused, false);
  next.route.destroy();
});
