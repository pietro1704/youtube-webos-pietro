import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AudioEngine } from '../src/speed/audio-engine.js';

function harness({ timestamp = { contextTime: 0.8, performanceTime: 1000 }, baseLatency = 0.02,
  outputLatency = 0.18, audioOffsetMs = 0, speed = 2 } = {}) {
  const started = [];
  const ctx = {
    currentTime: 1, state: 'running', baseLatency, outputLatency,
    getOutputTimestamp() {
      if (timestamp instanceof Error) throw timestamp;
      return timestamp;
    },
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createBuffer() {
      const data = [];
      return { data, copyToChannel(samples, channel) { data[channel] = samples.slice(); } };
    },
    createBufferSource() {
      const node = { connect() {}, start(when) { started.push({ when, buffer: this.buffer, node }); },
        stop() { this.stopped = true; } };
      return node;
    }
  };
  const video = new EventTarget();
  Object.assign(video, { currentTime: 10, paused: false });
  const engine = new AudioEngine({
    win: { AudioContext: function () { return ctx; }, setInterval: () => 1,
      clearInterval() {}, performance: { now: () => 1000 } },
    speed, audioOffsetMs,
    createStretcher: () => {
      let samples;
      return { setSpeed() {}, push(ch) { samples = ch; }, available: () => samples ? samples[0].length : 0,
        pull(n) { const out = samples.map(ch => ch.slice(0, n)); samples = null; return out; } };
    }
  });
  engine.attachVideo(video);
  engine.lastVideoTime = 9.9;
  // A ramp encodes the content timestamp into every sample, so assertions
  // verify the content reaching the output, not only a displayed property.
  engine.pcm = [{ t: 0, n: 20000, rate: 1000,
    ch: [Float32Array.from({ length: 20000 }, (_, i) => i / 1000)] }];
  return { engine, video, ctx, started };
}

test('scheduled PCM compensates the measured audible-output latency at 2x', () => {
  const { engine, started } = harness();
  engine.tick();
  assert.equal(started[0].when, 1.03);
  assert.ok(Math.abs(started[0].buffer.data[0][0] - 10.46) < 0.003);
  assert.ok(Math.abs(engine.outputLatencyS - 0.2) < 0.001);
});

test('latency compensation scales content time at slow and fractional rates', () => {
  for (const [speed, expected] of [[0.5, 10.115], [1.25, 10.2875]]) {
    const { engine, started } = harness({ speed });
    engine.tick();
    assert.ok(Math.abs(started[0].buffer.data[0][0] - expected) < 0.003);
  }
});

test('output timestamp is extrapolated to the current performance clock', () => {
  const { engine, started } = harness({ timestamp: { contextTime: 0.6, performanceTime: 900 } });
  engine.tick();
  assert.ok(Math.abs(started[0].buffer.data[0][0] - 10.66) < 0.003);
});

test('missing or unusable output timestamps fall back to declared pipeline latency', () => {
  for (const timestamp of [new Error('not implemented'), { contextTime: 0, performanceTime: 0 },
    { contextTime: NaN, performanceTime: 1000 }]) {
    const { engine, started } = harness({ timestamp });
    engine.tick();
    assert.ok(Math.abs(started[0].buffer.data[0][0] - 10.46) < 0.003);
  }
});

test('zero-latency output retains its original presentation timing', () => {
  const { engine, started } = harness({ timestamp: null, baseLatency: 0, outputLatency: 0 });
  engine.tick();
  assert.ok(Math.abs(started[0].buffer.data[0][0] - 10.06) < 0.003);
});

test('receiver adjustment advances or delays actual content in milliseconds', () => {
  for (const [audioOffsetMs, expected] of [[50, 10.56], [-50, 10.36]]) {
    const { engine, started } = harness({ audioOffsetMs });
    engine.tick();
    assert.ok(Math.abs(started[0].buffer.data[0][0] - expected) < 0.003);
  }
});

test('changing offset cancels queued sound but retains decoded PCM for resync', () => {
  const { engine, video, started } = harness();
  engine.tick();
  const pcm = engine.pcm;
  const queued = started.map(item => item.node);
  assert.equal(engine.setAudioOffsetMs(50), true);
  assert.ok(queued.every(node => node.stopped));
  assert.equal(engine.pcm, pcm);
  assert.equal(engine.setAudioOffsetMs(50), false);
  video.currentTime += 0.1;
  const next = started.length;
  engine.tick();
  assert.ok(started.length > next);
  assert.ok(Math.abs(started[next].buffer.data[0][0] - 10.66) < 0.003);
});

test('pause cancels queued sound immediately', () => {
  const { engine, video, started } = harness();
  engine.tick();
  video.paused = true;
  video.dispatchEvent(new Event('pause'));
  assert.ok(started.every(item => item.node.stopped));
  assert.equal(engine.sources.size, 0);
});

test('maximum receiver advance expands decoding before the playback anchor', () => {
  const { engine, started } = harness({ timestamp: new Error('unavailable'),
    baseLatency: 0, outputLatency: 1, audioOffsetMs: 500 });
  engine.pcm = [];
  engine.chunks = Array.from({ length: 200 }, (_, index) => {
    const t = 10 + index * 0.025;
    return { pts: Math.round(t * 1e6), dur: 25000, chunk: { t } };
  });
  engine.decoder = { state: 'configured', decode({ t }) {
    engine.pcm.push({ t, n: 25, rate: 1000,
      ch: [Float32Array.from({ length: 25 }, (_, index) => t + index / 1000)] });
  } };
  engine.tick();
  assert.ok(started.length > 0, 'compensation must not outrun the decoded audio window');
  assert.ok(Math.abs(started[0].buffer.data[0][0] - 13.06) < 0.003);
});
