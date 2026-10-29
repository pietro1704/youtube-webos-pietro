import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSegmentMuter } from '../src/sponsorblock-mute.js';

function video(muted = false) {
  const el = new EventTarget(); let value = muted;
  Object.assign(el, { currentTime: 5, volume: 0.7, paused: false });
  Object.defineProperty(el, 'muted', { get: () => value, set(next) {
    if (value === next) return;
    value = next; el.dispatchEvent(new Event('volumechange'));
  } });
  return el;
}
const seg = (start, end, originalIndex = 0, mode = 'auto_skip') => ({ start, end, originalIndex, mode, actionType: 'mute' });

test('automatic mute restores only its own mute and preserves volume', () => {
  const m = createSegmentMuter(), v = video(); m.setSegments([seg(10, 20)]);
  m.update(v); assert.equal(v.muted, false); assert.equal(m.hasUpcoming(v), true);
  v.currentTime = 12; m.update(v); assert.equal(v.muted, true);
  v.volume = 0.4; v.dispatchEvent(new Event('volumechange'));
  v.currentTime = 20; m.update(v);
  assert.equal(v.muted, false); assert.equal(v.volume, 0.4); assert.equal(m.hasUpcoming(v), false);
  m.destroy();
});

test('pre-existing mute remains muted on exit and destruction', () => {
  const m = createSegmentMuter(), v = video(true); m.setSegments([seg(10, 20)]);
  v.currentTime = 12; m.update(v); v.currentTime = 25; m.update(v); m.destroy();
  assert.equal(v.muted, true);
});

test('overlapping and adjacent intervals remain muted until the entire region ends', () => {
  const m = createSegmentMuter(), v = video(); m.setSegments([seg(10, 30), seg(20, 40, 1), seg(40, 50, 2)]);
  for (const at of [10, 25, 30, 40, 49.99]) { v.currentTime = at; m.update(v); assert.equal(v.muted, true); }
  v.currentTime = 50; m.update(v); assert.equal(v.muted, false); m.destroy();
});

test('user unmute overrides an overlapping mute region without being overwritten', () => {
  const m = createSegmentMuter(), v = video(); m.setSegments([seg(10, 30), seg(20, 40, 1)]);
  v.currentTime = 12; m.update(v); v.muted = false;
  for (const at of [15, 25, 35, 40]) { v.currentTime = at; m.update(v); assert.equal(v.muted, false); }
  v.currentTime = 12; m.update(v); assert.equal(v.muted, true, 'a later visit starts a new region'); m.destroy();
});

test('user mute following an explicit unmute is preserved', () => {
  const m = createSegmentMuter(), v = video(); m.setSegments([seg(10, 20)]);
  v.currentTime = 12; m.update(v); v.muted = false; v.muted = true;
  v.currentTime = 25; m.update(v); m.destroy(); assert.equal(v.muted, true);
});

test('manual mute requires activation and never changes playback position', () => {
  const m = createSegmentMuter(), v = video(), s = seg(10, 20, 0, 'manual_skip'); m.setSegments([s]);
  v.currentTime = 12; assert.equal(m.update(v), s); assert.equal(v.muted, false);
  assert.equal(m.activateManual(s), true); assert.equal(v.muted, true); assert.equal(v.currentTime, 12);
  assert.equal(m.update(v), null);
  v.currentTime = 20; m.update(v); assert.equal(v.muted, false);
  assert.equal(m.activateManual(s), false); m.destroy();
});

for (const action of ['disable', 'destroy', 'replacement', 'seek', 'paused-seek']) test('owned mute is released on ' + action, () => {
  const m = createSegmentMuter(), v = video(); m.setSegments([seg(10, 20)]); v.currentTime = 12; m.update(v);
  if (action === 'disable') { m.setSegments([]); m.update(v); }
  if (action === 'destroy') m.destroy();
  if (action === 'replacement') { const next = video(true); m.update(next); assert.equal(next.muted, true); }
  if (action === 'seek' || action === 'paused-seek') { v.paused = action === 'paused-seek'; v.currentTime = 5; m.update(v); }
  assert.equal(v.muted, false); assert.equal(v.volume, 0.7); m.destroy();
});

test('reconfiguration preserves an active user override and rejects retired manual commands', () => {
  const m = createSegmentMuter(), v = video(); const s = seg(10, 20);
  m.setSegments([s]); v.currentTime = 12; m.update(v); v.muted = false;
  m.setSegments([{ ...s }]); m.update(v); assert.equal(v.muted, false);
  const manual = seg(10, 20, 1, 'manual_skip'); m.setSegments([manual]); m.update(v);
  m.setSegments([]); m.update(v); assert.equal(m.activateManual(manual), false);
  m.destroy();
});
