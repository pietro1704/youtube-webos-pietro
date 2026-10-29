const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function harness({ abort = true } = {}) {
  const dom = new JSDOM('<body><video></video><ytlr-progress-bar><div idomkey="slider"></div></ytlr-progress-bar></body>', {
    url: 'https://www.youtube.com/tv#/watch?v=videoA'
  });
  const win = dom.window, video = win.document.querySelector('video');
  Object.defineProperty(win.document, 'readyState', { value: 'complete' });
  for (const [key, value] of Object.entries({ duration: 100, readyState: 4, paused: false, seeking: false })) {
    Object.defineProperty(video, key, { configurable: true, value });
  }
  video.currentTime = 5;
  const config = { enableSponsorBlock: true, sbMode_sponsor: 'auto_skip', sbMode_highlight: 'disable' };
  const listeners = new Map(), timers = new Map(), rafs = new Map(), requests = [], notifications = [];
  const ui = { segments: [], labels: [], popup: false };
  let now = 0, serial = 0;
  const context = {
    window: win, document: win.document, URLSearchParams: win.URLSearchParams,
    HTMLVideoElement: win.HTMLVideoElement, MutationObserver: win.MutationObserver,
    AbortController: abort ? AbortController : undefined,
    console: { log() {}, warn() {} }, sha256: () => 'abcd1234',
    configGetAll: () => config,
    configAddChangeListener(key, fn) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(fn);
    },
    configRemoveChangeListener(key, fn) { listeners.get(key)?.delete(fn); },
    segmentTypes: { sponsor: { name: 'sponsor' } }, isLegacyWebOS: () => false,
    getVideo: () => video, waitForChildAdd: () => Promise.resolve(),
    showNotification(text) {
      const notice = { text, removed: false, remove() { this.removed = true; } };
      notifications.push(notice); return notice;
    },
    sponsorBlockUI: { updateSegments(s) { ui.segments = s; }, togglePopup(v) { ui.popup = v; } },
    sponsorBlockLabels: { update(s) { ui.labels = s; }, clear() { ui.labels = []; } },
    isFullVideoSegment: s => s.actionType === 'full',
    fetch(url, options) {
      return new Promise((resolve, reject) => { requests.push({ url, options, resolve, reject }); });
    },
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { throw new Error('fixture must supply a progress bar'); }, clearInterval() {},
    requestAnimationFrame(fn) { const id = ++serial; rafs.set(id, fn); return id; },
    cancelAnimationFrame(id) { rafs.delete(id); }
  };
  vm.runInNewContext(fs.readFileSync('src/sponsorblock.js', 'utf8').replace(/^import[^;]+;\r?$/gm, '').replace('window.sponsorblock.init();', 'window.__sbInitPromise = window.sponsorblock.init();'), context);
  const h = { win, video, config, requests, notifications, ui, rafs, timers,
    toggle(value) { config.enableSponsorBlock = value; for (const fn of [...(listeners.get('enableSponsorBlock') || [])]) fn({ detail: { newValue: value } }); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const entry = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        const [id, t] = entry; now = t.at; timers.delete(id); t.fn();
      }
      now = end;
    },
    respond(index = requests.length - 1, segment = [10, 20], videoID = 'videoA') {
      requests[index].resolve({ ok: true, json: async () => [{ videoID, segments: [{ category: 'sponsor', actionType: 'skip', segment }] }] });
      return settle();
    },
    tick(time) { video.currentTime = time; video.dispatchEvent(new win.Event('timeupdate')); },
    close() { win.sponsorblock?.destroy(); win.close(); }
  };
  h.advance(510);
  return h;
}

test('disabling stops active skips and re-enabling works on the same video', async () => {
  const h = harness();
  try {
    await h.respond(); const old = h.win.sponsorblock;
    assert.ok(h.win.document.querySelector('#previewbar'));
    h.toggle(false); h.tick(12);
    assert.equal(h.video.currentTime, 12);
    assert.equal(old.isDestroyed, true);
    assert.equal(h.win.document.querySelector('#previewbar'), null);
    assert.equal(h.ui.segments.length, 0); assert.equal(h.ui.labels.length, 0);
    h.toggle(true); h.advance(10); await h.respond();
    assert.notEqual(h.win.sponsorblock, old);
    h.tick(12); assert.equal(h.video.currentTime, 20);
  } finally { h.close(); }
});

for (const abort of [true, false]) for (const fail of [true, false]) {
  test(`late fetch cannot revive a disabled handler: abort=${abort}, reject=${fail}`, async () => {
    const h = harness({ abort });
    try {
      const old = h.win.sponsorblock;
      h.toggle(false);
      if (abort) assert.equal(h.requests[0].options.signal.aborted, true);
      if (fail) { h.requests[0].reject(new Error('offline')); await settle(); }
      else await h.respond();
      h.advance(6000); await settle();
      h.tick(12);
      assert.equal(h.video.currentTime, 12);
      assert.equal(old.isDestroyed, true);
      assert.equal(h.requests.length, 1, 'no fallback after cancellation');
      assert.equal(h.notifications.length, 0);
      assert.equal(h.ui.segments.length, 0);
      assert.equal(h.win.document.querySelector('#previewbar'), null);
    } finally { h.close(); }
  });
}

test('late response for a previous video cannot overwrite a new handler', async () => {
  const h = harness();
  try {
    const old = h.win.sponsorblock;
    h.win.history.replaceState(null, '', '#/watch?v=videoB');
    h.win.dispatchEvent(new h.win.Event('hashchange')); h.advance(10);
    await h.respond(1, [30, 40], 'videoB');
    const current = h.win.sponsorblock;
    await h.respond(0);
    assert.equal(old.isDestroyed, true);
    assert.equal(h.win.sponsorblock, current);
    assert.equal(h.ui.segments[0].segment[0], 30);
    h.tick(12); assert.equal(h.video.currentTime, 12);
    h.tick(32); assert.equal(h.video.currentTime, 40);
  } finally { h.close(); }
});

test('disabling cancels pending skip notifications and manual controls', async () => {
  const h = harness();
  try {
    await h.respond(); const old = h.win.sponsorblock;
    h.tick(12); assert.equal(h.video.currentTime, 20);
    const callbacks = [...h.rafs.values()];
    h.toggle(false);
    for (const callback of callbacks) callback();
    assert.equal(h.notifications.length, 0);
    h.video.currentTime = 12;
    assert.equal(old.handleBlueButton(), false);
    assert.equal(old.skipToPreviousSegment(), false);
    assert.equal(h.video.currentTime, 12);
  } finally { h.close(); }
});

test('disabling synchronously during a seek stops the rest of the operation', async () => {
  const h = harness();
  try {
    await h.respond(); let time = 12;
    Object.defineProperty(h.video, 'currentTime', { get: () => time, set(value) { time = value; h.toggle(false); } });
    assert.doesNotThrow(() => h.win.sponsorblock.handleTimeUpdate());
    assert.equal(h.win.sponsorblock, null);
    assert.equal(h.rafs.size, 0);
    assert.equal(h.notifications.length, 0);
  } finally { h.close(); }
});

test('toggle bursts cancel pending initialization and retired cleanup is idempotent', async () => {
  const h = harness();
  try {
    const old = h.win.sponsorblock;
    h.toggle(false); h.toggle(true); h.toggle(false); h.advance(10);
    assert.equal(h.win.sponsorblock, null);
    assert.equal(h.requests.length, 1);
    h.toggle(true); h.advance(10); await h.respond();
    const current = h.win.sponsorblock;
    old.destroy(); await h.respond(0);
    assert.equal(h.win.sponsorblock, current);
    assert.equal(h.ui.segments.length, 1);
    assert.ok(h.win.document.querySelector('#previewbar'));
  } finally { h.close(); }
});

test('disabling removes an active manual notification', async () => {
  const h = harness();
  try {
    h.config.sbMode_sponsor = 'manual_skip'; await h.respond();
    // The mode is read at segment rebuild, as it is for a fetched response.
    h.tick(12);
    assert.equal(h.notifications.length, 1);
    const notice = h.notifications[0];
    h.toggle(false);
    assert.equal(notice.removed, true);
    assert.equal(h.rafs.size, 0);
    assert.equal(h.timers.size, 1, 'only the harmless disabled init check remains');
  } finally { h.close(); }
});

test('disabling during the initial chain seek cannot repopulate shared UI', async () => {
  const h = harness();
  try {
    let time = 0;
    Object.defineProperty(h.video, 'currentTime', { get: () => time, set(value) { time = value; h.toggle(false); } });
    await h.respond(0, [0, 20]);
    assert.equal(h.win.sponsorblock, null);
    assert.equal(h.ui.segments.length, 0);
    assert.equal(h.ui.labels.length, 0);
    assert.equal(h.notifications.length, 0);
    assert.equal(h.rafs.size, 0);
  } finally { h.close(); }
});

for (const fail of [false, true]) test('legacy fetch wait settles on cancellation even without a network response: fail=' + fail, async () => {
  const h = harness({ abort: false });
  try {
    let settled = false;
    h.win.__sbInitPromise.then(() => { settled = true; });
    h.toggle(false); await settle();
    assert.equal(settled, true, 'cancelled init releases its pending continuation');
    if (fail) h.requests[0].reject(new Error('late offline'));
    else await h.respond();
    await settle();
    assert.equal(h.notifications.length, 0);
    assert.equal(h.requests.length, 1);
  } finally { h.close(); }
});
