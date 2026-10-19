import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSpeedController } from '../src/speed/controller.js';

function harness(overrides = {}) {
  const timers = new Map();
  let nextTimer = 1;
  const win = {
    AudioDecoder: class {},
    setTimeout(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  const config = {
    enablePlaybackSpeed: true,
    defaultPlaybackSpeed: '1',
    preferredVideoQuality: 'hd2160',
    forceHighResVideo: false,
    ...overrides.config
  };
  const writes = [];
  const calls = [];
  const player = {
    getCurrentTime: () => 42,
    getVideoData: () => ({ video_id: 'test-video' }),
    setPlaybackQualityRange: (...args) => calls.push(['quality', ...args]),
    loadVideoById: (...args) => calls.push(['load', ...args])
  };
  const controller = createSpeedController({
    win,
    getPlayer: () => player,
    notify: () => {},
    configRead: (key) => config[key],
    configWrite(key, value) {
      writes.push([key, value]);
      config[key] = value;
    }
  });
  const flush = () => {
    for (const [id, callback] of Array.from(timers)) {
      timers.delete(id);
      callback();
    }
  };
  return { controller, config, writes, calls, flush };
}

test('speed choice persists and reloads at the same content position', () => {
  const { controller, writes, calls, flush } = harness();
  assert.equal(controller.setSpeed(2), true);
  flush();
  assert.deepEqual(writes, [['defaultPlaybackSpeed', '2']]);
  assert.deepEqual(calls, [
    ['quality', 'hd1080', 'hd1080'],
    ['load', 'test-video', 42]
  ]);
});

test('returning from a fast rate restores the configured quality', () => {
  const { controller, calls, flush } = harness();
  controller.setSpeed(2);
  flush();
  calls.length = 0;
  controller.setSpeed(1);
  flush();
  assert.deepEqual(calls, [
    ['quality', 'hd2160', 'hd2160'],
    ['load', 'test-video', 42]
  ]);
});

test('same and invalid rates do not write or reload', () => {
  const { controller, writes, calls, flush } = harness();
  assert.equal(controller.setSpeed(1), true);
  assert.equal(controller.setSpeed(3), false);
  flush();
  assert.deepEqual(writes, []);
  assert.deepEqual(calls, []);
});

test('configured default is active before the first MediaSource is created', () => {
  const { controller, writes, calls } = harness({
    config: { defaultPlaybackSpeed: '1.5' }
  });
  assert.equal(controller.getSpeed(), 1.5);
  assert.deepEqual(writes, []);
  assert.deepEqual(calls, []);
});

test('disabled control rejects a rate without changing state', () => {
  const { controller, writes, calls, flush } = harness({
    config: { enablePlaybackSpeed: false }
  });
  assert.equal(controller.setSpeed(1.5), false);
  flush();
  assert.equal(controller.getSpeed(), 1);
  assert.deepEqual(writes, []);
  assert.deepEqual(calls, []);
});
