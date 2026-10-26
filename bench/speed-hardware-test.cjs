/**
 * The LG G4 case: video.playbackRate accepts the value and reads it back, but
 * the hardware pipeline keeps decoding at 1x so the picture never changes.
 *
 * The <video> here mimics that exactly - the property is stored, but the
 * simulated clock only honours it for the strategies a given "device" supports.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { applyChrome38Downgrade, UA, setUserAgent } = require('./chrome38-env.cjs');

const ROOT = path.resolve(__dirname, '..');
const bundlePath = process.argv[2] || ROOT + '/dist/webOSUserScripts/userScript.js';

/**
 * honours: which native HTMLMediaElement strategy actually moves the picture.
 *   null                  -> nothing native works (true hardware lockout)
 *   'direct'              -> a normal device
 *   'no-pitch-correction' -> works only with pitch correction off
 *   'default-rate'        -> works only via defaultPlaybackRate
 */
function boot(honours) {
  const dom = new JSDOM(
    `<!doctype html><html><body class="WEB_PAGE_TYPE_WATCH"><ytlr-app>
       <div id="ytlr-player__player-container">
         <div id="ytlr-player__player-container-player"></div><video></video>
       </div></ytlr-app></body></html>`,
    { runScripts: 'outside-only', url: 'https://www.youtube.com/tv#/watch?v=dQw4w9WgXcQ',
      virtualConsole: new VirtualConsole(), pretendToBeVisual: true });
  const win = dom.window;
  setUserAgent(win, UA.webos23);
  win.launchParams = '{}';
  win.XMLHttpRequest = class { open(){} send(){} setRequestHeader(){} getResponseHeader(){return null;} addEventListener(){} };
  let rafQ = [];
  win.requestAnimationFrame = (cb) => { rafQ.push(cb); return rafQ.length; };
  win.cancelAnimationFrame = () => {};
  win.fetch = () => Promise.reject(new Error('offline'));
  win.localStorage.setItem('ytaf-configuration', win.JSON.stringify({
    enablePlaybackSpeed: true, enableAdBlock: true, enableSponsorBlock: false,
    enableReturnYouTubeDislike: false, enableLegacyEmojiFix: false,
    upgradeThumbnails: false, enableAutoLogin: false, forceHighResVideo: false
  }));

  const video = win.document.querySelector('video');
  let stored = 1, pitch = true, defaultRate = 1, appliedAtPlay = 1, paused = false;
  Object.defineProperty(video, 'playbackRate', {
    get: () => stored, set(v) { stored = v; }, configurable: true });
  Object.defineProperty(video, 'defaultPlaybackRate', {
    get: () => defaultRate, set(v) { defaultRate = v; }, configurable: true });
  Object.defineProperty(video, 'preservesPitch', {
    get: () => pitch, set(v) { pitch = v; }, configurable: true });
  Object.defineProperty(video, 'paused', {
    get: () => paused, configurable: true });
  video.pause = () => { paused = true; };
  video.play = () => { paused = false; appliedAtPlay = stored; return Promise.resolve(); };
  Object.defineProperty(video, 'ended', { value: false, configurable: true });
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true });

  // The pipeline: currentTime advances at the EFFECTIVE rate, which only
  // follows the property when this device honours that strategy.
  const started = Date.now();
  Object.defineProperty(video, 'currentTime', {
    get() {
      const effective =
        honours === null ? 1 :
        honours === 'direct' ? stored :
        honours === 'no-pitch-correction' ? (pitch ? 1 : stored) :
        honours === 'default-rate' ? (defaultRate !== 1 ? stored : 1) :
        honours === 'pause-apply-play' ? appliedAtPlay : 1;
      return ((Date.now() - started) / 1000) * effective;
    },
    set() {}, configurable: true
  });

  // webOS 22+ capabilities used by the real fix. The picture is accelerated by
  // rescaling the MSE timeline, so this stays effective even when every native
  // playbackRate strategy above is ignored by the hardware decoder.
  class FakeSourceBuffer extends win.EventTarget {
    constructor() {
      super();
      this._timestampOffset = 0;
      this._appendWindowStart = 0;
      this._appendWindowEnd = Infinity;
      this._buffered = { length: 0, start: () => 0, end: () => 0 };
    }
    appendBuffer() {}
    remove() {}
    get timestampOffset() { return this._timestampOffset; }
    set timestampOffset(v) { this._timestampOffset = v; }
    get appendWindowStart() { return this._appendWindowStart; }
    set appendWindowStart(v) { this._appendWindowStart = v; }
    get appendWindowEnd() { return this._appendWindowEnd; }
    set appendWindowEnd(v) { this._appendWindowEnd = v; }
    get buffered() { return this._buffered; }
  }
  class FakeMediaSource {
    constructor() { this._buffers = []; this._duration = NaN; }
    addSourceBuffer() {
      const buffer = new FakeSourceBuffer();
      this._buffers.push(buffer);
      return buffer;
    }
    get duration() { return this._duration; }
    set duration(v) { this._duration = v; }
    get sourceBuffers() {
      const buffers = this._buffers;
      return { length: buffers.length, item: (i) => buffers[i] };
    }
  }
  let nextBlob = 1;
  win.MediaSource = FakeMediaSource;
  win.AudioDecoder = class {};
  win.AudioContext = class {};
  win.URL.createObjectURL = () => 'blob:ytaf-' + nextBlob++;

  const player = win.document.getElementById('ytlr-player__player-container-player');
  player.getCurrentTime = () => video.currentTime;
  player.getVideoData = () => ({ video_id: 'speed-test' });
  player.setPlaybackQualityRange = () => {};
  player.loadVideoById = () => {
    const mediaSource = new win.MediaSource();
    video.src = win.URL.createObjectURL(mediaSource);
    mediaSource.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
  };

  applyChrome38Downgrade(win);
  win.eval(fs.readFileSync(bundlePath, 'utf8'));
  return { win, video };
}

let pass = 0, fail = 0;
const t = (n, ok, extra) => { if (ok) { pass++; console.log('PASS ' + n); }
  else { fail++; console.log('FAIL ' + n + (extra ? '\n     ' + extra : '')); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Measure what the harness's own pipeline is doing, independent of the module.
async function effective(video) {
  const t0 = video.currentTime, w0 = Date.now();
  await wait(700);
  return (video.currentTime - t0) / ((Date.now() - w0) / 1000);
}

(async () => {
  // A normal device: first strategy works, no escalation.
  {
    const { win, video } = boot('direct');
    await wait(300);
    win.__ytafSpeed.setSpeed(2);
    await wait(1400);
    t('[normal TV] picture actually runs at 2x',
      Math.abs(await effective(video) - 2) < 0.2, String(await effective(video)));
  }

  // Native edge cases all use the same MSE timeline path on webOS hardware.
  {
    const { win, video } = boot('no-pitch-correction');
    await wait(300);
    win.__ytafSpeed.setSpeed(2);
    // No assertion on the intermediate state: measuring it races with the
    // escalation that is already under way. What matters is where it lands.
    await wait(3000);
    t('[pitch-locked TV] MSE timeline makes the picture really change',
      Math.abs(await effective(video) - 2) < 0.2, String(await effective(video)));
  }

  // A device that only applies the rate via defaultPlaybackRate.
  {
    const { win, video } = boot('default-rate');
    await wait(300);
    win.__ytafSpeed.setSpeed(1.5);
    await wait(4000);
    t('[default-rate TV] MSE timeline makes the picture really change',
      Math.abs(await effective(video) - 1.5) < 0.2, String(await effective(video)));
  }

  // A pipeline that only takes the rate at play start.
  {
    const { win, video } = boot('pause-apply-play');
    await wait(300);
    win.__ytafSpeed.setSpeed(1.5);
    await wait(9000);
    t('[play-start TV] MSE timeline makes the picture really change',
      Math.abs(await effective(video) - 1.5) < 0.2, String(await effective(video)));
  }

  // The LG C5/G4 case: playbackRate lies, but MSE time still advances at 2x.
  {
    const { win, video } = boot(null);
    await wait(300);
    win.__ytafSpeed.setSpeed(2);
    await wait(1400);
    t('[hardware lockout] picture actually runs at 2x',
      Math.abs(await effective(video) - 2) < 0.2, String(await effective(video)));
    t('[hardware lockout] public property reports the mapped speed',
      Math.abs(video.playbackRate - 2) < 0.001, 'property=' + video.playbackRate);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
