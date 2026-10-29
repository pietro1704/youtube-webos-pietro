const assert = require('node:assert/strict');
const { boot } = require('./speed-hardware-test.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const { win, video } = boot(null);
  try {
    const player = win.document.getElementById('ytlr-player__player-container-player');
    let at = 42, state = 1;
    Object.defineProperty(video, 'currentTime', { get: () => at, set: value => { at = value; }, configurable: true });
    player.getPlayerState = () => state;
    player.pauseVideo = () => { state = 2; video.pause(); };
    const load = player.loadVideoById;
    const calls = [];
    player.loadVideoById = (id, position) => { calls.push([id, position]); load(id, position); state = 1; video.play(); };
    const speed = win.__ytafSpeed;
    speed.setSpeed(2, { notify: false }); at = 300;
    await wait(950);
    assert.equal(calls.length, 1); assert.equal(calls[0][1], 300);
    assert.equal(video.playbackRate, 2, 'actual MSE timeline applies the selected speed');
    state = 2; video.pause();
    speed.setSpeed(1.5, { notify: false }); await wait(950);
    assert.equal(state, 2, 'paused user intent survives the real bundle reload');
    assert.equal(video.paused, true);
    assert.equal(video.playbackRate, 1.5);
    const successfulLoad = player.loadVideoById;
    player.loadVideoById = () => { throw new Error('player load rejected'); };
    speed.setSpeed(2, { notify: false }); await wait(1200);
    assert.equal(speed.getSpeed(), 1.5);
    assert.equal(video.playbackRate, 1.5, 'failure preserves the existing timeline');
    assert.equal(JSON.parse(win.localStorage.getItem('ytaf-configuration')).defaultPlaybackSpeed, '1.5');
    player.loadVideoById = successfulLoad;
    player.setPlaybackQualityRange = () => { throw new Error('quality not ready'); };
    speed.setSpeed(2, { notify: false }); await wait(950);
    assert.equal(speed.getSpeed(), 2); assert.equal(video.playbackRate, 2);
    assert.equal(state, 2);
    const count = calls.length;
    speed.setSpeed(1.5, { notify: false });
    const replacement = player.cloneNode(false);
    for (const key of ['getCurrentTime', 'getVideoData', 'getPlayerState', 'pauseVideo', 'loadVideoById']) replacement[key] = player[key];
    player.parentNode.replaceChild(replacement, player);
    await wait(950);
    assert.equal(calls.length, count, 'same-video replacement must not receive the old reload');
    console.log('speed transition UI: current seek, pause, load rollback, quality fallback and replacement identity passed');
  } finally { win.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
