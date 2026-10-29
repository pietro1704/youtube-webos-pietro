const assert = require('node:assert/strict');
const { boot } = require('./speed-hardware-test.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const { win, video } = boot(null, { enableSponsorBlock: true, enableMutedSegments: true,
    sbMode_sponsor: 'auto_skip', defaultPlaybackSpeed: '2' });
  try {
    win.history.replaceState(null, '', '#/watch?v=speed-test');
    let at = 0, gain;
    Object.defineProperty(video, 'currentTime', { get: () => at, set: v => { at = v; }, configurable: true });
    Object.defineProperty(video, 'duration', { get: () => 100, configurable: true });
    win.AudioContext = class {
      state = 'running'; currentTime = 0;
      createGain() { gain = { gain: { value: 1 }, connect() {}, disconnect() {} }; return gain; }
      close() { this.state = 'closed'; }
    };
    const ms = new win.MediaSource(); video.src = win.URL.createObjectURL(ms);
    ms.addSourceBuffer('video/mp4; codecs="avc1"'); ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    assert.ok(gain, 'actual accelerated audio engine is attached');
    video.currentTime = 5;
    const bar = win.document.createElement('ytlr-progress-bar'); bar.innerHTML = '<div idomkey="slider"></div>';
    win.document.body.appendChild(bar);
    win.fetch = async () => ({ ok: true, json: async () => [{ videoID: 'speed-test', segments: [
      { category: 'sponsor', actionType: 'mute', segment: [10, 20] },
      { category: 'sponsor', actionType: 'mute', segment: [15, 25] }
    ] }] });
    await wait(750);
    video.currentTime = 12; video.dispatchEvent(new win.Event('timeupdate')); await wait(30);
    assert.equal(video.currentTime, 12, 'mute never seeks');
    assert.equal(video.muted, true); assert.equal(gain.gain.value, 0, 'accelerated output is muted too');
    video.volume = 0.4;
    video.currentTime = 22; video.dispatchEvent(new win.Event('timeupdate')); await wait(30);
    assert.equal(video.muted, true, 'overlapping mute persists');
    video.currentTime = 25; video.dispatchEvent(new win.Event('timeupdate')); await wait(30);
    assert.equal(video.muted, false); assert.equal(gain.gain.value, 0.4);
    video.currentTime = 12; video.dispatchEvent(new win.Event('seeked')); await wait(30);
    assert.equal(video.muted, true);
    win.ytaf_showOptionsPanel(true); win.document.querySelectorAll('.ytaf-tab-btn')[1].click();
    const checkbox = [...win.document.querySelectorAll('label')].find(el => el.textContent.includes('mute audio'))?.querySelector('input');
    assert.ok(checkbox?.checked, 'muted-segment setting is reachable');
    checkbox.click(); await wait(30);
    assert.equal(video.muted, false); assert.equal(gain.gain.value, 0.4);
    checkbox.click(); await wait(30); assert.equal(video.muted, true);
    video.muted = false; await wait(30);
    video.currentTime = 18; video.dispatchEvent(new win.Event('timeupdate')); assert.equal(video.muted, false, 'user unmute wins');
    win.sponsorblock.destroy(); assert.equal(video.muted, false); assert.equal(video.volume, 0.4);
    console.log('SponsorBlock mute UI: overlap, seek, live toggle, user override and accelerated audio gain passed');
  } finally { win.sponsorblock?.destroy(); win.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
