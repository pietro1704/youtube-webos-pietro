import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { selectBranding } from '../src/dearrow/branding.js';
import { createDeArrowClient } from '../src/dearrow/network.js';
import { createDeArrowDomAdapter } from '../src/dearrow/dom.js';

const selected = selectBranding({
  titles: [
    { title: 'untrusted', original: false, votes: -1, locked: false },
    { title: 'Clear title', original: false, votes: 2, locked: false },
  ],
  thumbnails: [{ timestamp: 42.5, original: false, votes: 0, locked: false }],
});
assert.deepEqual(selected, { title: 'Clear title', thumbnailTimestamp: 42.5 });
assert.equal(selectBranding({ titles: [], thumbnails: [] }), null);
assert.equal(selectBranding(null), null);

let fetchCalls = 0;
const client = createDeArrowClient({
  timeoutMs: 25,
  fetchImpl: async () => {
    fetchCalls++;
    return {
      ok: true,
      json: async () => ({ titles: [{ title: 'Cached', votes: 0 }] }),
    };
  },
});
assert.equal((await client.get('abcdefghijk')).title, 'Cached');
assert.equal((await client.get('abcdefghijk')).title, 'Cached');
assert.equal(fetchCalls, 1);

const emptyClient = createDeArrowClient({
  fetchImpl: async () => ({
    ok: true,
    json: async () => ({ titles: [], thumbnails: [] }),
  }),
});
assert.equal(await emptyClient.get('abcdefghijk'), null);
const failedClient = createDeArrowClient({
  fetchImpl: async () => {
    throw new Error('offline');
  },
});
assert.equal(await failedClient.get('abcdefghijk'), null);
const timedOutClient = createDeArrowClient({
  timeoutMs: 5,
  fetchImpl: () => new Promise(() => {}),
});
assert.equal(await timedOutClient.get('abcdefghijk'), null);

const dom = new JSDOM(
  `<!doctype html><body><ytlr-app>
  <ytlr-tile-renderer data-video-id="aaaaaaaaaaa">
    <a href="/tv#/watch?v=aaaaaaaaaaa"><img src="https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg"></a>
    <yt-formatted-string id="video-title">Original A</yt-formatted-string>
  </ytlr-tile-renderer>
</ytlr-app></body>`,
  { url: 'https://www.youtube.com/tv' },
);
const root = dom.window.document.querySelector('ytlr-app');
const pending = new Map();
const domClient = {
  get(videoId) {
    return new Promise((resolve) => pending.set(videoId, resolve));
  },
};
let mode = 'titles_thumbnails';
const adapter = createDeArrowDomAdapter({
  root,
  client: domClient,
  getMode: () => mode,
});
adapter.refresh();

const tile = root.querySelector('ytlr-tile-renderer');
const link = tile.querySelector('a');
const title = tile.querySelector('#video-title');
const image = tile.querySelector('img');
tile.setAttribute('data-video-id', 'bbbbbbbbbbb');
link.setAttribute('href', '/tv#/watch?v=bbbbbbbbbbb');
title.textContent = 'Original B';
image.setAttribute('src', 'https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg');
adapter.refresh();

pending.get('aaaaaaaaaaa')({
  title: 'Wrong old title',
  thumbnailTimestamp: 10,
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(title.textContent, 'Original B');
assert.match(image.src, /bbbbbbbbbbb/);

pending.get('bbbbbbbbbbb')({ title: 'Better B', thumbnailTimestamp: 20 });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(title.textContent, 'Better B');
assert.match(image.src, /dearrow-thumb\.ajay\.app/);

const cssTile = dom.window.document.createElement('ytlr-tile-renderer');
cssTile.innerHTML =
  '<ytlr-thumbnail-details style="background-image: url(https://i.ytimg.com/vi/ccccccccccc/hqdefault.jpg)"></ytlr-thumbnail-details>' +
  '<yt-formatted-string>Original C</yt-formatted-string>';
root.appendChild(cssTile);
adapter.refresh();
pending.get('ccccccccccc')({ title: 'Better C', thumbnailTimestamp: 30 });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(
  cssTile.querySelector('yt-formatted-string').textContent,
  'Better C',
);
assert.match(
  cssTile.querySelector('ytlr-thumbnail-details').style.backgroundImage,
  /dearrow-thumb\.ajay\.app/,
);

mode = 'off';
adapter.refresh();
assert.equal(title.textContent, 'Original B');
assert.match(image.src, /bbbbbbbbbbb/);
adapter.destroy();

console.log('dearrow: 15 passed, 0 failed');
