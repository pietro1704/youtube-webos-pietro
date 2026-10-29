const assert = require('node:assert/strict');
const { boot } = require('./dependency-test.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  for (const enabled of [false, true]) {
    const { win } = boot({ enableAutoLogin: enabled, enableLegacyEmojiFix: false });
    try {
      const keys = [];
      win.addEventListener('keydown', event => keys.push(event.keyCode));
      win.document.body.className = 'WEB_PAGE_TYPE_ACCOUNT_SELECTOR';
      win.document.dispatchEvent(new win.CustomEvent('webOSRelaunch', { detail: {} }));
      await wait(750);
      assert.deepEqual(keys, enabled ? [13] : [], 'relaunch must honor auto-login preference');
      if (!enabled) assert.equal(win.document.body.classList.contains('ytaf-bypassing-login'), false);
    } finally { win.close(); }
  }
  const { win } = boot({ enableAutoLogin: true, enableLegacyEmojiFix: false });
  try {
    const keys = [];
    win.addEventListener('keydown', event => keys.push(event.keyCode));
    win.document.body.className = 'WEB_PAGE_TYPE_ACCOUNT_SELECTOR';
    win.document.dispatchEvent(new win.CustomEvent('webOSRelaunch', { detail: {} }));
    win.ytaf_showOptionsPanel(true);
    const label = Array.from(win.document.querySelectorAll('label')).find(el => el.textContent.includes('Bypass Nag Screens'));
    assert.ok(label, 'auto-login checkbox is reachable');
    label.querySelector('input').click();
    await wait(750);
    assert.deepEqual(keys, [], 'disabling in the real options panel cancels pending Enter');
    assert.equal(win.document.body.classList.contains('ytaf-bypassing-login'), false);
  } finally { win.close(); }
  console.log('auto-login UI: enabled/disabled relaunch and live cancellation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
