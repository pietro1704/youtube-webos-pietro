const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
let dependencies;
before(async () => {
  dependencies = { ...await import('../src/playback-preferences.js'), ...await import('../src/watched/preferences.js'),
    ...await import('../src/captions/preferences.js') };
});
function harness({ raw = null, readFails = false, getterFails = false, writeFails = false } = {}) {
  const timers = new Map(), events = {}, writes = [];
  let serial = 0;
  const storage = {
    getItem() { if (readFails) throw new Error('SecurityError'); return raw; },
    setItem(key, value) { if (writeFails) throw new Error('QuotaExceededError'); writes.push([key, value]); }
  };
  const win = { addEventListener(key, fn) { events[key] = fn; } };
  Object.defineProperty(win, 'localStorage', { get() { if (getterFails) throw new Error('SecurityError'); return storage; } });
  const context = { ...dependencies, window: win, console,
    setTimeout(fn) { const id = ++serial; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
  const source = fs.readFileSync('src/config.js', 'utf8').replace(/^import[^;]+;\r?$/gm, '').replace(/export (const|function) /g, '$1 ');
  vm.runInNewContext(source + '\nglobalThis.api = { configRead, configWrite, configGetAll, configGetDefault, configAddChangeListener };', context);
  return { ...context.api, writes, timers, events,
    allowWrites() { writeFails = false; },
    flush() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } } };
}
for (const kind of ['readFails', 'getterFails']) test('configuration initializes with defaults on ' + kind, () => {
  const h = harness({ [kind]: true }); assert.equal(h.configRead('enableAdBlock'), true); assert.equal(h.configRead('preferredVideoQuality'), 'auto');
});
for (const raw of ['{', '[]', '42', 'false', '"invalid"', 'null']) test('malformed/non-object storage preserves defaults: ' + raw, () => {
  const h = harness({ raw }); assert.equal(h.configRead('enableAutoLogin'), true); assert.equal(h.configRead('defaultPlaybackSpeed'), '1');
});

test('invalid stored types and enums fall back independently while valid preferences survive', () => {
  const h = harness({ raw: JSON.stringify({ enableAdBlock: 'false', enableAutoLogin: false, enableMutedSegments: [],
    uiTheme: 'unknown', logoStyle: {}, forceVideoCodec: 'unknown', forcePreviews: 5,
    thumbnailQualityMode: 'unknown', sbMode_sponsor: 'unknown', shortcut_key_green: 'unknown',
    videoShelfOpacity: -1, captionLanguage: {}, sponsorColor: 'url(secret)', preferredVideoQuality: 'hd720',
    hiddenSidebarItems: 'invalid', sidebarOrder: ['FEsubscriptions', 42, null], captionSavedStyle: ['wrong'] }) });
  for (const key of ['enableAdBlock', 'enableMutedSegments', 'uiTheme', 'logoStyle', 'forceVideoCodec', 'forcePreviews',
    'thumbnailQualityMode', 'sbMode_sponsor', 'shortcut_key_green', 'videoShelfOpacity', 'captionLanguage', 'sponsorColor'])
    assert.equal(h.configRead(key), h.configGetDefault(key), key);
  assert.equal(h.configRead('enableAutoLogin'), false); assert.equal(h.configRead('preferredVideoQuality'), 'hd720');
  assert.deepEqual(Array.from(h.configRead('hiddenSidebarItems')), []);
  assert.deepEqual(Array.from(h.configRead('sidebarOrder')), ['FEsubscriptions']);
  assert.equal(h.configRead('captionSavedStyle'), null);
});

test('valid arrays, language, color and native caption style are retained with safe shape', () => {
  const h = harness({ raw: JSON.stringify({ hiddenSidebarItems: ['FElibrary'], captionLanguage: 'pt-BR',
    sponsorColor: '#ABCDEF', videoShelfOpacity: 42.5, captionSavedStyle: { color: '#fff', colorOverride: true, unknown: 'discard' } }) });
  assert.deepEqual(Array.from(h.configRead('hiddenSidebarItems')), ['FElibrary']);
  assert.equal(h.configRead('captionLanguage'), 'pt-BR'); assert.equal(h.configRead('sponsorColor'), '#ABCDEF');
  assert.equal(h.configRead('videoShelfOpacity'), 42.5);
  assert.deepEqual(JSON.parse(JSON.stringify(h.configRead('captionSavedStyle'))), { color: '#fff', colorOverride: true });
});

for (const explicit of [false, true]) test('legacy force-high-resolution migration respects explicit choices: ' + explicit, () => {
  const saved = { forceHighResVideo: true }; if (explicit) saved.preferredVideoQuality = 'hd720';
  const h = harness({ raw: JSON.stringify(saved) }); assert.equal(h.configRead('preferredVideoQuality'), explicit ? 'hd720' : 'hd2160');
});

test('write failure leaves the live config usable and later persistence can recover', () => {
  const h = harness({ writeFails: true }), live = h.configGetAll(), seen = [];
  h.configAddChangeListener('enableMutedSegments', evt => seen.push(evt.detail.newValue));
  h.configWrite('enableMutedSegments', true); assert.doesNotThrow(h.flush);
  assert.equal(h.configRead('enableMutedSegments'), true); assert.equal(h.writes.length, 0);
  h.allowWrites(); h.configWrite('enableMutedSegments', false); h.flush();
  assert.equal(h.configGetAll(), live); assert.deepEqual(seen, [true, false]);
  assert.equal(JSON.parse(h.writes[0][1]).enableMutedSegments, false);
});

test('writes normalize values before listeners and pagehide flush cancels the pending timer', () => {
  const h = harness(), seen = [];
  h.configAddChangeListener('videoShelfOpacity', evt => seen.push(evt.detail.newValue));
  h.configWrite('videoShelfOpacity', 50); h.configWrite('videoShelfOpacity', Infinity);
  assert.equal(h.configRead('videoShelfOpacity'), 100); assert.deepEqual(seen, [50, 100]);
  h.events.pagehide(); assert.equal(h.timers.size, 0); assert.equal(h.writes.length, 1); h.flush(); assert.equal(h.writes.length, 1);
});
