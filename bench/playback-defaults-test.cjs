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
  win.close();
  console.log('playback defaults: green-menu change, first video, autoplay and internal reset passed');
})().catch(error => { console.error(error); process.exit(1); });
