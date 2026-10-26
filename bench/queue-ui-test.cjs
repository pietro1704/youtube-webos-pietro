const assert = require('node:assert/strict');
const { boot } = require('./dependency-test.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const { win } = boot({ enableVideoQueue: false, enableLegacyEmojiFix: false, dearrowMode: 'off' });
  try {
    const calls = [];
    const native = function () {};
    native.instance = { resolveCommand: command => calls.push(command) };
    win._yttv = { native };
    win.localStorage.setItem('yt.leanback.default::last-identity-used', JSON.stringify({ data: { identityType: 'CORE_ID', effectiveObfuscatedGaiaId: 'A', identityCredentials: {} } }));
    const app = win.document.querySelector('ytlr-app');
    for (const [id, title] of [['aaaaaaaaaaa', 'A'], ['bbbbbbbbbbb', 'B']]) {
      const tile = win.document.createElement('ytlr-tile-renderer');
      tile.setAttribute('data-video-id', id); tile.tabIndex = 0;
      const label = win.document.createElement('span'); label.setAttribute('data-title', ''); label.textContent = title;
      tile.appendChild(label); app.appendChild(tile);
    }
    const tiles = app.querySelectorAll('ytlr-tile-renderer');
    tiles[0].focus(); win.ytaf_showOptionsPanel(true);
    const button = id => win.document.getElementById('ytaf-queue-' + id);
    assert.equal(button('add').disabled, true);
    const enable = Array.from(win.document.querySelectorAll('label')).find(el => el.textContent.includes('Enable video queue')).querySelector('input');
    enable.click(); assert.equal(button('add').disabled, false); button('add').click();
    const rows = () => win.document.getElementById('ytaf-video-queue').lastElementChild.children;
    assert.equal(rows().length, 1); assert.ok(rows()[0].textContent.startsWith('A'));
    await wait(550); win.ytaf_showOptionsPanel(false); tiles[1].focus(); win.ytaf_showOptionsPanel(true); button('next').click();
    assert.equal(rows().length, 2); assert.ok(rows()[0].textContent.startsWith('B'));
    rows()[0].querySelectorAll('button')[1].click(); assert.equal(rows().length, 1);
    button('next').click(); button('start').click(); await wait(50);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[calls.length - 1])), { watchEndpoint: { videoId: 'bbbbbbbbbbb' } });
    const p = win.document.createElement('div'); p.id = 'ytlr-player__player-container-player';
    p.getVideoData = () => ({ video_id: 'bbbbbbbbbbb', title: 'B' }); app.appendChild(p);
    win.document.body.className = 'WEB_PAGE_TYPE_WATCH'; await wait(600);
    assert.equal(rows().length, 1, 'consume only after the exact requested video starts');
    win.ytaf_showOptionsPanel(true); button('clear').click(); assert.equal(rows().length, 0);
    button('add').click(); assert.equal(rows().length, 1);
    win.localStorage.setItem('yt.leanback.default::last-identity-used', JSON.stringify({ data: { identityType: 'CORE_ID', effectiveObfuscatedGaiaId: 'B', identityCredentials: {} } }));
    await wait(550); assert.equal(rows().length, 0);
    button('add').click(); assert.equal(rows().length, 0, 'stale account selection must not be queued');
    console.log('queue UI: selection, toggle, next/remove/clear, exact native command, confirmation and account isolation passed');
  } finally { win.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
