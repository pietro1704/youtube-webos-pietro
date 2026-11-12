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

function boot(preference, available, options = {}) {
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
      defaultPlaybackSpeed: options.hardware ? '2' : '1',
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

  const calls = [], keys = [];
  win.addEventListener('keydown', evt => { if (evt.keyCode === 38) keys.push(evt.keyCode); });
  if (options.controls) {
    const controls = win.document.createElement('yt-focus-container');
    controls.setAttribute('idomkey', 'controls');
    controls.className = 'MFDzfe--focused';
    win.document.body.appendChild(controls);
  }
  let current = 'medium';
  let range = 'auto';
  let videoId = 'abcdefghijk';
  let state = options.state ?? -1;
  let failures = options.failures || 0;
  let resumes = 0;
  const player = win.document.getElementById(
    'ytlr-player__player-container-player',
  );
  player.getAvailableQualityLevels = () => available.slice();
  player.getPlaybackQuality = () => current;
  player.getPlaybackQualityLabel = () => current;
  player.setPlaybackQualityRange = (min, max) => {
    calls.push(['range', min, max]);
    if (failures-- > 0) throw new Error('player not ready');
    range = min;
  };
  player.setPlaybackQuality = (quality) => {
    calls.push(['quality', quality]);
    current = options.enforceRange && range !== 'auto' ? range : quality;
  };
  player.getVideoData = () => ({ video_id: videoId });
  player.getPlayerState = () => state;
  player.addEventListener = () => {};
  player.removeEventListener = () => {};
  player.isInline = () => false;
  player.playVideo = () => { resumes++; };
  player.pauseVideo = () => {};
  applyBundleEnvironment(win);
  if (options.webos25) {
    setUserAgent(win, UA.webos23.replace('2023', '2025'));
    // The legacy bundle also runs on modern TVs, which have native Reflect.
    win.Reflect = Reflect;
  }
  if (options.hardware) {
    win.AudioDecoder = class {};
    win.MediaSource = class {};
  }
  win.eval(fs.readFileSync(bundlePath, 'utf8'));
  return { dom, win, calls, keys, resumes: () => resumes, setState(value) { state = value; }, setAvailable(levels) { available = levels; }, newVideo(id) { videoId = id; current = 'medium'; } };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  // Native YouTube changes the quality, but an existing forced range wins.
  for (const selection of ['720p', 'Automática']) {
    const app = boot('hd2160', ['hd2160', 'hd1080', 'hd720'], { state: 1, enforceRange: true });
    try {
      await wait(350);
      const player = app.win.document.getElementById('ytlr-player__player-container-player');
      app.win.ytcfg = { msgs: { VIDEO_QUALITY: 'Qualidade', VIDEO_QUALITY_AUTO: 'Automática' } };
      const menu = app.win.document.createElement('div');
      menu.className = 'AmQJbe';
      menu.innerHTML = '<ytlr-overlay-panel-header-renderer>Qualidade</ytlr-overlay-panel-header-renderer>' +
        ['Automática', '720p', '1080p', '2160p'].map(label =>
          `<ytlr-menu-item tabindex="0"><ytlr-button role="checkbox" tabindex="0"><yt-formatted-string>${label}</yt-formatted-string></ytlr-button></ytlr-menu-item>`).join('');
      app.win.document.querySelector('ytlr-app').appendChild(menu);
      const choice = [...menu.querySelectorAll('[role=checkbox]')].find(row => row.textContent === selection);
      const quality = selection === '720p' ? 'hd720' : 'auto';
      choice.addEventListener('click', () => player.setPlaybackQuality(quality));
      choice.querySelector('yt-formatted-string').click();
      await wait(350);
      assert.equal(player.getPlaybackQuality(), quality, 'native quality must override the default range for this video');
      assert.equal(JSON.parse(app.win.localStorage.getItem('ytaf-configuration')).preferredVideoQuality, 'hd2160');
      app.setAvailable(['hd4320', 'hd2160', 'hd1080', 'hd720']);
      app.setState(3);
      await wait(350);
      assert.equal(player.getPlaybackQuality(), quality, 'buffering and new levels must preserve individual quality');
      app.newVideo('next-video');
      await wait(350);
      assert.equal(player.getPlaybackQuality(), 'hd2160', 'next video restores the green-menu default');
    } finally { app.win.close(); }
  }
  for (const action of ['enter', 'cancel', 'hidden', 'detached', 'other-menu', 'failure']) {
    const app = boot('hd2160', ['hd2160', 'hd720'], { state: 2, enforceRange: true });
    try {
      await wait(350);
      const player = app.win.document.getElementById('ytlr-player__player-container-player');
      app.win.ytcfg = { msgs: { VIDEO_QUALITY: 'Qualidade' } };
      const menu = app.win.document.createElement('div');
      menu.className = 'AmQJbe';
      menu.innerHTML = `<ytlr-overlay-panel-header-renderer>${action === 'other-menu' ? 'Legendas' : 'Qualidade'}</ytlr-overlay-panel-header-renderer>` +
        '<ytlr-menu-item tabindex="0"><ytlr-button role="checkbox"><yt-formatted-string>720p60 HDR</yt-formatted-string></ytlr-button></ytlr-menu-item>';
      app.win.document.querySelector('ytlr-app').appendChild(menu);
      const item = menu.querySelector('ytlr-menu-item');
      item.focus();
      if (action === 'hidden') menu.style.display = 'none';
      if (action === 'detached') menu.parentNode.removeChild(menu);
      if (action === 'failure') player.setPlaybackQualityRange = () => { throw new Error('rejected'); };
      if (action === 'cancel') {
        item.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
        item.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      } else item.dispatchEvent(new app.win.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      await wait(350);
      assert.equal(player.getPlaybackQuality(), action === 'enter' ? 'hd720' : 'hd2160', action);
      assert.equal(app.resumes(), 0, 'individual quality preserves pause');
      assert.equal(JSON.parse(app.win.localStorage.getItem('ytaf-configuration')).preferredVideoQuality, 'hd2160');
    } finally { app.win.close(); }
  }
  {
    const app = boot('auto', ['hd2160', 'hd720'], { state: 1, enforceRange: true });
    try {
      await wait(350);
      const player = app.win.document.getElementById('ytlr-player__player-container-player');
      app.win.ytcfg = { msgs: { VIDEO_QUALITY: 'Qualidade' } };
      const menu = app.win.document.createElement('div');
      menu.className = 'AmQJbe';
      menu.innerHTML = '<ytlr-overlay-panel-header-renderer>Qualidade</ytlr-overlay-panel-header-renderer>' +
        '<ytlr-button role="checkbox"><yt-formatted-string>720p</yt-formatted-string></ytlr-button>';
      app.win.document.querySelector('ytlr-app').appendChild(menu);
      menu.querySelector('yt-formatted-string').click();
      assert.equal(player.getPlaybackQuality(), 'hd720');
      app.newVideo('second');
      await wait(350);
      assert.equal(player.getPlaybackQuality(), 'auto', 'Automatic default releases the prior individual range');
      app.newVideo('abcdefghijk');
      await wait(350);
      assert.notEqual(player.getPlaybackQuality(), 'hd720', 'revisit cannot restore a stale override');
    } finally { app.win.close(); }
  }
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

  {
    const app = boot('auto', ['hd2160', 'hd1080'], { state: 1, hardware: true });
    try {
      await wait(650);
      assert.equal(app.calls.length, 0, 'Automatic at 2x must not install a hidden resolution cap');
      assert.equal(app.win.localStorage.getItem('yt-player-quality'), null,
        'Automatic at 2x must clear stale forced quality storage');
    } finally { app.dom.window.close(); }
  }
  for (const scenario of ['late-levels', 'retry-failure', 'revisit', 'hardware-2x', 'growing-levels']) {
    const app = boot('hd2160', scenario === 'late-levels' ? [] : scenario === 'growing-levels' ? ['hd1080'] : ['hd2160', 'hd1080'],
      { state: 1, failures: scenario === 'retry-failure' ? 1 : 0, hardware: scenario === 'hardware-2x' });
    try {
      await wait(350);
      if (scenario === 'late-levels' || scenario === 'growing-levels') app.setAvailable(['hd2160', 'hd1080']);
      if (scenario === 'revisit') {
        app.newVideo('second-video');
        await wait(350);
        app.calls.length = 0;
        app.newVideo('abcdefghijk');
      }
      await wait(850);
      assert.ok(app.calls.some(call => call[0] === 'quality' && call[1] === 'hd2160'),
        scenario + ': saved 4K must apply while playback state stays PLAYING');
    } finally { app.dom.window.close(); }
  }
  {
    const app = boot('hd1440', ['hd2160', 'hd1440'], { state: 2 });
    try {
      await wait(350);
      app.win.ytaf_showOptionsPanel(true);
      const control = Array.from(app.win.document.querySelectorAll('.shortcut-control-row'))
        .find(row => row.textContent.includes('Default Quality'));
      control.click();
      await wait(350);
      assert.ok(app.calls.some(call => call[0] === 'quality' && call[1] === 'hd2160'),
        'green menu applies selected 4K even while paused');
      assert.equal(app.resumes(), 0, 'quality selection must preserve a user pause');
    } finally { app.dom.window.close(); }
  }
  for (const action of ['automatic', 'leave-watch']) {
    const app = boot('hd2160', [], { state: 1 });
    try {
      await wait(350);
      if (action === 'automatic') {
        app.win.ytaf_showOptionsPanel(true);
        Array.from(app.win.document.querySelectorAll('.shortcut-control-row'))
          .find(row => row.textContent.includes('Default Quality')).click();
      } else {
        app.win.document.body.className = '';
        app.win.dispatchEvent(new app.win.CustomEvent('yt-navigate-finish', { detail: { pageType: 'home' } }));
      }
      app.calls.length = 0;
      app.setAvailable(['hd2160']);
      await wait(650);
      assert.equal(app.calls.length, 0, action + ' cancels pending quality application');
      assert.equal(app.resumes(), 0);
    } finally { app.dom.window.close(); }
  }
  for (const action of ['pause', 'automatic', 'leave-watch', 'replace-player', 'destroy']) {
    const app = boot('hd2160', ['hd2160'], { state: -1, webos25: true });
    try {
      await wait(100);
      assert.equal(app.resumes(), 1, 'webOS25 branch is exercised');
      if (action === 'pause') app.setState(2);
      if (action === 'automatic') {
        app.win.ytaf_showOptionsPanel(true);
        Array.from(app.win.document.querySelectorAll('.shortcut-control-row'))
          .find(row => row.textContent.includes('Default Quality')).click();
      }
      if (action === 'leave-watch') {
        app.win.document.body.className = '';
        app.win.dispatchEvent(new app.win.CustomEvent('ytaf-page-update', { detail: { isWatch: false } }));
      }
      if (action === 'replace-player') {
        const old = app.win.document.getElementById('ytlr-player__player-container-player');
        old.parentNode.replaceChild(old.cloneNode(), old);
      }
      if (action === 'destroy') app.win.dispatchEvent(new app.win.Event('beforeunload'));
      await wait(700);
      assert.equal(app.resumes(), 1, action + ' cancels the real webOS25 startup loop');
    } finally { app.dom.window.close(); }
  }
  for (const action of ['success', 'pause', 'automatic', 'navigate', 'user-key']) {
    const app = boot('hd2160', ['hd2160'], { state: 1, webos25: true, controls: true });
    try {
      await wait(100); assert.deepEqual(app.keys, [38]);
      if (action === 'pause') app.setState(2);
      if (action === 'automatic') {
        app.win.ytaf_showOptionsPanel(true);
        Array.from(app.win.document.querySelectorAll('.shortcut-control-row'))
          .find(row => row.textContent.includes('Default Quality')).click();
      }
      if (action === 'navigate') {
        app.win.history.replaceState(null, '', '#/home');
        app.win.dispatchEvent(new app.win.Event('hashchange'));
      }
      if (action === 'user-key') app.win.dispatchEvent(new app.win.KeyboardEvent('keydown', { keyCode: 40 }));
      await wait(800);
      assert.deepEqual(app.keys, action === 'success' ? [38, 38, 38] : [38],
        action + ' preserves control-key ownership in the real bundle');
      assert.equal(Array.from(app.win.document.querySelectorAll('style')).some(style =>
        style.textContent.startsWith('.GLc3cc { opacity')), false);
    } finally { app.dom.window.close(); }
  }
  console.log('video quality: all scenarios passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
