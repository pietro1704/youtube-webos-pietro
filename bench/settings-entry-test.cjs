/* eslint-env node */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { applyBundleEnvironment, UA, setUserAgent } = require('./bundle-env.cjs');

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
  applyBundleEnvironment(win);
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
  let clock = win.Date.now();
  win.Date.now = () => clock;
  const key = (code, name, target = doc) => {
    clock += 1000;
    const event = new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: name });
    Object.defineProperty(event, 'keyCode', { get: () => code });
    target.dispatchEvent(event);
  };
  const open = () => doc.querySelector('.ytaf-ui-container')?.style.display === 'block';
  const menu = doc.createElement('div');
  menu.className = 'AmQJbe';
  // Native C5 menu: each renderer occupies one fixed-height virtual-list cell.
  // The previous injection appended its clone inside Speed's cell, overflowing
  // directly onto the following Repeat checkbox and its native hit target.
  const rows = [row('Quality', 'Auto'), row('Captions', 'Off'), row('Audio Track', 'English'), row('Speed', 'Normal'),
    '<ytlr-compact-toggle-button-renderer><ytlr-button role="checkbox" aria-label="Repeat" aria-checked="false" tabindex="0">Repeat</ytlr-button></ytlr-compact-toggle-button-renderer>'];
  menu.innerHTML = '<yt-virtual-list><div>' + rows.map(markup => '<div class="native-slot" style="height:4rem;margin-bottom:0.5rem">' + markup + '</div>').join('') + '</div></yt-virtual-list>';
  const repeat = menu.querySelector('[role="checkbox"]');
  let repeats = 0;
  repeat.addEventListener('click', () => { repeats++; repeat.setAttribute('aria-checked', 'true'); });
  doc.querySelector('ytlr-app').appendChild(menu);
  await wait(100);
  check('native virtual-list cells retain exactly one renderer', Array.from(menu.querySelectorAll('.native-slot')).every(slot => slot.children.length === 1));
  check('no injected settings row can overlap the following Repeat cell', !menu.querySelector('[data-ytaf-settings-entry]'));
  check('native Repeat identity and position remain unchanged', menu.querySelector('[role="checkbox"]') === repeat && repeat.closest('.native-slot') === menu.querySelectorAll('.native-slot')[4]);
  repeat.click();
  check('native Repeat still receives its own click', repeats === 1 && repeat.getAttribute('aria-checked') === 'true' && !open());
  key(13, 'Enter', repeat);
  check('OK on native Repeat never opens extended settings', !open());
  for (const code of [404, 172]) {
    key(code, 'Green', repeat);
    await wait(20);
    check('green key ' + code + ' opens the complete settings panel from a native menu', open());
    const panel = doc.querySelector('.ytaf-ui-container');
    check('green panel retains all requested feature controls', !!panel && ['Watched videos', 'Startup and sidebar', 'Captions', 'Video queue'].every(label => panel.textContent.includes(label)));
    key(code, 'Green', doc.activeElement);
    await wait(20);
    check('green key ' + code + ' closes settings without activating Repeat', !open() && repeats === 1);
  }
  menu.innerHTML = '<yt-virtual-list><div>' + rows.map(markup => '<div class="native-slot" style="height:4rem">' + markup + '</div>').join('') + '</div></yt-virtual-list>';
  await wait(100);
  check('native menu re-render does not reintroduce the overlapping clone', !menu.querySelector('[data-ytaf-settings-entry]') && Array.from(menu.querySelectorAll('.native-slot')).every(slot => slot.children.length === 1));
  menu.parentNode.removeChild(menu);
  doc.body.className = 'WEB_PAGE_TYPE_BROWSE';
  key(404, 'Green'); await wait(20);
  check('green settings remain available outside playback', open());
  key(404, 'Green', doc.activeElement); await wait(20);
  check('closing outside playback leaves the app usable', !open());
  console.log(`\n${pass} passed, ${fail} failed`);
  win.close();
  process.exit(fail ? 1 : 0);
})();
