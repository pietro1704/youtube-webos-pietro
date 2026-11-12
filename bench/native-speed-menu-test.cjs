const assert = require('node:assert/strict');
const { boot } = require('./speed-hardware-test.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const row = (label, sub) => `<ytlr-button role="menuitem" tabindex="0" aria-label="${label}. ${sub}">
  <ytlr-avatar-lockup><yt-formatted-string>${label}</yt-formatted-string>
  <yt-formatted-string>${sub}</yt-formatted-string></ytlr-avatar-lockup><yt-icon></yt-icon>
</ytlr-button>`;
const options = title => `<ytlr-overlay-panel-header-renderer>${title}</ytlr-overlay-panel-header-renderer>` +
  ['0,25×', '0,5×', 'Normal', '1,5×', '2×', '3×'].map(label =>
    `<ytlr-menu-item tabindex="0"><ytlr-button role="checkbox" tabindex="0"
      aria-checked="${label === 'Normal'}"><ytlr-avatar-lockup>
      <yt-formatted-string>${label}</yt-formatted-string></ytlr-avatar-lockup>
      <yt-icon class="${label === 'Normal' ? 'native-checked-icon' : 'native-empty-icon'}"></yt-icon>
    </ytlr-button></ytlr-menu-item>`).join('');
const selected = menu => Array.from(menu.querySelectorAll('[aria-checked="true"]'), r => r.textContent.trim());

(async () => {
  const { win, video } = boot(null, { defaultPlaybackSpeed: '2', preferredVideoQuality: 'hd2160' });
  const player = win.document.getElementById('ytlr-player__player-container-player');
  let videoId = 'first', quality = 'medium';
  player.getVideoData = () => ({ video_id: videoId });
  player.getPlayerState = () => 1;
  player.getAvailableQualityLevels = () => ['hd2160', 'hd1080', 'hd720'];
  player.getPlaybackQuality = () => quality;
  player.setPlaybackQualityRange = value => { quality = value; };
  player.setPlaybackQuality = value => { quality = value; };
  win.ytcfg = { msgs: { VIDEO_SPEED: 'Velocidade da reprodução', VIDEO_SPEED_NORMAL: 'Normal', QUALITY: 'Qualidade do vídeo', QUALITY_FOR_VIDEO: 'Qualidade do vídeo atual', VIDEO_QUALITY_AUTO: 'Automática' } };
  await wait(100);
  win.__ytafSpeed.setSpeed(2, { notify: false });
  await wait(900);
  const menu = win.document.createElement('div');
  menu.className = 'AmQJbe';
  menu.innerHTML = row('Qualidade', 'Automática') + row('Velocidade da reprodução', 'Normal');
  win.document.querySelector('ytlr-app').appendChild(menu);
  await wait(80);
  let speed = menu.querySelector('[data-ytaf-speed-row]');
  assert.ok(speed, 'enabled native speed row must be connected to the app speed controller');
  assert.equal(speed.querySelectorAll('yt-formatted-string')[1].textContent, '2x',
    'native menu must show the actual 2x rather than Normal');
  // Captured TV markup: the server calls the row "Velocidade", while VIDEO_SPEED
  // is "Velocidade da reprodução". Its component command identifies the feature.
  menu.innerHTML = row('Qualidade', 'Automática') + row('Velocidade', 'Normal');
  menu.querySelectorAll('[role=menuitem]')[1].__instance = { props: { command: {
    openClientOverlayAction: { type: 'CLIENT_OVERLAY_TYPE_VIDEO_PLAYBACK_SPEED' }
  } } };
  await wait(80);
  speed = menu.querySelector('[data-ytaf-speed-row]');
  assert.ok(speed, 'native command must identify a server label different from the localized panel title');
  assert.equal(speed.querySelectorAll('yt-formatted-string')[1].textContent, '2x');
  speed.focus();
  speed.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
  assert.equal(win.__ytafSpeed.getSpeed(), 2, 'opening the enabled menu must not cycle the rate');

  menu.innerHTML = options('Velocidade da reprodução');
  await wait(80);
  const choice = label => Array.from(menu.querySelectorAll('[role=checkbox]')).find(r => r.textContent.trim() === label);
  assert.deepEqual(selected(menu), ['2×'], 'checkmark must follow the actual speed, not native Normal');
  assert.equal(choice('2×').querySelector('yt-icon').className, 'native-checked-icon');
  const stale = choice('1,5×');
  stale.querySelector('yt-formatted-string').click();
  await wait(900);
  assert.equal(video.playbackRate, 1.5, 'click on the native choice must rebuild the real hardware timeline');
  assert.equal(JSON.parse(win.localStorage.getItem('ytaf-configuration')).defaultPlaybackSpeed, '2',
    'individual speed must preserve the green-menu default');
  assert.deepEqual(selected(menu), ['1,5×']);

  // Native re-renders, including aria-only updates, cannot restore a stale check.
  choice('Normal').setAttribute('aria-checked', 'true');
  choice('1,5×').setAttribute('aria-checked', 'false');
  await wait(60);
  assert.deepEqual(selected(menu), ['1,5×']);
  menu.innerHTML = options('Velocidade da reprodução');
  await wait(60);
  assert.deepEqual(selected(menu), ['1,5×']);
  stale.click();
  assert.equal(win.__ytafSpeed.getSpeed(), 1.5, 'detached options must not change the current video');

  // A speed reload must keep the quality chosen in this same video's menu.
  const qualityMenu = win.document.createElement('div');
  qualityMenu.className = 'AmQJbe';
  qualityMenu.innerHTML = '<ytlr-overlay-panel-header-renderer>Qualidade do vídeo atual</ytlr-overlay-panel-header-renderer>' +
    '<ytlr-button role="checkbox"><yt-formatted-string>720p</yt-formatted-string></ytlr-button>';
  win.document.querySelector('ytlr-app').appendChild(qualityMenu);
  qualityMenu.querySelector('yt-formatted-string').click();
  assert.equal(quality, 'hd720');
  assert.equal(JSON.parse(win.localStorage.getItem('ytaf-configuration')).preferredVideoQuality, 'hd2160');
  qualityMenu.parentNode.removeChild(qualityMenu);

  const normal = choice('Normal');
  normal.parentNode.focus();
  normal.parentNode.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
  await wait(900);
  assert.equal(video.playbackRate, 1, 'OK on a focused native wrapper selects Normal');
  assert.deepEqual(selected(menu), ['Normal']);
  assert.equal(quality, 'hd720', 'speed reload must preserve the individual quality');
  choice('3×').click();
  assert.equal(win.__ytafSpeed.getSpeed(), 1, 'unsupported choices must be ignored');

  // Arrow navigation and cancellation do not apply a highlighted option.
  choice('2×').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
  choice('2×').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  assert.equal(win.__ytafSpeed.getSpeed(), 1);
  const unrelated = win.document.createElement('div');
  unrelated.className = 'AmQJbe';
  unrelated.innerHTML = options('Qualidade');
  win.document.querySelector('ytlr-app').appendChild(unrelated);
  unrelated.querySelectorAll('[role=checkbox]')[3].click();
  assert.equal(win.__ytafSpeed.getSpeed(), 1, 'another dialog with rate-like labels must be left alone');
  assert.deepEqual(selected(unrelated), ['Normal']);
  menu.style.display = 'none';
  choice('2×').classList.add('zylon-focus');
  const other = unrelated.querySelectorAll('[role=checkbox]')[3];
  other.focus();
  other.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
  assert.equal(win.__ytafSpeed.getSpeed(), 1, 'Enter in another dialog must not activate a hidden speed option');
  choice('2×').click();
  assert.equal(win.__ytafSpeed.getSpeed(), 1, 'hidden but connected options must be inert');
  menu.style.display = '';
  win.document.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
  assert.equal(win.__ytafSpeed.getSpeed(), 1, 'body-level remote events must stay in the active dialog');
  choice('2×').classList.remove('zylon-focus');
  videoId = 'second';
  player.loadVideoById(videoId, 0);
  await wait(350);
  assert.equal(video.playbackRate, 2, 'autoplay restores default speed on the same player');
  assert.equal(quality, 'hd2160', 'autoplay restores default quality on the same player');
  videoId = 'first';
  player.loadVideoById(videoId, 0);
  await wait(350);
  assert.equal(video.playbackRate, 2, 'revisiting a video starts from the default');
  assert.equal(quality, 'hd2160', 'old individual quality must not return on a revisit');
  win.document.body.className = 'WEB_PAGE_TYPE_BROWSE';
  await wait(40);
  choice('2×').click();
  assert.equal(win.__ytafSpeed.getSpeed(), 2, 'stale player menus after navigation must not change the preference');
  win.close();
  console.log('native speed menu: actual hardware rate, selection, re-render, cancellation and identity passed');
})().catch(error => { console.error(error); process.exit(1); });
