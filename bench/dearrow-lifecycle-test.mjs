import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createDeArrowClient } from '../src/dearrow/network.js';
import { createDeArrowDomAdapter } from '../src/dearrow/dom.js';

const id = n => String(n).padStart(11, 'a');
const branding = { title: 'Better', thumbnailTimestamp: null };
const response = () => ({ ok: true, json: async () => ({ titles: [{ title: 'Better', votes: 1 }] }) });

test('timeouts abort requests and preserve the physical concurrency limit', async () => {
  let active = 0;
  let peak = 0;
  let aborted = 0;
  const client = createDeArrowClient({ timeoutMs: 10, maxConcurrent: 2,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      peak = Math.max(peak, ++active);
      options.signal?.addEventListener('abort', () => {
        active--; aborted++; reject(new Error('aborted'));
      });
    }) });
  await Promise.all(Array.from({ length: 8 }, (_, n) => client.get(id(n))));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(peak <= 2, `physical peak ${peak}`);
  assert.equal(active, 0);
  assert.ok(aborted > 0);
  client.destroy();
});

test('legacy timeouts resolve without starting more unabortable requests', async () => {
  let calls = 0;
  const client = createDeArrowClient({ timeoutMs: 5, maxConcurrent: 2,
    AbortControllerImpl: null, fetchImpl: () => { calls++; return new Promise(() => {}); } });
  const values = await Promise.all(Array.from({ length: 8 }, (_, n) => client.get(id(n))));
  assert.deepEqual(values, Array(8).fill(null));
  assert.equal(calls, 2);
  client.destroy();
});

test('transient failure expires and duplicate callers share an in-flight request', async () => {
  let calls = 0;
  let clock = 0;
  const client = createDeArrowClient({ negativeTtlMs: 10, now: () => clock,
    fetchImpl: async () => { if (++calls === 1) throw new Error('offline'); return response(); } });
  assert.equal(await client.get(id(1)), null);
  assert.equal(await client.get(id(1)), null);
  assert.equal(calls, 1);
  clock = 11;
  const first = client.get(id(1));
  assert.equal(client.get(id(1)), first);
  assert.deepEqual(await first, branding);
  assert.equal(calls, 2);
  client.destroy();
});

test('cache size and lifetime are bounded', async () => {
  let calls = 0;
  let clock = 0;
  const client = createDeArrowClient({ maxCacheEntries: 2, cacheTtlMs: 10, now: () => clock,
    fetchImpl: async () => { calls++; return response(); } });
  await client.get(id(1)); await client.get(id(2)); await client.get(id(3));
  await client.get(id(1));
  assert.equal(calls, 4, 'oldest cached entry must be evicted');
  clock = 11;
  await client.get(id(1));
  assert.equal(calls, 5, 'expired successful result must be refreshed');
  client.destroy();
});

test('destroy resolves active and queued requests and ignores late completion', async () => {
  let complete;
  let calls = 0;
  const client = createDeArrowClient({ maxConcurrent: 1, maxQueue: 1,
    fetchImpl: () => { calls++; return new Promise(resolve => { complete = resolve; }); } });
  const first = client.get(id(1));
  const queued = client.get(id(2));
  await Promise.resolve();
  assert.equal(await client.get(id(3)), null, 'overflow must settle immediately');
  client.destroy();
  assert.deepEqual(await Promise.all([first, queued]), [null, null]);
  complete(response());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(await client.get(id(4)), null);
  assert.equal(calls, 1);
});

test('removed tiles reject late branding and can be reinserted with fresh nodes', async () => {
  const dom = new JSDOM('<main><div data-video-id="aaaaaaaaaa1"><span data-title>Original</span></div></main>');
  const root = dom.window.document.querySelector('main');
  const tile = root.firstElementChild;
  let complete;
  const adapter = createDeArrowDomAdapter({ root, getMode: () => 'titles',
    client: { get: () => new Promise(resolve => { complete = resolve; }) } });
  adapter.refresh();
  tile.remove();
  adapter.refresh();
  complete(branding);
  await Promise.resolve();
  assert.equal(tile.textContent, 'Original');
  tile.innerHTML = '<span data-title>New original</span>';
  root.appendChild(tile);
  adapter.refresh();
  complete(branding);
  await Promise.resolve();
  assert.equal(tile.textContent, 'Better');
  adapter.destroy();
  assert.equal(tile.textContent, 'New original');
  dom.window.close();
});

test('clearing on disable cancels work and permits a later retry', async () => {
  let calls = 0;
  const client = createDeArrowClient({ fetchImpl: (_url, options) => {
    if (++calls > 1) return Promise.resolve(response());
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  } });
  const pending = client.get(id(1));
  await Promise.resolve();
  client.clear();
  assert.equal(await pending, null);
  assert.deepEqual(await client.get(id(1)), branding);
  assert.equal(calls, 2);
  client.destroy();
});

for (const changed of ['title', 'image', 'both']) test('same-video child replacement refreshes DeArrow references: ' + changed, async () => {
  const dom = new JSDOM('<main><div data-video-id="aaaaaaaaaa1"><span data-title>Original</span><img src="https://i.ytimg.com/vi/aaaaaaaaaa1/old.jpg" srcset="old 2x"></div></main>');
  const root = dom.window.document.querySelector('main'), tile = root.firstElementChild;
  let mode = 'titles_thumbnails';
  const adapter = createDeArrowDomAdapter({ root, getMode: () => mode,
    client: { get: async () => ({ title: 'Better', thumbnailTimestamp: 12 }) } });
  try {
    adapter.refresh(); await Promise.resolve();
    if (changed !== 'image') tile.querySelector('[data-title]').outerHTML = '<span data-title>New original</span>';
    if (changed !== 'title') tile.querySelector('img').outerHTML = '<img src="https://i.ytimg.com/vi/aaaaaaaaaa1/new.jpg" srcset="new 2x">';
    adapter.refresh(); await Promise.resolve();
    assert.equal(tile.querySelector('[data-title]').textContent, 'Better');
    assert.ok(!tile.querySelector('img').src.includes('ytimg.com'));
    mode = 'off'; adapter.refresh();
    assert.equal(tile.querySelector('[data-title]').textContent, changed === 'image' ? 'Original' : 'New original');
    assert.ok(tile.querySelector('img').src.endsWith(changed === 'title' ? '/old.jpg' : '/new.jpg'));
    assert.equal(tile.querySelector('img').getAttribute('srcset'), changed === 'title' ? 'old 2x' : 'new 2x');
  } finally { adapter.destroy(); dom.window.close(); }
});

test('host updates on reused nodes become the new restoration baseline', async () => {
  const dom = new JSDOM('<main><div data-video-id="aaaaaaaaaa1"><span data-title>Original</span><img src="https://i.ytimg.com/vi/aaaaaaaaaa1/old.jpg"></div></main>');
  const root = dom.window.document.querySelector('main'), tile = root.firstElementChild;
  let mode = 'titles_thumbnails';
  const adapter = createDeArrowDomAdapter({ root, getMode: () => mode,
    client: { get: async () => ({ title: 'Better', thumbnailTimestamp: 12 }) } });
  try {
    adapter.refresh(); await Promise.resolve();
    tile.querySelector('[data-title]').textContent = 'Updated by YouTube';
    tile.querySelector('img').src = 'https://i.ytimg.com/vi/aaaaaaaaaa1/new.jpg';
    tile.querySelector('img').setAttribute('srcset', 'updated 2x');
    adapter.refresh(); await Promise.resolve();
    assert.equal(tile.querySelector('[data-title]').textContent, 'Better');
    mode = 'off'; adapter.refresh();
    assert.equal(tile.querySelector('[data-title]').textContent, 'Updated by YouTube');
    assert.ok(tile.querySelector('img').src.endsWith('/new.jpg'));
    assert.equal(tile.querySelector('img').getAttribute('srcset'), 'updated 2x');
  } finally { adapter.destroy(); dom.window.close(); }
});

test('a late response cannot write through retired child references before the next refresh', async () => {
  const dom = new JSDOM('<main><div data-video-id="aaaaaaaaaa1"><span data-title>Original</span></div></main>');
  const root = dom.window.document.querySelector('main'), tile = root.firstElementChild, retired = tile.firstElementChild;
  const pending = [];
  const adapter = createDeArrowDomAdapter({ root, getMode: () => 'titles',
    client: { get: () => new Promise(resolve => pending.push(resolve)) } });
  try {
    adapter.refresh(); tile.innerHTML = '<span data-title>Replacement</span>';
    pending[0]({ title: 'Stale', thumbnailTimestamp: null }); await Promise.resolve();
    assert.equal(retired.textContent, 'Original');
    assert.equal(tile.textContent, 'Replacement');
    adapter.refresh(); pending.at(-1)(branding); await Promise.resolve();
    assert.equal(tile.textContent, 'Better');
  } finally { adapter.destroy(); dom.window.close(); }
});

test('background thumbnail replacement keeps the new native background on disable', async () => {
  const dom = new JSDOM('<main><div data-video-id="aaaaaaaaaa1"><span data-title>Original</span><ytlr-thumbnail-details style="background-image:url(https://i.ytimg.com/vi/aaaaaaaaaa1/old.jpg)"></ytlr-thumbnail-details></div></main>');
  const root = dom.window.document.querySelector('main'), tile = root.firstElementChild;
  let mode = 'titles_thumbnails';
  const adapter = createDeArrowDomAdapter({ root, getMode: () => mode,
    client: { get: async () => ({ title: 'Better', thumbnailTimestamp: 12 }) } });
  try {
    adapter.refresh(); await Promise.resolve();
    tile.querySelector('ytlr-thumbnail-details').outerHTML = '<ytlr-thumbnail-details style="background-image:url(https://i.ytimg.com/vi/aaaaaaaaaa1/new.jpg)"></ytlr-thumbnail-details>';
    adapter.refresh(); await Promise.resolve();
    assert.match(tile.querySelector('ytlr-thumbnail-details').style.backgroundImage, /dearrow-thumb/);
    mode = 'off'; adapter.refresh();
    assert.match(tile.querySelector('ytlr-thumbnail-details').style.backgroundImage, /new\.jpg/);
  } finally { adapter.destroy(); dom.window.close(); }
});

test('host srcset update while branding is applied is restored without adopting the branded source', async () => {
  const dom = new JSDOM('<main><div data-video-id="aaaaaaaaaa1"><img src="https://i.ytimg.com/vi/aaaaaaaaaa1/old.jpg" srcset="old 2x"></div></main>');
  const root = dom.window.document.querySelector('main'), image = root.querySelector('img');
  let mode = 'titles_thumbnails';
  const adapter = createDeArrowDomAdapter({ root, getMode: () => mode,
    client: { get: async () => ({ title: null, thumbnailTimestamp: 12 }) } });
  try {
    adapter.refresh(); await Promise.resolve();
    image.setAttribute('srcset', 'new host 2x');
    adapter.refresh(); await Promise.resolve();
    mode = 'off'; adapter.refresh();
    assert.ok(image.src.endsWith('/old.jpg')); assert.equal(image.getAttribute('srcset'), 'new host 2x');
  } finally { adapter.destroy(); dom.window.close(); }
});
