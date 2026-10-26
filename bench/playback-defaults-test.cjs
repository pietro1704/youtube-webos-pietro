const assert = require('node:assert/strict');
const { boot } = require('./speed-hardware-test.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const { win, video } = boot(null);
  const player = win.document.getElementById('ytlr-player__player-container-player');
  let videoId = 'first';
  player.getVideoData = () => ({ video_id: videoId });
  win.document.body.className = 'WEB_PAGE_TYPE_BROWSE';
  await wait(40);
  win.ytaf_showOptionsPanel(true);
  const control = Array.from(win.document.querySelectorAll('.shortcut-control-row'))
    .find(row => row.textContent.includes('Default Speed'));
  assert.ok(control);
  control.click();
  await wait(250);
  assert.equal(JSON.parse(win.localStorage.getItem('ytaf-configuration')).defaultPlaybackSpeed, '2');
  const offer = win.JSON.parse(win.JSON.stringify({ streamingData: { adaptiveFormats: [
    { mimeType: 'audio/mp4; codecs="ac-3"', itag: 380 },
    { mimeType: 'audio/mp4; codecs="mp4a.40.2"', itag: 140 },
    { mimeType: 'video/mp4; codecs="av01.0.13M.08"', itag: 401 }
  ] } }));
  assert.ok(!offer.streamingData.adaptiveFormats.some(format => format.itag === 380),
    'the new-video offer must not choose AC-3 instead of compatible AAC at 2x');
  win.document.body.className = 'WEB_PAGE_TYPE_WATCH';
  await wait(40);
  player.loadVideoById(videoId, 0);
  assert.equal(video.playbackRate, 2, 'green-menu default must apply to the first video');
  videoId = 'second';
  player.loadVideoById(videoId, 0);
  assert.equal(video.playbackRate, 2, 'autoplay/new video must keep the default');
  // YouTube resets its own API to 1 during every new load. It must not persist
  // that internal reset as a user preference or replace the MSE speed.
  player.setPlaybackRate = () => {};
  await wait(1100);
  player.setPlaybackRate(1);
  await wait(250);
  assert.equal(win.__ytafSpeed.getSpeed(), 2, 'internal player reset must not change default');
  assert.equal(JSON.parse(win.localStorage.getItem('ytaf-configuration')).defaultPlaybackSpeed, '2');
  const audio = Array.from(win.document.querySelectorAll('.shortcut-control-row'))
    .find(row => row.textContent.includes('Audio offset'));
  assert.ok(audio, 'receiver audio offset must be reachable from the green menu');
  audio.click();
  await wait(250);
  assert.equal(JSON.parse(win.localStorage.getItem('ytaf-configuration')).audioSyncOffsetMs, '25');
  win.AudioContext = function () {
    this.state = 'running';
    this.currentTime = 0;
    this.createGain = () => ({ gain: { value: 1 }, connect() {} });
    this.close = () => { this.state = 'closed'; };
  };
  const ms = new win.MediaSource();
  video.src = win.URL.createObjectURL(ms);
  ms.addSourceBuffer('video/mp4; codecs="avc1"');
  ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  assert.equal(win.__ytafSpeed.diag().audio.offsetMs, 25,
    'a new audio pipeline must read the saved receiver adjustment');
  audio.click();
  assert.equal(win.__ytafSpeed.diag().audio.offsetMs, 50,
    'green-menu changes must reach the currently playing audio engine');
  win.close();
  console.log('playback defaults: green-menu change, first video, autoplay and internal reset passed');
})().catch(error => { console.error(error); process.exit(1); });
