const assert = require('node:assert/strict');
const { boot } = require('./dependency-test.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const { win } = boot({ enableSponsorBlock: true, sbMode_sponsor: 'auto_skip', sbMode_intro: 'manual_skip' });
  try {
    win.history.replaceState(null, '', '#/watch?v=overlap');
    win.document.body.className = 'WEB_PAGE_TYPE_WATCH';
    const video = win.document.createElement('video');
    for (const [key, value] of Object.entries({ duration: 150, readyState: 4, paused: false, seeking: false }))
      Object.defineProperty(video, key, { configurable: true, value });
    video.currentTime = 50; win.document.body.appendChild(video);
    const bar = win.document.createElement('ytlr-progress-bar'); bar.innerHTML = '<div idomkey="slider"></div>';
    win.document.body.appendChild(bar);
    win.fetch = async () => ({ ok: true, json: async () => [{ videoID: 'overlap', segments: [
      { category: 'sponsor', actionType: 'skip', segment: [0, 100] },
      { category: 'intro', actionType: 'skip', segment: [10, 20] },
      { category: 'sponsor', actionType: 'mute', segment: [10, 120] },
      { category: 'intro', actionType: 'skip', segment: [30, 40] }
    ] }] });
    await wait(750);
    video.dispatchEvent(new win.Event('timeupdate'));
    assert.equal(video.currentTime, 100, 'enclosing automatic interval survives expired nested manual intervals');
    video.dispatchEvent(new win.Event('seeked'));
    video.currentTime = 15; video.dispatchEvent(new win.Event('seeked'));
    assert.equal(video.currentTime, 15);
    assert.equal(win.sponsorblock.currentManualSegment?.start, 10);
    video.currentTime = 50; video.dispatchEvent(new win.Event('seeked'));
    assert.equal(video.currentTime, 100, 'seeking out of the manual overlap restores automatic handling');
    video.dispatchEvent(new win.Event('seeked'));
    video.currentTime = 5; video.dispatchEvent(new win.Event('seeked'));
    assert.equal(video.currentTime, 10, 'automatic skip stops at the next manual decision');
    console.log('SponsorBlock overlap UI: enclosing intervals, nested manual choice, seek and mute separation passed');
  } finally { win.sponsorblock?.destroy(); win.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
