const assert = require('node:assert/strict');
const { boot } = require('./dependency-test.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const entry = (id, title = id) => ({ guideEntryRenderer: { formattedTitle: { simpleText: title }, navigationEndpoint: { browseEndpoint: { browseId: id } } } });
const fixture = () => ({ items: [{ guideSectionRenderer: { items: [entry('FEwhat_to_watch', 'Home'), { unknownKidsRenderer: { keep: true } }, entry('FEsubscriptions', 'Subscriptions'), entry('FElibrary', 'Library'), entry('UCchannel', 'Private channel label')] } }] });
const ids = data => data.items[0].guideSectionRenderer.items.map(item => item.guideEntryRenderer?.navigationEndpoint?.browseEndpoint?.browseId).filter(Boolean);
function configure(win, calls, account = 'A') {
  const native = function () {}; native.instance = { resolveCommand: command => calls.push(command) }; win._yttv = { native };
  win.localStorage.setItem('yt.leanback.default::last-identity-used', JSON.stringify({ data: { identityType: 'AUTHENTICATED_IDENTITY_TYPE_ACCOUNT', accountId: account } }));
}
(async () => {
  const { win } = boot({ enableSidebarCustomization: true, startInSubscriptions: true, enableLegacyEmojiFix: false, dearrowMode: 'off' });
  try {
    const calls = []; configure(win, calls); win.launchParams = JSON.stringify({ reason: 'launcher' });
    const parse = () => win.JSON.parse(JSON.stringify(fixture()));
    parse(); await wait(120);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[calls.length - 1])), { browseEndpoint: { browseId: 'FEsubscriptions' } });
    parse(); await wait(30); assert.equal(calls.length, 1);
    win.ytaf_showOptionsPanel(true);
    const root = win.document.getElementById('ytaf-sidebar-controls'); assert.ok(root);
    assert.ok(!root.textContent.includes('Private channel label'));
    const button = (id, action) => Array.from(root.querySelectorAll('button')).find(el => el.getAttribute('data-guide-id') === id && el.getAttribute('data-guide-action') === action);
    button('FEsubscriptions', 'up').click();
    assert.equal(ids(parse())[0], 'FEsubscriptions');
    button('FElibrary', 'visible').click(); assert.ok(!ids(parse()).includes('FElibrary'));
    const channels = Array.from(win.document.querySelectorAll('label')).find(el => el.textContent.includes('Hide subscribed channels in sidebar')).querySelector('input');
    channels.click(); assert.ok(!ids(parse()).includes('UCchannel'));
    assert.equal(parse().items[0].guideSectionRenderer.items[1].unknownKidsRenderer.keep, true);
    const customization = Array.from(win.document.querySelectorAll('label')).find(el => el.textContent.includes('Customize sidebar')).querySelector('input');
    customization.click(); assert.deepEqual(Array.from(ids(parse())), ['FEwhat_to_watch', 'FEsubscriptions', 'FElibrary', 'UCchannel']);
    customization.click(); assert.ok(!ids(parse()).includes('FElibrary'));
    assert.equal(calls.length, 1, 'sidebar edits must not interrupt the current native page');
    win.document.getElementById('ytaf-sidebar-reset').click(); assert.deepEqual(Array.from(ids(parse())), ['FEwhat_to_watch', 'FEsubscriptions', 'FElibrary', 'UCchannel']);
    configure(win, calls, 'B'); win.dispatchEvent(new win.CustomEvent('ytaf-page-update', { detail: { isWatch: false, isShorts: false } }));
    assert.equal(root.querySelectorAll('[data-guide-id]').length, 0, 'old account catalog must be discarded');
    console.log('navigation UI: startup, exact endpoint, editable native sidebar, unknown entry preservation, reset and account isolation passed');
  } finally { win.close(); }
  const deep = boot({ startInSubscriptions: true, enableLegacyEmojiFix: false, dearrowMode: 'off' }).win;
  try {
    const calls = []; configure(deep, calls); deep.launchParams = JSON.stringify({ contentTarget: 'v=aaaaaaaaaaa' });
    deep.JSON.parse(JSON.stringify(fixture())); await wait(120); assert.deepEqual(calls, []);
    console.log('navigation UI: explicit external video launch remains untouched');
  } finally { deep.close(); }
  const playing = boot({ startInSubscriptions: true, enableLegacyEmojiFix: false, dearrowMode: 'off' }).win;
  try {
    const calls = []; configure(playing, calls); playing.document.body.className = 'WEB_PAGE_TYPE_WATCH';
    playing.JSON.parse(JSON.stringify(fixture())); await wait(120); assert.deepEqual(calls, []);
    console.log('navigation UI: an active player is preserved even on a Home-shaped URL');
  } finally { playing.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
