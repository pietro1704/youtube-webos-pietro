const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./dependency-test.cjs');
(async () => {
  const { win } = boot({ enableLegacyEmojiFix: false, dearrowMode: 'off' });
  try {
    assert.ok(win.__ytafBuildInfo, 'the installed bundle must expose its own build identity');
    const bundle = path.resolve(process.argv[2] || 'dist/webOSUserScripts/userScript.js');
    const expected = JSON.parse(fs.readFileSync(path.join(path.dirname(bundle), '../build-info.json'), 'utf8'));
    assert.deepEqual(JSON.parse(JSON.stringify(win.__ytafBuildInfo)), expected);
    assert.match(expected.commit, /^[a-f0-9]{40}$/);
    assert.equal(expected.variant, process.argv[3] === 'modern' ? 'modern' : 'legacy');
    assert.equal(Object.isFrozen(win.__ytafBuildInfo), true);
    win.ytaf_showOptionsPanel(true);
    const info = win.document.getElementById('ytaf-build-info');
    assert.ok(info.textContent.includes(expected.version));
    assert.ok(info.textContent.includes(expected.commit));
    assert.ok(info.textContent.includes(expected.variant));
    const badge = win.document.getElementById('ytaf-build-badge');
    assert.equal(badge.hidden, true);
    const control = Array.from(win.document.querySelectorAll('label')).find(el => el.textContent.includes('Show build in header'));
    assert.ok(control);
    control.querySelector('input').click();
    assert.equal(badge.hidden, false);
    control.querySelector('input').click();
    assert.equal(badge.hidden, true);
    assert.equal(win.__ytafBuildInfo.commit, expected.commit, 'display choices cannot change provenance');
    console.log('build identity: bundle/asset match, immutable commit/variant and in-app visibility passed');
  } finally { win.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
