const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function harness(initial = -1) {
  const dom = new JSDOM('<head></head><body><div id="player"></div><yt-focus-container idomkey="controls" class="MFDzfe--focused"></yt-focus-container></body>', { url: 'https://www.youtube.com/tv#/watch?v=A' });
  const win = dom.window, p = win.document.getElementById('player');
  Object.defineProperty(win.document, 'readyState', { value: 'complete' });
  let state = initial, videoId = 'A', plays = 0, serial = 0, now = 0, watch = true;
  const timers = new Map(), rafs = new Map(), listeners = {}, keys = [];
  const cfg = { preferredVideoQuality: 'hd2160' };
  Object.assign(p, {
    getPlayerState: () => state, getVideoData: () => ({ video_id: videoId }),
    getAvailableQualityLevels: () => ['hd2160'], getPlaybackQuality: () => 'hd2160',
    setPlaybackQualityRange() {}, setPlaybackQuality() {}, playVideo() { plays++; }
  });
  const ctx = {
    window: win, document: win.document, CustomEvent: win.CustomEvent,
    configRead: k => cfg[k], configAddChangeListener: (k, fn) => { listeners[k] = fn; },
    configRemoveChangeListener: k => { delete listeners[k]; },
    showNotification() {}, isWebOS25: () => true, isWatchPage: () => watch,
    SELECTORS: { PLAYER_ID: 'player' }, REMOTE_KEYS: { UP: { code: 38 } }, SYNTHETIC_KEY_FLAG: '__ytafSynthetic',
    sendKey(key) { keys.push(key.code); }, qualityStorageHeight: () => 2160,
    selectPreferredQuality: (_levels, preference) => preference === 'auto' ? null : 'hd2160',
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, setInterval: () => ++serial, clearInterval() {},
    requestAnimationFrame(fn) { const id = ++serial; rafs.set(id, fn); return id; },
    cancelAnimationFrame(id) { rafs.delete(id); }, console
  };
  vm.runInNewContext(fs.readFileSync('src/video-quality.js', 'utf8').replace(/^import[^;]+;\r?$/gm, '').replace(/export function /g, 'function '), ctx);
  const h = { win, p, ctx, keys, timers, rafs, plays: () => plays,
    state(value, publish = true) { state = value; if (publish) ctx.handleStateChange(value); },
    video(value) { videoId = value; },
    preference(value) { cfg.preferredVideoQuality = value; listeners.preferredVideoQuality({ detail: { newValue: value } }); },
    leave() { watch = false; win.dispatchEvent(new win.CustomEvent('ytaf-page-update', { detail: { isWatch: false } })); },
    frame() { const batch = [...rafs]; rafs.clear(); for (const [, fn] of batch) fn(); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const entry = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        const [id, t] = entry; now = t.at; timers.delete(id); t.fn(); await settle();
      }
      now = end;
    },
    close() { ctx.destroyVideoQuality(); win.close(); }
  };
  ctx.initVideoQualityModule();
  return h;
}

for (const cause of ['pause', 'automatic', 'replace-player', 'new-video', 'leave', 'destroy']) test('webOS25 pending startup respects ' + cause, async () => {
  const h = harness();
  try {
    await h.advance(0); assert.equal(h.plays(), 1);
    if (cause === 'pause') h.state(2, false);
    if (cause === 'automatic') h.preference('auto');
    if (cause === 'replace-player') h.p.replaceWith(h.p.cloneNode());
    if (cause === 'new-video') h.video('B');
    if (cause === 'leave') h.leave();
    if (cause === 'destroy') h.ctx.destroyVideoQuality();
    const before = h.plays(); await h.advance(1000); h.frame();
    assert.equal(h.plays(), before, 'retired loop must not resume or target a new video');
    assert.deepEqual(h.keys, []);
  } finally { h.close(); }
});

test('initially paused webOS25 playback is never kickstarted', async () => {
  const h = harness(2);
  try { await h.advance(5000); h.frame(); assert.equal(h.plays(), 0); assert.deepEqual(h.keys, []); }
  finally { h.close(); }
});

test('successful startup dismisses controls once and removes temporary styling', async () => {
  const h = harness();
  try {
    await h.advance(0); h.state(1, false); await h.advance(500); h.frame();
    assert.deepEqual(h.keys, [38]);
    await h.advance(750); assert.deepEqual(h.keys, [38, 38, 38]);
    assert.equal(h.win.document.querySelector('style'), null);
  } finally { h.close(); }
});

for (const cause of ['pause', 'automatic', 'leave', 'destroy', 'user-key', 'replace-player']) test('pending control dismissal respects ' + cause, async () => {
  const h = harness(1);
  try {
    await h.advance(0); h.frame(); assert.deepEqual(h.keys, [38]);
    if (cause === 'pause') h.state(2);
    if (cause === 'automatic') h.preference('auto');
    if (cause === 'leave') h.leave();
    if (cause === 'destroy') h.ctx.destroyVideoQuality();
    if (cause === 'user-key') h.win.dispatchEvent(new h.win.KeyboardEvent('keydown', { keyCode: 40 }));
    if (cause === 'replace-player') h.p.replaceWith(h.p.cloneNode());
    await h.advance(1000); h.frame();
    assert.deepEqual(h.keys, [38]);
    assert.equal(h.win.document.querySelector('style'), null);
  } finally { h.close(); }
});

test('a cancelled continuation cannot clear a reentrant new startup', async () => {
  const h = harness();
  try {
    await h.advance(0);
    h.preference('auto'); h.preference('hd2160');
    const before = h.plays(); await h.advance(500);
    assert.equal(h.plays(), before + 1);
    h.state(1, false); await h.advance(500); h.frame();
    assert.deepEqual(h.keys, [38]);
    await h.advance(750); assert.deepEqual(h.keys, [38, 38, 38]);
  } finally { h.close(); }
});

test('synchronous navigation during the first control key cleans up immediately', async () => {
  const h = harness(1);
  try {
    h.ctx.sendKey = key => { h.keys.push(key.code); h.win.history.replaceState(null, '', '#/home'); };
    await h.advance(0); h.frame();
    assert.equal(h.win.document.querySelector('style'), null);
    await h.advance(1000); assert.deepEqual(h.keys, [38]);
  } finally { h.close(); }
});
