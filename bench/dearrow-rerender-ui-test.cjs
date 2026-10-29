const assert = require('node:assert/strict');
const { boot } = require('./dependency-test.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let requests = 0;
  const { win } = boot({ dearrowMode: 'titles_thumbnails' }, win => {
    win.fetch = async () => { requests++; return { ok: true, json: async () => ({
      titles: [{ title: 'Better', votes: 1 }], thumbnails: [{ timestamp: 12, votes: 1 }]
    }) }; };
  });
  try {
    const tile = win.document.createElement('ytlr-tile-renderer'); tile.setAttribute('data-video-id', 'aaaaaaaaaa1');
    const markup = label => `<span data-title>${label}</span><img src="https://i.ytimg.com/vi/aaaaaaaaaa1/${label}.jpg" srcset="${label} 2x">`;
    tile.innerHTML = markup('Original'); win.document.querySelector('ytlr-app').appendChild(tile);
    await wait(300); assert.equal(tile.querySelector('[data-title]').textContent, 'Better');
    tile.innerHTML = markup('Replacement');
    await wait(300); assert.equal(tile.querySelector('[data-title]').textContent, 'Better');
    assert.match(tile.querySelector('img').src, /dearrow-thumb/);
    let mutations = 0;
    const observer = new win.MutationObserver(() => { mutations++; }); observer.observe(tile, { subtree: true, childList: true, attributes: true });
    await wait(350); observer.disconnect();
    assert.equal(mutations, 0, 'adapter-owned branding must not trigger an endless restore/apply loop');
    assert.equal(requests, 1, 'same-video rerender uses the cached request');
    win.__ytafDeArrow.destroy();
    assert.equal(tile.querySelector('[data-title]').textContent, 'Replacement');
    assert.ok(tile.querySelector('img').src.endsWith('/Replacement.jpg'));
    assert.equal(tile.querySelector('img').getAttribute('srcset'), 'Replacement 2x');
    console.log('DeArrow UI: same-video rerender, cached title/thumbnail, stable observer and native restoration passed');
  } finally { win.__ytafDeArrow?.destroy(); win.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
