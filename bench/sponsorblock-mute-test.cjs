const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

async function harness(mode = 'auto_skip') {
  const { createSegmentMuter } = await import('../src/sponsorblock-mute.js');
  const config = { enableMutedSegments: true, sbMode_sponsor: mode };
  const video = new EventTarget(); let muted = false;
  Object.assign(video, { currentTime: 5, duration: 100, paused: false, readyState: 4, seeking: false, volume: 0.7 });
  Object.defineProperty(video, 'muted', { get: () => muted, set(value) {
    if (muted !== value) { muted = value; video.dispatchEvent(new Event('volumechange')); }
  } });
  const ctx = {
    createSegmentMuter, configGetAll: () => config, configAddChangeListener() {}, configRemoveChangeListener() {},
    segmentTypes: {}, isLegacyWebOS: () => false, getVideo: () => video,
    sponsorBlockLabels: { update() {}, clear() {} }, sponsorBlockUI: { togglePopup() {}, updateSegments() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    showNotification: () => ({ remove() {} })
  };
  vm.runInNewContext(fs.readFileSync('src/sponsorblock.js', 'utf8').replace(/^import[^;]+;\r?$/gm, '') + '\nglobalThis.Handler = SponsorBlockHandler;', ctx);
  ctx.window = { removeEventListener() {} };
  const h = new ctx.Handler('test'); h.video = video;
  h.segments = [{ category: 'sponsor', actionType: 'mute', segment: [10, 20] }]; h.rebuildSkipSegments();
  return { h, video, config };
}

test('real handler mutes without seeking and keeps tracking until mute ends', async () => {
  const { h, video } = await harness();
  try {
    assert.equal(h.isTimeListenerActive, true);
    video.currentTime = 12; h.handleTimeUpdate(); assert.equal(video.muted, true); assert.equal(video.currentTime, 12);
    video.currentTime = 20; h.handleTimeUpdate(); assert.equal(video.muted, false);
  } finally { h.destroy(); }
});

test('live disable and destroy restore only owned mute', async () => {
  const { h, video, config } = await harness();
  try {
    video.currentTime = 12; h.handleTimeUpdate(); assert.equal(video.muted, true);
    config.enableMutedSegments = false; h.boundConfigUpdate(); assert.equal(video.muted, false);
    config.enableMutedSegments = true; h.boundConfigUpdate(); assert.equal(video.muted, true);
    h.destroy(); assert.equal(video.muted, false);
  } finally { h.destroy(); }
});

test('manual mute uses Blue without seeking', async () => {
  const { h, video } = await harness('manual_skip');
  try {
    video.currentTime = 12; h.handleTimeUpdate(); assert.equal(video.muted, false);
    assert.equal(h.currentManualSegment?.actionType, 'mute');
    assert.equal(h.handleBlueButton(), true); assert.equal(video.muted, true); assert.equal(video.currentTime, 12);
    video.currentTime = 20; h.handleTimeUpdate(); assert.equal(video.muted, false);
  } finally { h.destroy(); }
});

for (const mode of ['disable', 'seek_bar']) test('mute respects category mode ' + mode, async () => {
  const { h, video } = await harness(mode);
  try { video.currentTime = 12; h.handleTimeUpdate(); assert.equal(video.muted, false); }
  finally { h.destroy(); }
});

test('an automatic seek out of a mute interval restores audio before seeked arrives', async () => {
  const { h, video } = await harness();
  try {
    h.segments.push({ category: 'sponsor', actionType: 'skip', segment: [10, 30] }); h.rebuildSkipSegments();
    video.currentTime = 12; h.handleTimeUpdate();
    assert.equal(video.currentTime, 30); assert.equal(video.muted, false);
  } finally { h.destroy(); }
});
