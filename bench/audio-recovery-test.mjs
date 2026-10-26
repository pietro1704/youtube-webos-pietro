import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AudioEngine } from '../src/speed/audio-engine.js';

const cfg = { codec: 'opus', sampleRate: 48000, numberOfChannels: 1 };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

function harness() {
  const decoders = [], errors = [], started = [];
  const ctx = { currentTime: 1, state: 'running',
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createBuffer: () => ({ samples: [], copyToChannel(samples) { this.samples = samples.slice(); } }),
    createBufferSource: () => ({ connect() {}, stop() {}, start() { started.push(this.buffer); } }),
    close() { this.state = 'closed'; return Promise.resolve(); }
  };
  const win = { AudioContext: function () { return ctx; }, setInterval: () => 1, clearInterval() {},
    EncodedAudioChunk: class { constructor(options) { Object.assign(this, options); } },
    AudioDecoder: class {
      static isConfigSupported() { return Promise.resolve({ supported: true }); }
      constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; decoders.push(this); }
      configure() { this.state = 'configured'; }
      close() { this.state = 'closed'; }
      reset() { this.state = 'unconfigured'; }
      decode(chunk) {
        this.callbacks.output({ timestamp: chunk.timestamp, sampleRate: 48000,
          numberOfFrames: 960, numberOfChannels: 1,
          copyTo(samples) { samples.fill(0.25); }, close() {} });
      }
      reclaim() {
        this.state = 'closed';
        this.callbacks.error(Object.assign(new Error('Codec reclaimed due to inactivity.'), { name: 'QuotaExceededError' }));
      }
    }
  };
  const engine = new AudioEngine({ win, speed: 2, onError: error => errors.push(error),
    createStretcher: () => {
      let samples;
      return { setSpeed() {}, push(ch) { samples = ch; }, available: () => samples ? samples[0].length : 0,
        pull(n) { const out = samples.map(ch => ch.slice(0, n)); samples = null; return out; } };
    }
  });
  const video = Object.assign(new EventTarget(), { currentTime: 10, paused: false });
  engine.attachVideo(video);
  const advance = () => { ctx.currentTime += 0.05; video.currentTime += 0.1; engine.tick(); };
  const fill = () => engine.push(Array.from({ length: 250 }, (_, i) => ({ pts: 10 + i * 0.02,
    duration: 0.02, key: true, data: new Uint8Array([1]) })));
  return { win, engine, video, decoders, errors, started, advance, fill };
}

test('decoder reclaimed during playback recovers real PCM without falling back to 1x', async () => {
  const h = harness();
  h.engine.configure(cfg);
  await settle();
  h.fill();
  h.advance();
  assert.ok(h.started.length > 0);
  h.decoders[0].reclaim();
  assert.deepEqual(h.errors, [], 'browser inactivity reclamation must not disable saved speed');
  h.advance();
  await settle();
  h.started.length = 0;
  h.advance();
  assert.equal(h.decoders.length, 2);
  assert.ok(h.started.some(buffer => buffer.samples.some(value => value > 0)), 'recovered output must contain nonzero PCM');
  assert.equal(h.engine.speed, 2);
  h.engine.destroy();
});

test('paused reclamation waits for playback and retained chunks decode after resume', async () => {
  const h = harness();
  h.engine.configure(cfg);
  await settle();
  h.fill();
  h.video.paused = true;
  h.video.dispatchEvent(new Event('pause'));
  h.decoders[0].reclaim();
  h.advance();
  await settle();
  assert.equal(h.decoders.length, 1);
  assert.deepEqual(h.errors, []);
  h.video.paused = false;
  h.video.dispatchEvent(new Event('playing'));
  h.advance();
  await settle();
  h.advance();
  assert.equal(h.decoders.length, 2);
  assert.ok(h.started.some(buffer => buffer.samples.some(value => value > 0)));
  h.engine.destroy();
});

test('late errors and output from destroyed engines cannot affect the next video', async () => {
  const h = harness();
  h.engine.configure(cfg);
  await settle();
  const old = h.decoders[0];
  h.engine.destroy();
  old.reclaim();
  let closed = false;
  old.callbacks.output({ close() { closed = true; } });
  assert.deepEqual(h.errors, []);
  assert.equal(closed, true);
  assert.equal(h.engine.pcm.length, 0);
});

test('stale configuration rejections are ignored after replacement or destruction', async () => {
  const h = harness();
  let reject;
  h.win.AudioDecoder.isConfigSupported = () => new Promise((_resolve, fail) => { reject = fail; });
  h.engine.configure(cfg);
  h.engine.destroy();
  reject(new Error('old configuration'));
  await settle();
  assert.deepEqual(h.errors, []);
});

test('late output/errors from a replaced decoder cannot poison its replacement', async () => {
  const h = harness();
  h.engine.configure(cfg);
  await settle();
  const old = h.decoders[0];
  h.engine.configure({ ...cfg, sampleRate: 44100 });
  await settle();
  old.reclaim();
  let closed = false;
  old.callbacks.output({ close() { closed = true; } });
  assert.equal(closed, true);
  assert.equal(h.engine.decoder, h.decoders[1]);
  assert.deepEqual(h.errors, []);
  h.engine.destroy();
});

test('persistent resource exhaustion is bounded and genuine decode failures are reported', async () => {
  const h = harness();
  h.engine.configure(cfg);
  await settle();
  h.fill();
  for (let attempt = 0; attempt < 3; attempt++) {
    h.engine.decoder.reclaim();
    h.advance();
    // The next attempt depends on the asynchronously-created decoder.

    await settle();
  }
  h.engine.decoder.reclaim();
  assert.equal(h.errors.length, 1);
  assert.equal(h.engine.failed, true);
  h.engine.destroy();

  const unsupported = harness();
  unsupported.engine.configure(cfg);
  await settle();
  const failure = new Error('corrupt audio');
  unsupported.decoders[0].callbacks.error(failure);
  assert.deepEqual(unsupported.errors, [failure]);
  unsupported.engine.destroy();
});

test('reclamation inside decode does not continue using a closed decoder', async () => {
  const h = harness();
  h.engine.configure(cfg);
  await settle();
  h.engine.decoder.decode = function () { this.reclaim(); };
  assert.doesNotThrow(h.fill);
  assert.deepEqual(h.errors, []);
  h.advance();
  await settle();
  h.advance();
  assert.ok(h.started.some(buffer => buffer.samples.some(value => value > 0)));
  h.engine.destroy();
});
