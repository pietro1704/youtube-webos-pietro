const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
let createSegmentMuter;
before(async () => { ({ createSegmentMuter } = await import('../src/sponsorblock-mute.js')); });

function harness(segments = []) {
  const config = { sbMode_sponsor: 'auto_skip', sbMode_intro: 'manual_skip' };
  const notices = [];
  const context = {
    createSegmentMuter,
    configGetAll: () => config, configAddChangeListener() {}, configRemoveChangeListener() {},
    segmentTypes: {}, isLegacyWebOS: () => false, getVideo: () => null,
    sponsorBlockLabels: { update() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {},
    showNotification(text) { notices.push(text); return { remove() {} }; }
  };
  vm.runInNewContext(fs.readFileSync('src/sponsorblock.js', 'utf8').replace(/^import[^;]+;\r?$/gm, '') + '\nglobalThis.Handler = SponsorBlockHandler;', context);
  const h = new context.Handler('test');
  h.video = { currentTime: 50, readyState: 4, duration: 150, paused: false, seeking: false, addEventListener() {}, removeEventListener() {} };
  h.segments = segments; h.rebuildSkipSegments();
  return { h, config, notices };
}
const segment = (start, end, category = 'sponsor', actionType = 'skip') => ({ segment: [start, end], category, actionType });

for (const time of [0, 20, 50, 99.999]) test('outer interval remains discoverable at ' + time, () => {
  const { h } = harness([segment(0, 100), segment(10, 20), segment(30, 40)]);
  const index = h.findSegmentAtTime(time);
  assert.equal(index, 0);
});

for (const time of [-1, 100, 150]) test('half-open interval excludes ' + time, () => {
  const { h } = harness([segment(0, 100), segment(10, 20), segment(30, 40)]);
  assert.equal(h.findSegmentAtTime(time), -1);
});

test('adjacent segment owns its exact start and equal starts preserve manual choice', () => {
  const { h } = harness([segment(0, 10), segment(10, 20), segment(10, 30, 'intro')]);
  assert.equal(h.findSegmentAtTime(10), 2, 'active manual mode takes precedence over automatic overlap');
  assert.equal(h.findSegmentAtTime(30), -1);
});

test('manual interval within an automatic interval is not skipped or merged', () => {
  const { h } = harness([segment(0, 100), segment(10, 20, 'intro')]);
  h.video.currentTime = 15; h.resetSegmentTracking(); h.handleTimeUpdate();
  assert.equal(h.video.currentTime, 15);
  assert.equal(h.currentManualSegment?.start, 10);
});

test('an earlier automatic interval resumes after the nested manual interval ends', () => {
  const { h } = harness([segment(0, 100), segment(10, 20, 'intro'), segment(30, 40, 'intro')]);
  h.video.currentTime = 50; h.resetSegmentTracking(); h.handleTimeUpdate();
  assert.equal(h.video.currentTime, 100);
});

test('automatic overlap stops before a future manual decision', () => {
  const { h } = harness([segment(0, 100), segment(10, 20), segment(80, 90, 'intro')]);
  h.video.currentTime = 50; h.resetSegmentTracking(); h.handleTimeUpdate();
  assert.equal(h.video.currentTime, 80);
  h.isSkipping = false; h.handleTimeUpdate();
  assert.equal(h.currentManualSegment?.start, 80);
  assert.equal(h.video.currentTime, 80);
});

test('mute actions are never converted into seeks or merged with skip decisions', () => {
  const { h } = harness([segment(0, 100), segment(10, 120, 'sponsor', 'mute'), segment(30, 40)]);
  assert.equal(h.skipSegments.length, 2);
  h.video.currentTime = 50; h.resetSegmentTracking(); h.handleTimeUpdate();
  assert.equal(h.video.currentTime, 100);
});

test('prediction cannot hide a manual segment nested within an active automatic one', () => {
  const { h } = harness([segment(0, 100), segment(10, 20, 'intro')]);
  h.video.currentTime = 15; h.nextSegmentIndex = 0; h.nextSegmentStart = 0;
  h.handleTimeUpdate();
  assert.equal(h.video.currentTime, 15);
  assert.equal(h.currentManualSegment?.start, 10);
});

test('skip-once does not retire an enclosing interval after only skipping up to a manual boundary', () => {
  const { h, config } = harness([segment(0, 100), segment(10, 20, 'intro')]);
  config.skipSegmentsOnce = true;
  h.video.currentTime = 5; h.resetSegmentTracking(); h.handleTimeUpdate();
  assert.equal(h.video.currentTime, 10);
  assert.equal(h.skippedSegmentIndices.has(0), false);
  h.isSkipping = false; h.video.currentTime = 25; h.resetSegmentTracking(); h.handleTimeUpdate();
  assert.equal(h.video.currentTime, 100);
  assert.equal(h.skippedSegmentIndices.has(0), true);
  h.isSkipping = false; h.video.currentTime = 25; h.resetSegmentTracking(); h.handleTimeUpdate();
  assert.equal(h.video.currentTime, 25);
});
