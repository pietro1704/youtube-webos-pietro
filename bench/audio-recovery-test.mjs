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

test('late video binding schedules retained PCM and owns volume listeners across replacement', async () => {
  const h = harness();
  h.engine.attachVideo(null);
  h.engine.configure(cfg);
  await settle();
  h.fill();
  h.engine.tick();
  assert.equal(h.started.length, 0);
  h.video.volume = 0.35; h.video.muted = false;
  h.engine.attachVideo(h.video);
  h.engine.attachVideo(h.video);
  h.advance();
  assert.ok(h.started.length > 0, 'buffered audio starts after the video is attached');
  assert.equal(h.engine.gain.gain.value, 0.35);
  const next = Object.assign(new EventTarget(), { currentTime: 10, paused: false, volume: 0.8, muted: true });
  h.engine.attachVideo(next);
  assert.equal(h.engine.gain.gain.value, 0);
  h.video.volume = 1; h.video.dispatchEvent(new Event('volumechange'));
  assert.equal(h.engine.gain.gain.value, 0, 'old video cannot change new output');
  next.muted = false; next.dispatchEvent(new Event('volumechange'));
  assert.equal(h.engine.gain.gain.value, 0.8);
  h.engine.destroy();
  next.volume = 0.1; next.dispatchEvent(new Event('volumechange'));
  assert.equal(h.engine.gain.gain.value, 0.8, 'destroy removes listener');
  h.engine.attachVideo(next);
  assert.equal(h.engine.video, null, 'destroyed engine cannot reattach');
});

const packetsAt = (start, count = 50) => Array.from({ length: count }, (_, i) => ({
  pts: start + i * 0.02, duration: 0.02, key: true, data: new Uint8Array([1])
}));

test('a gap in submitted audio replaces the decoder and resumes nonzero PCM at the current timeline', async () => {
  const h = harness(); h.engine.configure(cfg); await settle(); h.fill(); h.advance();
  assert.equal(h.decoders.length, 1);
  const previous = h.decoders[0], scheduled = h.engine.scheduledFrames;
  h.video.currentTime = 40;
  h.engine.push(packetsAt(40));
  await settle(); h.advance();
  assert.equal(previous.state, 'closed');
  assert.equal(h.decoders.length, 2);
  assert.ok(h.engine.scheduledFrames > scheduled);
  previous.callbacks.error(new Error('retired'));
  let closed = false;
  previous.callbacks.output({ close() { closed = true; } });
  assert.equal(closed, true); assert.deepEqual(h.errors, []);
  h.engine.destroy();
});

test('a future gap retains earlier PCM and does not repeatedly restart from old packets', async () => {
  const h = harness(); h.engine.configure(cfg); await settle();
  h.engine.push([...packetsAt(10, 10), ...packetsAt(11, 10)]);
  await settle();
  assert.equal(h.decoders.length, 2);
  assert.ok(h.engine.pcm.some(p => p.t < 10.2), 'earlier valid PCM must survive decoder replacement');
  assert.ok(h.engine.pcm.some(p => p.t >= 11));
  for (let i = 0; i < 4; i++) { h.engine.pumpDecoder(); await settle(); }
  assert.equal(h.decoders.length, 2, 'already submitted packets cannot cause a restart loop');
  h.engine.destroy();
});

test('destroy during gap recovery cancels replacement and ignores old callbacks', async () => {
  const h = harness(); h.engine.configure(cfg); await settle(); h.fill();
  h.video.currentTime = 40; h.engine.push(packetsAt(40));
  h.engine.destroy(); await settle();
  assert.equal(h.decoders.length, 1);
  assert.equal(h.engine.decoder, null);
  h.decoders[0].callbacks.error(new Error('late'));
  assert.deepEqual(h.errors, []);
});

test('continuous packets do not churn decoders and a seek can decode an earlier range', async () => {
  const h = harness(); h.engine.configure(cfg); await settle(); h.fill();
  for (let i = 0; i < 10; i++) h.advance();
  assert.equal(h.decoders.length, 1);
  h.video.currentTime = 40; h.engine.push(packetsAt(40)); await settle();
  h.video.currentTime = 10; h.video.dispatchEvent(new Event('seeking'));
  h.engine.pumpDecoder();
  assert.ok(h.engine.pcm.some(p => p.t === 10));
  assert.equal(h.decoders.length, 2, 'explicit seek resets continuity without another replacement');
  h.engine.destroy();
});

test('a decoder configuration failure during gap recovery is reported once', async () => {
  const h = harness(); h.engine.configure(cfg); await settle(); h.fill();
  h.win.AudioDecoder.isConfigSupported = () => Promise.resolve({ supported: false });
  h.video.currentTime = 40; h.engine.push(packetsAt(40)); await settle();
  h.engine.tick(); h.engine.tick();
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0].name, 'NotSupportedError');
  assert.equal(h.engine.failed, true);
  h.engine.destroy();
});
