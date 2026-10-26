/* eslint-env node */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const {
  applyBundleEnvironment,
  UA,
  setUserAgent,
} = require('./bundle-env.cjs');

const ROOT = path.resolve(__dirname, '..');
const bundlePath =
  process.argv[2] || ROOT + '/dist/webOSUserScripts/userScript.js';

function boot(preference, available) {
  const dom = new JSDOM(
    '<!doctype html><html><body class="WEB_PAGE_TYPE_WATCH"><ytlr-app>' +
      '<div id="ytlr-player__player-container-player"></div><video></video>' +
      '</ytlr-app></body></html>',
    {
      runScripts: 'outside-only',
      url: 'https://www.youtube.com/tv#/watch?v=abcdefghijk',
      virtualConsole: new VirtualConsole(),
      pretendToBeVisual: true,
    },
  );
  const win = dom.window;
  setUserAgent(win, UA.webos23);
  win.launchParams = '{}';
  win.fetch = () => Promise.reject(new Error('offline'));
  win.XMLHttpRequest = class {
    open() {}
    send() {}
    setRequestHeader() {}
    getResponseHeader() {
      return null;
    }
    addEventListener() {}
  };
  win.requestAnimationFrame = (callback) =>
    win.setTimeout(() => callback(0), 0);
  win.cancelAnimationFrame = win.clearTimeout;
  win.localStorage.setItem(
    'ytaf-configuration',
    win.JSON.stringify({
      enableAdBlock: false,
      enableSponsorBlock: false,
      enableReturnYouTubeDislike: false,
      enableLegacyEmojiFix: false,
      enableAutoLogin: false,
      dearrowMode: 'off',
      preferredVideoQuality: preference,
    }),
  );
  win.localStorage.setItem(
    'yt-player-quality',
    win.JSON.stringify({
      data: win.JSON.stringify({ quality: 2160, previousQuality: 2160 }),
      creation: Date.now(),
      expiration: Date.now() + 10000,
    }),
  );

  const calls = [];
  let current = 'medium';
  let videoId = 'abcdefghijk';
  const player = win.document.getElementById(
    'ytlr-player__player-container-player',
  );
  player.getAvailableQualityLevels = () => available.slice();
  player.getPlaybackQuality = () => current;
  player.getPlaybackQualityLabel = () => current;
  player.setPlaybackQualityRange = (min, max) =>
    calls.push(['range', min, max]);
  player.setPlaybackQuality = (quality) => {
    calls.push(['quality', quality]);
    current = quality;
  };
  player.getVideoData = () => ({ video_id: videoId });
  player.getPlayerState = () => -1;
  player.addEventListener = () => {};
  player.removeEventListener = () => {};
  player.isInline = () => false;
  player.playVideo = () => {};
  player.pauseVideo = () => {};
  applyBundleEnvironment(win);
  win.eval(fs.readFileSync(bundlePath, 'utf8'));
  return { dom, win, calls, newVideo(id) { videoId = id; current = 'medium'; } };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  {
    const app = boot('hd1080', ['hd2160', 'hd720', 'medium']);
    await wait(350);
    assert.deepEqual(app.calls[0], ['range', 'hd720', 'hd720']);
    assert.deepEqual(app.calls[1], ['quality', 'hd720']);
    const stored = JSON.parse(
      app.win.localStorage.getItem('yt-player-quality'),
    );
    assert.equal(JSON.parse(stored.data).quality, 1080);
    app.dom.window.close();
  }
  {
    const app = boot('auto', ['hd2160', 'hd1080']);
    await wait(350);
    assert.equal(app.calls.length, 0);
    assert.equal(app.win.localStorage.getItem('yt-player-quality'), null);
    app.dom.window.close();
  }
  {
    const app = boot('8k', ['hd2160', 'hd1080']);
    await wait(350);
    assert.equal(app.calls.length, 0);
    assert.equal(app.win.localStorage.getItem('yt-player-quality'), null);
    app.dom.window.close();
  }

  {
    const app = boot('hd2160', ['hd2160', 'hd1080']);
    await wait(350);
    app.calls.length = 0;
    app.newVideo('second-video');
    await wait(650);
    assert.ok(app.calls.some(call => call[0] === 'range' && call[1] === 'hd2160'),
      'quality default must apply to a new video even if the native state event is missing');
    app.win.ytaf_showOptionsPanel(true);
    const control = Array.from(app.win.document.querySelectorAll('.shortcut-control-row'))
      .find(row => row.textContent.includes('Default Quality'));
    assert.ok(control);
    app.calls.length = 0;
    control.click();
    await wait(50);
    assert.ok(app.calls.some(call => call[0] === 'range' && call[1] === 'auto'),
      'selecting Automatic must release the current player quality constraint');
    app.dom.window.close();
  }

  console.log('video quality: 10 passed, 0 failed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
