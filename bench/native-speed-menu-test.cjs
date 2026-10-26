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
  const { win, video } = boot(null);
  win.ytcfg = { msgs: { VIDEO_SPEED: 'Velocidade da reprodução', VIDEO_SPEED_NORMAL: 'Normal' } };
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
  assert.equal(JSON.parse(win.localStorage.getItem('ytaf-configuration')).defaultPlaybackSpeed, '1.5');
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

  const normal = choice('Normal');
  normal.parentNode.focus();
  normal.parentNode.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
  await wait(900);
  assert.equal(video.playbackRate, 1, 'OK on a focused native wrapper selects Normal');
  assert.deepEqual(selected(menu), ['Normal']);
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
  win.document.body.className = 'WEB_PAGE_TYPE_BROWSE';
  await wait(40);
  choice('2×').click();
  assert.equal(win.__ytafSpeed.getSpeed(), 1, 'stale player menus after navigation must not change the preference');
  win.close();
  console.log('native speed menu: actual hardware rate, selection, re-render, cancellation and identity passed');
})().catch(error => { console.error(error); process.exit(1); });
