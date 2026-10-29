import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AudioEngine } from '../src/speed/audio-engine.js';

function harness({ rejectPlay = false, streamSupported = true, throwStream = false, nativeRoute = false } = {}) {
  const errors = [], connections = [], elements = [];
  let rejectPending;
  const revoked = [], nativeBytes = [];
  const nativeBuffer = Object.assign(new EventTarget(), { appendBuffer(bytes) { nativeBytes.push(bytes); this.dispatchEvent(new Event('updateend')); } });
  const nativeSource = Object.assign(new EventTarget(), { addSourceBuffer: () => nativeBuffer, endOfStream() {} });
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  const destination = { stream };
  const gain = { gain: { value: 1 }, connect(node) { connections.push(node); }, disconnect() { connections.length = 0; } };
  const ctx = { state: 'running', destination: { direct: true }, createGain: () => gain,
    close() { this.state = 'closed'; return Promise.resolve(); } };
  if (streamSupported) ctx.createMediaStreamDestination = () => {
    if (throwStream) throw new Error('stream unavailable');
    return destination;
  };
  const win = { atob, setTimeout: () => 1, clearTimeout() {}, URL: { revokeObjectURL(url) { revoked.push(url); } }, AudioContext: function () { return ctx; }, setInterval: () => 1, clearInterval() {},
    document: { body: { appendChild(el) { el.connected = true; } }, createElement(name) {
      assert.equal(name, 'audio');
      const el = Object.assign(new EventTarget(), { srcObject: null, paused: true, volume: 1, muted: false,
        setAttribute() {}, removeAttribute(key) { delete this[key]; }, load() {}, play() {
          this.paused = false;
          return new Promise((resolve, reject) => { rejectPending = reject; if (!rejectPlay) resolve(); });
        }, pause() { this.paused = true; }, remove() { this.connected = false; } });
      elements.push(el); return el;
    } }
  };
  const engine = new AudioEngine({ win, speed: 2,
    createNativeAudioSource: nativeRoute ? () => ({ mediaSource: nativeSource, url: 'blob:native' }) : undefined, onError: error => errors.push(error) });
  return { engine, errors, connections, elements, track, ctx, destination, gain, nativeSource, nativeBytes, revoked,
    reject: () => rejectPending(new Error('play rejected')) };
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('accelerated PCM reaches a playing media element instead of the direct Web Audio sink', async () => {
  const h = harness(); await settle();
  try {
    assert.deepEqual(h.connections, [h.destination], 'eARC requires a media output for accelerated PCM');
    assert.equal(h.elements.length, 1);
    assert.equal(h.elements[0].srcObject, h.destination.stream);
    assert.equal(h.elements[0].connected, true);
    assert.equal(h.elements[0].paused, false);
    h.engine.setVolume(0.4, false);
    assert.equal(h.gain.gain.value, 0.4);
    assert.equal(h.elements[0].volume, 1, 'do not attenuate twice');
    h.engine.setVolume(0.4, true);
    assert.equal(h.gain.gain.value, 0);
    assert.deepEqual(h.errors, []);
  } finally { h.engine.destroy(); }
});

test('destroy stops tracks and removes the output without touching a replacement engine', async () => {
  const old = harness({ rejectPlay: true }); await settle();
  const next = harness(); await settle();
  old.engine.destroy(); old.engine.destroy(); old.reject(); await settle();
  assert.equal(old.track.stopped, true);
  assert.equal(old.elements[0].srcObject, null);
  assert.equal(old.elements[0].connected, false);
  assert.equal(old.elements[0].paused, true);
  assert.deepEqual(old.errors, []);
  assert.equal(next.elements[0].connected, true);
  assert.equal(next.elements[0].paused, false);
  assert.equal(next.track.stopped, false);
  next.engine.destroy();
});

test('play rejection reports failure once and releases the unusable route', async () => {
  const h = harness({ rejectPlay: true }); await settle();
  h.reject(); await settle();
  h.elements[0].dispatchEvent(new Event('error'));
  assert.equal(h.errors.length, 1);
  assert.equal(h.track.stopped, true);
  assert.equal(h.elements[0].connected, false);
  h.engine.destroy();
});

test('media errors after successful start report failure and release output', async () => {
  const h = harness(); await settle();
  h.elements[0].dispatchEvent(new Event('error')); await settle();
  assert.equal(h.errors.length, 1);
  assert.equal(h.track.stopped, true);
  h.engine.destroy();
});

test('stream allocation failure reports an error instead of silently routing to the broken sink', async () => {
  const h = harness({ throwStream: true }); await settle();
  assert.equal(h.errors.length, 1);
  assert.equal(h.connections.length, 0);
  h.engine.destroy();
});

test('platforms without stream output retain direct output compatibility', async () => {
  const h = harness({ streamSupported: false }); await settle();
  assert.deepEqual(h.connections, [h.ctx.destination]);
  assert.deepEqual(h.errors, []);
  h.engine.destroy();
});


test('engine owns both PCM and native route and tears both down on replacement', async () => {
  const h = harness({ nativeRoute: true }); await settle();
  h.nativeSource.dispatchEvent(new Event('sourceopen'));
  assert.equal(h.elements.length, 2);
  assert.equal(h.nativeBytes.length, 1);
  assert.ok(h.nativeBytes[0].length > 0);
  assert.equal(h.elements[1].loop, true);
  assert.ok(h.elements.every(el => el.connected && !el.paused));
  assert.deepEqual(h.connections, [h.destination]);
  h.engine.destroy();
  assert.ok(h.elements.every(el => !el.connected && el.paused));
  assert.equal(h.track.stopped, true);
  assert.deepEqual(h.revoked, ['blob:native']);
  assert.deepEqual(h.errors, []);
});
