const assert = require('node:assert/strict');
const { boot } = require('./dependency-test.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  for (const mode of ['auto_skip', 'manual_skip']) {
    const { win } = boot({ enableSponsorBlock: true, sbMode_sponsor: mode, sbMode_highlight: 'disable' });
    try {
      win.history.replaceState(null, '', '#/watch?v=videoA');
      win.document.body.className = 'WEB_PAGE_TYPE_WATCH';
      const video = win.document.createElement('video');
      for (const [key, value] of Object.entries({ duration: 100, readyState: 4, paused: false, seeking: false })) {
        Object.defineProperty(video, key, { configurable: true, value });
      }
      video.currentTime = 5;
      win.document.body.appendChild(video);
      const bar = win.document.createElement('ytlr-progress-bar');
      bar.innerHTML = '<div idomkey="slider"></div>';
      win.document.body.appendChild(bar);
      let fetches = 0;
      win.fetch = async url => {
        if (!String(url).includes('/skipSegments/')) return { ok: false };
        fetches++;
        return { ok: true, json: async () => [{ videoID: 'videoA', segments: [{ category: 'sponsor', actionType: 'skip', segment: [10, 20] }] }] };
      };
      await wait(750);
      assert.ok(win.sponsorblock && !win.sponsorblock.isDestroyed);
      assert.ok(win.document.querySelector('#previewbar'));
      if (mode === 'manual_skip') {
        video.currentTime = 12; video.dispatchEvent(new win.Event('timeupdate'));
        assert.ok(win.document.querySelector('.message'), 'manual prompt exists before disabling');
      }
      const old = win.sponsorblock;
      win.ytaf_showOptionsPanel(true);
      win.document.querySelectorAll('.ytaf-tab-btn')[1].click();
      const checkbox = [...win.document.querySelectorAll('label')].find(el => el.textContent.trim() === 'SponsorBlock')?.querySelector('input');
      assert.ok(checkbox?.checked, 'actual SponsorBlock setting is reachable');
      checkbox.click();
      video.currentTime = 12; video.dispatchEvent(new win.Event('timeupdate'));
      assert.equal(video.currentTime, 12, 'disabled handler cannot seek');
      assert.equal(old.isDestroyed, true);
      assert.equal(win.document.querySelector('#previewbar'), null);
      if (mode === 'manual_skip') {
        await wait(1100);
        assert.equal(win.document.querySelector('.message'), null, 'disabled manual prompt is removed');
      }
      checkbox.click(); await wait(100);
      assert.ok(win.sponsorblock && win.sponsorblock !== old);
      video.dispatchEvent(new win.Event('timeupdate'));
      assert.equal(video.currentTime, mode === 'auto_skip' ? 20 : 12, 're-enable applies the configured mode');
      if (mode === 'manual_skip') assert.ok(win.sponsorblock.currentManualSegment);
      assert.equal(fetches, 2);
      console.log('SponsorBlock UI: live disable, cleanup and same-video re-enable passed');
    } finally { win.sponsorblock?.destroy(); win.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
