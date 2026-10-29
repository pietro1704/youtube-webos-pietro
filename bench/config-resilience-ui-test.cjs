const assert = require('node:assert/strict');
const { boot } = require('./dependency-test.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  for (const scenario of ['config-read', 'storage-getter', 'malformed', 'invalid-types', 'quota']) {
    let current;
    try {
      const { win } = boot({ enableAutoLogin: false }, win => {
        current = win;
        if (scenario === 'config-read') {
          const get = win.Storage.prototype.getItem;
          win.Storage.prototype.getItem = function (key) {
            if (key === 'ytaf-configuration') throw new win.DOMException('unavailable', 'SecurityError');
            return get.call(this, key);
          };
        }
        if (scenario === 'storage-getter') Object.defineProperty(win, 'localStorage', { get() { throw new win.DOMException('unavailable', 'SecurityError'); } });
        if (scenario === 'malformed') win.localStorage.setItem('ytaf-configuration', '{');
        if (scenario === 'invalid-types') win.localStorage.setItem('ytaf-configuration', JSON.stringify({
          enableAdBlock: 'false', enableAutoLogin: false, enableSponsorBlock: false, dearrowMode: 'off',
          preferredVideoQuality: 'hd720', sbMode_sponsor: {}, uiTheme: [], videoShelfOpacity: 'bad'
        }));
        if (scenario === 'quota') win.Storage.prototype.setItem = () => { throw new win.DOMException('full', 'QuotaExceededError'); };
      });
      assert.equal(typeof win.ytaf_showOptionsPanel, 'function', scenario + ': userscript initialized');
      win.ytaf_showOptionsPanel(true);
      const label = text => [...win.document.querySelectorAll('label')].find(el => el.textContent.includes(text));
      const adblock = label('Ad Blocking').querySelector('input');
      assert.equal(adblock.checked, true, scenario + ': safe boolean default');
      if (scenario === 'invalid-types') {
        assert.equal(label('Bypass Nag Screens').querySelector('input').checked, false, 'valid preference survives');
        assert.ok([...win.document.querySelectorAll('.shortcut-control-row')].find(el => el.textContent.includes('Default Quality')).textContent.includes('720'));
      }
      adblock.click(); await wait(250);
      assert.equal(label('Reduce Telemetry').querySelector('input').disabled, true, scenario + ': live configuration remains usable');
    } finally { current?.close(); }
  }
  console.log('config UI: failed reads/getter, malformed storage, mixed validity and quota preserve startup and live settings');
})().catch(error => { console.error(error); process.exitCode = 1; });
