import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNativeAudioTrack } from '../src/speed/native-audio-track.js';
import { parseInitInfo, demuxFragments, audioConfigFromInit } from '../src/speed/containers.js';

function harness(speed = 2) {
  const writes = [], removals = [], errors = [];
  const mediaSource = Object.assign(new EventTarget(), { readyState: 'open' });
  const buffer = Object.assign(new EventTarget(), { updating: false,
    appendBuffer(data) { assert.equal(this.updating, false); this.updating = true; writes.push(data); },
    remove(start, end) { assert.equal(this.updating, false); this.updating = true; removals.push([start, end]); },
    abort() { this.updating = false; }
  });
  const track = createNativeAudioTrack({ win: { atob }, mediaSource, speed,
    addSourceBuffer(mime) { assert.equal(mime, 'audio/mp4; codecs="mp4a.40.2"'); return buffer; },
    onError(error) { errors.push(error); } });
  function flush() {
    let count = 0;
    while (buffer.updating) {
      assert.ok(++count < 100, 'queue is bounded');
      buffer.updating = false; buffer.dispatchEvent(new Event('updateend'));
    }
  }
  return { track, buffer, mediaSource, writes, removals, errors, flush };
}

test('native support is valid stereo AAC on the accelerated hardware timeline', async () => {
  const h = harness();
  h.track.append(10, 11);
  const done = h.track.whenIdle(); h.flush();
  assert.equal(await done, true);
  assert.equal(h.writes.length, 2);
  const info = parseInitInfo(h.writes[0]);
  const config = audioConfigFromInit(h.writes[0]);
  assert.equal(config.sampleRate, 48000); assert.equal(config.numberOfChannels, 2);
  const frames = demuxFragments(h.writes[1], info).samples;
  assert.ok(frames.length > 0);
  assert.ok(frames[0].pts <= 5 && frames[0].pts > 5 - 1024 / 48000);
  const last = frames.at(-1);
  assert.ok(last.pts + last.duration >= 5.5 && last.pts + last.duration < 5.5 + 1024 / 48000);
  assert.ok(frames.every(frame => frame.duration === 1024 / 48000));
  assert.deepEqual(h.errors, []); h.track.destroy();
});

test('sequential appends and seeks retain native coverage without serial-update races', async () => {
  const h = harness(1.5);
  h.track.append(0, 3); h.track.append(3, 6); h.track.append(600, 603);
  const idle = h.track.whenIdle(); h.flush(); assert.equal(await idle, true);
  const info = parseInitInfo(h.writes[0]);
  const ranges = h.writes.slice(1).map(data => {
    const frames = demuxFragments(data, info).samples;
    return [frames[0].pts, frames.at(-1).pts + frames.at(-1).duration];
  });
  assert.ok(ranges[1][0] <= ranges[0][1], 'no native buffer gap at ordinary append boundaries');
  assert.ok(ranges[2][0] <= 400 && ranges[2][1] >= 402, 'seek range mapped once');
  h.track.remove(0, 30); h.flush(); assert.deepEqual(h.removals, [[0, 20]]);
  h.track.destroy();
});

test('update completion waits for both initialization and queued native media', async () => {
  const h = harness(); h.track.append(0, 5);
  let finished = false; h.track.whenIdle().then(() => { finished = true; });
  await Promise.resolve(); assert.equal(finished, false);
  h.buffer.updating = false; h.buffer.dispatchEvent(new Event('updateend'));
  await Promise.resolve(); assert.equal(finished, false);
  h.flush(); await Promise.resolve(); assert.equal(finished, true);
  h.track.destroy();
});

test('cancelled initialization settles old work and reinitializes before later appends', async () => {
  const h = harness(); h.track.append(0, 5); const cancelled = h.track.whenIdle();
  h.track.cancel(); assert.equal(await cancelled, false);
  h.track.append(20, 22);
  h.buffer.dispatchEvent(new Event('updateend')); // stale event while new append is updating
  assert.equal(h.writes.length, 2, 'new initialization is still pending');
  h.flush(); assert.equal(await h.track.whenIdle(), true);
  assert.equal(h.writes.length, 3);
  assert.ok(audioConfigFromInit(h.writes[1]).codec);
  h.track.destroy();
});

test('native append failure reports once, settles waiters, and never affects another source', async () => {
  const old = harness(), next = harness();
  old.track.append(0, 5); const pending = old.track.whenIdle();
  old.buffer.dispatchEvent(new Event('error')); old.buffer.dispatchEvent(new Event('error'));
  assert.equal(await pending, false); assert.equal(old.errors.length, 1);
  old.track.append(10, 15); assert.equal(old.writes.length, 1);
  next.track.append(0, 5); next.flush(); assert.equal(await next.track.whenIdle(), true);
  assert.deepEqual(next.errors, []); old.track.destroy(); next.track.destroy();
});

test('source closure releases pending work and late callbacks cannot revive it', async () => {
  const h = harness(); h.track.append(0, 5); const pending = h.track.whenIdle();
  h.mediaSource.readyState = 'closed'; h.mediaSource.dispatchEvent(new Event('sourceclose'));
  assert.equal(await pending, false);
  h.buffer.dispatchEvent(new Event('error')); h.buffer.dispatchEvent(new Event('updateend'));
  h.track.append(10, 15); assert.equal(h.writes.length, 1); assert.deepEqual(h.errors, []);
  h.track.destroy();
});

test('invalid media ranges fail without allocating an unbounded silent stream', () => {
  for (const range of [[0, Infinity], [NaN, 10], [10, 5], [0, 1e9]]) {
    const h = harness(); h.track.append(...range);
    assert.equal(h.errors.length, 1); assert.equal(h.writes.length, 1); h.track.destroy();
  }
});
