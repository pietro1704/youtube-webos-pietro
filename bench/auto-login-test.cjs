const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

function harness(enabled = true, guest = false) {
  const dom = new JSDOM('<body class="WEB_PAGE_TYPE_ACCOUNT_SELECTOR"></body>', { url: 'https://www.youtube.com/tv' });
  const win = dom.window, config = { enableAutoLogin: enabled, forcePreviews: 'disabled' };
  Object.defineProperty(win.document, 'readyState', { value: 'complete' });
  const listeners = {}, timers = new Map(), keys = [];
  let now = 0, next = 0;
  const context = {
    window: win, document: win.document, localStorage: win.localStorage,
    console: { info() {}, warn() {}, error() {} },
    configRead: k => config[k], configAddChangeListener: (k, fn) => { listeners[k] = fn; },
    SELECTORS: { ACCOUNT_SELECTOR: 'WEB_PAGE_TYPE_ACCOUNT_SELECTOR' },
    REMOTE_KEYS: { DOWN: { code: 40 }, ENTER: { code: 13 } },
    SYNTHETIC_KEY_FLAG: '__ytafSynthetic', isGuestMode: () => guest, invalidateGuestModeCache() {},
    sendKey: key => keys.push(key.code),
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const source = fs.readFileSync('src/auto-login.js', 'utf8').replace(/^import[^;]+;\r?$/gm, '').replace(/export function /g, 'function ');
  vm.runInNewContext(source, context);
  return { win, keys, context, config, timers,
    toggle(value) { config.enableAutoLogin = value; listeners.enableAutoLogin({ detail: { newValue: value } }); },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const entry = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        const [id, t] = entry; now = t.at; timers.delete(id); t.fn();
      }
      now = end;
    },
    close() { win.close(); }
  };
}

test('disabled auto-login ignores ordinary and forced attempts', () => {
  const h = harness(false);
  try {
    h.context.attemptActiveBypass(); h.context.attemptActiveBypass(true); h.advance(3000);
    assert.deepEqual(h.keys, []);
    assert.equal(h.win.document.body.classList.contains('ytaf-bypassing-login'), false);
  } finally { h.close(); }
});

test('retired callbacks cannot cancel a newer attempt', () => {
  const h = harness();
  try {
    h.context.attemptActiveBypass();
    const retired = [...h.timers.values()].find(t => t.at === 500).fn;
    h.context.resetActiveBypass(); h.context.attemptActiveBypass();
    retired(); h.advance(3000);
    assert.deepEqual(h.keys, [13]);
  } finally { h.close(); }
});

test('unreadable identity fails without hiding the selector or sending keys', () => {
  const h = harness();
  try {
    h.win.Storage.prototype.getItem = () => { throw new Error('storage unavailable'); };
    h.context.attemptActiveBypass(); h.advance(3000);
    assert.deepEqual(h.keys, []);
    assert.equal(h.win.document.body.classList.contains('ytaf-bypassing-login'), false);
  } finally { h.close(); }
});

for (const guest of [false, true]) test('enabled login completes once: guest=' + guest, () => {
  const h = harness(true, guest);
  try {
    h.context.attemptActiveBypass(); h.context.attemptActiveBypass(); h.advance(3000);
    assert.deepEqual(h.keys, guest ? [40, 13] : [13]);
    assert.equal(h.win.document.body.classList.contains('ytaf-bypassing-login'), false);
  } finally { h.close(); }
});

for (const cause of ['disabled', 'page', 'account', 'reset', 'pagehide', 'user-key']) {
  test('pending guest Enter is cancelled on ' + cause, () => {
    const h = harness(true, true);
    try {
      h.context.attemptActiveBypass(); h.advance(500); assert.deepEqual(h.keys, [40]);
      if (cause === 'disabled') h.toggle(false);
      if (cause === 'page') h.win.document.body.className = 'WEB_PAGE_TYPE_WATCH';
      if (cause === 'account') h.win.localStorage.setItem('yt.leanback.default::last-identity-used', JSON.stringify({ data: { identityType: 'CORE_ID', effectiveObfuscatedGaiaId: 'different' } }));
      if (cause === 'reset') h.context.resetActiveBypass();
      if (cause === 'pagehide') h.win.dispatchEvent(new h.win.Event('pagehide'));
      if (cause === 'user-key') h.win.dispatchEvent(new h.win.KeyboardEvent('keydown', { keyCode: 40 }));
      h.advance(3000); assert.deepEqual(h.keys, [40]);
      assert.equal(h.win.document.body.classList.contains('ytaf-bypassing-login'), false);
    } finally { h.close(); }
  });
}

test('re-enable starts a new window and forced attempts never act outside the selector', () => {
  const h = harness();
  try {
    h.context.attemptActiveBypass(); h.toggle(false); h.toggle(true);
    h.context.attemptActiveBypass(); h.advance(3000); assert.deepEqual(h.keys, [13]);
    h.win.document.body.className = 'WEB_PAGE_TYPE_WATCH';
    h.context.attemptActiveBypass(true); h.advance(3000); assert.deepEqual(h.keys, [13]);
  } finally { h.close(); }
});

for (const guest of [false, true]) test('synchronous key navigation cleans up immediately: guest=' + guest, () => {
  const h = harness(true, guest);
  try {
    h.context.sendKey = key => {
      h.keys.push(key.code);
      h.win.history.replaceState(null, '', '/tv#/watch');
    };
    h.context.attemptActiveBypass(); h.advance(500);
    assert.deepEqual(h.keys, guest ? [40] : [13]);
    assert.equal(h.win.document.body.classList.contains('ytaf-bypassing-login'), false);
    h.advance(3000);
    assert.deepEqual(h.keys, guest ? [40] : [13]);
  } finally { h.close(); }
});

for (const guest of [false, true]) test('synchronous key reentry preserves the new attempt: guest=' + guest, () => {
  const h = harness(true, guest);
  try {
    h.context.sendKey = key => {
      h.keys.push(key.code);
      if (h.keys.length === 1) {
        h.context.resetActiveBypass();
        h.context.attemptActiveBypass();
      }
    };
    h.context.attemptActiveBypass(); h.advance(500);
    assert.equal(h.win.document.body.classList.contains('ytaf-bypassing-login'), true);
    h.advance(3000);
    assert.deepEqual(h.keys, guest ? [40, 40, 13] : [13, 13]);
    assert.equal(h.win.document.body.classList.contains('ytaf-bypassing-login'), false);
  } finally { h.close(); }
});
