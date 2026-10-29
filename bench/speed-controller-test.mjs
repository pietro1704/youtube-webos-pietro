import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSpeedController } from '../src/speed/controller.js';

function harness(overrides = {}) {
  const timers = new Map();
  let nextTimer = 1;
  const events = new EventTarget();
  const win = {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    location: { href: 'https://www.youtube.com/tv#/watch?v=test-video' },
    setInterval: () => 0, clearInterval() {},
    AudioContext: class {
      state = 'running';
      createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
      close() { this.state = 'closed'; }
    },
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
  const writes = [], notices = [];
  const calls = [];
  const player = {
    getCurrentTime: () => 42,
    getVideoData: () => ({ video_id: 'test-video' }),
    setPlaybackQualityRange: (...args) => calls.push(['quality', ...args]),
    loadVideoById: (...args) => calls.push(['load', ...args])
  };
  const controller = createSpeedController({
    win,
    getPlayer: () => overrides.getPlayer ? overrides.getPlayer() : player,
    notify: text => notices.push(text),
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
  return { controller, config, writes, calls, flush, player, win, timers, notices };
}

test('speed choice persists and reloads at the same content position', () => {
  const { controller, writes, calls, flush } = harness();
  assert.equal(controller.setSpeed(2), true);
  flush();
  assert.deepEqual(writes, [['defaultPlaybackSpeed', '2']]);
  assert.deepEqual(calls, [
    ['quality', 'hd2160', 'hd2160'],
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

test('an unsupported video does not erase the default for the next video', () => {
  const { controller, config, player } = harness({ config: { defaultPlaybackSpeed: '2' } });
  assert.equal(controller.getSpeed(), 2);
  controller.onError(new Error('unsupported audio'));
  assert.equal(controller.getSpeed(), 1);
  assert.equal(config.defaultPlaybackSpeed, '2');
  player.getVideoData = () => ({ video_id: 'next-video' });
  assert.equal(controller.getSpeed(), 2);
});

test('navigation cancels a pending reload of the previous video position', () => {
  const { controller, player, calls, flush } = harness();
  controller.setSpeed(2);
  player.getVideoData = () => ({ video_id: 'next-video' });
  flush();
  assert.deepEqual(calls, []);
});

test('uninstall cancels pending reloads', () => {
  const { controller, calls, flush } = harness();
  controller.setSpeed(2);
  controller.destroy();
  flush();
  assert.deepEqual(calls, []);
});

test('a new speed choice after navigation gets its own video and position', () => {
  const { controller, player, calls, flush } = harness();
  controller.setSpeed(2);
  player.getVideoData = () => ({ video_id: 'next-video' });
  player.getCurrentTime = () => 7;
  controller.setSpeed(1.5);
  flush();
  assert.ok(calls.some(call => call[0] === 'load' && call[1] === 'next-video' && call[2] === 7));
});

test('reset in the next video does not inherit the prior video burst rate', () => {
  const { controller, player, calls, flush } = harness();
  controller.setSpeed(2);
  player.getVideoData = () => ({ video_id: 'next-video' });
  assert.equal(controller.getSpeed(), 2);
  controller.reset();
  flush();
  assert.ok(calls.some(call => call[0] === 'load' && call[1] === 'next-video'));
});

for (const [preference, available, expected] of [
  ['hd720', ['hd2160', 'hd1080', 'hd720'], 'hd720'],
  ['hd2160', ['hd2160', 'hd720', 'medium'], 'hd2160'],
  ['auto', ['hd2160', 'hd1080', 'hd720'], 'auto'],
  ['hd720', ['medium', 'small'], 'medium'],
  ['hd720', [], 'auto']
]) {
  test(`accelerated quality respects ${preference} and available levels ${available}`, () => {
    const { controller, player, calls, flush } = harness({ config: { preferredVideoQuality: preference } });
    player.getAvailableQualityLevels = () => available;
    controller.setSpeed(2);
    flush();
    assert.deepEqual(calls[0], ['quality', expected, expected]);
  });
}

for (const scenario of ['destroy', 'navigate', 'replace-player', 'new-speed']) {
  test(`delayed native menu synchronization is cancelled on ${scenario}`, () => {
    let activePlayer;
    const app = harness({ getPlayer: () => activePlayer });
    activePlayer = app.player;
    const rates = [];
    app.player.__ytafOriginalSetPlaybackRate = rate => rates.push(rate);
    app.player.getPlaybackRate = () => 1;
    app.controller.setSpeed(2, { immediate: true });
    if (scenario === 'destroy') app.controller.destroy();
    if (scenario === 'navigate') app.player.getVideoData = () => ({ video_id: 'next-video' });
    if (scenario === 'replace-player') activePlayer = { ...app.player };
    if (scenario === 'new-speed') app.controller.setSpeed(1.5);
    app.flush();
    assert.deepEqual(rates, []);
  });
}

test('delayed synchronization updates the current player when still valid', () => {
  const { controller, player, flush } = harness();
  const rates = [];
  player.__ytafOriginalSetPlaybackRate = rate => rates.push(rate);
  player.getPlaybackRate = () => 1;
  controller.setSpeed(2, { immediate: true });
  flush();
  assert.deepEqual(rates, [2]);
});

test('late speed requests and errors are inert after destroy', () => {
  const { controller, writes, calls, flush } = harness();
  controller.destroy();
  assert.equal(controller.setSpeed(2), false);
  controller.onError(new Error('late'));
  flush();
  assert.deepEqual(writes, []);
  assert.deepEqual(calls, []);
});


test('debounced speed reload reads the latest seek position', () => {
  const h = harness(); h.controller.setSpeed(2);
  h.player.getCurrentTime = () => 300;
  h.flush(); assert.deepEqual(h.calls.at(-1), ['load', 'test-video', 300]);
});

test('same video on a replacement player cannot receive an old reload', () => {
  let active;
  const h = harness({ getPlayer: () => active }); active = h.player;
  h.controller.setSpeed(2); active = { ...h.player }; h.flush();
  assert.deepEqual(h.calls, []);
});

for (const cause of ['hashchange', 'pagehide', 'disabled']) test('pending speed reload is cancelled on ' + cause, () => {
  const h = harness(); h.controller.setSpeed(2);
  if (cause === 'disabled') h.config.enablePlaybackSpeed = false;
  else h.win.dispatchEvent(new Event(cause));
  h.flush(); assert.deepEqual(h.calls, []);
});

test('obsolete reload callbacks cannot steal the latest burst', () => {
  const h = harness(); h.controller.setSpeed(2);
  const old = [...h.timers.values()][0];
  h.controller.setSpeed(1.5); old();
  assert.deepEqual(h.calls, []);
  h.flush(); assert.equal(h.calls.filter(x => x[0] === 'load').length, 1);
});

for (const pausedBefore of [false, true]) test('pause intent is preserved at reload: paused before request=' + pausedBefore, () => {
  const h = harness(); let state = pausedBefore ? 2 : 1;
  h.player.getPlayerState = () => state;
  h.player.pauseVideo = () => { state = 2; h.calls.push(['pause']); };
  h.player.loadVideoById = () => { state = 1; h.calls.push(['load']); };
  h.controller.setSpeed(2); state = 2; h.flush();
  assert.equal(state, 2);
  h.controller.destroy();
});

test('paused reload uses cue when available and never starts playback', () => {
  const h = harness(); h.player.getPlayerState = () => 2;
  h.player.cueVideoById = (...args) => h.calls.push(['cue', ...args]);
  h.controller.setSpeed(2); h.flush();
  assert.deepEqual(h.calls.at(-1), ['cue', 'test-video', 42]);
  assert.equal(h.calls.some(x => x[0] === 'load'), false);
});

test('quality failure falls back to reloading at the current quality', () => {
  const h = harness(); h.player.setPlaybackQualityRange = () => { throw new Error('player not ready'); };
  h.controller.setSpeed(2);
  assert.doesNotThrow(h.flush);
  assert.deepEqual(h.calls, [['load', 'test-video', 42]]);
  assert.equal(h.controller.getSpeed(), 2);
  assert.match(h.notices.join(' '), /quality/i);
});

test('load failure rolls back speed and default while preserving the old audio sink', () => {
  const h = harness({ config: { defaultPlaybackSpeed: '1.5' } });
  const engine = h.controller.createAudioSink({ speed: 1.5 });
  h.player.loadVideoById = () => { throw new Error('load failed'); };
  h.controller.setSpeed(2); assert.doesNotThrow(h.flush);
  assert.equal(h.controller.getSpeed(), 1.5);
  assert.equal(h.config.defaultPlaybackSpeed, '1.5');
  assert.equal(h.controller.activeEngine(), engine);
  assert.notEqual(engine.destroyed, true);
  assert.match(h.controller.diagnostic().lastError, /load failed/);
  assert.match(h.notices.at(-1), /failed|unable|could not/i);
  h.player.loadVideoById = (...args) => h.calls.push(['load', ...args]);
  h.controller.setSpeed(2); h.flush(); assert.equal(h.controller.getSpeed(), 2);
  assert.equal(engine.destroyed, true); h.controller.destroy();
});

test('failed burst restores its original rate and preference', () => {
  const h = harness(); h.player.loadVideoById = () => { throw new Error('load failed'); };
  h.controller.setSpeed(2); h.controller.setSpeed(1.5); assert.doesNotThrow(h.flush);
  assert.equal(h.controller.getSpeed(), 1);
  assert.equal(h.config.defaultPlaybackSpeed, '1');
});

test('synchronous player replacement during quality setup cancels before load', () => {
  let active;
  const h = harness({ getPlayer: () => active }); active = h.player;
  h.player.setPlaybackQualityRange = () => { active = { ...h.player }; };
  h.controller.setSpeed(2); h.flush(); assert.deepEqual(h.calls, []);
});

for (const invalid of [NaN, Infinity, -1]) test('invalid playback position fails safely: ' + invalid, () => {
  const h = harness(); h.player.getCurrentTime = () => invalid;
  h.controller.setSpeed(2); assert.doesNotThrow(h.flush);
  assert.equal(h.calls.some(x => x[0] === 'load'), false);
  assert.equal(h.controller.getSpeed(), 1);
  assert.equal(h.config.defaultPlaybackSpeed, '1');
});

for (const cause of ['playing', 'input', 'navigation', 'destroy', 'replacement']) test('delayed pause restoration respects ' + cause, () => {
  let active;
  const h = harness({ getPlayer: () => active }); active = h.player;
  let pauses = 0;
  h.player.getPlayerState = () => 2; h.player.pauseVideo = () => { pauses++; };
  h.controller.setSpeed(2, { immediate: true }); assert.equal(pauses, 1);
  if (cause === 'input') h.win.dispatchEvent(new Event('keydown'));
  if (cause === 'navigation') h.win.dispatchEvent(new Event('hashchange'));
  if (cause === 'destroy') h.controller.destroy();
  if (cause === 'replacement') active = { ...h.player };
  const evt = new Event('yt-player-state-change'); evt.detail = { state: 1 };
  h.win.dispatchEvent(evt);
  assert.equal(pauses, cause === 'playing' ? 2 : 1);
  h.win.dispatchEvent(evt); assert.equal(pauses, cause === 'playing' ? 2 : 1);
  h.controller.destroy();
});

test('synchronous seek and pause during quality setup use the latest playback intent', () => {
  const h = harness(); let at = 42, paused = false;
  h.player.getCurrentTime = () => at;
  h.player.getPlayerState = () => paused ? 2 : 1;
  h.player.cueVideoById = (...args) => h.calls.push(['cue', ...args]);
  h.player.setPlaybackQualityRange = () => { at = 300; paused = true; };
  h.controller.setSpeed(2); h.flush();
  assert.deepEqual(h.calls, [['cue', 'test-video', 300]]);
});

test('failed load without persistence preserves a newer configured preference', () => {
  const h = harness(); h.player.loadVideoById = () => { throw new Error('load failed'); };
  h.controller.setSpeed(2, { persist: false }); h.config.defaultPlaybackSpeed = '1.75';
  h.flush(); assert.equal(h.config.defaultPlaybackSpeed, '1.75');
  assert.equal(h.controller.getSpeed(), 1);
});

test('immediate rejected load reports failure without announcing the unapplied rate', () => {
  const h = harness(); h.player.loadVideoById = () => { throw new Error('load rejected'); };
  assert.equal(h.controller.setSpeed(2, { immediate: true }), false);
  assert.equal(h.controller.getSpeed(), 1);
  assert.equal(h.notices.some(text => text === 'Playback speed 2×'), false);
});

test('reentrant newer choice survives an older load throwing', () => {
  const h = harness();
  h.player.loadVideoById = () => {
    h.controller.setSpeed(1.5);
    throw new Error('retired load rejected');
  };
  h.controller.setSpeed(2); h.flush();
  assert.equal(h.controller.getSpeed(), 1.5);
  assert.equal(h.config.defaultPlaybackSpeed, '1.5');
  h.player.loadVideoById = (...args) => h.calls.push(['load', ...args]);
  h.flush(); assert.equal(h.controller.getSpeed(), 1.5);
  assert.equal(h.calls.filter(x => x[0] === 'load').length, 1);
});
