const assert = require('node:assert/strict');
const { boot } = require('./dependency-test.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function checkbox(win, title) {
  const label = Array.from(win.document.querySelectorAll('#ytaf-page-main label'))
    .find(row => row.textContent.includes(title));
  assert.ok(label, title + ' control must exist');
  return label.querySelector('input');
}

function response(NS) {
  return NS({ responseContext: { pad: 'x'.repeat(600) }, trackingParams: 'keep-with-adblock-off',
    contents: { sectionListRenderer: { contents: [{ shelfRenderer: {
      title: { runs: [{ text: 'Videos' }] }, content: { horizontalListRenderer: { items: [
        { tileRenderer: { contentId: 'regular' } },
        { tileRenderer: { contentId: 'short', style: 'TILE_STYLE_YTLR_SHORTS' } },
        { tileRenderer: { contentId: 'live', contentType: 'TILE_CONTENT_TYPE_LIVE' } },
        { adSlotRenderer: {} }
      ] } }
    } }] } } });
}

const items = result => result.contents.sectionListRenderer.contents[0]
  .shelfRenderer.content.horizontalListRenderer.items;

(async () => {
  const { win, NS } = boot({ enableAdBlock: false, enableLegacyEmojiFix: false,
    enableTrackingBlock: true, removeGlobalShorts: false, removeLiveVideos: false });
  win.ytaf_showOptionsPanel(true);
  let reloads = 0;
  win.document.querySelector('ytlr-app').addEventListener('innertube-command', event => {
    if (event.detail.signalServiceEndpoint?.actions?.[0]?.signalAction?.signal === 'SOFT_RELOAD_PAGE') reloads++;
  });
  const shorts = checkbox(win, 'Remove Shorts');
  const live = checkbox(win, 'Remove Live Videos');
  assert.equal(shorts.disabled, false, 'Shorts preference must work independently of Ad Block');
  assert.equal(live.disabled, false, 'live preference must work independently of Ad Block');
  assert.equal(items(win.JSON.parse(response(NS))).length, 4);
  shorts.click();
  await wait(250);
  let filtered = win.JSON.parse(response(NS));
  assert.equal(items(filtered).length, 3);
  assert.equal(filtered.trackingParams, 'keep-with-adblock-off');
  assert.ok(items(filtered).some(item => item.adSlotRenderer), 'content preferences must not enable ad blocking');
  live.click();
  await wait(250);
  filtered = win.JSON.parse(response(NS));
  assert.equal(items(filtered).length, 2);
  assert.equal(items(filtered)[0].tileRenderer.contentId, 'regular');
  const guide = win.JSON.parse(NS({ responseContext: {}, items: [{ guideSectionRenderer: { items: [
    { guideEntryRenderer: { navigationEndpoint: { browseEndpoint: { browseId: 'FEshorts' } } } },
    { guideEntryRenderer: { navigationEndpoint: { browseEndpoint: { browseId: 'FEsubscriptions' } } } }
  ] } }] }));
  assert.equal(guide.items[0].guideSectionRenderer.items.length, 1,
    'Shorts must also be hidden in a small navigation response');
  assert.equal(guide.items[0].guideSectionRenderer.items[0].guideEntryRenderer.navigationEndpoint.browseEndpoint.browseId, 'FEsubscriptions');
  shorts.click();
  live.click();
  await wait(250);
  assert.equal(items(win.JSON.parse(response(NS))).length, 4,
    'turning filters off must restore untouched responses');
  const saved = JSON.parse(win.localStorage.getItem('ytaf-configuration'));
  assert.equal(saved.enableAdBlock, false);
  assert.equal(saved.removeGlobalShorts, false);
  assert.equal(saved.removeLiveVideos, false);
  win.document.body.className = 'WEB_PAGE_TYPE_WATCH';
  await wait(30);
  win.ytaf_showOptionsPanel(false);
  assert.equal(reloads, 0, 'closing settings must not interrupt a playing video');
  win.document.body.className = 'WEB_PAGE_TYPE_BROWSE';
  await wait(30);
  assert.equal(reloads, 1, 'pending filters must refresh the feed after leaving playback');
  win.document.body.className = 'WEB_PAGE_TYPE_SEARCH';
  await wait(30);
  assert.equal(reloads, 1, 'unrelated later navigation must not trigger another refresh');
  win.close();
  const codecApp = boot({ enableAdBlock: true, enableLegacyEmojiFix: false });
  codecApp.win.ytaf_showOptionsPanel(true);
  const codec = Array.from(codecApp.win.document.querySelectorAll('.shortcut-control-row'))
    .find(row => row.textContent.includes('Force Video Codec'));
  assert.ok(codec);
  const initialParse = codecApp.win.JSON.parse;
  codec.click();
  const codecParse = codecApp.win.JSON.parse;
  assert.notEqual(codecParse, initialParse, 'fixture must install the actual codec parser');
  const ads = checkbox(codecApp.win, 'Ad Blocking');
  let browseReloads = 0;
  codecApp.win.document.querySelector('ytlr-app').addEventListener('innertube-command', () => { browseReloads++; });
  ads.click();
  assert.equal(codecApp.win.JSON.parse, codecParse,
    'disabling content filtering must retain downstream codec hooks');
  assert.equal(items(codecApp.win.JSON.parse(response(codecApp.NS))).length, 4);
  ads.click();
  assert.equal(items(codecApp.win.JSON.parse(response(codecApp.NS))).length, 3);
  await wait(550);
  codecApp.win.ytaf_showOptionsPanel(false);
  assert.equal(browseReloads, 1, 'closing settings on a browse page refreshes immediately');
  codecApp.win.close();
  console.log('content preferences: independent toggles, hot hook install/removal, small guide and disabled identity passed');
})().catch(error => { console.error(error); process.exit(1); });
