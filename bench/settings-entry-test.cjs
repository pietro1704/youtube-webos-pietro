/* eslint-env node */
/* global __dirname */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { applyChrome38Downgrade, UA, setUserAgent } = require('./chrome38-env.cjs');

const ROOT = path.resolve(__dirname, '..');
const bundlePath = process.argv[2] || ROOT + '/dist/webOSUserScripts/userScript.js';

const row = (label, sub, enabled = true) =>
  `<ytlr-compact-link-renderer tabindex="-1" class="native-wrapper">
     <ytlr-menu-item hybridnavfocusable="true" tabindex="-1">
       <ytlr-button hybridnavfocusable="true" role="menuitem"
                    aria-label="${label}. ${sub}" tabindex="-1"
                    class="native-row ${enabled ? 'enabled-marker' : ''}">
         <ytlr-avatar-lockup>
           <div><yt-icon></yt-icon></div>
           <div>
             <yt-formatted-string><span>${label}</span></yt-formatted-string>
             <div><yt-formatted-string>${sub}</yt-formatted-string></div>
           </div>
         </ytlr-avatar-lockup>
         ${enabled ? '<yt-icon class="chevron"></yt-icon>' : ''}
       </ytlr-button>
     </ytlr-menu-item>
   </ytlr-compact-link-renderer>`;

const playbackMenu = () =>
  row('Quality', 'Auto') +
  row('Captions', 'Off') +
  row('Audio Track', 'English') +
  row('Speed', 'Not available on this device', false);

function boot() {
  const dom = new JSDOM(
    '<!doctype html><html><body class="WEB_PAGE_TYPE_WATCH"><ytlr-app></ytlr-app></body></html>',
    {
      runScripts: 'outside-only',
      url: 'https://www.youtube.com/tv#/watch?v=test',
      virtualConsole: new VirtualConsole(),
      pretendToBeVisual: true
    }
  );
  const win = dom.window;
  setUserAgent(win, UA.webos3);
  win.launchParams = '{}';
  win.XMLHttpRequest = class {
    open() {}
    send() {}
    setRequestHeader() {}
    getResponseHeader() { return null; }
    addEventListener() {}
  };
  win.fetch = () => Promise.reject(new Error('offline'));
  win.requestAnimationFrame = (callback) => setTimeout(() => callback(0), 0);
  win.cancelAnimationFrame = clearTimeout;
  win.localStorage.setItem('ytaf-configuration', win.JSON.stringify({
    enablePlaybackSpeed: true,
    enableAdBlock: true,
    enableSponsorBlock: false,
    enableReturnYouTubeDislike: false,
    enableLegacyEmojiFix: false,
    upgradeThumbnails: false,
    enableAutoLogin: false
  }));
  applyChrome38Downgrade(win);
  win.ytcfg = {
    msgs: {
      PLAYBACK_SPEED_UNAVAILABLE: 'Not available on this device',
      VIDEO_SPEED: 'Speed'
    }
  };
  win.eval(fs.readFileSync(bundlePath, 'utf8'));
  return win;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let pass = 0;
let fail = 0;
function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log('PASS ' + name);
  } else {
    fail++;
    console.log('FAIL ' + name + (detail ? '\n     ' + detail : ''));
  }
}

(async () => {
  const win = boot();
  const doc = win.document;

  const unrelated = doc.createElement('div');
  unrelated.className = 'AmQJbe';
  unrelated.innerHTML = row('Save to playlist', '');
  doc.querySelector('ytlr-app').appendChild(unrelated);
  await wait(50);
  check('unrelated menus are not modified',
    !unrelated.querySelector('[data-ytaf-settings-entry]'));

  const menu = doc.createElement('div');
  menu.className = 'AmQJbe';
  menu.innerHTML = playbackMenu();
  doc.querySelector('ytlr-app').appendChild(menu);
  await wait(100);

  let entry = menu.querySelector('[data-ytaf-settings-entry]');
  check('entry is added to playback settings', !!entry);
  check('entry is added exactly once',
    menu.querySelectorAll('[data-ytaf-settings-entry]').length === 1);
  check('entry inherits the enabled native row class',
    entry && entry.classList.contains('enabled-marker'), entry && entry.className);
  check('entry has a useful accessible label',
    entry && /YouTube Extended/.test(entry.getAttribute('aria-label') || ''));

  if (entry) entry.click();
  await wait(30);
  const panel = doc.querySelector('.ytaf-ui-container');
  check('OK/click opens the complete settings panel',
    panel && panel.style.display === 'block');

  if (win.ytaf_showOptionsPanel) win.ytaf_showOptionsPanel(false);
  menu.innerHTML = playbackMenu();
  await wait(100);
  entry = menu.querySelector('[data-ytaf-settings-entry]');
  check('entry returns after YouTube re-renders the menu', !!entry);
  check('re-render still produces only one entry',
    menu.querySelectorAll('[data-ytaf-settings-entry]').length === 1);

  if (entry) {
    entry.setAttribute('tabindex', '0');
    entry.focus();
    const event = new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    });
    Object.defineProperty(event, 'keyCode', { get: () => 13 });
    entry.dispatchEvent(event);
  }
  await wait(30);
  check('Enter opens the panel for remote navigation',
    panel && panel.style.display === 'block');

  const nativeMenu = doc.createElement('div');
  nativeMenu.className = 'AmQJbe';
  nativeMenu.innerHTML =
    row('Quality', 'Auto') + row('Captions', 'Off') + row('Speed', 'Normal');
  doc.querySelector('ytlr-app').appendChild(nativeMenu);
  await wait(100);
  check('entry also appears when native Speed is already enabled',
    !!nativeMenu.querySelector('[data-ytaf-settings-entry]'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
