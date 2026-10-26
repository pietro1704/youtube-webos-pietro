import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCaptionController } from '../src/captions/controller.js';
import { selectCaptionTrack, captionAppearance, sanitizeCaptionStyle, captionTranslations } from '../src/captions/preferences.js';
function harness() {
  let id = 'aaaaaaaaaaa', account = 'A', watching = true;
  const timers = new Map(); let next = 0;
  const calls = [], status = [];
  const pref = { enabled: true, language: 'pt', size: '2', style: 'yellow', savedStyle: null, translate: false };
  let actual = {}, appearance = { fontSizeIncrement: 0, color: '#fff' };
  const tracks = [{ languageCode: 'en', is_translateable: true, vss_id: '.en' }, { languageCode: 'pt', vss_id: '.pt' }];
  let player = { getSubtitlesUserSettings: () => appearance,
    updateSubtitlesUserSettings(style) { calls.push(['style', style]); appearance = style; },
    getOption(_module, key) { return key === 'tracklist' ? tracks : key === 'track' ? actual : [{ languageCode: 'es', languageName: 'Spanish' }]; },
    setOption(_module, _key, track) { actual = track; calls.push(['track', track]); } };
  const ctrl = createCaptionController({ win: { setTimeout(fn) { timers.set(++next, fn); return next; }, clearTimeout(key) { timers.delete(key); } },
    getPlayer: () => player, getVideoId: () => id, getIdentity: () => account, isWatching: () => watching,
    preferences: () => pref, report: text => status.push(text) });
  return { ctrl, pref, calls, tracks, status, player, flush() { for (const fn of timers.values()) fn(); timers.clear(); },
    video(value) { id = value; }, account(value) { account = value; }, watching(value) { watching = value; }, replace() { player = { ...player }; } };
}
test('apply real native language, size and style, then restore on the next video', () => {
  const h = harness(); h.ctrl.schedule(); h.flush();
  assert.equal(h.calls[0][1].fontSizeIncrement, 2); assert.equal(h.calls[0][1].color, '#ffff00');
  assert.equal(h.calls[1][1].vss_id, '.pt');
  h.calls.length = 0; h.ctrl.schedule(); h.flush(); assert.equal(h.calls.length, 0);
  h.video('bbbbbbbbbbb'); h.ctrl.schedule(); h.flush(); assert.equal(h.calls[0][0], 'track');
});
test('translation requires an offered target and a compatible source', () => {
  const h = harness();
  assert.equal(selectCaptionTrack(h.player, 'es', false), null);
  assert.equal(selectCaptionTrack(h.player, 'de', true), null);
  assert.equal(selectCaptionTrack(h.player, 'es', true).translationLanguage.languageCode, 'es');
  h.tracks[0].is_translateable = false; assert.equal(selectCaptionTrack(h.player, 'es', true), null);
});
for (const reason of ['disable', 'video', 'account', 'player', 'leave', 'cancel', 'destroy']) {
  test(`scheduled captions cannot act after ${reason}`, () => {
    const h = harness(); h.ctrl.schedule();
    if (reason === 'disable') h.pref.enabled = false;
    if (reason === 'video') h.video('next');
    if (reason === 'account') h.account('B');
    if (reason === 'player') h.replace();
    if (reason === 'leave') h.watching(false);
    if (reason === 'cancel') h.ctrl.cancel();
    if (reason === 'destroy') h.ctrl.destroy();
    h.flush(); assert.deepEqual(h.calls, []);
  });
}
test('missing capabilities, native errors and unavailable tracks do not erase preferences', () => {
  const h = harness(); h.pref.language = 'missing'; h.ctrl.schedule(); h.flush();
  assert.equal(h.calls.filter(call => call[0] === 'track').length, 0); assert.equal(h.pref.language, 'missing');
  h.player.getSubtitlesUserSettings = () => { throw Error('unsupported'); }; h.ctrl.schedule(); h.flush();
  assert.match(h.status[h.status.length - 1], /Unable/);
});
test('native appearance is sanitized and can be retained without injecting arbitrary fields', () => {
  const raw = { fontSizeIncrement: 1, fontStyle: 2, evil: { key: 1 } };
  assert.deepEqual(sanitizeCaptionStyle(raw), { fontSizeIncrement: 1, fontStyle: 2 });
  assert.deepEqual(captionAppearance({}, { savedStyle: raw, size: 'native', style: 'saved' }), { fontSizeIncrement: 1, fontStyle: 2 });
});

test('changing a preference cancels the previously scheduled snapshot', () => {
  const h = harness(); h.ctrl.schedule(); h.pref.size = '4'; h.flush(); assert.deepEqual(h.calls, []);
});
test('a replacement player with the same video still receives the preference', () => {
  const h = harness(); h.ctrl.schedule(); h.flush(); h.calls.length = 0;
  h.replace(); h.ctrl.schedule(); h.flush(); assert.ok(h.calls.some(call => call[0] === 'track'));
});

test('a slow native caption fetch is not restarted by every readiness check', () => {
  const h = harness(); let ready = false, selected = null;
  const original = h.player.getOption;
  h.player.getOption = (module, key, arg) => key === 'track' ? (ready ? selected : {}) : original(module, key, arg);
  h.player.setOption = (_module, _key, track) => { selected = track; h.calls.push(['track', track]); };
  h.ctrl.schedule(); h.flush(); h.ctrl.schedule(); h.flush();
  assert.equal(h.calls.filter(call => call[0] === 'track').length, 1, 'keep the native request alive while it loads');
  ready = true; h.ctrl.schedule(); h.flush(); assert.equal(h.status[h.status.length - 1], 'Caption preferences applied');
});

test('translation targets with no compatible source are not offered', () => {
  const h = harness(); const original = h.player.getOption;
  h.player.getOption = (module, key, arg) => key === 'translationLanguages' ? [{ languageCode: 'es', translationSourceTrackIndices: [1] }, {}] : original(module, key, arg);
  assert.deepEqual(captionTranslations(h.player), []);
});
