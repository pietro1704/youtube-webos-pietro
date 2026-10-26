const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { applyBundleEnvironment, setUserAgent, UA } = require('./bundle-env.cjs');
const item = (id, percent) => ({ tileRenderer: { contentId: id, header: { tileHeaderRenderer: { thumbnailOverlays: [{ thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: percent } }] } } } });
(async () => {
  const dom = new JSDOM('<body class="WEB_PAGE_TYPE_BROWSE"><ytlr-app></ytlr-app></body>', { url: 'https://www.youtube.com/tv', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const win = dom.window;
  try {
    setUserAgent(win, UA.webos3); win.launchParams = '{}';
    win.localStorage.setItem('ytaf-configuration', JSON.stringify({ enableAdBlock: false, enableLegacyEmojiFix: false, enableSponsorBlock: false,
      enableReturnYouTubeDislike: false, dearrowMode: 'off', enableAutoLogin: false, hideEndcards: false, hideGuestSignInPrompts: false }));
    const account = value => win.localStorage.setItem('yt.leanback.default::last-identity-used', JSON.stringify({ data: { identityType: 'CORE_ID', effectiveObfuscatedGaiaId: value, identityCredentials: {} } }));
    account('A');
    applyBundleEnvironment(win);
    win.Headers = Headers; win.Response = Response; win.Request = Request;
    let last, release = null, delay = false;
    win.fetch = async () => {
      last = new Response(JSON.stringify({ contents: [item('aaaaaaaaaaa', 80), item('bbbbbbbbbbb', 85), item('ccccccccccc', null)] }));
      return delay ? new Promise(resolve => { const original = last; release = () => resolve(original); }) : last;
    };
    win.XMLHttpRequest = class { open() {} send() {} setRequestHeader() {} getResponseHeader() { return null; } addEventListener() {} };
    const bundle = process.argv[2] || path.resolve(__dirname, '../dist/webOSUserScripts/userScript.js');
    win.eval(fs.readFileSync(bundle, 'utf8')); win.ytaf_showOptionsPanel(true);
    const checkbox = text => Array.from(win.document.querySelectorAll('label')).find(el => el.textContent.includes(text)).querySelector('input');
    const row = text => Array.from(win.document.querySelectorAll('.shortcut-control-row')).find(el => el.textContent.includes(text));
    const url = 'https://www.youtube.com/youtubei/v1/browse';
    const init = { method: 'POST', body: JSON.stringify({ browseId: 'FEwhat_to_watch' }) };
    assert.equal(await win.fetch(url, init), last);
    checkbox('Hide watched videos').click();
    assert.equal((await (await win.fetch(url, init)).json()).contents.length, 1);
    row('Watched at or above').click();
    assert.equal((await (await win.fetch(url, init)).json()).contents.length, 2, '81% keeps the 80% video');
    const search = 'https://www.youtube.com/youtubei/v1/search';
    assert.equal(await win.fetch(search, { method: 'POST', body: '{}' }), last);
    checkbox('Filter watched: Search').click();
    assert.equal((await (await win.fetch(search, { method: 'POST', body: '{}' })).json()).contents.length, 2);
    checkbox('Filter watched: Home').click(); assert.equal(await win.fetch(url, init), last);
    checkbox('Filter watched: Home').click();
    delay = true; const pending = win.fetch(url, init); const original = last;
    account('B'); win.dispatchEvent(new win.CustomEvent('ytaf-page-update', { detail: { isWatch: false, isShorts: false } }));
    release(); assert.equal(await pending, original, 'previous-account response must remain native');
    delay = false; assert.equal((await (await win.fetch(url, init)).json()).contents.length, 2);
    checkbox('Hide watched videos').click(); assert.equal(await win.fetch(url, init), last);
    assert.match(win.document.getElementById('ytaf-watched-status').textContent, /disabled/);
    console.log('watched UI: enable/disable, precise threshold, page scopes, unknown progress and account lease cancellation passed');
  } finally { win.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
